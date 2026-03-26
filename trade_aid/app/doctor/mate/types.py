from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


class SignalDirection(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class MarketRegime(str, Enum):
    TRENDING = "TRENDING"
    RANGING = "RANGING"
    VOLATILE = "VOLATILE"
    LOW_LIQUIDITY = "LOW_LIQUIDITY"


@dataclass(slots=True)
class MarketSnapshot:
    symbol: str
    timestamp: datetime
    price: float
    high: float
    low: float
    volume: float
    bid_volume: float
    ask_volume: float
    liquidity: float
    spread_bps: float


@dataclass(slots=True)
class AgentSignal:
    signal: SignalDirection
    confidence: float
    entry: float
    stop_loss: float
    take_profit: float
    expected_rr: float
    reason: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class OrchestratorDecision:
    best_agent: str
    confidence: float
    regime: MarketRegime
    scores: dict[str, float]
    factors: dict[str, dict[str, float]]


@dataclass(slots=True)
class TradeRecord:
    trade_id: str
    symbol: str
    agent: str
    side: str
    entry_price: float
    exit_price: float | None
    size: float
    opened_at: datetime
    closed_at: datetime | None
    pnl: float | None
    hold_seconds: float | None
    decision_factors: dict[str, Any] = field(default_factory=dict)
