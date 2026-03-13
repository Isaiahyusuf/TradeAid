from __future__ import annotations

import json
import os
import threading
from pathlib import Path


class PersistentDedupStore:
    """Thread-safe dedup store persisted to disk for restart-safe ingestion."""

    def __init__(self, file_path: str | None = None) -> None:
        configured = file_path or os.getenv("TRADEAID_DEDUP_FILE") or "./.tradeaid_seen.json"
        self._path = Path(configured).resolve()
        self._lock = threading.Lock()
        self._seen: set[str] = set()
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
            rows = payload if isinstance(payload, list) else payload.get("seen", []) if isinstance(payload, dict) else []
            self._seen = {str(row).strip() for row in rows if str(row).strip()}
        except Exception:
            self._seen = set()

    def _flush(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps({"seen": sorted(self._seen)}), encoding="utf-8")

    def mark_if_new(self, key: str) -> bool:
        normalized = str(key or "").strip()
        if not normalized:
            return False
        with self._lock:
            if normalized in self._seen:
                return False
            self._seen.add(normalized)
            self._flush()
            return True


dedup_store = PersistentDedupStore()
