from __future__ import annotations

import os
from datetime import datetime, timezone
from collections import deque
from typing import Deque

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field


class ValidateTradeRequest(BaseModel):
    pair: str
    entry: float = Field(..., gt=0)
    stop_loss: float = Field(..., gt=0)
    take_profit: float = Field(..., gt=0)
    volatility: float = Field(default=0.0, ge=0)
    market_sentiment: float = Field(default=0.5, ge=0, le=1)
    daily_pnl: float = 0.0
    drawdown_pct: float = Field(default=0.0, ge=0)
    consecutive_losses: int = Field(default=0, ge=0)
    trades_count: int = Field(default=0, ge=0)
    win_rate: float = Field(default=0.0, ge=0, le=1)


class ValidateTradeResponse(BaseModel):
    approved: bool
    adjusted_sl: float
    adjusted_tp: float
    confidence: int
    risk_recommendation: str
    should_pause: bool = False
    pause_reason: str | None = None
    tuning_suggestion: str | None = None


class PerformanceCheckRequest(BaseModel):
    trades_count: int = Field(default=0, ge=0)
    win_rate: float = Field(default=0.0, ge=0, le=1)
    previous_win_rate: float = Field(default=0.0, ge=0, le=1)
    drawdown_pct: float = Field(default=0.0, ge=0)
    consecutive_losses: int = Field(default=0, ge=0)
    volatility: float = Field(default=0.0, ge=0)


class PerformanceCheckResponse(BaseModel):
    evaluated: bool
    degraded: bool
    should_pause: bool
    reason: str | None = None
    tuning_suggestion: str | None = None


REQUIRED_API_KEY = os.getenv("OPENCLOW_API_KEY", "").strip()
VOLATILITY_PAUSE_THRESHOLD = float(os.getenv("OPENCLOW_VOLATILITY_PAUSE_THRESHOLD", "0.09") or 0.09)

app = FastAPI(title="OpenClaw Advisor", version="1.0.0")

_REQUEST_TIMES: Deque[float] = deque(maxlen=400)


def _utc_ts() -> float:
    return datetime.now(tz=timezone.utc).timestamp()


def _assert_api_key(x_api_key: str | None) -> None:
    if not REQUIRED_API_KEY:
        return
    if (x_api_key or "").strip() != REQUIRED_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid OpenClaw API key")


def _local_rate_limit(limit_per_minute: int = 240) -> None:
    now_ts = _utc_ts()
    while _REQUEST_TIMES and (now_ts - _REQUEST_TIMES[0]) > 60.0:
        _REQUEST_TIMES.popleft()
    if len(_REQUEST_TIMES) >= limit_per_minute:
        raise HTTPException(status_code=429, detail="OpenClaw rate limit reached")
    _REQUEST_TIMES.append(now_ts)


def _risk_level(volatility: float, sentiment: float, rr: float) -> str:
    if volatility >= VOLATILITY_PAUSE_THRESHOLD or sentiment < 0.35 or rr < 1.2:
        return "high"
    if volatility >= 0.045 or sentiment < 0.5 or rr < 1.6:
        return "moderate"
    return "low"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/ai/validate-trade", response_model=ValidateTradeResponse)
def validate_trade(
    payload: ValidateTradeRequest,
    x_openclaw_api_key: str | None = Header(default=None),
) -> ValidateTradeResponse:
    _assert_api_key(x_openclaw_api_key)
    _local_rate_limit()

    rr = (payload.take_profit - payload.entry) / max(payload.entry - payload.stop_loss, 1e-6)
    risk_level = _risk_level(payload.volatility, payload.market_sentiment, rr)

    should_pause = False
    pause_reason: str | None = None
    if payload.drawdown_pct > 5.0:
        should_pause = True
        pause_reason = "drawdown_above_5pct"
    elif payload.consecutive_losses >= 3:
        should_pause = True
        pause_reason = "three_consecutive_losses"
    elif payload.volatility >= VOLATILITY_PAUSE_THRESHOLD:
        should_pause = True
        pause_reason = "volatility_spike"

    sl_buffer = max(payload.volatility * payload.entry * 0.6, payload.entry * 0.003)
    tp_buffer = max(payload.volatility * payload.entry * 0.85, payload.entry * 0.005)

    adjusted_sl = max(0.0, min(payload.entry * 0.998, payload.stop_loss + sl_buffer))
    adjusted_tp = max(payload.entry * 1.002, payload.take_profit + tp_buffer)

    confidence_raw = 78
    confidence_raw -= int(min(payload.volatility * 800, 28))
    confidence_raw += int((payload.market_sentiment - 0.5) * 30)
    confidence_raw += 5 if rr >= 1.8 else -8 if rr < 1.2 else 0
    confidence_raw -= 10 if payload.consecutive_losses >= 2 else 0
    confidence = max(1, min(99, confidence_raw))

    approved = (not should_pause) and risk_level != "high" and confidence >= 45

    tuning_suggestion = None
    if payload.trades_count > 0 and payload.trades_count % 50 == 0:
        tuning_suggestion = "Recalibrate stop-loss and reduce notional by 10% for next cycle."

    return ValidateTradeResponse(
        approved=approved,
        adjusted_sl=round(adjusted_sl, 6),
        adjusted_tp=round(adjusted_tp, 6),
        confidence=confidence,
        risk_recommendation=risk_level,
        should_pause=should_pause,
        pause_reason=pause_reason,
        tuning_suggestion=tuning_suggestion,
    )


@app.post("/ai/performance-check", response_model=PerformanceCheckResponse)
def performance_check(
    payload: PerformanceCheckRequest,
    x_openclaw_api_key: str | None = Header(default=None),
) -> PerformanceCheckResponse:
    _assert_api_key(x_openclaw_api_key)
    _local_rate_limit()

    evaluated = payload.trades_count > 0 and payload.trades_count % 50 == 0
    degraded = payload.previous_win_rate > 0 and (payload.previous_win_rate - payload.win_rate) >= 0.10

    should_pause = False
    reason = None
    if payload.drawdown_pct > 5.0:
        should_pause = True
        reason = "drawdown_above_5pct"
    elif payload.consecutive_losses >= 3:
        should_pause = True
        reason = "three_consecutive_losses"
    elif payload.volatility >= VOLATILITY_PAUSE_THRESHOLD:
        should_pause = True
        reason = "volatility_spike"

    tuning_suggestion = None
    if evaluated and degraded:
        tuning_suggestion = "Strategy degradation detected: tighten entries and lower max position size by 10-15%."

    return PerformanceCheckResponse(
        evaluated=evaluated,
        degraded=degraded,
        should_pause=should_pause,
        reason=reason,
        tuning_suggestion=tuning_suggestion,
    )
