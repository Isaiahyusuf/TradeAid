# intelligence_engine/models.py
"""
Database model for intelligence_tokens table.
"""
from sqlalchemy import Column, String, Integer, Float, Boolean, JSON, TIMESTAMP
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class IntelligenceToken(Base):
    __tablename__ = "intelligence_tokens"
    mint = Column(String, primary_key=True)
    creator_wallet = Column(String)
    liquidity = Column(Float)
    holder_count = Column(Integer)
    top10_percent = Column(Float)
    smart_wallet_count = Column(Integer)
    volume_5m = Column(Float)
    volume_1h = Column(Float)
    mint_authority = Column(Boolean)
    freeze_authority = Column(Boolean)
    opportunity_score = Column(Float)
    risk_score = Column(Float)
    risk_flags = Column(JSON)
    last_updated = Column(TIMESTAMP)
