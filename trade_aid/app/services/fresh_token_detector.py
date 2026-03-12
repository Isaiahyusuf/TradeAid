from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime, timezone
from typing import Any

import websockets

from app.config import get_settings
from app.doctor.doctor_multi_source_scanner import DoctorMultiSourceScanner
from app.doctor.services.helius_service import HeliusService
from app.doctor.pump_detector.dex_new_pairs import DexNewPairsScanner
from app.services.pump_listener_config import HELIUS_WS, PUMPFUN_PROGRAM, SOLANA_PUBLIC_WS
from app.services.token_processor import fresh_token_processor
from app.utils.solana_rpc import solana_ws_endpoints
from app.utils.logging_config import logger

BASE58_RE = re.compile(r"[1-9A-HJ-NP-Za-km-z]{32,44}")


class FreshTokenDetector:
    def __init__(self) -> None:
        settings = get_settings()
        self._helius_api_key = str(settings.HELIUS_API_KEY or os.getenv("HELIUS_API_KEY") or "").strip()
        configured_ws_url = str(
            os.getenv("TRADEAID_HELIUS_WS")
            or os.getenv("HELIUS_WS_URL")
            or HELIUS_WS
        ).strip()
        self._ws_endpoints = [url for url in [configured_ws_url, *solana_ws_endpoints(settings), SOLANA_PUBLIC_WS] if str(url or "").strip()]
        self._pump_program_id = str(os.getenv("PUMPFUN_PROGRAM_ID") or PUMPFUN_PROGRAM).strip()
        self._running = False
        self._tasks: list[asyncio.Task] = []
        self._seen: dict[str, float] = {}
        self._dex_fallback = DexNewPairsScanner(min_liquidity_usd=2000.0)
        self._helius_service = HeliusService(self._helius_api_key)
        self._multi_scanner = DoctorMultiSourceScanner()
        self._freshness_min_seconds = max(0.0, float(os.getenv("FRESH_TOKEN_MIN_AGE_SECONDS", "2")))
        self._freshness_max_seconds = max(
            self._freshness_min_seconds,
            float(os.getenv("FRESH_TOKEN_MAX_AGE_SECONDS", os.getenv("FRESH_SNIPER_MAX_TOKEN_AGE_SECONDS", "6"))),
        )
        self._enable_extra_sources = str(os.getenv("ENABLE_FRESH_EXTRA_SOURCES", "false")).strip().lower() in (
            "1",
            "true",
            "yes",
            "on",
        )

    @staticmethod
    def _safe_text(value: Any) -> str:
        return str(value or "").strip()

    def _cache_seen(self, mint: str) -> bool:
        now = datetime.now(tz=timezone.utc).timestamp()
        for key, ts in list(self._seen.items()):
            if now - ts > 1800:
                self._seen.pop(key, None)
        if mint in self._seen:
            return True
        self._seen[mint] = now
        return False

    def _timestamp_from_row(self, row: dict[str, Any]) -> str:
        raw = row.get("blockTime") or row.get("createdAt") or row.get("created_at")
        if isinstance(raw, (int, float)):
            value = float(raw)
            if value > 1_000_000_000_000:
                value = value / 1000.0
            try:
                return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
            except Exception:
                return datetime.now(tz=timezone.utc).isoformat()
        if isinstance(raw, str) and raw.strip():
            text = raw.strip().replace("Z", "+00:00")
            try:
                dt = datetime.fromisoformat(text)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(timezone.utc).isoformat()
            except Exception:
                return datetime.now(tz=timezone.utc).isoformat()
        return datetime.now(tz=timezone.utc).isoformat()

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._tasks.append(asyncio.create_task(self._start_listener()))
        self._tasks.append(asyncio.create_task(self._poll_additional_sources()))
        logger.info("[FreshDetector] Started fresh token detector")

    async def stop(self) -> None:
        self._running = False
        for task in self._tasks:
            if not task.done():
                task.cancel()
        self._tasks.clear()
        await fresh_token_processor.close()
        await self._multi_scanner.close()

    async def _start_listener(self) -> None:
        if not self._ws_endpoints:
            logger.warning("[FreshDetector] No websocket endpoints configured; pump listener disabled")
            return

        reconnect_delay = 3
        endpoint_index = 0
        while self._running:
            try:
                endpoint = self._ws_endpoints[endpoint_index % len(self._ws_endpoints)]
                await self._listen_on_endpoint(endpoint)
                reconnect_delay = 3
            except Exception as exc:
                logger.warning(f"[FreshDetector] Listener crashed: {exc}")
            finally:
                endpoint_index += 1
                if self._running:
                    logger.warning(f"[FreshDetector] Reconnecting in {reconnect_delay} seconds")
                    await asyncio.sleep(reconnect_delay)
                    reconnect_delay = min(30, reconnect_delay * 2)

    async def _listen_on_endpoint(self, ws_url: str) -> None:
        async with websockets.connect(ws_url, ping_interval=20, ping_timeout=10, close_timeout=5) as ws:
            subscribe_msg = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "logsSubscribe",
                "params": [
                    {"mentions": [self._pump_program_id]},
                    {"commitment": "processed"},
                ],
            }
            await ws.send(json.dumps(subscribe_msg))
            role = "primary" if "helius" in ws_url.lower() else "fallback"
            logger.info(f"[FreshDetector] Subscribed to pump.fun logs via {role} ws={ws_url}")

            async for message in ws:
                if not self._running:
                    return
                await self._process_log_message(message)

    @staticmethod
    def _is_create_log(logs: list[str]) -> bool:
        for line in logs:
            lowered = str(line or "").lower()
            if "initializemint" in lowered or "instruction: create" in lowered:
                return True
        return False

    @staticmethod
    def _extract_creator_from_tx(tx: dict[str, Any]) -> str:
        message = (((tx or {}).get("transaction") or {}).get("message") or {})
        keys = message.get("accountKeys") if isinstance(message, dict) else []
        if not isinstance(keys, list):
            return ""
        for key in keys:
            if isinstance(key, dict) and key.get("signer"):
                return str(key.get("pubkey") or "").strip()
            text = str(key or "").strip()
            if text:
                return text
        return ""

    @staticmethod
    def _extract_mint_from_tx(tx: dict[str, Any]) -> str:
        meta = (tx or {}).get("meta") if isinstance(tx, dict) else {}
        balances = (meta or {}).get("postTokenBalances") if isinstance(meta, dict) else []
        if isinstance(balances, list):
            for balance in balances:
                mint = str((balance or {}).get("mint") or "").strip()
                if mint:
                    return mint
        return ""

    @staticmethod
    def _age_seconds_from_timestamp(timestamp: str) -> float:
        try:
            raw = str(timestamp or "").strip().replace("Z", "+00:00")
            if not raw:
                return 99999.0
            dt = datetime.fromisoformat(raw)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return max(0.0, (datetime.now(tz=timezone.utc) - dt.astimezone(timezone.utc)).total_seconds())
        except Exception:
            return 99999.0

    async def _process_log_message(self, raw_message: str) -> None:
        try:
            payload = json.loads(raw_message)
        except Exception:
            return

        result = (payload.get("params") or {}).get("result") or {}
        value = result.get("value") or {}
        signature = self._safe_text(value.get("signature"))
        logs = value.get("logs") or []
        if not isinstance(logs, list):
            logs = []

        if not self._is_create_log(logs):
            return

        mint = ""
        for line in logs:
            if not isinstance(line, str):
                continue
            matches = BASE58_RE.findall(line)
            for candidate in matches:
                candidate_str = self._safe_text(candidate)
                if candidate_str and candidate_str != self._pump_program_id:
                    mint = candidate_str
                    break
            if mint:
                break

        tx = await self._helius_service.get_transaction(signature) if signature else None
        if isinstance(tx, dict):
            mint_from_tx = self._extract_mint_from_tx(tx)
            if mint_from_tx:
                mint = mint_from_tx

        if not mint or self._cache_seen(mint):
            return

        creator_wallet = self._safe_text(value.get("signer"))
        timestamp = datetime.now(tz=timezone.utc).isoformat()
        token_name = "Unknown"
        symbol = "UNK"
        if isinstance(tx, dict):
            creator_wallet = creator_wallet or self._extract_creator_from_tx(tx)
            block_time = tx.get("blockTime")
            if isinstance(block_time, (int, float)):
                timestamp = datetime.fromtimestamp(float(block_time), tz=timezone.utc).isoformat()

            meta = (tx.get("meta") or {}) if isinstance(tx, dict) else {}
            post_balances = meta.get("postTokenBalances") if isinstance(meta, dict) else []
            if isinstance(post_balances, list) and post_balances:
                first = post_balances[0] or {}
                token_name = self._safe_text((first.get("name") if isinstance(first, dict) else "")) or token_name
                symbol = self._safe_text((first.get("symbol") if isinstance(first, dict) else "")) or symbol

        token = {
            "token_name": token_name,
            "symbol": symbol,
            "mint_address": mint,
            "creator_wallet": creator_wallet,
            "timestamp": timestamp,
            "transaction_signature": signature,
        }
        detection_age_seconds = self._age_seconds_from_timestamp(timestamp)
        latency_bucket = "2-6s"
        if detection_age_seconds < self._freshness_min_seconds:
            latency_bucket = "lt2s"
        elif detection_age_seconds > self._freshness_max_seconds:
            latency_bucket = "gt6s"
        logger.info(
            "[FreshDetector][FreshnessMetric] mint=%s sig=%s age_seconds=%.3f bucket=%s window=%s-%ss",
            token.get("mint_address"),
            token.get("transaction_signature") or "n/a",
            detection_age_seconds,
            latency_bucket,
            int(self._freshness_min_seconds),
            int(self._freshness_max_seconds),
        )
        if detection_age_seconds > self._freshness_max_seconds:
            logger.info(
                "[FreshDetector] Discarded stale token before enrichment mint=%s age_seconds=%.3f max=%ss",
                token.get("mint_address"),
                detection_age_seconds,
                int(self._freshness_max_seconds),
            )
            return
        logger.info("[NEW TOKEN DETECTED]")
        logger.info(f"Name: {token.get('token_name')}")
        logger.info(f"Symbol: {token.get('symbol')}")
        logger.info(f"Mint: {token.get('mint_address')}")
        asyncio.create_task(fresh_token_processor.process_token(token, source="helius_ws"))

    async def _poll_additional_sources(self) -> None:
        while self._running:
            try:
                tasks = [self._poll_pump_listener_rows()]
                if self._enable_extra_sources:
                    tasks.append(self._poll_dex_new_pairs())
                    tasks.append(self._poll_multi_source_candidates())
                await asyncio.gather(*tasks, return_exceptions=True)
            except Exception as exc:
                logger.warning(f"[FreshDetector] Additional source polling failed: {exc}")

            await asyncio.sleep(max(1, int(os.getenv("FRESH_TOKEN_POLL_SECONDS", "2"))))

    async def _poll_dex_new_pairs(self) -> None:
        rows = await self._dex_fallback.fetch_new_pairs(max_age_minutes=3.0)
        for row in rows[:80]:
            mint = self._safe_text(row.get("mint_address"))
            if not mint or self._cache_seen(mint):
                continue
            token = {
                "token_name": self._safe_text(row.get("name")),
                "symbol": self._safe_text(row.get("symbol")) or "UNK",
                "mint_address": mint,
                "creator_wallet": "",
                "timestamp": datetime.now(tz=timezone.utc).isoformat(),
                "transaction_signature": "",
                "liquidity": float(row.get("liquidity") or 0.0),
                "pair_address": self._safe_text(row.get("pair_address")),
                "source_platform": "dex_new_pairs",
            }
            asyncio.create_task(fresh_token_processor.process_token(token, source="dex_new_pairs"))

    async def _poll_pump_listener_rows(self) -> None:
        rows = await self._helius_service.detect_fresh_mints(limit=120)
        for row in rows:
            mint = self._safe_text(row.get("mint") or row.get("tokenAddress") or row.get("address"))
            if not mint or self._cache_seen(mint):
                continue
            token = {
                "token_name": self._safe_text(row.get("name")),
                "symbol": self._safe_text(row.get("symbol")) or "UNK",
                "mint_address": mint,
                "creator_wallet": self._safe_text(row.get("authority") or row.get("creator")),
                "timestamp": self._timestamp_from_row(row),
                "transaction_signature": self._safe_text(row.get("signature") or row.get("txSignature")),
                "source_platform": "helius_mints_api",
            }
            asyncio.create_task(fresh_token_processor.process_token(token, source="helius_mints_api"))

    async def _poll_multi_source_candidates(self) -> None:
        rows = await self._multi_scanner.scan_all_sources(limit=24)
        for row in rows:
            mint = self._safe_text(row.get("address"))
            if not mint or self._cache_seen(mint):
                continue
            token = {
                "token_name": self._safe_text(row.get("name")),
                "symbol": self._safe_text(row.get("symbol")) or "UNK",
                "mint_address": mint,
                "creator_wallet": "",
                "timestamp": datetime.now(tz=timezone.utc).isoformat(),
                "transaction_signature": "",
                "market_cap": float(row.get("market_cap") or 0.0),
                "liquidity": float(row.get("liquidity") or 0.0),
                "volume": float(row.get("volume_24h") or 0.0),
                "price": float(row.get("price_usd") or 0.0),
                "source_platform": self._safe_text(row.get("strategy_mode") or "doctor_multi_source"),
            }
            asyncio.create_task(fresh_token_processor.process_token(token, source="doctor_multi_source"))


fresh_token_detector = FreshTokenDetector()
