from __future__ import annotations

import logging
import os
import asyncio
from typing import Any, Dict

from app.doctor import doctor_controller
from core.dedup_store import dedup_store
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
    """Route scored tokens into DoctorTrade direct-buy execution path."""
    mint = str(token.get("mint") or token.get("address") or "").strip()
    if not mint:
        logger.info("[Sniper] Skipping empty mint token payload")
        return

    try:
        result = asyncio.run(doctor_controller.execute_direct_buy(mint, chain="solana"))
        logger.info("[Sniper] DoctorTrade result mint=%s result=%s", mint, result)
    except Exception as exc:
        logger.warning("[Sniper] DoctorTrade execution failed mint=%s error=%s", mint, exc)


def scanner_loop() -> None:
    threshold = int(os.getenv("TRADEAID_AI_THRESHOLD", "80"))
    logger.info("[Scanner] Queue consumer started (threshold=%s)", threshold)

    while True:
        token = token_queue.get()
        logger.info("[Scanner] Scanning token: %s", token)
        mint = str(token.get("mint") or token.get("address") or "").strip()
        source = str(token.get("source") or "unknown").strip().lower()
        if mint and not dedup_store.mark_if_new(f"pipeline:{source}:{mint}"):
            logger.info("[Scanner] Duplicate skipped source=%s mint=%s", source, mint)
            continue

        score = analyze_token(token)
        logger.info("[Scanner] Score=%s mint=%s", score, mint)

        if score >= threshold:
            trigger_sniper(token)
