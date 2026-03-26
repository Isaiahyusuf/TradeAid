from __future__ import annotations

from datetime import datetime, timedelta
from statistics import mean

from ..types import MarketRegime, OrchestratorDecision


class StrategyOrchestrator:
    def __init__(self, cooldown_seconds: int = 30, hysteresis_margin: float = 0.06) -> None:
        self.cooldown_seconds = max(1, int(cooldown_seconds))
        self.hysteresis_margin = max(0.01, min(0.5, float(hysteresis_margin)))

    def detect_regime(self, features: dict[str, float], context: dict[str, list[float]]) -> MarketRegime:
        atr_pct = float(features.get("atr_pct") or 0.0)
        band_width = float(features.get("band_width") or 0.0)
        spread_bps = float(features.get("spread_bps") or 0.0)
        liquidity = float(features.get("liquidity") or 0.0)
        slope = abs(float(features.get("slope_slow") or 0.0))
        volumes = context.get("volumes", [])
        volume_profile = 0.0
        if len(volumes) >= 20:
            avg = mean(volumes[-20:])
            volume_profile = volumes[-1] / max(avg, 1e-9)

        regime_scores = {
            MarketRegime.TRENDING: (slope * 260.0) + (volume_profile * 0.2) - (band_width * 0.35),
            MarketRegime.RANGING: (band_width * -0.45) + ((1.0 - min(1.0, slope * 320.0)) * 0.55),
            MarketRegime.VOLATILE: (atr_pct * 12.0) + (band_width * 0.85),
            MarketRegime.LOW_LIQUIDITY: (spread_bps / 120.0) + (1.0 / max(1.0, liquidity / 120000.0)),
        }
        return max(regime_scores, key=regime_scores.get)

    def select(
        self,
        *,
        regime: MarketRegime,
        now: datetime,
        current_agent: str,
        cooldown_until: datetime | None,
        edge_score: dict[str, float],
        recent_performance: dict[str, float],
        risk_efficiency: dict[str, float],
    ) -> OrchestratorDecision:
        regime_fit_map = {
            MarketRegime.TRENDING: {"momentum_agent": 1.0, "reversion_agent": 0.45, "flow_agent": 0.8},
            MarketRegime.RANGING: {"momentum_agent": 0.45, "reversion_agent": 1.0, "flow_agent": 0.7},
            MarketRegime.VOLATILE: {"momentum_agent": 0.72, "reversion_agent": 0.5, "flow_agent": 1.0},
            MarketRegime.LOW_LIQUIDITY: {"momentum_agent": 0.35, "reversion_agent": 0.4, "flow_agent": 0.45},
        }
        agent_names = sorted(set(edge_score) | set(recent_performance) | set(risk_efficiency))
        factors: dict[str, dict[str, float]] = {}
        scores: dict[str, float] = {}
        for agent in agent_names:
            ef = max(0.0, min(1.0, float(edge_score.get(agent, 0.0))))
            mf = float(regime_fit_map.get(regime, {}).get(agent, 0.0))
            rp = max(0.0, min(1.0, float(recent_performance.get(agent, 0.0))))
            re = max(0.0, min(1.0, float(risk_efficiency.get(agent, 0.0))))
            score = (ef * 0.4) + (mf * 0.3) + (rp * 0.2) + (re * 0.1)
            factors[agent] = {
                "edge_score": ef,
                "market_fit": mf,
                "recent_performance": rp,
                "risk_efficiency": re,
            }
            scores[agent] = score

        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        if not ranked:
            return OrchestratorDecision(best_agent="", confidence=0.0, regime=regime, scores={}, factors={})

        best_agent, best_score = ranked[0]
        second_score = ranked[1][1] if len(ranked) > 1 else 0.0
        confidence = max(0.0, min(1.0, best_score - (0.35 * second_score)))

        if cooldown_until and now < cooldown_until and current_agent:
            return OrchestratorDecision(best_agent=current_agent, confidence=confidence * 0.9, regime=regime, scores=scores, factors=factors)

        if current_agent and current_agent in scores and best_agent != current_agent:
            current_score = scores[current_agent]
            if best_score < (current_score + self.hysteresis_margin):
                best_agent = current_agent
                best_score = current_score
                confidence = max(0.0, min(1.0, best_score - (0.35 * second_score)))

        return OrchestratorDecision(best_agent=best_agent, confidence=confidence, regime=regime, scores=scores, factors=factors)

    def next_cooldown_until(self, now: datetime) -> datetime:
        return now + timedelta(seconds=self.cooldown_seconds)
