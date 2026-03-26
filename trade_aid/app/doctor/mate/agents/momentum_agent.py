from __future__ import annotations

from statistics import quantiles

from ..types import SignalDirection


class MomentumAgent:
    name = "momentum_agent"

    def generate(self, features: dict[str, float], context: dict[str, list[float]]) -> dict:
        prices = context.get("prices", [])
        highs = context.get("highs", [])
        entry = prices[-1] if prices else 0.0
        if len(prices) < 25 or len(highs) < 25 or entry <= 0:
            return {
                "signal": SignalDirection.HOLD.value,
                "confidence": 0.0,
                "entry": entry,
                "stop_loss": entry,
                "take_profit": entry,
                "expected_rr": 0.0,
                "reason": "insufficient_data",
            }

        lookback = min(35, len(highs) - 1)
        prior_high = max(highs[-lookback:-1])
        breakout_size = max(0.0, (entry - prior_high) / max(prior_high, 1e-9))
        volume_z = float(features.get("volume_zscore") or 0.0)
        liquidity_inflow = float(features.get("liquidity_inflow") or 0.0)
        trend_fast = float(features.get("slope_fast") or 0.0)
        trend_slow = float(features.get("slope_slow") or 0.0)
        atr_pct = float(features.get("atr_pct") or 0.0)

        price_returns = [abs(prices[i] - prices[i - 1]) / max(prices[i - 1], 1e-9) for i in range(1, len(prices))]
        adaptive_breakout = quantiles(price_returns[-40:], n=5)[-1] if len(price_returns) >= 40 else max(0.002, atr_pct)
        fake_breakout = entry < (prior_high * (1.0 + (0.25 * adaptive_breakout)))
        mtf_confirmed = trend_fast > 0 and trend_slow > 0

        raw_conf = (breakout_size / max(adaptive_breakout, 1e-6)) * 0.45
        raw_conf += max(0.0, volume_z) * 0.2
        raw_conf += max(0.0, liquidity_inflow) * 0.2
        raw_conf += (1.0 if mtf_confirmed else -0.6) * 0.15
        if fake_breakout:
            raw_conf *= 0.45

        confidence = max(0.0, min(1.0, raw_conf))
        if confidence < 0.5:
            return {
                "signal": SignalDirection.HOLD.value,
                "confidence": confidence,
                "entry": entry,
                "stop_loss": entry,
                "take_profit": entry,
                "expected_rr": 0.0,
                "reason": "no_clean_breakout",
            }

        stop = entry * (1.0 - max(0.004, atr_pct * 0.8))
        take = entry * (1.0 + max(0.008, atr_pct * 2.0))
        rr = (take - entry) / max(entry - stop, 1e-9)
        return {
            "signal": SignalDirection.BUY.value,
            "confidence": confidence,
            "entry": entry,
            "stop_loss": stop,
            "take_profit": take,
            "expected_rr": max(0.0, rr),
            "reason": "breakout_with_volume_and_mtf_confirmation",
            "metadata": {"fake_breakout": float(fake_breakout), "volume_z": volume_z, "liquidity_inflow": liquidity_inflow},
        }
