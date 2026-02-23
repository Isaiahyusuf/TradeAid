import hashlib
from urllib.parse import urlparse


def _normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(str(value).strip().lower().split())


def extract_domain(url: str | None) -> str:
    if not url:
        return ""
    try:
        parsed = urlparse(url.strip())
        host = (parsed.netloc or "").lower()
        if host.startswith("www."):
            host = host[4:]
        return host
    except Exception:
        return ""


def build_launch_fingerprint(
    *,
    deployer_wallet: str | None = None,
    token_name: str | None = None,
    token_symbol: str | None = None,
    dex_id: str | None = None,
    websites: list[str] | None = None,
    socials: list[str] | None = None,
    logo_url: str | None = None,
) -> str:
    normalized_websites = sorted({extract_domain(url) for url in (websites or []) if extract_domain(url)})
    normalized_socials = sorted({_normalize_text(url) for url in (socials or []) if _normalize_text(url)})

    parts = [
        _normalize_text(deployer_wallet),
        _normalize_text(token_name),
        _normalize_text(token_symbol),
        _normalize_text(dex_id),
        "|".join(normalized_websites),
        "|".join(normalized_socials),
        _normalize_text(extract_domain(logo_url) or logo_url),
    ]
    seed = "::".join(parts)
    if not seed.replace(":", "").strip():
        return ""
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]
