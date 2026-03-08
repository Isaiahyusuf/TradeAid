# DoctorTrade User Manual

This guide explains DoctorTrade end-to-end, step by step.

## 1) What DoctorTrade Is

DoctorTrade is the autonomous trading terminal inside TradeAid. It:

- Scans new Solana opportunities.
- Applies risk/quality filters.
- Decides when to buy/sell based on configured controls.
- Executes in `live` mode when wallet credentials are connected.
- Exposes logs, decisions, trades, and health telemetry in the UI.

---

## 2) Open DoctorTrade

1. In the app sidebar, open **DoctorTrade**.
2. Wait for status to load.
3. Confirm the top controls panel shows backend sync.

---

## 3) Wallet Connection (Important)

DoctorTrade needs a wallet before live execution.

### Option A: Connect Existing Wallet

1. Click **Connect Existing Wallet**.
2. If needed, complete wallet setup in `/wallet` and return.

### Option B: Manual Private Key Import

1. In **DoctorTrade Settings → Doctor Wallet**, paste your Solana private key.
2. Click **Connect Wallet**.
3. Confirm the security prompt.

### Persistence behavior

- Manual private key is encrypted and stored.
- It remains connected across page reloads/restarts.
- It stays connected **until you disconnect wallet or replace key**.
- UI now shows:
  - `Connection: Connected/Disconnected`
  - `Private key status: Configured (persisted)/Not configured`

---

## 4) Start/Stop and Cycle Controls

### Start bot

- Click **Start DoctorTrade** to enable autonomous cycles.

### Stop bot

- Click **Stop DoctorTrade** to pause autonomous operation.

### Run one cycle manually

- Click **Run Cycle** to force an immediate scan/evaluation pass.

### Refresh UI data

- Click **Refresh Data** for latest status/trades/logs.

---

## 5) Risk Settings (How to Tune)

In **DoctorTrade Settings**, you can set:

- `Scan Interval`
- `Buy Amount (SOL)`
- `Trades / 24h`
- `Take Profit Multiplier`
- `Min Profit %`
- `Stop Loss %`
- `Trailing Stop %`
- `Min Liquidity USD`
- `Max Slippage %`
- `Max Spread %`
- `Daily Loss Limit $`
- `Max Consecutive Losses`
- `Strong Move %`
- `Max Hold Minutes`
- `Min Momentum Profit %`
- `Quality Min Spike %`
- `Quality Max Holder %`
- `Gas Priority (lamports)`
- `Live Sell Fraction %`
- `Max Sell Notional $`

Then click **Save Settings**.

### Presets

- `Conservative`
- `Balanced`
- `Aggressive`
- `Insider Default`

Load a preset, then save.

---

## 6) Sniper / Insider Detection Logs

Sniper logs include events like:

- `detected`
- `rejected`
- `sniped`

For rejected insider checks, logs include:

- `reason: insider_conditions_failed`
- `failed_checks` values, such as:
  - `liquidity_window_failed`
  - `buy_sell_pressure_failed`
  - `volume_5m_failed`

Use these to tune settings and understand why a token did not pass.

---

## 7) Direct Buy Flow (Current Behavior)

Direct Buy now routes to Wallet swap flow (not DoctorTrade auto-buy):

1. Select token from scanner/safe-buy.
2. Opens `/wallet` swap with token contract prefilled.
3. Enter **SOL amount**.
4. See estimated token output quote.
5. Submit swap.

---

## 8) Reading DoctorTrade Panels

### Wallet section

Shows address, SOL balance, and connection/private-key status.

### Active Tokens

Tokens that currently pass scanner/selection flow.

### Recent Trades

Executed buy/sell history with confidence/liquidity/size.

### Decision Journal

Why DoctorTrade acted (or skipped) each cycle.

### Performance

Cycle summaries and performance-related metrics.

### Safety / Risk State

Pause reason, drawdown/loss limits, and lock conditions.

---

## 9) Common Issues and Fixes

### "Wallet not connected"

- Connect wallet in DoctorTrade settings.
- Ensure private key is configured and address appears.

### "Live wallet credentials missing"

- Reconnect wallet or import private key again.
- Verify wallet status is `Connected`.

### "insider_conditions_failed"

- Check `failed_checks` in sniper logs.
- Relax relevant thresholds carefully.

### DB missing-table errors

- Ensure local DB schema includes required app tables.

---

## 10) Safe Usage Checklist

Before enabling autonomous mode:

1. Use small `Buy Amount (SOL)` first.
2. Set conservative loss controls.
3. Verify wallet balance and connection status.
4. Watch first cycles with **Run Cycle** before full automation.
5. Review logs and decision journal frequently.

---

## 11) Advanced Notes

- DoctorTrade is currently Solana-focused for live routing.
- Execution can be blocked by risk guards even when scanner detects candidates.
- Connection state depends on persisted wallet address + persisted encrypted private key for the active user.
