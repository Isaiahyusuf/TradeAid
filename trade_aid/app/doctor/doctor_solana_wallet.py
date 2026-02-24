from __future__ import annotations

import hashlib
from typing import Any

import httpx


class DoctorSolanaWallet:
    def __init__(self, rpc_url: str, private_key: str, public_address: str, max_slippage_pct: float = 2.0) -> None:
        self.rpc_url = rpc_url
        self.private_key = private_key
        self.public_address = public_address
        self.max_slippage_pct = max_slippage_pct
        self._recent_swap_keys: set[str] = set()
        self._last_liquidity_by_token: dict[str, float] = {}

    async def get_balance_sol(self) -> float:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getBalance",
            "params": [self.public_address],
        }
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(self.rpc_url, json=payload)
            response.raise_for_status()
            lamports = float((((response.json() or {}).get("result") or {}).get("value") or 0))
            return lamports / 1_000_000_000

    def _dedupe_key(self, token_address: str, side: str, size_pct: float) -> str:
        raw = f"{token_address}:{side}:{size_pct:.6f}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def validate_swap_guard(self, token_address: str, side: str, size_pct: float, slippage_pct: float) -> dict[str, Any]:
        if not str(self.private_key or "").strip() or not str(self.public_address or "").strip():
            return {"approved": False, "reason": "doctor_wallet_not_configured"}

        if slippage_pct > self.max_slippage_pct:
            return {"approved": False, "reason": "slippage_above_threshold"}

        dedupe = self._dedupe_key(token_address, side, size_pct)
        if dedupe in self._recent_swap_keys:
            return {"approved": False, "reason": "duplicate_swap_blocked"}

        self._recent_swap_keys.add(dedupe)
        if len(self._recent_swap_keys) > 1000:
            self._recent_swap_keys = set(list(self._recent_swap_keys)[-600:])

        return {"approved": True, "dedupe_key": dedupe}

    def reject_if_sudden_liquidity_drop(self, token_address: str, current_liquidity: float, threshold_pct: float = 30.0) -> dict[str, Any]:
        prev = float(self._last_liquidity_by_token.get(token_address, current_liquidity) or current_liquidity)
        self._last_liquidity_by_token[token_address] = float(current_liquidity)
        if prev <= 0:
            return {"approved": True}
        drop_pct = ((prev - current_liquidity) / prev) * 100.0
        if drop_pct >= threshold_pct:
            return {"approved": False, "reason": "sudden_liquidity_drop", "drop_pct": round(drop_pct, 4)}
        return {"approved": True}

    async def confirm_transaction(self, signature: str) -> bool:
        if not signature:
            return False
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getSignatureStatuses",
            "params": [[signature]],
        }
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(self.rpc_url, json=payload)
            response.raise_for_status()
            value = ((((response.json() or {}).get("result") or {}).get("value") or [None])[0] or {})
            confirmation_status = str(value.get("confirmationStatus") or "")
            return confirmation_status in {"confirmed", "finalized"}
