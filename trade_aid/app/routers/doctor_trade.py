from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.doctor.doctor_controller import doctor_controller
from app.models.models import User
from app.services.assistant_trading_service import get_wallet_chain_credentials
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/api/doctor", tags=["DoctorTrade"])


class DoctorControlRequest(BaseModel):
    enabled: bool


class DoctorConfigRequest(BaseModel):
    scan_interval_seconds: int | None = None
    kill_switch: bool | None = None
    buy_amount_sol: float | None = None
    max_trades_per_day: int | None = None
    take_profit_multiplier: float | None = None
    min_profit_pct: float | None = None
    stop_loss_pct: float | None = None
    trailing_stop_pct: float | None = None


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
        doctor_controller.scan_interval_seconds = max(5, min(300, int(req.scan_interval_seconds)))
    if req.kill_switch is not None:
        doctor_controller.kill_switch = bool(req.kill_switch)
        if doctor_controller.kill_switch:
            doctor_controller.enabled = False
    if req.buy_amount_sol is not None:
        doctor_controller.buy_amount_sol = max(float(doctor_controller.min_buy_amount_sol), min(5000.0, float(req.buy_amount_sol)))
    if req.max_trades_per_day is not None:
        doctor_controller.max_trades_per_day = max(1, min(2000, int(req.max_trades_per_day)))
    if req.take_profit_multiplier is not None:
        doctor_controller.take_profit_multiplier = max(1.01, min(100.0, float(req.take_profit_multiplier)))
    if req.min_profit_pct is not None:
        doctor_controller.min_profit_pct = max(0.1, min(500.0, float(req.min_profit_pct)))
    if req.stop_loss_pct is not None:
        doctor_controller.stop_loss_pct = max(0.1, min(95.0, float(req.stop_loss_pct)))
    if req.trailing_stop_pct is not None:
        doctor_controller.trailing_stop_pct = max(0.1, min(95.0, float(req.trailing_stop_pct)))
    return await doctor_controller.status()


@router.post("/connect-wallet")
async def doctor_connect_wallet(req: DoctorWalletConnectRequest, user: User = Depends(get_current_user)) -> dict[str, Any]:
    private_key = str(req.private_key or "").strip()
    public_address = str(req.public_address or "").strip()

    if not private_key or not public_address:
        if not req.use_existing_wallet:
            raise HTTPException(status_code=400, detail="Provide private_key and public_address, or enable use_existing_wallet")
        try:
            creds = get_wallet_chain_credentials(user, "solana")
            private_key = str(creds.get("private_key") or "").strip()
            public_address = str(creds.get("address") or "").strip()
        except HTTPException:
            raise HTTPException(status_code=400, detail="wallet_setup_required_open_wallet_tab")

    if not private_key or not public_address:
        raise HTTPException(status_code=400, detail="wallet_setup_required_open_wallet_tab")

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
