from __future__ import annotations

import logging
import os
from typing import Any, Dict

from core.token_queue import token_queue

logger = logging.getLogger("tradeaid.pipeline")


TokenPayload = Dict[str, Any]


def analyze_token(token: TokenPayload) -> int:
    """Simple scoring placeholder for queue consumers.

    Replace this with the project AI scoring engine call.
    """
    score = 0
    liquidity = float(token.get("liquidity") or 0)
    volume = float(token.get("volume") or 0)

    if liquidity >= 5_000:
        score += 30
    if volume >= 10_000:
        score += 30
    if token.get("source") == "raydium":
        score += 25
    if token.get("source") == "pumpfun":
        score += 20

    return min(score, 100)


def trigger_sniper(token: TokenPayload) -> None:
    """Hook point for DoctorTrade buy engine integration."""
    logger.info("[Sniper] Triggering buy path for %s", token.get("mint"))


def scanner_loop() -> None:
    threshold = int(os.getenv("TRADEAID_AI_THRESHOLD", "80"))
    logger.info("[Scanner] Queue consumer started (threshold=%s)", threshold)

    while True:
        token = token_queue.get()
        logger.info("[Scanner] Scanning token: %s", token)
        score = analyze_token(token)
        logger.info("[Scanner] Score=%s mint=%s", score, token.get("mint"))

        if score >= threshold:
            trigger_sniper(token)
