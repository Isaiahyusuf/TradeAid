from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.models import User
from app.services.auth_service import get_current_user
from app.services.alert_service import alert_service

router = APIRouter(prefix="/api/alerts", tags=["Alerts"])


class CreateAlertRequest(BaseModel):
    alert_type: str
    chain: str
    title: str
    message: str = ""
    severity: str = "medium"
    contract_address: Optional[str] = None
    wallet_address: Optional[str] = None
    threshold_value: Optional[float] = None


@router.get("")
async def list_alerts(
    chain: Optional[str] = None,
    alert_type: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    alerts = await alert_service.get_alerts(
        db, chain=chain, alert_type=alert_type,
        severity=severity, limit=limit, offset=offset,
    )
    return {
        "alerts": [
            {
                "id": str(a.id),
                "alert_type": a.alert_type,
                "chain": a.chain,
                "severity": a.severity,
                "title": a.title,
                "message": a.message,
                "contract_address": a.contract_address,
                "is_read": a.is_read,
                "created_at": str(a.created_at),
            }
            for a in alerts
        ],
        "count": len(alerts),
    }


@router.post("")
async def create_alert(
    req: CreateAlertRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    alert = await alert_service.create_alert(
        db,
        alert_type=req.alert_type,
        chain=req.chain,
        title=req.title,
        message=req.message,
        severity=req.severity,
        contract_address=req.contract_address,
        wallet_address=req.wallet_address,
        threshold_value=req.threshold_value,
    )
    return {"alert_id": str(alert.id), "status": "created"}


@router.patch("/{alert_id}/read")
async def mark_alert_read(
    alert_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await alert_service.mark_read(db, alert_id)
    return {"status": "marked as read"}
