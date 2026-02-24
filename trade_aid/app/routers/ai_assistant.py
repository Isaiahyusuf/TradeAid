from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.models import ScoringHistory, Token, User
from app.services.auth_service import get_current_user
from app.services.assistant_context_service import build_user_trading_context
from app.services.assistant_trading_service import (
    approve_consent,
    confirm_wallet_backup,
    create_user_wallet_bundle,
    execute_assistant_trade,
    export_wallet_private_key,
    import_user_wallet_bundle,
    remove_wallet_chain,
    request_consent,
    reveal_wallet_bundle,
    revoke_consent,
    trading_status,
    wallet_status,
)
from app.services.openai_assistant_service import answer_user_question, generate_trade_assist
from app.services.wallet_portfolio_service import get_wallet_portfolio_snapshot

router = APIRouter(prefix="/api/ai", tags=["AI Assistant"])


class AssistRiskConfig(BaseModel):
    max_risk_per_trade_pct: float = 1.0
    max_daily_loss_pct: float = 4.0
    max_trades_per_day: int = 8


class AssistRequest(BaseModel):
    market: dict[str, Any]
    risk: AssistRiskConfig | None = None
    mode: str = "paper"


class AskRequest(BaseModel):
    question: str
    context: dict[str, Any] | None = None


class TradingRiskLimits(BaseModel):
    max_notional_usd_per_trade: float = 50.0
    max_trades_per_day: int = 10
    max_daily_loss_usd: float = 100.0


class ConsentRequest(BaseModel):
    wallet_address: str | None = None
    wallets_by_chain: dict[str, str] | None = None
    mode: str = "paper"
    risk_limits: TradingRiskLimits | None = None


class ConsentApproveRequest(BaseModel):
    consent_id: str
    confirmation_text: str


class ExecuteTradeRequest(BaseModel):
    chain: str
    contract_address: str
    side: str
    notional_usd: float
    mode: str | None = None
    decision_context: dict[str, Any] | None = None


class WalletCreateRequest(BaseModel):
    overwrite: bool = False


class WalletBackupConfirmRequest(BaseModel):
    mnemonic: str


class WalletRevealRequest(BaseModel):
    confirmation_text: str


class WalletImportRequest(BaseModel):
    mnemonic: str
    overwrite: bool = False


class WalletRemoveChainRequest(BaseModel):
    chain: str


class WalletExportKeyRequest(BaseModel):
    chain: str
    confirmation_text: str


@router.post("/assist")
async def assist_decision(
    req: AssistRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    risk = req.risk.model_dump() if req.risk else {
        "max_risk_per_trade_pct": 1.0,
        "max_daily_loss_pct": 4.0,
        "max_trades_per_day": 8,
    }

    auto_context = await build_user_trading_context(db, user.id)
    payload = {
        "market": req.market,
        "risk": risk,
        "mode": req.mode,
        "history_context": auto_context,
        "user": {
            "user_id": str(user.id),
            "is_admin": bool(user.is_admin),
        },
    }
    result = await generate_trade_assist(payload)

    return {
        "assistant": result,
        "guardrails": {
            "execution_blocked_without_risk_approval": True,
            "paper_mode_recommended": True,
        },
        "trading": trading_status(user),
    }


@router.post("/ask")
async def ask_assistant(
    req: AskRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    question = (req.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")

    auto_context = await build_user_trading_context(db, user.id)
    merged_context = dict(req.context or {})
    merged_context["history_context"] = auto_context

    answer = await answer_user_question(question, merged_context)
    return {
        "assistant": answer,
        "user_id": str(user.id),
    }


@router.get("/assist/{chain}/{contract_address}")
async def assist_for_token(
    chain: str,
    contract_address: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    normalized_chain = (chain or "").strip().lower()
    if not normalized_chain:
        raise HTTPException(status_code=400, detail="chain is required")

    token_result = await db.execute(
        select(Token).where(
            Token.chain == normalized_chain,
            Token.contract_address == contract_address,
        )
    )
    token = token_result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    score_result = await db.execute(
        select(ScoringHistory)
        .where(
            ScoringHistory.chain == normalized_chain,
            ScoringHistory.contract_address == contract_address,
        )
        .order_by(ScoringHistory.scored_at.desc())
        .limit(1)
    )
    latest_score = score_result.scalar_one_or_none()

    extra = token.extra_data or {}
    market = {
        "contract_address": token.contract_address,
        "chain": token.chain,
        "symbol": token.symbol,
        "name": token.name,
        "market_cap_usd": float(token.market_cap_usd or 0),
        "liquidity_usd": float(token.liquidity_usd or 0),
        "holder_count": int(token.holder_count or 0),
        "price_change_1h": float(extra.get("price_change_1h", 0) or 0),
        "volume_1h": float(extra.get("volume_1h", 0) or 0),
        "rug_probability": float(latest_score.rug_probability if latest_score else 0),
        "trade_confidence_index": float(latest_score.trade_confidence_index if latest_score else 0),
        "liquidity_stability": float(latest_score.liquidity_stability if latest_score else 0),
        "holder_distribution": float(latest_score.holder_distribution if latest_score else 0),
        "smart_wallet_signal": float(latest_score.smart_wallet_signal if latest_score else 0),
    }

    auto_context = await build_user_trading_context(db, user.id)
    payload = {
        "market": market,
        "risk": {
            "max_risk_per_trade_pct": 1.0,
            "max_daily_loss_pct": 4.0,
            "max_trades_per_day": 8,
        },
        "mode": "paper",
        "history_context": auto_context,
        "user": {
            "user_id": str(user.id),
            "is_admin": bool(user.is_admin),
        },
    }

    result = await generate_trade_assist(payload)
    return {
        "token": {
            "contract_address": token.contract_address,
            "chain": token.chain,
            "symbol": token.symbol,
        },
        "assistant": result,
        "guardrails": {
            "execution_blocked_without_risk_approval": True,
            "paper_mode_recommended": True,
        },
        "trading": trading_status(user),
    }


@router.get("/trading/status")
async def get_trading_status(user: User = Depends(get_current_user)):
    return {"trading": trading_status(user)}


@router.get("/wallets/status")
async def get_wallet_status(user: User = Depends(get_current_user)):
    return {"wallet": wallet_status(user)}


@router.get("/wallets/portfolio")
async def get_wallet_portfolio(user: User = Depends(get_current_user)):
    status_payload = wallet_status(user)
    portfolio = await get_wallet_portfolio_snapshot(status_payload.get("addresses_by_chain") or {})
    return {
        "wallet": status_payload,
        "portfolio": portfolio,
    }


@router.post("/wallets/create")
async def create_wallet_bundle(
    req: WalletCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    bundle = create_user_wallet_bundle(user, overwrite=bool(req.overwrite))
    await db.flush()
    return {
        "wallet": wallet_status(user),
        "bundle": bundle,
    }


@router.post("/wallets/confirm-backup")
async def confirm_wallet_phrase_backup(
    req: WalletBackupConfirmRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    status_payload = confirm_wallet_backup(user, req.mnemonic)
    await db.flush()
    return {
        "wallet": status_payload,
    }


@router.post("/wallets/import")
async def import_wallet_bundle(
    req: WalletImportRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    bundle = import_user_wallet_bundle(user, mnemonic=req.mnemonic, overwrite=bool(req.overwrite))
    await db.flush()
    return {
        "wallet": wallet_status(user),
        "bundle": bundle,
    }


@router.post("/wallets/reveal")
async def reveal_wallet_secrets(
    req: WalletRevealRequest,
    user: User = Depends(get_current_user),
):
    bundle = reveal_wallet_bundle(user, req.confirmation_text)
    return {
        "bundle": bundle,
        "wallet": wallet_status(user),
    }


@router.post("/wallets/remove-chain")
async def remove_wallet_chain_route(
    req: WalletRemoveChainRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    wallet_payload = remove_wallet_chain(user, req.chain)
    await db.flush()
    return {
        "wallet": wallet_payload,
        "trading": trading_status(user),
    }


@router.post("/wallets/export-key")
async def export_wallet_key_route(
    req: WalletExportKeyRequest,
    user: User = Depends(get_current_user),
):
    key_payload = export_wallet_private_key(user, req.chain, req.confirmation_text)
    return {
        "wallet_key": key_payload,
    }


@router.post("/trading/consent/request")
async def create_trading_consent(
    req: ConsentRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    risk_limits = req.risk_limits.model_dump() if req.risk_limits else {}
    consent = request_consent(
        user,
        req.wallet_address or "",
        req.wallets_by_chain or {},
        req.mode,
        risk_limits,
    )
    await db.flush()
    return {
        "message": "Consent request created. Approve explicitly to enable assistant trading.",
        "consent": consent,
        "trading": trading_status(user),
    }


@router.post("/trading/consent/approve")
async def approve_trading_consent(
    req: ConsentApproveRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    status_payload = approve_consent(user, req.consent_id, req.confirmation_text)
    await db.flush()
    return {
        "message": "Assistant trading enabled.",
        "trading": status_payload,
    }


@router.post("/trading/consent/revoke")
async def revoke_trading_consent(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    status_payload = revoke_consent(user)
    await db.flush()
    return {
        "message": "Assistant trading revoked.",
        "trading": status_payload,
    }


@router.post("/trading/execute")
async def execute_assistant_order(
    req: ExecuteTradeRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    auto_context = await build_user_trading_context(db, user.id)
    merged_context = dict(req.decision_context or {})
    merged_context["history_context"] = auto_context

    trade = await execute_assistant_trade(
        db,
        user,
        chain=req.chain,
        contract_address=req.contract_address,
        side=req.side,
        notional_usd=req.notional_usd,
        requested_mode=req.mode,
        decision_context=merged_context,
    )
    return {
        "message": "Assistant trade processed.",
        "trade": trade,
        "trading": trading_status(user),
    }


@router.get("/context/overview")
async def get_assistant_context_overview(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    context = await build_user_trading_context(db, user.id, days=days)
    return {
        "context": context,
        "user_id": str(user.id),
    }