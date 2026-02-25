from __future__ import annotations

from typing import Any

from app.doctor.services.base_service import BaseDoctorApiService


class JupiterService(BaseDoctorApiService):
    def __init__(self, api_key: str) -> None:
        super().__init__()
        self._api_key = (api_key or "").strip()
        self._quote_urls = [
            "https://quote-api.jup.ag/v6/quote",
            "https://lite-api.jup.ag/swap/v1/quote",
        ]
        self._swap_urls = [
            "https://quote-api.jup.ag/v6/swap",
            "https://lite-api.jup.ag/swap/v1/swap",
        ]

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    async def get_best_route(self, input_mint: str, output_mint: str, amount_lamports: int, slippage_bps: int = 200) -> dict[str, Any]:
        params = {
            "inputMint": input_mint,
            "outputMint": output_mint,
            "amount": str(max(1, int(amount_lamports))),
            "slippageBps": str(max(1, int(slippage_bps))),
            "onlyDirectRoutes": "false",
        }
        for quote_url in self._quote_urls:
            data = await self._request_json("GET", quote_url, params=params, headers=self._headers(), source="jupiter")
            if isinstance(data, dict) and (data.get("outAmount") is not None or data.get("routePlan") is not None):
                return data
        return {}

    async def simulate_trade(self, input_mint: str, output_mint: str, amount_lamports: int, slippage_bps: int = 200) -> dict[str, Any]:
        route = await self.get_best_route(input_mint, output_mint, amount_lamports, slippage_bps=slippage_bps)
        price_impact = float(route.get("priceImpactPct") or 0.0)
        out_amount = int(route.get("outAmount") or 0)
        in_amount = int(route.get("inAmount") or amount_lamports)
        min_output = int(out_amount * (1 - (slippage_bps / 10_000.0))) if out_amount > 0 else 0
        approved = price_impact <= 0.05 and out_amount > 0 and in_amount > 0
        return {
            "approved": approved,
            "price_impact_pct": round(price_impact * 100.0, 4),
            "out_amount": out_amount,
            "in_amount": in_amount,
            "min_output": min_output,
            "reason": None if approved else ("price_impact_above_5pct" if price_impact > 0.05 else "invalid_route"),
            "route": route,
        }

    async def execute_swap(self, wallet_pubkey: str, route: dict[str, Any], wrap_unwrap_sol: bool = True) -> dict[str, Any]:
        payload = {
            "quoteResponse": route,
            "userPublicKey": wallet_pubkey,
            "wrapAndUnwrapSol": bool(wrap_unwrap_sol),
        }
        for swap_url in self._swap_urls:
            data = await self._request_json("POST", swap_url, json=payload, headers=self._headers(), source="jupiter")
            if isinstance(data, dict) and data:
                return data
        return {}
