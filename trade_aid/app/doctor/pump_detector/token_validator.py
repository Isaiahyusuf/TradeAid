from __future__ import annotations

import re
from typing import Any


class TokenValidator:
    def __init__(self, *, min_liquidity_usd: float, min_volume_24h_usd: float) -> None:
        self.min_liquidity_usd = float(min_liquidity_usd)
        self.min_volume_24h_usd = float(min_volume_24h_usd)
        self.blacklisted_creators: set[str] = set()
        self._suspicious_name = re.compile(r"(test|scam|rug|honeypot)", re.IGNORECASE)

    def validate(self, token: dict[str, Any]) -> dict[str, Any]:
        flags: list[str] = []

        if not bool(token.get("mint_authority_revoked", True)):
            flags.append("mint_authority_not_revoked")
        supply = float(token.get("token_supply") or 0.0)
        if supply <= 0 or supply > 1_000_000_000_000_000:
            flags.append("abnormal_supply")

        creator = str(token.get("creator_wallet") or "").strip()
        if creator and creator in self.blacklisted_creators:
            flags.append("creator_blacklisted")
        if bool(token.get("creator_rug_history", False)):
            flags.append("creator_rug_history")
            if creator:
                self.blacklisted_creators.add(creator)

        symbol = str(token.get("symbol") or "")
        name = str(token.get("name") or "")
        if not symbol or not name:
            flags.append("missing_metadata")
        if self._suspicious_name.search(symbol) or self._suspicious_name.search(name):
            flags.append("suspicious_metadata")

        top3 = float(token.get("top3_percent") or 0.0)
        if top3 > 40.0:
            flags.append("top3_holders_above_40pct")
        dev_wallet = float(token.get("dev_wallet_percent") or 0.0)
        if dev_wallet > 20.0:
            flags.append("dev_wallet_above_20pct")

        liquidity = float(token.get("liquidity") or 0.0)
        if liquidity < self.min_liquidity_usd:
            flags.append("liquidity_too_low")

        volume = float(token.get("volume_24h") or 0.0)
        if volume < self.min_volume_24h_usd:
            flags.append("volume_too_low")

        slippage = float(token.get("slippage_percent") or 0.0)
        if slippage > 5.0:
            flags.append("price_impact_above_5pct")
        if not bool(token.get("jupiter_route_found", False)):
            flags.append("no_jupiter_route")

        age_minutes = float(token.get("age_minutes") or 0.0)
        if age_minutes < 60 and volume < (self.min_volume_24h_usd * 3.0):
            flags.append("too_new_without_volume")

        decision = "APPROVED" if not flags else "REJECTED"
        token["risk_flags"] = flags
        token["decision"] = decision
        return token
