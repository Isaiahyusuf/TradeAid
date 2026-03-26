from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from app.config import get_settings
from app.doctor.doctor_ai_meme_engine import DoctorAIMemeEngine
from app.doctor.doctor_execution_engine import DoctorExecutionEngine
from app.doctor.doctor_multi_source_scanner import DoctorMultiSourceScanner
from app.doctor.doctor_meme_risk import DoctorMemeRiskGovernor, DoctorRiskState
from app.doctor.mate import MATEngine
from app.doctor.safety_systems import DoctorSafetySystems
from app.doctor.doctor_solana_wallet import DoctorSolanaWallet
from app.doctor.storage import doctor_db_session
from app.models.models import DoctorEventLog, DoctorPerformanceSnapshot, DoctorTradeLog
from app.utils.solana_rpc import solana_rpc_endpoints


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
        self.sniper_mode_only = True
        self.max_trades_per_day = 12
        self.min_buy_amount_sol = 0.1
        self.buy_amount_sol = 0.1
        self.take_profit_multiplier = 1.18
        self.min_profit_pct = 3.5
        self.stop_loss_pct = 6.0
        self.trailing_stop_pct = 4.0
        self.min_liquidity_usd = 5000.0
        self.max_slippage_pct = 8.0
        self.max_spread_pct = 7.0
        self.daily_loss_limit_usd = 600.0
        self.max_consecutive_losses = 3
        self.strong_move_threshold_pct = 15.0
        self.max_hold_minutes = 25
        self.min_momentum_profit_pct = 1.0
        self.quality_min_volume_spike_pct = 0.0
        self.quality_max_top_holder_pct = 65.0
        self.early_entry_exit_mode = True
        self.fast_take_profit_pct = 5.5
        self._trade_day: str = ""
        self._trades_today: int = 0
        self.current_tokens: list[dict[str, Any]] = []
        self.positions: list[dict[str, Any]] = []
        self.trade_log: list[dict[str, Any]] = []
        self.performance_log: list[dict[str, Any]] = []
        self.last_tuning_suggestion: str | None = None
        self.decision_journal: list[dict[str, Any]] = []
        self.high_watermark_usd: float = float(self.risk_state.equity_usd)
        self.strategy_mode: str = "trending"
        self.kill_switch = False
        self.last_run_at: str | None = None
        self.last_error: str | None = None
        self.self_evolution: dict[str, Any] = {"cycles": 0, "last_updated_at": None}
        self._last_balance_sol: float = 0.0
        self._last_balance_checked_ts: float = 0.0
        self.owner_user_id: str | None = None

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
            rpc_urls=solana_rpc_endpoints(self.settings),
        )
        self.execution = DoctorExecutionEngine(
            self.wallet,
            mode=str(getattr(self.settings, "DOCTOR_EXECUTION_MODE", "paper") or "paper"),
            jupiter_api_key=str(getattr(self.settings, "JUPITER_API_KEY", "") or ""),
        )
        self.mate = MATEngine(symbol="SOL/USDT")
        self.mate_last_decision: dict[str, Any] = {}
        self.mate_enabled = True

    @staticmethod
    def _token_to_mate_feed(token: dict[str, Any]) -> dict[str, float]:
        price = float(token.get("price_usd") or 0.0)
        volume = float(token.get("volume_5m") or token.get("volume_15m") or 0.0)
        buys_5m = max(0.0, float(token.get("buys_5m") or 0.0))
        sells_5m = max(0.0, float(token.get("sells_5m") or 0.0))
        buysell_total = buys_5m + sells_5m
        bid_ratio = (buys_5m / buysell_total) if buysell_total > 0 else 0.5
        bid_volume = volume * bid_ratio
        ask_volume = max(0.0, volume - bid_volume)
        spread_bps = max(1.0, float(token.get("estimated_slippage_pct") or token.get("spread_pct") or 0.5) * 100.0)
        return {
            "price": price,
            "high": max(price, price * 1.002),
            "low": min(price, price * 0.998),
            "volume": volume,
            "bid_volume": bid_volume,
            "ask_volume": ask_volume,
            "liquidity": float(token.get("liquidity") or 0.0),
            "spread_bps": spread_bps,
        }

    def _mate_signal_for_token(self, token: dict[str, Any]) -> dict[str, Any]:
        if not self.mate_enabled:
            return self.ai.generate(token, current_drawdown_pct=float(self.risk_state.total_loss_pct or 0.0))

        feed = self._token_to_mate_feed(token)
        if float(feed.get("price") or 0.0) <= 0:
            return {
                "action": "HOLD",
                "entry_price": 0.0,
                "stop_loss": 0.0,
                "take_profit": 0.0,
                "position_size_pct": 0.0,
                "confidence": 0,
                "signals": {"mate_reason": "missing_price"},
                "strategy_mode": str(self.mate_last_decision.get("best_agent") or ""),
            }

        snapshot = self.mate.stream.next_snapshot(self.mate.symbol, external=feed)
        self.mate.agg.add(snapshot)
        features = self.mate._build_features()
        context = self.mate._agent_context()
        regime = self.mate.orchestrator.detect_regime(features, context)

        signals = {name: agent.generate(features, context) for name, agent in self.mate.agents.items()}
        edge_score = {name: self.mate.performance.meta_learning_scores.get(name, 0.5) for name in self.mate.agents}
        recent_perf = {name: self.mate.performance.per_agent_stats(name).get("win_rate", 0.0) for name in self.mate.agents}
        risk_eff = {
            name: max(0.0, min(1.0, self.mate.performance.per_agent_stats(name).get("profit_factor", 0.0) / 2.0))
            for name in self.mate.agents
        }

        now = datetime.utcnow()
        decision = self.mate.orchestrator.select(
            regime=regime,
            now=now,
            current_agent=self.mate.state.state.active_agent,
            cooldown_until=self.mate.state.state.cooldown_until,
            edge_score=edge_score,
            recent_performance=recent_perf,
            risk_efficiency=risk_eff,
        )

        if decision.best_agent and decision.best_agent != self.mate.state.state.active_agent:
            self.mate.state.state.active_agent = decision.best_agent
            self.mate.state.state.last_switch_at = now
            self.mate.state.state.cooldown_until = self.mate.orchestrator.next_cooldown_until(now)

        self.mate.state.state.last_decision = {
            "best_agent": decision.best_agent,
            "confidence": decision.confidence,
            "regime": decision.regime.value,
            "scores": decision.scores,
        }
        self.mate_last_decision = dict(self.mate.state.state.last_decision)
        if decision.best_agent:
            self.strategy_mode = decision.best_agent

        selected = dict(signals.get(decision.best_agent) or {})
        side = str(selected.get("signal") or "HOLD").upper()
        confidence_01 = max(0.0, min(1.0, float(selected.get("confidence") or 0.0)))
        confidence = int(round(confidence_01 * 100.0))
        rr = max(0.0, float(selected.get("expected_rr") or 0.0))
        size_pct = max(0.1, min(4.0, (confidence_01 * 2.4) * max(0.5, min(rr, 2.0))))

        return {
            "action": side,
            "entry_price": float(selected.get("entry") or feed.get("price") or 0.0),
            "stop_loss": float(selected.get("stop_loss") or 0.0),
            "take_profit": float(selected.get("take_profit") or 0.0),
            "position_size_pct": round(size_pct, 4),
            "confidence": confidence,
            "signals": {
                "mate_agent": decision.best_agent,
                "mate_regime": decision.regime.value,
                "mate_reason": str(selected.get("reason") or ""),
                "mate_expected_rr": rr,
            },
            "strategy_mode": decision.best_agent,
        }

    async def _update_mate_state(self, tokens: list[dict[str, Any]]) -> None:
        if not self.mate_enabled or not tokens:
            return

        selected = max(
            tokens,
            key=lambda row: float(row.get("volume_5m") or 0.0) * max(1.0, float(row.get("liquidity") or 0.0)),
        )
        _ = self._mate_signal_for_token(selected)

    def configure_wallet(self, *, private_key: str, public_address: str) -> None:
        self.wallet.private_key = str(private_key or "").strip()
        self.wallet.public_address = str(public_address or "").strip()

    def set_owner_user_id(self, user_id: str | None) -> None:
        self.owner_user_id = str(user_id or "").strip() or None

    @staticmethod
    def _parse_iso_datetime(value: Any) -> datetime | None:
        raw = str(value or "").strip()
        if not raw:
            return None
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if dt.tzinfo is not None:
                return dt.astimezone(timezone.utc).replace(tzinfo=None)
            return dt
        except Exception:
            return None

    def _roll_trade_day(self) -> None:
        today = datetime.utcnow().date().isoformat()
        if self._trade_day != today:
            self._trade_day = today
            self._trades_today = 0

    def _register_trade_count(self) -> None:
        self._roll_trade_day()
        self._trades_today += 1

    def _can_open_trade(self) -> bool:
        self._roll_trade_day()
        return self._trades_today < int(max(1, self.max_trades_per_day))

    def _compute_spread_pct(self, token: dict[str, Any]) -> float:
        spread_from_feed = float(token.get("spread_pct") or 0.0)
        if spread_from_feed > 0:
            return spread_from_feed
        slippage = float(token.get("estimated_slippage_pct") or 0.0)
        liquidity = float(token.get("liquidity") or 0.0)
        volume_5m = float(token.get("volume_5m") or 0.0)
        microstructure_penalty = 0.0
        if liquidity > 0:
            microstructure_penalty = min(2.5, max(0.0, (volume_5m / max(liquidity, 1.0)) * 12.0))
        return max(0.0, slippage + microstructure_penalty)

    def _register_journal(self, row: dict[str, Any]) -> None:
        enriched = dict(row)
        enriched.setdefault("timestamp", datetime.utcnow().isoformat())
        self.decision_journal.insert(0, enriched)
        self.decision_journal = self.decision_journal[:250]

    def _quality_gate(self, token: dict[str, Any]) -> tuple[bool, str | None]:
        liquidity = float(token.get("liquidity") or 0.0)
        if liquidity < float(self.min_liquidity_usd or 0.0):
            return False, "below_min_liquidity"

        slippage_pct = float(token.get("estimated_slippage_pct") or 0.0)
        if slippage_pct > float(self.max_slippage_pct or 100.0):
            return False, "slippage_above_limit"

        spread_pct = self._compute_spread_pct(token)
        if spread_pct > float(self.max_spread_pct or 100.0):
            return False, "spread_above_limit"

        if bool(self.early_entry_exit_mode):
            return True, None

        volume_spike_pct = float(token.get("volume_spike_pct") or 0.0)
        if volume_spike_pct < float(self.quality_min_volume_spike_pct or 0.0):
            return False, "volume_spike_too_low"

        top_holder_pct = float(token.get("top_holder_pct") or 0.0)
        if top_holder_pct > float(self.quality_max_top_holder_pct or 100.0):
            return False, "holder_concentration_too_high"

        return True, None

    def _weighted_position_size_pct(self, token: dict[str, Any], signal: dict[str, Any], base_size_pct: float) -> float:
        confidence = max(1.0, min(99.0, float(signal.get("confidence") or 0.0)))
        confidence_factor = 0.6 + ((confidence / 100.0) * 0.8)
        liquidity = float(token.get("liquidity") or 0.0)
        liquidity_factor = min(1.4, max(0.5, liquidity / max(float(self.min_liquidity_usd or 1.0), 1.0)))
        spike = max(0.0, float(token.get("volume_spike_pct") or 0.0))
        momentum_factor = min(1.25, 0.75 + (spike / 120.0))
        adjusted = float(base_size_pct or 0.0) * confidence_factor * liquidity_factor * momentum_factor
        return max(0.1, min(5.0, adjusted))

    async def _process_position_exits(self, memes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        by_address = {str(row.get("address") or "").strip(): row for row in memes}
        exits: list[dict[str, Any]] = []
        remaining: list[dict[str, Any]] = []

        for position in self.positions:
            address = str(position.get("address") or "").strip()
            token = by_address.get(address)
            current_price = float((token or {}).get("price_usd") or position.get("current_price") or 0.0)
            entry_price = float(position.get("entry_price") or 0.0)
            if entry_price <= 0 or current_price <= 0:
                remaining.append(position)
                continue

            peak_price = max(float(position.get("peak_price") or entry_price), current_price)
            position["peak_price"] = peak_price
            position["current_price"] = current_price

            pnl_pct = ((current_price - entry_price) / entry_price) * 100.0
            opened_at = str(position.get("opened_at") or "").strip()
            held_minutes = 0.0
            if opened_at:
                try:
                    open_dt = datetime.fromisoformat(opened_at)
                    held_minutes = max(0.0, (datetime.utcnow() - open_dt).total_seconds() / 60.0)
                except Exception:
                    held_minutes = 0.0

            tp1_hit = pnl_pct >= 25.0 and not bool(position.get("tp1_taken", False))
            tp2_hit = pnl_pct >= 50.0 and not bool(position.get("tp2_taken", False))
            if tp1_hit or tp2_hit:
                partial_release = 20.0 if tp1_hit else 30.0
                reason = "partial_tp_25" if tp1_hit else "partial_tp_50"
                position["tp1_taken"] = bool(position.get("tp1_taken", False) or tp1_hit)
                position["tp2_taken"] = bool(position.get("tp2_taken", False) or tp2_hit)
                position["size_pct"] = max(0.05, float(position.get("size_pct") or 0.0) * (1.0 - (partial_release / 100.0)))
                partial_row = {
                    "token": position.get("symbol"),
                    "address": address,
                    "action": "SELL_PARTIAL",
                    "status": "executed",
                    "reason": reason,
                    "confidence": int(position.get("confidence") or 0),
                    "liquidity": float((token or {}).get("liquidity") or position.get("liquidity") or 0.0),
                    "volume_5m": float((token or {}).get("volume_5m") or 0.0),
                    "entry_price": entry_price,
                    "current_price": current_price,
                    "size_pct": float(position.get("size_pct") or 0.0),
                    "strategy_mode": str(position.get("strategy_mode") or self.strategy_mode),
                    "timestamp": datetime.utcnow().isoformat(),
                }
                self.trade_log.insert(0, partial_row)
                self.trade_log = self.trade_log[:200]
                await self._log_trade(partial_row)
                self.risk.register_close(self.risk_state, pnl_usd=0.0, released_exposure_pct=partial_release)
                exits.append(partial_row)

            take_profit_hit = current_price >= (entry_price * max(1.1, float(self.take_profit_multiplier or 2.0)))
            min_profit_hit = pnl_pct >= float(self.min_profit_pct or 0.0)
            quick_profit_hit = bool(self.early_entry_exit_mode) and pnl_pct >= float(self.fast_take_profit_pct or 0.0)
            stop_loss_hit = current_price <= (entry_price * (1.0 - (float(self.stop_loss_pct or 0.0) / 100.0)))
            dynamic_trailing_pct = float(self.trailing_stop_pct or 0.0)
            if pnl_pct >= float(self.strong_move_threshold_pct or 40.0):
                dynamic_trailing_pct = max(2.0, dynamic_trailing_pct * 0.5)
            trailing_stop_hit = current_price <= (peak_price * (1.0 - (dynamic_trailing_pct / 100.0))) and pnl_pct > 0
            if bool(self.early_entry_exit_mode):
                time_stop_hit = held_minutes >= float(self.max_hold_minutes or 0.0)
            else:
                time_stop_hit = held_minutes >= float(self.max_hold_minutes or 0.0) and pnl_pct < float(self.min_momentum_profit_pct or 0.0)

            exit_reason = None
            if quick_profit_hit:
                exit_reason = "quick_profit_exit"
            elif take_profit_hit:
                exit_reason = "take_profit_2x"
            elif min_profit_hit:
                exit_reason = "profit_secured"
            elif trailing_stop_hit:
                exit_reason = "trailing_stop"
            elif time_stop_hit:
                exit_reason = "time_stop_no_momentum"
            elif stop_loss_hit:
                exit_reason = "stop_loss"

            if not exit_reason:
                remaining.append(position)
                continue

            notional_usd = float(position.get("notional_usd") or ((self.risk_state.equity_usd * float(position.get("size_pct") or 0.0)) / 100.0))
            pnl_usd = (pnl_pct / 100.0) * max(notional_usd, 0.0)

            close_row = {
                "token": position.get("symbol"),
                "address": address,
                "action": "SELL",
                "status": "executed",
                "reason": exit_reason,
                "confidence": int(position.get("confidence") or 0),
                "liquidity": float((token or {}).get("liquidity") or position.get("liquidity") or 0.0),
                "volume_5m": float((token or {}).get("volume_5m") or 0.0),
                "entry_price": entry_price,
                "current_price": current_price,
                "size_pct": float(position.get("size_pct") or 0.0),
                "strategy_mode": str(position.get("strategy_mode") or self.strategy_mode),
                "timestamp": datetime.utcnow().isoformat(),
                "pnl_usd": round(pnl_usd, 4),
            }
            exits.append(close_row)
            self.trade_log.insert(0, close_row)
            self.trade_log = self.trade_log[:200]
            await self._log_trade(close_row)
            self.risk.register_close(self.risk_state, pnl_usd=float(close_row.get("pnl_usd") or 0.0), released_exposure_pct=float(position.get("size_pct") or 0.0))
            self._register_trade_count()

        self.positions = remaining
        return exits

    async def _log_event(self, event_type: str, severity: str, message: str, *, contract_address: str | None = None, extra: dict[str, Any] | None = None) -> None:
        meta = dict(extra or {})
        if self.owner_user_id and not meta.get("owner_user_id"):
            meta["owner_user_id"] = self.owner_user_id
        async with doctor_db_session() as db:
            db.add(
                DoctorEventLog(
                    event_type=event_type,
                    severity=severity,
                    message=message,
                    contract_address=contract_address,
                    strategy_mode=self.strategy_mode,
                    extra_data=meta,
                )
            )

    async def _log_trade(self, row: dict[str, Any]) -> None:
        payload = dict(row)
        if self.owner_user_id and not payload.get("owner_user_id"):
            payload["owner_user_id"] = self.owner_user_id
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
                    extra_data=payload,
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
                    tuning_suggestion=(
                        f"[{self.owner_user_id}] {self.last_tuning_suggestion}"
                        if self.owner_user_id and self.last_tuning_suggestion
                        else self.last_tuning_suggestion
                    ),
                )
            )

    def pnl_summary(self) -> dict[str, Any]:
        now = datetime.utcnow()
        closed_rows: list[dict[str, Any]] = []
        buy_rows: list[dict[str, Any]] = []
        for row in self.trade_log:
            if str(row.get("status") or "") != "executed":
                continue
            action = str(row.get("action") or "").upper()
            if action == "BUY":
                buy_rows.append(row)
            if action in {"SELL", "SELL_PARTIAL"}:
                closed_rows.append(row)

        realized_pnl_usd = float(sum(float(row.get("pnl_usd") or 0.0) for row in closed_rows))
        wins = [row for row in closed_rows if float(row.get("pnl_usd") or 0.0) > 0]
        losses = [row for row in closed_rows if float(row.get("pnl_usd") or 0.0) < 0]
        win_rate = (len(wins) / len(closed_rows) * 100.0) if closed_rows else 0.0

        unrealized_pnl_usd = 0.0
        for pos in self.positions:
            entry = float(pos.get("entry_price") or 0.0)
            current = float(pos.get("current_price") or 0.0)
            notional = float(pos.get("notional_usd") or 0.0)
            if entry > 0 and current > 0 and notional > 0:
                unrealized_pnl_usd += ((current - entry) / entry) * notional

        def summarize_window(hours: int) -> dict[str, Any]:
            threshold = now - timedelta(hours=hours)
            rows = [
                row
                for row in closed_rows
                if (self._parse_iso_datetime(row.get("timestamp")) or datetime.min) >= threshold
            ]
            window_wins = len([row for row in rows if float(row.get("pnl_usd") or 0.0) > 0])
            total = len(rows)
            avg = (sum(float(row.get("pnl_usd") or 0.0) for row in rows) / total) if total else 0.0
            return {
                "trades": total,
                "win_rate_pct": round((window_wins / total * 100.0), 2) if total else 0.0,
                "avg_pnl_usd": round(float(avg), 4),
            }

        wallet_connected = bool(str(self.wallet.public_address or "").strip() and str(self.wallet.private_key or "").strip())
        blockers: list[str] = []
        if not wallet_connected:
            blockers.append("wallet_not_connected")
        if self.kill_switch:
            blockers.append("kill_switch_enabled")
        if bool(self.risk_state.paused):
            blockers.append(str(self.risk_state.pause_reason or "risk_paused"))
        if not self.enabled:
            blockers.append("doctortrade_not_enabled")

        return {
            "owner_user_id": self.owner_user_id,
            "realized_pnl_usd": round(realized_pnl_usd, 4),
            "unrealized_pnl_usd": round(float(unrealized_pnl_usd), 4),
            "net_pnl_usd": round(realized_pnl_usd + float(unrealized_pnl_usd), 4),
            "total_buys": len(buy_rows),
            "total_closed": len(closed_rows),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate_pct": round(win_rate, 2),
            "open_positions": len(self.positions),
            "rolling": {
                "24h": summarize_window(24),
                "72h": summarize_window(72),
                "7d": summarize_window(24 * 7),
                "30d": summarize_window(24 * 30),
            },
            "sniping": {
                "wallet_connected": wallet_connected,
                "enabled": bool(self.enabled),
                "kill_switch": bool(self.kill_switch),
                "risk_paused": bool(self.risk_state.paused),
                "can_snipe_now": len(blockers) == 0,
                "blockers": blockers,
            },
        }

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

    async def execute_direct_buy(self, contract_address: str, *, chain: str = "solana") -> dict[str, Any]:
        normalized_chain = str(chain or "").strip().lower()
        if normalized_chain != "solana":
            return {"executed": False, "reason": "automatic_buy_only_supported_for_solana"}

        target_address = str(contract_address or "").strip()
        if not target_address:
            return {"executed": False, "reason": "contract_address_required"}

        if not bool(str(self.wallet.public_address or "").strip() and str(self.wallet.private_key or "").strip()):
            return {"executed": False, "reason": "wallet_not_connected"}

        if self.kill_switch or bool(self.risk_state.paused):
            return {"executed": False, "reason": "doctortrade_paused"}

        configured_buy_sol = max(float(self.min_buy_amount_sol or 0.1), float(self.buy_amount_sol or 0.1))
        self.buy_amount_sol = configured_buy_sol

        memes = await self.scanner.scan_all_sources(limit=40)
        self.current_tokens = memes
        token = next((row for row in memes if str(row.get("address") or "").strip().lower() == target_address.lower()), None)
        if not token:
            return {"executed": False, "reason": "token_not_in_fresh_feed"}

        self.strategy_mode = str(self.mate_last_decision.get("best_agent") or token.get("strategy_mode") or "trending")

        safety = self._safety_checks(token)
        if safety.get("triggered"):
            return {"executed": False, "reason": str(safety.get("reason") or "safety_triggered")}

        quality_ok, quality_reason = self._quality_gate(token)
        if not quality_ok:
            return {"executed": False, "reason": str(quality_reason or "quality_gate_blocked")}

        signal = self._mate_signal_for_token(token)
        signal["action"] = "BUY"
        signal["entry_price"] = float(signal.get("entry_price") or token.get("price_usd") or 0.0)
        signal["confidence"] = max(int(signal.get("confidence") or 0), 70)

        risk_result = self.risk.validate(signal, self.risk_state)
        if not risk_result.get("approved"):
            return {"executed": False, "reason": str(risk_result.get("reason") or "risk_blocked")}

        weighted_size_pct = self._weighted_position_size_pct(
            token,
            signal,
            float(risk_result.get("position_size_pct") or 0.0),
        )
        risk_result["position_size_pct"] = weighted_size_pct

        if not self._can_open_trade():
            return {"executed": False, "reason": "max_trades_24h_reached"}

        try:
            balance_sol = await self.wallet.get_balance_sol()
        except Exception:
            balance_sol = 0.0
        if balance_sol < configured_buy_sol:
            return {"executed": False, "reason": f"insufficient_sol_balance_min_{configured_buy_sol:.3f}"}

        execution = await self.execution.execute(
            token,
            signal,
            float(risk_result.get("position_size_pct") or 0.0),
            buy_amount_sol=configured_buy_sol,
        )
        if not execution.get("executed"):
            return {"executed": False, "reason": str(execution.get("reason") or "execution_failed")}

        position = {
            "symbol": token.get("symbol"),
            "address": token.get("address"),
            "entry_price": float(signal.get("entry_price") or 0.0),
            "current_price": float(token.get("price_usd") or 0.0),
            "liquidity": float(token.get("liquidity") or 0.0),
            "confidence": int(signal.get("confidence") or 0),
            "size_pct": float(risk_result.get("position_size_pct") or 0.0),
            "stop_loss": round(float(signal.get("entry_price") or token.get("price_usd") or 0.0) * (1.0 - (float(self.stop_loss_pct) / 100.0)), 8),
            "take_profit": round(float(signal.get("entry_price") or token.get("price_usd") or 0.0) * float(self.take_profit_multiplier), 8),
            "trailing_stop_pct": float(self.trailing_stop_pct),
            "opened_at": datetime.utcnow().isoformat(),
            "signature": execution.get("signature"),
            "risk_status": "active",
            "strategy_mode": self.strategy_mode,
            "peak_price": float(token.get("price_usd") or signal.get("entry_price") or 0.0),
            "notional_usd": float(self.risk_state.equity_usd * (float(risk_result.get("position_size_pct") or 0.0) / 100.0)),
        }
        self.positions.append(position)
        self.positions = self.positions[: int(getattr(self.risk, "MAX_OPEN_POSITIONS", 3) or 3)]
        self.risk.register_open(self.risk_state, float(position["size_pct"]))
        self._register_trade_count()

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
        await self._log_trade(trade_row)
        self._register_journal({
            "token": token.get("symbol"),
            "address": token.get("address"),
            "decision": "BUY",
            "reason": "direct_buy_executed",
            "confidence": int(signal.get("confidence") or 0),
            "size_pct": float(risk_result.get("position_size_pct") or 0.0),
            "strategy_mode": self.strategy_mode,
        })

        self.last_run_at = datetime.utcnow().isoformat()
        return {
            "executed": True,
            "mode": str(execution.get("mode") or self.execution.mode),
            "reason": "direct_buy_executed",
            "token": {
                "symbol": token.get("symbol"),
                "address": token.get("address"),
            },
            "signature": execution.get("signature"),
            "buy_amount_sol": configured_buy_sol,
        }

    async def run_once(self) -> dict[str, Any]:
        if not self.enabled or self.kill_switch:
            return {"executed": False, "reason": "disabled"}

        if float(self.risk_state.daily_realized_pnl_usd or 0.0) <= -abs(float(self.daily_loss_limit_usd or 0.0)):
            self.risk_state.paused = True
            self.risk_state.pause_reason = "daily_loss_limit_reached"
            return {"executed": False, "reason": "daily_loss_limit_reached"}
        if int(self.risk_state.consecutive_losses or 0) >= int(max(1, self.max_consecutive_losses)):
            self.risk_state.paused = True
            self.risk_state.pause_reason = "max_consecutive_losses_reached"
            self.risk_state.cooldown_until = (datetime.utcnow() + timedelta(minutes=45)).isoformat()
            return {"executed": False, "reason": "max_consecutive_losses_reached"}

        configured_buy_sol = max(float(self.min_buy_amount_sol or 0.1), float(self.buy_amount_sol or 0.1))
        self.buy_amount_sol = configured_buy_sol

        memes = await self.scanner.scan_all_sources(limit=18)
        try:
            await self._update_mate_state(memes)
        except Exception:
            pass
        intelligence_rows = self.scanner.drain_recent_intelligence() if hasattr(self.scanner, "drain_recent_intelligence") else []
        for row in intelligence_rows[:60]:
            await self._log_event(
                "fresh_token_intelligence",
                "info" if str(row.get("decision") or "") == "APPROVED" else "warning",
                f"{row.get('symbol') or row.get('mint')}: {row.get('decision')}",
                contract_address=str(row.get("mint") or row.get("address") or "") or None,
                extra=row,
            )
        self.current_tokens = memes
        actions: list[dict[str, Any]] = []
        exit_actions = await self._process_position_exits(memes)
        if exit_actions:
            actions.extend(exit_actions)
        self.self_evolution["cycles"] = int(self.self_evolution.get("cycles") or 0) + 1
        self.self_evolution["last_updated_at"] = datetime.utcnow().isoformat()

        for token in memes:
            if not str(self.mate_last_decision.get("best_agent") or "").strip():
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

            signal = self._mate_signal_for_token(token)
            active_agent = str(self.mate_last_decision.get("best_agent") or "").strip()
            if bool(self.sniper_mode_only) and active_agent and active_agent != "flow_agent":
                self._register_journal({
                    "token": token.get("symbol"),
                    "address": token.get("address"),
                    "decision": "SKIP",
                    "reason": "sniper_mode_requires_flow_agent",
                    "strategy_mode": active_agent,
                })
                continue

            quality_ok, quality_reason = self._quality_gate(token)
            if not quality_ok:
                blocked_row = {
                    "token": token.get("symbol"),
                    "address": token.get("address"),
                    "action": signal.get("action"),
                    "status": "blocked",
                    "reason": quality_reason,
                    "strategy_mode": self.strategy_mode,
                }
                actions.append(blocked_row)
                self._register_journal({
                    "token": token.get("symbol"),
                    "address": token.get("address"),
                    "decision": "BLOCK",
                    "reason": quality_reason,
                    "confidence": int(signal.get("confidence") or 0),
                })
                continue

            if bool(token.get("fresh_intel_approved", False)) and str(signal.get("action") or "") == "BUY":
                signal["position_size_pct"] = 5.0
            risk_result = self.risk.validate(signal, self.risk_state)

            if not risk_result.get("approved"):
                blocked = {
                    "token": token.get("symbol"),
                    "address": token.get("address"),
                    "action": signal.get("action"),
                    "status": "blocked",
                    "reason": risk_result.get("reason"),
                }
                actions.append(blocked)
                self._register_journal({
                    "token": token.get("symbol"),
                    "address": token.get("address"),
                    "decision": "BLOCK",
                    "reason": risk_result.get("reason"),
                    "confidence": int(signal.get("confidence") or 0),
                })
                continue

            if signal.get("action") != "BUY":
                self._register_journal({
                    "token": token.get("symbol"),
                    "address": token.get("address"),
                    "decision": str(signal.get("action") or "HOLD"),
                    "reason": "signal_not_buy",
                    "confidence": int(signal.get("confidence") or 0),
                })
                continue

            weighted_size_pct = self._weighted_position_size_pct(
                token,
                signal,
                float(risk_result.get("position_size_pct") or 0.0),
            )
            risk_result["position_size_pct"] = weighted_size_pct

            if not self._can_open_trade():
                blocked = {
                    "token": token.get("symbol"),
                    "address": token.get("address"),
                    "action": "BUY",
                    "status": "blocked",
                    "reason": "max_trades_24h_reached",
                }
                actions.append(blocked)
                self._register_journal({
                    "token": token.get("symbol"),
                    "address": token.get("address"),
                    "decision": "BLOCK",
                    "reason": "max_trades_24h_reached",
                    "confidence": int(signal.get("confidence") or 0),
                })
                continue

            try:
                balance_sol = await self.wallet.get_balance_sol()
            except Exception:
                balance_sol = 0.0
            if balance_sol < configured_buy_sol:
                blocked = {
                    "token": token.get("symbol"),
                    "address": token.get("address"),
                    "action": "BUY",
                    "status": "blocked",
                    "reason": f"insufficient_sol_balance_min_{configured_buy_sol:.3f}",
                }
                actions.append(blocked)
                self._register_journal({
                    "token": token.get("symbol"),
                    "address": token.get("address"),
                    "decision": "BLOCK",
                    "reason": blocked["reason"],
                    "confidence": int(signal.get("confidence") or 0),
                })
                continue

            execution = await self.execution.execute(
                token,
                signal,
                float(risk_result.get("position_size_pct") or 0.0),
                buy_amount_sol=configured_buy_sol,
            )
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
                self._register_journal({
                    "token": token.get("symbol"),
                    "address": token.get("address"),
                    "decision": "REJECT",
                    "reason": execution.get("reason"),
                    "confidence": int(signal.get("confidence") or 0),
                })
                continue

            position = {
                "symbol": token.get("symbol"),
                "address": token.get("address"),
                "entry_price": float(signal.get("entry_price") or 0.0),
                "current_price": float(token.get("price_usd") or 0.0),
                "liquidity": float(token.get("liquidity") or 0.0),
                "confidence": int(signal.get("confidence") or 0),
                "size_pct": float(risk_result.get("position_size_pct") or 0.0),
                "stop_loss": round(float(signal.get("entry_price") or token.get("price_usd") or 0.0) * (1.0 - (float(self.stop_loss_pct) / 100.0)), 8),
                "take_profit": round(float(signal.get("entry_price") or token.get("price_usd") or 0.0) * float(self.take_profit_multiplier), 8),
                "trailing_stop_pct": float(self.trailing_stop_pct),
                "opened_at": datetime.utcnow().isoformat(),
                "signature": execution.get("signature"),
                "risk_status": "active",
                "strategy_mode": self.strategy_mode,
                "peak_price": float(token.get("price_usd") or signal.get("entry_price") or 0.0),
                "notional_usd": float(self.risk_state.equity_usd * (float(risk_result.get("position_size_pct") or 0.0) / 100.0)),
            }
            self.positions.append(position)
            self.positions = self.positions[: int(getattr(self.risk, "MAX_OPEN_POSITIONS", 3) or 3)]
            self.risk.register_open(self.risk_state, float(position["size_pct"]))
            self._register_trade_count()

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
            self._register_journal({
                "token": token.get("symbol"),
                "address": token.get("address"),
                "decision": "BUY",
                "reason": "executed",
                "confidence": int(signal.get("confidence") or 0),
                "size_pct": float(risk_result.get("position_size_pct") or 0.0),
                "strategy_mode": self.strategy_mode,
            })

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
        balance_sol = float(self._last_balance_sol or 0.0)
        now_ts = datetime.utcnow().timestamp()
        refresh_interval_seconds = 20.0
        balance_stale = True
        if self.wallet.public_address:
            should_refresh = (now_ts - float(self._last_balance_checked_ts or 0.0)) >= refresh_interval_seconds
            if should_refresh:
                try:
                    live_balance = await asyncio.wait_for(self.wallet.get_balance_sol(), timeout=1.2)
                    balance_sol = float(live_balance or 0.0)
                    self._last_balance_sol = balance_sol
                    self._last_balance_checked_ts = now_ts
                    balance_stale = False
                except Exception:
                    balance_stale = True
            else:
                balance_stale = False

        return {
            "owner_user_id": self.owner_user_id,
            "enabled": self.enabled,
            "kill_switch": self.kill_switch,
            "scan_interval_seconds": int(self.scan_interval_seconds),
            "last_run_at": self.last_run_at,
            "last_error": self.last_error,
            "scanner_health": self.scanner.get_source_health() if hasattr(self.scanner, "get_source_health") else {},
            "fresh_feed": self.scanner.get_fresh_feed_status() if hasattr(self.scanner, "get_fresh_feed_status") else {},
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
                "balance_stale": bool(balance_stale),
                "last_balance_checked_ts": float(self._last_balance_checked_ts or 0.0),
            },
            "sniping_readiness": {
                "can_snipe_now": bool(
                    str(self.wallet.public_address or "").strip()
                    and str(self.wallet.private_key or "").strip()
                    and not self.kill_switch
                    and not bool(self.risk_state.paused)
                    and bool(self.enabled)
                ),
                "blockers": [
                    reason
                    for reason in [
                        None if str(self.wallet.public_address or "").strip() and str(self.wallet.private_key or "").strip() else "wallet_not_connected",
                        "kill_switch_enabled" if self.kill_switch else None,
                        str(self.risk_state.pause_reason or "risk_paused") if bool(self.risk_state.paused) else None,
                        None if self.enabled else "doctortrade_not_enabled",
                    ]
                    if reason
                ],
            },
            "trade_controls": {
                "max_trades_per_day": int(self.max_trades_per_day),
                "trades_today": int(self._trades_today),
                "sniper_mode_only": bool(self.sniper_mode_only),
                "min_buy_amount_sol": float(self.min_buy_amount_sol),
                "buy_amount_sol": float(self.buy_amount_sol),
                "take_profit_multiplier": float(self.take_profit_multiplier),
                "min_profit_pct": float(self.min_profit_pct),
                "stop_loss_pct": float(self.stop_loss_pct),
                "trailing_stop_pct": float(self.trailing_stop_pct),
                "min_liquidity_usd": float(self.min_liquidity_usd),
                "max_slippage_pct": float(self.max_slippage_pct),
                "max_spread_pct": float(self.max_spread_pct),
                "daily_loss_limit_usd": float(self.daily_loss_limit_usd),
                "max_consecutive_losses": int(self.max_consecutive_losses),
                "strong_move_threshold_pct": float(self.strong_move_threshold_pct),
                "max_hold_minutes": int(self.max_hold_minutes),
                "min_momentum_profit_pct": float(self.min_momentum_profit_pct),
                "early_entry_exit_mode": bool(self.early_entry_exit_mode),
                "fast_take_profit_pct": float(self.fast_take_profit_pct),
                "quality_min_volume_spike_pct": float(self.quality_min_volume_spike_pct),
                "quality_max_top_holder_pct": float(self.quality_max_top_holder_pct),
                "wallet_connected": bool(str(self.wallet.public_address or "").strip() and str(self.wallet.private_key or "").strip()),
            },
            "active_tokens": self.current_tokens,
            "positions": self.positions,
            "recent_trades": self.trade_log[:30],
            "decision_journal": self.decision_journal[:40],
            "performance": self.performance_log[:10],
            "tuning_suggestion": self.last_tuning_suggestion,
            "strategy_mode": self.strategy_mode,
            "mate": {
                "enabled": bool(self.mate_enabled),
                "best_agent": str(self.mate_last_decision.get("best_agent") or ""),
                "regime": str(self.mate_last_decision.get("regime") or ""),
                "confidence": float(self.mate_last_decision.get("confidence") or 0.0),
                "scores": dict(self.mate_last_decision.get("scores") or {}),
            },
            "safety": self.safety_systems.monitor(),
            "self_evolution": self.self_evolution,
        }


doctor_controller = DoctorTradeController()
