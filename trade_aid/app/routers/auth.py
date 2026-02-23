import secrets
from datetime import datetime, timedelta
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import get_settings
from app.database import get_db
from app.services.push_notification_service import push_notification_service
from app.services.auth_service import (
    register_user, login_user, get_current_user,
    setup_2fa, enable_2fa, generate_user_api_key,
    send_signup_verification_code, verify_signup_code,
    request_password_reset_code, confirm_password_reset,
    is_email_verified, get_user_profile, update_user_profile,
    check_username_availability,
)
from app.models.models import User
from app.utils.security import create_access_token, create_refresh_token, hash_password

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
settings = get_settings()


class RegisterRequest(BaseModel):
    username: str
    email: Optional[str] = None
    password: str
    device_id: Optional[str] = None
    access_code: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str
    totp_code: Optional[str] = None
    device_id: Optional[str] = None
    access_code: Optional[str] = None


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
    telemetry_opt_in: Optional[bool] = None


class PushTokenRequest(BaseModel):
    expo_push_token: str


def _normalize_frontend_redirect(redirect_uri: Optional[str]) -> str:
    requested = (redirect_uri or "").strip()
    if requested.startswith("http://") or requested.startswith("https://"):
        return requested

    if settings.OAUTH_FRONTEND_URL:
        return settings.OAUTH_FRONTEND_URL.strip()

    allowed = [origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip() and origin.strip() != "*"]
    if allowed:
        return allowed[0]

    return "http://localhost:5173"


def _append_query_params(url: str, params: dict[str, str]) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.update(params)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, urlencode(query), parsed.fragment))


def _build_oauth_state(provider: str, frontend_redirect: str) -> str:
    payload = {
        "provider": provider,
        "frontend_redirect": frontend_redirect,
        "nonce": secrets.token_urlsafe(12),
        "exp": datetime.utcnow() + timedelta(minutes=10),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def _decode_oauth_state(state: str, provider: str) -> str:
    try:
        payload = jwt.decode(state, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    if payload.get("provider") != provider:
        raise HTTPException(status_code=400, detail="Invalid OAuth provider state")

    frontend_redirect = str(payload.get("frontend_redirect") or "").strip()
    if not frontend_redirect:
        raise HTTPException(status_code=400, detail="Missing OAuth redirect target")

    return frontend_redirect


def _build_unique_username(base_value: str) -> str:
    cleaned = "".join(ch for ch in base_value.lower() if ch.isalnum() or ch == "_")
    cleaned = cleaned[:20] if cleaned else "trader"
    return cleaned or "trader"


async def _resolve_or_create_oauth_user(
    db: AsyncSession,
    provider: str,
    provider_sub: str,
    email: str,
    display_name: str,
) -> User:
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if not user:
        base_username = _build_unique_username(display_name or email.split("@")[0])
        candidate = base_username
        suffix = 1

        while True:
            username_result = await db.execute(select(User).where(User.username == candidate))
            if not username_result.scalar_one_or_none():
                break
            suffix += 1
            candidate = f"{base_username[:16]}{suffix}"

        metadata = {
            "profile": {
                "display_name": display_name or candidate,
            },
            "oauth": {
                provider: {
                    "sub": provider_sub,
                }
            },
        }
        user = User(
            username=candidate,
            email=email,
            hashed_password=hash_password(secrets.token_urlsafe(32)),
            alert_preferences=metadata,
        )
        db.add(user)
        await db.flush()
        await db.refresh(user)
        return user

    metadata = dict(user.alert_preferences or {})
    profile = dict(metadata.get("profile") or {})
    oauth = dict(metadata.get("oauth") or {})
    provider_meta = dict(oauth.get(provider) or {})
    provider_meta["sub"] = provider_sub
    oauth[provider] = provider_meta
    metadata["oauth"] = oauth
    if display_name and not profile.get("display_name"):
        profile["display_name"] = display_name[:64]
    metadata["profile"] = profile
    user.alert_preferences = metadata
    await db.flush()
    return user


async def _google_exchange_code(code: str, redirect_uri: str) -> tuple[str, str, str]:
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="Google OAuth is not configured")

    async with httpx.AsyncClient(timeout=20) as client:
        token_res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_res.status_code >= 400:
            raise HTTPException(status_code=400, detail="Google token exchange failed")
        token_data = token_res.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail="Google access token missing")

        user_res = await client.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_res.status_code >= 400:
            raise HTTPException(status_code=400, detail="Google profile fetch failed")
        profile = user_res.json()

    provider_sub = str(profile.get("sub") or "")
    email = str(profile.get("email") or "").strip().lower()
    name = str(profile.get("name") or profile.get("given_name") or email.split("@")[0] or "Trader")
    if not provider_sub or not email:
        raise HTTPException(status_code=400, detail="Google profile incomplete")
    return provider_sub, email, name


def _apple_client_secret() -> str:
    if not settings.APPLE_TEAM_ID or not settings.APPLE_KEY_ID or not settings.APPLE_PRIVATE_KEY or not settings.APPLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Apple OAuth is not configured")

    private_key = settings.APPLE_PRIVATE_KEY.replace("\\n", "\n")
    now = datetime.utcnow()
    payload = {
        "iss": settings.APPLE_TEAM_ID,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=180)).timestamp()),
        "aud": "https://appleid.apple.com",
        "sub": settings.APPLE_CLIENT_ID,
    }
    return jwt.encode(payload, private_key, algorithm="ES256", headers={"kid": settings.APPLE_KEY_ID})


async def _apple_exchange_code(code: str, redirect_uri: str) -> tuple[str, str, str]:
    client_secret = _apple_client_secret()

    async with httpx.AsyncClient(timeout=20) as client:
        token_res = await client.post(
            "https://appleid.apple.com/auth/token",
            data={
                "client_id": settings.APPLE_CLIENT_ID,
                "client_secret": client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if token_res.status_code >= 400:
            raise HTTPException(status_code=400, detail="Apple token exchange failed")
        token_data = token_res.json()

    id_token = token_data.get("id_token")
    if not id_token:
        raise HTTPException(status_code=400, detail="Apple id_token missing")

    claims = jwt.get_unverified_claims(id_token)
    provider_sub = str(claims.get("sub") or "")
    email = str(claims.get("email") or "").strip().lower()
    if not email:
        email = f"apple_{provider_sub[:20]}@apple.tradeaid.local"
    name = email.split("@")[0]

    if not provider_sub:
        raise HTTPException(status_code=400, detail="Apple profile incomplete")

    return provider_sub, email, name


def _build_oauth_redirect(frontend_redirect: str, access_token: str, refresh_token: str) -> str:
    return _append_query_params(
        frontend_redirect,
        {
            "oauth_access_token": access_token,
            "oauth_refresh_token": refresh_token,
            "oauth_success": "1",
        },
    )


def _build_oauth_error_redirect(frontend_redirect: str, message: str) -> str:
    return _append_query_params(frontend_redirect, {"oauth_error": message})


@router.post("/register")
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    user = await register_user(db, req.username, req.email, req.password, req.device_id, req.access_code)
    if req.email and str(req.email).strip():
        verification_result = await send_signup_verification_code(db, user)
        verification_sent = bool(verification_result.get("sent", False))
    else:
        verification_result = {"sent": False, "retry_after_seconds": 0}
        verification_sent = False

    if not verification_sent:
        metadata = dict(user.alert_preferences or {})
        verification = dict(metadata.get("email_verification") or {})
        verification["verified"] = True
        verification["code"] = None
        verification["expires_at"] = None
        metadata["email_verification"] = verification
        user.alert_preferences = metadata
        await db.flush()

    return {
        "user_id": str(user.id),
        "username": user.username,
        "email": user.email,
        "requires_email_verification": verification_sent,
        "verification_email_sent": verification_sent,
        "email_delivery_configured": verification_sent,
        "retry_after_seconds": int(verification_result.get("retry_after_seconds", 60)),
    }


@router.get("/check-username")
async def check_username(username: str = Query(..., min_length=1), db: AsyncSession = Depends(get_db)):
    return await check_username_availability(db, username)


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
    return await login_user(db, req.username, req.password, req.totp_code, req.device_id, req.access_code)


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    profile = get_user_profile(user)
    privacy = (user.alert_preferences or {}).get("privacy", {})
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
        "telemetry_opt_in": bool(privacy.get("telemetry_opt_in", False)),
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
        telemetry_opt_in=req.telemetry_opt_in,
    )
    await db.refresh(updated)
    profile = get_user_profile(updated)
    privacy = (updated.alert_preferences or {}).get("privacy", {})
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
        "telemetry_opt_in": bool(privacy.get("telemetry_opt_in", False)),
    }


@router.post("/push-token")
async def register_push_token(
    req: PushTokenRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    token = str(req.expo_push_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="expo_push_token is required")
    if not (token.startswith("ExponentPushToken[") or token.startswith("ExpoPushToken[")):
        raise HTTPException(status_code=400, detail="Invalid Expo push token format")

    metadata = dict(user.alert_preferences or {})
    push_meta = dict(metadata.get("push") or {})
    existing = push_meta.get("expo_tokens") or []
    if isinstance(existing, str):
        existing = [existing]

    normalized = [str(item).strip() for item in existing if str(item).strip()]
    if token not in normalized:
        normalized.insert(0, token)
    push_meta["expo_tokens"] = normalized[:5]
    metadata["push"] = push_meta
    user.alert_preferences = metadata
    await db.flush()

    return {"status": "registered", "token_count": len(push_meta["expo_tokens"]) }


@router.post("/push-token/test")
async def send_push_test(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sent = await push_notification_service.send_alert_push(
        db,
        title="TradeAid Test Notification",
        body="Push notifications with sound are now connected.",
        data={"type": "push_test", "user_id": str(user.id)},
    )
    return {"sent": sent}


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


@router.get("/oauth/{provider}/start")
async def oauth_start(
    provider: str,
    request: Request,
    redirect_uri: Optional[str] = Query(default=None),
):
    provider_key = provider.lower().strip()
    if provider_key not in {"google", "apple"}:
        raise HTTPException(status_code=400, detail="Unsupported OAuth provider")

    frontend_redirect = _normalize_frontend_redirect(redirect_uri)
    state = _build_oauth_state(provider_key, frontend_redirect)
    callback_uri = str(request.url_for("oauth_callback_get", provider=provider_key))

    if provider_key == "google":
        if not settings.GOOGLE_CLIENT_ID:
            raise HTTPException(status_code=503, detail="Google OAuth is not configured")
        auth_url = (
            "https://accounts.google.com/o/oauth2/v2/auth?"
            + urlencode(
                {
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "redirect_uri": callback_uri,
                    "response_type": "code",
                    "scope": "openid email profile",
                    "access_type": "offline",
                    "prompt": "select_account",
                    "state": state,
                }
            )
        )
    else:
        if not settings.APPLE_CLIENT_ID:
            raise HTTPException(status_code=503, detail="Apple OAuth is not configured")
        auth_url = (
            "https://appleid.apple.com/auth/authorize?"
            + urlencode(
                {
                    "client_id": settings.APPLE_CLIENT_ID,
                    "redirect_uri": callback_uri,
                    "response_type": "code",
                    "response_mode": "form_post",
                    "scope": "name email",
                    "state": state,
                }
            )
        )

    return RedirectResponse(auth_url)


@router.get("/oauth/{provider}/callback", name="oauth_callback_get")
async def oauth_callback_get(
    provider: str,
    request: Request,
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    provider_key = provider.lower().strip()
    if provider_key not in {"google", "apple"}:
        raise HTTPException(status_code=400, detail="Unsupported OAuth provider")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing OAuth callback parameters")

    frontend_redirect = _decode_oauth_state(state, provider_key)

    try:
        callback_uri = str(request.url_for("oauth_callback_get", provider=provider_key))
        if provider_key == "google":
            provider_sub, email, name = await _google_exchange_code(code, callback_uri)
        else:
            provider_sub, email, name = await _apple_exchange_code(code, callback_uri)

        user = await _resolve_or_create_oauth_user(
            db=db,
            provider=provider_key,
            provider_sub=provider_sub,
            email=email,
            display_name=name,
        )

        token_data = {"sub": str(user.id), "username": user.username, "is_admin": user.is_admin}
        access_token = create_access_token(token_data)
        refresh_token = create_refresh_token(token_data)
        redirect_target = _build_oauth_redirect(frontend_redirect, access_token, refresh_token)
        return RedirectResponse(redirect_target)
    except HTTPException as exc:
        return RedirectResponse(_build_oauth_error_redirect(frontend_redirect, str(exc.detail)))
    except Exception:
        return RedirectResponse(_build_oauth_error_redirect(frontend_redirect, "OAuth login failed"))


@router.post("/oauth/{provider}/callback", name="oauth_callback_post")
async def oauth_callback_post(
    provider: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    form = await request.form()
    code = form.get("code")
    state = form.get("state")
    return await oauth_callback_get(
        provider=provider,
        request=request,
        code=str(code) if code else None,
        state=str(state) if state else None,
        db=db,
    )
