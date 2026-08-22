import asyncio
import logging

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import Zone
from app.services.risk_engine import evaluate_all_zones
from worker.celery_app import celery_app

log = logging.getLogger("bhrakshak.risk")


@celery_app.task(name="tasks.recompute_risk")
def recompute_risk():
    async def _run():
        async with SessionLocal() as db:
            zones = (await db.execute(select(Zone))).scalars().all()
            log.info("recomputing risk for %s zones", len(zones))
            return await evaluate_all_zones(db)

    result = asyncio.run(_run())
    log.info("risk recompute done: %s zones", result["evaluated"])
    return result
