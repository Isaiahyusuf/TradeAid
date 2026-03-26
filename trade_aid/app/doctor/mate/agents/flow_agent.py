from __future__ import annotations

from ..types import SignalDirection


class FlowAgent:
    name = "flow_agent"

    def generate(self, features: dict[str, float], context: dict[str, list[float]]) -> dict:
        prices = context.get("prices", [])
        entry = prices[-1] if prices else 0.0
        if len(prices) < 18 or entry <= 0:
            return {
                "signal": SignalDirection.HOLD.value,
                "confidence": 0.0,
                "entry": entry,
                "stop_loss": entry,
                "take_profit": entry,
                "expected_rr": 0.0,
                "reason": "insufficient_data",
            }

        cvd = float(features.get("cvd") or 0.0)
        delta_div = float(features.get("delta_divergence") or 0.0)
        absorption = float(features.get("absorption") or 0.0)
        spoofing_risk = float(features.get("spoofing_risk") or 0.0)
        wallet_flow = float(features.get("large_wallet_flow") or 0.0)
        atr_pct = float(features.get("atr_pct") or 0.0)

        price_change = (prices[-1] - prices[-10]) / max(prices[-10], 1e-9)
        distribution = price_change > 0 and delta_div < 0
        accumulation = price_change < 0 and delta_div > 0

        side = SignalDirection.HOLD
        if distribution:
            side = SignalDirection.SELL
        elif accumulation:
            side = SignalDirection.BUY

        if side == SignalDirection.HOLD:
            return {
                "signal": SignalDirection.HOLD.value,
                "confidence": 0.0,
                "entry": entry,
                "stop_loss": entry,
                "take_profit": entry,
                "expected_rr": 0.0,
                "reason": "no_orderflow_divergence",
            }

        base_conf = min(1.0, abs(delta_div) / (abs(price_change) + 1e-6))
        absorption_boost = min(0.3, absorption * 0.3)
        wallet_boost = max(-0.2, min(0.2, wallet_flow * 0.2))
        spoof_penalty = min(0.35, spoofing_risk * 0.35)
        confidence = max(0.0, min(1.0, base_conf + absorption_boost + wallet_boost - spoof_penalty))

        if confidence < 0.48:
            return {
                "signal": SignalDirection.HOLD.value,
                "confidence": confidence,
                "entry": entry,
                "stop_loss": entry,
                "take_profit": entry,
                "expected_rr": 0.0,
                "reason": "flow_signal_below_quality",
            }

        stop_dist = max(atr_pct * 1.3, 0.006)
        take_dist = max(stop_dist * 1.9, atr_pct * 2.2)

        if side == SignalDirection.BUY:
            stop = entry * (1.0 - stop_dist)
            take = entry * (1.0 + take_dist)
        else:
            stop = entry * (1.0 + stop_dist)
            take = entry * (1.0 - take_dist)

        rr = abs(take - entry) / max(abs(entry - stop), 1e-9)
        return {
            "signal": side.value,
            "confidence": confidence,
            "entry": entry,
            "stop_loss": stop,
            "take_profit": take,
            "expected_rr": max(0.0, rr),
            "reason": "cvd_delta_divergence_and_absorption",
            "metadata": {
                "cvd": cvd,
                "delta_divergence": delta_div,
                "absorption": absorption,
                "spoofing_risk": spoofing_risk,
                "large_wallet_flow": wallet_flow,
            },
        }
