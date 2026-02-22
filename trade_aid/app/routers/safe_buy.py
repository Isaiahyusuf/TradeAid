from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.models import User
from app.services.auth_service import get_current_user
from app.services.safe_buy_service import safe_buy_service

router = APIRouter(prefix="/api/safe-buy", tags=["Safe Buy"])


@router.get("")
async def list_safe_buy(
    limit: int = Query(default=20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await safe_buy_service.list_safe_buy_tokens(db, limit=limit)
    tokens = result.get("safe_tokens", [])
    near_miss_tokens = result.get("near_miss_tokens", [])
    return {
        "tokens": tokens,
        "count": len(tokens),
        "near_miss_tokens": near_miss_tokens,
        "near_miss_count": len(near_miss_tokens),
        "refreshed_at": __import__("datetime").datetime.utcnow().isoformat(),
    }
