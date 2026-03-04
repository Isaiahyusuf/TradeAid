from datetime import datetime
import random
import re
from typing import Optional
from uuid import UUID
from sqlalchemy import and_, select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, APIKeyHeader
from app.database import get_db
from app.models.models import User
from app.utils.security import (
    hash_password, verify_password, create_access_token,
    create_refresh_token, decode_token, validate_master_key,
    encrypt_api_key, decrypt_api_key, generate_totp_secret,
    verify_totp, get_totp_provisioning_uri,
)
from app.utils.logging_config import logger
from app.services.email_service import send_email_code

bearer_scheme = HTTPBearer(auto_error=False)
api_key_header = APIKeyHeader(name="X-Master-Key", auto_error=False)
VERIFICATION_RESEND_COOLDOWN_SECONDS = 60

EMAIL_PATTERN = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
SPECIAL_PATTERN = re.compile(r"[^A-Za-z0-9]")
USERNAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]{2,19}$")


def _generate_code() -> str:
    return f"{random.randint(100000, 999999)}"


def _validate_email_or_raise(email: str):
    if not email or not EMAIL_PATTERN.match(email.strip()):
        raise HTTPException(status_code=400, detail="Enter a valid email address")


def _validate_password_or_raise(password: str):
    if not password or len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not any(char.isupper() for char in password):
        raise HTTPException(status_code=400, detail="Password must include at least one uppercase letter")
    if not any(char.isdigit() for char in password):
        raise HTTPException(status_code=400, detail="Password must include at least one number")
    if not SPECIAL_PATTERN.search(password):
        raise HTTPException(status_code=400, detail="Password must include at least one special character")


def _normalize_username(username: str) -> str:
    return (username or "").strip()


def _normalize_email(email: Optional[str]) -> str:
    return (email or "").strip().lower()


async def _generate_local_signup_email(db: AsyncSession, username: str) -> str:
    base = "".join(ch for ch in username.lower() if ch.isalnum() or ch in "._")
    base = (base or "user")[:32]

    attempt = 0
    while True:
        suffix = "" if attempt == 0 else f"{attempt}"
        candidate = f"{base}{suffix}@users.tradeaid.local"
        result = await db.execute(select(User.id).where(func.lower(User.email) == candidate))
        if not result.first():
            return candidate
        attempt += 1


def _validate_username_or_raise(username: str):
    value = _normalize_username(username)
    if not USERNAME_PATTERN.match(value):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3-20 chars, start with a letter, and use only letters, numbers, or underscore",
        )


def _validate_access_code_or_raise(access_code: Optional[str]):
    from app.config import get_settings

    expected = str(get_settings().ACCESS_CODE or "").strip()
    if not expected:
        return

    provided = str(access_code or "").strip()
    if provided != expected:
        raise HTTPException(status_code=403, detail="Invalid access code")


def _is_expired(expires_at: Optional[str]) -> bool:
    if not expires_at:
        return True
    try:
        return datetime.utcnow() > datetime.fromisoformat(expires_at)
    except Exception:
        return True


def _auth_meta(user: User) -> dict:
    return dict(user.alert_preferences or {})


def is_email_verified(user: User) -> bool:
    metadata = user.alert_preferences or {}
    verification = metadata.get("email_verification", {})
    if not verification:
        return True
    return bool(verification.get("verified", False))


def is_email_provider_configured() -> bool:
    from app.config import get_settings

    settings = get_settings()
    smtp_ready = bool(settings.SMTP_HOST and settings.SMTP_USERNAME and settings.SMTP_PASSWORD)
    resend_ready = bool(settings.RESEND_API_KEY)
    return smtp_ready or resend_ready


def _set_verification_code(user: User, code: str):
    metadata = _auth_meta(user)
    metadata["email_verification"] = {
        "code": code,
        "expires_at": datetime.utcnow().replace(microsecond=0).isoformat(),
        "valid_until": (datetime.utcnow()).replace(microsecond=0).isoformat(),
        "verified": False,
    }
    metadata["email_verification"]["valid_until"] = (datetime.utcnow()).replace(microsecond=0).isoformat()
    metadata["email_verification"]["expires_at"] = (datetime.utcnow()).replace(microsecond=0).isoformat()


def _set_password_reset_code(user: User, code: str):
    metadata = _auth_meta(user)
    metadata["password_reset"] = {
        "code": code,
        "expires_at": (datetime.utcnow()).replace(microsecond=0).isoformat(),
    }


def _expires_after_minutes(minutes: int) -> str:
    from datetime import timedelta
    return (datetime.utcnow() + timedelta(minutes=minutes)).replace(microsecond=0).isoformat()


async def register_user(
    db: AsyncSession,
    username: str,
    email: Optional[str],
    password: str,
    device_id: Optional[str] = None,
    access_code: Optional[str] = None,
) -> User:
    _validate_access_code_or_raise(access_code)
    _validate_username_or_raise(username)
    _validate_password_or_raise(password)

    username_normalized = _normalize_username(username)
    email_normalized = _normalize_email(email)
    if email_normalized:
        _validate_email_or_raise(email_normalized)
    else:
        email_normalized = await _generate_local_signup_email(db, username_normalized)

    existing = await db.execute(
        select(User).where(or_(func.lower(User.username) == username_normalized.lower(), func.lower(User.email) == email_normalized))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username or email already registered")

    user = User(
        username=username_normalized,
        email=email_normalized,
        hashed_password=hash_password(password),
        device_id=device_id,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    logger.info(f"User registered: {username}")
    return user


async def send_signup_verification_code(db: AsyncSession, user: User) -> dict:
    metadata = _auth_meta(user)
    verification = metadata.get("email_verification", {})
    if verification.get("verified"):
        return {"sent": False, "retry_after_seconds": 0, "email_configured": True}

    last_sent_at = verification.get("last_sent_at")
    if last_sent_at:
        try:
            last_sent = datetime.fromisoformat(last_sent_at)
            elapsed_seconds = (datetime.utcnow() - last_sent).total_seconds()
            if elapsed_seconds < VERIFICATION_RESEND_COOLDOWN_SECONDS:
                return {
                    "sent": False,
                    "retry_after_seconds": int(VERIFICATION_RESEND_COOLDOWN_SECONDS - elapsed_seconds),
                    "email_configured": True,
                }
        except Exception:
            pass

    code = _generate_code()
    metadata["email_verification"] = {
        "code": code,
        "expires_at": _expires_after_minutes(10),
        "verified": False,
        "last_sent_at": datetime.utcnow().replace(microsecond=0).isoformat(),
    }
    user.alert_preferences = metadata
    await db.flush()
    sent = send_email_code(user.email, "TradeAid - Verify your email", code, "signup verification")
    return {
        "sent": sent,
        "retry_after_seconds": VERIFICATION_RESEND_COOLDOWN_SECONDS,
        "email_configured": sent,
    }


async def verify_signup_code(db: AsyncSession, email: str, code: str) -> bool:
    _validate_email_or_raise(email)
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")

    metadata = user.alert_preferences or {}
    verification = metadata.get("email_verification", {})
    if not verification:
        raise HTTPException(status_code=400, detail="No verification code requested")
    if _is_expired(verification.get("expires_at")):
        raise HTTPException(status_code=400, detail="Verification code expired")
    if str(verification.get("code")) != str(code):
        raise HTTPException(status_code=400, detail="Invalid verification code")

    verification["verified"] = True
    verification["code"] = None
    verification["expires_at"] = None
    metadata["email_verification"] = verification
    user.alert_preferences = metadata
    await db.flush()
    return True


async def request_password_reset_code(db: AsyncSession, email: str) -> None:
    _validate_email_or_raise(email)
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        return

    code = _generate_code()
    metadata = _auth_meta(user)
    metadata["password_reset"] = {
        "code": code,
        "expires_at": _expires_after_minutes(10),
    }
    user.alert_preferences = metadata
    await db.flush()
    send_email_code(user.email, "TradeAid - Reset your password", code, "password reset")


async def confirm_password_reset(db: AsyncSession, email: str, code: str, new_password: str) -> bool:
    _validate_email_or_raise(email)
    _validate_password_or_raise(new_password)
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")

    metadata = user.alert_preferences or {}
    reset = metadata.get("password_reset", {})
    if not reset:
        raise HTTPException(status_code=400, detail="No reset code requested")
    if _is_expired(reset.get("expires_at")):
        raise HTTPException(status_code=400, detail="Reset code expired")
    if str(reset.get("code")) != str(code):
        raise HTTPException(status_code=400, detail="Invalid reset code")

    user.hashed_password = hash_password(new_password)
    metadata["password_reset"] = {"code": None, "expires_at": None}
    user.alert_preferences = metadata
    await db.flush()
    return True


async def authenticate_user(
    db: AsyncSession, username: str, password: str
) -> Optional[User]:
    identifier = (username or "").strip()
    if not identifier:
        return None
    identifier_lower = identifier.lower()
    result = await db.execute(
        select(User).where(
            (func.lower(User.username) == identifier_lower)
            | (func.lower(User.email) == identifier_lower)
        )
    )
    user = result.scalar_one_or_none()
    if not user or not verify_password(password, user.hashed_password):
        return None
    return user


async def login_user(
    db: AsyncSession,
    username: str,
    password: str,
    totp_code: Optional[str] = None,
    device_id: Optional[str] = None,
    access_code: Optional[str] = None,
) -> dict:
    _validate_access_code_or_raise(access_code)
    user = await authenticate_user(db, username, password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    if not is_email_verified(user):
        if is_email_provider_configured():
            raise HTTPException(status_code=403, detail="Email not verified. Please verify your email code.")

        metadata = dict(user.alert_preferences or {})
        verification = dict(metadata.get("email_verification") or {})
        verification["verified"] = True
        verification["code"] = None
        verification["expires_at"] = None
        metadata["email_verification"] = verification
        user.alert_preferences = metadata
        await db.flush()

    if user.totp_enabled:
        if not totp_code:
            raise HTTPException(status_code=400, detail="2FA code required")
        if not verify_totp(user.totp_secret, totp_code):
            raise HTTPException(status_code=401, detail="Invalid 2FA code")

    if device_id and user.device_id and user.device_id != device_id:
        logger.warning(f"Device mismatch for user {username}")

    token_data = {"sub": str(user.id), "username": user.username, "is_admin": user.is_admin}
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    logger.info(f"User logged in: {username}")
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user_id": str(user.id),
    }


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    master_key: Optional[str] = Depends(api_key_header),
    db: AsyncSession = Depends(get_db),
) -> User:
    if master_key and validate_master_key(master_key):
        result = await db.execute(select(User).where(User.is_admin == True).limit(1))
        admin = result.scalar_one_or_none()
        if admin:
            return admin
        raise HTTPException(status_code=403, detail="No admin user configured")

    if not credentials:
        logger.warning("[Auth:JWT] Missing bearer token")
        raise HTTPException(status_code=401, detail="Authentication required")

    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        logger.warning("[Auth:JWT] Invalid or expired token")
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        logger.warning(f"[Auth:JWT] User not found or inactive for sub={user_id}")
        raise HTTPException(status_code=401, detail="User not found or inactive")

    return user


async def setup_2fa(db: AsyncSession, user: User) -> dict:
    secret = generate_totp_secret()
    user.totp_secret = secret
    await db.flush()
    uri = get_totp_provisioning_uri(secret, user.username)
    return {"secret": secret, "provisioning_uri": uri}


async def enable_2fa(db: AsyncSession, user: User, code: str) -> bool:
    if not user.totp_secret:
        raise HTTPException(status_code=400, detail="2FA not set up")
    if not verify_totp(user.totp_secret, code):
        raise HTTPException(status_code=400, detail="Invalid 2FA code")
    user.totp_enabled = True
    await db.flush()
    return True


async def generate_user_api_key(db: AsyncSession, user: User) -> str:
    import secrets
    raw_key = secrets.token_urlsafe(48)
    user.encrypted_api_key = encrypt_api_key(raw_key)
    await db.flush()
    return raw_key


def get_user_profile(user: User) -> dict:
    metadata = user.alert_preferences or {}
    profile = metadata.get("profile", {})
    return {
        "display_name": profile.get("display_name") or user.username,
        "avatar_url": profile.get("avatar_url"),
    }


async def update_user_profile(
    db: AsyncSession,
    user: User,
    username: Optional[str] = None,
    display_name: Optional[str] = None,
    avatar_url: Optional[str] = None,
    telemetry_opt_in: Optional[bool] = None,
) -> User:
    new_username = _normalize_username(username) if username else None
    if new_username and new_username != user.username:
        _validate_username_or_raise(new_username)
        result = await db.execute(
            select(User).where(and_(func.lower(User.username) == new_username.lower(), User.id != user.id))
        )
        if result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Username already taken")
        user.username = new_username

    metadata = dict(_auth_meta(user) or {})
    profile = dict(metadata.get("profile") or {})
    privacy = dict(metadata.get("privacy") or {})

    if display_name is not None:
        profile["display_name"] = display_name.strip()[:64]
    if avatar_url is not None:
        cleaned_avatar = avatar_url.strip()
        if not cleaned_avatar:
            profile["avatar_url"] = None
        elif cleaned_avatar.startswith("data:image/"):
            if len(cleaned_avatar) > 350000:
                raise HTTPException(status_code=400, detail="Avatar image is too large")
            profile["avatar_url"] = cleaned_avatar
        else:
            profile["avatar_url"] = cleaned_avatar[:2048]

    if telemetry_opt_in is not None:
        privacy["telemetry_opt_in"] = bool(telemetry_opt_in)

    metadata["profile"] = profile
    metadata["privacy"] = privacy
    user.alert_preferences = metadata
    await db.flush()
    return user


async def check_username_availability(db: AsyncSession, username: str) -> dict:
    value = _normalize_username(username)
    if not USERNAME_PATTERN.match(value):
        return {
            "username": value,
            "available": False,
            "valid": False,
            "message": "Username must be 3-20 chars, start with a letter, and use only letters, numbers, or underscore",
        }

    result = await db.execute(select(User).where(func.lower(User.username) == value.lower()))
    taken = result.scalar_one_or_none() is not None
    return {
        "username": value,
        "available": not taken,
        "valid": True,
        "message": "Username is available" if not taken else "Username is already taken",
    }
