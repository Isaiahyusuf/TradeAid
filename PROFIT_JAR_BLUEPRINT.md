# Profit Jar Blueprint (DoctorTrade + Wallet)

## Goal
Build a Profit Jar that automatically routes realized profits from completed trades into a dedicated in-app jar wallet, with full tracking, retry safety, and user controls.

## Why this is better than a simple auto-transfer
A naive implementation ("send profit after each trade") breaks in production due to fees, timing, and failed transfers.
This design improves reliability and user trust with:
- strict profit definition
- fee and reserve safety
- idempotent transfer pipeline
- transparent ledger and audit
- configurable policy modes

## Core concept
Profit Jar is a second wallet inside TradeAid used only for profit capture.
DoctorTrade trading wallet keeps principal and operating funds.
When a trade closes with positive realized PnL, a configured portion of that profit is swept to the jar wallet.

## Profit definition (must be strict)
Only transfer profit when all are true:
- trade status is closed or fully exited
- realized PnL is positive
- PnL is net of fees and transfer/swap costs
- transfer amount is above minimum threshold

Use:
- realized_profit_usd = max(0, pnl_usd_net)
- transfer_profit_usd = realized_profit_usd * allocation_pct

Then convert to SOL for transfer using current price oracle at execution time.

## Policy modes (recommended)
Support multiple modes from day 1:

1. Percentage Sweep (default)
- Example: sweep 20% of each realized net profit.

2. Excess-over-Base Sweep
- Keep trading wallet at target operating balance.
- Sweep only balance above target.

3. Hybrid
- Sweep percentage, but only if post-trade wallet stays above reserve.

## Safety and guardrails
Never transfer if any of these conditions fail:
- transfer amount < min_transfer_sol
- wallet balance after transfer would drop below reserve_sol
- estimated fee would violate reserve
- transfer service unhealthy

Recommended defaults:
- allocation_pct = 20
- reserve_sol = 0.12
- min_transfer_sol = 0.01
- transfer_cooldown_seconds = 30

## Data model additions
Add dedicated Profit Jar entities.

1. profit_jar_settings
- user_id
- enabled
- allocation_pct
- reserve_sol
- min_transfer_sol
- mode (percentage, excess_base, hybrid)
- destination_wallet_address
- destination_wallet_private_key_encrypted
- created_at, updated_at

2. profit_jar_ledger
- id
- user_id
- source_trade_id
- source_trade_table (assistant_trades, doctor_trade_logs)
- source_pnl_usd
- transfer_amount_sol
- transfer_amount_usd
- status (queued, submitted, confirmed, failed, cancelled)
- tx_hash
- explorer_url
- error_message
- created_at, updated_at

3. profit_jar_daily_summary
- user_id
- date
- realized_profit_usd
- swept_profit_usd
- swept_profit_sol
- pending_sweeps
- failed_sweeps

## Execution flow (idempotent)

1. Trade closed event
- detect closed trade with positive realized pnl_usd.

2. ProfitJarEngine.calculate
- compute eligible profit and transfer amount.
- enforce guardrails (reserve, min amount, fees).

3. Queue ledger row
- insert ledger row in queued state with unique key on source_trade_id.

4. Execute transfer
- submit SOL transfer from trading wallet to jar wallet.
- update ledger to submitted/confirmed with tx hash.

5. Retry policy
- failed transfers retried with exponential backoff.
- cap retries and mark failed permanently with reason.

6. UI refresh
- wallet page reads jar totals and ledger history.

## Idempotency rules
Critical to prevent double-sweep:
- unique(source_trade_id, source_trade_table)
- transfer worker checks ledger status before send
- replays should be no-op when already confirmed

## UX plan (Wallet)

New section: Profit Jar
- Jar balance (SOL + USD)
- Total captured profit (lifetime)
- Today captured
- Pending sweeps
- Failed sweeps

Controls:
- Enable/Disable Profit Jar
- Sweep percentage slider
- Reserve amount input
- Min transfer threshold input
- Regenerate jar wallet (with confirmation)

History table:
- timestamp
- source trade id/symbol
- source net pnl
- swept amount
- status
- tx link

## API plan

Settings
- GET /api/ai/profit-jar/settings
- PUT /api/ai/profit-jar/settings

Wallet
- POST /api/ai/profit-jar/wallet/create
- POST /api/ai/profit-jar/wallet/regenerate (dangerous)

Ledger
- GET /api/ai/profit-jar/ledger?limit=50
- GET /api/ai/profit-jar/summary
- POST /api/ai/profit-jar/retry/:ledger_id

## Integration points in current codebase

Primary trade and transfer integration points:
- [trade_aid/app/services/assistant_trading_service.py](trade_aid/app/services/assistant_trading_service.py#L1212)
- [trade_aid/app/services/assistant_trading_service.py](trade_aid/app/services/assistant_trading_service.py#L1480)
- [trade_aid/app/models/models.py](trade_aid/app/models/models.py#L223)
- [trade_aid/app/models/models.py](trade_aid/app/models/models.py#L248)
- [server/routes.ts](server/routes.ts#L10297)
- [server/routes.ts](server/routes.ts#L10425)

Important gap to solve first:
- many trades are recorded with pnl_usd = 0 at execution time.
- Profit Jar must run only on trade close where realized pnl_usd is final.

## Rollout strategy

Phase 1 (safe MVP)
- implement settings + jar wallet + ledger tables
- manual trigger endpoint: sweep from a selected closed trade
- read-only UI

Phase 2 (auto)
- auto sweep on close events
- retry worker + idempotency keys
- alerting for failed sweeps

Phase 3 (advanced)
- excess-over-base mode
- tax/export report
- per-strategy jar stats

## Product copy suggestion
"Profit Jar secures your wins automatically. After a profitable close, a portion of net profit is moved to your protected jar wallet while keeping enough SOL for trading and fees."

## Recommendation
Start with Percentage Sweep mode only, strict idempotency, and a transparent ledger.
That gives users confidence immediately and avoids operational bugs from over-complex first release.
