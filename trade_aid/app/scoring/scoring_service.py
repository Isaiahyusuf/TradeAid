from datetime import datetime
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.models import Token, ScoringHistory, Developer, Trader
from app.scoring.eligibility import eligibility_checker
from app.utils.redis_client import cache_get, cache_set
from app.utils.redis_client import publish_event
from app.utils.logging_config import logger
from app.config import get_settings
import httpx

settings = get_settings()


class ScoringService:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)

    async def score_token(
        self, db: AsyncSession, contract_address: str, chain: str
    ) -> dict:
        result = await db.execute(
            select(Token).where(
                Token.contract_address == contract_address,
                Token.chain == chain,
            )
        )
        token = result.scalar_one_or_none()
        if not token:
            return {"error": "Token not found", "eligible": False}

        eligible, reason = eligibility_checker.check_eligibility(token)
        scores = await self._compute_scores(db, token)

        cache_key = f"score:{chain}:{contract_address}"
        cached = await cache_get(cache_key)
        if cached:
            return cached

        history = ScoringHistory(
            token_id=token.id,
            contract_address=contract_address,
            chain=chain,
            rug_probability=scores["rug_probability"],
            liquidity_stability=scores["liquidity_stability"],
            holder_distribution=scores["holder_distribution"],
            smart_wallet_signal=scores["smart_wallet_signal"],
            trade_confidence_index=scores["trade_confidence_index"],
            eligible=eligible,
            eligibility_reason=reason if not eligible else None,
            raw_data=scores.get("raw_data"),
        )
        db.add(history)
        await db.flush()

        response = {
            "contract_address": contract_address,
            "chain": chain,
            "symbol": token.symbol,
            "name": token.name,
            "eligible": eligible,
            "eligibility_reason": reason if not eligible else None,
            "scores": {
                "rug_probability": scores["rug_probability"],
                "liquidity_stability": scores["liquidity_stability"],
                "holder_distribution": scores["holder_distribution"],
                "smart_wallet_signal": scores["smart_wallet_signal"],
                "trade_confidence_index": scores["trade_confidence_index"],
            },
            "market_data": {
                "market_cap_usd": token.market_cap_usd,
                "liquidity_usd": token.liquidity_usd,
                "holder_count": token.holder_count,
            },
            "scored_at": str(datetime.utcnow()),
        }

        await cache_set(cache_key, response, ttl=120)
        await publish_event("scores", {
            "type": "score_update",
            "chain": chain,
            "contract": contract_address,
            "symbol": token.symbol,
            "rug_probability": scores["rug_probability"],
            "trade_confidence_index": scores["trade_confidence_index"],
            "eligible": eligible,
        })
        return response

    async def _compute_scores(self, db: AsyncSession, token: Token) -> dict:
        try:
            ai_response = await self.client.post(
                f"{settings.AI_SERVICE_URL}/score-token",
                json={
                    "contract_address": token.contract_address,
                    "chain": token.chain,
                    "market_cap_usd": token.market_cap_usd or 0,
                    "liquidity_usd": token.liquidity_usd or 0,
                    "holder_count": token.holder_count or 0,
                    "is_mintable": token.is_mintable,
                    "is_ownership_renounced": token.is_ownership_renounced,
                },
            )
            if ai_response.status_code == 200:
                ai_scores = ai_response.json()
                return ai_scores
        except Exception as e:
            logger.warning(f"[Scoring] AI service unavailable, using heuristic: {e}")

        return await self._heuristic_scoring(db, token)

    async def _heuristic_scoring(self, db: AsyncSession, token: Token) -> dict:
        rug_prob = 50.0
        liq_stability = 50.0
        holder_dist = 50.0
        smart_signal = 50.0

        if token.is_mintable:
            rug_prob += 20
        if not token.is_ownership_renounced:
            rug_prob += 10

        if token.deployer_wallet:
            dev_result = await db.execute(
                select(Developer).where(
                    Developer.wallet_address == token.deployer_wallet
                )
            )
            dev = dev_result.scalar_one_or_none()
            if dev:
                if dev.rug_percentage > 50:
                    rug_prob += 25
                elif dev.rug_percentage > 20:
                    rug_prob += 15
                if dev.wallet_age_days < 30:
                    rug_prob += 10

        if token.liquidity_usd:
            if token.liquidity_usd > 100000:
                liq_stability += 20
            elif token.liquidity_usd > 50000:
                liq_stability += 10
            elif token.liquidity_usd < 5000:
                liq_stability -= 20

        if token.holder_count:
            if token.holder_count > 1000:
                holder_dist += 20
            elif token.holder_count > 500:
                holder_dist += 10
            elif token.holder_count < 50:
                holder_dist -= 20

        smart_count = await db.execute(
            select(func.count(Trader.id)).where(
                Trader.is_smart_wallet == True
            )
        )
        smart_total = smart_count.scalar() or 0
        if smart_total > 5:
            smart_signal += 15
        elif smart_total > 2:
            smart_signal += 8

        rug_prob = max(0, min(100, rug_prob))
        liq_stability = max(0, min(100, liq_stability))
        holder_dist = max(0, min(100, holder_dist))
        smart_signal = max(0, min(100, smart_signal))

        safety_factor = (100 - rug_prob) / 100
        confidence = (
            (liq_stability * 0.3 + holder_dist * 0.25 + smart_signal * 0.2)
            * safety_factor
            + (100 - rug_prob) * 0.25
        )
        confidence = max(0, min(100, confidence))

        return {
            "rug_probability": round(rug_prob, 2),
            "liquidity_stability": round(liq_stability, 2),
            "holder_distribution": round(holder_dist, 2),
            "smart_wallet_signal": round(smart_signal, 2),
            "trade_confidence_index": round(confidence, 2),
            "raw_data": {"method": "heuristic"},
        }

    async def close(self):
        await self.client.aclose()


scoring_service = ScoringService()
