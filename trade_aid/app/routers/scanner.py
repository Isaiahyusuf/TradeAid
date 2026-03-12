from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.models import Token
from app.models.models import User
from app.scanners.dexscreener import dex_scanner
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/api/scanner", tags=["Scanner"])
ingest_router = APIRouter(prefix="/api", tags=["Scanner"])


class NewTokenPayload(BaseModel):
    token_name: str = ""
    symbol: str = ""
    mint_address: str
    creator_wallet: str = ""
    timestamp: str = ""
    transaction_signature: str = ""
    initial_liquidity: float | str = 0.0
    market_cap: float | str = 0.0
    volume: float | str = 0.0
    source: str = "pump_fun_listener"
    age_minutes: float | None = None
    dexscreener: dict[str, Any] | None = None
    raw: dict[str, Any] | None = None


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value or default)
    except Exception:
        return default


def _parse_dt(value: Any) -> datetime:
    raw = str(value or "").strip()
    if not raw:
        return datetime.now(tz=timezone.utc).replace(tzinfo=None)
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo:
            return dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return datetime.now(tz=timezone.utc).replace(tzinfo=None)


@router.get("/health")
async def scanner_health(user: User = Depends(get_current_user)):
    _ = user
    return dex_scanner.get_health_snapshot()


@ingest_router.post("/new-token", include_in_schema=False)
async def ingest_new_token(
    payload: NewTokenPayload,
    db: AsyncSession = Depends(get_db),
):
    mint = str(payload.mint_address or "").strip()
    if not mint:
        return {"ok": False, "error": "mint_address_required"}

    chain = "solana"
    existing_result = await db.execute(
        select(Token).where(Token.chain == chain, Token.contract_address == mint)
    )
    token = existing_result.scalar_one_or_none()

    liquidity = _safe_float(payload.initial_liquidity, 0.0)
    market_cap = _safe_float(payload.market_cap, 0.0)
    volume = _safe_float(payload.volume, 0.0)
    created_at = _parse_dt(payload.timestamp)

    metadata = {
        "source": str(payload.source or "pump_fun_listener"),
        "pump_listener": {
            "timestamp": str(payload.timestamp or "").strip(),
            "transaction_signature": str(payload.transaction_signature or "").strip(),
            "creator_wallet": str(payload.creator_wallet or "").strip(),
            "initial_liquidity": liquidity,
            "market_cap": market_cap,
            "volume": volume,
            "age_minutes": payload.age_minutes,
        },
        "dexscreener": payload.dexscreener or {},
        "raw": payload.raw or {},
    }

    if token is None:
        token = Token(
            contract_address=mint,
            chain=chain,
            name=str(payload.token_name or "").strip() or None,
            symbol=str(payload.symbol or "").strip() or None,
            deployer_wallet=str(payload.creator_wallet or "").strip() or None,
            market_cap_usd=market_cap,
            liquidity_usd=liquidity,
            liquidity_created_at=created_at,
            extra_data=metadata,
            created_at=created_at,
        )
        db.add(token)
    else:
        token.name = str(payload.token_name or token.name or "").strip() or token.name
        token.symbol = str(payload.symbol or token.symbol or "").strip() or token.symbol
        token.deployer_wallet = str(payload.creator_wallet or token.deployer_wallet or "").strip() or token.deployer_wallet
        token.market_cap_usd = max(_safe_float(token.market_cap_usd, 0.0), market_cap)
        token.liquidity_usd = max(_safe_float(token.liquidity_usd, 0.0), liquidity)
        token.liquidity_created_at = token.liquidity_created_at or created_at

        merged_meta = dict(token.extra_data or {})
        merged_meta.update(metadata)
        merged_meta["pump_listener"]["volume"] = max(
            _safe_float((token.extra_data or {}).get("pump_listener", {}).get("volume"), 0.0),
            volume,
        )
        token.extra_data = merged_meta

    return {
        "ok": True,
        "mint_address": mint,
        "saved": True,
    }
