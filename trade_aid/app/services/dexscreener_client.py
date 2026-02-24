from __future__ import annotations

import time
from typing import Any

import requests


BASE_URL = "https://api.dexscreener.com/latest/dex"


def safe_request(url: str, retries: int = 3, timeout: int = 10) -> dict[str, Any] | None:
    for _ in range(max(1, retries)):
        try:
            response = requests.get(url, timeout=timeout)
            if response.status_code == 200:
                return response.json() or {}
        except Exception:
            pass
        time.sleep(1)
    return None


def get_token_pairs(mint_address: str) -> dict[str, Any] | None:
    url = f"{BASE_URL}/tokens/{mint_address}"
    data = safe_request(url)
    if not data:
        return None
    if not data.get("pairs"):
        return None
    return data
