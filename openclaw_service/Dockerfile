FROM python:3.11-slim

WORKDIR /srv/openclaw

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY openclaw_service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY openclaw_service/app ./app

EXPOSE 8088

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8088"]
