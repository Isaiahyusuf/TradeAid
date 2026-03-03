"""Per-API client functions that return validated data or raise controlled exceptions.

Each function is responsible for fetching, validating and returning a dict.
Critical failures raise `DataValidationError` or `NetworkError`.
"""
from typing import Any, Dict, Optional
from .http_client import fetch_json
from .schemas import (
    HeliusStrict,
    DexScreenerStrict,
    SolscanStrict,
    JupiterStrict,
    MoralisStrict,
)
from .exceptions import NetworkError, DataValidationError
from .logging_config import logger


async def fetch_helius(mint: str) -> Dict[str, Any]:
    url = f"https://api.helius.xyz/v0/token/{mint}"
    try:
        payload = await fetch_json(url)
    except NetworkError:
        logger.exception("helius_network_error", extra={"mint": mint, "url": url})
        raise
    try:
        validated = HeliusStrict.parse_obj(payload)
        return validated.dict()
    except Exception as e:
        logger.error("helius_validation_failed", extra={"mint": mint, "error": str(e)})
        raise DataValidationError(f"Helius validation failed: {e}", source="helius")


async def fetch_dexscreener(mint: str) -> Dict[str, Any]:
    url = f"https://api.dexscreener.io/latest/dex/tokens/{mint}"
    try:
        payload = await fetch_json(url)
    except NetworkError:
        logger.exception("dexscreener_network_error", extra={"mint": mint, "url": url})
        raise
    try:
        validated = DexScreenerStrict.parse_obj(payload)
        return validated.dict()
    except Exception as e:
        logger.error("dexscreener_validation_failed", extra={"mint": mint, "error": str(e)})
        raise DataValidationError(f"DexScreener validation failed: {e}", source="dexscreener")


async def fetch_solscan(mint: str) -> Dict[str, Any]:
    url = f"https://api.solscan.io/token/{mint}"
    try:
        payload = await fetch_json(url)
    except NetworkError:
        logger.exception("solscan_network_error", extra={"mint": mint, "url": url})
        raise
    try:
        validated = SolscanStrict.parse_obj(payload)
        return validated.dict()
    except Exception as e:
        logger.error("solscan_validation_failed", extra={"mint": mint, "error": str(e)})
        raise DataValidationError(f"Solscan validation failed: {e}", source="solscan")


async def fetch_jupiter(mint: str) -> Optional[Dict[str, Any]]:
    url = f"https://api.jupiter.ag/v1/route/{mint}"
    try:
        payload = await fetch_json(url)
    except NetworkError:
        logger.warning("jupiter_network_warning", extra={"mint": mint, "url": url})
        return None
    try:
        validated = JupiterStrict.parse_obj(payload)
        return validated.dict()
    except Exception as e:
        logger.warning("jupiter_validation_warning", extra={"mint": mint, "error": str(e)})
        return None


async def fetch_moralis(mint: str) -> Optional[Dict[str, Any]]:
    url = f"https://api.moralis.io/v2/token/{mint}"
    try:
        payload = await fetch_json(url)
    except NetworkError:
        logger.warning("moralis_network_warning", extra={"mint": mint, "url": url})
        return None
    try:
        validated = MoralisStrict.parse_obj(payload)
        return validated.dict()
    except Exception as e:
        logger.warning("moralis_validation_warning", extra={"mint": mint, "error": str(e)})
        return None
