FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY trade_aid/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY trade_aid/ .

EXPOSE 8000

# Use gunicorn as the image entrypoint and keep the args in CMD so they
# can be overridden by the platform (Railway) if needed.
ENTRYPOINT ["gunicorn"]
CMD ["app.main:app",
    "--worker-class", "uvicorn.workers.UvicornWorker",
    "--workers", "1",
    "--bind", "0.0.0.0:8000",
    "--timeout", "120",
    "--graceful-timeout", "30",
    "--access-logfile", "-",
    "--error-logfile", "-"]

# Healthcheck for the FastAPI service
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1
