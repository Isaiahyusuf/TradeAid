from __future__ import annotations

from typing import Any

from app.doctor.services.base_service import BaseDoctorApiService
from app.config import get_settings
from app.utils.solana_rpc import solana_rpc_endpoints


class HeliusService(BaseDoctorApiService):
    def __init__(self, api_key: str) -> None:
        super().__init__()
        self._api_key = (api_key or "").strip()
        self._rpc_url = f"https://mainnet.helius-rpc.com/?api-key={self._api_key}" if self._api_key else ""
        settings = get_settings()
        self._rpc_urls = solana_rpc_endpoints(settings)

    async def _rpc_request(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        for rpc_url in self._rpc_urls:
            data = await self._request_json("POST", rpc_url, json=payload, source="helius")
            if isinstance(data, dict) and data.get("result") is not None:
                return data
        return None

    async def get_token_supply(self, mint_address: str) -> float:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTokenSupply",
            "params": [mint_address],
        }
        data = await self._rpc_request(payload)
        value = ((((data or {}).get("result") or {}).get("value") or {}).get("uiAmount") or 0.0) if isinstance(data, dict) else 0.0
        return float(value or 0.0)

    async def get_holder_distribution(self, mint_address: str) -> dict[str, Any]:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTokenLargestAccounts",
            "params": [mint_address],
        }
        data = await self._rpc_request(payload)
        rows = ((((data or {}).get("result") or {}).get("value") or []) if isinstance(data, dict) else [])
        amounts = [float((row or {}).get("uiAmount") or 0.0) for row in rows[:10]]
        total = sum(amounts) if amounts else 0.0
        top3 = sum(amounts[:3])
        top3_pct = (top3 / total * 100.0) if total > 0 else 0.0
        return {"top3_holder_pct": round(top3_pct, 4), "accounts": len(rows)}

    async def detect_fresh_mints(self, limit: int = 100) -> list[dict[str, Any]]:
        if self._api_key:
            url = f"https://api.helius.xyz/v0/mints?api-key={self._api_key}"
            data = await self._request_json("GET", url, source="helius")
            if isinstance(data, list):
                return [row for row in data if isinstance(row, dict)][: max(1, limit)]
            if isinstance(data, dict):
                rows = data.get("result") or data.get("mints") or []
                if isinstance(rows, list):
                    return [row for row in rows if isinstance(row, dict)][: max(1, limit)]

        for rpc_url in self._rpc_urls:
            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getSignaturesForAddress",
                "params": [
                    "So11111111111111111111111111111111111111112",
                    {"limit": max(1, min(limit, 200))},
                ],
            }
            data = await self._request_json("POST", rpc_url, json=payload, source="helius")
            rows = (data or {}).get("result") if isinstance(data, dict) else []
            if isinstance(rows, list) and rows:
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
            data = await self._rpc_request(payload)
            lamports = float((((data or {}).get("result") or {}).get("value") or 0.0) if isinstance(data, dict) else 0.0)
            result[wallet] = {"balance_sol": lamports / 1_000_000_000}
        return result

    async def get_transaction(self, signature: str) -> dict[str, Any] | None:
        sig = str(signature or "").strip()
        if not sig:
            return None
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTransaction",
            "params": [
                sig,
                {
                    "commitment": "processed",
                    "encoding": "jsonParsed",
                    "maxSupportedTransactionVersion": 0,
                },
            ],
        }
        data = await self._rpc_request(payload)
        result = (data or {}).get("result") if isinstance(data, dict) else None
        return result if isinstance(result, dict) else None

    async def get_mint_account_info(self, mint_address: str) -> dict[str, Any] | None:
        mint = str(mint_address or "").strip()
        if not mint:
            return None
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getAccountInfo",
            "params": [
                mint,
                {
                    "encoding": "jsonParsed",
                    "commitment": "processed",
                },
            ],
        }
        data = await self._rpc_request(payload)
        result = (data or {}).get("result") if isinstance(data, dict) else None
        value = (result or {}).get("value") if isinstance(result, dict) else None
        return value if isinstance(value, dict) else None

    async def is_mint_authority_active(self, mint_address: str) -> bool:
        account = await self.get_mint_account_info(mint_address)
        parsed = (((account or {}).get("data") or {}).get("parsed") or {}) if isinstance(account, dict) else {}
        info = (parsed or {}).get("info") if isinstance(parsed, dict) else {}
        if not isinstance(info, dict):
            return False

        # Any non-null mint authority implies token supply can still be minted.
        authority = info.get("mintAuthority")
        if authority:
            return True
        authority_option = info.get("mintAuthorityOption")
        try:
            return int(authority_option or 0) > 0
        except Exception:
            return False
