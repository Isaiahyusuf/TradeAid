# intelligence_engine/cache.py
"""
Internal cache for intelligence engine (60s TTL).
"""
import asyncio
import time
from typing import Any, Dict, Optional

from .logging_config import logger


class IntelligenceCache:
    """Simple in-memory async cache with 60s TTL. This cache is private to intelligence_engine."""

    def __init__(self) -> None:
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def get(self, mint: str) -> Optional[Dict[str, Any]]:
        async with self._lock:
            entry = self._cache.get(mint)
            if entry and (time.time() - entry["ts"] < 60):
                logger.debug("cache_hit", extra={"mint": mint})
                return entry["data"]
            logger.debug("cache_miss", extra={"mint": mint})
            return None

    async def set(self, mint: str, data: Dict[str, Any]) -> None:
        async with self._lock:
            self._cache[mint] = {"data": data, "ts": time.time()}
            logger.debug("cache_set", extra={"mint": mint})
