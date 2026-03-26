from __future__ import annotations

import math
from statistics import mean, pstdev


def sharpe_ratio(returns: list[float], risk_free_rate: float = 0.0) -> float:
    if len(returns) < 2:
        return 0.0
    adj = [r - risk_free_rate for r in returns]
    sigma = pstdev(adj)
    if sigma <= 1e-12:
        return 0.0
    return (mean(adj) / sigma) * math.sqrt(len(adj))


def max_drawdown(equity_curve: list[float]) -> float:
    if not equity_curve:
        return 0.0
    peak = equity_curve[0]
    worst = 0.0
    for x in equity_curve:
        peak = max(peak, x)
        if peak <= 1e-9:
            continue
        dd = (peak - x) / peak
        worst = max(worst, dd)
    return worst


def profit_factor(pnls: list[float]) -> float:
    gains = sum(max(0.0, x) for x in pnls)
    losses = abs(sum(min(0.0, x) for x in pnls))
    if losses <= 1e-9:
        return gains if gains > 0 else 0.0
    return gains / losses
