from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.doctor.doctor_controller import doctor_controller
from app.models.models import User
from app.services.assistant_trading_service import get_wallet_chain_credentials
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/api/doctor", tags=["DoctorTrade"])


class DoctorControlRequest(BaseModel):
    enabled: bool


class DoctorConfigRequest(BaseModel):
    scan_interval_seconds: int | None = Field(default=None, ge=5, le=300)
    kill_switch: bool | None = None
    buy_amount_sol: float | None = Field(default=None, ge=0.1, le=500.0)
    max_trades_per_day: int | None = Field(default=None, ge=1, le=200)
    take_profit_multiplier: float | None = Field(default=None, ge=1.05, le=10.0)
    min_profit_pct: float | None = Field(default=None, ge=0.5, le=80.0)
    stop_loss_pct: float | None = Field(default=None, ge=0.5, le=30.0)
    trailing_stop_pct: float | None = Field(default=None, ge=0.5, le=40.0)


class DoctorWalletConnectRequest(BaseModel):
    private_key: str | None = None
    public_address: str | None = None
    use_existing_wallet: bool = True


@router.get("/status")
async def doctor_status(user: User = Depends(get_current_user)) -> dict[str, Any]:
    _ = user
    return await doctor_controller.status()


@router.post("/control")
async def doctor_control(req: DoctorControlRequest, user: User = Depends(get_current_user)) -> dict[str, Any]:
    _ = user
    if req.enabled:
        await doctor_controller.start()
    else:
        await doctor_controller.stop()
    return await doctor_controller.status()


@router.post("/config")
async def doctor_config(req: DoctorConfigRequest, user: User = Depends(get_current_user)) -> dict[str, Any]:
    _ = user
    if req.scan_interval_seconds is not None:
        doctor_controller.scan_interval_seconds = int(req.scan_interval_seconds)
    if req.kill_switch is not None:
        doctor_controller.kill_switch = bool(req.kill_switch)
        if doctor_controller.kill_switch:
            doctor_controller.enabled = False
    if req.buy_amount_sol is not None:
        doctor_controller.buy_amount_sol = max(float(req.buy_amount_sol), float(doctor_controller.min_buy_amount_sol))
    if req.max_trades_per_day is not None:
        doctor_controller.max_trades_per_day = int(req.max_trades_per_day)
    if req.take_profit_multiplier is not None:
        doctor_controller.take_profit_multiplier = float(req.take_profit_multiplier)
    if req.min_profit_pct is not None:
        doctor_controller.min_profit_pct = float(req.min_profit_pct)
    if req.stop_loss_pct is not None:
        doctor_controller.stop_loss_pct = float(req.stop_loss_pct)
    if req.trailing_stop_pct is not None:
        doctor_controller.trailing_stop_pct = float(req.trailing_stop_pct)
    return await doctor_controller.status()


@router.post("/connect-wallet")
async def doctor_connect_wallet(req: DoctorWalletConnectRequest, user: User = Depends(get_current_user)) -> dict[str, Any]:
    private_key = str(req.private_key or "").strip()
    public_address = str(req.public_address or "").strip()

    if not private_key or not public_address:
        if not req.use_existing_wallet:
            raise HTTPException(status_code=400, detail="Provide private_key and public_address, or enable use_existing_wallet")
        creds = get_wallet_chain_credentials(user, "solana")
        private_key = str(creds.get("private_key") or "").strip()
        public_address = str(creds.get("address") or "").strip()

    if not private_key or not public_address:
        raise HTTPException(status_code=400, detail="Unable to connect DoctorTrade wallet")

    doctor_controller.configure_wallet(private_key=private_key, public_address=public_address)
    return await doctor_controller.status()


@router.post("/run-once")
async def doctor_run_once(user: User = Depends(get_current_user)) -> dict[str, Any]:
    _ = user
    if not doctor_controller.enabled:
        await doctor_controller.start()
    result = await doctor_controller.run_once()
    status = await doctor_controller.status()
    return {"result": result, "status": status}
