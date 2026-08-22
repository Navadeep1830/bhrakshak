import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Role(str, enum.Enum):
    admin = "admin"
    district_admin = "district_admin"
    field_official = "field_official"
    citizen = "citizen"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone_hash: Mapped[str | None] = mapped_column(String(64))  # DPDP: store hash, not raw number
    full_name: Mapped[str] = mapped_column(String(255))
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role, name="user_role"), default=Role.citizen)
    district: Mapped[str | None] = mapped_column(String(120))
    preferred_lang: Mapped[str] = mapped_column(String(10), default="en")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RefreshToken(Base):
    """Refresh rotation with family-based reuse detection."""

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    family_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ModelRegistry(Base):
    __tablename__ = "model_registry"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(80), index=True)  # susceptibility|hazard|deformation|exposure|roads
    version: Mapped[str] = mapped_column(String(40))
    git_sha: Mapped[str | None] = mapped_column(String(40))
    metrics: Mapped[dict] = mapped_column(JSONB, default=dict)
    artifact_uri: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    trained_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class I18nMessage(Base):
    __tablename__ = "i18n_messages"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    lang: Mapped[str] = mapped_column(String(10), primary_key=True)
    template: Mapped[str] = mapped_column(Text)


class SensorReading(Base):
    __tablename__ = "sensor_readings"

    sensor_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    zone_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("zones.id"), nullable=True)
    soil_moisture: Mapped[float | None] = mapped_column(Float)
    rainfall_mm: Mapped[float | None] = mapped_column(Float)
    battery_pct: Mapped[float | None] = mapped_column(Float)
    extra: Mapped[dict] = mapped_column(JSONB, default=dict)


class SeismicEvent(Base):
    __tablename__ = "seismic_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # USGS event id
    magnitude: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    lat: Mapped[float] = mapped_column(Float)
    depth_km: Mapped[float | None] = mapped_column(Float)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    trigger_flag: Mapped[bool] = mapped_column(Boolean, default=False)  # M>=4 within 100km of pilot zones
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# Re-exported for alembic autogen convenience
BIGINT = BigInteger
IDX_GIST = Index
