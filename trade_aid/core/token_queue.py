from __future__ import annotations

from queue import Queue
from typing import Any, Dict

TokenPayload = Dict[str, Any]

token_queue: Queue[TokenPayload] = Queue()


def send_to_tradeaid(token: TokenPayload) -> None:
    """Push a detected token candidate into the shared ingestion queue."""
    token_queue.put(token)
