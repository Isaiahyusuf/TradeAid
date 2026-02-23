import time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from app.utils.logging_config import logger


def _client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        ip = _client_ip(request)
        origin = request.headers.get("origin", "")
        host = request.headers.get("host", "")
        method = request.method
        path = request.url.path

        if path.startswith("/api/auth/register"):
            logger.info(f"[Auth:Register] request origin={origin or '-'} host={host or '-'} ip={ip} method={method} path={path}")

        try:
            response = await call_next(request)
        except Exception as exc:
            duration_ms = int((time.perf_counter() - start) * 1000)
            logger.error(
                f"[Request:Failed] origin={origin or '-'} host={host or '-'} ip={ip} method={method} path={path} status=500 duration_ms={duration_ms} error={exc}"
            )
            raise

        duration_ms = int((time.perf_counter() - start) * 1000)
        status_code = response.status_code

        logger.info(
            f"[Request] origin={origin or '-'} host={host or '-'} ip={ip} method={method} path={path} status={status_code} duration_ms={duration_ms}"
        )

        if method == "OPTIONS" and origin and status_code >= 400:
            logger.warning(
                f"[CORS:Blocked] origin={origin} host={host or '-'} ip={ip} method={method} path={path} status={status_code}"
            )

        if status_code >= 400:
            logger.warning(
                f"[Request:Non2xx] origin={origin or '-'} host={host or '-'} ip={ip} method={method} path={path} status={status_code}"
            )

        if path.startswith("/api/auth/register") and status_code >= 400:
            logger.warning(
                f"[Auth:Register:Failed] origin={origin or '-'} host={host or '-'} ip={ip} method={method} path={path} status={status_code}"
            )

        return response
