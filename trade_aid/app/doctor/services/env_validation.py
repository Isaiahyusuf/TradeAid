from __future__ import annotations

from app.config import get_settings


REQUIRED_DOCTOR_KEYS = [
    "COINGECKO_API_KEY",
    "HELIUS_API_KEY",
    "MORALIS_API_KEY",
    "SOLSCAN_API_KEY",
    "JUPITER_API_KEY",
]


def validate_required_doctor_env_keys() -> None:
    settings = get_settings()
    missing = [name for name in REQUIRED_DOCTOR_KEYS if not str(getattr(settings, name, "") or "").strip()]
    if missing:
        raise RuntimeError(f"Missing required DoctorTrade API key(s): {', '.join(missing)}")
