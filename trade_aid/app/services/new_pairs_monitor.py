from __future__ import annotations

import time
from typing import Any

from app.services.dexscreener_client import safe_request


def get_latest_solana_pairs() -> list[dict[str, Any]]:
    url = "https://api.dexscreener.com/latest/dex/pairs/solana"
    data = safe_request(url)
    if not data:
        return []

    pairs = data.get("pairs") or []
    if not isinstance(pairs, list):
        return []

    current_time = int(time.time() * 1000)
    fresh: list[dict[str, Any]] = []
    for pair in pairs:
        if not isinstance(pair, dict):
            continue
        created = pair.get("pairCreatedAt")
        try:
            created_ms = int(created)
        except Exception:
            continue
        if (current_time - created_ms) < 5 * 60 * 1000:
            fresh.append(pair)

    return fresh
