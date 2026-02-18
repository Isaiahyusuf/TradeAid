import asyncio
from datetime import datetime
from typing import Optional
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import get_settings
from app.database import async_session_factory
from app.models.models import Token, LiquidityEvent, Alert
from app.utils.redis_client import cache_set, cache_get, publish_event
from app.utils.logging_config import logger

settings = get_settings()

CHAIN_MAPPING = {
    "solana": "solana",
    "ethereum": "ethereum",
    "bsc": "bsc",
    "base": "base",
    "arbitrum": "arbitrum",
    "avalanche": "avalanche",
    "polygon": "polygon",
}


class DexScreenerScanner:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=15.0)
        self.running = False
        self.scan_count = 0

    async def start(self):
        self.running = True
        logger.info("[DexScreener] Scanner started")
        while self.running:
            try:
                await self._scan_cycle()
                self.scan_count += 1
                if self.scan_count % 6 == 0:
                    logger.info(f"[DexScreener] Completed {self.scan_count} scan cycles")
            except Exception as e:
                logger.error(f"[DexScreener] Scan error: {e}")
            await asyncio.sleep(settings.SCAN_INTERVAL_SECONDS)

    async def stop(self):
        self.running = False
        await self.client.aclose()
        logger.info("[DexScreener] Scanner stopped")

    async def _scan_cycle(self):
        for chain in CHAIN_MAPPING.keys():
            try:
                await self._scan_chain_new_pairs(chain)
            except Exception as e:
                logger.error(f"[DexScreener] Error scanning {chain}: {e}")

    async def _scan_chain_new_pairs(self, chain: str):
        cache_key = f"dex:latest_pairs:{chain}"
        cached = await cache_get(cache_key)

        try:
            url = f"{settings.DEXSCREENER_API_URL}/search?q={chain}"
            response = await self.client.get(url)
            if response.status_code != 200:
                return

            data = response.json()
            pairs = data.get("pairs", [])
            if not pairs:
                return

            async with async_session_factory() as db:
                for pair in pairs[:50]:
                    pair_chain = pair.get("chainId", "").lower()
                    if pair_chain != chain:
                        continue

                    contract = pair.get("baseToken", {}).get("address", "")
                    if not contract:
                        continue

                    existing = await db.execute(
                        select(Token).where(
                            Token.chain == chain,
                            Token.contract_address == contract,
                        )
                    )
                    token = existing.scalar_one_or_none()

                    liquidity_usd = float(pair.get("liquidity", {}).get("usd", 0) or 0)
                    market_cap = float(pair.get("marketCap", 0) or 0)

                    if token:
                        old_liquidity = token.liquidity_usd or 0
                        token.liquidity_usd = liquidity_usd
                        token.market_cap_usd = market_cap
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
                        pair_created = pair.get("pairCreatedAt")
                        liq_created_at = None
                        if pair_created:
                            try:
                                liq_created_at = datetime.fromtimestamp(pair_created / 1000)
                            except (ValueError, TypeError, OSError):
                                pass

                        token = Token(
                            contract_address=contract,
                            chain=chain,
                            name=pair.get("baseToken", {}).get("name"),
                            symbol=pair.get("baseToken", {}).get("symbol"),
                            market_cap_usd=market_cap,
                            liquidity_usd=liquidity_usd,
                            pair_address=pair.get("pairAddress"),
                            dex_id=pair.get("dexId"),
                            liquidity_created_at=liq_created_at,
                        )
                        db.add(token)

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

            new_pair_ids = [p.get("pairAddress") for p in pairs[:50] if p.get("pairAddress")]
            await cache_set(cache_key, new_pair_ids, ttl=30)

        except httpx.HTTPError as e:
            logger.warning(f"[DexScreener] HTTP error for {chain}: {e}")

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
