import hashlib
import hmac
import base64
import os
from datetime import datetime, timedelta
from typing import Optional
from jose import jwt, JWTError
from passlib.context import CryptContext
from cryptography.fernet import Fernet
from app.config import get_settings

settings = get_settings()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def get_fernet_key() -> bytes:
    key = settings.ENCRYPTION_KEY.encode()
    return base64.urlsafe_b64encode(hashlib.sha256(key).digest())


fernet = Fernet(get_fernet_key())


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta or timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


def validate_master_key(key: str) -> bool:
    return hmac.compare_digest(key, settings.MASTER_ACCESS_KEY)


def encrypt_api_key(api_key: str) -> str:
    return fernet.encrypt(api_key.encode()).decode()


def decrypt_api_key(encrypted_key: str) -> str:
    return fernet.decrypt(encrypted_key.encode()).decode()


def generate_totp_secret() -> str:
    import pyotp
    return pyotp.random_base32()


def verify_totp(secret: str, code: str) -> bool:
    import pyotp
    totp = pyotp.TOTP(secret)
    return totp.verify(code)


def get_totp_provisioning_uri(secret: str, username: str) -> str:
    import pyotp
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=username, issuer_name="Trade Aid")
