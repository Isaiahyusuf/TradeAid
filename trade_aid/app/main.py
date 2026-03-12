import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from app.config import get_settings
from app.database import init_db, close_db
from app.doctor.services import validate_required_doctor_env_keys
from app.utils.rate_limiter import RateLimitMiddleware
from app.utils.redis_client import close_redis
from app.utils.logging_config import logger
from app.utils.request_logging import RequestLoggingMiddleware
from app.websocket.manager import ws_manager
from app.routers import auth, tokens, wallets, scoring, alerts, safe_buy, ai_assistant, doctor_trade, scanner
from app.scanners.dexscreener import dex_scanner
from app.scanners.chain_scanner import chain_scanner_manager
from app.services.fresh_token_detector import fresh_token_detector

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Trade Aid API starting up...")
    validate_required_doctor_env_keys()
    await init_db()
    logger.info("Database initialized")
    scanner_task = None
    fresh_detector_started = False

    try:
        await ws_manager.start_redis_subscriber()
        logger.info("WebSocket Redis subscriber started")
    except Exception as e:
        logger.warning(f"Redis subscriber failed (Redis may not be running): {e}")

    if settings.ENABLE_SCANNERS:
        try:
            scanner_task = asyncio.create_task(dex_scanner.start())
            await chain_scanner_manager.start_all()
            logger.info("Background scanners started")
        except Exception as e:
            logger.warning(f"Scanner startup failed: {e}")

    if str(os.getenv("ENABLE_FRESH_TOKEN_SNIPER", "true")).strip().lower() in ("1", "true", "yes", "on"):
        try:
            await fresh_token_detector.start()
            fresh_detector_started = True
            logger.info("Fresh token sniping detector started")
        except Exception as e:
            logger.warning(f"Fresh token detector startup failed: {e}")

    yield

    logger.info("Trade Aid API shutting down...")
    if scanner_task:
        await dex_scanner.stop()
        scanner_task.cancel()
    if fresh_detector_started:
        await fresh_token_detector.stop()
    await chain_scanner_manager.stop_all()
    await ws_manager.stop()
    await close_redis()
    await close_db()
    logger.info("Shutdown complete")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Blockchain Intelligence Backend - Cross-chain token scanning, risk scoring, and alert system",
    lifespan=lifespan,
)

# Mount AI Service as sub-application
try:
    from ai_service.main import app as ai_app
    app.mount("/ai", ai_app)
    logger.info("AI Service mounted at /ai")
except Exception as e:
    logger.warning(f"Could not mount AI service: {e}")

app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

cors_origins = []
if settings.FRONTEND_URL.strip():
    cors_origins.append(settings.FRONTEND_URL.strip())

for origin in settings.CORS_ORIGINS.split(","):
    value = origin.strip()
    if not value:
        continue
    if value not in cors_origins:
        cors_origins.append(value)

if not cors_origins:
    cors_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(RateLimitMiddleware)

app.include_router(auth.router)
app.include_router(tokens.router)
app.include_router(wallets.router)
app.include_router(scoring.router)
app.include_router(alerts.router)
app.include_router(safe_buy.router)
app.include_router(ai_assistant.router)
app.include_router(doctor_trade.router)
app.include_router(scanner.router)
app.include_router(scanner.ingest_router)


@app.get("/")
async def root():
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/debug/db")
async def debug_db():
    import os
    from app.config import build_database_url
    url = build_database_url(async_driver=True)
    safe_url = url
    if "@" in safe_url:
        parts = safe_url.split("@")
        safe_url = "***@" + parts[-1]
    return {
        "db_url_masked": safe_url,
        "DATABASE_URL": "set" if os.environ.get("DATABASE_URL") else "(not set)",
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    user_id = str(websocket.query_params.get("user_id") or "").strip()
    if not user_id:
        await websocket.close(code=1008)
        return
    await ws_manager.connect(websocket, user_id)
    try:
        while True:
            data = await websocket.receive_text()
            logger.debug(f"[WS] Received: {data}")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)


@app.websocket("/ws/alerts")
async def alerts_websocket(websocket: WebSocket):
    user_id = str(websocket.query_params.get("user_id") or "").strip()
    if not user_id:
        await websocket.close(code=1008)
        return
    await ws_manager.connect(websocket, user_id)
    try:
        await websocket.send_json({"type": "connected", "channel": "alerts"})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)
