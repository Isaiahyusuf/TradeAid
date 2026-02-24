from __future__ import annotations

import secrets
from typing import Any

from app.doctor.doctor_solana_wallet import DoctorSolanaWallet
from app.doctor.services.jupiter_service import JupiterService


class DoctorExecutionEngine:
    def __init__(self, wallet: DoctorSolanaWallet, *, mode: str = "paper", jupiter_api_key: str = "") -> None:
        self.wallet = wallet
        self.mode = (mode or "paper").strip().lower()
        self.jupiter = JupiterService(jupiter_api_key)
        self._sol_mint = "So11111111111111111111111111111111111111112"

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

        output_mint = str(token.get("address") or "").strip()
        if not output_mint:
            return {"executed": False, "reason": "missing_output_mint"}

        amount_lamports = max(1_000_000, int(max(float(size_pct), 0.1) / 100.0 * 1_000_000_000))
        slippage_bps = max(50, int(slippage_pct * 100.0))
        simulation = await self.jupiter.simulate_trade(
            input_mint=self._sol_mint,
            output_mint=output_mint,
            amount_lamports=amount_lamports,
            slippage_bps=slippage_bps,
        )
        if not simulation.get("approved"):
            return {"executed": False, "reason": simulation.get("reason") or "jupiter_simulation_failed"}

        if self.mode != "live":
            return {
                "executed": True,
                "mode": "paper",
                "signature": f"paper-{secrets.token_hex(8)}",
                "confirmed": True,
                "dedupe_key": guard.get("dedupe_key"),
                "min_output": int(simulation.get("min_output") or 0),
                "price_impact_pct": float(simulation.get("price_impact_pct") or 0.0),
            }

        swap_payload = await self.jupiter.execute_swap(
            wallet_pubkey=str(self.wallet.public_address or ""),
            route=dict(simulation.get("route") or {}),
        )
        swap_tx = str(swap_payload.get("swapTransaction") or "").strip()
        if not swap_tx:
            return {
                "executed": False,
                "mode": "live",
                "reason": "jupiter_swap_build_failed",
                "dedupe_key": guard.get("dedupe_key"),
            }

        return {
            "executed": True,
            "mode": "live",
            "reason": "swap_prepared",
            "dedupe_key": guard.get("dedupe_key"),
            "swap_transaction": swap_tx,
            "min_output": int(simulation.get("min_output") or 0),
            "price_impact_pct": float(simulation.get("price_impact_pct") or 0.0),
        }
