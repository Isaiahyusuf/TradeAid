import asyncio
import json
import os
from typing import Any, Dict, Iterable, List

import requests

from websockets import connect

from tradeaid.core.token_queue import enqueue_token

RAYDIUM_PROGRAM_ID = "RVKd61ztZW9Vbku1K8K7hVjsvXyX89cvXtkJ6kM6n8y"
ORCA_WHIRLPOOL_PROGRAM_ID = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
SOLANA_WS_URL = "wss://api.mainnet-beta.solana.com/"
POLL_INTERVAL_SECONDS = 10
POLL_BACKOFF_MAX_SECONDS = 60
SEEN_SIGNATURES = set()
EXCLUDED_KEYS = {
    RAYDIUM_PROGRAM_ID,
    ORCA_WHIRLPOOL_PROGRAM_ID,
    "11111111111111111111111111111111",
    "So11111111111111111111111111111111111111112",
}


def _extract_mint_from_logs(logs: Iterable[Any]) -> str:
    for line in logs:
        entry = str(line).lower()
        if "mint" in entry and "initialize" in entry:
            return "ExtractedMintHere"
    return ""


def _extract_mint(notification: Dict[str, Any]) -> str:
    value = notification.get("params", {}).get("result", {}).get("value", {})
    logs = value.get("logs") or []

    if any("initialize_pool" in str(line).lower() for line in logs):
        return _extract_mint_from_logs(logs) or "ExtractedMintHere"

    if any("initialize" in str(line).lower() and "pool" in str(line).lower() for line in logs):
        return _extract_mint_from_logs(logs) or "ExtractedMintHere"

    return ""


def _rpc_call(method: str, params: List[Any]) -> Any:
    rpc_url = str(os.getenv("HELIUS_RPC_URL") or os.getenv("SOLANA_RPC_URL") or "https://api.mainnet-beta.solana.com/").strip()
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }
    response = requests.post(rpc_url, json=payload, timeout=12)
    response.raise_for_status()
    body = response.json()
    return body.get("result")


def _find_candidate_mint(tx: Dict[str, Any]) -> str:
    account_keys = tx.get("transaction", {}).get("message", {}).get("accountKeys") or []
    for key in account_keys:
        value = str(key).strip()
        if len(value) < 32 or len(value) > 44:
            continue
        if value in EXCLUDED_KEYS or value.startswith("0x"):
            continue
        return value
    return ""


def _poll_program_transactions(program_id: str, source: str) -> bool:
    try:
        sig_rows = _rpc_call(
            "getSignaturesForAddress",
            [program_id, {"limit": 8}],
        ) or []

        for row in sig_rows:
            signature = str((row or {}).get("signature") or "").strip()
            if not signature or signature in SEEN_SIGNATURES:
                continue

            SEEN_SIGNATURES.add(signature)
            tx = _rpc_call(
                "getTransaction",
                [
                    signature,
                    {
                        "encoding": "jsonParsed",
                        "maxSupportedTransactionVersion": 0,
                    },
                ],
            ) or {}
            logs = tx.get("meta", {}).get("logMessages") or []
            if not any("initialize" in str(line).lower() and "pool" in str(line).lower() for line in logs):
                continue

            mint = _find_candidate_mint(tx)
            if not mint:
                continue

            token = {
                "source": source,
                "mint": mint,
                "signature": signature,
            }
            print(f"[Raydium/Orca Poll] NEW TOKEN DETECTED ({source})", token)
            enqueue_token(token)
        return True
    except Exception as exc:
        print(f"[Raydium/Orca Poll] ERROR ({source}):", exc)
        return False


async def poll_raydium_orca_transactions() -> None:
    sleep_seconds = POLL_INTERVAL_SECONDS

    while True:
        raydium_ok = _poll_program_transactions(RAYDIUM_PROGRAM_ID, "raydium_txlogs")
        orca_ok = _poll_program_transactions(ORCA_WHIRLPOOL_PROGRAM_ID, "orca_txlogs")

        if raydium_ok and orca_ok:
            sleep_seconds = POLL_INTERVAL_SECONDS
        else:
            sleep_seconds = min(POLL_BACKOFF_MAX_SECONDS, max(POLL_INTERVAL_SECONDS, sleep_seconds * 2))
            print(f"[Raydium/Orca Poll] Backoff active, retrying in {sleep_seconds}s")

        await asyncio.sleep(sleep_seconds)


async def raydium_listener() -> None:
    while True:
        try:
            async with connect(SOLANA_WS_URL, ping_interval=20, ping_timeout=20) as ws:
                subscribe_msg = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "logsSubscribe",
                    "params": [
                        {"mentions": [RAYDIUM_PROGRAM_ID]},
                        {"commitment": "confirmed"},
                    ],
                }
                await ws.send(json.dumps(subscribe_msg))
                sub_resp = await ws.recv()
                print("[Raydium Listener] Subscription response:", sub_resp)

                while True:
                    raw_msg = await ws.recv()
                    try:
                        payload = json.loads(raw_msg)
                    except Exception:
                        continue

                    mint = _extract_mint(payload)
                    if not mint:
                        continue

                    token = {
                        "source": "raydium_ws",
                        "mint": mint,
                    }
                    print("[Raydium Pool] NEW TOKEN DETECTED", token)
                    enqueue_token(token)
        except Exception as exc:
            print("[Raydium Listener] ERROR, reconnecting:", exc)
            await asyncio.sleep(3)


def start_raydium_listener() -> None:
    async def _runner() -> None:
        print("[Raydium Listener] Running background WS + tx-log pollers")
        await asyncio.gather(
            raydium_listener(),
            poll_raydium_orca_transactions(),
        )

    asyncio.run(_runner())
