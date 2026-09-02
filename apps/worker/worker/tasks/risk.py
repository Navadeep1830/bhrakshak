import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.models import Zone
from app.services.risk_engine import evaluate_all_zones
from worker.celery_app import celery_app
from worker.db_local import fresh_sessionmaker

log = logging.getLogger("bhrakshak.risk")


@celery_app.task(name="tasks.recompute_risk")
def recompute_risk():
    """Recompute every zone's hazard level + snapshots.

    Uses a per-invocation engine: the module-level async engine in
    app.db.session binds its connection pool to the first event loop that
    touches it; every later asyncio.run() gets a different loop and the pool
    raises "attached to a different loop" (98 errors per cycle before
    succeeding by chance pool churn). fresh_sessionmaker() avoids the
    cross-loop pool entirely.
    """
    async def _run():
        SessionLocal = fresh_sessionmaker()
        async with SessionLocal() as db:
            zones = (await db.execute(select(Zone))).scalars().all()
            log.info("recomputing risk for %s zones", len(zones))
            return await evaluate_all_zones(db)

    result = asyncio.run(_run())
    log.info("risk recompute done: %s zones", result["evaluated"])
    return result
