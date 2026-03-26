from __future__ import annotations

from typing import Callable


class TelegramInterface:
    def __init__(self, sender: Callable[[str], None] | None = None) -> None:
        self.sender = sender

    def notify_signal(self, strategy: str, regime: str, signal: str, entry: float, take_profit: float, stop_loss: float, confidence: float) -> str:
        message = (
            f"🧠 Strategy: {strategy}\n"
            f"📊 Regime: {regime}\n"
            f"📈 Signal: {signal}\n"
            f"💰 Entry: {entry:.6f}\n"
            f"🎯 TP: {take_profit:.6f}\n"
            f"🛑 SL: {stop_loss:.6f}\n"
            f"📊 Confidence: {confidence:.2f}"
        )
        if self.sender:
            self.sender(message)
        return message
