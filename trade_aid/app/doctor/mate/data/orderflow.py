from __future__ import annotations

from collections import deque
from statistics import mean

from ..types import MarketSnapshot


class OrderFlowAnalyzer:
    def __init__(self, maxlen: int = 500) -> None:
        self.deltas: deque[float] = deque(maxlen=maxlen)
        self.prices: deque[float] = deque(maxlen=maxlen)
        self.cvd_series: deque[float] = deque(maxlen=maxlen)
        self._cvd = 0.0

    def update(self, snapshot: MarketSnapshot) -> dict[str, float]:
        delta = float(snapshot.ask_volume - snapshot.bid_volume)
        self._cvd += delta
        self.deltas.append(delta)
        self.prices.append(snapshot.price)
        self.cvd_series.append(self._cvd)

        return {
            "delta": delta,
            "cvd": self._cvd,
            "delta_divergence": self.delta_divergence(),
            "absorption": self.absorption_score(),
            "spoofing_risk": self.spoofing_risk(snapshot),
        }

    def delta_divergence(self, window: int = 12) -> float:
        if len(self.deltas) < window or len(self.prices) < window:
            return 0.0
        price_move = self.prices[-1] - self.prices[-window]
        delta_move = self.cvd_series[-1] - self.cvd_series[-window]
        scale = abs(price_move) + 1e-6
        return (delta_move / scale) * (1.0 if price_move >= 0 else -1.0)

    def absorption_score(self, window: int = 20) -> float:
        if len(self.deltas) < window:
            return 0.0
        seg = list(self.deltas)[-window:]
        avg_abs = mean(abs(v) for v in seg)
        if avg_abs <= 1e-9:
            return 0.0
        directional = abs(sum(seg)) / (avg_abs * window)
        return max(0.0, 1.0 - directional)

    def spoofing_risk(self, snapshot: MarketSnapshot) -> float:
        imbalance = abs(snapshot.bid_volume - snapshot.ask_volume) / max(snapshot.volume, 1.0)
        spread_penalty = min(1.0, snapshot.spread_bps / 60.0)
        liquidity_penalty = 1.0 / max(1.0, snapshot.liquidity / 100000.0)
        return min(1.0, (0.5 * imbalance) + (0.25 * spread_penalty) + (0.25 * liquidity_penalty))
