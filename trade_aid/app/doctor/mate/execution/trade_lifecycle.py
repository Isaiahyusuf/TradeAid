from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class TradeState(str, Enum):
    OPEN = "OPEN"
    MANAGE = "MANAGE"
    CLOSE = "CLOSE"


@dataclass(slots=True)
class ManagedTrade:
    trade_id: str
    symbol: str
    side: str
    entry_price: float
    stop_loss: float
    take_profit: float
    size: float
    opened_at: datetime
    state: TradeState = TradeState.OPEN
    current_price: float = 0.0
    trailing_stop: float | None = None
    closed_at: datetime | None = None
    exit_price: float | None = None
    pnl: float | None = None
