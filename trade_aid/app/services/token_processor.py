from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import os
from typing import Any

import httpx

from app.services.ai_scoring import ai_scoring_service
from app.services.pre_filter import pre_filter
from app.services.sniper_controller import sniper_controller
from app.services.alert_service import alert_service
from app.utils.logging_config import logger
from app.utils.redis_client import cache_get, cache_set, publish_event


class FreshTokenProcessor:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=8.0, trust_env=False)
        self._semaphore = asyncio.Semaphore(24)
        self._ingest_key = str(
            os.getenv("TRADEAID_NEW_TOKEN_INGEST_KEY")
            or os.getenv("NEW_TOKEN_INGEST_KEY")
            or ""
        ).strip()
        base_url = str(
            os.getenv("TRADEAID_NEW_TOKEN_WEBHOOK_URL")
            or os.getenv("TRADE_AID_BACKEND_URL")
            or os.getenv("TRADEAID_API_URL")
            or ""
        ).strip()
        if base_url.endswith("/api/new-token"):
            self._ingest_url = base_url
        elif base_url:
            self._ingest_url = f"{base_url.rstrip('/')}/api/new-token"
        else:
            self._ingest_url = ""

    async def close(self) -> None:
        await self._client.aclose()

    @staticmethod
    def _safe_float(value: Any, default: float = 0.0) -> float:
        try:
            return float(value or default)
        except Exception:
            return default

    @staticmethod
    def _is_pump_pair(pair: dict[str, Any]) -> bool:
        dex_id = str((pair or {}).get("dexId") or "").lower()
        url = str((pair or {}).get("url") or "").lower()
        labels = " ".join([str(item or "").lower() for item in ((pair or {}).get("labels") or [])])
        return "pump" in dex_id or "pump.fun" in url or "pump" in labels

    async def enrich_token(self, token: dict[str, Any]) -> dict[str, Any]:
        mint = str(token.get("mint_address") or token.get("mint") or "").strip()
        if not mint:
            return token

        cache_key = f"fresh:dex:{mint}"
        cached = await cache_get(cache_key)
        if isinstance(cached, dict) and cached:
            token.update(cached)
            return token

        payload: dict[str, Any] = {}
        try:
            response = await self._client.get(f"https://api.dexscreener.com/latest/dex/tokens/{mint}")
            response.raise_for_status()
            data = response.json() if response.content else {}
            pairs = data.get("pairs") if isinstance(data, dict) else []
            pair_rows = [row for row in pairs if isinstance(row, dict)] if isinstance(pairs, list) else []
            pump_pairs = [row for row in pair_rows if self._is_pump_pair(row)]
            pair = pump_pairs[0] if pump_pairs else (pair_rows[0] if pair_rows else {})

            volume = (pair or {}).get("volume") or {}
            txns = (pair or {}).get("txns") or {}

            payload = {
                "market_cap": self._safe_float((pair or {}).get("fdv") or (pair or {}).get("marketCap"), 0.0),
                "liquidity": self._safe_float(((pair or {}).get("liquidity") or {}).get("usd"), 0.0),
                "volume": self._safe_float((volume or {}).get("h24"), 0.0),
                "price": self._safe_float((pair or {}).get("priceUsd"), 0.0),
                "pair_address": str((pair or {}).get("pairAddress") or "").strip(),
                "symbol": str(((pair or {}).get("baseToken") or {}).get("symbol") or token.get("symbol") or "").strip(),
                "token_name": str(((pair or {}).get("baseToken") or {}).get("name") or token.get("token_name") or token.get("name") or "").strip(),
                "dex": {
                    "dex_id": str((pair or {}).get("dexId") or "").strip(),
                    "url": str((pair or {}).get("url") or "").strip(),
                    "volume": {
                        "m5": self._safe_float((volume or {}).get("m5"), 0.0),
                        "h1": self._safe_float((volume or {}).get("h1"), 0.0),
                        "h24": self._safe_float((volume or {}).get("h24"), 0.0),
                    },
                    "txns": {
                        "m5_buys": self._safe_float(((txns or {}).get("m5") or {}).get("buys"), 0.0),
                        "m5_sells": self._safe_float(((txns or {}).get("m5") or {}).get("sells"), 0.0),
                    },
                },
            }
            await cache_set(cache_key, payload, ttl=60)
        except Exception as exc:
            logger.warning(f"[FreshProcessor] Dex enrichment failed for {mint}: {exc}")

        token.update(payload)
        return token

    async def _post_to_tradeaid_ingest(self, token: dict[str, Any]) -> None:
        if not self._ingest_url:
            return

        payload = {
            "token_name": token.get("token_name") or token.get("name") or "",
            "symbol": token.get("symbol") or "",
            "mint_address": token.get("mint_address") or token.get("mint") or "",
            "creator_wallet": token.get("creator_wallet") or token.get("creator") or "",
            "timestamp": token.get("timestamp") or datetime.now(tz=timezone.utc).isoformat(),
            "transaction_signature": token.get("transaction_signature") or token.get("tx") or "",
            "initial_liquidity": self._safe_float(token.get("liquidity"), 0.0),
            "market_cap": self._safe_float(token.get("market_cap"), 0.0),
            "volume": self._safe_float(token.get("volume"), 0.0),
            "source": token.get("source") or "fresh_token_detector",
            "source_platform": token.get("source_platform") or token.get("source") or "multi_source",
            "dexscreener": token.get("dex") or {},
        }

        headers = {"Content-Type": "application/json"}
        if self._ingest_key:
            headers["x-tradeaid-ingest-key"] = self._ingest_key

        try:
            response = await self._client.post(self._ingest_url, json=payload, headers=headers)
            if response.status_code >= 400:
                logger.warning(
                    f"[FreshProcessor] Ingest post failed {payload['mint_address']} status={response.status_code}"
                )
        except Exception as exc:
            logger.warning(f"[FreshProcessor] Ingest post exception: {exc}")

    async def process_token(self, token: dict[str, Any], source: str = "helius_ws") -> dict[str, Any]:
        async with self._semaphore:
            token = dict(token)
            token["source"] = source
            token.setdefault("timestamp", datetime.now(tz=timezone.utc).isoformat())

            enriched = await self.enrich_token(token)
            passed, reason = pre_filter(enriched)
            enriched["pre_filter"] = {"passed": passed, "reason": reason}

            ai_result = ai_scoring_service.score(enriched)
            enriched["ai"] = ai_result

            if not passed:
                await publish_event("fresh_tokens", {"status": "filtered", "token": enriched})
                return {"status": "filtered", "token": enriched}

            await self._post_to_tradeaid_ingest(enriched)

            sniper_result = await sniper_controller.maybe_trigger(enriched, ai_result)
            status = "SNIPING" if sniper_result.get("triggered") else "WATCHING"
            enriched["sniper"] = sniper_result

            await alert_service.send_fresh_launch_alert(
                token=enriched,
                ai_result=ai_result,
                status=status,
            )

            await publish_event("fresh_tokens", {
                "status": status.lower(),
                "token": {
                    "mint_address": enriched.get("mint_address"),
                    "symbol": enriched.get("symbol"),
                    "market_cap": enriched.get("market_cap"),
                    "liquidity": enriched.get("liquidity"),
                    "score": ai_result.get("score"),
                    "source": source,
                },
            })
            return {"status": status.lower(), "token": enriched}


fresh_token_processor = FreshTokenProcessor()
