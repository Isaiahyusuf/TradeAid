import asyncio
import json
from typing import Optional
import websockets
from app.config import get_settings
from app.utils.logging_config import logger
from app.utils.redis_client import publish_event

settings = get_settings()

CHAIN_WS_URLS = {
    "solana": settings.SOLANA_WS_URL,
    "ethereum": settings.ETHEREUM_WS_URL,
    "bsc": settings.BSC_WS_URL,
    "base": settings.BASE_WS_URL,
    "arbitrum": settings.ARBITRUM_WS_URL,
    "avalanche": settings.AVALANCHE_WS_URL,
    "polygon": settings.POLYGON_WS_URL,
}


class ChainWebSocketListener:
    def __init__(self, chain: str, ws_url: str):
        self.chain = chain
        self.ws_url = ws_url
        self.running = False
        self.reconnect_delay = 5
        self.max_reconnect_delay = 60

    async def start(self):
        if not self.ws_url:
            logger.info(f"[WS:{self.chain}] No WebSocket URL configured, skipping")
            return

        self.running = True
        delay = self.reconnect_delay

        while self.running:
            try:
                logger.info(f"[WS:{self.chain}] Connecting to {self.ws_url}")
                async with websockets.connect(
                    self.ws_url,
                    ping_interval=30,
                    ping_timeout=10,
                    close_timeout=5,
                ) as ws:
                    delay = self.reconnect_delay
                    logger.info(f"[WS:{self.chain}] Connected")

                    await self._subscribe(ws)

                    async for message in ws:
                        try:
                            await self._handle_message(message)
                        except Exception as e:
                            logger.error(f"[WS:{self.chain}] Message handling error: {e}")

            except websockets.exceptions.ConnectionClosed as e:
                logger.warning(f"[WS:{self.chain}] Connection closed: {e}")
            except Exception as e:
                logger.error(f"[WS:{self.chain}] Connection error: {e}")

            if self.running:
                logger.info(f"[WS:{self.chain}] Reconnecting in {delay}s")
                await asyncio.sleep(delay)
                delay = min(delay * 2, self.max_reconnect_delay)

    async def stop(self):
        self.running = False

    async def _subscribe(self, ws):
        if self.chain == "solana":
            subscribe_msg = json.dumps({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "logsSubscribe",
                "params": [
                    {"mentions": ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"]},
                    {"commitment": "confirmed"},
                ]
            })
            await ws.send(subscribe_msg)
            logger.info(f"[WS:{self.chain}] Subscribed to Raydium logs")
        elif self.chain in ("ethereum", "bsc", "base", "arbitrum", "polygon", "avalanche"):
            subscribe_msg = json.dumps({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "eth_subscribe",
                "params": ["newPendingTransactions"],
            })
            await ws.send(subscribe_msg)
            logger.info(f"[WS:{self.chain}] Subscribed to pending transactions")

    async def _handle_message(self, raw_message: str):
        try:
            data = json.loads(raw_message)
        except json.JSONDecodeError:
            return

        if self.chain == "solana":
            await self._handle_solana_message(data)
        else:
            await self._handle_evm_message(data)

    async def _handle_solana_message(self, data: dict):
        result = data.get("params", {}).get("result", {})
        if not result:
            return

        logs = result.get("value", {}).get("logs", [])
        signature = result.get("value", {}).get("signature", "")

        for log in logs:
            if "InitializeInstruction2" in log or "initialize2" in log.lower():
                await publish_event("chain_events", {
                    "chain": "solana",
                    "event": "new_pool",
                    "signature": signature,
                    "raw_log": log,
                })
                logger.info(f"[WS:solana] New pool detected: {signature}")

    async def _handle_evm_message(self, data: dict):
        tx_hash = data.get("params", {}).get("result")
        if tx_hash:
            await publish_event("chain_events", {
                "chain": self.chain,
                "event": "pending_tx",
                "tx_hash": tx_hash,
            })


class ChainScannerManager:
    def __init__(self):
        self.listeners: dict[str, ChainWebSocketListener] = {}
        self.tasks: list[asyncio.Task] = []

    async def start_all(self):
        for chain, ws_url in CHAIN_WS_URLS.items():
            if ws_url:
                listener = ChainWebSocketListener(chain, ws_url)
                self.listeners[chain] = listener
                task = asyncio.create_task(listener.start())
                self.tasks.append(task)
                logger.info(f"[ChainScanner] Started listener for {chain}")

    async def stop_all(self):
        for listener in self.listeners.values():
            await listener.stop()
        for task in self.tasks:
            task.cancel()
        logger.info("[ChainScanner] All listeners stopped")


chain_scanner_manager = ChainScannerManager()
