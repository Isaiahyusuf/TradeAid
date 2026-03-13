import time
from typing import Any, Dict, List

import requests

from tradeaid.core.token_queue import enqueue_token

SEEN_PAIRS = set()
SOLANA_CHAIN = "solana"
DEXSCREEN_ENDPOINTS = [
    "https://api.dexscreener.com/latest/dex/pairs/solana",
    "https://api.dexscreener.com/token-profiles/latest/v1",
]


def _rows_from_payload(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, dict) and isinstance(payload.get("pairs"), list):
        return [row for row in payload["pairs"] if isinstance(row, dict)]
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    return []


def fetch_dex_pairs() -> None:
    last_error = None

    for url in DEXSCREEN_ENDPOINTS:
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            rows = _rows_from_payload(response.json())

            added = 0
            for pair in rows:
                chain_id = str(pair.get("chainId") or "").strip().lower()
                if chain_id and chain_id != SOLANA_CHAIN:
                    continue

                pair_addr = str(pair.get("pairAddress") or pair.get("tokenAddress") or "").strip()
                if not pair_addr or pair_addr in SEEN_PAIRS:
                    continue

                base = pair.get("baseToken") if isinstance(pair.get("baseToken"), dict) else {}
                liquidity = pair.get("liquidity") if isinstance(pair.get("liquidity"), dict) else {}
                volume = pair.get("volume") if isinstance(pair.get("volume"), dict) else {}
                mint = str(base.get("address") or pair.get("tokenAddress") or "").strip()
                if not mint or mint.startswith("0x"):
                    continue

                SEEN_PAIRS.add(pair_addr)

                token = {
                    "source": "dexscreener",
                    "mint": mint,
                    "symbol": base.get("symbol") or pair.get("symbol") or "",
                    "liquidityUsd": liquidity.get("usd") or pair.get("liquidityUsd") or 0,
                    "volumeUsd": volume.get("h24") or pair.get("volumeUsd") or 0,
                }
                print("[Dexscreener Fallback] NEW TOKEN DETECTED", token)
                enqueue_token(token)
                added += 1

            if added > 0:
                print(f"[Dexscreener Fallback] Added {added} new entries from {url}")
            else:
                print(f"[Dexscreener Fallback] No new Solana entries from {url}")
            return
        except Exception as exc:
            last_error = exc

    print("[Dexscreener Fallback] ERROR:", last_error)


def start_dexscreener_listener() -> None:
    while True:
        fetch_dex_pairs()
        time.sleep(10)
