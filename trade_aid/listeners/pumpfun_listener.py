from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, Iterable, List

import requests

from core.dedup_store import dedup_store
from core.token_queue import send_to_tradeaid

logger = logging.getLogger("tradeaid.listener.pumpfun")

PUMPFUN_URL = os.getenv("PUMPFUN_FEED_URL", "https://frontend-api.pump.fun/coins")
PUMP_INTERVAL_SECONDS = float(os.getenv("PUMPFUN_POLL_SECONDS", "5"))
PUMP_LIMIT = int(os.getenv("PUMPFUN_LIMIT", "100"))


def _fetch_pumpfun() -> Iterable[Dict[str, Any]]:
    params = {
        "offset": 0,
        "limit": PUMP_LIMIT,
        "sort": "created_timestamp",
        "order": "DESC",
        "includeNsfw": "false",
    }
    response = requests.get(PUMPFUN_URL, params=params, timeout=15)
    response.raise_for_status()
    data = response.json()
    return data if isinstance(data, list) else []


def run_pumpfun_listener() -> None:
    logger.info("[Pump.fun Feed] listener started")

    while True:
        try:
            for token in _fetch_pumpfun():
                mint = str(token.get("mint") or token.get("address") or "").strip()
                if not mint:
                    continue
                if not dedup_store.mark_if_new(f"listener:pumpfun:{mint}"):
                    continue
                launch = {
                    "source": "pumpfun",
                    "name": token.get("name"),
                    "symbol": token.get("symbol"),
                    "mint": mint,
                    "creator": token.get("creator"),
                }
                logger.info("NEW PUMPFUN TOKEN %s", launch)
                send_to_tradeaid(launch)
        except Exception as exc:
            logger.warning("pumpfun error %s", exc)

        time.sleep(PUMP_INTERVAL_SECONDS)
