from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class SafetyState:
    api_error_count: int = 0
    paused: bool = False
    pause_reason: str | None = None


class DoctorSafetySystems:
    def __init__(self, *, api_error_threshold: int = 3, liquidity_drop_exit_pct: float = 30.0) -> None:
        self.api_error_threshold = max(1, int(api_error_threshold))
        self.liquidity_drop_exit_pct = float(liquidity_drop_exit_pct)
        self.state = SafetyState()

    def register_api_error(self) -> dict[str, Any]:
        self.state.api_error_count += 1
        if self.state.api_error_count > self.api_error_threshold:
            self.state.paused = True
            self.state.pause_reason = "api_errors_exceeded"
        return {
            "api_error_count": self.state.api_error_count,
            "paused": self.state.paused,
            "pause_reason": self.state.pause_reason,
        }

    def register_api_success(self) -> None:
        self.state.api_error_count = 0

    def monitor_token(self, token: dict[str, Any]) -> dict[str, Any]:
        liquidity_drop = float(token.get("liquidity_drop_pct") or 0.0)
        holder_dump = float(token.get("holder_dump_pct") or 0.0)
        slippage_spike = float(token.get("estimated_slippage_pct") or 0.0)
        suspicious_contract = bool(token.get("suspicious_contract", False))
        honeypot_risk = bool(token.get("honeypot_risk", False))
        lp_unlocked = bool(token.get("liquidity_unlocked_risk", False))

        if liquidity_drop >= self.liquidity_drop_exit_pct:
            return {"triggered": True, "reason": "liquidity_drop_detector", "action": "emergency_exit"}
        if holder_dump >= 20.0:
            return {"triggered": True, "reason": "holder_dump_detector", "action": "emergency_exit"}
        if slippage_spike >= 6.0:
            return {"triggered": True, "reason": "slippage_spike_detector", "action": "pause"}
        if suspicious_contract:
            return {"triggered": True, "reason": "suspicious_contract_freeze", "action": "pause"}
        if honeypot_risk:
            return {"triggered": True, "reason": "honeypot_detector", "action": "pause"}
        if lp_unlocked:
            return {"triggered": True, "reason": "lp_unlock_risk", "action": "pause"}
        return {"triggered": False}

    def monitor(self) -> dict[str, Any]:
        return {
            "api_error_count": self.state.api_error_count,
            "paused": self.state.paused,
            "pause_reason": self.state.pause_reason,
        }
