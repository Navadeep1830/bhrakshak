from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "bhrakshak",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["worker.tasks.ingest", "worker.tasks.risk", "worker.tasks.seismic",
             "worker.tasks.sensors"],
)

celery_app.conf.update(
    timezone="Asia/Kolkata",
    enable_utc=True,
    task_track_started=True,
    # Kombu defaults the message routing key to "celery" but the worker was
    # started with -Q default,tiles, so every .delay() landed in a queue
    # nothing consumed -- beat tasks silently piled up in redis (62 stuck
    # messages) and no scheduled ingest ever ran. Pin the default queue so
    # producer and consumer agree.
    task_default_queue="default",
    task_default_exchange="default",
    task_default_routing_key="default",
    beat_schedule={
        "poll-rainfall-15min": {"task": "tasks.poll_rainfall", "schedule": 15 * 60},
        "recompute-risk-15min": {"task": "tasks.recompute_risk", "schedule": 15 * 60,
                                 "options": {"countdown": 30}},
        "poll-seismic-hourly": {"task": "tasks.poll_seismic", "schedule": 60 * 60},
        "satellite-etl-daily": {"task": "tasks.satellite_etl", "schedule": 24 * 60 * 60},
        "sensor-fleet-5min": {"task": "tasks.poll_sensor_fleet", "schedule": 5 * 60},
    },
)
