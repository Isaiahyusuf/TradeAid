from __future__ import annotations

import os
import time
from datetime import datetime
from typing import Any

import httpx

from app.config import get_settings
from app.doctor.pump_detector import DexNewPairsScanner, FreshTokenScoringEngine, PumpListener, TokenEnricher, TokenValidator
from app.doctor.services import CoinGeckoService, HeliusService, JupiterService, MoralisService, SolscanService


class DoctorMultiSourceScanner:
    def __init__(self) -> None:
        settings = get_settings()
        self._client = httpx.AsyncClient(timeout=12.0)
        self._walletbot_key = str(getattr(settings, "WALLETBOT_KEY", "") or os.getenv("WALLETBOT_KEY") or "").strip()
        self._coingecko_key = str(getattr(settings, "COINGECKO_API_KEY", "") or os.getenv("COINGECKO_API_KEY") or "").strip()
        self._solscan_key = str(getattr(settings, "SOLSCAN_API_KEY", "") or os.getenv("SOLSCAN_API_KEY") or "").strip()
        self._bitquery_key = str(getattr(settings, "BITQUERY_API_KEY", "") or os.getenv("BITQUERY_API_KEY") or "").strip()
        self._helius_key = str(getattr(settings, "HELIUS_API_KEY", "") or os.getenv("HELIUS_API_KEY") or "").strip()
        self._moralis_key = str(getattr(settings, "MORALIS_API_KEY", "") or os.getenv("MORALIS_API_KEY") or "").strip()
        self._jupiter_key = str(getattr(settings, "JUPITER_API_KEY", "") or os.getenv("JUPITER_API_KEY") or "").strip()
        self._covalent_key = str(getattr(settings, "COVALENT_API_KEY", "") or os.getenv("COVALENT_API_KEY") or "").strip()
        self._the_graph_endpoint = str(getattr(settings, "THE_GRAPH_ENDPOINT", "") or os.getenv("THE_GRAPH_ENDPOINT") or "").strip()

        self._search_terms = ["solana", "pump.fun", "raydium", "meme", "bonk", "wif"]

        self.min_liquidity_usd = float(
            getattr(settings, "DOCTOR_MIN_LIQUIDITY_USD", 20000.0) or os.getenv("DOCTOR_MIN_LIQUIDITY_USD", "20000")
        )
        self.min_volume_24h_usd = float(
            getattr(settings, "DOCTOR_MIN_VOLUME_24H_USD", 5000.0) or os.getenv("DOCTOR_MIN_VOLUME_24H_USD", "5000")
        )
        self.min_age_minutes = float(
            getattr(settings, "DOCTOR_MIN_AGE_MINUTES", 5) or os.getenv("DOCTOR_MIN_AGE_MINUTES", "5")
        )
        self.max_age_minutes = float(
            getattr(settings, "DOCTOR_MAX_AGE_MINUTES", 1440) or os.getenv("DOCTOR_MAX_AGE_MINUTES", "1440")
        )
        self._strict_fresh_age_minutes = 60.0
        self._sol_mint = "So11111111111111111111111111111111111111112"
        self._security_blacklist: set[str] = set()

        self.coingecko_service = CoinGeckoService(self._coingecko_key, min_volume_usd=self.min_volume_24h_usd)
        self.helius_service = HeliusService(self._helius_key)
        self.moralis_service = MoralisService(self._moralis_key)
        self.solscan_service = SolscanService(self._solscan_key, min_liquidity_usd=self.min_liquidity_usd)
        self.jupiter_service = JupiterService(self._jupiter_key)

        self.dex_pairs_scanner = DexNewPairsScanner(min_liquidity_usd=self.min_liquidity_usd)
        self.pump_listener = PumpListener(self.helius_service)
        self.token_enricher = TokenEnricher(
            coingecko=self.coingecko_service,
            helius=self.helius_service,
            moralis=self.moralis_service,
            solscan=self.solscan_service,
            jupiter=self.jupiter_service,
            dex_scanner=self.dex_pairs_scanner,
        )
        self.token_validator = TokenValidator(min_liquidity_usd=self.min_liquidity_usd, min_volume_24h_usd=self.min_volume_24h_usd)
        self.scoring_engine = FreshTokenScoringEngine()
        self.fresh_token_queue: list[dict[str, Any]] = []
        self._recent_intelligence: list[dict[str, Any]] = []
        self._fresh_feed_status: dict[str, Any] = {
            "last_cycle_at": None,
            "detected": 0,
            "enriched": 0,
            "approved": 0,
            "rejected": 0,
        }
        self._telemetry: dict[str, dict[str, Any]] = {
            "walletbot": self._new_source_metrics(),
            "dexscreener": self._new_source_metrics(),
            "coingecko": self._new_source_metrics(),
            "solscan": self._new_source_metrics(),
            "helius": self._new_source_metrics(),
            "moralis": self._new_source_metrics(),
            "jupiter": self._new_source_metrics(),
            "bitquery": self._new_source_metrics(),
            "covalent": self._new_source_metrics(),
            "the_graph": self._new_source_metrics(),
        }

    async def close(self) -> None:
        await self._client.aclose()

    @staticmethod
    def _safe_float(value: Any, default: float = 0.0) -> float:
        try:
            return float(value or default)
        except Exception:
            return default

    @staticmethod
    def _safe_int(value: Any, default: int = 0) -> int:
        try:
            return int(value or default)
        except Exception:
            return default

    @staticmethod
    def _new_source_metrics() -> dict[str, Any]:
        return {
            "calls": 0,
            "success": 0,
            "errors": 0,
            "key_missing": 0,
            "avg_latency_ms": 0.0,
            "last_error": None,
            "last_status": "never_called",
        }

    def _record_metric(self, source: str, *, ok: bool, latency_ms: float, error: str | None = None, key_missing: bool = False) -> None:
        metrics = self._telemetry.setdefault(source, self._new_source_metrics())
        metrics["calls"] = int(metrics.get("calls") or 0) + 1
        if ok:
            metrics["success"] = int(metrics.get("success") or 0) + 1
            metrics["last_status"] = "ok"
            metrics["last_error"] = None
        else:
            metrics["errors"] = int(metrics.get("errors") or 0) + 1
            metrics["last_status"] = "error"
            metrics["last_error"] = error
        if key_missing:
            metrics["key_missing"] = int(metrics.get("key_missing") or 0) + 1
            metrics["last_status"] = "key_missing"
            if not metrics.get("last_error"):
                metrics["last_error"] = "missing_api_key"

        calls = max(int(metrics.get("calls") or 1), 1)
        current_avg = self._safe_float(metrics.get("avg_latency_ms"), 0.0)
        metrics["avg_latency_ms"] = round(((current_avg * (calls - 1)) + max(latency_ms, 0.0)) / calls, 2)

    def get_source_health(self) -> dict[str, Any]:
        overall_calls = 0
        overall_success = 0
        overall_errors = 0
        for source_metrics in self._telemetry.values():
            overall_calls += int(source_metrics.get("calls") or 0)
            overall_success += int(source_metrics.get("success") or 0)
            overall_errors += int(source_metrics.get("errors") or 0)

        return {
            "overall": {
                "calls": overall_calls,
                "success": overall_success,
                "errors": overall_errors,
                "success_rate_pct": round((overall_success / max(overall_calls, 1)) * 100.0, 2),
            },
            "sources": self._telemetry,
        }

    async def _request_json(self, method: str, url: str, *, source: str, key_required: bool = False, key_present: bool = True, **kwargs: Any) -> Any:
        if key_required and not key_present:
            self._record_metric(source, ok=False, latency_ms=0.0, error="missing_api_key", key_missing=True)
            return None
        for _attempt in range(3):
            start = time.perf_counter()
            try:
                response = await self._client.request(method.upper(), url, **kwargs)
                if response.status_code >= 400:
                    latency_ms = (time.perf_counter() - start) * 1000.0
                    self._record_metric(source, ok=False, latency_ms=latency_ms, error=f"http_{response.status_code}")
                    continue
                payload = response.json()
                latency_ms = (time.perf_counter() - start) * 1000.0
                self._record_metric(source, ok=True, latency_ms=latency_ms)
                return payload
            except Exception as exc:
                latency_ms = (time.perf_counter() - start) * 1000.0
                self._record_metric(source, ok=False, latency_ms=latency_ms, error=str(exc))
                continue
        return None

    async def get_trending_walletbot(self) -> list[dict[str, Any]]:
        headers = {"accept": "application/json"}
        if self._walletbot_key:
            headers["Authorization"] = f"Bearer {self._walletbot_key}"

        data = await self._request_json("GET", "https://walletbot.pro/api/trending", headers=headers, source="walletbot")
        if isinstance(data, dict):
            rows = data.get("tokens") or data.get("data") or []
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)]
        return []

    async def get_dexscreener_tokens(self) -> list[dict[str, Any]]:
        unique: dict[str, dict[str, Any]] = {}
        for term in self._search_terms:
            data = await self._request_json("GET", f"https://api.dexscreener.com/latest/dex/search?q={term}", source="dexscreener")
            rows = (data or {}).get("pairs", []) if isinstance(data, dict) else []
            for pair in rows:
                if not isinstance(pair, dict):
                    continue
                if str(pair.get("chainId") or "").lower() != "solana":
                    continue
                base = pair.get("baseToken") or {}
                address = str(base.get("address") or "").strip()
                if not address:
                    continue
                unique[address] = pair
        return list(unique.values())

    async def get_dexscreener_token_detail(self, token_address: str) -> dict[str, Any] | None:
        if not token_address:
            return None
        data = await self._request_json("GET", f"https://api.dexscreener.com/latest/dex/tokens/{token_address}", source="dexscreener")
        if not isinstance(data, dict):
            return None
        pairs = data.get("pairs") or []
        if not isinstance(pairs, list):
            return None
        best_pair: dict[str, Any] | None = None
        best_liquidity = -1.0
        for pair in pairs:
            if not isinstance(pair, dict):
                continue
            if str(pair.get("chainId") or "").lower() != "solana":
                continue
            liquidity = self._safe_float((pair.get("liquidity") or {}).get("usd"), 0.0)
            if liquidity > best_liquidity:
                best_liquidity = liquidity
                best_pair = pair
        return best_pair

    async def get_coingecko_stats(self, token_address: str) -> dict[str, Any]:
        if not token_address:
            return {}
        headers = {"accept": "application/json"}
        if self._coingecko_key:
            headers["X-CG-API-KEY"] = self._coingecko_key
        data = await self._request_json("GET", f"https://api.coingecko.com/api/v3/coins/solana/contract/{token_address}", headers=headers, source="coingecko")
        return data if isinstance(data, dict) else {}

    async def get_solscan_stats(self, token_address: str) -> dict[str, Any]:
        if not token_address:
            return {}
        headers = {"accept": "application/json"}
        if self._solscan_key:
            headers["token"] = self._solscan_key

        primary = await self._request_json("GET", f"https://api.solscan.io/v1/token/meta?tokenAddress={token_address}", headers=headers, source="solscan")
        if isinstance(primary, dict):
            return primary

        fallback = await self._request_json("GET", f"https://public-api.solscan.io/token/meta?tokenAddress={token_address}", headers={"accept": "application/json"}, source="solscan")
        return fallback if isinstance(fallback, dict) else {}

    async def get_helius_mints(self) -> list[dict[str, Any]]:
        if not self._helius_key:
            return []
        data = await self._request_json(
            "GET",
            f"https://api.helius.xyz/v0/mints?api-key={self._helius_key}",
            source="helius",
            key_required=True,
            key_present=bool(self._helius_key),
        )
        if isinstance(data, list):
            return [row for row in data if isinstance(row, dict)]
        if isinstance(data, dict):
            rows = data.get("result") or data.get("mints") or []
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)]
        return []

    async def get_bitquery_trades(self, token_address: str) -> dict[str, Any]:
        if not token_address or not self._bitquery_key:
            return {}

        query = """
        query ($addr: String!) {
          solana {
            transfers(currency: {is: $addr}, options: {limit: 250}) {
              amount
            }
            dexTrades(baseCurrency: {is: $addr}, options: {limit: 250}) {
              tradeAmount(in: USD)
            }
          }
        }
        """
        headers = {"X-API-KEY": self._bitquery_key, "Content-Type": "application/json"}
        payload = {"query": query, "variables": {"addr": token_address}}
        data = await self._request_json(
            "POST",
            "https://graphql.bitquery.io/",
            headers=headers,
            json=payload,
            source="bitquery",
            key_required=True,
            key_present=bool(self._bitquery_key),
        )
        if not isinstance(data, dict):
            return {}
        return data

    async def get_covalent_stats(self, token_address: str) -> dict[str, Any]:
        if not token_address or not self._covalent_key:
            return {}
        url = f"https://api.covalenthq.com/v1/solana-mainnet/address/{token_address}/balances_v2/?key={self._covalent_key}"
        data = await self._request_json(
            "GET",
            url,
            headers={"accept": "application/json"},
            source="covalent",
            key_required=True,
            key_present=bool(self._covalent_key),
        )
        return data if isinstance(data, dict) else {}

    async def get_the_graph_stats(self, token_address: str) -> dict[str, Any]:
        if not token_address or not self._the_graph_endpoint:
            return {}
        query = """
        query ($token: String!) {
          token(id: $token) {
            id
            symbol
            name
          }
        }
        """
        data = await self._request_json(
            "POST",
            self._the_graph_endpoint,
            headers={"Content-Type": "application/json"},
            json={"query": query, "variables": {"token": token_address.lower()}},
            source="the_graph",
            key_required=True,
            key_present=bool(self._the_graph_endpoint),
        )
        return data if isinstance(data, dict) else {}

    def _extract_address(self, row: dict[str, Any]) -> str:
        candidates = [
            row.get("address"),
            row.get("tokenAddress"),
            row.get("mint"),
            (row.get("baseToken") or {}).get("address") if isinstance(row.get("baseToken"), dict) else None,
        ]
        for value in candidates:
            address = str(value or "").strip()
            if address:
                return address
        return ""

    def _compute_age_minutes(self, pair: dict[str, Any], coingecko: dict[str, Any]) -> float:
        created_ms = self._safe_float(pair.get("pairCreatedAt"), 0.0)
        if created_ms > 0:
            created = datetime.utcfromtimestamp(created_ms / 1000.0)
            return max(0.0, (datetime.utcnow() - created).total_seconds() / 60.0)

        first_seen = ((coingecko.get("market_data") or {}).get("last_updated") or "") if isinstance(coingecko, dict) else ""
        if first_seen:
            try:
                dt = datetime.fromisoformat(str(first_seen).replace("Z", "+00:00"))
                return max(0.0, (datetime.utcnow() - dt.replace(tzinfo=None)).total_seconds() / 60.0)
            except Exception:
                return 0.0
        return 0.0

    def _compute_age_from_moralis(self, created_at: Any) -> float:
        value = str(created_at or "").strip()
        if not value:
            return 0.0
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return max(0.0, (datetime.utcnow() - dt.replace(tzinfo=None)).total_seconds() / 60.0)
        except Exception:
            return 0.0

    def _is_lp_verified(self, pair: dict[str, Any], solscan: dict[str, Any]) -> bool:
        labels = [str(item).lower() for item in (pair.get("labels") or [])]
        if any("verified" in item for item in labels):
            return True
        if bool(solscan.get("verified")):
            return True
        return self._safe_float((pair.get("liquidity") or {}).get("usd"), 0.0) > 0

    def _top_holder_pct(self, pair: dict[str, Any], solscan: dict[str, Any]) -> float:
        pair_info = pair.get("info") or {}
        value = pair_info.get("topHolderPct")
        if value is not None:
            return self._safe_float(value, 100.0)
        return self._safe_float(solscan.get("topHolderPct"), 10.0)

    def _bitquery_activity(self, bitquery: dict[str, Any]) -> tuple[int, float]:
        if not isinstance(bitquery, dict):
            return 0, 0.0
        solana = ((bitquery.get("data") or {}).get("solana") or {}) if isinstance(bitquery.get("data"), dict) else {}
        transfers = solana.get("transfers") or []
        trades = solana.get("dexTrades") or []
        tx_count = len(transfers) + len(trades)
        usd_volume = 0.0
        for row in trades:
            usd_volume += self._safe_float((row or {}).get("tradeAmount"), 0.0)
        return tx_count, usd_volume

    def _score_candidate(
        self,
        *,
        liquidity: float,
        volume_24h: float,
        market_cap: float,
        buy_sell_ratio: float,
        age_minutes: float,
        tx_count: int,
    ) -> float:
        liquidity_score = min(liquidity / 200000.0, 1.0) * 28.0
        volume_score = min(volume_24h / 300000.0, 1.0) * 28.0
        cap_score = (1.0 - min(abs(market_cap - 650000.0) / 1500000.0, 1.0)) * 10.0
        ratio_score = min(max(buy_sell_ratio, 0.0), 2.0) / 2.0 * 14.0
        age_score = min(max(age_minutes, 0.0) / 120.0, 1.0) * 10.0
        activity_score = min(tx_count / 300.0, 1.0) * 10.0
        return round(min(100.0, liquidity_score + volume_score + cap_score + ratio_score + age_score + activity_score), 2)

    def _fomo_trend_score(self, volume_5m: float, volume_15m: float, buy_sell_ratio: float, age_minutes: float, strategy_mode: str) -> float:
        spike = (volume_5m * 3.0) / max(volume_15m, 1.0)
        mode_bonus = 1.15 if strategy_mode == "pump_sniper" else 1.0 if strategy_mode == "new_launch" else 0.9
        raw = (spike * 24.0) + (min(max(buy_sell_ratio, 0.0), 2.0) * 18.0) + (max(0.0, 40.0 - min(age_minutes, 40.0)))
        return round(min(100.0, raw * mode_bonus), 2)

    async def _candidate_from_address(self, token_address: str, seed: dict[str, Any] | None = None) -> dict[str, Any] | None:
        address = str(token_address or "").strip()
        if not address:
            return None
        if address in self._security_blacklist:
            return None

        pair = await self.get_dexscreener_token_detail(address) or {}
        coingecko = await self.get_coingecko_stats(address)
        solscan = await self.get_solscan_stats(address)
        bitquery = await self.get_bitquery_trades(address)

        cg_market = await self.coingecko_service.get_token_market(address)
        moralis_meta = await self.moralis_service.get_token_metadata(address)
        helius_supply = await self.helius_service.get_token_supply(address)
        helius_holders = await self.helius_service.get_holder_distribution(address)
        solscan_risk = await self.solscan_service.validate_holder_risk(address)
        jupiter_sim = await self.jupiter_service.simulate_trade(
            input_mint=self._sol_mint,
            output_mint=address,
            amount_lamports=10_000_000,
            slippage_bps=200,
        )

        covalent = {}
        the_graph = {}
        if not coingecko:
            covalent = await self.get_covalent_stats(address)
            the_graph = await self.get_the_graph_stats(address)

        volume = pair.get("volume") or {}
        txns = pair.get("txns") or {}
        market_data = coingecko.get("market_data") or {}

        liquidity = self._safe_float((pair.get("liquidity") or {}).get("usd"), 0.0)
        if liquidity <= 0:
            liquidity = self._safe_float(solscan.get("liquidity"), 0.0)
        if liquidity <= 0:
            return None

        volume_24h = self._safe_float(volume.get("h24"), 0.0)
        if volume_24h <= 0:
            volume_24h = self._safe_float((market_data.get("total_volume") or {}).get("usd"), 0.0)
        volume_24h = max(volume_24h, self._safe_float(cg_market.get("volume_24h"), 0.0))

        market_cap = self._safe_float(pair.get("marketCap"), 0.0)
        if market_cap <= 0:
            market_cap = self._safe_float((market_data.get("market_cap") or {}).get("usd"), 0.0)
        market_cap = max(market_cap, self._safe_float(cg_market.get("market_cap"), 0.0))

        buys_5m = self._safe_float(((txns.get("m5") or {}).get("buys")), 0.0)
        sells_5m = self._safe_float(((txns.get("m5") or {}).get("sells")), 0.0)
        buy_sell_ratio = (buys_5m + 1.0) / (sells_5m + 1.0)

        volume_5m = self._safe_float(volume.get("m5"), 0.0)
        volume_15m = self._safe_float(volume.get("m15"), 0.0)
        volume_1h = self._safe_float(volume.get("h1"), 0.0)
        volume_spike_pct = ((volume_5m * 12.0) / max(volume_1h, 1.0) - 1.0) * 100.0

        age_minutes = self._compute_age_minutes(pair, coingecko)
        moralis_age = self._compute_age_from_moralis(moralis_meta.get("created_at"))
        if moralis_age > 0:
            age_minutes = moralis_age
        lp_verified = self._is_lp_verified(pair, solscan)
        top_holder_pct = self._top_holder_pct(pair, solscan)
        top_holder_pct = max(top_holder_pct, self._safe_float(helius_holders.get("top3_holder_pct"), 0.0))
        unlocked_risk = bool((pair.get("info") or {}).get("lpLocked") is False)

        if isinstance(solscan_risk, dict) and not bool(solscan_risk.get("passed", True)):
            self._security_blacklist.add(address)
            return None
        if top_holder_pct > 40.0:
            self._security_blacklist.add(address)
            return None

        tx_count, bitquery_trade_usd = self._bitquery_activity(bitquery)
        volume_24h = max(volume_24h, bitquery_trade_usd)

        if liquidity < self.min_liquidity_usd:
            return None
        if volume_24h < self.min_volume_24h_usd:
            return None
        if age_minutes < self.min_age_minutes:
            return None
        if age_minutes < self._strict_fresh_age_minutes and volume_24h < (self.min_volume_24h_usd * 3.0):
            return None
        if self.max_age_minutes > 0 and age_minutes > self.max_age_minutes:
            return None
        if not lp_verified:
            return None
        if top_holder_pct > 40.0:
            return None
        if unlocked_risk:
            return None

        price_usd = self._safe_float(pair.get("priceUsd"), 0.0)
        if price_usd <= 0:
            price_usd = self._safe_float(market_data.get("current_price", {}).get("usd"), 0.0) if isinstance(market_data, dict) else 0.0
        price_usd = max(price_usd, self._safe_float(cg_market.get("price_usd"), 0.0))

        base = (pair.get("baseToken") or {}) if isinstance(pair, dict) else {}
        symbol = str(base.get("symbol") or moralis_meta.get("symbol") or (coingecko.get("symbol") if isinstance(coingecko, dict) else "") or (seed or {}).get("symbol") or "UNKNOWN").upper()
        name = str(base.get("name") or moralis_meta.get("name") or (coingecko.get("name") if isinstance(coingecko, dict) else "") or (seed or {}).get("name") or symbol)
        strategy_mode = str((seed or {}).get("_doctor_strategy_mode") or "trending")
        fomo_trend_score = self._fomo_trend_score(volume_5m, volume_15m, buy_sell_ratio, age_minutes, strategy_mode)

        score = self._score_candidate(
            liquidity=liquidity,
            volume_24h=volume_24h,
            market_cap=market_cap,
            buy_sell_ratio=buy_sell_ratio,
            age_minutes=age_minutes,
            tx_count=tx_count,
        )
        score = round(min(100.0, score + (fomo_trend_score * 0.16)), 2)

        if strategy_mode == "pump_sniper":
            score = round(min(100.0, score + 4.0), 2)
        elif strategy_mode == "new_launch":
            score = round(min(100.0, score + 2.0), 2)

        return {
            "symbol": symbol,
            "address": address,
            "name": name,
            "liquidity": liquidity,
            "volume_5m": volume_5m,
            "volume_15m": volume_15m,
            "volume_1h": volume_1h,
            "volume_24h": volume_24h,
            "market_cap": market_cap,
            "volume_spike_pct": round(volume_spike_pct, 4),
            "buy_sell_ratio": round(buy_sell_ratio, 4),
            "age_minutes": round(age_minutes, 4),
            "fomo_trend_score": fomo_trend_score,
            "score": score,
            "price_usd": price_usd,
            "token_supply": helius_supply,
            "holder_count": int(solscan_risk.get("holder_count") or helius_holders.get("accounts") or 0) if isinstance(solscan_risk, dict) else int(helius_holders.get("accounts") or 0),
            "pair_address": str(pair.get("pairAddress") or ""),
            "dex_id": str(pair.get("dexId") or ""),
            "lp_verified": lp_verified,
            "top_holder_pct": top_holder_pct,
            "liquidity_unlocked_risk": unlocked_risk,
            "estimated_slippage_pct": float(jupiter_sim.get("price_impact_pct") or 0.0),
            "jupiter_liquidity_confirmed": bool(jupiter_sim.get("approved", False)),
            "fresh_intel_approved": bool((seed or {}).get("_fresh_approved", False)),
            "fresh_intel_score": int((seed or {}).get("_fresh_score", 0) or 0),
            "strategy_mode": strategy_mode,
            "honeypot_risk": bool((pair.get("info") or {}).get("honeypotRisk", False)),
            "suspicious_contract": bool((pair.get("info") or {}).get("suspicious", False)),
            "source_flags": {
                "walletbot": bool(seed and seed.get("_source_walletbot")),
                "dexscreener": bool(pair),
                "coingecko": bool(coingecko),
                "solscan": bool(solscan),
                "helius": bool(seed and seed.get("_source_helius")),
                "moralis": bool(moralis_meta),
                "jupiter": bool(jupiter_sim),
                "bitquery": bool(bitquery),
                "covalent": bool(covalent),
                "the_graph": bool(the_graph),
            },
        }

    async def monitor_fresh_tokens(self, limit: int = 25) -> list[dict[str, Any]]:
        self._fresh_feed_status["last_cycle_at"] = datetime.utcnow().isoformat()
        primary = await self.pump_listener.detect_fresh_tokens(max_age_minutes=5.0, limit=max(50, limit * 5))
        secondary = await self.dex_pairs_scanner.fetch_new_pairs(max_age_minutes=5.0)

        combined: dict[str, dict[str, Any]] = {}
        for row in primary + secondary:
            mint = str(row.get("mint_address") or "").strip()
            if not mint:
                continue
            existing = combined.get(mint, {})
            next_row = dict(existing)
            next_row.update(row)
            combined[mint] = next_row

        self.fresh_token_queue = list(combined.values())
        self._fresh_feed_status["detected"] = len(self.fresh_token_queue)
        results: list[dict[str, Any]] = []
        for seed in self.fresh_token_queue[: max(10, limit * 2)]:
            mint = str(seed.get("mint_address") or "").strip()
            if not mint:
                continue
            intelligence = await self.token_enricher.enrich_token(mint, seed=seed)
            intelligence = self.token_validator.validate(intelligence)
            intelligence = self.scoring_engine.score(intelligence)
            results.append(intelligence)

        self._recent_intelligence = sorted(results, key=lambda row: int(row.get("score") or 0), reverse=True)[:120]
        self._fresh_feed_status["enriched"] = len(self._recent_intelligence)
        approved = [row for row in self._recent_intelligence if str(row.get("decision") or "") == "APPROVED"]
        self._fresh_feed_status["approved"] = len(approved)
        self._fresh_feed_status["rejected"] = max(0, len(self._recent_intelligence) - len(approved))
        return approved[: max(1, min(limit, 30))]

    def drain_recent_intelligence(self) -> list[dict[str, Any]]:
        rows = list(self._recent_intelligence)
        self._recent_intelligence = []
        return rows

    def get_fresh_feed_status(self) -> dict[str, Any]:
        return dict(self._fresh_feed_status)

    async def aggregate_tokens(self, limit: int = 24) -> list[dict[str, Any]]:
        seeds: dict[str, dict[str, Any]] = {}

        approved_fresh = await self.monitor_fresh_tokens(limit=max(8, limit))
        for intel in approved_fresh:
            address = str(intel.get("mint") or "").strip()
            if not address:
                continue
            seeds[address] = {
                "address": address,
                "symbol": intel.get("symbol"),
                "name": intel.get("name"),
                "_source_helius": True,
                "_doctor_strategy_mode": "pump_sniper",
                "_fresh_approved": True,
                "_fresh_score": int(intel.get("score") or 0),
            }

        walletbot_tokens = await self.get_trending_walletbot()
        for row in walletbot_tokens:
            address = self._extract_address(row)
            if not address:
                continue
            seed = seeds.get(address, {})
            seed.update({
                "address": address,
                "symbol": row.get("symbol"),
                "name": row.get("name"),
                "_source_walletbot": True,
                "_doctor_strategy_mode": "trending",
            })
            seeds[address] = seed

        dex_pairs = await self.get_dexscreener_tokens()
        for pair in dex_pairs:
            address = self._extract_address(pair)
            if not address:
                continue
            mode = "trending"
            pair_url = str(pair.get("url") or "").lower()
            labels = " ".join([str(item).lower() for item in (pair.get("labels") or [])])
            if "pump" in pair_url or "pump" in labels:
                mode = "pump_sniper"
            elif self._safe_float(pair.get("pairCreatedAt"), 0.0) > 0:
                age_minutes = self._compute_age_minutes(pair, {})
                if 0 <= age_minutes <= 120:
                    mode = "new_launch"

            seed = seeds.get(address, {})
            seed.update({
                "address": address,
                "_doctor_strategy_mode": mode,
                "symbol": ((pair.get("baseToken") or {}).get("symbol") if isinstance(pair.get("baseToken"), dict) else None),
                "name": ((pair.get("baseToken") or {}).get("name") if isinstance(pair.get("baseToken"), dict) else None),
            })
            seeds[address] = seed

        helius_mints = await self.get_helius_mints()
        for row in helius_mints[:200]:
            address = self._extract_address(row)
            if not address:
                continue
            if address not in seeds:
                seeds[address] = {
                    "address": address,
                    "symbol": row.get("symbol"),
                    "name": row.get("name"),
                    "_source_helius": True,
                    "_doctor_strategy_mode": "new_launch",
                }

        candidates: list[dict[str, Any]] = []
        for address, seed in list(seeds.items())[: max(30, min(limit * 3, 120))]:
            candidate = await self._candidate_from_address(address, seed=seed)
            if candidate:
                candidates.append(candidate)

        candidates.sort(
            key=lambda row: (
                float(row.get("score") or 0.0),
                float(row.get("volume_5m") or 0.0),
                float(row.get("liquidity") or 0.0),
            ),
            reverse=True,
        )
        filtered = [row for row in candidates if float(row.get("liquidity") or 0.0) > 0.0]
        return filtered[: max(1, min(limit, 30))]

    async def scan_all_sources(self, limit: int = 16) -> list[dict[str, Any]]:
        return await self.aggregate_tokens(limit=limit)

    async def scan(self, limit: int = 12) -> list[dict[str, Any]]:
        return await self.aggregate_tokens(limit=limit)
