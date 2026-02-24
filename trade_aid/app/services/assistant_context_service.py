from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import AssistantTrade, ScoringHistory


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def _compute_confidence_calibration(
    recent_trades_rows: list[AssistantTrade],
    *,
    now: datetime,
    half_life_days: float = 7.0,
) -> dict[str, Any]:
    by_chain_raw: dict[str, dict[str, float]] = {}
    normalized_half_life = _clamp(float(half_life_days or 7.0), 1.0, 45.0)

    for row in recent_trades_rows:
        chain_name = str(row.chain or "unknown").lower()
        bucket = by_chain_raw.setdefault(
            chain_name,
            {
                "trades": 0,
                "wins": 0,
                "losses": 0,
                "weighted_trade_mass": 0.0,
                "weighted_wins": 0.0,
                "weighted_losses": 0.0,
                "pnl_usd": 0.0,
                "notional_usd": 0.0,
                "weighted_pnl_usd": 0.0,
                "weighted_notional_usd": 0.0,
            },
        )

        pnl_val = float(row.pnl_usd or 0.0)
        notional_val = float(row.notional_usd or 0.0)
        created_at = row.created_at or now
        age_seconds = max(0.0, (now - created_at).total_seconds())
        age_days = age_seconds / 86400.0
        recency_weight = 0.5 ** (age_days / normalized_half_life)
        recency_weight = _clamp(recency_weight, 0.03, 1.0)

        bucket["trades"] += 1
        if pnl_val > 0:
            bucket["wins"] += 1
            bucket["weighted_wins"] += recency_weight
        elif pnl_val < 0:
            bucket["losses"] += 1
            bucket["weighted_losses"] += recency_weight
        bucket["weighted_trade_mass"] += recency_weight
        bucket["pnl_usd"] += pnl_val
        bucket["notional_usd"] += notional_val
        bucket["weighted_pnl_usd"] += pnl_val * recency_weight
        bucket["weighted_notional_usd"] += notional_val * recency_weight

    by_chain: dict[str, Any] = {}
    weighted_bias_numerator = 0.0
    weighted_bias_denominator = 0.0

    for chain_name, raw in by_chain_raw.items():
        trades = int(raw["trades"])
        wins = int(raw["wins"])
        losses = int(raw["losses"])
        weighted_trade_mass = float(raw["weighted_trade_mass"])
        weighted_wins = float(raw["weighted_wins"])
        weighted_losses = float(raw["weighted_losses"])
        pnl_usd = float(raw["pnl_usd"])
        weighted_pnl_usd = float(raw["weighted_pnl_usd"])
        weighted_notional_usd = float(raw["weighted_notional_usd"])
        effective_weighted_trades = max(weighted_trade_mass, 1e-6)

        win_rate = weighted_wins / effective_weighted_trades
        weighted_loss_rate = weighted_losses / effective_weighted_trades
        pnl_per_trade = weighted_pnl_usd / effective_weighted_trades
        pnl_yield = (weighted_pnl_usd / weighted_notional_usd) if weighted_notional_usd > 0 else 0.0

        sample_weight = _clamp(weighted_trade_mass / 18.0, 0.2, 1.0)
        base_bias = ((win_rate - 0.5) * 20.0) + (pnl_yield * 120.0) - (weighted_loss_rate * 6.0)
        confidence_bias = _clamp(base_bias * sample_weight, -18.0, 18.0)

        if confidence_bias >= 6:
            status = "outperforming"
        elif confidence_bias <= -6:
            status = "underperforming"
        else:
            status = "neutral"

        by_chain[chain_name] = {
            "trades": trades,
            "wins": wins,
            "losses": losses,
            "win_rate": round(win_rate, 4),
            "pnl_usd": round(pnl_usd, 4),
            "weighted_pnl_usd": round(weighted_pnl_usd, 4),
            "pnl_per_trade_usd": round(pnl_per_trade, 4),
            "pnl_yield": round(pnl_yield, 6),
            "sample_weight": round(sample_weight, 4),
            "weighted_trade_mass": round(weighted_trade_mass, 4),
            "confidence_bias": round(confidence_bias, 4),
            "status": status,
        }

        weighted_bias_numerator += confidence_bias * max(weighted_trade_mass, 1e-6)
        weighted_bias_denominator += max(weighted_trade_mass, 1e-6)

    global_bias = weighted_bias_numerator / weighted_bias_denominator if weighted_bias_denominator > 0 else 0.0

    return {
        "mode": "exp_recency_decay",
        "half_life_days": round(normalized_half_life, 2),
        "global_bias": round(global_bias, 4),
        "by_chain": by_chain,
        "lookback_trades": len(recent_trades_rows),
        "generated_at": now.isoformat(),
    }


async def build_user_trading_context(
    db: AsyncSession,
    user_id: UUID,
    *,
    days: int = 30,
    recent_trade_limit: int = 25,
    recent_score_limit: int = 40,
) -> dict[str, Any]:
    window_days = max(1, min(days, 365))
    since = datetime.utcnow() - timedelta(days=window_days)

    chain_stats_result = await db.execute(
        select(
            AssistantTrade.chain,
            func.count(AssistantTrade.id),
            func.coalesce(func.sum(AssistantTrade.notional_usd), 0.0),
            func.coalesce(func.sum(AssistantTrade.pnl_usd), 0.0),
        )
        .where(
            AssistantTrade.user_id == user_id,
            AssistantTrade.created_at >= since,
        )
        .group_by(AssistantTrade.chain)
    )

    chain_stats: dict[str, Any] = {}
    total_trades = 0
    total_notional = 0.0
    total_pnl = 0.0

    for chain, trade_count, notional_sum, pnl_sum in chain_stats_result.all():
        chain_name = str(chain or "unknown").lower()
        count_val = int(trade_count or 0)
        notional_val = float(notional_sum or 0.0)
        pnl_val = float(pnl_sum or 0.0)
        chain_stats[chain_name] = {
            "trades": count_val,
            "notional_usd": round(notional_val, 4),
            "pnl_usd": round(pnl_val, 4),
        }
        total_trades += count_val
        total_notional += notional_val
        total_pnl += pnl_val

    recent_trades_result = await db.execute(
        select(AssistantTrade)
        .where(
            AssistantTrade.user_id == user_id,
            AssistantTrade.created_at >= since,
        )
        .order_by(AssistantTrade.created_at.desc())
        .limit(max(1, min(recent_trade_limit, 100)))
    )
    recent_trades_rows = recent_trades_result.scalars().all()

    recent_trades = [
        {
            "id": str(row.id),
            "chain": row.chain,
            "contract_address": row.contract_address,
            "side": row.side,
            "mode": row.mode,
            "status": row.status,
            "notional_usd": float(row.notional_usd or 0.0),
            "price_usd": float(row.price_usd or 0.0) if row.price_usd is not None else None,
            "fees_usd": float(row.fees_usd or 0.0),
            "pnl_usd": float(row.pnl_usd or 0.0),
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in recent_trades_rows
    ]

    confidence_calibration = _compute_confidence_calibration(
        recent_trades_rows,
        now=datetime.utcnow(),
    )

    recent_scores_rows: list[ScoringHistory] = []
    recent_trade_contracts = [str(row.contract_address or "").strip() for row in recent_trades_rows if str(row.contract_address or "").strip()]
    recent_trade_chains = [str(row.chain or "").strip().lower() for row in recent_trades_rows if str(row.chain or "").strip()]
    score_limit = max(1, min(recent_score_limit, 200))
    if recent_trade_contracts and recent_trade_chains:
        recent_scores_result = await db.execute(
            select(ScoringHistory)
            .where(
                ScoringHistory.scored_at >= since,
                ScoringHistory.contract_address.in_(recent_trade_contracts),
                ScoringHistory.chain.in_(recent_trade_chains),
            )
            .order_by(ScoringHistory.scored_at.desc())
            .limit(score_limit)
        )
        recent_scores_rows = recent_scores_result.scalars().all()

    scores_by_chain: dict[str, dict[str, float]] = {}
    for row in recent_scores_rows:
        chain_name = str(row.chain or "unknown").lower()
        bucket = scores_by_chain.setdefault(
            chain_name,
            {
                "count": 0,
                "avg_confidence": 0.0,
                "avg_rug_probability": 0.0,
            },
        )
        bucket["count"] += 1
        bucket["avg_confidence"] += float(row.trade_confidence_index or 0.0)
        bucket["avg_rug_probability"] += float(row.rug_probability or 0.0)

    for bucket in scores_by_chain.values():
        count_val = max(int(bucket["count"]), 1)
        bucket["avg_confidence"] = round(bucket["avg_confidence"] / count_val, 4)
        bucket["avg_rug_probability"] = round(bucket["avg_rug_probability"] / count_val, 4)

    return {
        "window_days": window_days,
        "summary": {
            "total_trades": total_trades,
            "total_notional_usd": round(total_notional, 4),
            "total_pnl_usd": round(total_pnl, 4),
            "chain_count": len(chain_stats),
        },
        "chain_stats": chain_stats,
        "recent_trades": recent_trades,
        "market_scores": {
            "by_chain": scores_by_chain,
            "samples": len(recent_scores_rows),
        },
        "confidence_calibration": confidence_calibration,
    }