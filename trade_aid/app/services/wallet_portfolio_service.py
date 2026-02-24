from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from app.config import get_settings


CHAIN_NATIVE_SYMBOL: dict[str, str] = {
    "solana": "SOL",
    "ethereum": "ETH",
    "bsc": "BNB",
    "base": "ETH",
    "arbitrum": "ETH",
    "avalanche": "AVAX",
    "polygon": "MATIC",
}

CHAIN_PRICE_ID_MAP: dict[str, str] = {
    "solana": "solana",
    "ethereum": "ethereum",
    "bsc": "binancecoin",
    "base": "ethereum",
    "arbitrum": "ethereum",
    "avalanche": "avalanche-2",
    "polygon": "matic-network",
}


async def _fetch_prices_usd(chains: list[str]) -> dict[str, float]:
    ids = sorted({CHAIN_PRICE_ID_MAP.get(chain_name) for chain_name in chains if CHAIN_PRICE_ID_MAP.get(chain_name)})
    if not ids:
        return {}

    url = f"https://api.coingecko.com/api/v3/simple/price?ids={','.join(ids)}&vs_currencies=usd"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            payload = response.json() or {}
    except Exception:
        return {}

    prices: dict[str, float] = {}
    for chain_name in chains:
        price_id = CHAIN_PRICE_ID_MAP.get(chain_name)
        usd = payload.get(price_id, {}).get("usd") if price_id else None
        try:
            prices[chain_name] = float(usd or 0)
        except Exception:
            prices[chain_name] = 0.0
    return prices


async def _fetch_solana_balance(address: str) -> float | None:
    if not address:
        return None

    settings = get_settings()
    payload: dict[str, Any] = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getBalance",
        "params": [address, {"commitment": "confirmed"}],
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(settings.SOLANA_RPC_URL, json=payload)
            response.raise_for_status()
            body = response.json() or {}
    except Exception:
        return None

    try:
        lamports = float((body.get("result") or {}).get("value") or 0)
        return lamports / 1_000_000_000
    except Exception:
        return None


async def get_wallet_portfolio_snapshot(addresses_by_chain: dict[str, str]) -> dict[str, Any]:
    normalized_addresses = {str(chain).lower(): str(addr or "").strip() for chain, addr in (addresses_by_chain or {}).items()}
    chains = sorted(normalized_addresses.keys())
    prices = await _fetch_prices_usd(chains)

    chains_payload: dict[str, Any] = {}
    total_usd = 0.0

    for chain_name in chains:
        address = normalized_addresses.get(chain_name, "")
        symbol = CHAIN_NATIVE_SYMBOL.get(chain_name, chain_name.upper())
        price_usd = float(prices.get(chain_name) or 0.0)

        native_balance: float | None = None
        data_status = "unsupported"
        if not address:
            data_status = "not_configured"
        elif chain_name == "solana":
            native_balance = await _fetch_solana_balance(address)
            data_status = "ok" if native_balance is not None else "rpc_unavailable"

        value_usd = (native_balance or 0.0) * price_usd if native_balance is not None else 0.0
        total_usd += value_usd

        chains_payload[chain_name] = {
            "address": address,
            "native_symbol": symbol,
            "native_balance": native_balance,
            "price_usd": price_usd,
            "value_usd": value_usd,
            "data_status": data_status,
        }

    return {
        "chains": chains_payload,
        "total_usd": round(total_usd, 6),
        "updated_at": datetime.utcnow().isoformat(),
    }
