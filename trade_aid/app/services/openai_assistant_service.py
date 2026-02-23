import json
from datetime import datetime
from typing import Any

import httpx

from app.config import get_settings

settings = get_settings()

ASSISTANT_NAME = "DoctorTrade"

DOCTOR_TRADE_SYSTEM_PROMPT = (
    f"You are {ASSISTANT_NAME}, TradeAid's elite multi-chain trading intelligence engine. "
    "You operate with strict risk discipline, probabilistic reasoning, and transparent uncertainty. "
    "Never guarantee outcomes. Prefer capital preservation when signals conflict. "
    "Output valid JSON only."
)

COINGECKO_ID_MAP: dict[str, str] = {
    "solana": "solana",
    "sol": "solana",
    "bitcoin": "bitcoin",
    "btc": "bitcoin",
    "ethereum": "ethereum",
    "eth": "ethereum",
    "bnb": "binancecoin",
    "binance": "binancecoin",
    "xrp": "ripple",
    "ripple": "ripple",
    "doge": "dogecoin",
    "dogecoin": "dogecoin",
    "matic": "matic-network",
    "polygon": "matic-network",
    "avax": "avalanche-2",
    "avalanche": "avalanche-2",
}


def _safe_json_loads(content: str) -> dict[str, Any]:
    text = str(content or "").strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.startswith("json"):
            text = text[4:].strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(text[start : end + 1])
                return parsed if isinstance(parsed, dict) else {}
            except Exception:
                return {}
        return {}


async def _fetch_market_snapshot(question: str) -> dict[str, Any]:
    lower_question = (question or "").lower()
    coin_ids: list[str] = []
    for token, coin_id in COINGECKO_ID_MAP.items():
        if token in lower_question and coin_id not in coin_ids:
            coin_ids.append(coin_id)

    if not coin_ids:
        return {}

    ids_param = ",".join(coin_ids[:4])
    url = "https://api.coingecko.com/api/v3/simple/price"
    params = {
        "ids": ids_param,
        "vs_currencies": "usd",
        "include_24hr_change": "true",
        "include_last_updated_at": "true",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            payload = response.json() or {}
    except Exception:
        return {}

    snapshot: dict[str, Any] = {}
    for coin_id in coin_ids:
        row = payload.get(coin_id) or {}
        usd = row.get("usd")
        change = row.get("usd_24h_change")
        updated_at = row.get("last_updated_at")
        if usd is None:
            continue
        snapshot[coin_id] = {
            "price_usd": float(usd),
            "change_24h_pct": float(change or 0.0),
            "last_updated_at": updated_at,
        }

    return snapshot


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
        reasons.append(f"{ASSISTANT_NAME} applied {direction} confidence calibration ({confidence_bias:+.2f}) from recent outcomes.")

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
        "assistant_name": ASSISTANT_NAME,
        "source": "fallback",
        "generated_at": datetime.utcnow().isoformat(),
    }


def _fallback_answer(question: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    context = context or {}
    market = context.get("market", {}) or {}
    chain = str(market.get("chain", "unknown")).lower()
    symbol = str(market.get("symbol", "token"))
    market_snapshot = context.get("market_snapshot", {}) or {}

    pricing_lines: list[str] = []
    for coin_id, row in (market_snapshot.items() if isinstance(market_snapshot, dict) else []):
        if not isinstance(row, dict):
            continue
        price = float(row.get("price_usd", 0) or 0)
        change = float(row.get("change_24h_pct", 0) or 0)
        pricing_lines.append(f"{coin_id}: ${price:,.4f} ({change:+.2f}% 24h)")

    response = (
        f"Fallback assistant response for {symbol} on {chain}: "
        "Use risk-first validation, verify liquidity depth, avoid oversized positions, "
        "and run in paper mode before enabling autonomous execution."
    )
    if pricing_lines:
        response = f"{response} Live market snapshot: {'; '.join(pricing_lines)}."

    return {
        "question": question,
        "answer": response,
        "key_points": [
            "AI guidance does not replace risk controls.",
            "Confirm stop-loss and max daily loss limits before execution.",
            "Start in paper mode and validate against recent market regime.",
        ],
        "assistant_name": ASSISTANT_NAME,
        "source": "fallback",
        "generated_at": datetime.utcnow().isoformat(),
    }


async def generate_trade_assist(payload: dict[str, Any]) -> dict[str, Any]:
    api_key = settings.AI_INTEGRATIONS_OPENAI_API_KEY or settings.OPENAI_API_KEY
    if not api_key:
        return _fallback_assist(payload)

    prompt = {
        "task": "Provide multi-factor, cross-chain, risk-aware trading decision support.",
        "assistant_name": ASSISTANT_NAME,
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
                        {"role": "system", "content": DOCTOR_TRADE_SYSTEM_PROMPT},
                        {"role": "user", "content": json.dumps(prompt)},
                    ],
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            parsed = _safe_json_loads(content)
            if not parsed:
                return _fallback_assist(payload)

            parsed["confidence"] = float(parsed.get("confidence", 0) or 0)
            parsed["take_profit_pct"] = float(parsed.get("take_profit_pct", 0) or 0)
            parsed["stop_loss_pct"] = float(parsed.get("stop_loss_pct", 0) or 0)
            parsed["horizon"] = str(parsed.get("horizon", "unknown"))
            parsed["position_size_guidance"] = str(parsed.get("position_size_guidance", "skip"))
            parsed["market_regime"] = str(parsed.get("market_regime", "unknown"))
            parsed["requires_risk_approval"] = True
            parsed["source"] = "openai"
            parsed["assistant_name"] = ASSISTANT_NAME
            parsed["generated_at"] = datetime.utcnow().isoformat()
            return parsed
    except Exception:
        return _fallback_assist(payload)


async def answer_user_question(question: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    merged_context = dict(context or {})
    if "market_snapshot" not in merged_context:
        merged_context["market_snapshot"] = await _fetch_market_snapshot(question)

    api_key = settings.AI_INTEGRATIONS_OPENAI_API_KEY or settings.OPENAI_API_KEY
    if not api_key:
        return _fallback_answer(question, merged_context)

    prompt = {
        "task": "Answer the user's trading intelligence question using provided context with practical, risk-aware guidance.",
        "assistant_name": ASSISTANT_NAME,
        "question": question,
        "context": merged_context,
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
                        {"role": "system", "content": DOCTOR_TRADE_SYSTEM_PROMPT},
                        {"role": "user", "content": json.dumps(prompt)},
                    ],
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            parsed = _safe_json_loads(content)
            if not parsed:
                return _fallback_answer(question, merged_context)
            return {
                "question": question,
                "answer": str(parsed.get("answer", "")).strip(),
                "key_points": [str(item) for item in (parsed.get("key_points") or [])][:5],
                "confidence": float(parsed.get("confidence", 0) or 0),
                "risk_level": str(parsed.get("risk_level", "unknown")),
                "assistant_name": ASSISTANT_NAME,
                "market_snapshot": merged_context.get("market_snapshot", {}),
                "source": "openai",
                "generated_at": datetime.utcnow().isoformat(),
            }
    except Exception:
        return _fallback_answer(question, merged_context)