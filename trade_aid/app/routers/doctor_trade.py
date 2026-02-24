from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.doctor.doctor_controller import doctor_controller
from app.models.models import User
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/api/doctor", tags=["DoctorTrade"])


class DoctorControlRequest(BaseModel):
    enabled: bool


class DoctorConfigRequest(BaseModel):
    scan_interval_seconds: int | None = Field(default=None, ge=5, le=300)
    kill_switch: bool | None = None


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
    return await doctor_controller.status()


@router.post("/run-once")
async def doctor_run_once(user: User = Depends(get_current_user)) -> dict[str, Any]:
    _ = user
    if not doctor_controller.enabled:
        await doctor_controller.start()
    result = await doctor_controller.run_once()
    status = await doctor_controller.status()
    return {"result": result, "status": status}
