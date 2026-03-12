from __future__ import annotations

import os


HELIUS_API_KEY = str(os.getenv("HELIUS_API_KEY") or "").strip()
HELIUS_WS = f"wss://mainnet.helius-rpc.com/?api-key={HELIUS_API_KEY}" if HELIUS_API_KEY else ""
HELIUS_RPC = f"https://mainnet.helius-rpc.com/?api-key={HELIUS_API_KEY}" if HELIUS_API_KEY else ""

SOLANA_PUBLIC_RPC = "https://api.mainnet-beta.solana.com"
SOLANA_PUBLIC_WS = "wss://api.mainnet-beta.solana.com"

PUMPFUN_PROGRAM = str(
    os.getenv("PUMPFUN_PROGRAM_ID") or "6EF8rrecthR5Dkzon8Nwu78hRjzJ3AL9rS6pNqB7pump"
).strip()
