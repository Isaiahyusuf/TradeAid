# intelligence_engine/pipeline_runner.py
"""
Pipeline runner for intelligence engine (for testing or scheduled jobs).
"""
import asyncio
from .engine import get_token_intelligence

async def run_for_mint(mint):
    result = await get_token_intelligence(mint)
    print(result)
