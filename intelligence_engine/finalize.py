# intelligence_engine/finalize.py
"""
Finalize intelligence result (scoring, storing, returning).
"""
from .scoring import compute_scores
from .store import store_intelligence_result

async def finalize_intelligence(token_data):
    scored = compute_scores(token_data)
    await store_intelligence_result(scored)
    return scored
