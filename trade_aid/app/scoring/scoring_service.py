from datetime import datetime
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.models import Token, ScoringHistory, Developer, Trader
from app.utils.redis_client import cache_get, cache_set
from app.utils.redis_client import publish_event
from app.utils.logging_config import logger
from app.config import get_settings
from app.services.token_resolver_service import resolver_service
import httpx

settings = get_settings()


class ScoringService:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0, trust_env=False)

    @staticmethod
    def _normalize_chain_for_dex(chain: str) -> str:
        normalized = (chain or "").strip().lower()
        mapping = {
            "solana": "solana",
            "ethereum": "ethereum",
            "eth": "ethereum",
            "bsc": "bsc",
            "bnb": "bsc",
            "base": "base",
            "arbitrum": "arbitrum",
            "avax": "avalanche",
            "avalanche": "avalanche",
            "polygon": "polygon",
            "matic": "polygon",
        }
        return mapping.get(normalized, normalized)

    async def _fetch_dex_pair(self, contract_address: str, chain: str) -> dict:
        normalized_chain = self._normalize_chain_for_dex(chain)
        try:
            response = await self.client.get(f"https://api.dexscreener.com/latest/dex/tokens/{contract_address}")
            if response.status_code >= 400:
                return {}
            rows = (response.json() or {}).get("pairs", []) or []
            best = None
            best_liquidity = -1.0
            for row in rows:
                row_chain = self._normalize_chain_for_dex(str((row or {}).get("chainId") or ""))
                if normalized_chain and normalized_chain != "all" and row_chain != normalized_chain:
                    continue
                liquidity = float(((row or {}).get("liquidity") or {}).get("usd") or 0.0)
                if liquidity > best_liquidity:
                    best_liquidity = liquidity
                    best = row
            return best or {}
        except Exception:
            return {}

    async def _score_from_dex_pair(self, contract_address: str, chain: str, pair: dict) -> dict:
        if not pair:
            return {"error": "Token not found", "eligible": False}

        normalized_chain = self._normalize_chain_for_dex(chain)
        volume = pair.get("volume") or {}
        txns = pair.get("txns") or {}
        base = pair.get("baseToken") or {}
        liquidity_usd = float((pair.get("liquidity") or {}).get("usd") or 0.0)
        market_cap_usd = float(pair.get("marketCap") or pair.get("fdv") or 0.0)
        buys_5m = float(((txns.get("m5") or {}).get("buys") or 0.0))
        sells_5m = float(((txns.get("m5") or {}).get("sells") or 0.0))
        buy_sell_ratio = (buys_5m + 1.0) / (sells_5m + 1.0)
        volume_5m = float(volume.get("m5") or 0.0)
        volume_1h = float(volume.get("h1") or 0.0)
        slippage_hint = max(0.0, min(10.0, (volume_5m / max(liquidity_usd, 1.0)) * 100.0))

        rug_probability = 50.0
        risk_flags: list[str] = []
        if liquidity_usd < 2000.0:
            rug_probability += 25.0
            risk_flags.append("LOW_LIQUIDITY")
        elif liquidity_usd < 10000.0:
            rug_probability += 10.0
            risk_flags.append("THIN_LIQUIDITY")

        if buy_sell_ratio < 0.9:
            rug_probability += 8.0
            risk_flags.append("SELL_PRESSURE")
        if slippage_hint > 3.0:
            rug_probability += 8.0
            risk_flags.append("HIGH_SLIPPAGE")

        rug_probability = max(5.0, min(99.0, rug_probability))

        liquidity_stability = max(0.0, min(100.0, (liquidity_usd / 25000.0) * 100.0))
        holder_distribution = max(0.0, min(100.0, 100.0 - min(slippage_hint * 10.0, 90.0)))
        smart_wallet_signal = max(0.0, min(100.0, buy_sell_ratio * 40.0))

        opportunity = 30.0
        if liquidity_usd > 10000.0:
            opportunity += 18.0
        if volume_1h > 0 and volume_5m > (volume_1h / 12.0):
            opportunity += 18.0
        if buy_sell_ratio > 1.15:
            opportunity += 15.0
        opportunity = max(0.0, min(100.0, opportunity))

        trade_confidence = max(0.0, min(100.0, opportunity - max(0.0, (rug_probability - 50.0) * 0.6)))
        eligible = bool(rug_probability <= 85.0 and liquidity_usd >= 2000.0)
        reason = None if eligible else ("rug_risk_above_85" if rug_probability > 85.0 else "liquidity_below_2k")

        return {
            "contract_address": contract_address,
            "chain": normalized_chain,
            "symbol": str(base.get("symbol") or "UNKNOWN"),
            "name": str(base.get("name") or "DexScreener Token"),
            "eligible": eligible,
            "eligibility_reason": reason,
            "risk_flags": risk_flags,
            "status": "dex_live",
            "scores": {
                "rug_probability": round(rug_probability, 2),
                "liquidity_stability": round(liquidity_stability, 2),
                "holder_distribution": round(holder_distribution, 2),
                "smart_wallet_signal": round(smart_wallet_signal, 2),
                "trade_confidence_index": round(trade_confidence, 2),
                "rug_risk_score": round(rug_probability, 2),
                "opportunity_score": round(opportunity, 2),
            },
            "market_data": {
                "market_cap_usd": market_cap_usd,
                "liquidity_usd": liquidity_usd,
                "holder_count": 0,
                "price_usd": float(pair.get("priceUsd") or 0.0),
            },
            "source": {
                "provider": "dexscreener",
                "pair_address": str(pair.get("pairAddress") or ""),
                "dex_id": str(pair.get("dexId") or ""),
                "url": str(pair.get("url") or ""),
            },
            "scored_at": str(datetime.utcnow()),
        }

    async def score_token(
        self, db: AsyncSession, contract_address: str, chain: str
    ) -> dict:
        normalized_chain = (chain or "solana").strip().lower()
        result = await db.execute(
            select(Token).where(
                Token.contract_address == contract_address,
                Token.chain == normalized_chain,
            )
        )
        token = result.scalar_one_or_none()
        if not token and normalized_chain == "solana":
            resolved = await resolver_service.resolve_token(db, contract_address)
            if resolved.get("token") is not None:
                token = resolved["token"]
            elif resolved.get("invalid"):
                return {"error": resolved.get("error") or "Invalid mint", "eligible": False, "invalid_mint": True}
            else:
                return {
                    "contract_address": contract_address,
                    "chain": normalized_chain,
                    "symbol": "UNKNOWN",
                    "name": "Indexing token...",
                    "eligible": False,
                    "eligibility_reason": "Indexing token...",
                    "status": "indexing",
                    "risk_flags": ["TOKEN_NOT_INDEXED_YET"],
                    "scores": {
                        "rug_probability": 50.0,
                        "liquidity_stability": 0.0,
                        "holder_distribution": 0.0,
                        "smart_wallet_signal": 0.0,
                        "trade_confidence_index": 30.0,
                        "rug_risk_score": 50.0,
                        "opportunity_score": 30.0,
                    },
                    "market_data": {
                        "market_cap_usd": 0.0,
                        "liquidity_usd": 0.0,
                        "holder_count": 0,
                    },
                    "scored_at": str(datetime.utcnow()),
                }

        if not token:
            pair = await self._fetch_dex_pair(contract_address, normalized_chain)
            fallback = await self._score_from_dex_pair(contract_address, normalized_chain, pair)
            return fallback

        scores = await self._compute_scores(db, token)
        risk_flags = list(scores.get("risk_flags") or [])

        liquidity_usd = float(token.liquidity_usd or 0.0)
        jupiter_route = bool((token.extra_data or {}).get("jupiter_route", False))
        rug_risk_score = float(scores.get("rug_risk_score", scores.get("rug_probability", 50.0)) or 50.0)

        eligible = bool(rug_risk_score <= 85.0 and liquidity_usd >= 2000.0 and jupiter_route)
        reason = None
        if not eligible:
            if rug_risk_score > 85.0:
                reason = "rug_risk_above_85"
            elif liquidity_usd < 2000.0:
                reason = "liquidity_below_2k"
            elif not jupiter_route:
                reason = "no_jupiter_route"
            else:
                reason = "execution_guard_blocked"

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

        token_extra = dict(token.extra_data or {})
        token_extra["rug_risk_score"] = rug_risk_score
        token_extra["opportunity_score"] = float(scores.get("opportunity_score", scores.get("trade_confidence_index", 30.0)) or 30.0)
        token_extra["risk_flags"] = risk_flags
        token_extra["last_updated"] = datetime.utcnow().isoformat()
        token.extra_data = token_extra
        await db.flush()

        response = {
            "contract_address": contract_address,
            "chain": normalized_chain,
            "symbol": token.symbol,
            "name": token.name,
            "eligible": eligible,
            "eligibility_reason": reason if not eligible else None,
            "risk_flags": risk_flags,
            "scores": {
                "rug_probability": scores["rug_probability"],
                "liquidity_stability": scores["liquidity_stability"],
                "holder_distribution": scores["holder_distribution"],
                "smart_wallet_signal": scores["smart_wallet_signal"],
                "trade_confidence_index": scores["trade_confidence_index"],
                "rug_risk_score": scores.get("rug_risk_score", scores["rug_probability"]),
                "opportunity_score": scores.get("opportunity_score", scores["trade_confidence_index"]),
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
            "chain": normalized_chain,
            "contract": contract_address,
            "symbol": token.symbol,
            "rug_probability": scores["rug_probability"],
            "trade_confidence_index": scores["trade_confidence_index"],
            "eligible": eligible,
            "risk_flags": risk_flags,
        })
        return response

    async def _compute_scores(self, db: AsyncSession, token: Token) -> dict:
        try:
            # Try AI service - check if it's mounted locally or external
            ai_url = settings.AI_SERVICE_URL
            if ai_url.startswith("http://ai_service"):
                # Use localhost if AI service is mounted in same app
                ai_url = "http://localhost:8000/ai"
            
            ai_response = await self.client.post(
                f"{ai_url}/score-token",
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
        extra = token.extra_data or {}
        risk_flags: list[str] = []

        rug_risk = 50.0
        mint_authority_active = bool(extra.get("mint_authority_active", token.is_mintable))
        freeze_authority_active = bool(extra.get("freeze_authority_active", not token.is_ownership_renounced))
        top3_percent = float(extra.get("top3_percent") or 0.0)
        liquidity = float(token.liquidity_usd or 0.0)
        age_minutes = float(extra.get("age_minutes") or 0.0)

        if mint_authority_active:
            rug_risk += 20
            risk_flags.append("MINT_AUTHORITY_ACTIVE")
        if top3_percent > 50.0:
            rug_risk += 15
            risk_flags.append("HIGH_TOP_HOLDER_CONCENTRATION")
        if liquidity < 5000.0:
            rug_risk += 15
            risk_flags.append("LOW_LIQUIDITY")
        if age_minutes > 0 and age_minutes < 10.0:
            rug_risk += 10
            risk_flags.append("VERY_NEW_TOKEN")
        if freeze_authority_active:
            rug_risk += 10
            risk_flags.append("FREEZE_AUTHORITY_ACTIVE")
        rug_risk = max(0.0, min(100.0, rug_risk))

        opportunity = 30.0
        volume_5m = float(extra.get("volume_5m") or 0.0)
        volume_1h = float(extra.get("volume_1h") or 0.0)
        holder_count = int(token.holder_count or 0)
        holder_growth_positive = bool(holder_count >= 100 or volume_5m > 200)
        slippage_pct = float(extra.get("slippage_percent") or 0.0)
        buy_sell_ratio = float(extra.get("buy_sell_ratio") or 1.0)

        if liquidity > 20000.0:
            opportunity += 20.0
        if volume_5m > max(volume_1h / 12.0, 1.0):
            opportunity += 15.0
        if holder_growth_positive:
            opportunity += 15.0
        if slippage_pct > 0 and slippage_pct < 3.0:
            opportunity += 10.0
        if 5.0 <= age_minutes <= 60.0:
            opportunity += 10.0
        if buy_sell_ratio > 1.2:
            opportunity += 10.0
        opportunity = max(0.0, min(100.0, opportunity))

        liq_stability = max(0.0, min(100.0, (liquidity / 25000.0) * 100.0))
        holder_dist = max(0.0, min(100.0, 100.0 - min(top3_percent, 100.0)))
        smart_signal = max(0.0, min(100.0, buy_sell_ratio * 40.0))
        confidence = opportunity

        return {
            "rug_probability": round(rug_risk, 2),
            "liquidity_stability": round(liq_stability, 2),
            "holder_distribution": round(holder_dist, 2),
            "smart_wallet_signal": round(smart_signal, 2),
            "trade_confidence_index": round(confidence, 2),
            "rug_risk_score": round(rug_risk, 2),
            "opportunity_score": round(opportunity, 2),
            "risk_flags": risk_flags,
            "raw_data": {"method": "heuristic_dual_score", "risk_flags": risk_flags},
        }

    async def close(self):
        await self.client.aclose()


scoring_service = ScoringService()
