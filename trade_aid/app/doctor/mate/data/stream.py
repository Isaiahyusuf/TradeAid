from __future__ import annotations

import random
from datetime import datetime

from ..types import MarketSnapshot


class MarketDataStream:
    """Feed adapter for market snapshots.

    In production this should consume websocket/tick feeds. The fallback path
    allows deterministic paper-mode simulation for local testing.
    """

    def __init__(self, seed_price: float = 100.0) -> None:
        self._price = float(seed_price)

    def next_snapshot(self, symbol: str, external: dict | None = None) -> MarketSnapshot:
        if external:
            return MarketSnapshot(
                symbol=symbol,
                timestamp=datetime.utcnow(),
                price=float(external.get("price") or self._price),
                high=float(external.get("high") or external.get("price") or self._price),
                low=float(external.get("low") or external.get("price") or self._price),
                volume=float(external.get("volume") or 0.0),
                bid_volume=float(external.get("bid_volume") or 0.0),
                ask_volume=float(external.get("ask_volume") or 0.0),
                liquidity=float(external.get("liquidity") or 0.0),
                spread_bps=float(external.get("spread_bps") or 0.0),
            )

        drift = random.uniform(-0.009, 0.009)
        self._price = max(0.0001, self._price * (1.0 + drift))
        high = self._price * (1.0 + abs(random.uniform(0.0, 0.003)))
        low = self._price * (1.0 - abs(random.uniform(0.0, 0.003)))
        volume = random.uniform(5000.0, 30000.0)
        bid_volume = volume * random.uniform(0.35, 0.65)
        ask_volume = max(1.0, volume - bid_volume)
        liquidity = random.uniform(150000.0, 1200000.0)
        spread_bps = random.uniform(1.0, 25.0)
        return MarketSnapshot(
            symbol=symbol,
            timestamp=datetime.utcnow(),
            price=self._price,
            high=max(high, self._price),
            low=min(low, self._price),
            volume=volume,
            bid_volume=bid_volume,
            ask_volume=ask_volume,
            liquidity=liquidity,
            spread_bps=spread_bps,
        )
