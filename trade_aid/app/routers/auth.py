from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.auth_service import (
    register_user, login_user, get_current_user,
    setup_2fa, enable_2fa, generate_user_api_key,
    send_signup_verification_code, verify_signup_code,
    request_password_reset_code, confirm_password_reset,
    is_email_verified, get_user_profile, update_user_profile,
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


class VerifyEmailRequest(BaseModel):
    email: str
    code: str


class ResendVerificationRequest(BaseModel):
    email: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ConfirmPasswordResetRequest(BaseModel):
    email: str
    code: str
    new_password: str


class UpdateProfileRequest(BaseModel):
    username: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None


@router.post("/register")
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    user = await register_user(db, req.username, req.email, req.password, req.device_id)
    verification_result = await send_signup_verification_code(db, user)
    return {
        "user_id": str(user.id),
        "username": user.username,
        "email": user.email,
        "requires_email_verification": True,
        "verification_email_sent": bool(verification_result.get("sent", False)),
        "retry_after_seconds": int(verification_result.get("retry_after_seconds", 60)),
    }


@router.post("/verify-email")
async def verify_email(req: VerifyEmailRequest, db: AsyncSession = Depends(get_db)):
    success = await verify_signup_code(db, req.email, req.code)
    return {"verified": success}


@router.post("/resend-verification")
async def resend_verification(req: ResendVerificationRequest, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    response = {"sent": True, "retry_after_seconds": 60}
    if user:
        verification_result = await send_signup_verification_code(db, user)
        response = {
            "sent": bool(verification_result.get("sent", False)),
            "retry_after_seconds": int(verification_result.get("retry_after_seconds", 60)),
        }
    return response


@router.post("/forgot-password/request-code")
async def forgot_password_request(req: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    await request_password_reset_code(db, req.email)
    return {"sent": True}


@router.post("/forgot-password/confirm")
async def forgot_password_confirm(req: ConfirmPasswordResetRequest, db: AsyncSession = Depends(get_db)):
    success = await confirm_password_reset(db, req.email, req.code, req.new_password)
    return {"reset": success}


@router.post("/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    return await login_user(db, req.username, req.password, req.totp_code, req.device_id)


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    profile = get_user_profile(user)
    return {
        "user_id": str(user.id),
        "username": user.username,
        "email": user.email,
        "is_admin": user.is_admin,
        "totp_enabled": user.totp_enabled,
        "device_id": user.device_id,
        "email_verified": is_email_verified(user),
        "display_name": profile.get("display_name"),
        "avatar_url": profile.get("avatar_url"),
    }


@router.patch("/profile")
async def update_profile(
    req: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    updated = await update_user_profile(
        db,
        user,
        username=req.username,
        display_name=req.display_name,
        avatar_url=req.avatar_url,
    )
    profile = get_user_profile(updated)
    return {
        "user_id": str(updated.id),
        "username": updated.username,
        "email": updated.email,
        "is_admin": updated.is_admin,
        "totp_enabled": updated.totp_enabled,
        "device_id": updated.device_id,
        "email_verified": is_email_verified(updated),
        "display_name": profile.get("display_name"),
        "avatar_url": profile.get("avatar_url"),
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
