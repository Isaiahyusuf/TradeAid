from __future__ import annotations

import asyncio
import base64
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.doctor.doctor_controller import DoctorTradeController
from app.models.models import User
from app.services.assistant_trading_service import get_wallet_chain_credentials
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/api/doctor", tags=["DoctorTrade"])

_user_doctor_controllers: dict[str, DoctorTradeController] = {}
_user_doctor_lock = asyncio.Lock()


def _decode_private_key_bytes(raw_private_key: str) -> bytes:
    raw = str(raw_private_key or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="private_key_required")

    if raw.startswith("[") and raw.endswith("]"):
        try:
            values = json.loads(raw)
            if not isinstance(values, list):
                raise ValueError("invalid_json")
            return bytes(int(v) for v in values)
        except Exception:
            raise HTTPException(status_code=400, detail="invalid_private_key_format")

    compact = "".join(raw.split())
    hex_value = compact[2:] if compact.lower().startswith("0x") else compact
    if all(ch in "0123456789abcdefABCDEF" for ch in hex_value) and len(hex_value) in {64, 128}:
        try:
            return bytes.fromhex(hex_value)
        except Exception:
            pass

    try:
        decoded = base64.b64decode(compact, validate=True)
        if len(decoded) in {32, 64}:
            return decoded
    except Exception:
        pass

    try:
        from solders.keypair import Keypair

        keypair = Keypair.from_base58_string(compact)
        return bytes(keypair)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_private_key_format")


def _derive_solana_address_from_private_key(raw_private_key: str) -> str:
    key_bytes = _decode_private_key_bytes(raw_private_key)
    if len(key_bytes) not in {32, 64}:
        raise HTTPException(status_code=400, detail="invalid_private_key_length")

    try:
        from solders.keypair import Keypair

        if len(key_bytes) == 64:
            keypair = Keypair.from_bytes(key_bytes)
        else:
            keypair = Keypair.from_seed(key_bytes)
        return str(keypair.pubkey())
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_private_key")


async def _get_user_doctor_controller(user: User) -> DoctorTradeController:
    user_id = str(user.id)
    async with _user_doctor_lock:
        controller = _user_doctor_controllers.get(user_id)
        if controller is None:
            controller = DoctorTradeController()
            controller.set_owner_user_id(user_id)
            prefs = dict(user.alert_preferences or {})
            controller.set_trading_mode(str(prefs.get("doctor_trading_mode") or "doctor"))
            try:
                creds = get_wallet_chain_credentials(user, "solana")
                private_key = str(creds.get("private_key") or "").strip()
                public_address = str(creds.get("address") or "").strip()
                if private_key and public_address:
                    controller.configure_wallet(private_key=private_key, public_address=public_address)
                    if not controller.enabled and not controller.kill_switch:
                        await controller.start()
            except Exception:
                pass
            _user_doctor_controllers[user_id] = controller
        else:
            controller.set_owner_user_id(user_id)
            prefs = dict(user.alert_preferences or {})
            controller.set_trading_mode(str(prefs.get("doctor_trading_mode") or controller.trading_mode or "doctor"))
        return controller


class DoctorControlRequest(BaseModel):
    enabled: bool


class DoctorConfigRequest(BaseModel):
    trading_mode: str | None = None
    scan_interval_seconds: int | None = None
    kill_switch: bool | None = None
    buy_amount_sol: float | None = None
    max_trades_per_day: int | None = None
    take_profit_multiplier: float | None = None
    min_profit_pct: float | None = None
    stop_loss_pct: float | None = None
    trailing_stop_pct: float | None = None
    min_liquidity_usd: float | None = None
    max_slippage_pct: float | None = None
    max_spread_pct: float | None = None
    daily_loss_limit_usd: float | None = None
    max_consecutive_losses: int | None = None
    strong_move_threshold_pct: float | None = None
    max_hold_minutes: int | None = None
    min_momentum_profit_pct: float | None = None
    early_entry_exit_mode: bool | None = None
    fast_take_profit_pct: float | None = None
    quality_min_volume_spike_pct: float | None = None
    quality_max_top_holder_pct: float | None = None


@router.get("/health")
async def doctor_health(user: User = Depends(get_current_user)) -> dict[str, Any]:
    _ = user
    return {
        "ok": True,
        "service": "doctortrade",
        "version": "2026-02-24",
        "features": {
            "execution_safety_lock": True,
            "weighted_sizing": True,
            "session_risk_autopause": True,
            "signal_quality_filter": True,
            "advanced_exits": True,
            "decision_journal": True,
            "mate_strategy_brain": True,
            "live_readiness_gate": True,
        },
    }


@router.get("/live-readiness")
async def doctor_live_readiness(user: User = Depends(get_current_user)) -> dict[str, Any]:
    controller = await _get_user_doctor_controller(user)
    status = await controller.status()
    wallet = dict(status.get("wallet") or {})
    return controller.live_readiness_snapshot(
        balance_sol=float(wallet.get("balance_sol") or 0.0),
        balance_stale=bool(wallet.get("balance_stale")),
    )


class DoctorWalletConnectRequest(BaseModel):
    private_key: str | None = None
    public_address: str | None = None
    use_existing_wallet: bool = True


class DoctorDirectBuyRequest(BaseModel):
    contract_address: str
    chain: str = "solana"


class DoctorDirectSellRequest(BaseModel):
    contract_address: str
    sell_fraction_pct: float = 100.0


@router.get("/status")
async def doctor_status(user: User = Depends(get_current_user)) -> dict[str, Any]:
    controller = await _get_user_doctor_controller(user)
    return await controller.status()


@router.get("/pnl")
async def doctor_pnl(user: User = Depends(get_current_user)) -> dict[str, Any]:
    controller = await _get_user_doctor_controller(user)
    return controller.pnl_summary()


@router.post("/control")
async def doctor_control(req: DoctorControlRequest, user: User = Depends(get_current_user)) -> dict[str, Any]:
    controller = await _get_user_doctor_controller(user)
    if req.enabled:
        await controller.start()
    else:
        await controller.stop()
    return await controller.status()


@router.post("/config")
async def doctor_config(
    req: DoctorConfigRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    controller = await _get_user_doctor_controller(user)
    if req.trading_mode is not None:
        normalized_mode = str(req.trading_mode or "doctor").strip().lower()
        if normalized_mode not in {"doctor", "retardio"}:
            raise HTTPException(status_code=400, detail="trading_mode must be doctor or retardio")
        controller.set_trading_mode(normalized_mode)

        prefs = dict(user.alert_preferences or {})
        prefs["doctor_trading_mode"] = controller.trading_mode
        user.alert_preferences = prefs
        db.add(user)
        await db.flush()

    if req.scan_interval_seconds is not None:
        controller.scan_interval_seconds = max(5, min(300, int(req.scan_interval_seconds)))
    if req.kill_switch is not None:
        controller.kill_switch = bool(req.kill_switch)
        if controller.kill_switch:
            controller.enabled = False
    if req.buy_amount_sol is not None:
        controller.buy_amount_sol = max(float(controller.min_buy_amount_sol), min(5000.0, float(req.buy_amount_sol)))
    if req.max_trades_per_day is not None:
        controller.max_trades_per_day = max(1, min(2000, int(req.max_trades_per_day)))
    if req.take_profit_multiplier is not None:
        controller.take_profit_multiplier = max(1.01, min(100.0, float(req.take_profit_multiplier)))
    if req.min_profit_pct is not None:
        controller.min_profit_pct = max(0.1, min(500.0, float(req.min_profit_pct)))
    if req.stop_loss_pct is not None:
        controller.stop_loss_pct = max(0.1, min(95.0, float(req.stop_loss_pct)))
    if req.trailing_stop_pct is not None:
        controller.trailing_stop_pct = max(0.1, min(95.0, float(req.trailing_stop_pct)))
    if req.min_liquidity_usd is not None:
        controller.min_liquidity_usd = max(1000.0, min(20000000.0, float(req.min_liquidity_usd)))
    if req.max_slippage_pct is not None:
        controller.max_slippage_pct = max(0.1, min(50.0, float(req.max_slippage_pct)))
    if req.max_spread_pct is not None:
        controller.max_spread_pct = max(0.1, min(50.0, float(req.max_spread_pct)))
    if req.daily_loss_limit_usd is not None:
        controller.daily_loss_limit_usd = max(10.0, min(500000.0, float(req.daily_loss_limit_usd)))
    if req.max_consecutive_losses is not None:
        controller.max_consecutive_losses = max(1, min(20, int(req.max_consecutive_losses)))
    if req.strong_move_threshold_pct is not None:
        controller.strong_move_threshold_pct = max(5.0, min(500.0, float(req.strong_move_threshold_pct)))
    if req.max_hold_minutes is not None:
        controller.max_hold_minutes = max(5, min(10080, int(req.max_hold_minutes)))
    if req.min_momentum_profit_pct is not None:
        controller.min_momentum_profit_pct = max(0.0, min(100.0, float(req.min_momentum_profit_pct)))
    if req.early_entry_exit_mode is not None:
        controller.early_entry_exit_mode = bool(req.early_entry_exit_mode)
    if req.fast_take_profit_pct is not None:
        controller.fast_take_profit_pct = max(0.5, min(60.0, float(req.fast_take_profit_pct)))
    if req.quality_min_volume_spike_pct is not None:
        controller.quality_min_volume_spike_pct = max(0.0, min(500.0, float(req.quality_min_volume_spike_pct)))
    if req.quality_max_top_holder_pct is not None:
        controller.quality_max_top_holder_pct = max(1.0, min(95.0, float(req.quality_max_top_holder_pct)))
    return await controller.status()


@router.post("/connect-wallet")
async def doctor_connect_wallet(req: DoctorWalletConnectRequest, user: User = Depends(get_current_user)) -> dict[str, Any]:
    controller = await _get_user_doctor_controller(user)
    private_key = str(req.private_key or "").strip()
    public_address = str(req.public_address or "").strip()

    if private_key and not public_address:
        public_address = _derive_solana_address_from_private_key(private_key)

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

    controller.configure_wallet(private_key=private_key, public_address=public_address)
    if not controller.enabled and not controller.kill_switch:
        await controller.start()
    return await controller.status()


@router.post("/disconnect-wallet")
async def doctor_disconnect_wallet(user: User = Depends(get_current_user)) -> dict[str, Any]:
    controller = await _get_user_doctor_controller(user)
    controller.disconnect_wallet()
    return await controller.status()


@router.post("/run-once")
async def doctor_run_once(user: User = Depends(get_current_user)) -> dict[str, Any]:
    controller = await _get_user_doctor_controller(user)
    if not controller.enabled:
        await controller.start()
    result = await controller.run_once()
    status = await controller.status()
    return {"result": result, "status": status}


@router.post("/direct-buy")
async def doctor_direct_buy(req: DoctorDirectBuyRequest, user: User = Depends(get_current_user)) -> dict[str, Any]:
    controller = await _get_user_doctor_controller(user)
    result = await controller.execute_direct_buy(
        contract_address=req.contract_address,
        chain=req.chain,
    )
    if not result.get("executed"):
        raise HTTPException(status_code=400, detail=str(result.get("reason") or "direct_buy_failed"))
    status = await controller.status()
    return {"result": result, "status": status}


@router.post("/direct-sell")
async def doctor_direct_sell(req: DoctorDirectSellRequest, user: User = Depends(get_current_user)) -> dict[str, Any]:
    controller = await _get_user_doctor_controller(user)
    result = await controller.execute_direct_sell(
        contract_address=req.contract_address,
        sell_fraction_pct=req.sell_fraction_pct,
    )
    if not result.get("executed"):
        raise HTTPException(status_code=400, detail=str(result.get("reason") or "direct_sell_failed"))
    status = await controller.status()
    return {"result": result, "status": status}
