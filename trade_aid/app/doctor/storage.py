from __future__ import annotations

from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.database import async_session_factory
from app.models.models import Base

_settings = get_settings()
_doctor_session_factory: async_sessionmaker[AsyncSession] | None = None
_doctor_tables_initialized = False


def _normalize_async_url(url: str) -> str:
    value = (url or "").strip()
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+asyncpg://", 1)
    return value


def _get_doctor_session_factory() -> async_sessionmaker[AsyncSession]:
    global _doctor_session_factory
    if _doctor_session_factory is not None:
        return _doctor_session_factory

    doctor_db_url = _normalize_async_url(_settings.DOCTOR_DATABASE_URL)
    if not doctor_db_url:
        _doctor_session_factory = async_session_factory
        return _doctor_session_factory

    engine = create_async_engine(
        doctor_db_url,
        echo=False,
        pool_size=8,
        max_overflow=4,
        pool_pre_ping=True,
    )
    _doctor_session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    return _doctor_session_factory


async def _ensure_doctor_tables() -> None:
    global _doctor_tables_initialized
    if _doctor_tables_initialized:
        return
    factory = _get_doctor_session_factory()
    bind = factory.kw.get("bind")
    if bind is None:
        _doctor_tables_initialized = True
        return
    async with bind.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    _doctor_tables_initialized = True


@asynccontextmanager
async def doctor_db_session() -> AsyncSession:
    await _ensure_doctor_tables()
    factory = _get_doctor_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
