from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(slots=True)
class GuardState:
    day: str
    day_start_equity: float
    daily_pnl: float = 0.0
    consecutive_losses: int = 0
    trading_paused: bool = False


class DrawdownGuard:
    def __init__(self, max_daily_loss_pct: float = 0.03, max_consecutive_losses: int = 3) -> None:
        self.max_daily_loss_pct = max(0.005, min(0.2, float(max_daily_loss_pct)))
        self.max_consecutive_losses = max(1, min(20, int(max_consecutive_losses)))
        today = date.today().isoformat()
        self.state = GuardState(day=today, day_start_equity=0.0)

    def start_day(self, equity: float) -> None:
        today = date.today().isoformat()
        if self.state.day != today:
            self.state = GuardState(day=today, day_start_equity=float(equity))
        elif self.state.day_start_equity <= 0:
            self.state.day_start_equity = float(equity)

    def register_trade_result(self, pnl: float, equity: float) -> None:
        self.start_day(equity)
        self.state.daily_pnl += float(pnl)
        if pnl < 0:
            self.state.consecutive_losses += 1
        else:
            self.state.consecutive_losses = 0

        if self.state.day_start_equity > 0:
            loss_ratio = abs(min(0.0, self.state.daily_pnl)) / self.state.day_start_equity
            if loss_ratio >= self.max_daily_loss_pct:
                self.state.trading_paused = True

        if self.state.consecutive_losses >= self.max_consecutive_losses:
            self.state.trading_paused = True

    def can_trade(self, equity: float) -> bool:
        self.start_day(equity)
        return not self.state.trading_paused
