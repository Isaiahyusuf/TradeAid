from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.models import User
from app.services.auth_service import get_current_user
from app.services.token_resolver_service import resolver_service
from app.intelligence.developer_intel import developer_intelligence
from app.intelligence.trader_intel import trader_intelligence
from app.intelligence.wallet_clustering import wallet_cluster_engine
from app.services.dev_behavior_service import dev_behavior_service
from app.workers.tasks import compute_dev_risk_task, compute_trader_risk_task

router = APIRouter(prefix="/api/wallets", tags=["Wallets"])


@router.get("/developer/{wallet_address}")
async def get_developer_profile(
    wallet_address: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    profile = await developer_intelligence.get_developer_profile(db, wallet_address)
    if not profile:
        return {"error": "Developer not found"}
    return profile


@router.get("/trader/{wallet_address}")
async def get_trader_profile(
    wallet_address: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    profile = await trader_intelligence.get_trader_profile(db, wallet_address)
    if not profile:
        return {"error": "Trader not found"}
    return profile


@router.get("/cluster/{wallet_address}")
async def get_wallet_cluster(
    wallet_address: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await wallet_cluster_engine.analyze_wallet(db, wallet_address)
    if not result:
        return {"error": "No cluster data found for this wallet"}
    return result


@router.post("/developer/{wallet_address}/analyze")
async def analyze_developer(
    wallet_address: str,
    chain: str = "solana",
    user: User = Depends(get_current_user),
):
    if chain.lower() != "solana":
        raise HTTPException(status_code=400, detail="Only Solana integration is supported")

    task = compute_dev_risk_task.delay(wallet_address, chain)
    return {"task_id": task.id, "status": "queued"}


@router.post("/trader/{wallet_address}/analyze")
async def analyze_trader(
    wallet_address: str,
    chain: str = "solana",
    user: User = Depends(get_current_user),
):
    if chain.lower() != "solana":
        raise HTTPException(status_code=400, detail="Only Solana integration is supported")

    task = compute_trader_risk_task.delay(wallet_address, chain)
    return {"task_id": task.id, "status": "queued"}


@router.get("/dev-intel/{contract_address}")
async def get_dev_intel_by_contract(
    contract_address: str,
    chain: str = "solana",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    normalized_chain = (chain or "solana").strip().lower()
    if normalized_chain == "all":
        normalized_chain = "solana"

    if normalized_chain != "solana":
        raise HTTPException(status_code=400, detail="Only Solana integration is supported")

    resolved = await resolver_service.resolve_token(db, contract_address)
    if resolved.get("invalid"):
        raise HTTPException(status_code=400, detail=str(resolved.get("error") or "Invalid Solana mint"))

    intel = await dev_behavior_service.get_dev_token_intel(db, contract_address=contract_address, chain="solana")
    if not intel:
        return {"status": "indexing", "message": "Indexing token..."}
    return intel
