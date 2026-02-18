import json
from typing import Optional, Any
import redis.asyncio as aioredis
from app.config import get_settings

settings = get_settings()

redis_pool: Optional[aioredis.Redis] = None


async def get_redis() -> aioredis.Redis:
    global redis_pool
    if redis_pool is None:
        redis_pool = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            max_connections=50,
        )
    return redis_pool


async def close_redis():
    global redis_pool
    if redis_pool:
        await redis_pool.close()
        redis_pool = None


async def cache_set(key: str, value: Any, ttl: int = 300):
    r = await get_redis()
    serialized = json.dumps(value, default=str)
    await r.setex(key, ttl, serialized)


async def cache_get(key: str) -> Optional[Any]:
    r = await get_redis()
    data = await r.get(key)
    if data:
        return json.loads(data)
    return None


async def cache_delete(key: str):
    r = await get_redis()
    await r.delete(key)


async def publish_event(channel: str, data: dict):
    r = await get_redis()
    await r.publish(channel, json.dumps(data, default=str))
