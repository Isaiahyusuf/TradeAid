from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from app.config import get_settings
from app.doctor.doctor_ai_meme_engine import DoctorAIMemeEngine
from app.doctor.doctor_execution_engine import DoctorExecutionEngine
from app.doctor.doctor_multi_source_scanner import DoctorMultiSourceScanner
from app.doctor.doctor_meme_risk import DoctorMemeRiskGovernor, DoctorRiskState
from app.doctor.safety_systems import DoctorSafetySystems
from app.doctor.doctor_solana_wallet import DoctorSolanaWallet
from app.doctor.storage import doctor_db_session
from app.models.models import DoctorEventLog, DoctorPerformanceSnapshot, DoctorTradeLog


class DoctorTradeController:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.scanner = DoctorMultiSourceScanner()
        self.ai = DoctorAIMemeEngine()
        self.risk = DoctorMemeRiskGovernor()
        self.risk_state = DoctorRiskState()
        self.enabled = False
        self.loop_task: asyncio.Task | None = None
        self.scan_interval_seconds = 20
        self.current_tokens: list[dict[str, Any]] = []
        self.positions: list[dict[str, Any]] = []
        self.trade_log: list[dict[str, Any]] = []
        self.performance_log: list[dict[str, Any]] = []
        self.last_tuning_suggestion: str | None = None
        self.high_watermark_usd: float = float(self.risk_state.equity_usd)
        self.strategy_mode: str = "trending"
        self.kill_switch = False
        self.last_run_at: str | None = None
        self.last_error: str | None = None
        self.self_evolution: dict[str, Any] = {"cycles": 0, "last_updated_at": None}

        self.safety_systems = DoctorSafetySystems(
            api_error_threshold=int(getattr(self.settings, "DOCTOR_API_ERROR_PAUSE_THRESHOLD", 3) or 3),
            liquidity_drop_exit_pct=30.0,
        )

        doctor_pk = (self.settings.DOCTOR_SOLANA_PRIVATE_KEY if hasattr(self.settings, "DOCTOR_SOLANA_PRIVATE_KEY") else "") or ""
        doctor_wallet = (self.settings.DOCTOR_SOLANA_WALLET_ADDRESS if hasattr(self.settings, "DOCTOR_SOLANA_WALLET_ADDRESS") else "") or ""
        self.wallet = DoctorSolanaWallet(
            rpc_url=self.settings.SOLANA_RPC_URL,
            private_key=doctor_pk,
            public_address=doctor_wallet,
            max_slippage_pct=float(getattr(self.settings, "DOCTOR_MAX_SLIPPAGE_PCT", 2.0) or 2.0),
        )
        self.execution = DoctorExecutionEngine(self.wallet, mode=str(getattr(self.settings, "DOCTOR_EXECUTION_MODE", "paper") or "paper"))

    async def _log_event(self, event_type: str, severity: str, message: str, *, contract_address: str | None = None, extra: dict[str, Any] | None = None) -> None:
        async with doctor_db_session() as db:
            db.add(
                DoctorEventLog(
                    event_type=event_type,
                    severity=severity,
                    message=message,
                    contract_address=contract_address,
                    strategy_mode=self.strategy_mode,
                    extra_data=extra or {},
                )
            )

    async def _log_trade(self, row: dict[str, Any]) -> None:
        async with doctor_db_session() as db:
            db.add(
                DoctorTradeLog(
                    symbol=row.get("token"),
                    contract_address=str(row.get("address") or ""),
                    chain="solana",
                    action=str(row.get("action") or "HOLD"),
                    status=str(row.get("status") or "unknown"),
                    strategy_mode=str(row.get("strategy_mode") or self.strategy_mode),
                    entry_price=float(row.get("entry_price") or 0.0) if row.get("entry_price") is not None else None,
                    current_price=float(row.get("current_price") or 0.0) if row.get("current_price") is not None else None,
                    liquidity_usd=float(row.get("liquidity") or 0.0) if row.get("liquidity") is not None else None,
                    volume_5m=float(row.get("volume_5m") or 0.0) if row.get("volume_5m") is not None else None,
                    confidence=int(row.get("confidence") or 0) if row.get("confidence") is not None else None,
                    position_size_pct=float(row.get("size_pct") or 0.0) if row.get("size_pct") is not None else None,
                    pnl_usd=float(row.get("pnl_usd") or 0.0),
                    reason=row.get("reason"),
                    tx_signature=row.get("signature"),
                    extra_data=row,
                )
            )

    async def _log_performance_snapshot(self, degraded: bool, latest_win_rate: float, previous_win_rate: float) -> None:
        async with doctor_db_session() as db:
            db.add(
                DoctorPerformanceSnapshot(
                    trades_evaluated=len([row for row in self.trade_log if row.get("status") == "executed"]),
                    win_rate=float(latest_win_rate),
                    previous_win_rate=float(previous_win_rate),
                    drawdown_pct=float(self.risk_state.total_loss_pct or 0.0),
                    daily_pnl_usd=float(self.risk_state.daily_realized_pnl_usd or 0.0),
                    high_watermark_usd=float(self.high_watermark_usd),
                    degraded=bool(degraded),
                    tuning_suggestion=self.last_tuning_suggestion,
                )
            )

    async def start(self) -> None:
        if self.loop_task and not self.loop_task.done():
            return
        self.enabled = True
        self.kill_switch = False
        self.loop_task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self.enabled = False
        if self.loop_task and not self.loop_task.done():
            self.loop_task.cancel()
        self.loop_task = None

    async def _loop(self) -> None:
        while self.enabled and not self.kill_switch:
            try:
                await self.run_once()
                self.safety_systems.register_api_success()
            except Exception as exc:
                self.last_error = str(exc)
                state = self.safety_systems.register_api_error()
                if state.get("paused"):
                    self.kill_switch = True
                    self.enabled = False
                    self.risk.emergency_pause(self.risk_state, str(state.get("pause_reason") or "api_errors_exceeded"))
                    await self._log_event("api_fail_pause", "high", "DoctorTrade paused due to repeated API failures")
            await asyncio.sleep(self.scan_interval_seconds)

    def _safety_checks(self, token: dict[str, Any]) -> dict[str, Any]:
        liquidity_drop = float(token.get("liquidity_drop_pct") or 0.0)
        holder_dump = float(token.get("holder_dump_pct") or 0.0)
        slippage = float(token.get("estimated_slippage_pct") or 1.0)
        suspicious_contract = bool(token.get("suspicious_contract", False))
        honeypot_risk = bool(token.get("honeypot_risk", False))

        if liquidity_drop >= 30.0:
            return {"triggered": True, "reason": "liquidity_drop_30pct"}
        if holder_dump >= 20.0:
            return {"triggered": True, "reason": "holder_dump_detected"}
        if slippage >= float(getattr(self.settings, "DOCTOR_VOLATILITY_SPIKE_THRESHOLD", 6.0) or 6.0):
            return {"triggered": True, "reason": "slippage_spike"}
        if suspicious_contract:
            return {"triggered": True, "reason": "suspicious_contract_flags"}
        if honeypot_risk:
            return {"triggered": True, "reason": "honeypot_risk"}
        return {"triggered": False}

    async def run_once(self) -> dict[str, Any]:
        if not self.enabled or self.kill_switch:
            return {"executed": False, "reason": "disabled"}

        memes = await self.scanner.scan_all_sources(limit=18)
        self.current_tokens = memes
        actions: list[dict[str, Any]] = []
        self.self_evolution["cycles"] = int(self.self_evolution.get("cycles") or 0) + 1
        self.self_evolution["last_updated_at"] = datetime.utcnow().isoformat()

        for token in memes:
            self.strategy_mode = str(token.get("strategy_mode") or "trending")
            safety = self._safety_checks(token)
            safety_system = self.safety_systems.monitor_token(token)
            if safety_system.get("triggered"):
                safety = {"triggered": True, "reason": safety_system.get("reason")}

            if safety.get("triggered"):
                for position in list(self.positions):
                    emergency_row = {
                        "token": position.get("symbol"),
                        "address": position.get("address"),
                        "action": "SELL",
                        "status": "emergency_exit",
                        "reason": safety.get("reason"),
                        "timestamp": datetime.utcnow().isoformat(),
                        "strategy_mode": self.strategy_mode,
                    }
                    self.trade_log.insert(
                        0,
                        emergency_row,
                    )
                    await self._log_trade(emergency_row)
                    self.risk.register_close(self.risk_state, pnl_usd=0.0, released_exposure_pct=float(position.get("size_pct") or 0.0))
                self.positions = []
                self.risk.emergency_pause(self.risk_state, str(safety.get("reason") or "safety_triggered"))
                self.kill_switch = True
                await self._log_event("safety_pause", "high", "DoctorTrade paused by anti-rug safety", extra={"reason": safety.get("reason")})
                break

            signal = self.ai.generate(token, current_drawdown_pct=float(self.risk_state.total_loss_pct or 0.0))
            risk_result = self.risk.validate(signal, self.risk_state)

            if not risk_result.get("approved"):
                actions.append({
                    "token": token.get("symbol"),
                    "address": token.get("address"),
                    "action": signal.get("action"),
                    "status": "blocked",
                    "reason": risk_result.get("reason"),
                })
                continue

            if signal.get("action") != "BUY":
                continue

            execution = await self.execution.execute(token, signal, float(risk_result.get("position_size_pct") or 0.0))
            if not execution.get("executed"):
                rejected = {
                    "token": token.get("symbol"),
                    "address": token.get("address"),
                    "action": signal.get("action"),
                    "status": "rejected",
                    "reason": execution.get("reason"),
                    "strategy_mode": self.strategy_mode,
                }
                actions.append(rejected)
                await self._log_trade(rejected)
                continue

            position = {
                "symbol": token.get("symbol"),
                "address": token.get("address"),
                "entry_price": float(signal.get("entry_price") or 0.0),
                "current_price": float(token.get("price_usd") or 0.0),
                "liquidity": float(token.get("liquidity") or 0.0),
                "confidence": int(signal.get("confidence") or 0),
                "size_pct": float(risk_result.get("position_size_pct") or 0.0),
                "stop_loss": float(signal.get("stop_loss") or 0.0),
                "take_profit": float(signal.get("take_profit") or 0.0),
                "opened_at": datetime.utcnow().isoformat(),
                "signature": execution.get("signature"),
                "risk_status": "active",
                "strategy_mode": self.strategy_mode,
            }
            self.positions.append(position)
            self.positions = self.positions[:2]
            self.risk.register_open(self.risk_state, float(position["size_pct"]))

            trade_row = {
                "token": token.get("symbol"),
                "address": token.get("address"),
                "action": "BUY",
                "status": "executed",
                "confidence": int(signal.get("confidence") or 0),
                "liquidity": float(token.get("liquidity") or 0.0),
                "volume_5m": float(token.get("volume_5m") or 0.0),
                "entry_price": float(signal.get("entry_price") or 0.0),
                "current_price": float(token.get("price_usd") or 0.0),
                "size_pct": float(risk_result.get("position_size_pct") or 0.0),
                "strategy_mode": self.strategy_mode,
                "timestamp": datetime.utcnow().isoformat(),
                "signature": execution.get("signature"),
            }
            self.trade_log.insert(0, trade_row)
            self.trade_log = self.trade_log[:200]
            actions.append(trade_row)
            await self._log_trade(trade_row)

            self.high_watermark_usd = max(self.high_watermark_usd, float(self.risk_state.equity_usd or 0.0))

        executed_trades = [row for row in self.trade_log if row.get("status") == "executed"]
        if executed_trades and len(executed_trades) % 50 == 0:
            latest_50 = executed_trades[:50]
            previous_50 = executed_trades[50:100]
            latest_win_rate = len([row for row in latest_50 if float(row.get("pnl_usd") or 0.0) > 0]) / max(len(latest_50), 1)
            previous_win_rate = len([row for row in previous_50 if float(row.get("pnl_usd") or 0.0) > 0]) / max(len(previous_50), 1) if previous_50 else latest_win_rate
            degraded = (previous_win_rate - latest_win_rate) >= 0.10
            self.performance_log.insert(
                0,
                {
                    "timestamp": datetime.utcnow().isoformat(),
                    "trades_evaluated": len(executed_trades),
                    "latest_win_rate": round(latest_win_rate, 4),
                    "previous_win_rate": round(previous_win_rate, 4),
                    "degraded": degraded,
                },
            )
            if degraded:
                self.last_tuning_suggestion = "Win-rate degradation detected: tighten entries and reduce position sizing by 10%."
            await self._log_performance_snapshot(degraded, latest_win_rate, previous_win_rate)

        self.last_run_at = datetime.utcnow().isoformat()
        return {
            "executed": True,
            "actions": actions,
            "tokens": memes,
            "positions": self.positions,
        }

    async def status(self) -> dict[str, Any]:
        balance_sol = 0.0
        if self.wallet.public_address:
            try:
                balance_sol = await self.wallet.get_balance_sol()
            except Exception:
                balance_sol = 0.0

        return {
            "enabled": self.enabled,
            "kill_switch": self.kill_switch,
            "last_run_at": self.last_run_at,
            "last_error": self.last_error,
            "scanner_health": self.scanner.get_source_health() if hasattr(self.scanner, "get_source_health") else {},
            "risk_state": {
                "drawdown_pct": round(float(self.risk_state.total_loss_pct or 0.0), 4),
                "daily_realized_pnl_usd": round(float(self.risk_state.daily_realized_pnl_usd or 0.0), 4),
                "high_watermark_usd": round(float(self.high_watermark_usd or 0.0), 4),
                "open_positions": int(self.risk_state.open_positions),
                "open_exposure_pct": round(float(self.risk_state.open_exposure_pct or 0.0), 4),
                "consecutive_losses": int(self.risk_state.consecutive_losses),
                "paused": bool(self.risk_state.paused),
                "permanent_lock": bool(self.risk_state.permanent_lock),
                "pause_reason": self.risk_state.pause_reason,
            },
            "wallet": {
                "address": self.wallet.public_address,
                "balance_sol": balance_sol,
                "separate_wallet_enforced": True,
            },
            "active_tokens": self.current_tokens,
            "positions": self.positions,
            "recent_trades": self.trade_log[:30],
            "performance": self.performance_log[:10],
            "tuning_suggestion": self.last_tuning_suggestion,
            "strategy_mode": self.strategy_mode,
            "safety": self.safety_systems.monitor(),
            "self_evolution": self.self_evolution,
        }


doctor_controller = DoctorTradeController()
