import secrets
from datetime import datetime, timedelta
from collections import deque
from typing import Any

import httpx
from bip_utils import Bip39MnemonicGenerator, Bip39MnemonicValidator, Bip39SeedGenerator, Bip39WordsNum, Bip44, Bip44Changes, Bip44Coins
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_enabled_chains, get_settings
from app.models.models import AssistantTrade, ScoringHistory, Token, User
from app.utils.security import decrypt_api_key, encrypt_api_key


CONFIRMATION_PHRASE = "I_APPROVE_ASSISTANT_TRADING"
WALLET_REVEAL_PHRASE = "I_UNDERSTAND_THIS_EXPOSES_PRIVATE_KEYS"

CHAIN_COIN_NAME_CANDIDATES: dict[str, list[str]] = {
    "solana": ["SOLANA"],
    "ethereum": ["ETHEREUM"],
    "bsc": ["BINANCE_SMART_CHAIN", "BSC", "BINANCECHAIN", "ETHEREUM"],
    "base": ["ETHEREUM"],
    "arbitrum": ["ETHEREUM"],
    "avalanche": ["AVAX_C_CHAIN", "AVALANCHE_C_CHAIN", "AVALANCHE", "ETHEREUM"],
    "polygon": ["POLYGON", "ETHEREUM"],
}
EVM_CHAINS = {"ethereum", "bsc", "base", "arbitrum", "avalanche", "polygon"}
SOLANA_LAMPORTS_PER_SOL = 1_000_000_000
_OPENCLOW_CALL_WINDOW: deque[float] = deque(maxlen=600)


def _metadata(user: User) -> dict[str, Any]:
    return dict(user.alert_preferences or {})


def _get_trading_config(user: User) -> dict[str, Any]:
    return dict((_metadata(user).get("assistant_trading") or {}))


def _set_trading_config(user: User, config: dict[str, Any]) -> None:
    metadata = _metadata(user)
    metadata["assistant_trading"] = config
    user.alert_preferences = metadata


def _get_wallet_config(user: User) -> dict[str, Any]:
    return dict((_metadata(user).get("assistant_wallets") or {}))


def _set_wallet_config(user: User, config: dict[str, Any]) -> None:
    metadata = _metadata(user)
    metadata["assistant_wallets"] = config
    user.alert_preferences = metadata


def _get_auto_config(user: User) -> dict[str, Any]:
    cfg = _get_trading_config(user)
    auto_cfg = dict(cfg.get("automation") or {})
    return {
        "enabled": bool(auto_cfg.get("enabled", True)),
        "take_profit_pct": float(auto_cfg.get("take_profit_pct", 18.0) or 18.0),
        "stop_loss_pct": float(auto_cfg.get("stop_loss_pct", 8.0) or 8.0),
        "max_open_positions": int(auto_cfg.get("max_open_positions", 3) or 3),
        "entry_notional_usd": float(auto_cfg.get("entry_notional_usd", 35.0) or 35.0),
        "min_confidence": float(auto_cfg.get("min_confidence", 52.0) or 52.0),
        "max_rug_probability": float(auto_cfg.get("max_rug_probability", 62.0) or 62.0),
        "open_positions": list(auto_cfg.get("open_positions") or []),
        "last_run_at": auto_cfg.get("last_run_at"),
        "last_action": auto_cfg.get("last_action"),
    }


def _set_auto_config(user: User, auto_config: dict[str, Any]) -> None:
    trading_cfg = _get_trading_config(user)
    trading_cfg["automation"] = auto_config
    _set_trading_config(user, trading_cfg)


def _utcnow() -> datetime:
    return datetime.utcnow()


def _rate_limit_openclaw(limit_per_minute: int) -> None:
    now_ts = _utcnow().timestamp()
    while _OPENCLOW_CALL_WINDOW and (now_ts - _OPENCLOW_CALL_WINDOW[0]) > 60.0:
        _OPENCLOW_CALL_WINDOW.popleft()
    if len(_OPENCLOW_CALL_WINDOW) >= max(10, int(limit_per_minute or 120)):
        raise HTTPException(status_code=429, detail="OpenClaw advisor rate limit reached")
    _OPENCLOW_CALL_WINDOW.append(now_ts)


async def _collect_performance_snapshot(db: AsyncSession, user: User) -> dict[str, Any]:
    recent_q = await db.execute(
        select(AssistantTrade)
        .where(AssistantTrade.user_id == user.id)
        .order_by(AssistantTrade.created_at.desc())
        .limit(100)
    )
    recent = recent_q.scalars().all()
    if not recent:
        return {
            "trades_count": 0,
            "win_rate": 0.0,
            "previous_win_rate": 0.0,
            "drawdown_pct": 0.0,
            "consecutive_losses": 0,
            "daily_pnl": 0.0,
        }

    pnl_series = [float(row.pnl_usd or 0.0) for row in reversed(recent)]
    cumulative = 0.0
    peak = 0.0
    max_drawdown = 0.0
    for pnl in pnl_series:
        cumulative += pnl
        peak = max(peak, cumulative)
        if peak > 0:
            drawdown = ((peak - cumulative) / peak) * 100.0
            max_drawdown = max(max_drawdown, drawdown)

    wins = len([row for row in recent if float(row.pnl_usd or 0.0) > 0])
    win_rate = wins / len(recent)

    prior_slice = recent[50:100]
    if prior_slice:
        prior_wins = len([row for row in prior_slice if float(row.pnl_usd or 0.0) > 0])
        previous_win_rate = prior_wins / len(prior_slice)
    else:
        previous_win_rate = win_rate

    consecutive_losses = 0
    for row in recent:
        if float(row.pnl_usd or 0.0) < 0:
            consecutive_losses += 1
        else:
            break

    day_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    pnl_today_q = await db.execute(
        select(func.coalesce(func.sum(AssistantTrade.pnl_usd), 0.0)).where(
            AssistantTrade.user_id == user.id,
            AssistantTrade.created_at >= day_start,
        )
    )
    daily_pnl = float(pnl_today_q.scalar() or 0.0)

    return {
        "trades_count": len(recent),
        "win_rate": float(win_rate),
        "previous_win_rate": float(previous_win_rate),
        "drawdown_pct": float(max_drawdown),
        "consecutive_losses": int(consecutive_losses),
        "daily_pnl": float(daily_pnl),
    }


async def _openclaw_validate_trade(
    db: AsyncSession,
    user: User,
    *,
    chain: str,
    contract_address: str,
    side: str,
    entry: float,
    stop_loss: float,
    take_profit: float,
    volatility: float,
    market_sentiment: float,
) -> dict[str, Any]:
    settings = get_settings()
    _rate_limit_openclaw(settings.OPENCLOW_RATE_LIMIT_PER_MINUTE)

    perf = await _collect_performance_snapshot(db, user)
    pair_symbol = f"{(contract_address or 'TOKEN')[:8]}/USDT"
    payload = {
        "pair": pair_symbol,
        "entry": float(entry),
        "stop_loss": float(stop_loss),
        "take_profit": float(take_profit),
        "volatility": float(max(volatility, 0.0)),
        "market_sentiment": float(min(max(market_sentiment, 0.0), 1.0)),
        "daily_pnl": float(perf["daily_pnl"]),
        "drawdown_pct": float(perf["drawdown_pct"]),
        "consecutive_losses": int(perf["consecutive_losses"]),
        "trades_count": int(perf["trades_count"]),
        "win_rate": float(perf["win_rate"]),
    }

    headers = {"Content-Type": "application/json"}
    if settings.OPENCLOW_API_KEY:
        headers["X-OpenClaw-API-Key"] = settings.OPENCLOW_API_KEY

    validate_url = f"{settings.OPENCLOW_SERVICE_URL.rstrip('/')}/ai/validate-trade"
    perf_url = f"{settings.OPENCLOW_SERVICE_URL.rstrip('/')}/ai/performance-check"

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            validate_resp = await client.post(validate_url, json=payload, headers=headers)
            validate_resp.raise_for_status()
            validate_data = dict(validate_resp.json() or {})

            performance_data: dict[str, Any] = {}
            if int(perf.get("trades_count", 0)) > 0 and int(perf.get("trades_count", 0)) % 50 == 0:
                perf_payload = {
                    "trades_count": int(perf["trades_count"]),
                    "win_rate": float(perf["win_rate"]),
                    "previous_win_rate": float(perf["previous_win_rate"]),
                    "drawdown_pct": float(perf["drawdown_pct"]),
                    "consecutive_losses": int(perf["consecutive_losses"]),
                    "volatility": float(max(volatility, 0.0)),
                }
                perf_resp = await client.post(perf_url, json=perf_payload, headers=headers)
                perf_resp.raise_for_status()
                performance_data = dict(perf_resp.json() or {})

            return {
                "advisor": validate_data,
                "performance": performance_data,
                "input": payload,
                "metadata": {
                    "side": side,
                    "chain": chain,
                    "contract_address": contract_address,
                },
            }
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail="OpenClaw advisor unavailable; trade blocked by execution guard")


async def _fetch_sol_price_usd() -> float:
    url = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            payload = response.json() or {}
            return float((payload.get("solana") or {}).get("usd") or 0.0)
    except Exception:
        return 0.0


def _resolve_coin(chain_name: str):
    candidates = CHAIN_COIN_NAME_CANDIDATES.get(chain_name, [])
    for candidate in candidates:
        coin = getattr(Bip44Coins, candidate, None)
        if coin is not None:
            return coin
    return None


def _derive_single_wallet(seed_bytes: bytes, coin) -> dict[str, str]:
    account = (
        Bip44.FromSeed(seed_bytes, coin)
        .Purpose()
        .Coin()
        .Account(0)
        .Change(Bip44Changes.CHAIN_EXT)
        .AddressIndex(0)
    )

    private_key_hex = account.PrivateKey().Raw().ToHex()
    address = account.PublicKey().ToAddress()
    return {
        "address": address,
        "private_key": private_key_hex,
    }


def _derive_wallets_from_mnemonic(mnemonic: str, chains: list[str]) -> dict[str, dict[str, str]]:
    seed_bytes = Bip39SeedGenerator(mnemonic).Generate()
    wallets: dict[str, dict[str, str]] = {}
    failed_chains: set[str] = set()

    eth_wallet: dict[str, str] | None = None
    ethereum_coin = _resolve_coin("ethereum")
    if ethereum_coin is not None:
        try:
            eth_wallet = _derive_single_wallet(seed_bytes, ethereum_coin)
        except Exception:
            eth_wallet = None

    for chain_name in chains:
        normalized_chain = str(chain_name or "").strip().lower()
        if not normalized_chain:
            continue

        if normalized_chain in EVM_CHAINS and eth_wallet is not None:
            wallets[normalized_chain] = dict(eth_wallet)
            continue

        coin = _resolve_coin(normalized_chain)
        if coin is None:
            failed_chains.add(normalized_chain)
            continue

        try:
            wallets[normalized_chain] = _derive_single_wallet(seed_bytes, coin)
        except Exception:
            failed_chains.add(normalized_chain)

    if not wallets:
        failed = ", ".join(sorted(failed_chains)) or "enabled chains"
        raise HTTPException(status_code=500, detail=f"Unable to derive wallet addresses for configured chains ({failed}).")

    return wallets


def wallet_status(user: User) -> dict[str, Any]:
    cfg = _get_wallet_config(user)
    chains = dict(cfg.get("chains") or {})

    addresses: dict[str, str] = {}
    for chain_name, chain_cfg in chains.items():
        if isinstance(chain_cfg, dict):
            address = str(chain_cfg.get("address") or "").strip()
            if address:
                addresses[str(chain_name).lower()] = address

    return {
        "has_wallet": bool(cfg.get("mnemonic_encrypted")),
        "backup_confirmed": bool(cfg.get("backup_confirmed", False)),
        "backup_confirmed_at": cfg.get("backup_confirmed_at"),
        "created_at": cfg.get("created_at"),
        "addresses_by_chain": addresses,
        "enabled_chains": get_enabled_chains(),
    }


def get_wallet_chain_credentials(user: User, chain: str) -> dict[str, str]:
    normalized_chain = (chain or "").strip().lower()
    if not normalized_chain:
        raise HTTPException(status_code=400, detail="chain is required")

    cfg = _get_wallet_config(user)
    chains = dict(cfg.get("chains") or {})
    chain_cfg = chains.get(normalized_chain)
    if not isinstance(chain_cfg, dict):
        raise HTTPException(status_code=404, detail=f"No wallet found for chain '{normalized_chain}'")

    address = str(chain_cfg.get("address") or "").strip()
    encrypted_pk = str(chain_cfg.get("private_key_encrypted") or "").strip()
    if not address or not encrypted_pk:
        raise HTTPException(status_code=404, detail=f"Wallet data missing for chain '{normalized_chain}'")

    try:
        private_key = decrypt_api_key(encrypted_pk)
    except Exception:
        raise HTTPException(status_code=500, detail="Stored wallet key is invalid")

    return {
        "chain": normalized_chain,
        "address": address,
        "private_key": private_key,
    }


def create_user_wallet_bundle(user: User, *, overwrite: bool = False) -> dict[str, Any]:
    existing = _get_wallet_config(user)
    if existing.get("mnemonic_encrypted") and not overwrite:
        raise HTTPException(status_code=400, detail="Wallet already exists. Use reveal or overwrite explicitly.")

    enabled_chains = get_enabled_chains()
    mnemonic = Bip39MnemonicGenerator().FromWordsNumber(Bip39WordsNum.WORDS_NUM_12)
    mnemonic_text = str(mnemonic)
    derived_wallets = _derive_wallets_from_mnemonic(mnemonic_text, enabled_chains)

    encrypted_chains: dict[str, Any] = {}
    public_addresses: dict[str, str] = {}
    for chain_name, wallet in derived_wallets.items():
        public_addresses[chain_name] = wallet["address"]
        encrypted_chains[chain_name] = {
            "address": wallet["address"],
            "private_key_encrypted": encrypt_api_key(wallet["private_key"]),
        }

    wallet_cfg = {
        "mnemonic_encrypted": encrypt_api_key(mnemonic_text),
        "backup_confirmed": False,
        "backup_confirmed_at": None,
        "created_at": _utcnow().isoformat(),
        "chains": encrypted_chains,
    }
    _set_wallet_config(user, wallet_cfg)

    trading_cfg = _get_trading_config(user)
    trading_cfg.setdefault("mode", "paper")
    trading_cfg["wallets_by_chain"] = public_addresses
    if public_addresses:
        trading_cfg["wallet_address"] = next(iter(public_addresses.values()))
    _set_trading_config(user, trading_cfg)

    private_keys_by_chain = {chain_name: wallet["private_key"] for chain_name, wallet in derived_wallets.items()}
    return {
        "mnemonic": mnemonic_text,
        "addresses_by_chain": public_addresses,
        "private_keys_by_chain": private_keys_by_chain,
        "warning": "Store your 12-word phrase and private keys securely offline. They are required for recovery.",
    }


def import_user_wallet_bundle(user: User, *, mnemonic: str, overwrite: bool = False) -> dict[str, Any]:
    existing = _get_wallet_config(user)
    if existing.get("mnemonic_encrypted") and not overwrite:
        raise HTTPException(status_code=400, detail="Wallet already exists. Use overwrite explicitly.")

    mnemonic_text = " ".join((mnemonic or "").strip().split()).lower()
    if not mnemonic_text:
        raise HTTPException(status_code=400, detail="mnemonic is required")

    try:
        Bip39MnemonicValidator(mnemonic_text).Validate()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid mnemonic phrase")

    enabled_chains = get_enabled_chains()
    derived_wallets = _derive_wallets_from_mnemonic(mnemonic_text, enabled_chains)

    encrypted_chains: dict[str, Any] = {}
    public_addresses: dict[str, str] = {}
    for chain_name, wallet in derived_wallets.items():
        public_addresses[chain_name] = wallet["address"]
        encrypted_chains[chain_name] = {
            "address": wallet["address"],
            "private_key_encrypted": encrypt_api_key(wallet["private_key"]),
        }

    wallet_cfg = {
        "mnemonic_encrypted": encrypt_api_key(mnemonic_text),
        "backup_confirmed": False,
        "backup_confirmed_at": None,
        "created_at": _utcnow().isoformat(),
        "chains": encrypted_chains,
    }
    _set_wallet_config(user, wallet_cfg)

    trading_cfg = _get_trading_config(user)
    trading_cfg.setdefault("mode", "paper")
    trading_cfg["wallets_by_chain"] = public_addresses
    if public_addresses:
        trading_cfg["wallet_address"] = next(iter(public_addresses.values()))
    _set_trading_config(user, trading_cfg)

    return {
        "addresses_by_chain": public_addresses,
        "warning": "Wallet imported. Confirm backup phrase before enabling live usage.",
    }


def confirm_wallet_backup(user: User, mnemonic: str) -> dict[str, Any]:
    cfg = _get_wallet_config(user)
    encrypted_mnemonic = str(cfg.get("mnemonic_encrypted") or "")
    if not encrypted_mnemonic:
        raise HTTPException(status_code=400, detail="Wallet not created yet")

    try:
        stored_mnemonic = decrypt_api_key(encrypted_mnemonic)
    except Exception:
        raise HTTPException(status_code=400, detail="Stored wallet is invalid. Create a new wallet.")

    if (mnemonic or "").strip() != stored_mnemonic:
        raise HTTPException(status_code=400, detail="Recovery phrase does not match")

    cfg["backup_confirmed"] = True
    cfg["backup_confirmed_at"] = _utcnow().isoformat()
    _set_wallet_config(user, cfg)
    return wallet_status(user)


def reveal_wallet_bundle(user: User, confirmation_text: str) -> dict[str, Any]:
    if (confirmation_text or "").strip() != WALLET_REVEAL_PHRASE:
        raise HTTPException(status_code=400, detail="Invalid reveal confirmation text")

    cfg = _get_wallet_config(user)
    encrypted_mnemonic = str(cfg.get("mnemonic_encrypted") or "")
    if not encrypted_mnemonic:
        raise HTTPException(status_code=400, detail="Wallet not created yet")

    try:
        mnemonic = decrypt_api_key(encrypted_mnemonic)
    except Exception:
        raise HTTPException(status_code=400, detail="Stored wallet is invalid. Create a new wallet.")

    chains = dict(cfg.get("chains") or {})
    private_keys_by_chain: dict[str, str] = {}
    addresses_by_chain: dict[str, str] = {}

    for chain_name, chain_cfg in chains.items():
        if not isinstance(chain_cfg, dict):
            continue
        address = str(chain_cfg.get("address") or "")
        encrypted_pk = str(chain_cfg.get("private_key_encrypted") or "")
        if not address or not encrypted_pk:
            continue
        try:
            private_key = decrypt_api_key(encrypted_pk)
        except Exception:
            continue
        normalized_chain = str(chain_name).lower()
        addresses_by_chain[normalized_chain] = address
        private_keys_by_chain[normalized_chain] = private_key

    return {
        "mnemonic": mnemonic,
        "addresses_by_chain": addresses_by_chain,
        "private_keys_by_chain": private_keys_by_chain,
        "warning": "Never share these secrets. Anyone with this phrase or keys controls your wallet.",
        "reveal_confirmation_phrase": WALLET_REVEAL_PHRASE,
    }


def export_wallet_private_key(user: User, chain: str, confirmation_text: str) -> dict[str, Any]:
    if (confirmation_text or "").strip() != WALLET_REVEAL_PHRASE:
        raise HTTPException(status_code=400, detail="Invalid reveal confirmation text")

    normalized_chain = (chain or "").strip().lower()
    if not normalized_chain:
        raise HTTPException(status_code=400, detail="chain is required")

    cfg = _get_wallet_config(user)
    chains = dict(cfg.get("chains") or {})
    chain_cfg = chains.get(normalized_chain)
    if not isinstance(chain_cfg, dict):
        raise HTTPException(status_code=404, detail=f"No wallet found for chain '{normalized_chain}'")

    address = str(chain_cfg.get("address") or "").strip()
    encrypted_pk = str(chain_cfg.get("private_key_encrypted") or "").strip()
    if not address or not encrypted_pk:
        raise HTTPException(status_code=404, detail=f"Wallet data missing for chain '{normalized_chain}'")

    try:
        private_key = decrypt_api_key(encrypted_pk)
    except Exception:
        raise HTTPException(status_code=500, detail="Stored wallet key is invalid")

    return {
        "chain": normalized_chain,
        "address": address,
        "private_key": private_key,
        "warning": "Never share this private key. Anyone with this key controls your wallet.",
    }


def remove_wallet_chain(user: User, chain: str) -> dict[str, Any]:
    normalized_chain = (chain or "").strip().lower()
    if not normalized_chain:
        raise HTTPException(status_code=400, detail="chain is required")

    wallet_cfg = _get_wallet_config(user)
    chains = dict(wallet_cfg.get("chains") or {})
    if normalized_chain not in chains:
        raise HTTPException(status_code=404, detail=f"No wallet found for chain '{normalized_chain}'")

    chains.pop(normalized_chain, None)
    wallet_cfg["chains"] = chains

    if not chains:
        wallet_cfg = {
            "mnemonic_encrypted": None,
            "backup_confirmed": False,
            "backup_confirmed_at": None,
            "created_at": None,
            "chains": {},
        }

    _set_wallet_config(user, wallet_cfg)

    trading_cfg = _get_trading_config(user)
    wallets_by_chain = dict(trading_cfg.get("wallets_by_chain") or {})
    wallets_by_chain.pop(normalized_chain, None)
    trading_cfg["wallets_by_chain"] = wallets_by_chain

    if wallets_by_chain:
        trading_cfg["wallet_address"] = next(iter(wallets_by_chain.values()))
    else:
        trading_cfg["wallet_address"] = None
        trading_cfg["enabled"] = False
        trading_cfg["pending_approval"] = False

    _set_trading_config(user, trading_cfg)
    return wallet_status(user)


def trading_status(user: User) -> dict[str, Any]:
    cfg = _get_trading_config(user)
    enabled_chains = get_enabled_chains()
    auto_cfg = _get_auto_config(user)
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
        "automation": {
            "enabled": bool(auto_cfg.get("enabled", False)),
            "take_profit_pct": float(auto_cfg.get("take_profit_pct", 18.0) or 18.0),
            "stop_loss_pct": float(auto_cfg.get("stop_loss_pct", 8.0) or 8.0),
            "max_open_positions": int(auto_cfg.get("max_open_positions", 3) or 3),
            "entry_notional_usd": float(auto_cfg.get("entry_notional_usd", 35.0) or 35.0),
            "min_confidence": float(auto_cfg.get("min_confidence", 52.0) or 52.0),
            "max_rug_probability": float(auto_cfg.get("max_rug_probability", 62.0) or 62.0),
            "open_positions": list(auto_cfg.get("open_positions") or []),
            "last_run_at": auto_cfg.get("last_run_at"),
            "last_action": auto_cfg.get("last_action"),
        },
        "last_revoked_at": cfg.get("last_revoked_at"),
    }


def configure_auto_trading(
    user: User,
    *,
    enabled: bool | None = None,
    take_profit_pct: float | None = None,
    stop_loss_pct: float | None = None,
    max_open_positions: int | None = None,
    entry_notional_usd: float | None = None,
    min_confidence: float | None = None,
    max_rug_probability: float | None = None,
) -> dict[str, Any]:
    auto_cfg = _get_auto_config(user)
    if enabled is not None:
        auto_cfg["enabled"] = bool(enabled)
    if take_profit_pct is not None:
        auto_cfg["take_profit_pct"] = max(1.0, min(80.0, float(take_profit_pct)))
    if stop_loss_pct is not None:
        auto_cfg["stop_loss_pct"] = max(1.0, min(40.0, float(stop_loss_pct)))
    if max_open_positions is not None:
        auto_cfg["max_open_positions"] = max(1, min(10, int(max_open_positions)))
    if entry_notional_usd is not None:
        auto_cfg["entry_notional_usd"] = max(5.0, min(500.0, float(entry_notional_usd)))
    if min_confidence is not None:
        auto_cfg["min_confidence"] = max(30.0, min(95.0, float(min_confidence)))
    if max_rug_probability is not None:
        auto_cfg["max_rug_probability"] = max(5.0, min(95.0, float(max_rug_probability)))

    auto_cfg["last_action"] = "configuration_updated"
    _set_auto_config(user, auto_cfg)
    return trading_status(user)


async def _load_candidate_tokens(db: AsyncSession, chains: list[str], limit: int = 180) -> tuple[list[Token], dict[str, ScoringHistory]]:
    since = _utcnow() - timedelta(hours=24)
    token_result = await db.execute(
        select(Token)
        .where(Token.chain.in_(chains), func.coalesce(Token.liquidity_created_at, Token.created_at) >= since)
        .order_by(func.coalesce(Token.liquidity_created_at, Token.created_at).desc())
        .limit(max(20, min(limit, 500)))
    )
    tokens = token_result.scalars().all()

    token_ids = [token.id for token in tokens]
    latest_scores: dict[str, ScoringHistory] = {}
    if token_ids:
        score_result = await db.execute(
            select(ScoringHistory)
            .where(ScoringHistory.token_id.in_(token_ids))
            .order_by(ScoringHistory.token_id, ScoringHistory.scored_at.desc())
        )
        for row in score_result.scalars().all():
            key = str(row.token_id)
            if key not in latest_scores:
                latest_scores[key] = row

    return tokens, latest_scores


def _candidate_score(token: Token, score: ScoringHistory | None) -> float:
    extra = token.extra_data or {}
    confidence = float(score.trade_confidence_index if score else 0.0)
    rug = float(score.rug_probability if score else 100.0)
    momentum = float(extra.get("price_change_1h", 0) or 0)
    volume = float(extra.get("volume_1h", 0) or 0)
    liquidity = float(token.liquidity_usd or 0)
    pump_bonus = 4.0 if bool(extra.get("is_pump_fun", False)) else 0.0
    return (confidence * 0.62) + ((100.0 - rug) * 0.28) + (min(max(momentum, -12.0), 18.0) * 0.4) + min(volume / 40000.0, 8.0) + min(liquidity / 50000.0, 6.0) + pump_bonus


async def run_auto_trading_cycle(db: AsyncSession, user: User) -> dict[str, Any]:
    cfg = _get_trading_config(user)
    if not cfg.get("enabled"):
        raise HTTPException(status_code=403, detail="Assistant trading permission is not enabled")

    auto_cfg = _get_auto_config(user)
    if not auto_cfg.get("enabled", False):
        return {
            "executed": False,
            "message": "Automation is disabled",
            "trading": trading_status(user),
        }

    now = _utcnow()
    open_positions = list(auto_cfg.get("open_positions") or [])
    enabled_chains = [chain_name for chain_name in get_enabled_chains() if chain_name in {"solana", "ethereum", "bsc", "base", "arbitrum", "avalanche", "polygon"}]
    tokens, latest_scores = await _load_candidate_tokens(db, enabled_chains)
    token_by_contract = {str(token.contract_address): token for token in tokens}

    actions: list[dict[str, Any]] = []
    remaining_positions: list[dict[str, Any]] = []

    for pos in open_positions:
        contract = str(pos.get("contract_address") or "")
        chain_name = str(pos.get("chain") or "").lower()
        entry_price = float(pos.get("entry_price_usd") or 0.0)
        qty = float(pos.get("quantity") or 0.0)
        token = token_by_contract.get(contract)
        current_price = float((token.extra_data or {}).get("price_usd", 0) or 0) if token else 0.0
        if chain_name != "solana" or entry_price <= 0 or current_price <= 0 or qty <= 0:
            remaining_positions.append(pos)
            continue

        pnl_pct = ((current_price - entry_price) / entry_price) * 100
        take_profit = float(auto_cfg.get("take_profit_pct", 18.0) or 18.0)
        stop_loss = float(auto_cfg.get("stop_loss_pct", 8.0) or 8.0)

        if pnl_pct >= take_profit or pnl_pct <= (-1.0 * stop_loss):
            openclaw = await _openclaw_validate_trade(
                db,
                user,
                chain=chain_name,
                contract_address=contract,
                side="sell",
                entry=float(entry_price),
                stop_loss=float(entry_price * (1.0 - (stop_loss / 100.0))),
                take_profit=float(entry_price * (1.0 + (take_profit / 100.0))),
                volatility=float(abs((token.extra_data or {}).get("price_change_1h", 0) or 0) / 100.0) if token else 0.0,
                market_sentiment=float(max(0.0, min(1.0, 1.0 - max(float((latest_scores.get(str(token.id)).rug_probability if token and latest_scores.get(str(token.id)) else 50.0) or 50.0), 0.0) / 100.0))),
            )
            advisor = dict(openclaw.get("advisor") or {})
            if bool(advisor.get("should_pause", False)):
                cfg["enabled"] = False
                cfg["paused_at"] = _utcnow().isoformat()
                cfg["pause_reason"] = str(advisor.get("pause_reason") or "openclaw_pause")
                _set_trading_config(user, cfg)
                raise HTTPException(status_code=400, detail=f"Trading paused by OpenClaw: {cfg['pause_reason']}")
            if not bool(advisor.get("approved", False)):
                remaining_positions.append(pos)
                continue

            notional = current_price * qty
            trade = AssistantTrade(
                user_id=user.id,
                chain=chain_name,
                contract_address=contract,
                side="sell",
                mode=str(cfg.get("mode") or "paper"),
                status="filled",
                notional_usd=notional,
                quantity=qty,
                price_usd=current_price,
                fees_usd=round(notional * 0.001, 6),
                pnl_usd=round((current_price - entry_price) * qty, 6),
                external_order_id=f"auto-sell-{secrets.token_hex(6)}",
                decision_context={
                    "auto": True,
                    "openclaw": openclaw,
                    "trigger": "take_profit" if pnl_pct >= take_profit else "stop_loss",
                    "entry_price_usd": entry_price,
                    "exit_price_usd": current_price,
                    "pnl_pct": round(pnl_pct, 4),
                },
                risk_snapshot={
                    "auto": True,
                    "openclaw_approval": True,
                    "openclaw_confidence": int(advisor.get("confidence", 0) or 0),
                },
            )
            db.add(trade)
            actions.append(
                {
                    "action": "sell",
                    "chain": chain_name,
                    "contract_address": contract,
                    "reason": "take_profit" if pnl_pct >= take_profit else "stop_loss",
                    "pnl_pct": round(pnl_pct, 4),
                }
            )
        else:
            pos["last_price_usd"] = current_price
            pos["unrealized_pnl_pct"] = round(pnl_pct, 4)
            remaining_positions.append(pos)

    open_positions = remaining_positions

    max_positions = int(auto_cfg.get("max_open_positions", 3) or 3)
    if len(open_positions) < max_positions:
        min_conf = float(auto_cfg.get("min_confidence", 52.0) or 52.0)
        max_rug = float(auto_cfg.get("max_rug_probability", 62.0) or 62.0)
        already_open = {str(pos.get("contract_address") or "") for pos in open_positions}

        ranked: list[tuple[float, Token, ScoringHistory | None]] = []
        for token in tokens:
            if token.contract_address in already_open:
                continue
            score_row = latest_scores.get(str(token.id))
            if not score_row:
                continue
            conf = float(score_row.trade_confidence_index or 0.0)
            rug = float(score_row.rug_probability or 100.0)
            if conf < min_conf or rug > max_rug:
                continue
            extra = token.extra_data or {}
            if float(token.liquidity_usd or 0.0) < 8000:
                continue
            if float(extra.get("volume_1h", 0) or 0) < 1500:
                continue
            ranked.append((_candidate_score(token, score_row), token, score_row))

        ranked.sort(key=lambda row: row[0], reverse=True)
        slots = max(0, max_positions - len(open_positions))

        for _, token, score_row in ranked[:slots]:
            price = float((token.extra_data or {}).get("price_usd", 0) or 0)
            if price <= 0:
                continue
            entry_notional = min(
                float(auto_cfg.get("entry_notional_usd", 35.0) or 35.0),
                float((cfg.get("risk_limits") or {}).get("max_notional_usd_per_trade", 50.0) or 50.0),
            )

            openclaw = await _openclaw_validate_trade(
                db,
                user,
                chain=token.chain,
                contract_address=token.contract_address,
                side="buy",
                entry=float(price),
                stop_loss=float(price * (1.0 - (float(auto_cfg.get("stop_loss_pct", 8.0) or 8.0) / 100.0))),
                take_profit=float(price * (1.0 + (float(auto_cfg.get("take_profit_pct", 18.0) or 18.0) / 100.0))),
                volatility=float(abs((token.extra_data or {}).get("price_change_1h", 0) or 0) / 100.0),
                market_sentiment=float(max(0.0, min(1.0, 1.0 - (float(score_row.rug_probability or 50.0) / 100.0)))),
            )
            advisor = dict(openclaw.get("advisor") or {})
            if bool(advisor.get("should_pause", False)):
                cfg["enabled"] = False
                cfg["paused_at"] = _utcnow().isoformat()
                cfg["pause_reason"] = str(advisor.get("pause_reason") or "openclaw_pause")
                _set_trading_config(user, cfg)
                raise HTTPException(status_code=400, detail=f"Trading paused by OpenClaw: {cfg['pause_reason']}")
            if not bool(advisor.get("approved", False)):
                continue

            qty = entry_notional / price

            trade = AssistantTrade(
                user_id=user.id,
                chain=token.chain,
                contract_address=token.contract_address,
                side="buy",
                mode=str(cfg.get("mode") or "paper"),
                status="filled",
                notional_usd=entry_notional,
                quantity=qty,
                price_usd=price,
                fees_usd=round(entry_notional * 0.001, 6),
                pnl_usd=0.0,
                external_order_id=f"auto-buy-{secrets.token_hex(6)}",
                decision_context={
                    "auto": True,
                    "openclaw": openclaw,
                    "confidence": float(score_row.trade_confidence_index or 0.0),
                    "rug_probability": float(score_row.rug_probability or 0.0),
                    "symbol": token.symbol,
                    "name": token.name,
                },
                risk_snapshot={
                    "auto": True,
                    "openclaw_approval": True,
                    "openclaw_confidence": int(advisor.get("confidence", 0) or 0),
                },
            )
            db.add(trade)

            open_positions.append(
                {
                    "chain": token.chain,
                    "contract_address": token.contract_address,
                    "entry_price_usd": price,
                    "quantity": qty,
                    "entry_notional_usd": entry_notional,
                    "opened_at": now.isoformat(),
                    "symbol": token.symbol,
                }
            )
            actions.append(
                {
                    "action": "buy",
                    "chain": token.chain,
                    "contract_address": token.contract_address,
                    "symbol": token.symbol,
                    "confidence": float(score_row.trade_confidence_index or 0.0),
                    "rug_probability": float(score_row.rug_probability or 0.0),
                }
            )

    auto_cfg["open_positions"] = open_positions
    auto_cfg["last_run_at"] = now.isoformat()
    auto_cfg["last_action"] = actions[0]["action"] if actions else "hold"
    _set_auto_config(user, auto_cfg)

    await db.flush()
    return {
        "executed": True,
        "actions": actions,
        "open_positions": open_positions,
        "trading": trading_status(user),
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

    if isinstance(decision_context, dict) and decision_context.get("core_signal") is False:
        raise HTTPException(status_code=400, detail="Trade blocked by execution guard: core signal is false")

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

    inferred_entry = market_price if market_price > 0 else max(float(notional_usd), 1.0)
    inferred_stop_loss = float((decision_context or {}).get("stop_loss") or (inferred_entry * 0.98))
    inferred_take_profit = float((decision_context or {}).get("take_profit") or (inferred_entry * 1.04))
    inferred_volatility = float(market.get("volatility", 0) or market.get("volatility_1h", 0) or 0)
    if inferred_volatility <= 0:
        inferred_volatility = abs(float(market.get("price_change_1h", 0) or 0)) / 100.0
    inferred_sentiment = float(market.get("market_sentiment", 0.5) or 0.5)

    openclaw = await _openclaw_validate_trade(
        db,
        user,
        chain=normalized_chain,
        contract_address=normalized_contract,
        side=normalized_side,
        entry=float(inferred_entry),
        stop_loss=float(inferred_stop_loss),
        take_profit=float(inferred_take_profit),
        volatility=float(inferred_volatility),
        market_sentiment=float(inferred_sentiment),
    )
    advisor = dict(openclaw.get("advisor") or {})
    performance = dict(openclaw.get("performance") or {})

    if bool(advisor.get("should_pause", False)):
        cfg["enabled"] = False
        cfg["paused_at"] = _utcnow().isoformat()
        cfg["pause_reason"] = str(advisor.get("pause_reason") or "openclaw_pause")
        _set_trading_config(user, cfg)
        raise HTTPException(status_code=400, detail=f"Trading paused by OpenClaw: {cfg['pause_reason']}")

    if bool(performance.get("should_pause", False)):
        cfg["enabled"] = False
        cfg["paused_at"] = _utcnow().isoformat()
        cfg["pause_reason"] = str(performance.get("reason") or "openclaw_performance_pause")
        _set_trading_config(user, cfg)
        raise HTTPException(status_code=400, detail=f"Trading paused by OpenClaw performance monitor: {cfg['pause_reason']}")

    if not bool(advisor.get("approved", False)):
        raise HTTPException(status_code=400, detail="Trade blocked by execution guard: OpenClaw did not approve")

    context_payload = dict(decision_context or {})
    context_payload["openclaw"] = openclaw
    context_payload.setdefault("risk_engine_pass", True)

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
        decision_context=context_payload,
        risk_snapshot={
            **risk_snapshot,
            "openclaw_approval": bool(advisor.get("approved", False)),
            "openclaw_confidence": int(advisor.get("confidence", 0) or 0),
            "openclaw_risk_recommendation": advisor.get("risk_recommendation"),
            "openclaw_adjusted_sl": advisor.get("adjusted_sl"),
            "openclaw_adjusted_tp": advisor.get("adjusted_tp"),
        },
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
        "risk_snapshot": {
            **risk_snapshot,
            "openclaw_approval": bool(advisor.get("approved", False)),
            "openclaw_confidence": int(advisor.get("confidence", 0) or 0),
            "openclaw_risk_recommendation": advisor.get("risk_recommendation"),
            "openclaw_adjusted_sl": advisor.get("adjusted_sl"),
            "openclaw_adjusted_tp": advisor.get("adjusted_tp"),
        },
        "openclaw": openclaw,
    }


async def execute_wallet_transfer(
    db: AsyncSession,
    user: User,
    *,
    chain: str,
    recipient_address: str,
    amount: float,
    asset: str,
) -> dict[str, Any]:
    normalized_chain = (chain or "").strip().lower()
    if normalized_chain != "solana":
        raise HTTPException(status_code=400, detail="Real transfer is currently supported for Solana only")

    normalized_asset = (asset or "SOL").strip().upper()
    if normalized_asset != "SOL":
        raise HTTPException(status_code=400, detail="Only SOL native transfer is currently supported")

    transfer_amount = float(amount or 0.0)
    if transfer_amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be greater than zero")

    wallet_cfg = _get_wallet_config(user)
    chains = dict(wallet_cfg.get("chains") or {})
    chain_cfg = chains.get("solana")
    if not isinstance(chain_cfg, dict):
        raise HTTPException(status_code=400, detail="No Solana wallet configured")

    sender_address = str(chain_cfg.get("address") or "").strip()
    encrypted_pk = str(chain_cfg.get("private_key_encrypted") or "").strip()
    if not sender_address or not encrypted_pk:
        raise HTTPException(status_code=400, detail="Stored Solana wallet is incomplete")

    try:
        private_key_hex = decrypt_api_key(encrypted_pk)
    except Exception:
        raise HTTPException(status_code=500, detail="Stored Solana wallet key is invalid")

    try:
        seed_bytes = bytes.fromhex(str(private_key_hex).strip())
    except Exception:
        raise HTTPException(status_code=500, detail="Stored Solana private key is malformed")

    if len(seed_bytes) < 32:
        raise HTTPException(status_code=500, detail="Stored Solana private key has invalid length")

    settings = get_settings()

    try:
        from solana.rpc.async_api import AsyncClient
        from solana.rpc.types import TxOpts
        from solders.keypair import Keypair
        from solders.pubkey import Pubkey
        from solders.system_program import TransferParams, transfer
        from solders.transaction import Transaction
    except Exception:
        raise HTTPException(status_code=500, detail="Solana transfer dependencies are not installed on server")

    sender_keypair = Keypair.from_seed(seed_bytes[:32])

    try:
        sender_pubkey = Pubkey.from_string(sender_address)
        recipient_pubkey = Pubkey.from_string((recipient_address or "").strip())
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid recipient or sender Solana address")

    lamports = int(round(transfer_amount * SOLANA_LAMPORTS_PER_SOL))
    if lamports <= 0:
        raise HTTPException(status_code=400, detail="amount is too small")

    async with AsyncClient(settings.SOLANA_RPC_URL) as client:
        try:
            balance_resp = await client.get_balance(sender_pubkey)
            current_lamports = int(balance_resp.value or 0)
        except Exception:
            raise HTTPException(status_code=503, detail="Unable to read on-chain balance from Solana RPC")

        fee_buffer = 15_000
        if current_lamports < (lamports + fee_buffer):
            raise HTTPException(status_code=400, detail="Insufficient SOL balance for transfer + network fee")

        try:
            blockhash_resp = await client.get_latest_blockhash()
            recent_blockhash = blockhash_resp.value.blockhash
            instruction = transfer(
                TransferParams(
                    from_pubkey=sender_pubkey,
                    to_pubkey=recipient_pubkey,
                    lamports=lamports,
                )
            )
            transaction = Transaction.new_signed_with_payer(
                [instruction],
                sender_pubkey,
                [sender_keypair],
                recent_blockhash,
            )
            send_resp = await client.send_transaction(
                transaction,
                opts=TxOpts(skip_preflight=False, preflight_commitment="confirmed"),
            )
            tx_hash = str(send_resp.value)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=503, detail="Solana transfer submission failed")

    sol_price = await _fetch_sol_price_usd()
    notional_usd = transfer_amount * sol_price if sol_price > 0 else 0.0

    transfer_row = AssistantTrade(
        user_id=user.id,
        chain="solana",
        contract_address=str(recipient_pubkey),
        side="transfer",
        mode="live",
        status="submitted",
        notional_usd=notional_usd,
        quantity=transfer_amount,
        price_usd=sol_price if sol_price > 0 else None,
        fees_usd=0.0,
        pnl_usd=0.0,
        external_order_id=tx_hash,
        decision_context={
            "tx_type": "wallet_transfer",
            "asset": "SOL",
            "from_address": sender_address,
            "to_address": str(recipient_pubkey),
            "tx_hash": tx_hash,
            "explorer_url": f"https://solscan.io/tx/{tx_hash}",
        },
        risk_snapshot={
            "transfer": True,
            "asset": "SOL",
        },
    )
    db.add(transfer_row)
    await db.flush()

    return {
        "transaction_id": str(transfer_row.id),
        "chain": "solana",
        "asset": "SOL",
        "amount": transfer_amount,
        "notional_usd": round(notional_usd, 6),
        "from_address": sender_address,
        "to_address": str(recipient_pubkey),
        "tx_hash": tx_hash,
        "explorer_url": f"https://solscan.io/tx/{tx_hash}",
        "status": "submitted",
    }


async def list_wallet_transactions(
    db: AsyncSession,
    user: User,
    *,
    limit: int = 25,
) -> list[dict[str, Any]]:
    rows_result = await db.execute(
        select(AssistantTrade)
        .where(AssistantTrade.user_id == user.id)
        .order_by(AssistantTrade.created_at.desc())
        .limit(max(1, min(limit, 200)))
    )
    rows = rows_result.scalars().all()

    payload: list[dict[str, Any]] = []
    for row in rows:
        ctx = row.decision_context or {}
        payload.append(
            {
                "id": str(row.id),
                "chain": row.chain,
                "side": row.side,
                "status": row.status,
                "contract_address": row.contract_address,
                "notional_usd": float(row.notional_usd or 0.0),
                "quantity": float(row.quantity or 0.0) if row.quantity is not None else None,
                "asset": str(ctx.get("asset") or ""),
                "tx_hash": str(ctx.get("tx_hash") or row.external_order_id or ""),
                "explorer_url": str(ctx.get("explorer_url") or ""),
                "from_address": str(ctx.get("from_address") or ""),
                "to_address": str(ctx.get("to_address") or ""),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        )

    return payload