import time
from typing import Any, Dict, List

import requests

from tradeaid.core.token_queue import enqueue_token

SEEN = set()
PUMPFUN_URL = "https://frontend-api.pump.fun/coins?offset=0&limit=100&sort=created_timestamp&order=DESC&includeNsfw=false"
PUMPFUN_BASE_POLL_SECONDS = 10
PUMPFUN_MAX_BACKOFF_SECONDS = 20


def _normalize_rows(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        rows = payload.get("coins") or payload.get("data") or []
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    return []


def fetch_pumpfun_tokens() -> bool:
    try:
        response = requests.get(PUMPFUN_URL, timeout=10)
        response.raise_for_status()
        rows = _normalize_rows(response.json())
        added = 0

        for token in rows:
            mint = str(token.get("mint") or "").strip()
            if not mint or mint in SEEN:
                continue

            SEEN.add(mint)
            token_data = {
                "source": "pumpfun",
                "name": token.get("name"),
                "symbol": token.get("symbol"),
                "mint": mint,
                "creator": token.get("creator"),
                "marketCapUsd": token.get("usd_market_cap"),
                "volumeUsd": token.get("volume_24h"),
            }
            print("[Pump.fun Feed] NEW TOKEN DETECTED", token_data)
            enqueue_token(token_data)
            added += 1

        if added > 0:
            print(f"[Pump.fun Feed] Added {added} new tokens")
        else:
            print("[Pump.fun Feed] No new tokens this cycle")
        return True
    except Exception as exc:
        print("[Pump.fun Feed] ERROR:", exc)
        return False


def start_pumpfun_listener() -> None:
    sleep_seconds = PUMPFUN_BASE_POLL_SECONDS

    while True:
        ok = fetch_pumpfun_tokens()
        if ok:
            sleep_seconds = PUMPFUN_BASE_POLL_SECONDS
        else:
            sleep_seconds = min(PUMPFUN_MAX_BACKOFF_SECONDS, max(PUMPFUN_BASE_POLL_SECONDS, sleep_seconds * 2))
            print(f"[Pump.fun Feed] Backoff active, retrying in {sleep_seconds}s")

        time.sleep(sleep_seconds)
