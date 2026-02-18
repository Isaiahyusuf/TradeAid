from fastapi import APIRouter, Depends, Query
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.models import Token, LiquidityEvent, User
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/api/tokens", tags=["Tokens"])


@router.get("")
async def list_tokens(
    chain: Optional[str] = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    sort_by: str = "created_at",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = select(Token).order_by(Token.created_at.desc())
    if chain:
        query = query.where(Token.chain == chain)
    query = query.limit(limit).offset(offset)

    result = await db.execute(query)
    tokens = result.scalars().all()

    return {
        "tokens": [
            {
                "id": str(t.id),
                "contract_address": t.contract_address,
                "chain": t.chain,
                "name": t.name,
                "symbol": t.symbol,
                "market_cap_usd": t.market_cap_usd,
                "liquidity_usd": t.liquidity_usd,
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


@router.get("/{chain}/{contract_address}")
async def get_token(
    chain: str,
    contract_address: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Token).where(
            Token.chain == chain,
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


@router.get("/stats/overview")
async def token_stats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    total = await db.execute(select(func.count(Token.id)))
    by_chain = await db.execute(
        select(Token.chain, func.count(Token.id)).group_by(Token.chain)
    )

    return {
        "total_tokens": total.scalar() or 0,
        "by_chain": {row[0]: row[1] for row in by_chain.all()},
    }
