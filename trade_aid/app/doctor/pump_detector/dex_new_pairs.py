from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx


class DexNewPairsScanner:
    def __init__(self, *, min_liquidity_usd: float) -> None:
        self.min_liquidity_usd = float(min_liquidity_usd)
        self._search_terms = ["pump.fun", "raydium", "solana meme", "new pair"]

    @staticmethod
    def _age_minutes(created_ms: Any) -> float:
        try:
            value = float(created_ms or 0.0)
            if value <= 0:
                return 99999.0
            dt = datetime.utcfromtimestamp(value / 1000.0)
            return max(0.0, (datetime.utcnow() - dt).total_seconds() / 60.0)
        except Exception:
            return 99999.0

    async def fetch_new_pairs(self, max_age_minutes: float = 5.0) -> list[dict[str, Any]]:
        unique: dict[str, dict[str, Any]] = {}
        async with httpx.AsyncClient(timeout=12.0) as client:
            for term in self._search_terms:
                try:
                    response = await client.get(f"https://api.dexscreener.com/latest/dex/search?q={term}")
                    if response.status_code >= 400:
                        continue
                    rows = (response.json() or {}).get("pairs", []) or []
                except Exception:
                    continue

                for pair in rows:
                    if not isinstance(pair, dict):
                        continue
                    if str(pair.get("chainId") or "").lower() != "solana":
                        continue
                    age_minutes = self._age_minutes(pair.get("pairCreatedAt"))
                    if age_minutes > max_age_minutes:
                        continue
                    liquidity = float(((pair.get("liquidity") or {}).get("usd") or 0.0))
                    if liquidity < self.min_liquidity_usd:
                        continue
                    dex_id = str(pair.get("dexId") or "").lower()
                    url = str(pair.get("url") or "").lower()
                    if "pump" not in dex_id and "raydium" not in dex_id and "pump" not in url and "raydium" not in url:
                        continue

                    base = pair.get("baseToken") or {}
                    mint = str(base.get("address") or "").strip()
                    if not mint:
                        continue
                    unique[mint] = {
                        "mint_address": mint,
                        "symbol": str(base.get("symbol") or ""),
                        "name": str(base.get("name") or ""),
                        "liquidity": liquidity,
                        "dex_id": str(pair.get("dexId") or ""),
                        "pair_address": str(pair.get("pairAddress") or ""),
                        "pair_created_at": pair.get("pairCreatedAt"),
                        "age_minutes": round(age_minutes, 4),
                        "source": "dex_new_pairs",
                    }
        return list(unique.values())
