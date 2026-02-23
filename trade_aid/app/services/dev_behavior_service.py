from __future__ import annotations

from datetime import datetime, timedelta
from statistics import median
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import RugHistory, Token
from app.utils.launch_identity import build_launch_fingerprint


class DevBehaviorService:
    async def get_dev_token_intel(self, db: AsyncSession, contract_address: str, chain: str = "solana") -> dict[str, Any] | None:
        token_result = await db.execute(
            select(Token).where(Token.chain == chain, Token.contract_address == contract_address)
        )
        token = token_result.scalar_one_or_none()
        if not token:
            return None

        extra = token.extra_data or {}
        websites = extra.get("websites") or []
        socials = extra.get("socials") or []

        launch_fingerprint = extra.get("launch_fingerprint") or build_launch_fingerprint(
            deployer_wallet=token.deployer_wallet,
            token_name=token.name,
            token_symbol=token.symbol,
            dex_id=token.dex_id,
            websites=websites if isinstance(websites, list) else [],
            socials=socials if isinstance(socials, list) else [],
            logo_url=extra.get("logo_url"),
        )

        lookback_cutoff = datetime.utcnow() - timedelta(days=30)
        tokens_result = await db.execute(
            select(Token)
            .where(Token.chain == chain, Token.created_at >= lookback_cutoff)
            .order_by(Token.created_at.desc())
            .limit(1200)
        )
        tokens = tokens_result.scalars().all()

        linked_tokens: list[Token] = []
        token_observers = set(extra.get("observer_fingerprints") or [])
        for row in tokens:
            row_extra = row.extra_data or {}
            row_fingerprint = row_extra.get("launch_fingerprint") or build_launch_fingerprint(
                deployer_wallet=row.deployer_wallet,
                token_name=row.name,
                token_symbol=row.symbol,
                dex_id=row.dex_id,
                websites=row_extra.get("websites") if isinstance(row_extra.get("websites"), list) else [],
                socials=row_extra.get("socials") if isinstance(row_extra.get("socials"), list) else [],
                logo_url=row_extra.get("logo_url"),
            )

            same_wallet = bool(token.deployer_wallet and row.deployer_wallet and token.deployer_wallet == row.deployer_wallet)
            same_fingerprint = bool(launch_fingerprint and row_fingerprint and launch_fingerprint == row_fingerprint)
            row_observers = set(row_extra.get("observer_fingerprints") or [])
            same_observer = bool(token_observers and row_observers and token_observers.intersection(row_observers))
            if same_wallet or same_fingerprint or same_observer or row.contract_address == token.contract_address:
                linked_tokens.append(row)

        linked_contracts = [row.contract_address for row in linked_tokens if row.contract_address]
        linked_wallets = sorted({row.deployer_wallet for row in linked_tokens if row.deployer_wallet})

        rugs_result = await db.execute(
            select(RugHistory)
            .where(RugHistory.chain == chain, RugHistory.token_address.in_(linked_contracts if linked_contracts else [contract_address]))
            .order_by(RugHistory.detected_at.desc())
            .limit(200)
        )
        rugs = rugs_result.scalars().all()

        rug_mc_values = [float(r.peak_market_cap_usd or 0) for r in rugs if float(r.peak_market_cap_usd or 0) > 0]
        rug_mc_median = float(median(rug_mc_values)) if rug_mc_values else 0.0
        rug_mc_avg = float(sum(rug_mc_values) / len(rug_mc_values)) if rug_mc_values else 0.0

        def jeet_score_from_token(row: Token) -> float:
            row_extra = row.extra_data or {}
            buys_5m = float(row_extra.get("buys_5m", 0) or 0)
            sells_5m = float(row_extra.get("sells_5m", 0) or 0)
            buys_1h = float(row_extra.get("buys_1h", 0) or 0)
            sells_1h = float(row_extra.get("sells_1h", 0) or 0)
            s5 = min(100.0, (sells_5m / max(buys_5m + 1.0, 1.0)) * 60.0)
            s1 = min(100.0, (sells_1h / max(buys_1h + 1.0, 1.0)) * 40.0)
            return max(0.0, min(100.0, s5 + s1))

        jeet_scores = [jeet_score_from_token(row) for row in linked_tokens[:80]]
        avg_jeet_score = float(sum(jeet_scores) / len(jeet_scores)) if jeet_scores else 0.0
        high_jeet_count = sum(1 for score in jeet_scores if score >= 65)
        high_jeet_ratio = (high_jeet_count / len(jeet_scores)) if jeet_scores else 0.0

        launch_count = len(linked_tokens)
        rug_count = len(rugs)
        rug_ratio = (rug_count / max(launch_count, 1)) * 100
        rug_dev_flag = rug_count >= 2 and rug_ratio >= 25

        past_launches = [
            {
                "contract_address": row.contract_address,
                "symbol": row.symbol,
                "name": row.name,
                "created_at": str(row.created_at),
                "market_cap_usd": float(row.market_cap_usd or 0),
                "liquidity_usd": float(row.liquidity_usd or 0),
            }
            for row in linked_tokens[:20]
        ]

        return {
            "token": {
                "contract_address": token.contract_address,
                "symbol": token.symbol,
                "name": token.name,
                "deployer_wallet": token.deployer_wallet,
            },
            "identity": {
                "launch_fingerprint": launch_fingerprint,
                "linked_wallet_count": len(linked_wallets),
                "linked_wallets": linked_wallets[:15],
                "link_method": "wallet+launch_fingerprint" if launch_fingerprint else "wallet_only",
                "note": "Fingerprint linking uses launch metadata signatures (domains/socials/branding) and is privacy-safe.",
            },
            "rug_profile": {
                "is_rug_dev": rug_dev_flag,
                "linked_launches": launch_count,
                "linked_rugs": rug_count,
                "rug_ratio_pct": round(rug_ratio, 2),
                "typical_rug_mcap_usd": round(rug_mc_median, 2),
                "average_rug_mcap_usd": round(rug_mc_avg, 2),
            },
            "jeet_checker": {
                "avg_jeet_score": round(avg_jeet_score, 2),
                "high_jeet_ratio_pct": round(high_jeet_ratio * 100, 2),
                "too_many_jeets": high_jeet_ratio >= 0.35,
            },
            "past_launches": past_launches,
            "updated_at": datetime.utcnow().isoformat(),
        }


dev_behavior_service = DevBehaviorService()
