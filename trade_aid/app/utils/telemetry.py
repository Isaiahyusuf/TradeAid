import hashlib
from fastapi import Request

from app.config import get_settings


def _safe_text(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(value.strip().lower().split())


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    if request.client and request.client.host:
        return request.client.host
    return ""


def build_telemetry_fingerprint(*, ip: str, user_agent: str, device_id: str) -> str:
    settings = get_settings()
    seed = "::".join([
        _safe_text(ip),
        _safe_text(user_agent),
        _safe_text(device_id),
        _safe_text(settings.TELEMETRY_HASH_SALT),
    ])
    if not seed.replace(":", "").strip():
        return ""
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:32]
