from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from app.doctor.doctor_controller import doctor_controller
from app.utils.logging_config import logger


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value or default)
    except Exception:
        return default


class SniperController:
    def __init__(self) -> None:
        self.min_ai_score = max(0.0, float(os.getenv("FRESH_SNIPER_MIN_AI_SCORE", "80")))
        self.min_liquidity = max(0.0, float(os.getenv("FRESH_SNIPER_MIN_LIQUIDITY_USD", "5000")))
        self.max_market_cap = max(0.0, float(os.getenv("FRESH_SNIPER_MAX_MARKET_CAP_USD", "200000")))
        max_age_minutes = max(0.0, float(os.getenv("FRESH_SNIPER_MAX_TOKEN_AGE_MINUTES", str(5.0 / 60.0))))
        self.max_token_age_seconds = max(
            0.0,
            float(os.getenv("FRESH_SNIPER_MAX_TOKEN_AGE_SECONDS", str(max_age_minutes * 60.0))),
        )
        self.max_dev_wallet_pct = max(0.0, float(os.getenv("FRESH_SNIPER_MAX_DEV_WALLET_PCT", "10")))

    @staticmethod
    def _token_age_minutes(timestamp: Any) -> float:
        try:
            raw = str(timestamp or "").replace("Z", "+00:00")
            if not raw:
                return 99999.0
            dt = datetime.fromisoformat(raw)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return max(0.0, (datetime.now(tz=timezone.utc) - dt).total_seconds() / 60.0)
        except Exception:
            return 99999.0

    async def maybe_trigger(self, token: dict[str, Any], ai_result: dict[str, Any]) -> dict[str, Any]:
        ai_score = _safe_float(ai_result.get("score"), 0.0)
        liquidity = _safe_float(token.get("liquidity"), 0.0)
        market_cap = _safe_float(token.get("market_cap"), 0.0)
        token_age_minutes = self._token_age_minutes(token.get("timestamp"))
        dev_wallet_pct = _safe_float(token.get("dev_wallet_pct"), 0.0)
        volume_5m = _safe_float(((token.get("dex") or {}).get("volume") or {}).get("m5"), 0.0)
        volume_1h = _safe_float(((token.get("dex") or {}).get("volume") or {}).get("h1"), 0.0)
        baseline_5m = max(volume_1h / 12.0, 1.0)
        volume_spike = volume_5m >= (baseline_5m * 1.8)

        if ai_score < self.min_ai_score:
            return {"triggered": False, "reason": "ai_score_below_threshold"}
        if liquidity < self.min_liquidity:
            return {"triggered": False, "reason": "liquidity_below_threshold"}
        if market_cap <= 0 or market_cap > self.max_market_cap:
            return {"triggered": False, "reason": "market_cap_out_of_range"}
        if not volume_spike:
            return {"triggered": False, "reason": "volume_spike_not_detected"}
        token_age_seconds = token_age_minutes * 60.0
        if token_age_seconds > self.max_token_age_seconds:
            return {"triggered": False, "reason": "token_too_old"}
        if dev_wallet_pct > self.max_dev_wallet_pct:
            return {"triggered": False, "reason": "dev_wallet_above_threshold"}

        mint = str(token.get("mint_address") or token.get("mint") or "").strip()
        if not mint:
            return {"triggered": False, "reason": "missing_mint"}

        try:
            result = await doctor_controller.execute_direct_buy(contract_address=mint, chain="solana")
            if result.get("executed"):
                logger.info(f"[FreshSniper] SNIPING {mint} ai={ai_score}")
                return {"triggered": True, "status": "SNIPING", "result": result}
            return {"triggered": False, "reason": str(result.get('reason') or 'execution_failed'), "result": result}
        except Exception as exc:
            logger.warning(f"[FreshSniper] Trigger failed for {mint}: {exc}")
            return {"triggered": False, "reason": "exception", "error": str(exc)}


sniper_controller = SniperController()
