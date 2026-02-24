from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any


@dataclass
class DoctorRiskState:
    equity_usd: float = 10000.0
    daily_start_equity_usd: float = 10000.0
    daily_realized_pnl_usd: float = 0.0
    open_exposure_pct: float = 0.0
    open_positions: int = 0
    consecutive_losses: int = 0
    total_loss_pct: float = 0.0
    paused: bool = False
    permanent_lock: bool = False
    pause_reason: str | None = None
    cooldown_until: str | None = None
    current_day: str = ""


class DoctorMemeRiskGovernor:
    MAX_PER_TRADE_PCT = 5.0
    MAX_DAILY_DRAWDOWN_PCT = 15.0
    MAX_OPEN_POSITIONS = 3
    MAX_TOTAL_EXPOSURE_PCT = 20.0
    PERMANENT_LOCK_LOSS_PCT = 12.0
    COOLDOWN_MINUTES = 30

    def _roll_day(self, state: DoctorRiskState) -> None:
        day = datetime.utcnow().date().isoformat()
        if state.current_day != day:
            state.current_day = day
            state.daily_start_equity_usd = state.equity_usd
            state.daily_realized_pnl_usd = 0.0

    def validate(self, signal: dict[str, Any], state: DoctorRiskState) -> dict[str, Any]:
        self._roll_day(state)

        if state.permanent_lock:
            return {"approved": False, "reason": "permanent_lock"}
        if state.paused:
            if state.pause_reason == "three_consecutive_losses" and state.cooldown_until:
                try:
                    until = datetime.fromisoformat(state.cooldown_until)
                    if datetime.utcnow() >= until:
                        state.paused = False
                        state.pause_reason = None
                        state.cooldown_until = None
                        state.consecutive_losses = 0
                except Exception:
                    pass
        if state.paused:
            return {"approved": False, "reason": state.pause_reason or "paused"}

        daily_drawdown_pct = 0.0
        if state.daily_start_equity_usd > 0:
            daily_drawdown_pct = max(0.0, (-state.daily_realized_pnl_usd / state.daily_start_equity_usd) * 100.0)

        if daily_drawdown_pct > self.MAX_DAILY_DRAWDOWN_PCT:
            state.paused = True
            state.pause_reason = "max_daily_drawdown"
            return {"approved": False, "reason": state.pause_reason}

        if state.consecutive_losses >= 3:
            state.paused = True
            state.pause_reason = "three_consecutive_losses"
            state.cooldown_until = (datetime.utcnow() + timedelta(minutes=self.COOLDOWN_MINUTES)).isoformat()
            return {"approved": False, "reason": state.pause_reason}

        requested_pct = float(signal.get("position_size_pct") or 0.0)
        requested_pct = max(0.0, min(self.MAX_PER_TRADE_PCT, requested_pct))

        if state.consecutive_losses >= 2:
            requested_pct *= 0.5

        if requested_pct <= 0:
            return {"approved": False, "reason": "size_zero"}

        if state.open_positions >= self.MAX_OPEN_POSITIONS:
            return {"approved": False, "reason": "max_open_positions"}

        if (state.open_exposure_pct + requested_pct) > self.MAX_TOTAL_EXPOSURE_PCT:
            return {"approved": False, "reason": "max_total_exposure"}

        return {
            "approved": True,
            "position_size_pct": round(requested_pct, 4),
            "max_per_trade_pct": self.MAX_PER_TRADE_PCT,
            "max_daily_drawdown_pct": self.MAX_DAILY_DRAWDOWN_PCT,
            "max_open_positions": self.MAX_OPEN_POSITIONS,
            "max_total_exposure_pct": self.MAX_TOTAL_EXPOSURE_PCT,
            "daily_drawdown_pct": round(daily_drawdown_pct, 4),
        }

    def register_close(self, state: DoctorRiskState, pnl_usd: float, released_exposure_pct: float) -> None:
        self._roll_day(state)
        state.daily_realized_pnl_usd += float(pnl_usd)
        state.equity_usd += float(pnl_usd)
        state.open_exposure_pct = max(0.0, state.open_exposure_pct - max(0.0, released_exposure_pct))
        state.open_positions = max(0, state.open_positions - 1)

        if pnl_usd < 0:
            state.consecutive_losses += 1
        else:
            state.consecutive_losses = 0

        start_equity = max(state.daily_start_equity_usd, 1.0)
        state.total_loss_pct = max(0.0, ((start_equity - state.equity_usd) / start_equity) * 100.0)

        if state.total_loss_pct >= self.PERMANENT_LOCK_LOSS_PCT:
            state.permanent_lock = True
            state.paused = True
            state.pause_reason = "permanent_loss_lock"

    def register_open(self, state: DoctorRiskState, exposure_pct: float) -> None:
        self._roll_day(state)
        state.open_positions += 1
        state.open_exposure_pct += max(0.0, exposure_pct)

    def emergency_pause(self, state: DoctorRiskState, reason: str) -> None:
        state.paused = True
        state.pause_reason = reason
