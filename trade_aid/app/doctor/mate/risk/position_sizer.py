from __future__ import annotations


class PositionSizer:
    def __init__(self, max_kelly_fraction: float = 0.2, max_risk_per_trade: float = 0.02) -> None:
        self.max_kelly_fraction = max(0.01, min(0.5, float(max_kelly_fraction)))
        self.max_risk_per_trade = max(0.002, min(0.05, float(max_risk_per_trade)))

    def kelly_fraction(self, win_rate: float, rr: float) -> float:
        wr = max(0.01, min(0.99, win_rate))
        payoff = max(0.05, rr)
        lose = 1.0 - wr
        frac = wr - (lose / payoff)
        return max(0.0, min(self.max_kelly_fraction, frac))

    def size(self, equity: float, atr_pct: float, confidence: float, win_rate: float, rr: float) -> float:
        kelly = self.kelly_fraction(win_rate, rr)
        vol_adjust = 1.0 / max(0.002, atr_pct)
        vol_adjust = max(0.15, min(1.6, vol_adjust * 0.01))
        conf_scale = max(0.15, min(1.0, confidence))
        risk_budget = equity * self.max_risk_per_trade * conf_scale
        position_notional = equity * kelly * vol_adjust
        return max(0.0, min(equity * 0.25, min(position_notional, risk_budget * 8.0)))
