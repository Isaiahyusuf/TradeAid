import json
from datetime import datetime
from typing import Any

import httpx

from app.config import get_settings

settings = get_settings()

DOCTOR_STRANGE_SYSTEM_PROMPT = (
    "You are DoctorStrange, TradeAid's elite multi-chain trading intelligence engine. "
    "You operate with strict risk discipline, probabilistic reasoning, and transparent uncertainty. "
    "Never guarantee outcomes. Prefer capital preservation when signals conflict. "
    "Output valid JSON only."
)


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def _resolve_confidence_bias(payload: dict[str, Any]) -> float:
    market = payload.get("market", {}) or {}
    chain = str(market.get("chain", "")).strip().lower()

    history = payload.get("history_context", {}) or {}
    calibration = history.get("confidence_calibration", {}) or {}
    by_chain = calibration.get("by_chain", {}) or {}
    chain_bucket = by_chain.get(chain, {}) if isinstance(by_chain, dict) else {}

    chain_bias = float(chain_bucket.get("confidence_bias", 0.0) or 0.0)
    global_bias = float(calibration.get("global_bias", 0.0) or 0.0)

    if chain:
        return _clamp((chain_bias * 0.75) + (global_bias * 0.25), -18.0, 18.0)
    return _clamp(global_bias, -18.0, 18.0)


def _fallback_assist(payload: dict[str, Any]) -> dict[str, Any]:
    market = payload.get("market", {}) or {}
    risk = payload.get("risk", {}) or {}

    confidence = float(market.get("trade_confidence_index", 0) or 0)
    rug_probability = float(market.get("rug_probability", 0) or 0)
    liquidity_usd = float(market.get("liquidity_usd", 0) or 0)
    price_change_1h = float(market.get("price_change_1h", 0) or 0)
    max_risk_per_trade_pct = float(risk.get("max_risk_per_trade_pct", 1.0) or 1.0)

    action = "WAIT"
    if rug_probability >= 70:
        action = "AVOID"
    elif confidence >= 70 and rug_probability <= 40 and liquidity_usd >= 15000:
        action = "BUY"

    momentum = "uptrend" if price_change_1h > 5 else "downtrend" if price_change_1h < -5 else "sideways"

    confidence_bias = _resolve_confidence_bias(payload)
    adjusted_confidence = _clamp(confidence - (rug_probability * 0.25) + confidence_bias, 0, 100)
    stop_loss_pct = _clamp(max_risk_per_trade_pct * 1.2, 0.5, 5.0)
    take_profit_pct = _clamp(stop_loss_pct * 1.8, 1.0, 12.0)

    reasons: list[str] = []
    if rug_probability > 55:
        reasons.append("Elevated rug-risk score from token safety profile.")
    if liquidity_usd < 10000:
        reasons.append("Liquidity is thin for safer execution.")
    if momentum == "uptrend":
        reasons.append("Short-term momentum is positive.")
    elif momentum == "downtrend":
        reasons.append("Short-term momentum is negative.")
    else:
        reasons.append("Momentum is neutral; no clear directional edge.")

    risk_notes: list[str] = [
        "This is decision-support guidance, not guaranteed financial outcome.",
        "Risk controls must approve before any execution.",
    ]
    if action == "BUY":
        risk_notes.append("Use small position sizing and confirm slippage/liquidity constraints.")
    if abs(confidence_bias) >= 2:
        direction = "upward" if confidence_bias > 0 else "downward"
        reasons.append(f"DoctorStrange applied {direction} confidence calibration ({confidence_bias:+.2f}) from recent outcomes.")

    summary = (
        f"Fallback assistant: confidence {confidence:.1f}/100, rug risk {rug_probability:.1f}/100, "
        f"liquidity ${liquidity_usd:,.0f}, momentum {momentum}. Suggested action is {action}."
    )

    return {
        "summary": summary,
        "action": action,
        "confidence": round(adjusted_confidence, 2),
        "reasons": reasons,
        "risk_notes": risk_notes,
        "take_profit_pct": round(take_profit_pct, 2),
        "stop_loss_pct": round(stop_loss_pct, 2),
        "requires_risk_approval": True,
        "assistant_name": "DoctorStrange",
        "source": "fallback",
        "generated_at": datetime.utcnow().isoformat(),
    }


def _fallback_answer(question: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    context = context or {}
    market = context.get("market", {}) or {}
    chain = str(market.get("chain", "unknown")).lower()
    symbol = str(market.get("symbol", "token"))

    response = (
        f"Fallback assistant response for {symbol} on {chain}: "
        "Use risk-first validation, verify liquidity depth, avoid oversized positions, "
        "and run in paper mode before enabling autonomous execution."
    )

    return {
        "question": question,
        "answer": response,
        "key_points": [
            "AI guidance does not replace risk controls.",
            "Confirm stop-loss and max daily loss limits before execution.",
            "Start in paper mode and validate against recent market regime.",
        ],
        "assistant_name": "DoctorStrange",
        "source": "fallback",
        "generated_at": datetime.utcnow().isoformat(),
    }


async def generate_trade_assist(payload: dict[str, Any]) -> dict[str, Any]:
    api_key = settings.AI_INTEGRATIONS_OPENAI_API_KEY or settings.OPENAI_API_KEY
    if not api_key:
        return _fallback_assist(payload)

    prompt = {
        "task": "Provide multi-factor, cross-chain, risk-aware trading decision support.",
        "assistant_name": "DoctorStrange",
        "input": payload,
        "output_schema": {
            "summary": "2-4 concise sentences",
            "action": "BUY|WAIT|AVOID|SELL",
            "confidence": "number 0-100",
            "reasons": ["short bullet reason", "short bullet reason"],
            "risk_notes": ["risk control reminder"],
            "horizon": "scalp|intraday|swing|unknown",
            "position_size_guidance": "micro|small|normal|skip",
            "market_regime": "trending|ranging|high-volatility|unknown",
            "take_profit_pct": "number",
            "stop_loss_pct": "number",
            "requires_risk_approval": True,
        },
        "analysis_framework": [
            "Weight token safety and rug probability heavily.",
            "Check liquidity depth before directional bias.",
            "Use confidence index as signal quality modifier, not sole trigger.",
            "Leverage history_context to avoid repeating poor chain-specific patterns.",
            "Apply confidence_calibration.by_chain[chain].confidence_bias when present.",
            "If calibration is strongly negative (< -6), cap aggressive BUY posture unless other signals are exceptional.",
            "If signals conflict, downgrade confidence and prefer WAIT/AVOID.",
        ],
        "rules": [
            "Return strict JSON only.",
            "Never guarantee profit.",
            "Use conservative risk posture for uncertain signals.",
            "Keep decision explainable and consistent with provided metrics.",
            "Include any calibration effect in reasons when materially affecting confidence.",
            "Keep it concise and actionable.",
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
                        {"role": "system", "content": DOCTOR_STRANGE_SYSTEM_PROMPT},
                        {"role": "user", "content": json.dumps(prompt)},
                    ],
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            parsed = json.loads(content)

            parsed["confidence"] = float(parsed.get("confidence", 0) or 0)
            parsed["take_profit_pct"] = float(parsed.get("take_profit_pct", 0) or 0)
            parsed["stop_loss_pct"] = float(parsed.get("stop_loss_pct", 0) or 0)
            parsed["horizon"] = str(parsed.get("horizon", "unknown"))
            parsed["position_size_guidance"] = str(parsed.get("position_size_guidance", "skip"))
            parsed["market_regime"] = str(parsed.get("market_regime", "unknown"))
            parsed["requires_risk_approval"] = True
            parsed["source"] = "openai"
            parsed["assistant_name"] = "DoctorStrange"
            parsed["generated_at"] = datetime.utcnow().isoformat()
            return parsed
    except Exception:
        return _fallback_assist(payload)


async def answer_user_question(question: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    api_key = settings.AI_INTEGRATIONS_OPENAI_API_KEY or settings.OPENAI_API_KEY
    if not api_key:
        return _fallback_answer(question, context)

    prompt = {
        "task": "Answer the user's trading intelligence question using provided context with practical, risk-aware guidance.",
        "assistant_name": "DoctorStrange",
        "question": question,
        "context": context or {},
        "output_schema": {
            "answer": "concise paragraph",
            "key_points": ["short point", "short point", "short point"],
            "confidence": "number 0-100",
            "risk_level": "low|medium|high|unknown",
        },
        "rules": [
            "Return strict JSON only.",
            "Do not provide guaranteed outcomes.",
            "Reference cross-chain trade history context when available.",
            "Emphasize risk-aware interpretation.",
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
                    "temperature": 0.25,
                    "messages": [
                        {"role": "system", "content": DOCTOR_STRANGE_SYSTEM_PROMPT},
                        {"role": "user", "content": json.dumps(prompt)},
                    ],
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            return {
                "question": question,
                "answer": str(parsed.get("answer", "")).strip(),
                "key_points": [str(item) for item in (parsed.get("key_points") or [])][:5],
                "confidence": float(parsed.get("confidence", 0) or 0),
                "risk_level": str(parsed.get("risk_level", "unknown")),
                "assistant_name": "DoctorStrange",
                "source": "openai",
                "generated_at": datetime.utcnow().isoformat(),
            }
    except Exception:
        return _fallback_answer(question, context)