from __future__ import annotations

from typing import Any

from app.doctor.services.base_service import BaseDoctorApiService


class SolscanService(BaseDoctorApiService):
    def __init__(self, api_key: str, *, min_liquidity_usd: float) -> None:
        super().__init__()
        self._api_key = (api_key or "").strip()
        self._min_liquidity_usd = float(min_liquidity_usd)

    async def get_token_meta(self, token_address: str) -> dict[str, Any]:
        if not token_address:
            return {}
        url = "https://pro-api.solscan.io/v1.0/token/meta"
        headers = {"accept": "application/json"}
        if self._api_key:
            headers["token"] = self._api_key
        params = {"tokenAddress": token_address}
        data = await self._request_json("GET", url, headers=headers, params=params, source="solscan")
        if isinstance(data, dict):
            return data

        fallback_url = "https://public-api.solscan.io/token/meta"
        fallback = await self._request_json("GET", fallback_url, headers={"accept": "application/json"}, params=params, source="solscan")
        return fallback if isinstance(fallback, dict) else {}

    async def validate_holder_risk(self, token_address: str) -> dict[str, Any]:
        data = await self.get_token_meta(token_address)
        top_holders = data.get("topHolders") or data.get("top_holders") or []
        top3_pct = 0.0
        if isinstance(top_holders, list):
            for row in top_holders[:3]:
                top3_pct += float((row or {}).get("percent") or (row or {}).get("percentage") or 0.0)
        holder_count = int(data.get("holder") or data.get("holder_count") or 0)

        liquidity_usd = float(data.get("liquidity") or data.get("liquidityUsd") or 0.0)
        passed = top3_pct <= 40.0 and liquidity_usd >= self._min_liquidity_usd

        return {
            "passed": passed,
            "top3_holder_pct": round(top3_pct, 4),
            "holder_count": holder_count,
            "liquidity_usd": liquidity_usd,
            "reason": None if passed else ("top_holders_concentrated" if top3_pct > 40.0 else "liquidity_too_low"),
            "raw": data,
        }
