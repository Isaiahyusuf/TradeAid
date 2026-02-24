import asyncio
import json
from typing import Set
from fastapi import WebSocket, WebSocketDisconnect
from app.utils.logging_config import logger
from app.utils.redis_client import get_redis


class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self._subscriber_task = None

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info(f"[WS] Client connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        logger.info(f"[WS] Client disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        if not self.active_connections:
            return

        data = json.dumps(message, default=str)
        disconnected = set()

        for connection in self.active_connections.copy():
            try:
                await connection.send_text(data)
            except Exception:
                disconnected.add(connection)

        for conn in disconnected:
            self.active_connections.discard(conn)

    async def send_to_client(self, websocket: WebSocket, message: dict):
        try:
            await websocket.send_json(message)
        except Exception:
            self.active_connections.discard(websocket)

    async def start_redis_subscriber(self):
        self._subscriber_task = asyncio.create_task(self._subscribe_redis())

    async def _subscribe_redis(self):
        try:
            redis = await get_redis()
            if redis is None:
                logger.warning("[WS] Redis unavailable; pubsub stream disabled")
                return
            pubsub = redis.pubsub()
            await pubsub.subscribe("alerts", "chain_events", "scores")
            logger.info("[WS] Redis subscriber started")

            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        data = json.loads(message["data"])
                        data["channel"] = message["channel"]
                        await self.broadcast(data)
                    except json.JSONDecodeError:
                        pass
        except Exception as e:
            logger.error(f"[WS] Redis subscriber error: {e}")
            await asyncio.sleep(5)
            asyncio.create_task(self._subscribe_redis())

    async def stop(self):
        if self._subscriber_task:
            self._subscriber_task.cancel()
        for conn in self.active_connections.copy():
            try:
                await conn.close()
            except Exception:
                pass
        self.active_connections.clear()


ws_manager = ConnectionManager()
