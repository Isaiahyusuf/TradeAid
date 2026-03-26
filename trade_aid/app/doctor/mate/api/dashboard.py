from __future__ import annotations

from typing import Any


class DashboardAdapter:
    def build_state(
        self,
        *,
        active_agent: str,
        regime: str,
        equity_curve: list[float],
        leaderboard: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "active_agent": active_agent,
            "market_regime": regime,
            "equity_curve": equity_curve,
            "agent_leaderboard": leaderboard,
        }
