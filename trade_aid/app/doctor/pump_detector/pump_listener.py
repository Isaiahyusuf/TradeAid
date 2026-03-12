from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import os
from typing import Any

import httpx

from app.doctor.services.helius_service import HeliusService


class PumpListener:
    def __init__(self, helius_service: HeliusService) -> None:
        self.helius_service = helius_service
        self._dex_cache_ttl_seconds = 60.0
        self._dex_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._dex_client = httpx.AsyncClient(timeout=8.0, trust_env=False)
        self._post_client = httpx.AsyncClient(timeout=8.0, trust_env=False)
        self._ingest_key = str(
            os.getenv("TRADEAID_NEW_TOKEN_INGEST_KEY")
            or os.getenv("NEW_TOKEN_INGEST_KEY")
            or ""
        ).strip()
        configured_webhook = str(
            os.getenv("TRADEAID_NEW_TOKEN_WEBHOOK_URL")
            or os.getenv("TRADE_AID_BACKEND_URL")
            or os.getenv("TRADEAID_API_URL")
            or ""
        ).strip()
        if configured_webhook and configured_webhook.endswith("/api/new-token"):
            self._new_token_webhook_url = configured_webhook
        elif configured_webhook:
            self._new_token_webhook_url = f"{configured_webhook.rstrip('/')}/api/new-token"
        else:
            self._new_token_webhook_url = "http://127.0.0.1:8000/api/new-token"

    @staticmethod
    def _age_minutes(value: Any) -> float:
        if value is None:
            return 99999.0
        if isinstance(value, (int, float)):
            dt = datetime.fromtimestamp(float(value), tz=timezone.utc)
            return max(0.0, (datetime.now(tz=timezone.utc) - dt).total_seconds() / 60.0)
        raw = str(value).strip()
        if not raw:
            return 99999.0
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return max(0.0, (datetime.now(tz=timezone.utc) - dt).total_seconds() / 60.0)
        except Exception:
            return 99999.0

    @staticmethod
    def _parse_datetime(value: Any) -> datetime:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        raw = str(value or "").strip()
        if not raw:
            return datetime.now(tz=timezone.utc)
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except Exception:
            return datetime.now(tz=timezone.utc)

    @staticmethod
    def _safe_float(value: Any, default: float = 0.0) -> float:
        try:
            return float(value or default)
        except Exception:
            return default

    @staticmethod
    def _extract_signature(row: dict[str, Any]) -> str:
        return str(
            row.get("signature")
            or row.get("txSignature")
            or row.get("transactionSignature")
            or row.get("sig")
            or ""
        ).strip()

    async def _fetch_dexscreener_enrichment(self, mint: str) -> dict[str, Any]:
        now_ts = datetime.now(tz=timezone.utc).timestamp()
        cached = self._dex_cache.get(mint)
        if cached and (now_ts - cached[0]) <= self._dex_cache_ttl_seconds:
            return dict(cached[1])

        payload: dict[str, Any] = {}
        try:
            response = await self._dex_client.get(f"https://api.dexscreener.com/latest/dex/tokens/{mint}")
            response.raise_for_status()
            data = response.json() if response.content else {}
            pairs = data.get("pairs") if isinstance(data, dict) else []
            pair = pairs[0] if isinstance(pairs, list) and pairs else {}
            price_usd = self._safe_float((pair or {}).get("priceUsd"), 0.0)
            fdv = self._safe_float((pair or {}).get("fdv"), 0.0)
            market_cap = self._safe_float((pair or {}).get("marketCap"), 0.0)
            liquidity_usd = self._safe_float(((pair or {}).get("liquidity") or {}).get("usd"), 0.0)
            volume = (pair or {}).get("volume") or {}
            volume_5m = self._safe_float(volume.get("m5"), 0.0) if isinstance(volume, dict) else 0.0
            volume_1h = self._safe_float(volume.get("h1"), 0.0) if isinstance(volume, dict) else 0.0
            volume_24h = self._safe_float(volume.get("h24"), 0.0) if isinstance(volume, dict) else 0.0

            market_cap_computed = market_cap if market_cap > 0 else fdv
            # If market cap is still unavailable, fallback to price * estimated supply where possible.
            if market_cap_computed <= 0 and price_usd > 0 and fdv > 0:
                market_cap_computed = fdv

            payload = {
                "token_name": str(((pair or {}).get("baseToken") or {}).get("name") or "").strip(),
                "symbol": str(((pair or {}).get("baseToken") or {}).get("symbol") or "").strip(),
                "initial_liquidity": liquidity_usd,
                "market_cap": market_cap_computed,
                "volume": volume_5m or volume_1h or volume_24h,
                "dex_price_usd": price_usd,
                "dex_fdv": fdv,
                "dex_volume_5m": volume_5m,
                "dex_volume_1h": volume_1h,
                "dex_volume_24h": volume_24h,
                "dex_liquidity": liquidity_usd,
            }
        except Exception:
            payload = {
                "token_name": "",
                "symbol": "",
                "initial_liquidity": 0.0,
                "market_cap": 0.0,
                "volume": 0.0,
                "dex_price_usd": 0.0,
                "dex_fdv": 0.0,
                "dex_volume_5m": 0.0,
                "dex_volume_1h": 0.0,
                "dex_volume_24h": 0.0,
                "dex_liquidity": 0.0,
            }

        self._dex_cache[mint] = (now_ts, dict(payload))
        return payload

    async def _post_new_token(self, token_obj: dict[str, Any]) -> None:
        try:
            headers = {"x-tradeaid-ingest-key": self._ingest_key} if self._ingest_key else None
            await self._post_client.post(self._new_token_webhook_url, json=token_obj, headers=headers)
        except Exception:
            return

    async def _build_and_send_token(self, row: dict[str, Any]) -> dict[str, Any] | None:
        mint = str(row.get("mint") or row.get("address") or row.get("tokenAddress") or "").strip()
        if not mint:
            return None

        block_time = row.get("blockTime") or row.get("createdAt") or row.get("created_at")
        age = self._age_minutes(block_time)
        timestamp = self._parse_datetime(block_time).astimezone(timezone.utc).isoformat()
        tx_signature = self._extract_signature(row)
        creator_wallet = str(row.get("authority") or row.get("creator") or row.get("creatorWallet") or "").strip()

        base_token_obj = {
            "token_name": "",
            "symbol": "",
            "mint_address": mint,
            "creator_wallet": creator_wallet,
            "timestamp": timestamp,
            "transaction_signature": tx_signature,
            "initial_liquidity": 0.0,
            "market_cap": 0.0,
            "volume": 0.0,
        }

        dex = await self._fetch_dexscreener_enrichment(mint)
        token_obj = {
            **base_token_obj,
            "token_name": str(dex.get("token_name") or "").strip() or str(row.get("name") or "").strip(),
            "symbol": str(dex.get("symbol") or "").strip() or str(row.get("symbol") or "").strip(),
            "initial_liquidity": self._safe_float(dex.get("initial_liquidity"), 0.0),
            "market_cap": self._safe_float(dex.get("market_cap"), 0.0),
            "volume": self._safe_float(dex.get("volume"), 0.0),
            "source": "pump_fun_listener",
            "age_minutes": round(age, 4),
            "dexscreener": {
                "priceUsd": self._safe_float(dex.get("dex_price_usd"), 0.0),
                "fdv": self._safe_float(dex.get("dex_fdv"), 0.0),
                "volume": {
                    "m5": self._safe_float(dex.get("dex_volume_5m"), 0.0),
                    "h1": self._safe_float(dex.get("dex_volume_1h"), 0.0),
                    "h24": self._safe_float(dex.get("dex_volume_24h"), 0.0),
                },
                "liquidity": {
                    "usd": self._safe_float(dex.get("dex_liquidity"), 0.0),
                },
            },
            "raw": row,
        }

        await self._post_new_token(token_obj)
        return token_obj

    async def detect_fresh_tokens(self, max_age_minutes: float = 5.0, limit: int = 150) -> list[dict[str, Any]]:
        rows = await self.helius_service.detect_fresh_mints(limit=limit)
        candidates: list[dict[str, Any]] = []
        for row in rows:
            mint = str(row.get("mint") or row.get("address") or row.get("tokenAddress") or "").strip()
            if not mint:
                continue
            block_time = row.get("blockTime") or row.get("createdAt") or row.get("created_at")
            age = self._age_minutes(block_time)
            if age > max_age_minutes:
                continue
            candidates.append(row)

        # Run enrichment and webhook delivery concurrently to keep listener responsive.
        semaphore = asyncio.Semaphore(12)

        async def _worker(raw: dict[str, Any]) -> dict[str, Any] | None:
            async with semaphore:
                return await self._build_and_send_token(raw)

        enriched = await asyncio.gather(*[_worker(row) for row in candidates], return_exceptions=True)
        out: list[dict[str, Any]] = []
        for item in enriched:
            if isinstance(item, Exception) or not isinstance(item, dict):
                continue
            out.append(item)
        return out
