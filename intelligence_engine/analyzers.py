# intelligence_engine/analyzers.py
"""
Normalize and structure token data for intelligence engine.
"""
def normalize_token_data(raw):
    helius = raw.get("helius") or {}
    dexscreener = raw.get("dexscreener") or {}
    jupiter = raw.get("jupiter") or {}
    solscan = raw.get("solscan") or {}
    moralis = raw.get("moralis") or {}
    return {
        "mint": helius.get("mint") or None,
        "liquidity": dexscreener.get("liquidity") or None,
        "holder_count": solscan.get("holder_count") or None,
        "top10_percent": solscan.get("top10_percent") or None,
        "smart_wallet_count": helius.get("smart_wallet_count") or None,
        "volume_5m": dexscreener.get("volume_5m") or None,
        "volume_1h": dexscreener.get("volume_1h") or None,
        "mint_authority": helius.get("mint_authority") or None,
        "freeze_authority": helius.get("freeze_authority") or None,
        "last_updated": moralis.get("last_updated") or None,
        # scoring and risk will be filled by scoring.py
    }
