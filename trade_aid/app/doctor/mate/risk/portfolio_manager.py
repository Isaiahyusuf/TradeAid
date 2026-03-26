from __future__ import annotations


class PortfolioManager:
    def __init__(self, max_active_trades: int = 1) -> None:
        self.max_active_trades = max(1, int(max_active_trades))
        self.active_trade_ids: set[str] = set()

    def can_open_trade(self) -> bool:
        return len(self.active_trade_ids) < self.max_active_trades

    def register_open(self, trade_id: str) -> None:
        self.active_trade_ids.add(trade_id)

    def register_close(self, trade_id: str) -> None:
        self.active_trade_ids.discard(trade_id)
