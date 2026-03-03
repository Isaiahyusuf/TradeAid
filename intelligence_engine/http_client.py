"""Async HTTP client with timeout, retries and backoff.

Provides a single `fetch_json` coroutine used by listeners.
"""
from typing import Any, Dict, Optional
import asyncio
import aiohttp
import random

from .exceptions import NetworkError
from .logging_config import logger


DEFAULT_TIMEOUT = 8
DEFAULT_RETRIES = 3


async def _sleep_backoff(attempt: int) -> None:
    base = 0.5
    jitter = random.random() * 0.3
    await asyncio.sleep(base * (2 ** attempt) + jitter)


async def fetch_json(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = DEFAULT_TIMEOUT, retries: int = DEFAULT_RETRIES) -> Optional[Dict[str, Any]]:
    last_exc: Optional[Exception] = None
    for attempt in range(retries):
        try:
            timeout_ctx = aiohttp.ClientTimeout(total=timeout)
            async with aiohttp.ClientSession(timeout=timeout_ctx) as session:
                async with session.get(url, headers=headers) as resp:
                    text = await resp.text()
                    if resp.status >= 400:
                        logger.error("http_error", extra={"url": url, "status": resp.status, "body": text})
                        raise NetworkError(f"HTTP {resp.status}", url=url)
                    try:
                        return await resp.json()
                    except Exception as e:
                        logger.error("json_parse_error", extra={"url": url, "error": str(e)})
                        raise
        except Exception as exc:
            last_exc = exc
            logger.warning("fetch_attempt_failed", extra={"url": url, "attempt": attempt, "error": str(exc)})
            if attempt + 1 < retries:
                await _sleep_backoff(attempt)
    # exhausted
    logger.error("fetch_failed", extra={"url": url, "error": str(last_exc)})
    raise NetworkError(f"Failed to fetch {url} after {retries} attempts", url=url)
