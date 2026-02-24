from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.models import Token
from app.services.dexscreener_client import get_token_pairs


_BASE58_ALPHABET = set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")


class TokenResolverService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._client = httpx.AsyncClient(timeout=15.0, trust_env=False)
        self._sol_mint = "So11111111111111111111111111111111111111112"

    @staticmethod
    def _is_valid_solana_mint(mint_address: str) -> bool:
        value = str(mint_address or "").strip()
        if len(value) < 32 or len(value) > 44:
            return False
        return all(ch in _BASE58_ALPHABET for ch in value)

    @staticmethod
    def _safe_float(value: Any, default: float = 0.0) -> float:
        try:
            return float(value or default)
        except Exception:
            return default

    async def _fetch_helius(self, mint_address: str) -> dict[str, Any]:
        api_key = str(self.settings.HELIUS_API_KEY or "").strip()
        if not api_key:
            return {}
        rpc_url = f"https://mainnet.helius-rpc.com/?api-key={api_key}"

        supply_payload = {"jsonrpc": "2.0", "id": 1, "method": "getTokenSupply", "params": [mint_address]}
        largest_payload = {"jsonrpc": "2.0", "id": 1, "method": "getTokenLargestAccounts", "params": [mint_address]}
        sigs_payload = {"jsonrpc": "2.0", "id": 1, "method": "getSignaturesForAddress", "params": [mint_address, {"limit": 25}]}

        out: dict[str, Any] = {}
        try:
            supply_resp = await self._client.post(rpc_url, json=supply_payload)
            if supply_resp.status_code < 400:
                supply_data = supply_resp.json() or {}
                out["total_supply"] = self._safe_float((((supply_data.get("result") or {}).get("value") or {}).get("uiAmount")), 0.0)
        except Exception:
            pass

        try:
            holders_resp = await self._client.post(rpc_url, json=largest_payload)
            if holders_resp.status_code < 400:
                holders_data = holders_resp.json() or {}
                rows = (((holders_data.get("result") or {}).get("value") or []) if isinstance(holders_data, dict) else [])
                amounts = [self._safe_float((row or {}).get("uiAmount"), 0.0) for row in rows[:10]]
                total = sum(amounts)
                top10 = (sum(amounts[:10]) / total * 100.0) if total > 0 else 0.0
                top3 = (sum(amounts[:3]) / total * 100.0) if total > 0 else 0.0
                out["holder_count_estimate"] = len(rows)
                out["top10_percent"] = round(top10, 4)
                out["top3_percent"] = round(top3, 4)
        except Exception:
            pass

        try:
            sigs_resp = await self._client.post(rpc_url, json=sigs_payload)
            if sigs_resp.status_code < 400:
                sigs_data = sigs_resp.json() or {}
                rows = ((sigs_data.get("result") or []) if isinstance(sigs_data, dict) else [])
                block_times = [int((row or {}).get("blockTime") or 0) for row in rows if (row or {}).get("blockTime")]
                if block_times:
                    first_seen = min(block_times)
                    out["creation_slot"] = first_seen
                    age_minutes = (datetime.utcnow() - datetime.utcfromtimestamp(first_seen)).total_seconds() / 60.0
                    out["age_minutes"] = max(0.0, age_minutes)
        except Exception:
            pass

        return out

    async def _fetch_moralis(self, mint_address: str) -> dict[str, Any]:
        api_key = str(self.settings.MORALIS_API_KEY or "").strip()
        if not api_key:
            return {}
        url = f"https://solana-gateway.moralis.io/token/mainnet/{mint_address}/metadata"
        try:
            response = await self._client.get(url, headers={"X-API-Key": api_key})
            if response.status_code >= 400:
                return {}
            data = response.json() or {}
            return {
                "name": str(data.get("name") or ""),
                "symbol": str(data.get("symbol") or ""),
                "logo": data.get("logo") or data.get("image"),
                "created_at": data.get("createdAt") or data.get("created_at"),
            }
        except Exception:
            return {}

    async def _fetch_solscan(self, mint_address: str) -> dict[str, Any]:
        api_key = str(self.settings.SOLSCAN_API_KEY or "").strip()
        if not api_key:
            return {}
        url = "https://pro-api.solscan.io/v1.0/token/meta"
        try:
            response = await self._client.get(url, params={"tokenAddress": mint_address}, headers={"token": api_key, "accept": "application/json"})
            if response.status_code >= 400:
                return {}
            data = response.json() or {}
            top_holders = data.get("topHolders") or data.get("top_holders") or []
            top10 = 0.0
            top3 = 0.0
            if isinstance(top_holders, list):
                for row in top_holders[:10]:
                    pct = self._safe_float((row or {}).get("percent") or (row or {}).get("percentage"), 0.0)
                    top10 += pct
                for row in top_holders[:3]:
                    pct = self._safe_float((row or {}).get("percent") or (row or {}).get("percentage"), 0.0)
                    top3 += pct
            return {
                "holder_count": int(data.get("holder") or data.get("holder_count") or 0),
                "top10_percent": round(top10, 4),
                "top3_percent": round(top3, 4),
                "liquidity": self._safe_float(data.get("liquidity") or data.get("liquidityUsd"), 0.0),
                "transactions": int(data.get("txns") or data.get("transactions") or 0),
            }
        except Exception:
            return {}

    async def _fetch_dex(self, mint_address: str) -> dict[str, Any]:
        try:
            dex_data = get_token_pairs(mint_address)
            rows = (dex_data or {}).get("pairs", []) or []
            best: dict[str, Any] | None = None
            best_liquidity = -1.0
            for row in rows:
                if str((row or {}).get("chainId") or "").lower() != "solana":
                    continue
                liquidity = self._safe_float(((row or {}).get("liquidity") or {}).get("usd"), 0.0)
                if liquidity > best_liquidity:
                    best_liquidity = liquidity
                    best = row
            if not best:
                return {}
            volume = best.get("volume") or {}
            txns = best.get("txns") or {}
            price_change = best.get("priceChange") or {}
            created_at = self._safe_float(best.get("pairCreatedAt"), 0.0)
            age_minutes = 0.0
            if created_at > 0:
                age_minutes = max(0.0, (datetime.utcnow() - datetime.utcfromtimestamp(created_at / 1000.0)).total_seconds() / 60.0)
            return {
                "name": str(((best.get("baseToken") or {}).get("name") or "")),
                "symbol": str(((best.get("baseToken") or {}).get("symbol") or "")),
                "pair_address": str(best.get("pairAddress") or ""),
                "dex_id": str(best.get("dexId") or ""),
                "liquidity": self._safe_float((best.get("liquidity") or {}).get("usd"), 0.0),
                "price": self._safe_float(best.get("priceUsd"), 0.0),
                "market_cap": self._safe_float(best.get("marketCap"), 0.0),
                "volume_5m": self._safe_float(volume.get("m5"), 0.0),
                "volume_1h": self._safe_float(volume.get("h1"), 0.0),
                "buy_sell_ratio": (self._safe_float(((txns.get("m5") or {}).get("buys"), 0.0) + 1.0) /
                                   max(self._safe_float(((txns.get("m5") or {}).get("sells"), 0.0) + 1.0), 1.0)),
                "price_change_5m": self._safe_float(price_change.get("m5"), 0.0),
                "age_minutes": age_minutes,
                "source_url": str(best.get("url") or ""),
            }
        except Exception:
            return {}

    async def _fetch_jupiter(self, mint_address: str) -> dict[str, Any]:
        api_key = str(self.settings.JUPITER_API_KEY or "").strip()
        if not api_key:
            return {}
        try:
            response = await self._client.get(
                "https://quote-api.jup.ag/v6/quote",
                params={
                    "inputMint": self._sol_mint,
                    "outputMint": mint_address,
                    "amount": "10000000",
                    "slippageBps": "200",
                    "onlyDirectRoutes": "false",
                },
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if response.status_code >= 400:
                return {}
            data = response.json() or {}
            out_amount = int(data.get("outAmount") or 0)
            price_impact = self._safe_float(data.get("priceImpactPct"), 0.0)
            return {
                "jupiter_route": out_amount > 0,
                "slippage_percent": round(price_impact * 100.0, 4),
            }
        except Exception:
            return {}

    async def _resolve_from_apis(self, mint_address: str) -> dict[str, Any]:
        helius = await self._fetch_helius(mint_address)
        moralis = await self._fetch_moralis(mint_address)
        solscan = await self._fetch_solscan(mint_address)
        dex = await self._fetch_dex(mint_address)
        jupiter = await self._fetch_jupiter(mint_address)

        if not any([helius, moralis, solscan, dex, jupiter]):
            return {}

        age_minutes = self._safe_float(helius.get("age_minutes"), 0.0)
        if age_minutes <= 0:
            age_minutes = self._safe_float(dex.get("age_minutes"), 0.0)

        token_data = {
            "mint": mint_address,
            "name": str(moralis.get("name") or dex.get("name") or "Unknown"),
            "symbol": str(moralis.get("symbol") or dex.get("symbol") or "UNKNOWN"),
            "liquidity": self._safe_float(solscan.get("liquidity"), 0.0) or self._safe_float(dex.get("liquidity"), 0.0),
            "price": self._safe_float(dex.get("price"), 0.0),
            "market_cap": self._safe_float(dex.get("market_cap"), 0.0),
            "volume_5m": self._safe_float(dex.get("volume_5m"), 0.0),
            "volume_1h": self._safe_float(dex.get("volume_1h"), 0.0),
            "holder_count": int(solscan.get("holder_count") or helius.get("holder_count_estimate") or 0),
            "top10_percent": self._safe_float(solscan.get("top10_percent"), 0.0) or self._safe_float(helius.get("top10_percent"), 0.0),
            "top3_percent": self._safe_float(solscan.get("top3_percent"), 0.0) or self._safe_float(helius.get("top3_percent"), 0.0),
            "mint_authority_active": False,
            "freeze_authority_active": False,
            "age_minutes": age_minutes,
            "jupiter_route": bool(jupiter.get("jupiter_route", False)),
            "slippage_percent": self._safe_float(jupiter.get("slippage_percent"), 0.0),
            "total_supply": self._safe_float(helius.get("total_supply"), 0.0),
            "logo": moralis.get("logo"),
            "pair_address": dex.get("pair_address"),
            "dex_id": dex.get("dex_id"),
            "source_url": dex.get("source_url"),
            "last_updated": datetime.utcnow().isoformat(),
            "resolver_sources": {
                "helius": bool(helius),
                "moralis": bool(moralis),
                "solscan": bool(solscan),
                "dex": bool(dex),
                "jupiter": bool(jupiter),
            },
        }
        return token_data

    async def resolve_token(self, db: AsyncSession, mint_address: str) -> dict[str, Any]:
        mint = str(mint_address or "").strip()
        if not self._is_valid_solana_mint(mint):
            return {"error": "Invalid Solana mint address", "invalid": True}

        result = await db.execute(select(Token).where(Token.chain == "solana", Token.contract_address == mint))
        token = result.scalar_one_or_none()

        if token:
            extra = dict(token.extra_data or {})
            active = self._safe_float(extra.get("volume_5m"), 0.0) > 0
            ttl = timedelta(seconds=30 if active else 300)
            last_update = token.updated_at or token.created_at
            if last_update and (datetime.utcnow() - last_update) <= ttl:
                return {"token": token, "source": "cache"}

        resolved = await self._resolve_from_apis(mint)
        if not resolved:
            return {"error": "Fetching live token data...", "invalid": False}

        if not token:
            token = Token(contract_address=mint, chain="solana", created_at=datetime.utcnow())
            db.add(token)

        token.name = resolved.get("name") or token.name
        token.symbol = resolved.get("symbol") or token.symbol
        token.market_cap_usd = self._safe_float(resolved.get("market_cap"), 0.0)
        token.liquidity_usd = self._safe_float(resolved.get("liquidity"), 0.0)
        token.holder_count = int(resolved.get("holder_count") or token.holder_count or 0)
        token.is_mintable = bool(resolved.get("mint_authority_active", False))
        token.is_ownership_renounced = not bool(resolved.get("freeze_authority_active", False))
        token.pair_address = str(resolved.get("pair_address") or token.pair_address or "") or None
        token.dex_id = str(resolved.get("dex_id") or token.dex_id or "") or None

        merged_extra = dict(token.extra_data or {})
        merged_extra.update(
            {
                "price_usd": self._safe_float(resolved.get("price"), 0.0),
                "volume_5m": self._safe_float(resolved.get("volume_5m"), 0.0),
                "volume_1h": self._safe_float(resolved.get("volume_1h"), 0.0),
                "holder_count": int(resolved.get("holder_count") or 0),
                "top10_percent": self._safe_float(resolved.get("top10_percent"), 0.0),
                "top3_percent": self._safe_float(resolved.get("top3_percent"), 0.0),
                "mint_authority_active": bool(resolved.get("mint_authority_active", False)),
                "freeze_authority_active": bool(resolved.get("freeze_authority_active", False)),
                "age_minutes": self._safe_float(resolved.get("age_minutes"), 0.0),
                "jupiter_route": bool(resolved.get("jupiter_route", False)),
                "slippage_percent": self._safe_float(resolved.get("slippage_percent"), 0.0),
                "total_supply": self._safe_float(resolved.get("total_supply"), 0.0),
                "logo_url": resolved.get("logo"),
                "source_url": resolved.get("source_url"),
                "last_updated": resolved.get("last_updated"),
                "resolver_sources": resolved.get("resolver_sources") or {},
            }
        )
        token.extra_data = merged_extra
        token.updated_at = datetime.utcnow()

        await db.flush()
        return {"token": token, "source": "live"}


resolver_service = TokenResolverService()
