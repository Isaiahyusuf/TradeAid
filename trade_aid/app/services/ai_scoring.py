from __future__ import annotations

from typing import Any


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value or default)
    except Exception:
        return default


class FreshTokenAIScoring:
    def score(self, token: dict[str, Any]) -> dict[str, Any]:
        liquidity = _safe_float(token.get("liquidity"), 0.0)
        volume_24h = _safe_float(token.get("volume"), 0.0)
        volume_5m = _safe_float(((token.get("dex") or {}).get("volume") or {}).get("m5"), 0.0)
        volume_1h = _safe_float(((token.get("dex") or {}).get("volume") or {}).get("h1"), 0.0)
        market_cap = _safe_float(token.get("market_cap"), 0.0)
        holder_growth = _safe_float(token.get("holder_growth"), 0.0)
        dev_wallet_pct = _safe_float(token.get("dev_wallet_pct"), 0.0)

        liquidity_strength = min(100.0, (liquidity / 25000.0) * 100.0)
        baseline_5m = max(volume_1h / 12.0, 1.0)
        volume_acceleration = min(100.0, (volume_5m / baseline_5m) * 50.0)
        holder_growth_score = min(100.0, max(0.0, 50.0 + holder_growth))
        dev_wallet_activity = max(0.0, min(100.0, 100.0 - (dev_wallet_pct * 8.0)))
        market_cap_velocity = min(100.0, (volume_24h / max(market_cap, 1.0)) * 100.0)

        score = (
            liquidity_strength * 0.28
            + volume_acceleration * 0.26
            + holder_growth_score * 0.14
            + dev_wallet_activity * 0.18
            + market_cap_velocity * 0.14
        )
        score = max(0.0, min(100.0, score))

        if score >= 80:
            risk = "LOW"
            confidence = "HIGH"
        elif score >= 65:
            risk = "MEDIUM"
            confidence = "MEDIUM"
        else:
            risk = "HIGH"
            confidence = "LOW"

        return {
            "score": round(score, 2),
            "risk": risk,
            "confidence": confidence,
            "factors": {
                "liquidity_strength": round(liquidity_strength, 2),
                "volume_acceleration": round(volume_acceleration, 2),
                "holder_growth": round(holder_growth_score, 2),
                "dev_wallet_activity": round(dev_wallet_activity, 2),
                "market_cap_velocity": round(market_cap_velocity, 2),
            },
        }


ai_scoring_service = FreshTokenAIScoring()
