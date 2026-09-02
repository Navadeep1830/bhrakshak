import asyncio
import os

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.session import get_db
from app.main import app
from app.models import Base

TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://bhrakshak:bhrakshak@localhost:5433/bhrakshak_test",
)


async def _db_available() -> bool:
    try:
        eng = create_async_engine(TEST_DB_URL, pool_pre_ping=False)
        async with eng.connect():
            pass
        await eng.dispose()
        return True
    except Exception:
        return False


def _probe_db() -> bool:
    """Run the async reachability probe from module (synchronous) scope.

    Previously this used ``asyncio.get_event_loop().run_until_complete(...)``,
    which is deprecated from Python 3.12 and removed in 3.14 -- on a modern
    interpreter collection of the whole test suite died at import time.
    """
    try:
        return asyncio.run(_db_available())
    except Exception:
        return False


DB_OK = _probe_db()


@pytest_asyncio.fixture(scope="session")
async def engine():
    if not DB_OK:
        pytest.skip("postgres test db unreachable (run make up)")
    eng = create_async_engine(TEST_DB_URL)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Seed the auth users the API tests log in as. The suite runs against a
    # dedicated test database that starts empty — without these rows every
    # login fails with 401 and half the suite is collateral damage.
    from sqlalchemy import select

    from app.core.security import hash_password
    from app.models import Role, User

    Session = async_sessionmaker(eng, expire_on_commit=False)
    async with Session() as s:
        for email, name, role, pw in (
            ("admin@bhrakshak.in", "Platform Admin", Role.admin, "Admin@123"),
            ("citizen@bhrakshak.in", "Demo Citizen", Role.citizen, "Citizen@123"),
        ):
            exists = (await s.execute(select(User).where(User.email == email))).scalar_one_or_none()
            if not exists:
                s.add(User(email=email, full_name=name, role=role, hashed_password=hash_password(pw)))
        await s.commit()
    yield eng
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await eng.dispose()


@pytest_asyncio.fixture
async def client(engine):
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async def override():
        async with Session() as s:
            yield s

    app.dependency_overrides[get_db] = override
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture(scope="session")
async def seeded_users(engine):
    """Insert the demo users (idempotent). Shared by endpoint test modules."""
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app.core.security import hash_password
    from app.models import Role, User

    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as s:
        for email, name, role, pw in (
            ("admin@bhrakshak.in", "Admin", Role.admin, "Admin@123"),
            ("citizen@bhrakshak.in", "Citizen", Role.citizen, "Citizen@123"),
        ):
            exists = (await s.execute(select(User).where(User.email == email))).scalar_one_or_none()
            if not exists:
                s.add(User(email=email, full_name=name, role=role,
                           hashed_password=hash_password(pw)))
        await s.commit()
    yield


ADMIN = ("admin@bhrakshak.in", "Admin@123")
CITIZEN = ("citizen@bhrakshak.in", "Citizen@123")


async def token_for(client: httpx.AsyncClient, email: str, password: str) -> dict:
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def auth(tok: dict) -> dict:
    return {"Authorization": f"Bearer {tok['access_token']}"}
