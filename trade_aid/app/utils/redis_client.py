import json
import time
from urllib.parse import urlparse
from typing import Optional, Any
import redis.asyncio as aioredis
from app.config import get_settings
from app.utils.logging_config import logger

settings = get_settings()

redis_pool: Optional[aioredis.Redis] = None
redis_disabled: bool = False
memory_cache: dict[str, tuple[float, str]] = {}


def _is_valid_redis_url(url: str) -> bool:
    value = str(url or "").strip()
    if not value:
        return False
    try:
        parsed = urlparse(value)
        if parsed.scheme not in {"redis", "rediss", "unix"}:
            return False
        _ = parsed.port
        return True
    except Exception:
        return False


def _memory_set(key: str, value: str, ttl: int) -> None:
    expires_at = time.time() + max(int(ttl), 1)
    memory_cache[key] = (expires_at, value)


def _memory_get(key: str) -> Optional[str]:
    entry = memory_cache.get(key)
    if not entry:
        return None
    expires_at, value = entry
    if expires_at <= time.time():
        memory_cache.pop(key, None)
        return None
    return value


def _memory_delete(key: str) -> None:
    memory_cache.pop(key, None)


async def get_redis() -> Optional[aioredis.Redis]:
    global redis_pool
    global redis_disabled
    if redis_disabled:
        return None
    if redis_pool is None:
        redis_url = str(settings.REDIS_URL or "").strip()
        if not _is_valid_redis_url(redis_url):
            redis_disabled = True
            logger.warning("[Redis] Invalid REDIS_URL. Falling back to in-memory cache and disabling pubsub.")
            return None
        try:
            redis_pool = aioredis.from_url(
                redis_url,
                encoding="utf-8",
                decode_responses=True,
                max_connections=50,
            )
            await redis_pool.ping()
        except Exception as exc:
            redis_pool = None
            redis_disabled = True
            logger.warning(f"[Redis] Connection unavailable ({exc}). Falling back to in-memory cache and disabling pubsub.")
            return None
    return redis_pool


async def close_redis():
    global redis_pool
    if redis_pool:
        try:
            await redis_pool.close()
        except Exception:
            pass
        redis_pool = None


async def cache_set(key: str, value: Any, ttl: int = 300):
    serialized = json.dumps(value, default=str)
    _memory_set(key, serialized, ttl)
    r = await get_redis()
    if r is not None:
        try:
            await r.setex(key, ttl, serialized)
        except Exception:
            pass


async def cache_get(key: str) -> Optional[Any]:
    r = await get_redis()
    data = None
    if r is not None:
        try:
            data = await r.get(key)
        except Exception:
            data = None
    if data is None:
        data = _memory_get(key)
    if data:
        try:
            return json.loads(data)
        except Exception:
            return None
    return None


async def cache_delete(key: str):
    _memory_delete(key)
    r = await get_redis()
    if r is not None:
        try:
            await r.delete(key)
        except Exception:
            pass


async def publish_event(channel: str, data: dict):
    r = await get_redis()
    if r is not None:
        try:
            await r.publish(channel, json.dumps(data, default=str))
        except Exception:
            pass
