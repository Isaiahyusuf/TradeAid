from __future__ import annotations

from typing import Any


class DoctorAIMemeEngine:
    def generate(self, token: dict[str, Any], *, current_drawdown_pct: float) -> dict[str, Any]:
        price = float(token.get("price_usd") or 0.0)
        buy_sell_ratio = float(token.get("buy_sell_ratio") or 1.0)
        volume_spike = float(token.get("volume_spike_pct") or 0.0)
        fomo_trend_score = float(token.get("fomo_trend_score") or 0.0)
        strategy_mode = str(token.get("strategy_mode") or "trending")
        volatility = min(0.25, max(0.005, abs(float(token.get("volume_spike_pct") or 0.0)) / 400.0))

        breakout = volume_spike > 25 and buy_sell_ratio >= 1.15
        pullback_entry = 8 <= volume_spike <= 25 and buy_sell_ratio >= 1.0
        volume_explosion = volume_spike > 60
        fomo_trigger = fomo_trend_score >= 62.0 and volume_spike > 18.0
        fake_breakout_warning = buy_sell_ratio < 0.9 or float(token.get("age_minutes") or 0.0) < 8.0

        confidence = 50
        if breakout:
            confidence += 15
        if pullback_entry:
            confidence += 10
        if volume_explosion:
            confidence += 12
        if fomo_trigger:
            confidence += 9
        if fake_breakout_warning:
            confidence -= 20
        if strategy_mode == "pump_sniper":
            confidence += 6
        elif strategy_mode == "new_launch":
            confidence += 3
        confidence += int(min(float(token.get("score") or 0.0) / 10.0, 10.0))
        confidence = max(1, min(99, confidence))

        if confidence >= 68 and not fake_breakout_warning:
            action = "BUY"
        elif confidence <= 35 or fake_breakout_warning:
            action = "SELL"
        else:
            action = "HOLD"

        stop_loss = price * (1.0 - max(0.01, min(0.06, volatility * 1.8))) if price > 0 else 0.0
        take_profit = price * (1.0 + max(0.02, min(0.18, volatility * 3.2))) if price > 0 else 0.0

        liq_factor = min(max(float(token.get("liquidity") or 0.0) / 200000.0, 0.1), 1.0)
        vol_factor = min(max(1.0 - volatility, 0.3), 1.0)
        conf_factor = max(confidence / 100.0, 0.1)
        drawdown_factor = min(max(1.0 - (current_drawdown_pct / 8.0), 0.25), 1.0)
        mode_factor = 0.85 if strategy_mode == "pump_sniper" else 0.92 if strategy_mode == "new_launch" else 1.0

        position_size_pct = 1.0 * liq_factor * vol_factor * conf_factor * drawdown_factor * mode_factor
        position_size_pct = max(0.1, min(1.0, position_size_pct))

        return {
            "action": action,
            "entry_price": round(price, 8),
            "stop_loss": round(stop_loss, 8),
            "take_profit": round(take_profit, 8),
            "position_size_pct": round(position_size_pct, 4),
            "confidence": int(confidence),
            "signals": {
                "momentum_breakout": breakout,
                "pullback_entry": pullback_entry,
                "volume_explosion": volume_explosion,
                "fomo_trigger": fomo_trigger,
                "fake_breakout_warning": fake_breakout_warning,
            },
            "strategy_mode": strategy_mode,
            "volatility": round(volatility, 6),
        }
