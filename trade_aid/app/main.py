import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings
from app.database import init_db, close_db
from app.utils.rate_limiter import RateLimitMiddleware
from app.utils.redis_client import close_redis
from app.utils.logging_config import logger
from app.websocket.manager import ws_manager
from app.routers import auth, tokens, wallets, scoring, alerts

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Trade Aid API starting up...")
    await init_db()
    logger.info("Database initialized")

    try:
        await ws_manager.start_redis_subscriber()
        logger.info("WebSocket Redis subscriber started")
    except Exception as e:
        logger.warning(f"Redis subscriber failed (Redis may not be running): {e}")

    yield

    logger.info("Trade Aid API shutting down...")
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(RateLimitMiddleware)

app.include_router(auth.router)
app.include_router(tokens.router)
app.include_router(wallets.router)
app.include_router(scoring.router)
app.include_router(alerts.router)


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
    await ws_manager.connect(websocket)
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
    await ws_manager.connect(websocket)
    try:
        await websocket.send_json({"type": "connected", "channel": "alerts"})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)
