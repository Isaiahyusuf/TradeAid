"""
Dedicated scanner process - runs as a single instance.
Handles DexScreener polling and chain WebSocket listeners.
This avoids duplication when the API runs multiple gunicorn workers.
"""
import asyncio
import signal
from app.database import init_db, close_db
from app.utils.redis_client import close_redis
from app.utils.logging_config import logger
from app.scanners.dexscreener import dex_scanner
from app.scanners.chain_scanner import chain_scanner_manager


async def main():
    logger.info("[ScannerRunner] Starting dedicated scanner process")
    await init_db()
    logger.info("[ScannerRunner] Database initialized")

    dex_task = asyncio.create_task(dex_scanner.start())
    logger.info("[ScannerRunner] DexScreener scanner started")

    await chain_scanner_manager.start_all()
    logger.info("[ScannerRunner] Chain WebSocket listeners started")

    stop_event = asyncio.Event()

    def handle_signal():
        logger.info("[ScannerRunner] Shutdown signal received")
        stop_event.set()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, handle_signal)

    await stop_event.wait()

    logger.info("[ScannerRunner] Shutting down...")
    await dex_scanner.stop()
    await chain_scanner_manager.stop_all()
    await close_redis()
    await close_db()
    logger.info("[ScannerRunner] Shutdown complete")


if __name__ == "__main__":
    asyncio.run(main())
