import asyncio
from fastapi import APIRouter, Depends, Query, HTTPException
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.models import Token, LiquidityEvent, ScoringHistory, User
from app.services.auth_service import get_current_user
from app.scoring.scoring_service import scoring_service

router = APIRouter(prefix="/api/tokens", tags=["Tokens"])


@router.get("")
async def list_tokens(
    chain: Optional[str] = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    sort_by: str = "created_at",
    new_only: bool = False,
    max_age_hours: int = Query(default=24, ge=1, le=168),
    min_age_minutes: Optional[int] = Query(default=None, ge=0, le=10080),
    max_age_minutes: Optional[int] = Query(default=None, ge=1, le=10080),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    selected_chain = (chain or "solana").lower()
    if selected_chain != "solana":
        raise HTTPException(status_code=400, detail="Only Solana integration is supported")

    query = select(Token).order_by(Token.created_at.desc())
    query = query.where(Token.chain == "solana")

    if min_age_minutes is not None and max_age_minutes is not None and min_age_minutes >= max_age_minutes:
        raise HTTPException(status_code=400, detail="min_age_minutes must be less than max_age_minutes")

    now = datetime.utcnow()

    if min_age_minutes is not None:
        newer_than = now - timedelta(minutes=min_age_minutes)
        query = query.where(Token.created_at <= newer_than)

    if max_age_minutes is not None:
        older_than = now - timedelta(minutes=max_age_minutes)
        query = query.where(Token.created_at > older_than)

    if new_only:
        cutoff = now - timedelta(hours=max_age_hours)
        query = query.where(Token.created_at >= cutoff)
    query = query.limit(limit).offset(offset)

    result = await db.execute(query)
    tokens = result.scalars().all()

    def build_latest_scores(score_rows: list[ScoringHistory]) -> dict[str, ScoringHistory]:
        latest: dict[str, ScoringHistory] = {}
        for row in score_rows:
            token_id = str(row.token_id)
            if token_id not in latest:
                latest[token_id] = row
        return latest

    latest_scores: dict[str, ScoringHistory] = {}
    token_ids = [t.id for t in tokens]
    if token_ids:
        scores_result = await db.execute(
            select(ScoringHistory)
            .where(ScoringHistory.token_id.in_(token_ids))
            .order_by(ScoringHistory.token_id, ScoringHistory.scored_at.desc())
        )
        latest_scores = build_latest_scores(scores_result.scalars().all())

        missing_tokens = [t for t in tokens if str(t.id) not in latest_scores]
        if offset == 0 and missing_tokens:
            for token in missing_tokens[:5]:
                try:
                    await asyncio.wait_for(
                        scoring_service.score_token(db, token.contract_address, "solana"),
                        timeout=6,
                    )
                except Exception:
                    continue

            await db.commit()
            refreshed_scores_result = await db.execute(
                select(ScoringHistory)
                .where(ScoringHistory.token_id.in_(token_ids))
                .order_by(ScoringHistory.token_id, ScoringHistory.scored_at.desc())
            )
            latest_scores = build_latest_scores(refreshed_scores_result.scalars().all())

    return {
        "tokens": [
            {
                "latest_score": (
                    {
                        "rug_probability": latest_scores[str(t.id)].rug_probability,
                        "liquidity_stability": latest_scores[str(t.id)].liquidity_stability,
                        "holder_distribution": latest_scores[str(t.id)].holder_distribution,
                        "smart_wallet_signal": latest_scores[str(t.id)].smart_wallet_signal,
                        "trade_confidence_index": latest_scores[str(t.id)].trade_confidence_index,
                        "eligible": latest_scores[str(t.id)].eligible,
                        "scored_at": str(latest_scores[str(t.id)].scored_at),
                    }
                    if str(t.id) in latest_scores
                    else None
                ),
                "id": str(t.id),
                "contract_address": t.contract_address,
                "chain": t.chain,
                "name": t.name,
                "symbol": t.symbol,
                "current_price_usd": float((t.extra_data or {}).get("price_usd", 0) or 0),
                "market_cap_usd": t.market_cap_usd,
                "liquidity_usd": t.liquidity_usd,
                "volume_5m": float((t.extra_data or {}).get("volume_5m", 0) or 0),
                "volume_1h": float((t.extra_data or {}).get("volume_1h", 0) or 0),
                "volume_6h": float((t.extra_data or {}).get("volume_6h", 0) or 0),
                "price_change_5m": float((t.extra_data or {}).get("price_change_5m", 0) or 0),
                "price_change_1h": float((t.extra_data or {}).get("price_change_1h", 0) or 0),
                "price_change_6h": float((t.extra_data or {}).get("price_change_6h", 0) or 0),
                "buys_1h": int((t.extra_data or {}).get("buys_1h", 0) or 0),
                "sells_1h": int((t.extra_data or {}).get("sells_1h", 0) or 0),
                "new_wallets_count": int((t.extra_data or {}).get("new_wallets_count", 0) or 0),
                "top_holders_pct": None,
                "dev_wallet_pct": None,
                "logo_url": (t.extra_data or {}).get("logo_url"),
                "is_pump_fun": bool((t.extra_data or {}).get("is_pump_fun", False)),
                "source_platform": (t.extra_data or {}).get("source_platform") or t.dex_id,
                "buy_urls": (t.extra_data or {}).get("buy_urls") or {
                    "pump_fun": f"https://pump.fun/coin/{t.contract_address}",
                    "axiom": f"https://axiom.trade/t/{t.contract_address}",
                    "gmgn": f"https://gmgn.ai/sol/token/{t.contract_address}",
                },
                "holder_count": t.holder_count,
                "is_mintable": t.is_mintable,
                "is_ownership_renounced": t.is_ownership_renounced,
                "dex_id": t.dex_id,
                "created_at": str(t.created_at),
            }
            for t in tokens
        ],
        "count": len(tokens),
    }


@router.get("/stats/overview")
async def token_stats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    total = await db.execute(select(func.count(Token.id)).where(Token.chain == "solana"))
    by_chain = await db.execute(
        select(Token.chain, func.count(Token.id)).where(Token.chain == "solana").group_by(Token.chain)
    )

    return {
        "total_tokens": total.scalar() or 0,
        "by_chain": {row[0]: row[1] for row in by_chain.all()},
    }


@router.get("/{chain}/{contract_address}")
async def get_token(
    chain: str,
    contract_address: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if chain.lower() != "solana":
        raise HTTPException(status_code=400, detail="Only Solana integration is supported")

    result = await db.execute(
        select(Token).where(
            Token.chain == "solana",
            Token.contract_address == contract_address,
        )
    )
    token = result.scalar_one_or_none()
    if not token:
        return {"error": "Token not found"}

    events_result = await db.execute(
        select(LiquidityEvent)
        .where(LiquidityEvent.token_id == token.id)
        .order_by(LiquidityEvent.detected_at.desc())
        .limit(20)
    )
    events = events_result.scalars().all()

    return {
        "token": {
            "id": str(token.id),
            "contract_address": token.contract_address,
            "chain": token.chain,
            "name": token.name,
            "symbol": token.symbol,
            "market_cap_usd": token.market_cap_usd,
            "liquidity_usd": token.liquidity_usd,
            "holder_count": token.holder_count,
            "is_mintable": token.is_mintable,
            "is_ownership_renounced": token.is_ownership_renounced,
            "pair_address": token.pair_address,
            "dex_id": token.dex_id,
            "deployer_wallet": token.deployer_wallet,
            "liquidity_created_at": str(token.liquidity_created_at) if token.liquidity_created_at else None,
            "created_at": str(token.created_at),
        },
        "liquidity_events": [
            {
                "event_type": e.event_type,
                "liquidity_usd": e.liquidity_usd,
                "liquidity_change_pct": e.liquidity_change_pct,
                "detected_at": str(e.detected_at),
            }
            for e in events
        ],
    }
