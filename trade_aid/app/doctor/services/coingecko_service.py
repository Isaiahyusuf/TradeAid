from __future__ import annotations

from typing import Any

from app.doctor.services.base_service import BaseDoctorApiService


class CoinGeckoService(BaseDoctorApiService):
    def __init__(self, api_key: str, *, min_volume_usd: float) -> None:
        super().__init__()
        self._api_key = (api_key or "").strip()
        self._min_volume_usd = float(min_volume_usd)

    async def get_token_market(self, token_address: str) -> dict[str, Any]:
        if not token_address:
            return {}
        url = "https://pro-api.coingecko.com/api/v3/simple/price"
        params = {
            "ids": "",
            "vs_currencies": "usd",
            "contract_addresses": token_address,
            "include_24hr_vol": "true",
            "include_market_cap": "true",
        }
        headers = {"x-cg-pro-api-key": self._api_key}
        data = await self._request_json("GET", url, params=params, headers=headers, source="coingecko")
        if not isinstance(data, dict):
            return {}
        token_row = data.get(token_address.lower()) or data.get(token_address) or {}
        if not isinstance(token_row, dict):
            return {}
        return {
            "price_usd": float(token_row.get("usd") or 0.0),
            "volume_24h": float(token_row.get("usd_24h_vol") or 0.0),
            "market_cap": float(token_row.get("usd_market_cap") or 0.0),
        }

    def validate_volume(self, volume_24h: float) -> bool:
        return float(volume_24h or 0.0) >= self._min_volume_usd
