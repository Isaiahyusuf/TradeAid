from __future__ import annotations

from datetime import datetime

from .agents.flow_agent import FlowAgent
from .agents.momentum_agent import MomentumAgent
from .agents.reversion_agent import ReversionAgent
from .analytics.logger import StructuredLogger
from .analytics.performance import PerformanceTracker
from .api.dashboard import DashboardAdapter
from .api.telegram import TelegramInterface
from .data.aggregator import DataAggregator
from .data.indicators import compute_atr, compute_rsi, compute_vwap, rolling_slope, volatility_band_width
from .data.orderflow import OrderFlowAnalyzer
from .data.stream import MarketDataStream
from .engine.orchestrator import StrategyOrchestrator
from .engine.scheduler import EngineScheduler
from .engine.state_manager import StateManager
from .risk.drawdown_guard import DrawdownGuard
from .risk.portfolio_manager import PortfolioManager
from .risk.position_sizer import PositionSizer
from .execution.order_manager import OrderManager
from .storage.db import TradeJournalDB
from .types import SignalDirection


class MATEngine:
    def __init__(self, symbol: str = "SOL/USDT") -> None:
        self.symbol = symbol
        self.state = StateManager(symbol=symbol, starting_equity=100000.0)
        self.scheduler = EngineScheduler(interval_seconds=3.0)

        self.stream = MarketDataStream(seed_price=100.0)
        self.agg = DataAggregator(maxlen=500)
        self.orderflow = OrderFlowAnalyzer(maxlen=500)

        self.momentum = MomentumAgent()
        self.reversion = ReversionAgent()
        self.flow = FlowAgent()
        self.agents = {
            self.momentum.name: self.momentum,
            self.reversion.name: self.reversion,
            self.flow.name: self.flow,
        }

        self.orchestrator = StrategyOrchestrator(cooldown_seconds=30, hysteresis_margin=0.06)
        self.portfolio = PortfolioManager(max_active_trades=1)
        self.sizer = PositionSizer(max_kelly_fraction=0.18, max_risk_per_trade=0.018)
        self.guard = DrawdownGuard(max_daily_loss_pct=0.03, max_consecutive_losses=3)
        self.orders = OrderManager()

        self.performance = PerformanceTracker()
        self.journal = TradeJournalDB()
        self.logger = StructuredLogger()
        self.telegram = TelegramInterface()
        self.dashboard = DashboardAdapter()

    def _build_features(self) -> dict[str, float]:
        prices = self.agg.prices()
        highs = self.agg.highs()
        lows = self.agg.lows()
        volumes = self.agg.volumes()
        latest = self.agg.latest()
        atr = compute_atr(highs, lows, prices, period=14)
        atr_pct = (atr / max(prices[-1], 1e-9)) if prices else 0.0
        flow = self.orderflow.update(latest) if latest else {"delta": 0.0, "cvd": 0.0, "delta_divergence": 0.0, "absorption": 0.0, "spoofing_risk": 0.0}
        return {
            "atr": atr,
            "atr_pct": atr_pct,
            "rsi": compute_rsi(prices, period=14),
            "vwap": compute_vwap(prices[-60:], volumes[-60:]) if prices and volumes else 0.0,
            "band_width": volatility_band_width(prices, period=20),
            "slope_fast": rolling_slope(prices, window=8),
            "slope_slow": rolling_slope(prices, window=26),
            "volume_zscore": self.agg.volume_zscore(window=30),
            "liquidity_inflow": self.agg.liquidity_inflow(window=20),
            "spread_bps": float(latest.spread_bps if latest else 0.0),
            "liquidity": float(latest.liquidity if latest else 0.0),
            "large_wallet_flow": 0.0,
            **flow,
        }

    def _agent_context(self) -> dict[str, list[float]]:
        return {
            "prices": self.agg.prices(),
            "highs": self.agg.highs(),
            "lows": self.agg.lows(),
            "volumes": self.agg.volumes(),
        }

    async def tick(self, external_data: dict | None = None) -> None:
        snapshot = self.stream.next_snapshot(self.symbol, external=external_data)
        self.agg.add(snapshot)
        features = self._build_features()
        context = self._agent_context()
        regime = self.orchestrator.detect_regime(features, context)

        signals = {name: agent.generate(features, context) for name, agent in self.agents.items()}

        edge_score = {name: self.performance.meta_learning_scores.get(name, 0.5) for name in self.agents}
        recent_perf = {name: self.performance.per_agent_stats(name).get("win_rate", 0.0) for name in self.agents}
        risk_eff = {
            name: max(0.0, min(1.0, self.performance.per_agent_stats(name).get("profit_factor", 0.0) / 2.0))
            for name in self.agents
        }

        now = datetime.utcnow()
        decision = self.orchestrator.select(
            regime=regime,
            now=now,
            current_agent=self.state.state.active_agent,
            cooldown_until=self.state.state.cooldown_until,
            edge_score=edge_score,
            recent_performance=recent_perf,
            risk_efficiency=risk_eff,
        )
        self.state.state.last_decision = {
            "best_agent": decision.best_agent,
            "confidence": decision.confidence,
            "regime": decision.regime.value,
            "scores": decision.scores,
        }

        self.journal.log_decision(
            {
                "created_at": now.isoformat(),
                "symbol": self.symbol,
                "regime": decision.regime.value,
                "best_agent": decision.best_agent,
                "confidence": decision.confidence,
                "factors": decision.factors,
            }
        )

        if decision.best_agent and decision.best_agent != self.state.state.active_agent:
            self.state.state.active_agent = decision.best_agent
            self.state.state.last_switch_at = now
            self.state.state.cooldown_until = self.orchestrator.next_cooldown_until(now)

        selected_signal = signals.get(decision.best_agent)
        if selected_signal is None:
            return

        self.guard.start_day(self.state.state.equity)
        if not self.guard.can_trade(self.state.state.equity):
            self.logger.event("risk_pause", {"reason": "drawdown_guard", "state": self.guard.state.__dict__})
            return

        if self.orders.active_trade is None and self.portfolio.can_open_trade():
            signal_side = str(selected_signal.get("signal") or "HOLD")
            if signal_side in (SignalDirection.BUY.value, SignalDirection.SELL.value) and decision.confidence > 0.52:
                stats = self.performance.per_agent_stats(decision.best_agent)
                size = self.sizer.size(
                    equity=self.state.state.equity,
                    atr_pct=float(features.get("atr_pct") or 0.0),
                    confidence=float(selected_signal.get("confidence") or 0.0),
                    win_rate=float(stats.get("win_rate") or 0.5),
                    rr=max(0.2, float(selected_signal.get("expected_rr") or 0.0)),
                )
                if size > 0:
                    trade = await self.orders.open_trade(
                        symbol=self.symbol,
                        side=signal_side,
                        entry=float(selected_signal.get("entry") or 0.0),
                        stop=float(selected_signal.get("stop_loss") or 0.0),
                        take=float(selected_signal.get("take_profit") or 0.0),
                        size=size,
                        slippage_bps=max(1.0, float(features.get("spread_bps") or 0.0)),
                    )
                    self.portfolio.register_open(trade.trade_id)
                    self.telegram.notify_signal(
                        strategy=decision.best_agent.replace("_agent", "").upper(),
                        regime=decision.regime.value,
                        signal=signal_side,
                        entry=float(selected_signal.get("entry") or 0.0),
                        take_profit=float(selected_signal.get("take_profit") or 0.0),
                        stop_loss=float(selected_signal.get("stop_loss") or 0.0),
                        confidence=float(selected_signal.get("confidence") or 0.0),
                    )
                    self.logger.event(
                        "trade_open",
                        {
                            "trade_id": trade.trade_id,
                            "agent": decision.best_agent,
                            "regime": decision.regime.value,
                            "confidence": float(selected_signal.get("confidence") or 0.0),
                            "reason": str(selected_signal.get("reason") or ""),
                        },
                    )

        active = self.orders.active_trade
        if active is None:
            return

        managed = await self.orders.manage_trade(snapshot.price, atr_pct=float(features.get("atr_pct") or 0.0))
        if managed is None:
            return

        should_close = False
        if managed.side == "BUY":
            should_close = managed.current_price <= float(managed.trailing_stop or managed.stop_loss) or managed.current_price >= managed.take_profit
        else:
            should_close = managed.current_price >= float(managed.trailing_stop or managed.stop_loss) or managed.current_price <= managed.take_profit

        if not should_close:
            return

        closed = await self.orders.close_trade(snapshot.price)
        if closed is None:
            return

        self.portfolio.register_close(closed.trade_id)
        hold_seconds = (closed.closed_at - closed.opened_at).total_seconds() if closed.closed_at else 0.0
        pnl = float(closed.pnl or 0.0)
        self.state.state.equity += pnl
        self.performance.register_trade(decision.best_agent, pnl=pnl, hold_seconds=hold_seconds, notional=max(1.0, closed.size * closed.entry_price))
        self.guard.register_trade_result(pnl, self.state.state.equity)

        trade_row = {
            "trade_id": closed.trade_id,
            "symbol": closed.symbol,
            "agent": decision.best_agent,
            "side": closed.side,
            "entry_price": closed.entry_price,
            "exit_price": closed.exit_price,
            "size": closed.size,
            "opened_at": closed.opened_at.isoformat(),
            "closed_at": closed.closed_at.isoformat() if closed.closed_at else None,
            "pnl": pnl,
            "hold_seconds": hold_seconds,
            "decision_factors": decision.factors.get(decision.best_agent, {}),
        }
        self.journal.log_trade(trade_row)
        self.logger.event("trade_close", trade_row)

    async def run(self) -> None:
        async def _tick() -> None:
            await self.tick()

        await self.scheduler.run(_tick)

    def stop(self) -> None:
        self.scheduler.stop()

    def dashboard_state(self) -> dict:
        board = []
        for agent in self.agents:
            stats = self.performance.per_agent_stats(agent)
            board.append({"agent": agent, **stats, "meta_score": self.performance.meta_learning_scores.get(agent, 0.5)})
        board.sort(key=lambda row: row.get("meta_score", 0.0), reverse=True)
        return self.dashboard.build_state(
            active_agent=self.state.state.active_agent,
            regime=str(self.state.state.last_decision.get("regime") or ""),
            equity_curve=self.performance.equity_curve,
            leaderboard=board,
        )
