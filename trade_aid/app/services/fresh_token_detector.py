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
from app.services.token_processor import fresh_token_processor
from app.utils.logging_config import logger

BASE58_RE = re.compile(r"[1-9A-HJ-NP-Za-km-z]{32,44}")


class FreshTokenDetector:
    def __init__(self) -> None:
        settings = get_settings()
        self._helius_api_key = str(settings.HELIUS_API_KEY or os.getenv("HELIUS_API_KEY") or "").strip()
        self._ws_url = str(
            os.getenv("TRADEAID_HELIUS_WS")
            or os.getenv("HELIUS_WS_URL")
            or (f"wss://mainnet.helius-rpc.com/?api-key={self._helius_api_key}" if self._helius_api_key else "")
        ).strip()
        self._pump_program_id = str(
            os.getenv("PUMPFUN_PROGRAM_ID") or "6EF8rrecthR5Dkzk6t8hWb1Y4vZQqfZ"
        ).strip()
        self._running = False
        self._tasks: list[asyncio.Task] = []
        self._seen: dict[str, float] = {}
        self._dex_fallback = DexNewPairsScanner(min_liquidity_usd=2000.0)
        self._helius_service = HeliusService(self._helius_api_key)
        self._multi_scanner = DoctorMultiSourceScanner()

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

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._tasks.append(asyncio.create_task(self._listen_helius()))
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

    async def _listen_helius(self) -> None:
        if not self._ws_url:
            logger.warning("[FreshDetector] No Helius WS configured; websocket listener disabled")
            return

        reconnect_delay = 3
        while self._running:
            try:
                async with websockets.connect(self._ws_url, ping_interval=25, ping_timeout=10, close_timeout=5) as ws:
                    payload = {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "logsSubscribe",
                        "params": [
                            {"mentions": [self._pump_program_id]},
                            {"commitment": "processed"},
                        ],
                    }
                    await ws.send(json.dumps(payload))
                    logger.info("[FreshDetector] Subscribed to pump.fun program logs via Helius")
                    reconnect_delay = 3

                    async for message in ws:
                        if not self._running:
                            break
                        await self._process_log_message(message)
            except Exception as exc:
                logger.warning(f"[FreshDetector] Helius WS error: {exc}")
                if self._running:
                    await asyncio.sleep(reconnect_delay)
                    reconnect_delay = min(60, reconnect_delay * 2)

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

        if not mint or self._cache_seen(mint):
            return

        token = {
            "token_name": "Unknown",
            "symbol": "UNK",
            "mint_address": mint,
            "creator_wallet": "",
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
            "transaction_signature": signature,
        }
        asyncio.create_task(fresh_token_processor.process_token(token, source="helius_ws"))

    async def _poll_additional_sources(self) -> None:
        while self._running:
            try:
                await asyncio.gather(
                    self._poll_dex_new_pairs(),
                    self._poll_pump_listener_rows(),
                    self._poll_multi_source_candidates(),
                    return_exceptions=True,
                )
            except Exception as exc:
                logger.warning(f"[FreshDetector] Additional source polling failed: {exc}")

            await asyncio.sleep(max(3, int(os.getenv("FRESH_TOKEN_POLL_SECONDS", "8"))))

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
                "timestamp": datetime.now(tz=timezone.utc).isoformat(),
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
