from datetime import datetime
from typing import Optional
from uuid import UUID
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.models import Developer, RugHistory, Token
from app.utils.logging_config import logger


class DeveloperIntelligence:
    @staticmethod
    async def get_or_create_developer(
        db: AsyncSession, wallet_address: str, chain: str
    ) -> Developer:
        result = await db.execute(
            select(Developer).where(Developer.wallet_address == wallet_address)
        )
        dev = result.scalar_one_or_none()

        if not dev:
            dev = Developer(
                wallet_address=wallet_address,
                chain=chain,
                first_seen_at=datetime.utcnow(),
            )
            db.add(dev)
            await db.flush()
            await db.refresh(dev)

        return dev

    @staticmethod
    async def compute_dev_risk_index(db: AsyncSession, developer: Developer) -> float:
        rug_result = await db.execute(
            select(func.count(RugHistory.id)).where(
                RugHistory.developer_id == developer.id
            )
        )
        total_rugs = rug_result.scalar() or 0

        token_result = await db.execute(
            select(func.count(Token.id)).where(
                Token.deployer_wallet == developer.wallet_address
            )
        )
        total_tokens = token_result.scalar() or 0

        developer.total_rugs = total_rugs
        developer.total_tokens_launched = total_tokens

        if total_tokens == 0:
            developer.rug_percentage = 0
            developer.dev_risk_index = 50.0
            return 50.0

        rug_pct = (total_rugs / total_tokens) * 100
        developer.rug_percentage = rug_pct

        risk = 0.0
        risk += min(rug_pct * 0.6, 60)

        if developer.wallet_age_days < 30:
            risk += 15
        elif developer.wallet_age_days < 90:
            risk += 8
        elif developer.wallet_age_days < 365:
            risk += 3

        if total_tokens > 10:
            risk += min((total_tokens - 10) * 0.5, 10)

        avg_rug_result = await db.execute(
            select(func.avg(RugHistory.time_to_rug_hours)).where(
                RugHistory.developer_id == developer.id
            )
        )
        avg_time = avg_rug_result.scalar()
        if avg_time is not None:
            developer.avg_time_to_rug_hours = avg_time
            if avg_time < 1:
                risk += 15
            elif avg_time < 6:
                risk += 10
            elif avg_time < 24:
                risk += 5

        risk = max(0, min(100, risk))
        developer.dev_risk_index = risk

        await db.flush()
        logger.info(
            f"[DevIntel] Wallet {developer.wallet_address}: "
            f"risk={risk:.1f}, rugs={total_rugs}/{total_tokens}"
        )
        return risk

    @staticmethod
    async def record_rug(
        db: AsyncSession,
        developer: Developer,
        token_address: str,
        chain: str,
        rug_type: str = "liquidity_pull",
        liquidity_removed: float = 0,
        time_to_rug_hours: float = None,
        peak_mcap: float = 0,
        holder_count: int = 0,
    ) -> RugHistory:
        rug = RugHistory(
            token_address=token_address,
            chain=chain,
            developer_id=developer.id,
            developer_wallet=developer.wallet_address,
            rug_type=rug_type,
            liquidity_removed_usd=liquidity_removed,
            time_to_rug_hours=time_to_rug_hours,
            peak_market_cap_usd=peak_mcap,
            holder_count_at_rug=holder_count,
        )
        db.add(rug)
        await db.flush()

        await DeveloperIntelligence.compute_dev_risk_index(db, developer)
        return rug

    @staticmethod
    async def get_developer_profile(
        db: AsyncSession, wallet_address: str
    ) -> Optional[dict]:
        result = await db.execute(
            select(Developer).where(Developer.wallet_address == wallet_address)
        )
        dev = result.scalar_one_or_none()
        if not dev:
            return None

        return {
            "wallet_address": dev.wallet_address,
            "chain": dev.chain,
            "wallet_age_days": dev.wallet_age_days,
            "total_tokens_launched": dev.total_tokens_launched,
            "total_rugs": dev.total_rugs,
            "rug_percentage": dev.rug_percentage,
            "avg_time_to_rug_hours": dev.avg_time_to_rug_hours,
            "dev_risk_index": dev.dev_risk_index,
            "linked_wallets": dev.linked_wallets,
            "first_seen": str(dev.first_seen_at),
        }


developer_intelligence = DeveloperIntelligence()
