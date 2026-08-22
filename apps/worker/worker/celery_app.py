from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "bhrakshak",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["worker.tasks.ingest", "worker.tasks.risk", "worker.tasks.seismic"],
)

celery_app.conf.update(
    timezone="Asia/Kolkata",
    enable_utc=True,
    task_track_started=True,
    beat_schedule={
        "poll-rainfall-15min": {"task": "tasks.poll_rainfall", "schedule": 15 * 60},
        "recompute-risk-15min": {"task": "tasks.recompute_risk", "schedule": 15 * 60,
                                 "options": {"countdown": 30}},
        "poll-seismic-hourly": {"task": "tasks.poll_seismic", "schedule": 60 * 60},
        "satellite-etl-daily": {"task": "tasks.satellite_etl", "schedule": 24 * 60 * 60},
    },
)
