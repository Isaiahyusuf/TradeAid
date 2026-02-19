import os
from pydantic_settings import BaseSettings
from functools import lru_cache
from urllib.parse import urlparse, urlunparse


def fix_database_url(url: str, async_driver: bool = False) -> str:
    if not url:
        return url
    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    port = parsed.port
    if port is None:
        port = 5432
    scheme = parsed.scheme
    if async_driver:
        if scheme == "postgresql" or scheme == "postgres":
            scheme = "postgresql+asyncpg"
        elif not scheme.startswith("postgresql+asyncpg"):
            scheme = "postgresql+asyncpg"
    else:
        if scheme == "postgres":
            scheme = "postgresql"
        elif scheme.startswith("postgresql+asyncpg"):
            scheme = "postgresql"
    netloc = f"{parsed.username or ''}:{parsed.password or ''}@{host}:{port}" if parsed.username else f"{host}:{port}"
    return urlunparse((scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))


class Settings(BaseSettings):
    APP_NAME: str = "Trade Aid"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/trade_aid"
    DATABASE_URL_SYNC: str = "postgresql://postgres:postgres@localhost:5432/trade_aid"

    PGHOST: str = ""
    PGPORT: str = "5432"
    PGUSER: str = ""
    PGPASSWORD: str = ""
    PGDATABASE: str = ""

    def get_async_database_url(self) -> str:
        if self.PGHOST and self.PGUSER:
            port = self.PGPORT or "5432"
            return f"postgresql+asyncpg://{self.PGUSER}:{self.PGPASSWORD}@{self.PGHOST}:{port}/{self.PGDATABASE}"
        return fix_database_url(self.DATABASE_URL, async_driver=True)

    def get_sync_database_url(self) -> str:
        if self.PGHOST and self.PGUSER:
            port = self.PGPORT or "5432"
            return f"postgresql://{self.PGUSER}:{self.PGPASSWORD}@{self.PGHOST}:{port}/{self.PGDATABASE}"
        return fix_database_url(self.DATABASE_URL_SYNC, async_driver=False)

    REDIS_URL: str = "redis://localhost:6379/0"

    JWT_SECRET_KEY: str = "change-this-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    MASTER_ACCESS_KEY: str = "change-this-master-key"

    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    AI_SERVICE_URL: str = "http://ai_service:8001"

    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""

    DEXSCREENER_API_URL: str = "https://api.dexscreener.com/latest/dex"
    SCAN_INTERVAL_SECONDS: int = 10

    SOLANA_RPC_URL: str = "https://api.mainnet-beta.solana.com"
    ETHEREUM_RPC_URL: str = ""
    BSC_RPC_URL: str = "https://bsc-dataseed.binance.org/"
    BASE_RPC_URL: str = ""
    ARBITRUM_RPC_URL: str = ""
    AVALANCHE_RPC_URL: str = "https://api.avax.network/ext/bc/C/rpc"
    POLYGON_RPC_URL: str = "https://polygon-rpc.com/"

    SOLANA_WS_URL: str = "wss://api.mainnet-beta.solana.com"
    ETHEREUM_WS_URL: str = ""
    BSC_WS_URL: str = ""
    BASE_WS_URL: str = ""
    ARBITRUM_WS_URL: str = ""
    AVALANCHE_WS_URL: str = ""
    POLYGON_WS_URL: str = ""

    CORS_ORIGINS: str = "*"
    RATE_LIMIT_PER_MINUTE: int = 60

    LOG_LEVEL: str = "INFO"
    LOG_FILE: str = "trade_aid.log"

    MIN_LIQUIDITY_AGE_MINUTES: int = 30
    MIN_MARKET_CAP_USD: float = 25000.0

    ENCRYPTION_KEY: str = "change-this-encryption-key-32chars!"

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()
