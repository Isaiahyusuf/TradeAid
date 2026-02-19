import os
import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import build_database_url

logger = logging.getLogger("trade_aid")

db_url = build_database_url(async_driver=True)

safe_url = db_url
if "@" in safe_url:
    parts = safe_url.split("@")
    safe_url = "***@" + parts[-1]
logger.info(f"Database URL (masked): {safe_url}")
print(f"[STARTUP] Connecting to database: {safe_url}", flush=True)

engine = create_async_engine(
    db_url,
    echo=False,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=3600,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    import asyncio
    for attempt in range(5):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            print("[STARTUP] Database initialized successfully", flush=True)
            return
        except Exception as e:
            wait = 2 ** attempt
            print(f"[STARTUP] DB connection attempt {attempt + 1}/5 failed: {e}. Retrying in {wait}s...", flush=True)
            await asyncio.sleep(wait)
    print("[STARTUP] WARNING: Could not connect to database after 5 attempts. Starting without DB.", flush=True)


async def close_db():
    await engine.dispose()
