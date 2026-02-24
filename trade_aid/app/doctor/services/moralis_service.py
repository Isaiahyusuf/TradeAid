from __future__ import annotations

from typing import Any

from app.doctor.services.base_service import BaseDoctorApiService


class MoralisService(BaseDoctorApiService):
    def __init__(self, api_key: str) -> None:
        super().__init__()
        self._api_key = (api_key or "").strip()

    async def get_token_metadata(self, address: str) -> dict[str, Any]:
        if not address:
            return {}
        url = f"https://solana-gateway.moralis.io/token/mainnet/{address}/metadata"
        headers = {"X-API-Key": self._api_key}
        data = await self._request_json("GET", url, headers=headers, source="moralis")
        if not isinstance(data, dict):
            return {}
        return {
            "name": str(data.get("name") or ""),
            "symbol": str(data.get("symbol") or ""),
            "created_at": data.get("createdAt") or data.get("created_at"),
            "logo": data.get("logo") or data.get("image"),
            "raw": data,
        }
