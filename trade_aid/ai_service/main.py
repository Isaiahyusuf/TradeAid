from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional
import random
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai_service")

app = FastAPI(
    title="Trade Aid AI Scoring Service",
    version="1.0.0",
    description="AI-powered token risk scoring engine",
)


class TokenScoreRequest(BaseModel):
    contract_address: str
    chain: str
    market_cap_usd: float = 0
    liquidity_usd: float = 0
    holder_count: int = 0
    is_mintable: bool = False
    is_ownership_renounced: bool = False
    dev_risk_index: Optional[float] = None
    top_holder_pct: Optional[float] = None
    smart_wallet_count: Optional[int] = None


class TokenScoreResponse(BaseModel):
    rug_probability: float
    liquidity_stability: float
    holder_distribution: float
    smart_wallet_signal: float
    trade_confidence_index: float
    raw_data: dict


def compute_rug_probability(req: TokenScoreRequest) -> float:
    score = 30.0

    if req.is_mintable:
        score += 25
    if not req.is_ownership_renounced:
        score += 15

    if req.liquidity_usd < 5000:
        score += 15
    elif req.liquidity_usd < 20000:
        score += 8
    elif req.liquidity_usd > 100000:
        score -= 10

    if req.holder_count < 50:
        score += 12
    elif req.holder_count < 200:
        score += 5
    elif req.holder_count > 1000:
        score -= 8

    if req.dev_risk_index is not None:
        score += (req.dev_risk_index - 50) * 0.3

    if req.top_holder_pct is not None and req.top_holder_pct > 50:
        score += 15

    return max(0, min(100, score))


def compute_liquidity_stability(req: TokenScoreRequest) -> float:
    score = 50.0

    if req.liquidity_usd > 500000:
        score = 85
    elif req.liquidity_usd > 100000:
        score = 72
    elif req.liquidity_usd > 50000:
        score = 60
    elif req.liquidity_usd > 10000:
        score = 45
    elif req.liquidity_usd > 1000:
        score = 30
    else:
        score = 15

    return max(0, min(100, score))


def compute_holder_distribution(req: TokenScoreRequest) -> float:
    score = 40.0

    if req.holder_count > 5000:
        score = 85
    elif req.holder_count > 1000:
        score = 70
    elif req.holder_count > 500:
        score = 58
    elif req.holder_count > 100:
        score = 45
    elif req.holder_count > 20:
        score = 30
    else:
        score = 15

    if req.top_holder_pct is not None:
        if req.top_holder_pct < 10:
            score += 10
        elif req.top_holder_pct > 50:
            score -= 20
        elif req.top_holder_pct > 30:
            score -= 10

    return max(0, min(100, score))


def compute_smart_wallet_signal(req: TokenScoreRequest) -> float:
    if req.smart_wallet_count is None:
        return 50.0

    if req.smart_wallet_count > 10:
        return 85.0
    elif req.smart_wallet_count > 5:
        return 70.0
    elif req.smart_wallet_count > 2:
        return 58.0
    elif req.smart_wallet_count > 0:
        return 45.0
    return 30.0


@app.post("/score-token", response_model=TokenScoreResponse)
async def score_token(req: TokenScoreRequest):
    rug_prob = compute_rug_probability(req)
    liq_stab = compute_liquidity_stability(req)
    holder_dist = compute_holder_distribution(req)
    smart_signal = compute_smart_wallet_signal(req)

    safety_factor = (100 - rug_prob) / 100
    confidence = (
        liq_stab * 0.30
        + holder_dist * 0.25
        + smart_signal * 0.20
        + (100 - rug_prob) * 0.25
    ) * safety_factor
    confidence = max(0, min(100, confidence))

    logger.info(
        f"Scored {req.contract_address} on {req.chain}: "
        f"rug={rug_prob:.1f}, confidence={confidence:.1f}"
    )

    return TokenScoreResponse(
        rug_probability=round(rug_prob, 2),
        liquidity_stability=round(liq_stab, 2),
        holder_distribution=round(holder_dist, 2),
        smart_wallet_signal=round(smart_signal, 2),
        trade_confidence_index=round(confidence, 2),
        raw_data={
            "method": "ai_heuristic_v1",
            "model_version": "1.0.0",
            "input_features": {
                "market_cap_usd": req.market_cap_usd,
                "liquidity_usd": req.liquidity_usd,
                "holder_count": req.holder_count,
                "is_mintable": req.is_mintable,
                "is_ownership_renounced": req.is_ownership_renounced,
            },
        },
    )


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "ai_scoring"}
