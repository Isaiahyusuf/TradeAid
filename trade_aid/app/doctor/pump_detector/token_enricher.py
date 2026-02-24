from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.doctor.pump_detector.dex_new_pairs import DexNewPairsScanner
from app.doctor.services.coingecko_service import CoinGeckoService
from app.doctor.services.helius_service import HeliusService
from app.doctor.services.jupiter_service import JupiterService
from app.doctor.services.moralis_service import MoralisService
from app.doctor.services.solscan_service import SolscanService


class TokenEnricher:
    def __init__(
        self,
        *,
        coingecko: CoinGeckoService,
        helius: HeliusService,
        moralis: MoralisService,
        solscan: SolscanService,
        jupiter: JupiterService,
        dex_scanner: DexNewPairsScanner,
    ) -> None:
        self.coingecko = coingecko
        self.helius = helius
        self.moralis = moralis
        self.solscan = solscan
        self.jupiter = jupiter
        self.dex_scanner = dex_scanner
        self._sol_mint = "So11111111111111111111111111111111111111112"

    @staticmethod
    def _age_minutes(value: Any) -> float:
        if value is None:
            return 0.0
        if isinstance(value, (int, float)):
            dt = datetime.fromtimestamp(float(value), tz=timezone.utc)
            return max(0.0, (datetime.now(tz=timezone.utc) - dt).total_seconds() / 60.0)
        raw = str(value).strip()
        if not raw:
            return 0.0
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return max(0.0, (datetime.now(tz=timezone.utc) - dt).total_seconds() / 60.0)
        except Exception:
            return 0.0

    async def enrich_token(self, mint_address: str, seed: dict[str, Any] | None = None) -> dict[str, Any]:
        seed = seed or {}
        metadata = await self.moralis.get_token_metadata(mint_address)
        holder_risk = await self.solscan.validate_holder_risk(mint_address)
        market = await self.coingecko.get_token_market(mint_address)
        supply = await self.helius.get_token_supply(mint_address)
        holder_distribution = await self.helius.get_holder_distribution(mint_address)
        slippage_test = await self.jupiter.simulate_trade(
            input_mint=self._sol_mint,
            output_mint=mint_address,
            amount_lamports=10_000_000,
            slippage_bps=200,
        )

        liquidity = float(holder_risk.get("liquidity_usd") or seed.get("liquidity") or 0.0)
        if liquidity <= 0:
            pairs = await self.dex_scanner.fetch_new_pairs(max_age_minutes=120)
            pair = next((row for row in pairs if str(row.get("mint_address") or "") == mint_address), {})
            liquidity = float(pair.get("liquidity") or 0.0)

        age_minutes = self._age_minutes(seed.get("block_time") or metadata.get("created_at") or seed.get("pair_created_at"))
        top3_pct = max(
            float(holder_risk.get("top3_holder_pct") or 0.0),
            float(holder_distribution.get("top3_holder_pct") or 0.0),
        )

        return {
            "mint": mint_address,
            "symbol": str(metadata.get("symbol") or seed.get("symbol") or "UNKNOWN").upper(),
            "name": str(metadata.get("name") or seed.get("name") or ""),
            "creator_wallet": str(seed.get("creator_wallet") or "").strip(),
            "age_minutes": int(round(age_minutes)),
            "liquidity": liquidity,
            "holder_count": int(holder_risk.get("holder_count") or holder_distribution.get("accounts") or 0),
            "top3_percent": float(round(top3_pct, 4)),
            "dev_wallet_percent": float(holder_risk.get("dev_wallet_pct") or 0.0),
            "slippage_percent": float(round(float(slippage_test.get("price_impact_pct") or 0.0), 4)),
            "volume_24h": float(market.get("volume_24h") or 0.0),
            "market_cap": float(market.get("market_cap") or 0.0),
            "price_usd": float(market.get("price_usd") or 0.0),
            "token_supply": float(supply or 0.0),
            "mint_authority_revoked": bool(seed.get("mint_authority_revoked", True)),
            "creator_rug_history": bool(seed.get("creator_rug_history", False)),
            "jupiter_route_found": bool(slippage_test.get("route")),
            "risk_flags": [],
            "decision": "REJECTED",
            "sources": {
                "helius": True,
                "moralis": bool(metadata),
                "solscan": bool(holder_risk),
                "coingecko": bool(market),
                "jupiter": bool(slippage_test),
                "dex": True,
            },
        }
