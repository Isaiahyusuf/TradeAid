This file lists environment variables required or recommended for running the backend services (Node server + scanner + related workers). Add these to your Railway / hosting environment.

Required core vars
- DATABASE_URL: (required) Postgres connection string (e.g. `postgres://user:pass@host:5432/dbname`). Used by `drizzle` / storage.
- PORT: (required) HTTP port for Node server (Railway sets this automatically).
- NODE_ENV: (required) `production` or `development`.
- SESSION_SECRET or JWT_SECRET: (required) Secret for session or JWT signing. Keep secure.
- REDIS_URL: (required if using Redis/Celery) Redis connection string for caching and Celery broker.

Scanner & blockchain analysis
- HELIUS_API_KEY: (recommended for Solana) Helius key used for holder analysis and RPC calls.
- ALCHEMY_API_KEY: (optional) Alchemy key for Ethereum/Polygon RPC (if any EVM code remains).
- BSCSCAN_API_KEY: (optional) BscScan API key (only if BSC scanning used).
- ETHERSCAN_API_KEY: (optional) Etherscan API key (only if EVM scanning used).

AI / External integrations
- AI_INTEGRATIONS_OPENAI_API_KEY: (required for AI features) OpenAI key used by AI services.
- OPENAI_API_KEY: (alias) some services expect this; set if used.

Payments & webhooks
- STRIPE_SECRET_KEY: (optional) Stripe secret for payments (if using Stripe).
- STRIPE_WEBHOOK_SECRET: (optional) For webhook verification.

Telegram bot (safe Solana calls)
- TELEGRAM_BOT_TOKEN: (required for bot) Bot token from BotFather.
- TELEGRAM_CHAT_ID: (optional but recommended) Default Telegram chat id allowed to interact with the bot.
- TELEGRAM_ALLOWED_CHAT_IDS: (optional) Comma-separated chat ids allowed to use the bot.
- TELEGRAM_BOT_POLL_SECONDS: (optional) Long-poll timeout in seconds. Default `25`.
- TELEGRAM_BOT_PUSH_INTERVAL_SECONDS: (optional) Push alert interval in seconds. Default `60`.
- TELEGRAM_BOT_PUSH_LOOKBACK_MINUTES: (optional) How far back to scan for fresh push candidates. Default `45`.
- TELEGRAM_BOT_PUSH_MIN_SAFETY_SCORE: (optional) Minimum safety score for push alerts. Default `78`.
- TELEGRAM_BOT_PUSH_MIN_LIQUIDITY_USD: (optional) Minimum liquidity for push alerts. Default `35000`.
- TELEGRAM_BOT_PUSH_MIN_VOLUME24H_USD: (optional) Minimum 24h volume for push alerts. Default `20000`.
- TRADEAID_APP_URL: (optional) Base URL used for direct buy/view buttons in Telegram replies. Defaults to `FRONTEND_URL` or `https://tradeaid.ink`.

Bot commands
- /safe [n]: show top safe Solana buy candidates.
- /new [n]: show newest safer Solana tokens (last 24h).
- /token <symbol|address>: show full token information.
- /projects <symbol|address>: show project links (website/twitter/telegram/chart).
- /push on|off|status: enable, disable, or inspect Telegram push alerts.
- /help: show command help.

Security & misc
- ENCRYPTION_KEY: (required if server encrypts data) 32+ char symmetric key for encrypting sensitive data.
- MASTER_ACCESS_KEY: (optional) administrative backdoor key—keep disabled in production unless needed.
- SENTRY_DSN: (optional) Sentry DSN for error reporting.

Worker / Python service (trade_aid)
- TRADE_AID_DATABASE_URL: (if separate) Postgres connection for the Python service.
- CELERY_BROKER_URL: (if using Celery) typically same as `REDIS_URL`.
- CELERY_RESULT_BACKEND: (if using Celery)

Tips
- Use Railway's environment variables UI to add these securely.
- Do not commit secrets to the repository.
- For Helium/Helius and other paid APIs, ensure rate limits and quotas are configured.
- If you only want Solana support, you can omit the EVM keys (Alchemy, Etherscan, BscScan). But keep `HELIUS_API_KEY` for best holder analysis results.

If you want, I can produce a `.env.production.example` file with placeholder values next.