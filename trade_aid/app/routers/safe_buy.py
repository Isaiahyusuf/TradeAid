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
    chain: str = Query(default="all"),
    chains: str | None = Query(default=None, description="Comma-separated chains for custom mode"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    chain_value = (chain or "all").strip().lower()
    selected_chains: list[str] | None = None

    if chain_value == "custom":
        selected_chains = [item.strip().lower() for item in (chains or "").split(",") if item.strip()]
    elif chain_value != "all":
        selected_chains = [chain_value]

    result = await safe_buy_service.list_safe_buy_tokens(db, limit=limit, chains=selected_chains)
    tokens = result.get("safe_tokens", [])
    near_miss_tokens = result.get("near_miss_tokens", [])
    return {
        "tokens": tokens,
        "count": len(tokens),
        "near_miss_tokens": near_miss_tokens,
        "near_miss_count": len(near_miss_tokens),
        "refreshed_at": __import__("datetime").datetime.utcnow().isoformat(),
    }
