from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.auth_service import (
    register_user, login_user, get_current_user,
    setup_2fa, enable_2fa, generate_user_api_key,
)
from app.models.models import User

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    device_id: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str
    totp_code: Optional[str] = None
    device_id: Optional[str] = None


class Enable2FARequest(BaseModel):
    code: str


@router.post("/register")
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    user = await register_user(db, req.username, req.email, req.password, req.device_id)
    return {"user_id": str(user.id), "username": user.username}


@router.post("/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    return await login_user(db, req.username, req.password, req.totp_code, req.device_id)


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    return {
        "user_id": str(user.id),
        "username": user.username,
        "email": user.email,
        "is_admin": user.is_admin,
        "totp_enabled": user.totp_enabled,
        "device_id": user.device_id,
    }


@router.post("/2fa/setup")
async def setup_totp(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await setup_2fa(db, user)


@router.post("/2fa/enable")
async def enable_totp(
    req: Enable2FARequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    success = await enable_2fa(db, user, req.code)
    return {"enabled": success}


@router.post("/api-key/generate")
async def generate_api_key(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    key = await generate_user_api_key(db, user)
    return {"api_key": key, "warning": "Store this key securely. It cannot be retrieved again."}
