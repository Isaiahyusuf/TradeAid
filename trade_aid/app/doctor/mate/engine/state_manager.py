from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class EngineState:
    symbol: str
    equity: float = 100000.0
    active_agent: str = ""
    last_switch_at: datetime | None = None
    cooldown_until: datetime | None = None
    last_decision: dict[str, Any] = field(default_factory=dict)


class StateManager:
    def __init__(self, symbol: str, starting_equity: float = 100000.0) -> None:
        self.state = EngineState(symbol=symbol, equity=float(starting_equity))
