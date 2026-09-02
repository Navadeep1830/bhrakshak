from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db():
    # Plain RAII: close the session on any failure and let the exception
    # propagate. The old "except: yield None" swallowed errors inside the
    # generator (Starlette raises "generator didn't stop after athrow()"),
    # turning one bad request into a 500 with no traceback for EVERY route
    # that depends on this while the pool is unhealthy. Handlers that want
    # a DB-optional path should catch OperationalError themselves.
    async with SessionLocal() as session:
        yield session
