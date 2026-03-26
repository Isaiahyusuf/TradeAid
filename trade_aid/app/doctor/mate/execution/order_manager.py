from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime

from .trade_lifecycle import ManagedTrade, TradeState


class OrderManager:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self.active_trade: ManagedTrade | None = None

    async def open_trade(self, symbol: str, side: str, entry: float, stop: float, take: float, size: float, slippage_bps: float) -> ManagedTrade:
        async with self._lock:
            if self.active_trade is not None:
                raise RuntimeError("active_trade_exists")
            started = time.perf_counter()
            executed_entry = self._apply_slippage(entry, side, slippage_bps)
            latency_ms = (time.perf_counter() - started) * 1000.0
            trade = ManagedTrade(
                trade_id=str(uuid.uuid4()),
                symbol=symbol,
                side=side,
                entry_price=executed_entry,
                stop_loss=stop,
                take_profit=take,
                size=size,
                opened_at=datetime.utcnow(),
                state=TradeState.MANAGE,
                current_price=executed_entry,
            )
            trade.trailing_stop = stop
            self.active_trade = trade
            _ = {"latency_ms": latency_ms, "slippage_bps": slippage_bps}
            return trade

    async def manage_trade(self, price: float, atr_pct: float) -> ManagedTrade | None:
        async with self._lock:
            trade = self.active_trade
            if trade is None:
                return None
            trade.current_price = float(price)
            trail_delta = max(atr_pct * trade.entry_price * 0.9, trade.entry_price * 0.003)
            if trade.side == "BUY":
                candidate = trade.current_price - trail_delta
                trade.trailing_stop = max(float(trade.trailing_stop or trade.stop_loss), candidate)
            else:
                candidate = trade.current_price + trail_delta
                trade.trailing_stop = min(float(trade.trailing_stop or trade.stop_loss), candidate)
            return trade

    async def close_trade(self, exit_price: float) -> ManagedTrade | None:
        async with self._lock:
            trade = self.active_trade
            if trade is None:
                return None
            trade.state = TradeState.CLOSE
            trade.closed_at = datetime.utcnow()
            trade.exit_price = float(exit_price)
            pnl = self._pnl(trade)
            trade.pnl = pnl
            self.active_trade = None
            return trade

    @staticmethod
    def _apply_slippage(price: float, side: str, slippage_bps: float) -> float:
        slip = max(0.0, slippage_bps) / 10000.0
        return price * (1.0 + slip) if side == "BUY" else price * (1.0 - slip)

    @staticmethod
    def _pnl(trade: ManagedTrade) -> float:
        if trade.exit_price is None:
            return 0.0
        move = (trade.exit_price - trade.entry_price) if trade.side == "BUY" else (trade.entry_price - trade.exit_price)
        return move * trade.size
