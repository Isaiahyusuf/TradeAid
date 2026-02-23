from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.models import ScoringHistory, Token, User
from app.services.auth_service import get_current_user
from app.scoring.scoring_service import scoring_service
from app.workers.tasks import score_token_task
from app.services.ai_insight_service import generate_ai_insight
from app.utils.telemetry import build_telemetry_fingerprint, get_client_ip

router = APIRouter(prefix="/api/scoring", tags=["Scoring"])


class ScoreRequest(BaseModel):
    contract_address: str
    chain: str


@router.post("/score-token")
async def score_token(
    req: ScoreRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if req.chain.lower() != "solana":
        raise HTTPException(status_code=400, detail="Only Solana integration is supported")

    result = await scoring_service.score_token(db, req.contract_address, req.chain)

    metadata = user.alert_preferences or {}
    privacy = metadata.get("privacy", {})
    telemetry_opt_in = bool(privacy.get("telemetry_opt_in", False))
    if telemetry_opt_in:
        token_result = await db.execute(
            select(Token).where(Token.chain == "solana", Token.contract_address == req.contract_address)
        )
        token = token_result.scalar_one_or_none()
        if token:
            token_meta = dict(token.extra_data or {})
            observer_fingerprints = list(token_meta.get("observer_fingerprints") or [])

            fingerprint = build_telemetry_fingerprint(
                ip=get_client_ip(request),
                user_agent=request.headers.get("user-agent", ""),
                device_id=(user.device_id or request.headers.get("x-device-id", "")),
            )
            if fingerprint and fingerprint not in observer_fingerprints:
                observer_fingerprints.insert(0, fingerprint)
                token_meta["observer_fingerprints"] = observer_fingerprints[:20]
                token.extra_data = token_meta
                await db.flush()

    return result


@router.post("/score-token/async")
async def score_token_async(
    req: ScoreRequest,
    user: User = Depends(get_current_user),
):
    if req.chain.lower() != "solana":
        raise HTTPException(status_code=400, detail="Only Solana integration is supported")

    task = score_token_task.delay(req.contract_address, req.chain)
    return {"task_id": task.id, "status": "queued"}


@router.get("/history/{chain}/{contract_address}")
async def scoring_history(
    chain: str,
    contract_address: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if chain.lower() != "solana":
        raise HTTPException(status_code=400, detail="Only Solana integration is supported")

    result = await db.execute(
        select(ScoringHistory)
        .where(
            ScoringHistory.chain == chain,
            ScoringHistory.contract_address == contract_address,
        )
        .order_by(ScoringHistory.scored_at.desc())
        .limit(limit)
    )
    history = result.scalars().all()

    return {
        "history": [
            {
                "id": str(h.id),
                "rug_probability": h.rug_probability,
                "liquidity_stability": h.liquidity_stability,
                "holder_distribution": h.holder_distribution,
                "smart_wallet_signal": h.smart_wallet_signal,
                "trade_confidence_index": h.trade_confidence_index,
                "eligible": h.eligible,
                "scored_at": str(h.scored_at),
            }
            for h in history
        ],
    }


@router.get("/insight/{chain}/{contract_address}")
async def scoring_insight(
    chain: str,
    contract_address: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if chain.lower() != "solana":
        raise HTTPException(status_code=400, detail="Only Solana integration is supported")

    token_result = await db.execute(
        select(Token).where(Token.chain == "solana", Token.contract_address == contract_address)
    )
    token = token_result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    score_result = await db.execute(
        select(ScoringHistory)
        .where(ScoringHistory.token_id == token.id)
        .order_by(ScoringHistory.scored_at.desc())
        .limit(1)
    )
    latest_score = score_result.scalar_one_or_none()

    payload = {
        "contract_address": token.contract_address,
        "symbol": token.symbol,
        "name": token.name,
        "chain": token.chain,
        "current_price_usd": float((token.extra_data or {}).get("price_usd", 0) or 0),
        "liquidity_usd": float(token.liquidity_usd or 0),
        "market_cap_usd": float(token.market_cap_usd or 0),
        "volume_5m": float((token.extra_data or {}).get("volume_5m", 0) or 0),
        "volume_1h": float((token.extra_data or {}).get("volume_1h", 0) or 0),
        "volume_6h": float((token.extra_data or {}).get("volume_6h", 0) or 0),
        "price_change_1h": float((token.extra_data or {}).get("price_change_1h", 0) or 0),
        "holder_count": int(token.holder_count or 0),
        "top_holders_pct": None,
        "dev_wallet_pct": None,
        "new_wallets_count": int((token.extra_data or {}).get("new_wallets_count", 0) or 0),
        "buys_1h": int((token.extra_data or {}).get("buys_1h", 0) or 0),
        "sells_1h": int((token.extra_data or {}).get("sells_1h", 0) or 0),
        "is_mintable": bool(token.is_mintable),
        "is_ownership_renounced": bool(token.is_ownership_renounced),
        "rug_probability": float(latest_score.rug_probability if latest_score else 0),
        "trade_confidence_index": float(latest_score.trade_confidence_index if latest_score else 0),
        "liquidity_stability": float(latest_score.liquidity_stability if latest_score else 0),
        "holder_distribution": float(latest_score.holder_distribution if latest_score else 0),
        "smart_wallet_signal": float(latest_score.smart_wallet_signal if latest_score else 0),
    }

    insight = await generate_ai_insight(payload)
    return {
        "token": {
            "contract_address": token.contract_address,
            "symbol": token.symbol,
            "chain": token.chain,
        },
        "insight": insight,
    }
