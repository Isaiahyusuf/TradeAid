from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import os
from typing import Any

import httpx

from app.doctor.services.helius_service import HeliusService
from app.utils.logging_config import logger


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
    def _is_pumpfun_pair(pair: dict[str, Any]) -> bool:
        dex_id = str((pair or {}).get("dexId") or "").strip().lower()
        pair_url = str((pair or {}).get("url") or "").strip().lower()
        labels = " ".join([str(item or "").strip().lower() for item in ((pair or {}).get("labels") or [])])
        return (
            "pump" in dex_id
            or "pump.fun" in pair_url
            or "pump" in labels
        )

    @staticmethod
    def _pair_age_minutes(pair: dict[str, Any]) -> float | None:
        created_at_ms = pair.get("pairCreatedAt")
        try:
            created_at_ms_value = float(created_at_ms)
            if created_at_ms_value <= 0:
                return None
            age_seconds = max(0.0, (datetime.now(tz=timezone.utc).timestamp() * 1000.0 - created_at_ms_value) / 1000.0)
            return round(age_seconds / 60.0, 4)
        except Exception:
            return None

    @staticmethod
    def _age_minutes(value: Any) -> float:
        if value is None:
            return 99999.0
        if isinstance(value, (int, float)):
            numeric = float(value)
            if numeric > 1_000_000_000_000:
                numeric = numeric / 1000.0
            dt = datetime.fromtimestamp(numeric, tz=timezone.utc)
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
            numeric = float(value)
            if numeric > 1_000_000_000_000:
                numeric = numeric / 1000.0
            return datetime.fromtimestamp(numeric, tz=timezone.utc)
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

    @staticmethod
    def _extract_mint(row: dict[str, Any]) -> str:
        return str(
            row.get("mint")
            or row.get("mint_address")
            or row.get("address")
            or row.get("tokenAddress")
            or ""
        ).strip()

    async def _fetch_dex_fresh_candidates(self, max_age_minutes: float, limit: int) -> list[dict[str, Any]]:
        terms = ["pump.fun", "solana new pair", "raydium pump", "pump token"]
        out: dict[str, dict[str, Any]] = {}
        hard_limit = max(10, min(int(limit or 50), 300))

        for term in terms:
            try:
                response = await self._dex_client.get(f"https://api.dexscreener.com/latest/dex/search?q={term}")
                response.raise_for_status()
                data = response.json() if response.content else {}
            except Exception:
                continue

            pairs = data.get("pairs") if isinstance(data, dict) else []
            pair_rows = [row for row in pairs if isinstance(row, dict)] if isinstance(pairs, list) else []
            for pair in pair_rows:
                if str((pair or {}).get("chainId") or "").strip().lower() != "solana":
                    continue
                if not self._is_pumpfun_pair(pair):
                    continue

                pair_age_minutes = self._pair_age_minutes(pair)
                if isinstance(pair_age_minutes, (int, float)) and float(pair_age_minutes) > float(max_age_minutes):
                    continue

                base_token = (pair or {}).get("baseToken") or {}
                mint = str((base_token or {}).get("address") or "").strip()
                if not mint:
                    continue

                created_ms = (pair or {}).get("pairCreatedAt")
                try:
                    created_ts = float(created_ms) / 1000.0 if created_ms is not None else datetime.now(tz=timezone.utc).timestamp()
                    created_iso = datetime.fromtimestamp(created_ts, tz=timezone.utc).isoformat()
                except Exception:
                    created_iso = datetime.now(tz=timezone.utc).isoformat()

                out[mint] = {
                    "mint": mint,
                    "address": mint,
                    "createdAt": created_iso,
                    "name": str((base_token or {}).get("name") or "").strip(),
                    "symbol": str((base_token or {}).get("symbol") or "").strip(),
                    "source": "dex_fresh_pairs",
                }
                if len(out) >= hard_limit:
                    break
            if len(out) >= hard_limit:
                break

        return list(out.values())

    async def _fetch_dexscreener_enrichment(self, mint: str) -> dict[str, Any]:
        now_ts = datetime.now(tz=timezone.utc).timestamp()
        cached = self._dex_cache.get(mint)
        if cached and (now_ts - cached[0]) <= self._dex_cache_ttl_seconds:
            logger.info(f"[PumpListener] Dex cache hit for {mint}")
            return dict(cached[1])

        payload: dict[str, Any] = {}
        try:
            response = await self._dex_client.get(f"https://api.dexscreener.com/latest/dex/tokens/{mint}")
            response.raise_for_status()
            data = response.json() if response.content else {}
            pairs = data.get("pairs") if isinstance(data, dict) else []
            pair_rows = [row for row in pairs if isinstance(row, dict)] if isinstance(pairs, list) else []
            pump_pairs = [row for row in pair_rows if self._is_pumpfun_pair(row)]
            pair = pump_pairs[0] if pump_pairs else {}
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
                "is_pump_fun_pair": bool(pair),
                "pair_created_at_ms": (pair or {}).get("pairCreatedAt"),
                "pair_age_minutes": self._pair_age_minutes(pair),
            }
            logger.info(
                f"[PumpListener] Dex enriched {mint} liq={liquidity_usd:.2f} mcap={market_cap_computed:.2f} vol={float(payload['volume']):.2f}"
            )
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
                "is_pump_fun_pair": False,
                "pair_created_at_ms": None,
                "pair_age_minutes": None,
            }
            logger.warning(f"[PumpListener] Dex enrichment failed for {mint}; using zeroed fallback")

        self._dex_cache[mint] = (now_ts, dict(payload))
        return payload

    async def _post_new_token(self, token_obj: dict[str, Any]) -> None:
        mint = str(token_obj.get("mint_address") or "").strip()
        try:
            headers = {"x-tradeaid-ingest-key": self._ingest_key} if self._ingest_key else None
            response = await self._post_client.post(self._new_token_webhook_url, json=token_obj, headers=headers)
            if 200 <= response.status_code < 300:
                logger.info(f"[PumpListener] Posted token {mint} -> {self._new_token_webhook_url} status={response.status_code}")
            else:
                logger.warning(
                    f"[PumpListener] Post failed for {mint} status={response.status_code} body={response.text[:180]}"
                )
        except Exception as error:
            logger.warning(f"[PumpListener] Post exception for {mint}: {error}")
            return

    async def _build_and_send_token(self, row: dict[str, Any], max_age_minutes: float) -> dict[str, Any] | None:
        mint = self._extract_mint(row)
        if not mint:
            return None

        block_time = row.get("blockTime") or row.get("createdAt") or row.get("created_at")
        age = self._age_minutes(block_time)
        timestamp = self._parse_datetime(block_time).astimezone(timezone.utc).isoformat()
        tx_signature = self._extract_signature(row)
        creator_wallet = str(row.get("authority") or row.get("creator") or row.get("creatorWallet") or "").strip()
        logger.info(
            f"[PumpListener] New token detected mint={mint} creator={creator_wallet or 'unknown'} sig={tx_signature or 'n/a'}"
        )

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
        is_pump_pair = bool(dex.get("is_pump_fun_pair"))
        pair_age_minutes = dex.get("pair_age_minutes")
        effective_max_age_minutes = max(0.5, float(max_age_minutes or 5.0))

        if not is_pump_pair:
            logger.info(f"[PumpListener] Skipping non-pump token {mint}")
            return None

        if isinstance(pair_age_minutes, (int, float)) and float(pair_age_minutes) > effective_max_age_minutes:
            logger.info(
                f"[PumpListener] Skipping stale pump token {mint} age={float(pair_age_minutes):.2f}m max={effective_max_age_minutes:.2f}m"
            )
            return None

        token_obj = {
            **base_token_obj,
            "token_name": str(dex.get("token_name") or "").strip() or str(row.get("name") or "").strip(),
            "symbol": str(dex.get("symbol") or "").strip() or str(row.get("symbol") or "").strip(),
            "initial_liquidity": self._safe_float(dex.get("initial_liquidity"), 0.0),
            "market_cap": self._safe_float(dex.get("market_cap"), 0.0),
            "volume": self._safe_float(dex.get("volume"), 0.0),
            "source": "pump_fun_listener",
            "source_platform": "pump.fun",
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
                "pairCreatedAt": dex.get("pair_created_at_ms"),
                "pairAgeMinutes": dex.get("pair_age_minutes"),
            },
            "raw": row,
        }

        await self._post_new_token(token_obj)
        return token_obj

    async def detect_fresh_tokens(self, max_age_minutes: float = 5.0, limit: int = 150) -> list[dict[str, Any]]:
        configured_max_age = float(
            os.getenv("PUMP_LISTENER_MAX_AGE_MINUTES")
            or os.getenv("DOCTOR_PUMP_LISTENER_MAX_AGE_MINUTES")
            or max_age_minutes
            or 5.0
        )
        max_age_minutes = max(0.5, min(float(max_age_minutes or 5.0), configured_max_age))
        rows = await self.helius_service.detect_fresh_mints(limit=limit)
        helius_with_mint = [row for row in rows if self._extract_mint(row)]

        dex_fallback_candidates: list[dict[str, Any]] = []
        if len(helius_with_mint) < max(5, int(limit * 0.2)):
            dex_fallback_candidates = await self._fetch_dex_fresh_candidates(max_age_minutes=max_age_minutes, limit=limit)

        merged_rows: list[dict[str, Any]] = []
        seen_mints: set[str] = set()
        for row in [*helius_with_mint, *dex_fallback_candidates]:
            mint = self._extract_mint(row)
            if not mint or mint in seen_mints:
                continue
            seen_mints.add(mint)
            merged_rows.append(row)

        candidates: list[dict[str, Any]] = []
        for row in merged_rows:
            mint = self._extract_mint(row)
            if not mint:
                continue
            block_time = row.get("blockTime") or row.get("createdAt") or row.get("created_at")
            age = self._age_minutes(block_time)
            if age > max_age_minutes:
                continue
            candidates.append(row)

        logger.info(
            f"[PumpListener] Fresh mint candidates within {max_age_minutes}m: {len(candidates)} "
            f"(helius_rows={len(rows)} helius_with_mint={len(helius_with_mint)} dex_fallback={len(dex_fallback_candidates)})"
        )

        # Run enrichment and webhook delivery concurrently to keep listener responsive.
        semaphore = asyncio.Semaphore(12)

        async def _worker(raw: dict[str, Any]) -> dict[str, Any] | None:
            async with semaphore:
                return await self._build_and_send_token(raw, max_age_minutes=max_age_minutes)

        enriched = await asyncio.gather(*[_worker(row) for row in candidates], return_exceptions=True)
        out: list[dict[str, Any]] = []
        for item in enriched:
            if isinstance(item, Exception) or not isinstance(item, dict):
                continue
            out.append(item)
        logger.info(f"[PumpListener] Enriched tokens emitted: {len(out)}")
        return out
