from __future__ import annotations

from statistics import mean, pstdev

from ..types import SignalDirection


class ReversionAgent:
    name = "reversion_agent"

    def generate(self, features: dict[str, float], context: dict[str, list[float]]) -> dict:
        prices = context.get("prices", [])
        volumes = context.get("volumes", [])
        entry = prices[-1] if prices else 0.0
        if len(prices) < 30 or len(volumes) < 30 or entry <= 0:
            return {
                "signal": SignalDirection.HOLD.value,
                "confidence": 0.0,
                "entry": entry,
                "stop_loss": entry,
                "take_profit": entry,
                "expected_rr": 0.0,
                "reason": "insufficient_data",
            }

        vwap = float(features.get("vwap") or 0.0)
        rsi = float(features.get("rsi") or 50.0)
        atr_pct = float(features.get("atr_pct") or 0.0)
        slope_slow = float(features.get("slope_slow") or 0.0)

        recent = prices[-40:]
        sigma = pstdev(recent) if len(recent) > 3 else 0.0
        vol_norm = sigma / max(mean(recent), 1e-9)
        adaptive_band = max(atr_pct * 1.8, vol_norm * 1.4)
        adaptive_upper_rsi = 58.0 + min(18.0, vol_norm * 420.0)
        adaptive_lower_rsi = 42.0 - min(18.0, vol_norm * 420.0)
        vwap_dev = (entry - vwap) / max(vwap, 1e-9)
        trend_block = abs(slope_slow) > max(atr_pct * 0.15, 0.0005)

        buy_setup = (vwap_dev < -adaptive_band) and (rsi < adaptive_lower_rsi) and not trend_block
        sell_setup = (vwap_dev > adaptive_band) and (rsi > adaptive_upper_rsi) and not trend_block
        if not buy_setup and not sell_setup:
            return {
                "signal": SignalDirection.HOLD.value,
                "confidence": 0.0,
                "entry": entry,
                "stop_loss": entry,
                "take_profit": entry,
                "expected_rr": 0.0,
                "reason": "no_reversion_setup",
            }

        edge = abs(vwap_dev) / max(adaptive_band, 1e-9)
        rsi_edge = abs(rsi - (adaptive_lower_rsi if buy_setup else adaptive_upper_rsi)) / 30.0
        confidence = max(0.0, min(1.0, (edge * 0.65) + (rsi_edge * 0.35)))

        signal = SignalDirection.BUY if buy_setup else SignalDirection.SELL
        sl_distance = max(atr_pct * 1.1, vol_norm * 0.9)
        tp_distance = max(atr_pct * 1.6, abs(vwap_dev) * 0.75)

        if signal == SignalDirection.BUY:
            stop = entry * (1.0 - sl_distance)
            take = min(vwap, entry * (1.0 + tp_distance))
        else:
            stop = entry * (1.0 + sl_distance)
            take = max(vwap, entry * (1.0 - tp_distance))

        rr = abs(take - entry) / max(abs(entry - stop), 1e-9)
        return {
            "signal": signal.value,
            "confidence": confidence,
            "entry": entry,
            "stop_loss": stop,
            "take_profit": take,
            "expected_rr": max(0.0, rr),
            "reason": "adaptive_rsi_vwap_mean_reversion",
            "metadata": {"vwap_deviation": vwap_dev, "adaptive_band": adaptive_band, "trend_block": float(trend_block)},
        }
