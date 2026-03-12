from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import os
from typing import Any

import httpx

from app.config import get_settings
from app.doctor.services.helius_service import HeliusService
from app.services.ai_scoring import ai_scoring_service
from app.services.pre_filter import pre_filter
from app.services.sniper_controller import sniper_controller
from app.services.alert_service import alert_service
from app.utils.logging_config import logger
from app.utils.redis_client import cache_get, cache_set, publish_event


class FreshTokenProcessor:
    def __init__(self) -> None:
        settings = get_settings()
        self._client = httpx.AsyncClient(timeout=8.0, trust_env=False)
        self._semaphore = asyncio.Semaphore(24)
        helius_key = str(settings.HELIUS_API_KEY or os.getenv("HELIUS_API_KEY") or "").strip()
        self._helius_service = HeliusService(helius_key)
        flagged = str(
            os.getenv("TRADEAID_FLAGGED_CREATORS")
            or os.getenv("FLAGGED_CREATOR_WALLETS")
            or ""
        ).strip()
        self._flagged_creators = {
            wallet.strip() for wallet in flagged.split(",") if wallet.strip()
        }
        self._freshness_min_seconds = max(0.0, float(os.getenv("FRESH_TOKEN_MIN_AGE_SECONDS", "2")))
        self._freshness_max_seconds = max(
            self._freshness_min_seconds,
            float(os.getenv("FRESH_TOKEN_MAX_AGE_SECONDS", os.getenv("FRESH_SNIPER_MAX_TOKEN_AGE_SECONDS", "6"))),
        )
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

    def _is_flagged_creator(self, wallet: str) -> bool:
        value = str(wallet or "").strip()
        if not value:
            return False
        return value in self._flagged_creators

    @staticmethod
    def _token_age_seconds(timestamp: Any) -> float:
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

    async def _anti_rug_check(self, token: dict[str, Any]) -> tuple[bool, str]:
        liquidity = self._safe_float(token.get("liquidity"), 0.0)
        if liquidity < 3000.0:
            return False, "liquidity_below_3000"

        creator_wallet = str(token.get("creator_wallet") or token.get("creator") or "").strip()
        if self._is_flagged_creator(creator_wallet):
            return False, "creator_wallet_flagged"

        mint = str(token.get("mint_address") or token.get("mint") or "").strip()
        if mint:
            try:
                mint_authority_active = await self._helius_service.is_mint_authority_active(mint)
                token["mint_authority_active"] = bool(mint_authority_active)
                if mint_authority_active:
                    return False, "mint_authority_active"
            except Exception as exc:
                logger.warning(f"[FreshProcessor] Mint authority check failed for {mint}: {exc}")

        return True, "passed"

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
        started = datetime.now(tz=timezone.utc).timestamp()
        while (datetime.now(tz=timezone.utc).timestamp() - started) <= 30.0:
            try:
                response = await self._client.get(f"https://api.dexscreener.com/latest/dex/tokens/{mint}")
                response.raise_for_status()
                data = response.json() if response.content else {}
                pairs = data.get("pairs") if isinstance(data, dict) else []
                pair_rows = [row for row in pairs if isinstance(row, dict)] if isinstance(pairs, list) else []
                pump_pairs = [row for row in pair_rows if self._is_pump_pair(row)]
                pair = pump_pairs[0] if pump_pairs else (pair_rows[0] if pair_rows else {})
                if not pair:
                    await asyncio.sleep(2)
                    continue

                volume = (pair or {}).get("volume") or {}
                txns = (pair or {}).get("txns") or {}
                liquidity = self._safe_float(((pair or {}).get("liquidity") or {}).get("usd"), 0.0)
                payload = {
                    "market_cap": self._safe_float((pair or {}).get("fdv") or (pair or {}).get("marketCap"), 0.0),
                    "liquidity": liquidity,
                    "volume": self._safe_float((volume or {}).get("h24"), 0.0),
                    "volume_5m": self._safe_float((volume or {}).get("m5"), 0.0),
                    "volume24h": self._safe_float((volume or {}).get("h24"), 0.0),
                    "price": self._safe_float((pair or {}).get("priceUsd"), 0.0),
                    "priceUsd": self._safe_float((pair or {}).get("priceUsd"), 0.0),
                    "pair_address": str((pair or {}).get("pairAddress") or "").strip(),
                    "pairCreatedAt": self._safe_float((pair or {}).get("pairCreatedAt"), 0.0),
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
                # Liquidity and pair existence can lag for a few seconds after mint creation.
                if liquidity <= 0.0:
                    await asyncio.sleep(2)
                    continue
                await cache_set(cache_key, payload, ttl=60)
                break
            except Exception as exc:
                logger.warning(f"[FreshProcessor] Dex enrichment failed for {mint}: {exc}")
                await asyncio.sleep(2)

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
            "pair_created_at": token.get("pairCreatedAt") or 0,
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

            age_seconds = self._token_age_seconds(token.get("timestamp"))
            latency_bucket = "2-6s"
            if age_seconds < self._freshness_min_seconds:
                latency_bucket = "lt2s"
            elif age_seconds > self._freshness_max_seconds:
                latency_bucket = "gt6s"
            logger.info(
                "[FreshProcessor][FreshnessMetric] mint=%s source=%s age_seconds=%.3f bucket=%s window=%s-%ss",
                token.get("mint_address") or token.get("mint") or "",
                source,
                age_seconds,
                latency_bucket,
                int(self._freshness_min_seconds),
                int(self._freshness_max_seconds),
            )
            # Hard freshness guard: stale tokens are rejected before Dex enrichment.
            if age_seconds > self._freshness_max_seconds:
                token["freshness_gate"] = {
                    "passed": False,
                    "reason": "token_age_above_6s",
                    "age_seconds": round(age_seconds, 4),
                }
                await publish_event("fresh_tokens", {"status": "filtered", "token": token})
                return {"status": "filtered", "token": token}

            enriched = await self.enrich_token(token)
            anti_rug_ok, anti_rug_reason = await self._anti_rug_check(enriched)
            enriched["anti_rug"] = {"passed": anti_rug_ok, "reason": anti_rug_reason}
            if not anti_rug_ok:
                await publish_event("fresh_tokens", {"status": "filtered", "token": enriched})
                return {"status": "filtered", "token": enriched}

            passed, reason = pre_filter(enriched)
            enriched["pre_filter"] = {"passed": passed, "reason": reason}

            tradeaid_token = {
                "name": str(enriched.get("token_name") or enriched.get("name") or "").strip(),
                "symbol": str(enriched.get("symbol") or "").strip(),
                "mint": str(enriched.get("mint_address") or enriched.get("mint") or "").strip(),
                "creator": str(enriched.get("creator_wallet") or enriched.get("creator") or "").strip(),
                "liquidity": self._safe_float(enriched.get("liquidity"), 0.0),
                "marketcap": self._safe_float(enriched.get("market_cap"), 0.0),
                "volume": self._safe_float(enriched.get("volume_5m") or enriched.get("volume"), 0.0),
                "timestamp": enriched.get("timestamp") or datetime.now(tz=timezone.utc).isoformat(),
            }
            logger.info("[NEW TOKEN DETECTED]")
            logger.info(f"Name: {tradeaid_token['name']}")
            logger.info(f"Symbol: {tradeaid_token['symbol']}")
            logger.info(f"Mint: {tradeaid_token['mint']}")
            logger.info(f"Liquidity: {tradeaid_token['liquidity']}")

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
