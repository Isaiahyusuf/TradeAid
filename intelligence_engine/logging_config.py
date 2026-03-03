"""Structured logging configuration for intelligence_engine."""
import logging
import json
from typing import Any, Dict


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data: Dict[str, Any] = {
            "ts": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "module": record.module,
            "message": record.getMessage(),
        }
        if record.__dict__.get("extra"):
            data.update(record.__dict__["extra"])
        if record.exc_info:
            data["exc_text"] = self.formatException(record.exc_info)
        return json.dumps(data)


def configure_logging(level: int = logging.INFO) -> logging.Logger:
    logger = logging.getLogger("intelligence_engine")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JSONFormatter())
        logger.addHandler(handler)
    logger.setLevel(level)
    return logger


logger = configure_logging()
