import json
from datetime import datetime
from typing import Any
import httpx
from app.config import get_settings

settings = get_settings()


def _fallback_insight(payload: dict[str, Any]) -> dict[str, Any]:
    confidence = float(payload.get("trade_confidence_index", 0) or 0)
    rug = float(payload.get("rug_probability", 0) or 0)
    change_1h = float(payload.get("price_change_1h", 0) or 0)

    momentum = "Strong Uptrend" if change_1h > 10 else "Downtrend" if change_1h < -10 else "Sideways"
    recommendation = "Avoid" if rug > 70 else "High Risk Entry" if confidence > 65 else "Watch"
    risk_level = "High" if rug > 70 else "Medium" if rug > 40 else "Low"

    summary = (
        f"Token momentum is {momentum.lower()} with 1h price change of {change_1h:.2f}%. "
        f"Rug risk is {rug:.1f}/100 and confidence is {confidence:.1f}/100. "
        f"Liquidity and wallet activity indicate {('elevated' if rug > 60 else 'moderate' if rug > 35 else 'lower')} risk. "
        f"Recommended action: {recommendation}."
    )

    return {
        "summary": summary,
        "risk_level": risk_level,
        "momentum_analysis": momentum,
        "recommendation": recommendation,
        "confidence_score": round(confidence, 2),
        "source": "fallback",
        "generated_at": datetime.utcnow().isoformat(),
    }


async def generate_ai_insight(payload: dict[str, Any]) -> dict[str, Any]:
    api_key = settings.AI_INTEGRATIONS_OPENAI_API_KEY or settings.OPENAI_API_KEY
    if not api_key:
        return _fallback_insight(payload)

    prompt = {
        "task": "Analyze this Solana token and produce concise trading-risk intelligence.",
        "input": payload,
        "output_schema": {
            "summary": "3-5 sentence plain-English summary",
            "risk_level": "Low|Medium|High",
            "momentum_analysis": "brief momentum statement",
            "recommendation": "Avoid|Watch|High Risk Entry",
            "confidence_score": "0-100 numeric",
        },
        "rules": [
            "Be concise and actionable.",
            "Do not include markdown.",
            "Return JSON only.",
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
                    "temperature": 0.2,
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a Solana trading risk analyst. Output strict JSON only.",
                        },
                        {"role": "user", "content": json.dumps(prompt)},
                    ],
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            parsed["source"] = "openai"
            parsed["generated_at"] = datetime.utcnow().isoformat()
            if "confidence_score" in parsed:
                parsed["confidence_score"] = float(parsed["confidence_score"])
            return parsed
    except Exception:
        return _fallback_insight(payload)
