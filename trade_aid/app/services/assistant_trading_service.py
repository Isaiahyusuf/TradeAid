import secrets
from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_enabled_chains
from app.models.models import AssistantTrade, User
from app.utils.security import decrypt_api_key


CONFIRMATION_PHRASE = "I_APPROVE_ASSISTANT_TRADING"


def _metadata(user: User) -> dict[str, Any]:
    return dict(user.alert_preferences or {})


def _get_trading_config(user: User) -> dict[str, Any]:
    return dict((_metadata(user).get("assistant_trading") or {}))


def _set_trading_config(user: User, config: dict[str, Any]) -> None:
    metadata = _metadata(user)
    metadata["assistant_trading"] = config
    user.alert_preferences = metadata


def _utcnow() -> datetime:
    return datetime.utcnow()


def trading_status(user: User) -> dict[str, Any]:
    cfg = _get_trading_config(user)
    enabled_chains = get_enabled_chains()
    return {
        "enabled": bool(cfg.get("enabled", False)),
        "pending_approval": bool(cfg.get("pending_approval", False)),
        "consent_id": cfg.get("consent_id"),
        "consent_expires_at": cfg.get("consent_expires_at"),
        "approved_at": cfg.get("approved_at"),
        "mode": cfg.get("mode", "paper"),
        "wallet_address": cfg.get("wallet_address"),
        "wallets_by_chain": cfg.get("wallets_by_chain", {}),
        "enabled_chains": enabled_chains,
        "risk_limits": cfg.get("risk_limits", {}),
        "last_revoked_at": cfg.get("last_revoked_at"),
    }


def request_consent(
    user: User,
    wallet_address: str,
    wallets_by_chain: dict[str, str],
    mode: str,
    risk_limits: dict[str, Any],
) -> dict[str, Any]:
    normalized_mode = (mode or "paper").strip().lower()
    if normalized_mode not in {"paper", "live"}:
        raise HTTPException(status_code=400, detail="mode must be paper or live")

    enabled_chains = get_enabled_chains()
    cleaned_wallet = (wallet_address or "").strip()

    normalized_wallets: dict[str, str] = {}
    for chain_key, chain_wallet in (wallets_by_chain or {}).items():
        normalized_chain = str(chain_key or "").strip().lower()
        if normalized_chain not in enabled_chains:
            continue
        normalized_wallet = str(chain_wallet or "").strip()
        if normalized_wallet:
            normalized_wallets[normalized_chain] = normalized_wallet

    if cleaned_wallet and not normalized_wallets:
        normalized_wallets = {chain_name: cleaned_wallet for chain_name in enabled_chains}
    elif cleaned_wallet and normalized_wallets:
        for chain_name in enabled_chains:
            normalized_wallets.setdefault(chain_name, cleaned_wallet)

    if not normalized_wallets:
        raise HTTPException(status_code=400, detail="Provide wallet_address or wallets_by_chain for enabled chains")

    if not cleaned_wallet:
        cleaned_wallet = next(iter(normalized_wallets.values()))

    consent_id = secrets.token_urlsafe(18)
    expires_at = (_utcnow() + timedelta(minutes=30)).isoformat()

    cfg = _get_trading_config(user)
    cfg.update(
        {
            "enabled": False,
            "pending_approval": True,
            "consent_id": consent_id,
            "consent_expires_at": expires_at,
            "requested_at": _utcnow().isoformat(),
            "approved_at": None,
            "mode": normalized_mode,
            "wallet_address": cleaned_wallet,
            "wallets_by_chain": normalized_wallets,
            "risk_limits": {
                "max_notional_usd_per_trade": float(risk_limits.get("max_notional_usd_per_trade", 50.0) or 50.0),
                "max_trades_per_day": int(risk_limits.get("max_trades_per_day", 10) or 10),
                "max_daily_loss_usd": float(risk_limits.get("max_daily_loss_usd", 100.0) or 100.0),
            },
        }
    )
    _set_trading_config(user, cfg)

    return {
        "consent_id": consent_id,
        "consent_expires_at": expires_at,
        "confirmation_phrase": CONFIRMATION_PHRASE,
    }


def approve_consent(user: User, consent_id: str, confirmation_text: str) -> dict[str, Any]:
    cfg = _get_trading_config(user)
    if not cfg.get("pending_approval"):
        raise HTTPException(status_code=400, detail="No pending consent request")

    if (cfg.get("consent_id") or "") != (consent_id or "").strip():
        raise HTTPException(status_code=400, detail="Invalid consent_id")

    if (confirmation_text or "").strip() != CONFIRMATION_PHRASE:
        raise HTTPException(status_code=400, detail="Invalid confirmation text")

    expires_at_raw = cfg.get("consent_expires_at")
    if not expires_at_raw:
        raise HTTPException(status_code=400, detail="Consent request expired")

    try:
        expires_at = datetime.fromisoformat(str(expires_at_raw))
    except Exception:
        raise HTTPException(status_code=400, detail="Consent request expired")

    if _utcnow() > expires_at:
        cfg["pending_approval"] = False
        cfg["enabled"] = False
        _set_trading_config(user, cfg)
        raise HTTPException(status_code=400, detail="Consent request expired")

    cfg["enabled"] = True
    cfg["pending_approval"] = False
    cfg["approved_at"] = _utcnow().isoformat()
    _set_trading_config(user, cfg)
    return trading_status(user)


def revoke_consent(user: User) -> dict[str, Any]:
    cfg = _get_trading_config(user)
    cfg["enabled"] = False
    cfg["pending_approval"] = False
    cfg["consent_id"] = None
    cfg["consent_expires_at"] = None
    cfg["last_revoked_at"] = _utcnow().isoformat()
    _set_trading_config(user, cfg)
    return trading_status(user)


async def _enforce_risk_limits(
    db: AsyncSession,
    user: User,
    notional_usd: float,
    cfg: dict[str, Any],
) -> dict[str, Any]:
    limits = cfg.get("risk_limits") or {}
    max_notional = float(limits.get("max_notional_usd_per_trade", 50.0) or 50.0)
    max_trades_per_day = int(limits.get("max_trades_per_day", 10) or 10)
    max_daily_loss = float(limits.get("max_daily_loss_usd", 100.0) or 100.0)

    if notional_usd <= 0:
        raise HTTPException(status_code=400, detail="notional_usd must be greater than zero")
    if notional_usd > max_notional:
        raise HTTPException(status_code=400, detail=f"Trade blocked by risk: notional exceeds {max_notional}")

    day_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    trades_today_q = await db.execute(
        select(func.count(AssistantTrade.id)).where(
            AssistantTrade.user_id == user.id,
            AssistantTrade.created_at >= day_start,
        )
    )
    trades_today = int(trades_today_q.scalar() or 0)
    if trades_today >= max_trades_per_day:
        raise HTTPException(status_code=400, detail="Trade blocked by risk: daily trade limit reached")

    pnl_today_q = await db.execute(
        select(func.coalesce(func.sum(AssistantTrade.pnl_usd), 0.0)).where(
            AssistantTrade.user_id == user.id,
            AssistantTrade.created_at >= day_start,
        )
    )
    pnl_today = float(pnl_today_q.scalar() or 0.0)
    if pnl_today <= (-1.0 * max_daily_loss):
        raise HTTPException(status_code=400, detail="Trade blocked by risk: max daily loss reached")

    return {
        "max_notional_usd_per_trade": max_notional,
        "max_trades_per_day": max_trades_per_day,
        "max_daily_loss_usd": max_daily_loss,
        "trades_today": trades_today,
        "pnl_today": pnl_today,
    }


async def execute_assistant_trade(
    db: AsyncSession,
    user: User,
    *,
    chain: str,
    contract_address: str,
    side: str,
    notional_usd: float,
    requested_mode: str | None,
    decision_context: dict[str, Any] | None,
) -> dict[str, Any]:
    cfg = _get_trading_config(user)
    if not cfg.get("enabled"):
        raise HTTPException(status_code=403, detail="Assistant trading is not enabled for this user")

    enabled_chains = get_enabled_chains()

    normalized_side = (side or "").strip().lower()
    if normalized_side not in {"buy", "sell"}:
        raise HTTPException(status_code=400, detail="side must be buy or sell")

    mode = (requested_mode or cfg.get("mode") or "paper").strip().lower()
    if mode not in {"paper", "live"}:
        raise HTTPException(status_code=400, detail="mode must be paper or live")

    risk_snapshot = await _enforce_risk_limits(db, user, float(notional_usd), cfg)

    normalized_chain = (chain or "").strip().lower()
    normalized_contract = (contract_address or "").strip()
    if not normalized_chain or not normalized_contract:
        raise HTTPException(status_code=400, detail="chain and contract_address are required")
    if normalized_chain not in enabled_chains:
        raise HTTPException(status_code=400, detail=f"Unsupported chain '{normalized_chain}'")

    wallets_by_chain = dict(cfg.get("wallets_by_chain") or {})
    configured_wallet = str(wallets_by_chain.get(normalized_chain) or cfg.get("wallet_address") or "").strip()
    if not configured_wallet:
        raise HTTPException(status_code=400, detail=f"No wallet configured for chain '{normalized_chain}'")

    market = (decision_context or {}).get("market", {}) if isinstance(decision_context, dict) else {}
    market_price = float(market.get("current_price_usd", 0) or market.get("price_usd", 0) or 0)
    quantity = (float(notional_usd) / market_price) if market_price > 0 else None

    status = "filled"
    external_order_id = None
    if mode == "live":
        if not user.encrypted_api_key:
            raise HTTPException(status_code=400, detail="Live mode requires user API key configuration")
        try:
            decrypt_api_key(user.encrypted_api_key)
        except Exception:
            raise HTTPException(status_code=400, detail="Stored API key is invalid. Regenerate API key.")

        status = "submitted"
        external_order_id = f"live-{secrets.token_hex(8)}"

    trade = AssistantTrade(
        user_id=user.id,
        chain=normalized_chain,
        contract_address=normalized_contract,
        side=normalized_side,
        mode=mode,
        status=status,
        notional_usd=float(notional_usd),
        quantity=quantity,
        price_usd=market_price if market_price > 0 else None,
        fees_usd=round(float(notional_usd) * 0.001, 6),
        pnl_usd=0.0,
        external_order_id=external_order_id,
        decision_context=decision_context or {},
        risk_snapshot=risk_snapshot,
    )
    db.add(trade)
    await db.flush()

    return {
        "trade_id": str(trade.id),
        "status": trade.status,
        "mode": trade.mode,
        "side": trade.side,
        "chain": trade.chain,
        "contract_address": trade.contract_address,
        "notional_usd": trade.notional_usd,
        "quantity": trade.quantity,
        "price_usd": trade.price_usd,
        "fees_usd": trade.fees_usd,
        "external_order_id": trade.external_order_id,
        "wallet_address_used": configured_wallet,
        "risk_snapshot": risk_snapshot,
    }