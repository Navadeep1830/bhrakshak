"""Per-invocation async engine factory for Celery tasks.

``app.db.session``'s module-level engine binds its connection pool to the
first asyncio loop that uses it. Celery tasks each run under a fresh
``asyncio.run()`` loop, so every subsequent task hits
"Task got Future attached to a different loop" until pool churn happens to
recycle the poisoned connections. Building (and disposing) an engine inside
the task's own loop removes the cross-loop sharing entirely.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings


def fresh_sessionmaker():
    engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True)
    return async_sessionmaker(engine, expire_on_commit=False)
