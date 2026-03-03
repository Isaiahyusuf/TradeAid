# intelligence_engine/engine.py
"""Main entry point for intelligence engine.

This module exposes a single public coroutine `get_token_intelligence(mint)`.
It is isolated and uses only environment, DB, and external APIs.
"""
from typing import Any, Dict, Optional
import asyncio

from .cache import IntelligenceCache
from .data_pipeline import fetch_token_intelligence
from .logging_config import logger
from .exceptions import IntelligenceError

cache = IntelligenceCache()


async def get_token_intelligence(mint: str) -> Dict[str, Any]:
    """Public integration point.

    - Checks internal cache
    - Runs pipeline if needed
    - Stores result in cache and returns a structured dict
    """
    logger.info("get_token_intelligence_called", extra={"mint": mint})
    cached: Optional[Dict[str, Any]] = await cache.get(mint)
    if cached is not None:
        return cached

    try:
        result = await fetch_token_intelligence(mint)
    except IntelligenceError as e:
        logger.error("pipeline_failed", extra={"mint": mint, "error": str(e)})
        # Convert to a minimal structured response to avoid crashing callers
        return {"mint": mint, "error": str(e)}

    await cache.set(mint, result)
    return result
