from __future__ import annotations

from collections import defaultdict, deque
from statistics import mean, pstdev

from .metrics import max_drawdown, profit_factor, sharpe_ratio


class PerformanceTracker:
    def __init__(self) -> None:
        self.agent_pnls: dict[str, list[float]] = defaultdict(list)
        self.agent_holds: dict[str, list[float]] = defaultdict(list)
        self.equity_curve: list[float] = [100000.0]
        self.trade_returns: deque[float] = deque(maxlen=200)
        self.meta_learning_scores: dict[str, float] = defaultdict(lambda: 0.5)

    def register_trade(self, agent: str, pnl: float, hold_seconds: float, notional: float) -> None:
        self.agent_pnls[agent].append(float(pnl))
        self.agent_holds[agent].append(float(hold_seconds))
        current_equity = self.equity_curve[-1] + float(pnl)
        self.equity_curve.append(max(0.0, current_equity))
        ret = float(pnl) / max(notional, 1e-6)
        self.trade_returns.append(ret)
        self._update_meta_score(agent)

    def per_agent_stats(self, agent: str) -> dict[str, float]:
        pnls = self.agent_pnls.get(agent, [])
        holds = self.agent_holds.get(agent, [])
        if not pnls:
            return {
                "win_rate": 0.0,
                "sharpe": 0.0,
                "max_drawdown": 0.0,
                "avg_hold_seconds": 0.0,
                "profit_factor": 0.0,
            }

        wins = sum(1 for p in pnls if p > 0)
        returns = [p / max(1.0, abs(p)) for p in pnls]
        local_equity = [100.0]
        for p in pnls:
            local_equity.append(local_equity[-1] + p)
        return {
            "win_rate": wins / len(pnls),
            "sharpe": sharpe_ratio(returns),
            "max_drawdown": max_drawdown(local_equity),
            "avg_hold_seconds": mean(holds) if holds else 0.0,
            "profit_factor": profit_factor(pnls),
        }

    def correlation_proxy(self, a: str, b: str) -> float:
        x = self.agent_pnls.get(a, [])
        y = self.agent_pnls.get(b, [])
        n = min(len(x), len(y))
        if n < 4:
            return 0.0
        xs = x[-n:]
        ys = y[-n:]
        mx = mean(xs)
        my = mean(ys)
        sx = pstdev(xs)
        sy = pstdev(ys)
        if sx <= 1e-9 or sy <= 1e-9:
            return 0.0
        cov = sum((vx - mx) * (vy - my) for vx, vy in zip(xs, ys)) / n
        return cov / (sx * sy)

    def _update_meta_score(self, agent: str) -> None:
        pnls = self.agent_pnls.get(agent, [])[-20:]
        if not pnls:
            self.meta_learning_scores[agent] = 0.5
            return
        win_rate = sum(1 for p in pnls if p > 0) / len(pnls)
        consistency = 1.0 - (pstdev(pnls) / max(abs(mean(pnls)) + 1e-6, 1.0))
        consistency = max(0.0, min(1.0, consistency))
        pnl_consistency = consistency
        vol_adj_returns = mean(pnls) / max(pstdev(pnls), 1.0)
        vol_score = max(0.0, min(1.0, (vol_adj_returns + 2.0) / 4.0))
        meta = (0.35 * win_rate) + (0.25 * pnl_consistency) + (0.25 * consistency) + (0.15 * vol_score)
        self.meta_learning_scores[agent] = max(0.0, min(1.0, meta))
