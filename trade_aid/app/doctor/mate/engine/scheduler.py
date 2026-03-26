from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable


class EngineScheduler:
    def __init__(self, interval_seconds: float = 3.0) -> None:
        self.interval_seconds = max(0.5, float(interval_seconds))
        self._running = False

    async def run(self, tick: Callable[[], Awaitable[None]]) -> None:
        self._running = True
        while self._running:
            await tick()
            await asyncio.sleep(self.interval_seconds)

    def stop(self) -> None:
        self._running = False
