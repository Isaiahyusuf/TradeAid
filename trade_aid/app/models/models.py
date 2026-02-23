import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Float, Integer, Boolean, DateTime, Text,
    BigInteger, JSON, ForeignKey, Index, Enum as SAEnum
)
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class ChainEnum(str, enum.Enum):
    SOLANA = "solana"
    ETHEREUM = "ethereum"
    BSC = "bsc"
    BASE = "base"
    ARBITRUM = "arbitrum"
    AVALANCHE = "avalanche"
    POLYGON = "polygon"


class AlertType(str, enum.Enum):
    LIQUIDITY_DRAIN = "liquidity_drain"
    WHALE_ENTRY = "whale_entry"
    RUG_DETECTED = "rug_detected"
    NEW_PAIR = "new_pair"
    OWNERSHIP_CHANGE = "ownership_change"
    MINT_CALL = "mint_call"
    CUSTOM_THRESHOLD = "custom_threshold"


class Token(Base):
    __tablename__ = "tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_address = Column(String(128), nullable=False, index=True)
    chain = Column(String(20), nullable=False, index=True)
    name = Column(String(256), nullable=True)
    symbol = Column(String(64), nullable=True)
    decimals = Column(Integer, default=18)
    deployer_wallet = Column(String(128), nullable=True, index=True)
    market_cap_usd = Column(Float, default=0.0)
    liquidity_usd = Column(Float, default=0.0)
    holder_count = Column(Integer, default=0)
    is_mintable = Column(Boolean, default=False)
    is_ownership_renounced = Column(Boolean, default=False)
    pair_address = Column(String(128), nullable=True)
    dex_id = Column(String(64), nullable=True)
    liquidity_created_at = Column(DateTime, nullable=True)
    total_supply = Column(String(64), nullable=True)
    extra_data = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    scoring_history = relationship("ScoringHistory", back_populates="token", lazy="dynamic")
    liquidity_events = relationship("LiquidityEvent", back_populates="token", lazy="dynamic")
    alerts = relationship("Alert", back_populates="token", lazy="dynamic")

    __table_args__ = (
        Index("ix_tokens_chain_contract", "chain", "contract_address", unique=True),
    )


class Developer(Base):
    __tablename__ = "developers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wallet_address = Column(String(128), nullable=False, unique=True, index=True)
    chain = Column(String(20), nullable=False, index=True)
    wallet_age_days = Column(Integer, default=0)
    total_tokens_launched = Column(Integer, default=0)
    total_rugs = Column(Integer, default=0)
    rug_percentage = Column(Float, default=0.0)
    avg_time_to_rug_hours = Column(Float, nullable=True)
    dev_risk_index = Column(Float, default=50.0)
    known_aliases = Column(ARRAY(String), nullable=True)
    linked_wallets = Column(ARRAY(String), nullable=True)
    extra_data = Column("metadata", JSON, nullable=True)
    first_seen_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    rug_history = relationship("RugHistory", back_populates="developer", lazy="dynamic")


class Trader(Base):
    __tablename__ = "traders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wallet_address = Column(String(128), nullable=False, unique=True, index=True)
    chain = Column(String(20), nullable=False, index=True)
    wallet_age_days = Column(Integer, default=0)
    total_trades = Column(Integer, default=0)
    profitable_trades = Column(Integer, default=0)
    win_rate = Column(Float, default=0.0)
    avg_hold_time_hours = Column(Float, nullable=True)
    trader_risk_index = Column(Float, default=50.0)
    is_smart_wallet = Column(Boolean, default=False)
    total_volume_usd = Column(Float, default=0.0)
    pnl_usd = Column(Float, default=0.0)
    extra_data = Column("metadata", JSON, nullable=True)
    first_seen_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class WalletCluster(Base):
    __tablename__ = "wallet_clusters"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cluster_id = Column(String(64), nullable=False, unique=True, index=True)
    wallets = Column(ARRAY(String), nullable=False)
    chain = Column(String(20), nullable=False, index=True)
    cluster_type = Column(String(32), default="unknown")
    risk_score = Column(Float, default=0.0)
    total_tokens_associated = Column(Integer, default=0)
    total_rugs_associated = Column(Integer, default=0)
    graph_data = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class RugHistory(Base):
    __tablename__ = "rug_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_address = Column(String(128), nullable=False, index=True)
    chain = Column(String(20), nullable=False, index=True)
    developer_id = Column(UUID(as_uuid=True), ForeignKey("developers.id"), nullable=True)
    developer_wallet = Column(String(128), nullable=True, index=True)
    rug_type = Column(String(64), default="liquidity_pull")
    liquidity_removed_usd = Column(Float, default=0.0)
    time_to_rug_hours = Column(Float, nullable=True)
    peak_market_cap_usd = Column(Float, default=0.0)
    holder_count_at_rug = Column(Integer, default=0)
    detected_at = Column(DateTime, default=datetime.utcnow, index=True)
    extra_data = Column("metadata", JSON, nullable=True)

    developer = relationship("Developer", back_populates="rug_history")


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_id = Column(UUID(as_uuid=True), ForeignKey("tokens.id"), nullable=True)
    alert_type = Column(String(32), nullable=False)
    chain = Column(String(20), nullable=False, index=True)
    severity = Column(String(16), default="medium")
    title = Column(String(256), nullable=False)
    message = Column(Text, nullable=True)
    contract_address = Column(String(128), nullable=True, index=True)
    wallet_address = Column(String(128), nullable=True)
    threshold_value = Column(Float, nullable=True)
    actual_value = Column(Float, nullable=True)
    is_read = Column(Boolean, default=False)
    is_sent_telegram = Column(Boolean, default=False)
    is_sent_websocket = Column(Boolean, default=False)
    extra_data = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    token = relationship("Token", back_populates="alerts")


class ScoringHistory(Base):
    __tablename__ = "scoring_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_id = Column(UUID(as_uuid=True), ForeignKey("tokens.id"), nullable=False)
    contract_address = Column(String(128), nullable=False, index=True)
    chain = Column(String(20), nullable=False, index=True)
    rug_probability = Column(Float, default=0.0)
    liquidity_stability = Column(Float, default=0.0)
    holder_distribution = Column(Float, default=0.0)
    smart_wallet_signal = Column(Float, default=0.0)
    trade_confidence_index = Column(Float, default=0.0)
    eligible = Column(Boolean, default=False)
    eligibility_reason = Column(String(256), nullable=True)
    raw_data = Column(JSON, nullable=True)
    scored_at = Column(DateTime, default=datetime.utcnow, index=True)

    token = relationship("Token", back_populates="scoring_history")


class LiquidityEvent(Base):
    __tablename__ = "liquidity_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_id = Column(UUID(as_uuid=True), ForeignKey("tokens.id"), nullable=True)
    contract_address = Column(String(128), nullable=False, index=True)
    chain = Column(String(20), nullable=False, index=True)
    event_type = Column(String(32), nullable=False)
    pair_address = Column(String(128), nullable=True)
    liquidity_usd = Column(Float, default=0.0)
    liquidity_change_usd = Column(Float, default=0.0)
    liquidity_change_pct = Column(Float, default=0.0)
    tx_hash = Column(String(128), nullable=True)
    block_number = Column(BigInteger, nullable=True)
    extra_data = Column("metadata", JSON, nullable=True)
    detected_at = Column(DateTime, default=datetime.utcnow, index=True)

    token = relationship("Token", back_populates="liquidity_events")


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(64), nullable=False, unique=True, index=True)
    email = Column(String(256), nullable=False, unique=True, index=True)
    hashed_password = Column(String(256), nullable=False)
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    totp_secret = Column(String(64), nullable=True)
    totp_enabled = Column(Boolean, default=False)
    device_id = Column(String(256), nullable=True)
    encrypted_api_key = Column(Text, nullable=True)
    alert_preferences = Column(JSON, nullable=True)
    telegram_chat_id = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AssistantTrade(Base):
    __tablename__ = "assistant_trades"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    chain = Column(String(20), nullable=False, index=True)
    contract_address = Column(String(128), nullable=False, index=True)
    side = Column(String(8), nullable=False)
    mode = Column(String(16), nullable=False, default="paper")
    status = Column(String(24), nullable=False, default="filled")
    notional_usd = Column(Float, nullable=False, default=0.0)
    quantity = Column(Float, nullable=True)
    price_usd = Column(Float, nullable=True)
    fees_usd = Column(Float, nullable=False, default=0.0)
    pnl_usd = Column(Float, nullable=False, default=0.0)
    external_order_id = Column(String(128), nullable=True)
    decision_context = Column(JSON, nullable=True)
    risk_snapshot = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("ix_assistant_trades_user_created", "user_id", "created_at"),
    )
