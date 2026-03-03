# intelligence_engine/data_pipeline.py
"""Data pipeline orchestration.

Phase 1: orchestration and validation. Per-API fetchers and stricter
aggregation will be added in Phase 2.
"""
from typing import Any, Dict
import asyncio

from .analyzers import normalize_token_data
from .listeners import fetch_all_sources
from .logging_config import logger
from .exceptions import IntelligenceError


async def fetch_token_intelligence(mint: str) -> Dict[str, Any]:
    logger.info("pipeline_start", extra={"mint": mint})
    try:
        raw_data = await fetch_all_sources(mint)
    except IntelligenceError as e:
        logger.error("pipeline_source_error", extra={"mint": mint, "error": str(e)})
        raise

    # Normalize into structured object (analyzers.py will later be stricter)
    normalized = normalize_token_data(raw_data)
    logger.info("pipeline_complete", extra={"mint": mint})
    return normalized
