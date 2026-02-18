from datetime import datetime
from typing import Optional
from uuid import UUID
from sqlalchemy import select
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

bearer_scheme = HTTPBearer(auto_error=False)
api_key_header = APIKeyHeader(name="X-Master-Key", auto_error=False)


async def register_user(
    db: AsyncSession,
    username: str,
    email: str,
    password: str,
    device_id: Optional[str] = None,
) -> User:
    existing = await db.execute(
        select(User).where((User.username == username) | (User.email == email))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username or email already registered")

    user = User(
        username=username,
        email=email,
        hashed_password=hash_password(password),
        device_id=device_id,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    logger.info(f"User registered: {username}")
    return user


async def authenticate_user(
    db: AsyncSession, username: str, password: str
) -> Optional[User]:
    result = await db.execute(select(User).where(User.username == username))
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
) -> dict:
    user = await authenticate_user(db, username, password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

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
        raise HTTPException(status_code=401, detail="Authentication required")

    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
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
