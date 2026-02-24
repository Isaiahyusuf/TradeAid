from __future__ import annotations

from typing import Any


class FreshTokenScoringEngine:
    def _score_liquidity(self, liquidity: float) -> int:
        return int(max(0.0, min(20.0, (liquidity / 200_000.0) * 20.0)))

    def _score_holders(self, top3_percent: float, holder_count: int) -> int:
        concentration = max(0.0, min(20.0, 20.0 * (1.0 - (top3_percent / 60.0))))
        count_bonus = min(5.0, holder_count / 200.0)
        return int(max(0.0, min(20.0, concentration + count_bonus)))

    def _score_volume(self, volume_24h: float) -> int:
        return int(max(0.0, min(20.0, (volume_24h / 300_000.0) * 20.0)))

    def _score_age(self, age_minutes: int) -> int:
        return int(max(0.0, min(10.0, (age_minutes / 180.0) * 10.0)))

    def _score_creator_risk(self, flags: list[str]) -> int:
        risk_flags = {"creator_rug_history", "creator_blacklisted", "suspicious_metadata", "mint_authority_not_revoked"}
        hits = len([flag for flag in flags if flag in risk_flags])
        return int(max(0.0, 15.0 - (hits * 5.0)))

    def _score_slippage(self, slippage_pct: float) -> int:
        if slippage_pct >= 5.0:
            return 0
        return int(max(0.0, min(15.0, 15.0 * (1.0 - (slippage_pct / 5.0)))))

    def score(self, token: dict[str, Any]) -> dict[str, Any]:
        flags = list(token.get("risk_flags") or [])
        categories = {
            "liquidity_score": self._score_liquidity(float(token.get("liquidity") or 0.0)),
            "holder_distribution_score": self._score_holders(float(token.get("top3_percent") or 0.0), int(token.get("holder_count") or 0)),
            "volume_score": self._score_volume(float(token.get("volume_24h") or 0.0)),
            "age_score": self._score_age(int(token.get("age_minutes") or 0)),
            "creator_risk_score": self._score_creator_risk(flags),
            "slippage_score": self._score_slippage(float(token.get("slippage_percent") or 0.0)),
        }
        total = int(sum(categories.values()))
        token["score"] = total
        token["score_breakdown"] = categories
        if total < 75:
            if "score_below_threshold" not in token["risk_flags"]:
                token["risk_flags"].append("score_below_threshold")
            token["decision"] = "REJECTED"
        else:
            token["decision"] = "APPROVED" if token.get("decision") != "REJECTED" else "REJECTED"
        return token
