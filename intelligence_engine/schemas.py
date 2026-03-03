"""Pydantic schemas for API responses.

These are intentionally permissive: fields are Optional so that
the pipeline can be tolerant but still validate structural shape.
Specific, stricter validation per-API will be added in Phase 2.
"""
from typing import Optional, Any, Dict
from pydantic import BaseModel, Field


# Flexible (Phase 1) response shapes
class HeliusResp(BaseModel):
    mint: Optional[str]
    mint_authority: Optional[bool]
    freeze_authority: Optional[bool]
    smart_wallet_count: Optional[int]
    extra: Optional[Dict[str, Any]]


class DexScreenerResp(BaseModel):
    liquidity: Optional[float]
    volume_5m: Optional[float]
    volume_1h: Optional[float]
    extra: Optional[Dict[str, Any]]


class JupiterResp(BaseModel):
    route: Optional[Dict[str, Any]]
    slippage: Optional[float]
    extra: Optional[Dict[str, Any]]


class SolscanResp(BaseModel):
    holder_count: Optional[int]
    top10_percent: Optional[float]
    extra: Optional[Dict[str, Any]]


class MoralisResp(BaseModel):
    last_updated: Optional[str]
    metadata: Optional[Dict[str, Any]]
    extra: Optional[Dict[str, Any]]


# Strict schemas for Phase 2 validation (required core fields)
class HeliusStrict(BaseModel):
    mint: str = Field(..., description="Token mint address")
    smart_wallet_count: Optional[int]
    mint_authority: Optional[bool]
    freeze_authority: Optional[bool]


class DexScreenerStrict(BaseModel):
    liquidity: float = Field(..., ge=0)
    volume_5m: Optional[float]
    volume_1h: Optional[float]


class SolscanStrict(BaseModel):
    holder_count: int = Field(..., ge=0)
    top10_percent: Optional[float]


class JupiterStrict(BaseModel):
    route: Optional[Dict[str, Any]]
    slippage: Optional[float]


class MoralisStrict(BaseModel):
    last_updated: Optional[str]
    metadata: Optional[Dict[str, Any]]
