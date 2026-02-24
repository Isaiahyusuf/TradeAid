from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Alert, LiquidityEvent, ScoringHistory, Token
from app.services.ai_safety_engine import score_safe_buy_with_ai
from app.utils.redis_client import cache_get, cache_set, publish_event


class SafeBuyService:
    SAFE_BUY_MIN_SCORE = 20.0
    NEAR_MISS_MIN_SCORE = 15.0
    PROJECT_TTL_HOURS = 24
    MIN_LIQUIDITY_USD = 1_000.0
    MIN_ACTIVE_VOLUME_5M = 150.0
    MIN_ACTIVE_VOLUME_1H = 1_000.0

    def _compute_dynamic_thresholds(self, scores: list[float]) -> tuple[float, float]:
        return self.SAFE_BUY_MIN_SCORE, self.NEAR_MISS_MIN_SCORE

    async def purge_expired_projects(self, db: AsyncSession) -> int:
        now = datetime.utcnow()
        cutoff = now - timedelta(hours=self.PROJECT_TTL_HOURS)
        launch_ts = func.coalesce(Token.liquidity_created_at, Token.created_at)

        stale_ids_result = await db.execute(
            select(Token.id)
            .where(launch_ts < cutoff)
            .limit(5000)
        )
        stale_ids = list(stale_ids_result.scalars().all())
        if not stale_ids:
            return 0

        await db.execute(delete(ScoringHistory).where(ScoringHistory.token_id.in_(stale_ids)))
        await db.execute(delete(LiquidityEvent).where(LiquidityEvent.token_id.in_(stale_ids)))
        await db.execute(delete(Alert).where(Alert.token_id.in_(stale_ids)))
        await db.execute(delete(Token).where(Token.id.in_(stale_ids)))
        await db.flush()
        return len(stale_ids)

    def _estimate_top_holders_pct(self, token: Token, latest_score: ScoringHistory | None) -> float:
        extra = token.extra_data or {}
        explicit = extra.get("top_holders_pct")
        if explicit is not None:
            return float(explicit)
        holder_distribution_score = float(latest_score.holder_distribution if latest_score else 45)
        return max(18.0, min(58.0, 62.0 - (holder_distribution_score * 0.35)))

    def _estimate_dev_wallet_pct(self, token: Token, latest_score: ScoringHistory | None) -> float:
        extra = token.extra_data or {}
        explicit = extra.get("dev_wallet_pct")
        if explicit is not None:
            return float(explicit)
        if token.is_ownership_renounced:
            return 3.8
        rug = float(latest_score.rug_probability if latest_score else 55)
        return max(2.0, min(12.0, 4.0 + (rug * 0.05)))

    async def _has_recent_liquidity_removal(self, db: AsyncSession, token_id: Any, within_minutes: int = 30) -> bool:
        cutoff = datetime.utcnow() - timedelta(minutes=within_minutes)
        result = await db.execute(
            select(LiquidityEvent)
            .where(
                LiquidityEvent.token_id == token_id,
                LiquidityEvent.event_type == "liquidity_removal",
                LiquidityEvent.detected_at >= cutoff,
            )
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    def _build_ai_payload(
        self,
        token: Token,
        latest_score: ScoringHistory | None,
        top_holders_pct: float,
        dev_wallet_pct: float,
    ) -> dict[str, Any]:
        extra = token.extra_data or {}
        volume_5m = float(extra.get("volume_5m", 0) or 0)
        volume_1h = float(extra.get("volume_1h", 0) or 0)
        buys_1h = int(extra.get("buys_1h", 0) or 0)
        sells_1h = int(extra.get("sells_1h", 0) or 0)
        new_wallets_count = int(extra.get("new_wallets_count", 0) or 0)

        buy_sell_ratio = (buys_1h + 1) / (sells_1h + 1)
        holder_distribution_score = float(latest_score.holder_distribution if latest_score else 45)
        dev_history_score = max(0.0, min(100.0, 100.0 - float(latest_score.rug_probability if latest_score else 55)))
        whale_activity = float(latest_score.smart_wallet_signal if latest_score else 30)

        return {
            "marketCap": float(token.market_cap_usd or 0),
            "liquidity": float(token.liquidity_usd or 0),
            "volume5m": volume_5m,
            "volume1h": volume_1h,
            "buySellRatio": round(buy_sell_ratio, 4),
            "holderDistribution": round(holder_distribution_score, 2),
            "devWalletPercent": round(dev_wallet_pct, 2),
            "devHistoryScore": round(dev_history_score, 2),
            "whaleActivity": round(whale_activity, 2),
            "walletGrowthRate": float(new_wallets_count),
            "topHoldersPct": round(top_holders_pct, 2),
        }

    async def list_safe_buy_tokens(
        self,
        db: AsyncSession,
        limit: int = 20,
        chains: list[str] | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        now = datetime.utcnow()
        launch_cutoff = now - timedelta(hours=self.PROJECT_TTL_HOURS)
        launch_ts = func.coalesce(Token.liquidity_created_at, Token.created_at)

        await self.purge_expired_projects(db)

        query = (
            select(Token)
            .where(
                launch_ts >= launch_cutoff,
                Token.liquidity_usd >= self.MIN_LIQUIDITY_USD,
            )
            .order_by(launch_ts.desc())
            .limit(450)
        )
        if chains:
            query = query.where(Token.chain.in_(chains))

        token_result = await db.execute(query)
        tokens = token_result.scalars().all()

        token_ids = [t.id for t in tokens]
        latest_scores: dict[str, ScoringHistory] = {}
        if token_ids:
            score_result = await db.execute(
                select(ScoringHistory)
                .where(ScoringHistory.token_id.in_(token_ids))
                .order_by(ScoringHistory.token_id, ScoringHistory.scored_at.desc())
            )
            for row in score_result.scalars().all():
                key = str(row.token_id)
                if key not in latest_scores:
                    latest_scores[key] = row

        score_cache_key = "safe_buy:scores"
        previous_scores = await cache_get(score_cache_key) or {}
        current_scores: dict[str, float] = {}

        scored_candidates: list[dict[str, Any]] = []
        safe_candidates: list[dict[str, Any]] = []
        near_miss_candidates: list[dict[str, Any]] = []

        for token in tokens:
            latest_score = latest_scores.get(str(token.id))
            extra = token.extra_data or {}

            market_cap = float(token.market_cap_usd or 0)
            liquidity = float(token.liquidity_usd or 0)
            volume_5m = float(extra.get("volume_5m", 0) or 0)
            volume_1h = float(extra.get("volume_1h", 0) or 0)
            buys_5m = int(extra.get("buys_5m", 0) or 0)
            sells_5m = int(extra.get("sells_5m", 0) or 0)
            buys_1h = int(extra.get("buys_1h", 0) or 0)
            sells_1h = int(extra.get("sells_1h", 0) or 0)
            new_wallets_count = int(extra.get("new_wallets_count", 0) or 0)

            if market_cap < 10000 or market_cap > 750000:
                continue

            if liquidity < self.MIN_LIQUIDITY_USD:
                continue

            has_active_volume = volume_5m >= self.MIN_ACTIVE_VOLUME_5M or volume_1h >= self.MIN_ACTIVE_VOLUME_1H
            if not has_active_volume:
                continue

            liq_ratio = (liquidity / market_cap) if market_cap > 0 else 0
            if liq_ratio < 0.12:
                continue

            if await self._has_recent_liquidity_removal(db, token.id, within_minutes=30):
                continue

            if volume_5m < 750:
                continue

            if sells_1h > (buys_1h * 1.35):
                continue

            vol_liq_ratio = ((volume_5m + volume_1h) / max(liquidity, 1))
            if vol_liq_ratio > 3.8:
                continue

            top_holders_pct = self._estimate_top_holders_pct(token, latest_score)
            largest_wallet_pct = top_holders_pct * 0.28
            dev_wallet_pct = self._estimate_dev_wallet_pct(token, latest_score)
            suspicious_cluster_flag = bool((latest_score and latest_score.smart_wallet_signal < 15 and sells_1h > buys_1h) or (buys_5m > 140 and volume_5m < 900))

            if top_holders_pct > 55:
                continue
            if largest_wallet_pct > 10:
                continue
            if dev_wallet_pct > 12:
                continue
            if suspicious_cluster_flag:
                continue

            dev_history_score = max(0.0, min(100.0, 100.0 - float(latest_score.rug_probability if latest_score else 55)))
            if dev_history_score < 35:
                continue

            unique_buyers = max(new_wallets_count, buys_5m)
            if unique_buyers < 1:
                continue
            if buys_5m > 120 and volume_5m < 900:
                continue

            ai_payload = self._build_ai_payload(token, latest_score, top_holders_pct, dev_wallet_pct)
            ai_result = await score_safe_buy_with_ai(ai_payload)

            safety_score = float(ai_result.get("safety_score", 0) or 0)
            risk_level = str(ai_result.get("risk_level", "High") or "High").title()

            if risk_level == "High" and safety_score < 45:
                continue

            contract = token.contract_address
            old_score = float(previous_scores.get(contract, 0) or 0)
            trend = "up" if safety_score > old_score + 1 else "down" if safety_score < old_score - 1 else "flat"
            current_scores[contract] = safety_score

            recently_added = contract not in previous_scores

            if recently_added:
                try:
                    await publish_event(
                        "alerts",
                        {
                            "type": "safe_buy_update",
                            "chain": token.chain,
                            "contract": contract,
                            "symbol": token.symbol,
                            "safety_score": safety_score,
                        },
                    )
                except Exception:
                    pass

            token_payload = {
                "id": str(token.id),
                "contract_address": contract,
                "chain": token.chain,
                "name": token.name,
                "symbol": token.symbol,
                "market_cap_usd": market_cap,
                "liquidity_usd": liquidity,
                "volume_5m": volume_5m,
                "volume_1h": volume_1h,
                "holder_count": int(token.holder_count or 0),
                "buy_sell_ratio": round((buys_1h + 1) / (sells_1h + 1), 4),
                "top_holders_pct": round(top_holders_pct, 2),
                "dev_wallet_pct": round(dev_wallet_pct, 2),
                "wallet_growth_rate": float(new_wallets_count),
                "logo_url": extra.get("logo_url"),
                "is_pump_fun": bool(getattr(token, "is_pump_fun", False) or extra.get("is_pump_fun", False)),
                "safety_score": round(safety_score, 2),
                "risk_level": risk_level,
                "short_summary": str(ai_result.get("short_summary", "")),
                "recommendation": str(ai_result.get("recommendation", "Monitor")),
                "confidence_score": float(ai_result.get("confidence_score", 0) or 0),
                "ai_source": ai_result.get("source", "fallback"),
                "trend": trend,
                "recently_added": recently_added,
                "source_platform": (extra.get("source_platform") or token.dex_id or "dexscreener"),
                "buy_links": {
                    "pump_fun": f"https://pump.fun/coin/{contract}",
                    "raydium": f"https://raydium.io/swap/?inputMint=sol&outputMint={contract}" if token.chain == "solana" else f"https://dexscreener.com/{token.chain}/{contract}",
                    "jupiter": f"https://jup.ag/swap/SOL-{contract}" if token.chain == "solana" else f"https://dexscreener.com/{token.chain}/{contract}",
                    "dexscreener": f"https://dexscreener.com/{token.chain}/{contract}",
                },
                "created_at": str(token.created_at),
            }

            scored_candidates.append(token_payload)

        dynamic_safe_min, dynamic_near_min = self._compute_dynamic_thresholds(
            [float(row.get("safety_score", 0) or 0) for row in scored_candidates]
        )

        for row in scored_candidates:
            score_val = float(row.get("safety_score", 0) or 0)
            if score_val >= dynamic_safe_min:
                safe_candidates.append(row)
            elif dynamic_near_min <= score_val < dynamic_safe_min:
                near_miss_candidates.append(row)

        safe_candidates.sort(
            key=lambda row: (
                1 if row.get("is_pump_fun") else 0,
                row["safety_score"],
                row["confidence_score"],
                row.get("volume_5m", 0),
            ),
            reverse=True,
        )
        near_miss_candidates.sort(
            key=lambda row: (
                1 if row.get("is_pump_fun") else 0,
                row["safety_score"],
                row["confidence_score"],
                row.get("volume_5m", 0),
            ),
            reverse=True,
        )

        if not safe_candidates and near_miss_candidates:
            fallback_safe = [
                {
                    **row,
                    "recommendation": "Monitor (Fresh Potential)",
                    "short_summary": row.get("short_summary") or "Strong near-miss candidate promoted due to market scarcity.",
                }
                for row in near_miss_candidates
                if row.get("safety_score", 0) >= 58 and row.get("risk_level") in {"Low", "Medium"}
            ][: max(3, min(limit, 8))]
            safe_candidates.extend(fallback_safe)

        safe_candidates.sort(
            key=lambda row: (
                row.get("created_at", ""),
                1 if row.get("is_pump_fun") else 0,
                row.get("safety_score", 0),
                row.get("confidence_score", 0),
                row.get("volume_5m", 0),
            ),
            reverse=True,
        )
        near_miss_candidates.sort(
            key=lambda row: (
                row.get("created_at", ""),
                1 if row.get("is_pump_fun") else 0,
                row.get("safety_score", 0),
                row.get("confidence_score", 0),
                row.get("volume_5m", 0),
            ),
            reverse=True,
        )

        trimmed = safe_candidates[:limit]
        trimmed_near_miss = near_miss_candidates[:limit]

        trimmed_scores = {row["contract_address"]: row["safety_score"] for row in trimmed}
        await cache_set(score_cache_key, trimmed_scores, ttl=3600)

        return {
            "safe_tokens": trimmed,
            "near_miss_tokens": trimmed_near_miss,
            "thresholds": {
                "safe_buy_min_score": dynamic_safe_min,
                "near_miss_min_score": dynamic_near_min,
            },
            "retention": {
                "max_project_age_hours": self.PROJECT_TTL_HOURS,
            },
        }


safe_buy_service = SafeBuyService()
