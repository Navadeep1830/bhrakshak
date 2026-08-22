import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.db.session import get_db
from app.models import RefreshToken, Role, User
from app.schemas.schemas import LoginIn, RefreshIn, TokenOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=201)
async def register(body: LoginIn, full_name: str = "New User", role: Role = Role.citizen,
                   district: str | None = None, lang: str = "en", db: AsyncSession = Depends(get_db)):
    """Open registration for citizens; staff accounts are seeded by admins."""
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Email already registered")
    user = User(
        email=body.email,
        full_name=full_name,
        hashed_password=hash_password(body.password),
        role=role if role == Role.citizen else Role.citizen,
        district=district,
        preferred_lang=lang,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    limiter = getattr(request.app.state, "limiter", None)
    res = await db.execute(select(User).where(User.email == body.email))
    user = res.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    family_id = uuid.uuid4()
    raw_refresh, refresh_hash = create_refresh_token(str(user.id), str(family_id))
    db.add(
        RefreshToken(
            user_id=user.id,
            family_id=family_id,
            token_hash=refresh_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_days),
        )
    )
    await db.commit()
    return TokenOut(
        access_token=create_access_token(str(user.id), user.role.value),
        refresh_token=raw_refresh,
        role=user.role.value,
    )


@router.post("/refresh", response_model=TokenOut)
async def refresh(body: RefreshIn, db: AsyncSession = Depends(get_db)):
    """Refresh rotation with reuse detection:
    presenting an already-used/revoked token kills the whole token family."""
    try:
        payload = decode_token(body.refresh_token)
    except Exception:
        raise HTTPException(401, "Invalid refresh token")
    if payload.get("type") != "refresh":
        raise HTTPException(401, "Wrong token type")

    token_hash = hash_token(body.refresh_token)
    row = (await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))).scalar_one_or_none()

    if row is not None and row.used_at is not None:
        # reuse detected -> revoke entire family
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == row.family_id)
            .values(revoked_at=datetime.now(timezone.utc))
        )
        await db.commit()
        raise HTTPException(401, "Refresh token reuse detected - family revoked")

    if row is None or row.revoked_at is not None or row.expires_at < datetime.now(timezone.utc):
        raise HTTPException(401, "Refresh token expired or revoked")

    user = await db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise HTTPException(401, "User inactive")

    row.used_at = datetime.now(timezone.utc)
    raw_refresh, new_hash = create_refresh_token(str(user.id), str(row.family_id))
    db.add(
        RefreshToken(
            user_id=user.id,
            family_id=row.family_id,
            token_hash=new_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_days),
        )
    )
    await db.commit()
    return TokenOut(
        access_token=create_access_token(str(user.id), user.role.value),
        refresh_token=raw_refresh,
        role=user.role.value,
    )


@router.post("/logout", status_code=204)
async def logout(body: RefreshIn, db: AsyncSession = Depends(get_db)):
    token_hash = hash_token(body.refresh_token)
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == token_hash)
        .values(revoked_at=datetime.now(timezone.utc))
    )
    await db.commit()


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user
