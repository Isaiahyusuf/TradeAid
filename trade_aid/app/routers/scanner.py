from fastapi import APIRouter, Depends

from app.models.models import User
from app.scanners.dexscreener import dex_scanner
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/api/scanner", tags=["Scanner"])


@router.get("/health")
async def scanner_health(user: User = Depends(get_current_user)):
    _ = user
    return dex_scanner.get_health_snapshot()
