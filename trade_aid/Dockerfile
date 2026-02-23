FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    python3-dev \
    libffi-dev \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY trade_aid/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY trade_aid/ .

EXPOSE 8000

CMD ["gunicorn", "app.main:app", "--worker-class", "uvicorn.workers.UvicornWorker", "--workers", "1", "--bind", "0.0.0.0:8000", "--timeout", "120", "--graceful-timeout", "30", "--access-logfile", "-", "--error-logfile", "-"]
