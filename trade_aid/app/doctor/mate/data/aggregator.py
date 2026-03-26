from __future__ import annotations

from collections import deque
from statistics import mean, pstdev

from ..types import MarketSnapshot


class DataAggregator:
    def __init__(self, maxlen: int = 400) -> None:
        self.snapshots: deque[MarketSnapshot] = deque(maxlen=max(100, maxlen))

    def add(self, snapshot: MarketSnapshot) -> None:
        self.snapshots.append(snapshot)

    def prices(self) -> list[float]:
        return [s.price for s in self.snapshots]

    def highs(self) -> list[float]:
        return [s.high for s in self.snapshots]

    def lows(self) -> list[float]:
        return [s.low for s in self.snapshots]

    def volumes(self) -> list[float]:
        return [s.volume for s in self.snapshots]

    def liquidities(self) -> list[float]:
        return [s.liquidity for s in self.snapshots]

    def latest(self) -> MarketSnapshot | None:
        if not self.snapshots:
            return None
        return self.snapshots[-1]

    def volume_zscore(self, window: int = 30) -> float:
        vals = self.volumes()
        if len(vals) < max(8, window):
            return 0.0
        segment = vals[-window:]
        sigma = pstdev(segment)
        if sigma <= 0:
            return 0.0
        return (segment[-1] - mean(segment)) / sigma

    def liquidity_inflow(self, window: int = 20) -> float:
        vals = self.liquidities()
        if len(vals) < max(5, window):
            return 0.0
        base = mean(vals[-window:-1]) if window > 1 else vals[-1]
        if base <= 0:
            return 0.0
        return (vals[-1] - base) / base
