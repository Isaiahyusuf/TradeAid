# Trade Aid — Blockchain Intelligence Backend

Trade Aid is a production-ready backend for blockchain intelligence: token discovery, safety scoring, wallet clustering, AI-assisted analysis, background scanning, and alerting. This repository contains the Python/FastAPI backend and an AI microservice designed to run via Docker Compose for easy deployment.

TL;DR — to run locally using Docker Compose:

```powershell
# copy and fill env
Copy-Item .env.example .env
notepad .env

# build & start everything (from repo root)
docker compose -f trade_aid\\docker-compose.yml up -d --build
```

## What's in `trade_aid/`
- `Dockerfile` — main Python backend image
- `Dockerfile.ai` — AI microservice image
- `docker-compose.yml` — full stack compose (backend, scanner, ai_service, celery, postgres, redis, nginx)
- `.env.example` — environment variables (copy to `.env`)
- `app/` — FastAPI application code
- `requirements.txt` / `requirements.ai.txt` — Python deps
- `alembic/` — DB migrations
- `nginx/` — optional nginx config and SSL folder

## Architecture
- Backend: FastAPI + async SQLAlchemy + Alembic
- AI service: FastAPI microservice (PyTorch/TensorFlow capable)
- Background: scanner process (DexScreener + chain listeners)
- Workers: Celery with Redis broker/result backend
- DB: PostgreSQL
- Reverse proxy: nginx (optional, included in compose)

## Prerequisites
- Docker and Docker Compose (Docker Desktop or Linux package)
- At least 2–4 GB RAM for local development (more for production)

## Setup (local / VPS)

1. From repository root copy environment file and fill required values:

```powershell
Copy-Item trade_aid\\.env.example trade_aid\\.env
notepad trade_aid\\.env
```

2. From repository root, build and start the Trade Aid stack:

```powershell
docker compose -f trade_aid\\docker-compose.yml up -d --build
```

3. Verify services are healthy and running:

```powershell
docker compose -f trade_aid\\docker-compose.yml ps
docker compose -f trade_aid\\docker-compose.yml logs -f backend
```

4. Run database migrations (inside the backend container):

```powershell
docker compose -f trade_aid\\docker-compose.yml exec backend alembic upgrade head
# if alembic isn't on PATH inside container
docker compose -f trade_aid\\docker-compose.yml exec backend sh -c "python -m alembic upgrade head"
```

## Common Docker/Compose commands for this project
- Build & start full stack: `docker compose -f trade_aid\\docker-compose.yml up -d --build`
- Start a single service: `docker compose -f trade_aid\\docker-compose.yml up -d backend`
- Stop & remove containers: `docker compose -f trade_aid\\docker-compose.yml down`
- Stop, remove containers and volumes: `docker compose -f trade_aid\\docker-compose.yml down -v`
- Follow logs: `docker compose -f trade_aid\\docker-compose.yml logs -f backend`
- Exec into running container: `docker compose -f trade_aid\\docker-compose.yml exec backend sh`
- View service status: `docker compose -f trade_aid\\docker-compose.yml ps`

Service names available in the compose file: `backend`, `scanner`, `ai_service`, `celery_worker`, `celery_beat`, `postgres`, `redis`, `nginx`.

## Environment variables
Edit `trade_aid/.env` (copy from `trade_aid/.env.example`) and set values for:
- `DATABASE_URL` / `DATABASE_URL_SYNC` — connection strings to `postgres` service
- `REDIS_URL`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`
- JWT and security keys: `JWT_SECRET_KEY`, `MASTER_ACCESS_KEY`, `ENCRYPTION_KEY`
- API keys for chain providers: `HELIUS_API_KEY`, `ALCHEMY_API_KEY`, `BSCSCAN_API_KEY`
- Optional: `AI_SERVICE_URL` if running the AI service separately

Important: `.env` is in `.gitignore` by default.

## Running / development notes
- The main backend listens on port `8000` inside the container; compose maps it to host `8000`.
- The AI microservice exposes `8001` and is built from `Dockerfile.ai`.
- Logs are written to `./logs` (mounted into containers by compose) — check that path exists and is writable.
- For faster iterative development you can mount code into the container and install dev dependencies locally instead of building full images.

## Migrations
- Create or edit migrations in `alembic/` and run:

```powershell
docker compose -f trade_aid\\docker-compose.yml exec backend alembic revision --autogenerate -m "message"
docker compose -f trade_aid\\docker-compose.yml exec backend alembic upgrade head
```

## Troubleshooting
- Container fails to start: inspect logs with `docker compose -f trade_aid\\docker-compose.yml logs <service>`.
- DB connection errors: ensure `trade_aid/.env` has correct `POSTGRES_*` values and that `postgres` container is healthy.
- Redis errors: validate `REDIS_URL` in `.env` and container health.
- Permission issues writing logs: ensure `./logs` exists and has correct permissions for Docker.

## Production / Deploy tips
- Use a secrets manager or environment variables injected by your host (don't commit `.env`).
- For production scale, separate workers from web processes, increase Celery concurrency, and run multiple backend instances behind nginx.
- Use `docker compose -f trade_aid\\docker-compose.yml up -d --scale celery_worker=3` to scale workers.

## Useful scripts
- The repository contains `scripts/` with helper scripts. Consider adding a `scripts/docker-commands.ps1` with the common commands above for convenience.

## Contributing
- Follow the existing code style. Open a PR and include tests for new features where applicable.

## License
See repository root for license information.

---
If you'd like, I can also add a small `scripts/docker-commands.ps1` cheat-sheet into `scripts/` with the commands shown above. Want me to add it?
