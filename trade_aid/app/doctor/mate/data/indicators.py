from __future__ import annotations

from statistics import mean, pstdev


def _safe_mean(values: list[float]) -> float:
    if not values:
        return 0.0
    return mean(values)


def compute_atr(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1 or len(highs) < period + 1 or len(lows) < period + 1:
        return 0.0
    tr_values: list[float] = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        tr_values.append(max(0.0, tr))
    if not tr_values:
        return 0.0
    return _safe_mean(tr_values[-period:])


def compute_rsi(prices: list[float], period: int = 14) -> float:
    if len(prices) < period + 1:
        return 50.0
    gains: list[float] = []
    losses: list[float] = []
    for i in range(-period, 0):
        delta = prices[i] - prices[i - 1]
        gains.append(max(0.0, delta))
        losses.append(max(0.0, -delta))
    avg_gain = _safe_mean(gains)
    avg_loss = _safe_mean(losses)
    if avg_loss <= 1e-9:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def compute_vwap(prices: list[float], volumes: list[float]) -> float:
    if not prices or not volumes:
        return 0.0
    weighted_sum = 0.0
    volume_sum = 0.0
    for p, v in zip(prices, volumes):
        weighted_sum += p * max(0.0, v)
        volume_sum += max(0.0, v)
    if volume_sum <= 1e-9:
        return 0.0
    return weighted_sum / volume_sum


def volatility_band_width(prices: list[float], period: int = 20) -> float:
    if len(prices) < max(5, period):
        return 0.0
    segment = prices[-period:]
    mu = _safe_mean(segment)
    sigma = pstdev(segment)
    if mu <= 1e-9:
        return 0.0
    upper = mu + (2.0 * sigma)
    lower = mu - (2.0 * sigma)
    return max(0.0, (upper - lower) / mu)


def rolling_slope(prices: list[float], window: int = 15) -> float:
    if len(prices) < max(3, window):
        return 0.0
    segment = prices[-window:]
    n = float(len(segment))
    x_mean = (n - 1.0) / 2.0
    y_mean = _safe_mean(segment)
    num = 0.0
    den = 0.0
    for i, y in enumerate(segment):
        dx = float(i) - x_mean
        num += dx * (y - y_mean)
        den += dx * dx
    if den <= 1e-9:
        return 0.0
    return num / den
