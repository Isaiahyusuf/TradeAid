import asyncio
import json
from collections import defaultdict
from typing import Dict, Set
from fastapi import WebSocket, WebSocketDisconnect
from app.utils.logging_config import logger
from app.utils.redis_client import get_redis


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = defaultdict(set)
        self._subscriber_task = None
        self._reconnect_attempts = 0

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        bucket = str(user_id or "").strip() or "anonymous"
        self.active_connections[bucket].add(websocket)
        total = sum(len(connections) for connections in self.active_connections.values())
        logger.info(f"[WS] Client connected user={bucket}. Total: {total}")

    def disconnect(self, websocket: WebSocket):
        for bucket, connections in list(self.active_connections.items()):
            if websocket in connections:
                connections.discard(websocket)
                if not connections:
                    self.active_connections.pop(bucket, None)
                break
        total = sum(len(connections) for connections in self.active_connections.values())
        logger.info(f"[WS] Client disconnected. Total: {total}")

    async def broadcast(self, message: dict, user_ids: Set[str] | None = None):
        if not self.active_connections:
            return

        targets = {
            str(uid or "").strip()
            for uid in (user_ids or set())
            if str(uid or "").strip()
        }
        if not targets:
            # For isolation safety, do not broadcast globally without explicit user target.
            return

        data = json.dumps(message, default=str)
        disconnected: Set[WebSocket] = set()

        for target in targets:
            for connection in self.active_connections.get(target, set()).copy():
                try:
                    await connection.send_text(data)
                except Exception:
                    disconnected.add(connection)

        for conn in disconnected:
            self.disconnect(conn)

    async def send_to_client(self, websocket: WebSocket, message: dict):
        try:
            await websocket.send_json(message)
        except Exception:
            self.disconnect(websocket)

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
            self._reconnect_attempts = 0
            logger.info("[WS] Redis subscriber started")

            async for message in pubsub.listen():
                if message["type"] == "message":
                    if not self.active_connections:
                        continue
                    try:
                        data = json.loads(message["data"])
                        data["channel"] = message["channel"]
                        target_user = str(
                            data.get("user_id")
                            or data.get("target_user_id")
                            or ""
                        ).strip()
                        if target_user:
                            await self.broadcast(data, user_ids={target_user})
                    except json.JSONDecodeError:
                        pass
        except Exception as e:
            logger.error(f"[WS] Redis subscriber error: {e}")
            self._reconnect_attempts = min(self._reconnect_attempts + 1, 8)
            backoff_seconds = min(5 * (2 ** (self._reconnect_attempts - 1)), 60)
            await asyncio.sleep(backoff_seconds)
            asyncio.create_task(self._subscribe_redis())

    async def stop(self):
        if self._subscriber_task:
            self._subscriber_task.cancel()
        for connections in list(self.active_connections.values()):
            for conn in list(connections):
                try:
                    await conn.close()
                except Exception:
                    pass
        self.active_connections = defaultdict(set)


ws_manager = ConnectionManager()
