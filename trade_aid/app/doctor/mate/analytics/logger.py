from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any


class StructuredLogger:
    def __init__(self, name: str = "doctortrade.mate") -> None:
        self.log = logging.getLogger(name)

    def event(self, event_type: str, payload: dict[str, Any]) -> None:
        row = {
            "ts": datetime.utcnow().isoformat(),
            "event": event_type,
            "payload": payload,
        }
        self.log.info(json.dumps(row, default=str))
