from __future__ import annotations

import asyncio
from typing import Any

import httpx

from app.utils.logging_config import logger


class BaseDoctorApiService:
    def __init__(self, *, timeout: float = 12.0, retries: int = 3) -> None:
        self._timeout = timeout
        self._retries = max(1, retries)

    async def _request_json(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
        source: str,
    ) -> Any:
        last_error: str | None = None
        for attempt in range(1, self._retries + 1):
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    response = await client.request(method.upper(), url, headers=headers, params=params, json=json)
                response.raise_for_status()
                payload = response.json()
                logger.info("doctor_api_response source=%s status=%s attempt=%s", source, response.status_code, attempt)
                return payload
            except Exception as exc:
                last_error = str(exc)
                logger.warning("doctor_api_retry source=%s attempt=%s error=%s", source, attempt, last_error)
                if attempt < self._retries:
                    await asyncio.sleep(0.4 * attempt)

        logger.error("doctor_api_failed source=%s retries=%s error=%s", source, self._retries, last_error)
        return None
