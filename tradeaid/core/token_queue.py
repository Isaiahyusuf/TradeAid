from queue import Queue
from typing import Any, Dict

# Shared queue consumed by the AI scanner.
token_queue: "Queue[Dict[str, Any]]" = Queue()


def enqueue_token(token: Dict[str, Any]) -> None:
    """All listeners call this function to add tokens to the scanner queue."""
    token_queue.put(token)
