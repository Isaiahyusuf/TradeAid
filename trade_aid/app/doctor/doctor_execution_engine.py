from __future__ import annotations

import secrets
from typing import Any

from app.doctor.doctor_solana_wallet import DoctorSolanaWallet


class DoctorExecutionEngine:
    def __init__(self, wallet: DoctorSolanaWallet, *, mode: str = "paper") -> None:
        self.wallet = wallet
        self.mode = (mode or "paper").strip().lower()

    async def execute(self, token: dict[str, Any], signal: dict[str, Any], size_pct: float) -> dict[str, Any]:
        slippage_pct = float(token.get("estimated_slippage_pct") or 1.0)
        liquidity_guard = self.wallet.reject_if_sudden_liquidity_drop(
            token_address=str(token.get("address") or ""),
            current_liquidity=float(token.get("liquidity") or 0.0),
            threshold_pct=30.0,
        )
        if not liquidity_guard.get("approved"):
            return {"executed": False, "reason": liquidity_guard.get("reason")}

        guard = self.wallet.validate_swap_guard(
            token_address=str(token.get("address") or ""),
            side=str(signal.get("action") or "HOLD"),
            size_pct=float(size_pct),
            slippage_pct=slippage_pct,
        )
        if not guard.get("approved"):
            return {"executed": False, "reason": guard.get("reason")}

        if self.mode != "live":
            return {
                "executed": True,
                "mode": "paper",
                "signature": f"paper-{secrets.token_hex(8)}",
                "confirmed": True,
                "dedupe_key": guard.get("dedupe_key"),
            }

        return {
            "executed": False,
            "mode": "live",
            "reason": "live_swap_not_enabled",
            "dedupe_key": guard.get("dedupe_key"),
        }
