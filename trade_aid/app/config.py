import os
from pydantic_settings import BaseSettings
from functools import lru_cache


def build_database_url(async_driver: bool = False) -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        url = "postgresql://postgres:postgres@localhost:5432/trade_aid"

    if async_driver:
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)

    return url


class Settings(BaseSettings):
    APP_NAME: str = "Trade Aid"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    DATABASE_URL: str = ""
    DOCTOR_DATABASE_URL: str = ""

    REDIS_URL: str = "redis://localhost:6379/0"

    JWT_SECRET_KEY: str = "change-this-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    MASTER_ACCESS_KEY: str = "change-this-master-key"
    ACCESS_CODE: str = ""

    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    AI_SERVICE_URL: str = "http://ai_service:8001"
    OPENCLOW_SERVICE_URL: str = "http://openclaw:8088"
    OPENCLOW_API_KEY: str = ""
    OPENCLOW_RATE_LIMIT_PER_MINUTE: int = 120
    OPENCLOW_VOLATILITY_PAUSE_THRESHOLD: float = 0.09
    OPENAI_API_KEY: str = ""
    AI_INTEGRATIONS_OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4o-mini"

    RESEND_API_KEY: str = ""
    RESEND_BASE_URL: str = "https://api.resend.com"
    RESEND_FROM_EMAIL: str = ""

    OAUTH_FRONTEND_URL: str = ""
    FRONTEND_URL: str = ""
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    APPLE_CLIENT_ID: str = ""
    APPLE_TEAM_ID: str = ""
    APPLE_KEY_ID: str = ""
    APPLE_PRIVATE_KEY: str = ""

    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""

    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = True
    SMTP_USE_SSL: bool = False
    SMTP_FROM_EMAIL: str = "noreply@tradeaid.app"
    SMTP_FROM_NAME: str = "TradeAid"

    DEXSCREENER_API_URL: str = "https://api.dexscreener.com/latest/dex"
    SCAN_INTERVAL_SECONDS: int = 10
    ENABLE_SCANNERS: bool = True
    ENABLED_CHAINS: str = "solana,ethereum,bsc,base,arbitrum,avalanche,polygon"

    SOLANA_RPC_URL: str = "https://api.mainnet-beta.solana.com"
    COINGECKO_API_KEY: str = ""
    SOLSCAN_API_KEY: str = ""
    BITQUERY_API_KEY: str = ""
    HELIUS_API_KEY: str = ""
    MORALIS_API_KEY: str = ""
    WALLETBOT_KEY: str = ""
    JUPITER_API_KEY: str = ""
    COVALENT_API_KEY: str = ""
    THE_GRAPH_ENDPOINT: str = ""

    DOCTOR_MIN_LIQUIDITY_USD: float = 20000.0
    DOCTOR_MIN_VOLUME_24H_USD: float = 5000.0
    DOCTOR_MIN_AGE_MINUTES: int = 5
    DOCTOR_MAX_AGE_MINUTES: int = 1440

    DOCTOR_SOLANA_PRIVATE_KEY: str = ""
    DOCTOR_SOLANA_WALLET_ADDRESS: str = ""
    DOCTOR_MAX_SLIPPAGE_PCT: float = 2.0
    DOCTOR_VOLATILITY_SPIKE_THRESHOLD: float = 6.0
    DOCTOR_EXECUTION_MODE: str = "paper"
    DOCTOR_API_ERROR_PAUSE_THRESHOLD: int = 3
    ETHEREUM_RPC_URL: str = "https://rpc.ankr.com/eth"
    BSC_RPC_URL: str = "https://bsc-dataseed.binance.org/"
    BASE_RPC_URL: str = "https://mainnet.base.org"
    ARBITRUM_RPC_URL: str = "https://arb1.arbitrum.io/rpc"
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
    TELEMETRY_HASH_SALT: str = "change-this-telemetry-salt"

    class Config:
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()


def get_enabled_chains() -> list[str]:
    settings = get_settings()
    chains = [value.strip().lower() for value in settings.ENABLED_CHAINS.split(",") if value.strip()]
    if not chains:
        return ["solana"]
    return list(dict.fromkeys(chains))
