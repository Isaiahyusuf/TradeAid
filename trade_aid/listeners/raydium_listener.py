from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, Iterable, List

import requests

from core.token_queue import send_to_tradeaid

logger = logging.getLogger("tradeaid.listener.raydium")

SOLANA_RPC_URL = os.getenv("HELIUS_RPC_URL") or os.getenv("SOLANA_RPC_URL") or "https://api.mainnet-beta.solana.com"
RAYDIUM_PROGRAM_ID = os.getenv("RAYDIUM_AMM_PROGRAM_ID", "675kPX9MHTjS2zt1qfr1NYHuzeFvQy2f6YvP6Vf3wGZ")
RAYDIUM_POLL_SECONDS = float(os.getenv("RAYDIUM_POLL_SECONDS", "6"))
RAYDIUM_SIGNATURE_LIMIT = int(os.getenv("RAYDIUM_SIGNATURE_LIMIT", "50"))


def _rpc(method: str, params: List[Any]) -> Any:
    response = requests.post(
        SOLANA_RPC_URL,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    return payload.get("result")


def _get_recent_signatures() -> Iterable[Dict[str, Any]]:
    result = _rpc("getSignaturesForAddress", [RAYDIUM_PROGRAM_ID, {"limit": RAYDIUM_SIGNATURE_LIMIT}])
    return result if isinstance(result, list) else []


def _get_transaction(signature: str) -> Dict[str, Any] | None:
    result = _rpc(
        "getTransaction",
        [
            signature,
            {
                "encoding": "jsonParsed",
                "maxSupportedTransactionVersion": 0,
                "commitment": "confirmed",
            },
        ],
    )
    return result if isinstance(result, dict) else None


def _extract_mints_from_initialize_pool(tx: Dict[str, Any]) -> List[str]:
    message = ((tx.get("transaction") or {}).get("message") or {})
    instructions = message.get("instructions") or []
    account_keys = message.get("accountKeys") or []

    key_lookup: List[str] = []
    for key in account_keys:
        if isinstance(key, str):
            key_lookup.append(key)
        elif isinstance(key, dict):
            key_lookup.append(str(key.get("pubkey") or ""))

    found: List[str] = []
    for instruction in instructions:
        if not isinstance(instruction, dict):
            continue

        program_id = str(instruction.get("programId") or "")
        if not program_id:
            idx = instruction.get("programIdIndex")
            if isinstance(idx, int) and 0 <= idx < len(key_lookup):
                program_id = key_lookup[idx]

        if program_id != RAYDIUM_PROGRAM_ID:
            continue

        parsed = instruction.get("parsed") or {}
        parsed_type = str(parsed.get("type") or "").lower()
        if "initialize" not in parsed_type or "pool" not in parsed_type:
            continue

        info = parsed.get("info") or {}
        for key in ("coinMint", "pcMint", "baseMint", "quoteMint", "tokenMint"):
            mint = str(info.get(key) or "").strip()
            if mint:
                found.append(mint)

    return found


def run_raydium_listener() -> None:
    seen_signatures: set[str] = set()
    seen_mints: set[str] = set()
    logger.info("[Raydium] listener started")

    while True:
        try:
            signatures = _get_recent_signatures()
            for row in signatures:
                signature = str(row.get("signature") or "").strip()
                if not signature or signature in seen_signatures:
                    continue

                seen_signatures.add(signature)
                tx = _get_transaction(signature)
                if not tx:
                    continue

                mints = _extract_mints_from_initialize_pool(tx)
                for mint in mints:
                    if not mint or mint in seen_mints:
                        continue
                    seen_mints.add(mint)
                    token = {
                        "source": "raydium",
                        "mint": mint,
                        "signature": signature,
                    }
                    logger.info("NEW RAYDIUM POOL TOKEN %s", token)
                    send_to_tradeaid(token)
        except Exception as exc:
            logger.warning("raydium listener error %s", exc)

        time.sleep(RAYDIUM_POLL_SECONDS)
