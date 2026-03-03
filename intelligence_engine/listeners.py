# intelligence_engine/listeners.py
"""Listeners that fetch data from external APIs.

This module uses `http_client.fetch_json` which provides timeouts,
retries and backoff. Responses are validated against pydantic
schemas where possible.
"""
from typing import Any, Dict, Optional
import asyncio

from .api_clients import (
    fetch_helius,
    fetch_dexscreener,
    fetch_jupiter,
    fetch_solscan,
    fetch_moralis,
)
from .exceptions import DataValidationError
from .logging_config import logger


async def fetch_all_sources(mint: str) -> Dict[str, Optional[Dict[str, Any]]]:
    """Fetch all sources in parallel using per-API clients.

    Critical sources: helius, dexscreener, solscan. If any of these
    raise DataValidationError or NetworkError, propagate the error so
    the pipeline can handle it explicitly (no silent failures).
    Jupiter and Moralis are treated as optional enrichments.
    """
    tasks = [
        asyncio.create_task(fetch_helius(mint)),
        asyncio.create_task(fetch_dexscreener(mint)),
        asyncio.create_task(fetch_jupiter(mint)),
        asyncio.create_task(fetch_solscan(mint)),
        asyncio.create_task(fetch_moralis(mint)),
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)

    # If any critical task failed with an exception, raise it
    critical_errors = []
    # indices: 0=helius,1=dexscreener,2=jupiter,3=solscan,4=moralis
    for idx in (0, 1, 3):
        res = results[idx]
        if isinstance(res, Exception):
            critical_errors.append(res)

    if critical_errors:
        # Raise the first critical error to the caller
        logger.error("critical_source_failure", extra={"mint": mint, "error": str(critical_errors[0])})
        raise critical_errors[0]

    def _safe_dict(entry):
        if isinstance(entry, Exception):
            return None
        return entry

    return {
        "helius": _safe_dict(results[0]),
        "dexscreener": _safe_dict(results[1]),
        "jupiter": _safe_dict(results[2]),
        "solscan": _safe_dict(results[3]),
        "moralis": _safe_dict(results[4]),
    }
