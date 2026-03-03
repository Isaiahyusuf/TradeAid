# intelligence_engine/scoring.py
"""
Isolated scoring logic for intelligence engine.
"""
def compute_scores(token):
    # Example scoring logic (replace with real formulas)
    opportunity_score = 0
    risk_score = 0
    risk_flags = []
    if token.get("liquidity"):
        opportunity_score += min(token["liquidity"] / 10000, 10)
    if token.get("holder_count"):
        opportunity_score += min(token["holder_count"] / 100, 5)
    if token.get("top10_percent") and token["top10_percent"] > 80:
        risk_score += 5
        risk_flags.append("Top10 holders > 80%")
    if token.get("mint_authority"):
        risk_score += 3
        risk_flags.append("Mint authority active")
    if token.get("freeze_authority"):
        risk_score += 2
        risk_flags.append("Freeze authority active")
    token["opportunity_score"] = opportunity_score
    token["risk_score"] = risk_score
    token["risk_flags"] = risk_flags
    return token
