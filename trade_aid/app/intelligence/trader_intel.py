from datetime import datetime
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.models import Trader
from app.utils.logging_config import logger


class TraderIntelligence:
    @staticmethod
    async def get_or_create_trader(
        db: AsyncSession, wallet_address: str, chain: str
    ) -> Trader:
        result = await db.execute(
            select(Trader).where(Trader.wallet_address == wallet_address)
        )
        trader = result.scalar_one_or_none()

        if not trader:
            trader = Trader(
                wallet_address=wallet_address,
                chain=chain,
                first_seen_at=datetime.utcnow(),
            )
            db.add(trader)
            await db.flush()
            await db.refresh(trader)

        return trader

    @staticmethod
    async def compute_trader_risk_index(db: AsyncSession, trader: Trader) -> float:
        risk = 50.0

        if trader.wallet_age_days < 7:
            risk += 20
        elif trader.wallet_age_days < 30:
            risk += 10
        elif trader.wallet_age_days > 365:
            risk -= 10

        if trader.total_trades > 0:
            win_rate = (trader.profitable_trades / trader.total_trades) * 100
            trader.win_rate = win_rate

            if win_rate > 80:
                risk -= 15
                trader.is_smart_wallet = True
            elif win_rate > 60:
                risk -= 5
            elif win_rate < 30:
                risk += 15

        if trader.avg_hold_time_hours is not None:
            if trader.avg_hold_time_hours < 0.5:
                risk += 10
            elif trader.avg_hold_time_hours < 1:
                risk += 5
            elif trader.avg_hold_time_hours > 48:
                risk -= 5

        if trader.total_volume_usd > 100000:
            risk -= 5

        if trader.pnl_usd < -10000:
            risk += 10
        elif trader.pnl_usd > 50000:
            risk -= 10

        risk = max(0, min(100, risk))
        trader.trader_risk_index = risk

        await db.flush()
        logger.info(
            f"[TraderIntel] Wallet {trader.wallet_address}: "
            f"risk={risk:.1f}, trades={trader.total_trades}"
        )
        return risk

    @staticmethod
    async def update_trade_stats(
        db: AsyncSession,
        trader: Trader,
        profitable: bool,
        volume_usd: float,
        pnl_usd: float,
        hold_time_hours: float,
    ):
        trader.total_trades += 1
        if profitable:
            trader.profitable_trades += 1
        trader.total_volume_usd += volume_usd
        trader.pnl_usd += pnl_usd

        if trader.avg_hold_time_hours:
            trader.avg_hold_time_hours = (
                (trader.avg_hold_time_hours * (trader.total_trades - 1) + hold_time_hours)
                / trader.total_trades
            )
        else:
            trader.avg_hold_time_hours = hold_time_hours

        trader.updated_at = datetime.utcnow()
        await TraderIntelligence.compute_trader_risk_index(db, trader)

    @staticmethod
    async def get_trader_profile(
        db: AsyncSession, wallet_address: str
    ) -> Optional[dict]:
        result = await db.execute(
            select(Trader).where(Trader.wallet_address == wallet_address)
        )
        trader = result.scalar_one_or_none()
        if not trader:
            return None

        return {
            "wallet_address": trader.wallet_address,
            "chain": trader.chain,
            "wallet_age_days": trader.wallet_age_days,
            "total_trades": trader.total_trades,
            "profitable_trades": trader.profitable_trades,
            "win_rate": trader.win_rate,
            "avg_hold_time_hours": trader.avg_hold_time_hours,
            "trader_risk_index": trader.trader_risk_index,
            "is_smart_wallet": trader.is_smart_wallet,
            "total_volume_usd": trader.total_volume_usd,
            "pnl_usd": trader.pnl_usd,
            "first_seen": str(trader.first_seen_at),
        }


trader_intelligence = TraderIntelligence()
