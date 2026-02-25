import asyncio
from datetime import datetime
from typing import Optional
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import get_settings, get_enabled_chains
from app.database import async_session_factory
from app.models.models import Token, LiquidityEvent, Alert
from app.utils.redis_client import cache_set, cache_get, publish_event
from app.utils.logging_config import logger
from app.utils.launch_identity import build_launch_fingerprint
from app.scoring.scoring_service import scoring_service

settings = get_settings()
ENABLED_CHAINS = get_enabled_chains()

SOLANA_SEARCH_TERMS = [
    "solana",
    "pump",
    "pump.fun",
    "raydium",
    "meme",
    "bonk",
    "wif",
    "dogwifhat",
    "cat",
    "mochi",
    "jup",
    "jupiter",
    "banana",
    "elon",
    "pepe",
    "shark",
    "shiba",
    "sol",
    "moonshot",
    "launch",
    "fresh",
    "new pair",
    "just launched",
    "trend",
    "hot",
    "gm",
    "fomo",
    "ape",
    "degen",
    "memecoin",
    "sol meme",
    "solana meme",
]

CHAIN_SEARCH_TERMS = {
    "solana": SOLANA_SEARCH_TERMS,
    "ethereum": [
        "ethereum",
        "eth",
        "uniswap",
        "new pair",
        "meme",
    ],
    "base": [
        "base",
        "base chain",
        "aerodrome",
        "new pair",
        "meme",
    ],
    "bsc": [
        "bsc",
        "bnb",
        "pancakeswap",
        "new pair",
    ],
    "arbitrum": [
        "arbitrum",
        "camelot",
        "new pair",
    ],
    "avalanche": [
        "avalanche",
        "trader joe",
        "new pair",
    ],
    "polygon": [
        "polygon",
        "quickswap",
        "new pair",
    ],
}


class DexScreenerScanner:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=15.0, trust_env=False)
        self.running = False
        self.in_flight = False
        self.scan_count = 0
        self.chains = ENABLED_CHAINS
        self.last_scan_at: datetime | None = None
        self.last_duration_ms: float = 0.0
        self.candidates_discovered: int = 0
        self.candidates_processed: int = 0
        self.successful_scans: int = 0
        self.new_tokens_saved: int = 0
        self.liquidity_positive_count: int = 0

    async def start(self):
        self.running = True
        logger.info("[DexScreener] Scanner started")
        while self.running:
            try:
                started = datetime.utcnow()
                self.in_flight = True
                cycle_stats = await self._scan_cycle()
                self.scan_count += 1
                self.successful_scans += 1
                self.last_scan_at = datetime.utcnow()
                self.last_duration_ms = max((self.last_scan_at - started).total_seconds() * 1000.0, 0.0)
                self.candidates_discovered = int(cycle_stats.get("discovered", 0) or 0)
                self.candidates_processed = int(cycle_stats.get("processed", 0) or 0)
                self.new_tokens_saved = int(cycle_stats.get("new_tokens", 0) or 0)
                self.liquidity_positive_count = int(cycle_stats.get("liquidity_positive", 0) or 0)
                if self.scan_count % 6 == 0:
                    logger.info(f"[DexScreener] Completed {self.scan_count} scan cycles")
            except Exception as e:
                logger.error(f"[DexScreener] Scan error: {e}")
            finally:
                self.in_flight = False
            await asyncio.sleep(settings.SCAN_INTERVAL_SECONDS)

    async def stop(self):
        self.running = False
        await self.client.aclose()
        logger.info("[DexScreener] Scanner stopped")

    async def scan_once(self):
        try:
            started = datetime.utcnow()
            self.in_flight = True
            cycle_stats = await self._scan_cycle()
            self.scan_count += 1
            self.successful_scans += 1
            self.last_scan_at = datetime.utcnow()
            self.last_duration_ms = max((self.last_scan_at - started).total_seconds() * 1000.0, 0.0)
            self.candidates_discovered = int(cycle_stats.get("discovered", 0) or 0)
            self.candidates_processed = int(cycle_stats.get("processed", 0) or 0)
            self.new_tokens_saved = int(cycle_stats.get("new_tokens", 0) or 0)
            self.liquidity_positive_count = int(cycle_stats.get("liquidity_positive", 0) or 0)
        except Exception as e:
            logger.error(f"[DexScreener] One-shot scan error: {e}")
        finally:
            self.in_flight = False

    async def _scan_cycle(self):
        discovered = 0
        processed = 0
        new_tokens = 0
        liquidity_positive = 0
        for chain in self.chains:
            try:
                chain_stats = await self._scan_chain_new_pairs(chain)
                discovered += int(chain_stats.get("discovered", 0) or 0)
                processed += int(chain_stats.get("processed", 0) or 0)
                new_tokens += int(chain_stats.get("new_tokens", 0) or 0)
                liquidity_positive += int(chain_stats.get("liquidity_positive", 0) or 0)
            except Exception as e:
                logger.error(f"[DexScreener] Error scanning {chain}: {e}")
        return {
            "discovered": discovered,
            "processed": processed,
            "new_tokens": new_tokens,
            "liquidity_positive": liquidity_positive,
        }

    async def _scan_chain_new_pairs(self, chain: str):
        cache_key = f"dex:latest_pairs:{chain}"
        cached = await cache_get(cache_key)
        new_contracts: list[str] = []
        discovered = 0
        processed = 0
        liquidity_positive = 0

        try:
            pairs = await self._fetch_chain_pairs(chain)
            if not pairs:
                return {"discovered": 0, "processed": 0, "new_tokens": 0, "liquidity_positive": 0}
            discovered = len(pairs)

            async with async_session_factory() as db:
                scan_limit = 500 if chain in {"ethereum", "base"} else 300
                for pair in pairs[:scan_limit]:
                    pair_chain = pair.get("chainId", "").lower()
                    if pair_chain != chain:
                        continue

                    contract = pair.get("baseToken", {}).get("address", "")
                    if not contract:
                        continue

                    pair_created = pair.get("pairCreatedAt")
                    launch_time = None
                    if pair_created:
                        try:
                            launch_time = datetime.fromtimestamp(pair_created / 1000)
                        except (ValueError, TypeError, OSError):
                            launch_time = None

                    existing = await db.execute(
                        select(Token).where(
                            Token.chain == chain,
                            Token.contract_address == contract,
                        )
                    )
                    token = existing.scalar_one_or_none()

                    liquidity_usd = float(pair.get("liquidity", {}).get("usd", 0) or 0)
                    processed += 1
                    if liquidity_usd > 0:
                        liquidity_positive += 1
                    market_cap = float(pair.get("marketCap", 0) or 0)
                    volume = pair.get("volume", {}) or {}
                    txns = pair.get("txns", {}) or {}
                    price_change = pair.get("priceChange", {}) or {}
                    info = pair.get("info", {}) or {}
                    websites = info.get("websites", []) or []
                    socials = info.get("socials", []) or []
                    pair_url = str(pair.get("url", "") or "")
                    logo_url = (
                        info.get("imageUrl")
                        or info.get("openGraph")
                        or (pair.get("baseToken", {}) or {}).get("logoURI")
                        or (pair.get("baseToken", {}) or {}).get("logoUrl")
                    )
                    source_hint = " ".join([
                        pair_url,
                        str(pair.get("dexId", "") or ""),
                        " ".join(str(site.get("url", "") or "") for site in websites),
                        " ".join(str(social.get("url", "") or "") for social in socials),
                    ]).lower()
                    existing_extra = (token.extra_data or {}) if token else {}
                    is_pump_fun = "pump.fun" in source_hint or bool(existing_extra.get("is_pump_fun", False))
                    website_urls = [str(site.get("url", "") or "") for site in websites if site.get("url")]
                    social_urls = [str(social.get("url", "") or "") for social in socials if social.get("url")]
                    launch_fingerprint = build_launch_fingerprint(
                        deployer_wallet=(pair.get("baseToken", {}) or {}).get("address"),
                        token_name=pair.get("baseToken", {}).get("name"),
                        token_symbol=pair.get("baseToken", {}).get("symbol"),
                        dex_id=pair.get("dexId"),
                        websites=website_urls,
                        socials=social_urls,
                        logo_url=logo_url,
                    )
                    metadata = {
                        "price_usd": float(pair.get("priceUsd", 0) or 0),
                        "volume_5m": float(volume.get("m5", 0) or 0),
                        "volume_1h": float(volume.get("h1", 0) or 0),
                        "volume_6h": float(volume.get("h6", 0) or 0),
                        "volume_24h": float(volume.get("h24", 0) or 0),
                        "price_change_5m": float(price_change.get("m5", 0) or 0),
                        "price_change_1h": float(price_change.get("h1", 0) or 0),
                        "price_change_6h": float(price_change.get("h6", 0) or 0),
                        "buys_5m": int((txns.get("m5", {}) or {}).get("buys", 0) or 0),
                        "sells_5m": int((txns.get("m5", {}) or {}).get("sells", 0) or 0),
                        "buys_1h": int((txns.get("h1", {}) or {}).get("buys", 0) or 0),
                        "sells_1h": int((txns.get("h1", {}) or {}).get("sells", 0) or 0),
                        "new_wallets_count": int((txns.get("m5", {}) or {}).get("buys", 0) or 0),
                        "logo_url": logo_url or existing_extra.get("logo_url"),
                        "websites": website_urls or existing_extra.get("websites") or [],
                        "socials": social_urls or existing_extra.get("socials") or [],
                        "source_url": pair_url or existing_extra.get("source_url"),
                        "launch_fingerprint": launch_fingerprint or existing_extra.get("launch_fingerprint"),
                        "is_pump_fun": is_pump_fun,
                        "source_platform": "pump.fun" if is_pump_fun else (pair.get("dexId") or existing_extra.get("source_platform") or "dexscreener"),
                        "buy_urls": {
                            "pump_fun": f"https://pump.fun/coin/{contract}",
                            "axiom": f"https://axiom.trade/t/{contract}",
                            "gmgn": f"https://gmgn.ai/sol/token/{contract}",
                        },
                    }

                    if token:
                        old_liquidity = token.liquidity_usd or 0
                        token.liquidity_usd = liquidity_usd
                        token.market_cap_usd = market_cap
                        token.extra_data = {**existing_extra, **metadata}
                        if launch_time and not token.liquidity_created_at:
                            token.liquidity_created_at = launch_time
                        token.updated_at = datetime.utcnow()

                        if old_liquidity > 0 and liquidity_usd < old_liquidity * 0.5:
                            change_pct = ((liquidity_usd - old_liquidity) / old_liquidity) * 100
                            event = LiquidityEvent(
                                token_id=token.id,
                                contract_address=contract,
                                chain=chain,
                                event_type="liquidity_removal",
                                pair_address=pair.get("pairAddress"),
                                liquidity_usd=liquidity_usd,
                                liquidity_change_usd=liquidity_usd - old_liquidity,
                                liquidity_change_pct=change_pct,
                            )
                            db.add(event)

                            alert = Alert(
                                token_id=token.id,
                                alert_type="liquidity_drain",
                                chain=chain,
                                severity="high",
                                title=f"Liquidity drain detected: {token.symbol}",
                                message=f"Liquidity dropped {abs(change_pct):.1f}% on {chain}",
                                contract_address=contract,
                                actual_value=liquidity_usd,
                            )
                            db.add(alert)

                            await publish_event("alerts", {
                                "type": "liquidity_drain",
                                "chain": chain,
                                "contract": contract,
                                "symbol": token.symbol,
                                "change_pct": change_pct,
                            })
                    else:
                        token = Token(
                            contract_address=contract,
                            chain=chain,
                            name=pair.get("baseToken", {}).get("name"),
                            symbol=pair.get("baseToken", {}).get("symbol"),
                            market_cap_usd=market_cap,
                            liquidity_usd=liquidity_usd,
                            pair_address=pair.get("pairAddress"),
                            dex_id=pair.get("dexId"),
                            liquidity_created_at=launch_time,
                            created_at=launch_time or datetime.utcnow(),
                            extra_data=metadata,
                        )
                        db.add(token)
                        new_contracts.append(contract)

                        event = LiquidityEvent(
                            contract_address=contract,
                            chain=chain,
                            event_type="new_pair",
                            pair_address=pair.get("pairAddress"),
                            liquidity_usd=liquidity_usd,
                        )
                        db.add(event)

                        await publish_event("alerts", {
                            "type": "new_pair",
                            "chain": chain,
                            "contract": contract,
                            "symbol": pair.get("baseToken", {}).get("symbol"),
                            "liquidity_usd": liquidity_usd,
                        })

                await db.commit()

            if new_contracts:
                await self._auto_score_new_tokens(chain, new_contracts)

            new_pair_ids = [p.get("pairAddress") for p in pairs[:scan_limit] if p.get("pairAddress")]
            await cache_set(cache_key, new_pair_ids, ttl=30)

        except httpx.HTTPError as e:
            logger.warning(f"[DexScreener] HTTP error for {chain}: {e}")

        return {
            "discovered": discovered,
            "processed": processed,
            "new_tokens": len(new_contracts),
            "liquidity_positive": liquidity_positive,
        }

    def get_health_snapshot(self) -> dict[str, object]:
        processed = max(self.candidates_processed, 0)
        liquidity_positive = max(self.liquidity_positive_count, 0)
        rate_pct = (liquidity_positive / processed * 100.0) if processed > 0 else 0.0
        return {
            "running": bool(self.running),
            "inFlight": bool(self.in_flight),
            "lastScanAt": self.last_scan_at.isoformat() if self.last_scan_at else None,
            "lastDurationMs": round(float(self.last_duration_ms or 0.0), 2),
            "candidatesDiscovered": int(self.candidates_discovered or 0),
            "candidatesProcessed": int(self.candidates_processed or 0),
            "successfulScans": int(self.successful_scans or 0),
            "newTokensSaved": int(self.new_tokens_saved or 0),
            "liquidityPositiveCount": int(liquidity_positive),
            "liquidityPositiveRatePct": round(rate_pct, 2),
            "cycleCount": int(self.scan_count or 0),
        }

    async def _fetch_chain_pairs(self, chain: str) -> list[dict]:
        search_terms = CHAIN_SEARCH_TERMS.get(chain, [chain, "new pair"])
        unique_pairs: dict[str, dict] = {}
        for term in search_terms:
            try:
                url = f"{settings.DEXSCREENER_API_URL}/search?q={term}"
                response = await self.client.get(url)
                if response.status_code != 200:
                    continue

                data = response.json()
                pairs = data.get("pairs", []) or []
                for pair in pairs:
                    if pair.get("chainId", "").lower() != chain:
                        continue

                    contract = (pair.get("baseToken", {}) or {}).get("address")
                    pair_address = pair.get("pairAddress")
                    unique_key = contract or pair_address
                    if not unique_key:
                        continue

                    if unique_key not in unique_pairs:
                        unique_pairs[unique_key] = pair
            except Exception as e:
                logger.warning(f"[DexScreener] Pair fetch failed for term '{term}': {e}")

        pairs = list(unique_pairs.values())
        pairs.sort(
            key=lambda pair: (
                int(pair.get("pairCreatedAt") or 0),
                float((pair.get("volume", {}) or {}).get("h1", 0) or 0),
            ),
            reverse=True,
        )
        return pairs

    async def _auto_score_new_tokens(self, chain: str, contracts: list[str]):
        scored = 0
        for contract in contracts[:10]:
            try:
                async with async_session_factory() as db:
                    result = await asyncio.wait_for(
                        scoring_service.score_token(db, contract, chain),
                        timeout=8,
                    )
                    await db.commit()

                    if result and not result.get("error"):
                        scored += 1
                        await publish_event("alerts", {
                            "type": "score_ready",
                            "chain": chain,
                            "contract": contract,
                            "confidence": result.get("scores", {}).get("trade_confidence_index"),
                        })
            except asyncio.TimeoutError:
                logger.warning(f"[DexScreener] Auto-score timeout for {contract}")
            except Exception as e:
                logger.warning(f"[DexScreener] Auto-score failed for {contract}: {e}")

        if scored:
            logger.info(f"[DexScreener] Auto-scored {scored} newly discovered tokens on {chain}")

    async def get_token_profile(self, chain: str, contract_address: str) -> Optional[dict]:
        try:
            url = f"{settings.DEXSCREENER_API_URL}/tokens/{contract_address}"
            response = await self.client.get(url)
            if response.status_code == 200:
                data = response.json()
                pairs = data.get("pairs", [])
                for pair in pairs:
                    if pair.get("chainId", "").lower() == chain:
                        return pair
        except Exception as e:
            logger.error(f"[DexScreener] Profile fetch error: {e}")
        return None


dex_scanner = DexScreenerScanner()
