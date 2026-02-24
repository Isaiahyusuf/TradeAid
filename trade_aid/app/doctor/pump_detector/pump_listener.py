from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.doctor.services.helius_service import HeliusService


class PumpListener:
    def __init__(self, helius_service: HeliusService) -> None:
        self.helius_service = helius_service

    @staticmethod
    def _age_minutes(value: Any) -> float:
        if value is None:
            return 99999.0
        if isinstance(value, (int, float)):
            dt = datetime.fromtimestamp(float(value), tz=timezone.utc)
            return max(0.0, (datetime.now(tz=timezone.utc) - dt).total_seconds() / 60.0)
        raw = str(value).strip()
        if not raw:
            return 99999.0
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return max(0.0, (datetime.now(tz=timezone.utc) - dt).total_seconds() / 60.0)
        except Exception:
            return 99999.0

    async def detect_fresh_tokens(self, max_age_minutes: float = 5.0, limit: int = 150) -> list[dict[str, Any]]:
        rows = await self.helius_service.detect_fresh_mints(limit=limit)
        out: list[dict[str, Any]] = []
        for row in rows:
            mint = str(row.get("mint") or row.get("address") or row.get("tokenAddress") or "").strip()
            if not mint:
                continue
            block_time = row.get("blockTime") or row.get("createdAt") or row.get("created_at")
            age = self._age_minutes(block_time)
            if age > max_age_minutes:
                continue
            out.append(
                {
                    "mint_address": mint,
                    "creator_wallet": str(row.get("authority") or row.get("creator") or "").strip(),
                    "block_time": block_time,
                    "age_minutes": round(age, 4),
                    "source": "helius_mint_listener",
                }
            )
        return out
