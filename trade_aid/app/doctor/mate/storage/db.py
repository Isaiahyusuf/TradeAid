from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


class TradeJournalDB:
    def __init__(self, db_path: str = "trade_aid/logs/mate_journal.db") -> None:
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._ensure()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path)

    def _ensure(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS trades (
                    trade_id TEXT PRIMARY KEY,
                    symbol TEXT,
                    agent TEXT,
                    side TEXT,
                    entry_price REAL,
                    exit_price REAL,
                    size REAL,
                    opened_at TEXT,
                    closed_at TEXT,
                    pnl REAL,
                    hold_seconds REAL,
                    decision_factors TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS decisions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT,
                    symbol TEXT,
                    regime TEXT,
                    best_agent TEXT,
                    confidence REAL,
                    factors TEXT
                )
                """
            )

    def log_trade(self, row: dict[str, Any]) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO trades (
                    trade_id, symbol, agent, side, entry_price, exit_price, size,
                    opened_at, closed_at, pnl, hold_seconds, decision_factors
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row.get("trade_id"),
                    row.get("symbol"),
                    row.get("agent"),
                    row.get("side"),
                    row.get("entry_price"),
                    row.get("exit_price"),
                    row.get("size"),
                    row.get("opened_at"),
                    row.get("closed_at"),
                    row.get("pnl"),
                    row.get("hold_seconds"),
                    json.dumps(row.get("decision_factors") or {}, default=str),
                ),
            )

    def log_decision(self, row: dict[str, Any]) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO decisions (created_at, symbol, regime, best_agent, confidence, factors)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    row.get("created_at"),
                    row.get("symbol"),
                    row.get("regime"),
                    row.get("best_agent"),
                    row.get("confidence"),
                    json.dumps(row.get("factors") or {}, default=str),
                ),
            )
