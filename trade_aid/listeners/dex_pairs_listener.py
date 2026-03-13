from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, Iterable

import requests

from core.dedup_store import dedup_store
from core.token_queue import send_to_tradeaid

logger = logging.getLogger("tradeaid.listener.dexpairs")

DEX_PAIRS_URL = os.getenv("DEX_SOL_PAIRS_URL", "https://api.dexscreener.com/latest/dex/pairs/solana")
DEX_INTERVAL_SECONDS = float(os.getenv("DEX_PAIRS_POLL_SECONDS", "10"))


def _fetch_pairs() -> Iterable[Dict[str, Any]]:
    response = requests.get(DEX_PAIRS_URL, timeout=15)
    response.raise_for_status()
    payload = response.json()
    pairs = payload.get("pairs") if isinstance(payload, dict) else None
    return pairs if isinstance(pairs, list) else []


def run_dex_pairs_listener() -> None:
    logger.info("[Dex Pairs] listener started")

    while True:
        try:
            for pair in _fetch_pairs():
                pair_address = str(pair.get("pairAddress") or "").strip()
                if not pair_address:
                    continue
                if not dedup_store.mark_if_new(f"listener:dex:pair:{pair_address}"):
                    continue
                base = pair.get("baseToken") or {}
                mint = str(base.get("address") or "").strip()
                if mint and not dedup_store.mark_if_new(f"listener:dex:mint:{mint}"):
                    continue
                liquidity = (pair.get("liquidity") or {}).get("usd")
                volume = (pair.get("volume") or {}).get("h24")
                token = {
                    "source": "dexscreener",
                    "mint": mint,
                    "symbol": base.get("symbol"),
                    "liquidity": liquidity,
                    "volume": volume,
                    "pair_address": pair_address,
                }
                logger.info("NEW DEX PAIR TOKEN %s", token)
                send_to_tradeaid(token)
        except Exception as exc:
            logger.warning("dex pairs error %s", exc)

        time.sleep(DEX_INTERVAL_SECONDS)
