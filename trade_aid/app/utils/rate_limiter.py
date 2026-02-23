import time
from collections import defaultdict
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from app.config import get_settings
from app.utils.logging_config import logger

settings = get_settings()


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, max_requests: int = None, window_seconds: int = 60):
        super().__init__(app)
        self.max_requests = max_requests or settings.RATE_LIMIT_PER_MINUTE
        self.window_seconds = window_seconds
        self.requests = defaultdict(list)
        self.register_max_requests = max(self.max_requests, 120)

    def _client_ip(self, request: Request) -> str:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        if request.client and request.client.host:
            return request.client.host
        return "unknown"

    async def dispatch(self, request: Request, call_next):
        client_ip = self._client_ip(request)
        path = request.url.path
        max_requests = self.register_max_requests if path.startswith("/api/auth/register") else self.max_requests

        now = time.time()
        window_start = now - self.window_seconds
        self.requests[client_ip] = [
            t for t in self.requests[client_ip] if t > window_start
        ]

        if len(self.requests[client_ip]) >= max_requests:
            logger.warning(
                f"[RateLimit] blocked ip={client_ip} method={request.method} path={path} count={len(self.requests[client_ip])} limit={max_requests} window_seconds={self.window_seconds}"
            )
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Please try again later.",
            )

        self.requests[client_ip].append(now)
        response = await call_next(request)
        return response
