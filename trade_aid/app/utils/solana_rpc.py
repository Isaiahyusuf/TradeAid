from __future__ import annotations

from app.config import Settings


DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com"
DEFAULT_SOLANA_WS_URL = "wss://api.mainnet-beta.solana.com"


def _dedupe_keep_order(values: list[str]) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for value in values:
        item = str(value or "").strip()
        if not item or item in seen:
            continue
        unique.append(item)
        seen.add(item)
    return unique


def solana_rpc_endpoints(settings: Settings) -> list[str]:
    helius_rpc = str(getattr(settings, "HELIUS_RPC_URL", "") or "").strip()
    configured = str(getattr(settings, "SOLANA_RPC_URL", "") or "").strip()
    return _dedupe_keep_order([helius_rpc, configured, DEFAULT_SOLANA_RPC_URL])


def solana_ws_endpoints(settings: Settings) -> list[str]:
    helius_api_key = str(getattr(settings, "HELIUS_API_KEY", "") or "").strip()
    helius_ws = f"wss://mainnet.helius-rpc.com/?api-key={helius_api_key}" if helius_api_key else ""
    configured = str(getattr(settings, "SOLANA_WS_URL", "") or "").strip()
    return _dedupe_keep_order([helius_ws, configured, DEFAULT_SOLANA_WS_URL])
