from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value or default)
    except Exception:
        return default


def _age_minutes(token: dict[str, Any]) -> float:
    timestamp = token.get("timestamp")
    if not timestamp:
        return 99999.0
    try:
        dt = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
        now = datetime.now(tz=timezone.utc)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0.0, (now - dt).total_seconds() / 60.0)
    except Exception:
        return 99999.0


def pre_filter(token: dict[str, Any]) -> tuple[bool, str]:
    liquidity = _safe_float(token.get("liquidity"), 0.0)
    market_cap = _safe_float(token.get("market_cap"), 0.0)
    volume = _safe_float(token.get("volume"), 0.0)
    age_minutes = _age_minutes(token)

    if liquidity < 2000.0:
        return False, "liquidity_below_2000"
    if market_cap > 500000.0:
        return False, "market_cap_above_500k"
    if age_minutes > 3.0:
        return False, "token_age_above_3m"
    if volume < 500.0:
        return False, "volume_below_500"

    return True, "passed"
