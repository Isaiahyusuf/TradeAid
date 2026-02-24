from __future__ import annotations

from typing import Any

from app.doctor.services.base_service import BaseDoctorApiService


class HeliusService(BaseDoctorApiService):
    def __init__(self, api_key: str) -> None:
        super().__init__()
        self._api_key = (api_key or "").strip()
        self._rpc_url = f"https://mainnet.helius-rpc.com/?api-key={self._api_key}"

    async def get_token_supply(self, mint_address: str) -> float:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTokenSupply",
            "params": [mint_address],
        }
        data = await self._request_json("POST", self._rpc_url, json=payload, source="helius")
        value = ((((data or {}).get("result") or {}).get("value") or {}).get("uiAmount") or 0.0) if isinstance(data, dict) else 0.0
        return float(value or 0.0)

    async def get_holder_distribution(self, mint_address: str) -> dict[str, Any]:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTokenLargestAccounts",
            "params": [mint_address],
        }
        data = await self._request_json("POST", self._rpc_url, json=payload, source="helius")
        rows = ((((data or {}).get("result") or {}).get("value") or []) if isinstance(data, dict) else [])
        amounts = [float((row or {}).get("uiAmount") or 0.0) for row in rows[:10]]
        total = sum(amounts) if amounts else 0.0
        top3 = sum(amounts[:3])
        top3_pct = (top3 / total * 100.0) if total > 0 else 0.0
        return {"top3_holder_pct": round(top3_pct, 4), "accounts": len(rows)}

    async def detect_fresh_mints(self, limit: int = 100) -> list[dict[str, Any]]:
        url = f"https://api.helius.xyz/v0/mints?api-key={self._api_key}"
        data = await self._request_json("GET", url, source="helius")
        if isinstance(data, list):
            return [row for row in data if isinstance(row, dict)][: max(1, limit)]
        if isinstance(data, dict):
            rows = data.get("result") or data.get("mints") or []
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)][: max(1, limit)]
        return []

    async def monitor_whale_wallets(self, wallets: list[str]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for wallet in wallets[:25]:
            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getBalance",
                "params": [wallet],
            }
            data = await self._request_json("POST", self._rpc_url, json=payload, source="helius")
            lamports = float((((data or {}).get("result") or {}).get("value") or 0.0) if isinstance(data, dict) else 0.0)
            result[wallet] = {"balance_sol": lamports / 1_000_000_000}
        return result
