import json
from datetime import datetime
from typing import Any

import httpx

from app.config import get_settings

settings = get_settings()


def _fallback_safety(payload: dict[str, Any]) -> dict[str, Any]:
    market_cap = float(payload.get("marketCap", 0) or 0)
    liquidity = float(payload.get("liquidity", 0) or 0)
    volume_5m = float(payload.get("volume5m", 0) or 0)
    volume_1h = float(payload.get("volume1h", 0) or 0)
    buy_sell_ratio = float(payload.get("buySellRatio", 0) or 0)
    holder_distribution = float(payload.get("holderDistribution", 0) or 0)
    dev_wallet_percent = float(payload.get("devWalletPercent", 0) or 0)
    dev_history_score = float(payload.get("devHistoryScore", 0) or 0)
    whale_activity = float(payload.get("whaleActivity", 0) or 0)
    wallet_growth_rate = float(payload.get("walletGrowthRate", 0) or 0)

    score = 0.0
    score += 14 if 15000 <= market_cap <= 500000 else 4
    score += 16 if market_cap > 0 and (liquidity / market_cap) >= 0.2 else 3
    score += 10 if volume_5m >= 2000 else 4
    score += 8 if volume_1h >= 12000 else 4
    score += 10 if buy_sell_ratio >= 1.15 else 3
    score += 10 if holder_distribution >= 60 else 4
    score += 8 if dev_wallet_percent <= 7 else 2
    score += 8 if dev_history_score >= 60 else 3
    score += 8 if whale_activity >= 40 else 3
    score += 8 if wallet_growth_rate >= 3 else 3

    safety_score = max(0, min(100, round(score, 2)))
    risk_level = "Low" if safety_score >= 82 else "Medium" if safety_score >= 70 else "High"
    recommendation = "Safe Early Entry" if safety_score >= 80 else "Monitor" if safety_score >= 70 else "Avoid"

    summary = (
        f"Token structure appears {'healthy' if safety_score >= 80 else 'mixed'} with liquidity and market cap alignment in early-stage range. "
        f"Flow quality shows {'net buy pressure' if buy_sell_ratio >= 1.0 else 'selling pressure'} with wallet growth at {wallet_growth_rate:.1f}. "
        f"Developer and holder signals indicate {risk_level.lower()} risk for near-term entries."
    )

    confidence = max(45.0, min(96.0, safety_score - (8 if risk_level == "Medium" else 0)))

    return {
        "safety_score": safety_score,
        "risk_level": risk_level,
        "short_summary": summary,
        "recommendation": recommendation,
        "confidence_score": round(confidence, 2),
        "source": "fallback",
        "generated_at": datetime.utcnow().isoformat(),
    }


async def score_safe_buy_with_ai(payload: dict[str, Any]) -> dict[str, Any]:
    api_key = settings.AI_INTEGRATIONS_OPENAI_API_KEY or settings.OPENAI_API_KEY
    if not api_key:
        return _fallback_safety(payload)

    prompt = {
        "task": "Evaluate if this newly launched Solana token qualifies for a safe early-entry watchlist.",
        "input": payload,
        "output_schema": {
            "safety_score": "number 0-100",
            "risk_level": "Low|Medium|High",
            "short_summary": "Exactly 3 concise sentences",
            "recommendation": "Safe Early Entry|Monitor|Avoid",
            "confidence_score": "number 0-100",
        },
        "rules": [
            "Return strict JSON only.",
            "Use conservative risk judgment.",
            "If evidence quality is weak, reduce confidence.",
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                f"{settings.OPENAI_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.OPENAI_MODEL,
                    "temperature": 0.15,
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a Solana token risk analyst. Return JSON only.",
                        },
                        {"role": "user", "content": json.dumps(prompt)},
                    ],
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            parsed = json.loads(content)

            parsed["safety_score"] = float(parsed.get("safety_score", 0) or 0)
            parsed["confidence_score"] = float(parsed.get("confidence_score", 0) or 0)
            parsed["risk_level"] = str(parsed.get("risk_level", "High") or "High").title()
            parsed["recommendation"] = str(parsed.get("recommendation", "Avoid") or "Avoid")
            parsed["short_summary"] = str(parsed.get("short_summary", ""))
            parsed["source"] = "openai"
            parsed["generated_at"] = datetime.utcnow().isoformat()
            return parsed
    except Exception:
        return _fallback_safety(payload)
