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
        headers: dict[str, str] = {}
        if self._api_key:
            headers["x-cg-pro-api-key"] = self._api_key

        primary_url = f"https://pro-api.coingecko.com/api/v3/coins/solana/contract/{token_address}"
        data = await self._request_json("GET", primary_url, headers=headers, source="coingecko")

        if not isinstance(data, dict):
            fallback_url = f"https://api.coingecko.com/api/v3/coins/solana/contract/{token_address}"
            data = await self._request_json("GET", fallback_url, source="coingecko")
            if not isinstance(data, dict):
                return {}

        market_data = data.get("market_data") or {}
        if not isinstance(market_data, dict):
            return {}

        return {
            "price_usd": float(((market_data.get("current_price") or {}).get("usd") or 0.0)),
            "volume_24h": float(((market_data.get("total_volume") or {}).get("usd") or 0.0)),
            "market_cap": float(((market_data.get("market_cap") or {}).get("usd") or 0.0)),
        }

    def validate_volume(self, volume_24h: float) -> bool:
        return float(volume_24h or 0.0) >= self._min_volume_usd
