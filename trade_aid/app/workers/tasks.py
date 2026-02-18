import asyncio
from app.workers.celery_app import celery_app
from app.utils.logging_config import logger


def run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(bind=True, max_retries=3)
def score_token_task(self, contract_address: str, chain: str):
    try:
        from app.scoring.scoring_service import scoring_service
        from app.database import async_session_factory

        async def _score():
            async with async_session_factory() as db:
                result = await scoring_service.score_token(db, contract_address, chain)
                await db.commit()
                return result

        result = run_async(_score())
        logger.info(f"[Worker] Scored token {contract_address} on {chain}")
        return result
    except Exception as exc:
        logger.error(f"[Worker] Score task failed: {exc}")
        raise self.retry(exc=exc, countdown=30)


@celery_app.task(bind=True, max_retries=3)
def compute_dev_risk_task(self, wallet_address: str, chain: str):
    try:
        from app.intelligence.developer_intel import developer_intelligence
        from app.database import async_session_factory

        async def _compute():
            async with async_session_factory() as db:
                dev = await developer_intelligence.get_or_create_developer(
                    db, wallet_address, chain
                )
                risk = await developer_intelligence.compute_dev_risk_index(db, dev)
                await db.commit()
                return risk

        result = run_async(_compute())
        logger.info(f"[Worker] Dev risk computed for {wallet_address}: {result}")
        return result
    except Exception as exc:
        logger.error(f"[Worker] Dev risk task failed: {exc}")
        raise self.retry(exc=exc, countdown=30)


@celery_app.task(bind=True, max_retries=3)
def compute_trader_risk_task(self, wallet_address: str, chain: str):
    try:
        from app.intelligence.trader_intel import trader_intelligence
        from app.database import async_session_factory

        async def _compute():
            async with async_session_factory() as db:
                trader = await trader_intelligence.get_or_create_trader(
                    db, wallet_address, chain
                )
                risk = await trader_intelligence.compute_trader_risk_index(db, trader)
                await db.commit()
                return risk

        result = run_async(_compute())
        logger.info(f"[Worker] Trader risk computed for {wallet_address}: {result}")
        return result
    except Exception as exc:
        logger.error(f"[Worker] Trader risk task failed: {exc}")
        raise self.retry(exc=exc, countdown=30)


@celery_app.task
def process_chain_event_task(event_data: dict):
    try:
        logger.info(f"[Worker] Processing chain event: {event_data.get('event')}")
        return {"status": "processed", "event": event_data}
    except Exception as e:
        logger.error(f"[Worker] Chain event task failed: {e}")
        return {"status": "failed", "error": str(e)}


@celery_app.task
def cluster_analysis_task(chain: str):
    try:
        from app.intelligence.wallet_clustering import wallet_cluster_engine
        from app.database import async_session_factory

        async def _cluster():
            async with async_session_factory() as db:
                await wallet_cluster_engine.persist_clusters(db, chain)
                await db.commit()

        run_async(_cluster())
        logger.info(f"[Worker] Cluster analysis completed for {chain}")
        return {"status": "completed", "chain": chain}
    except Exception as e:
        logger.error(f"[Worker] Cluster analysis failed: {e}")
        return {"status": "failed", "error": str(e)}
