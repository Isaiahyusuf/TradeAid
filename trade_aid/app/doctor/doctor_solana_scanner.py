from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx


class DoctorSolanaScanner:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=12.0)
        self._search_terms = ["solana", "pump.fun", "raydium", "meme", "bonk", "wif"]
        self._pump_terms = ["pump.fun", "pump", "launch", "moonshot", "degen"]
        self._new_terms = ["new pair", "just launched", "fresh", "solana meme"]
        self._trending_terms = ["trending", "hot", "solana", "raydium", "meme"]

    async def close(self) -> None:
        await self._client.aclose()

    async def _fetch_pairs(self) -> list[dict[str, Any]]:
        unique: dict[str, dict[str, Any]] = {}
        for term in self._search_terms:
            try:
                url = f"https://api.dexscreener.com/latest/dex/search?q={term}"
                response = await self._client.get(url)
                if response.status_code != 200:
                    continue
                rows = (response.json() or {}).get("pairs", []) or []
                for pair in rows:
                    if str(pair.get("chainId") or "").lower() != "solana":
                        continue
                    base = pair.get("baseToken") or {}
                    address = str(base.get("address") or "").strip()
                    if not address:
                        continue
                    if address not in unique:
                        unique[address] = pair
            except Exception:
                continue
        return list(unique.values())

    async def _fetch_pairs_by_terms(self, terms: list[str], strategy_mode: str) -> list[dict[str, Any]]:
        unique: dict[str, dict[str, Any]] = {}
        for term in terms:
            try:
                url = f"https://api.dexscreener.com/latest/dex/search?q={term}"
                response = await self._client.get(url)
                if response.status_code != 200:
                    continue
                rows = (response.json() or {}).get("pairs", []) or []
                for pair in rows:
                    if str(pair.get("chainId") or "").lower() != "solana":
                        continue
                    base = pair.get("baseToken") or {}
                    address = str(base.get("address") or "").strip()
                    if not address:
                        continue
                    if address not in unique:
                        next_pair = dict(pair)
                        next_pair["_doctor_strategy_mode"] = strategy_mode
                        unique[address] = next_pair
            except Exception:
                continue
        return list(unique.values())

    async def scan_all_sources(self, limit: int = 16) -> list[dict[str, Any]]:
        rows: dict[str, dict[str, Any]] = {}
        # Trending memes
        for pair in await self._fetch_pairs_by_terms(self._trending_terms, "trending"):
            address = str(((pair.get("baseToken") or {}).get("address") or "")).strip()
            if address and address not in rows:
                rows[address] = pair

        # New launches
        for pair in await self._fetch_pairs_by_terms(self._new_terms, "new_launch"):
            address = str(((pair.get("baseToken") or {}).get("address") or "")).strip()
            if address:
                existing = rows.get(address)
                if not existing:
                    rows[address] = pair
                elif existing.get("_doctor_strategy_mode") != "pump_sniper":
                    rows[address]["_doctor_strategy_mode"] = "new_launch"

        # Pump / FOMO launches
        for pair in await self._fetch_pairs_by_terms(self._pump_terms, "pump_sniper"):
            address = str(((pair.get("baseToken") or {}).get("address") or "")).strip()
            if address:
                rows[address] = pair

        pairs = list(rows.values())
        ranked = self._build_ranked_candidates(pairs)
        return ranked[: max(1, min(limit, 30))]

    @staticmethod
    def _safe_float(value: Any, default: float = 0.0) -> float:
        try:
            return float(value or default)
        except Exception:
            return default

    def _token_age_minutes(self, pair: dict[str, Any]) -> float:
        created_ms = self._safe_float(pair.get("pairCreatedAt"), 0.0)
        if created_ms <= 0:
            return 0.0
        created = datetime.utcfromtimestamp(created_ms / 1000.0)
        return max(0.0, (datetime.utcnow() - created).total_seconds() / 60.0)

    def _lp_verified(self, pair: dict[str, Any]) -> bool:
        labels = [str(item).lower() for item in (pair.get("labels") or [])]
        if any("verified" in item for item in labels):
            return True
        if pair.get("pairAddress") and self._safe_float((pair.get("liquidity") or {}).get("usd"), 0.0) > 0:
            return True
        return False

    def _estimate_top_holder_pct(self, pair: dict[str, Any]) -> float:
        info = pair.get("info") or {}
        explicit = info.get("topHolderPct")
        if explicit is not None:
            return self._safe_float(explicit, 100.0)
        return 10.0

    def _liquidity_unlocked_risk(self, pair: dict[str, Any]) -> bool:
        info = pair.get("info") or {}
        lp_lock = info.get("lpLocked")
        if lp_lock is None:
            return False
        return not bool(lp_lock)

    def _score(self, liquidity: float, volume_5m: float, market_cap: float, volume_spike_pct: float, buy_sell_ratio: float, age_minutes: float) -> float:
        liquidity_score = min(liquidity / 200000.0, 1.0) * 25.0
        volume_score = min(volume_5m / 100000.0, 1.0) * 25.0
        cap_score = (1.0 - min(abs(market_cap - 600000.0) / 1200000.0, 1.0)) * 10.0
        spike_score = min(max(volume_spike_pct, 0.0) / 120.0, 1.0) * 15.0
        ratio_score = min(max(buy_sell_ratio, 0.0), 2.0) / 2.0 * 15.0
        age_score = min(age_minutes / 90.0, 1.0) * 10.0
        return round(liquidity_score + volume_score + cap_score + spike_score + ratio_score + age_score, 2)

    def _fomo_trend_score(self, volume_5m: float, volume_15m: float, buy_sell_ratio: float, age_minutes: float, strategy_mode: str) -> float:
        spike = (volume_5m * 3.0) / max(volume_15m, 1.0)
        mode_bonus = 1.15 if strategy_mode == "pump_sniper" else 1.0 if strategy_mode == "new_launch" else 0.9
        raw = (spike * 24.0) + (min(max(buy_sell_ratio, 0.0), 2.0) * 18.0) + (max(0.0, 40.0 - min(age_minutes, 40.0)))
        return round(min(100.0, raw * mode_bonus), 2)

    def _build_ranked_candidates(self, pairs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        candidates: list[dict[str, Any]] = []

        for pair in pairs:
            volume = pair.get("volume") or {}
            txns = pair.get("txns") or {}
            liquidity = self._safe_float((pair.get("liquidity") or {}).get("usd"), 0.0)
            volume_5m = self._safe_float(volume.get("m5"), 0.0)
            volume_15m = self._safe_float(volume.get("m15"), 0.0)
            volume_1h = self._safe_float(volume.get("h1"), 0.0)
            market_cap = self._safe_float(pair.get("marketCap"), 0.0)
            buys_5m = self._safe_float(((txns.get("m5") or {}).get("buys")), 0.0)
            sells_5m = self._safe_float(((txns.get("m5") or {}).get("sells")), 0.0)
            age_minutes = self._token_age_minutes(pair)
            lp_verified = self._lp_verified(pair)
            top_holder_pct = self._estimate_top_holder_pct(pair)
            unlocked_risk = self._liquidity_unlocked_risk(pair)

            if liquidity < 20000.0:
                continue
            if age_minutes < 5.0:
                continue
            if not lp_verified:
                continue
            if top_holder_pct > 20.0:
                continue
            if unlocked_risk:
                continue

            buy_sell_ratio = (buys_5m + 1.0) / (sells_5m + 1.0)
            volume_spike_pct = ((volume_5m * 12.0) / max(volume_1h, 1.0) - 1.0) * 100.0
            strategy_mode = str(pair.get("_doctor_strategy_mode") or "trending")
            fomo_score = self._fomo_trend_score(volume_5m, volume_15m, buy_sell_ratio, age_minutes, strategy_mode)
            score = self._score(liquidity, volume_5m, market_cap, volume_spike_pct, buy_sell_ratio, age_minutes)
            score = round(min(100.0, score + (fomo_score * 0.16)), 2)

            base = pair.get("baseToken") or {}
            candidates.append(
                {
                    "symbol": str(base.get("symbol") or "UNKNOWN"),
                    "address": str(base.get("address") or ""),
                    "name": str(base.get("name") or ""),
                    "liquidity": liquidity,
                    "volume_5m": volume_5m,
                    "volume_15m": volume_15m,
                    "volume_1h": volume_1h,
                    "market_cap": market_cap,
                    "volume_spike_pct": round(volume_spike_pct, 4),
                    "buy_sell_ratio": round(buy_sell_ratio, 4),
                    "age_minutes": round(age_minutes, 4),
                    "fomo_trend_score": fomo_score,
                    "score": score,
                    "price_usd": self._safe_float(pair.get("priceUsd"), 0.0),
                    "pair_address": str(pair.get("pairAddress") or ""),
                    "dex_id": str(pair.get("dexId") or ""),
                    "lp_verified": lp_verified,
                    "top_holder_pct": top_holder_pct,
                    "liquidity_unlocked_risk": unlocked_risk,
                    "strategy_mode": strategy_mode,
                    "honeypot_risk": bool((pair.get("info") or {}).get("honeypotRisk", False)),
                    "suspicious_contract": bool((pair.get("info") or {}).get("suspicious", False)),
                }
            )

        candidates.sort(
            key=lambda row: (
                row["score"],
                row.get("fomo_trend_score", 0.0),
                row["volume_5m"],
                row["liquidity"],
            ),
            reverse=True,
        )
        return candidates

    async def scan(self, limit: int = 12) -> list[dict[str, Any]]:
        # Backward-compatible wrapper
        return await self.scan_all_sources(limit=limit)
