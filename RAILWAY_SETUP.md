Railway deployment checklist
===========================

Quick steps
-----------

- Create a new Railway project and connect your GitHub repo (or push code directly).
- Add the following plugins in Railway: `Postgres` and `Redis`.
- Configure one `web` service for the Node server (root project) and one separate service for the Python `trade_aid` workers/AI if you need Celery/AI separated.
- Ensure Railway runs `npm install` and `npm run build` (Nixpacks will run `build` automatically) and `npm start` as the production start command.

Important: Railway exposes a `PORT` environment variable which our server already respects (`process.env.PORT`).

Required environment variables
------------------------------

Core (backend web / API)
- `PORT` — (provided by Railway) HTTP port to bind to (server uses this; default 5000 locally)
- `DATABASE_URL` — Postgres connection string used by the Node server and some scripts.
- `SESSION_SECRET` — secret used by server session middleware (if used).

Node/OpenAI & integrations
- `OPENAI_API_KEY` or `AI_INTEGRATIONS_OPENAI_API_KEY` — API key for OpenAI (required for AI features)
- `OPENAI_BASE_URL` or `AI_INTEGRATIONS_OPENAI_BASE_URL` — optional custom OpenAI base URL
- `HELIUS_API_KEY` — (optional) Solana RPC/Indexer key used by some services
- `ALCHEMY_API_KEY` — (optional) Ethereum/chain provider key (not needed for Solana-only but present)
- `BSCSCAN_API_KEY` — (optional) BSC explorer API key (can ignore for Solana-only)

Payment addresses (used by subscription/payment pages)
- `PAYMENT_ADDRESS_SOL` — recipient address for SOL payments
- `PAYMENT_ADDRESS_ETH` — (optional) not required for Solana-only
- `PAYMENT_ADDRESS_BSC` — (optional)
- `PAYMENT_ADDRESS_BASE` — (optional)

Server / Replit / third-party
- `REPL_ID` — only if using Replit OIDC integration (optional)
- `API_URL` — public API URL; used by `mobile/app.config.js` (set to your Railway URL like `https://your-app.up.railway.app`)

Python `trade_aid` service (FastAPI + workers)
- `DATABASE_URL` — Postgres async URL used by FastAPI (e.g. `postgresql+asyncpg://user:pass@host:port/db`)
- `DATABASE_URL_SYNC` — sync SQLAlchemy URL (for alembic/migrations)
- `REDIS_URL` — Redis connection string (for Celery & pub/sub)
- `JWT_SECRET_KEY` — JWT signing secret
- `MASTER_ACCESS_KEY` — master key for admin endpoints
- `CELERY_BROKER_URL` — broker URL (usually same as `REDIS_URL` with different DB index)
- `CELERY_RESULT_BACKEND` — result backend URL (redis)
- `AI_SERVICE_URL` — URL of the AI microservice (if deployed separately)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — optional for Telegram alerts
- `SOLANA_RPC_URL` — RPC endpoint for Solana (defaults to mainnet-beta; recommend using a paid RPC provider or Helius)
- `SOLANA_WS_URL` — websocket URL for Solana (if scanner uses it)
- `ENCRYPTION_KEY` — 32-char key used for local encryption (change from default)

Logging / runtime
- `LOG_LEVEL` — `INFO`/`DEBUG` etc.
- `LOG_FILE` — path to a logfile (optional; in Railway you can use stdout)

Notes and recommendations
-------------------------

- For a minimal Solana-only deployment you can safely ignore `ALCHEMY_API_KEY`, `BSCSCAN_API_KEY`, `PAYMENT_ADDRESS_ETH`, `PAYMENT_ADDRESS_BSC`, and other non-Solana configs — but keep them empty rather than removing code unless you want a deeper refactor.
- Use Railway's managed Postgres and Redis and copy the generated connection strings into `DATABASE_URL` and `REDIS_URL` respectively.
- If you plan to run Celery workers, configure them as a background service on Railway pointing `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND` at the managed Redis instance.
- For OpenAI usage set `AI_INTEGRATIONS_OPENAI_API_KEY` rather than public `OPENAI_API_KEY` if you prefer namespacing.

Railway service configuration (example)

- `web` service (Node app):
  - build: default (Nixpacks) — ensure `package.json` has a `build` script
  - start command: `npm start` (package.json `start` runs server)
  - env: `DATABASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `OPENAI_BASE_URL`, `API_URL` (set API_URL to Railway deployment URL)

- `trade-aid-workers` service (optional, Python):
  - use the provided `trade_aid/Dockerfile` or build via Nixpacks
  - command: `uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}` for the API and `celery -A app.workers.celery_app worker --loglevel=info` for workers
  - env: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET_KEY`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `AI_SERVICE_URL`

What I can do next
-------------------

- Add a top-level `README.md` tailored for Railway with exact deploy steps, or
- Update server code to validate required env vars at startup (fail early and log missing vars), or
- Configure repository `package.json` scripts for CI-friendly build on Railway.

If you want, I can now:
- A) Add a top-level `README.md` tailored for Railway with exact deploy steps, or
- B) Update server code to validate required env vars at startup (fail early and log missing vars), or
- C) Configure repository `package.json` scripts for CI-friendly build on Railway.
