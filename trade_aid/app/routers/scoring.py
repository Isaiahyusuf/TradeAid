from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.models import ScoringHistory, User
from app.services.auth_service import get_current_user
from app.scoring.scoring_service import scoring_service
from app.workers.tasks import score_token_task

router = APIRouter(prefix="/api/scoring", tags=["Scoring"])


class ScoreRequest(BaseModel):
    contract_address: str
    chain: str


@router.post("/score-token")
async def score_token(
    req: ScoreRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await scoring_service.score_token(db, req.contract_address, req.chain)
    return result


@router.post("/score-token/async")
async def score_token_async(
    req: ScoreRequest,
    user: User = Depends(get_current_user),
):
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
