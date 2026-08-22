import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import DateTime, Float, ForeignKey, Integer, SmallInteger, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    zone_code: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # e.g. MZ-AIZ-047
    name: Mapped[str | None] = mapped_column(String(160))
    district: Mapped[str | None] = mapped_column(String(120), index=True)
    state: Mapped[str | None] = mapped_column(String(80))
    geom: Mapped[object] = mapped_column(Geometry(geometry_type="POLYGON", srid=4326))
    susc_mean: Mapped[float | None] = mapped_column(Float)  # 0..100 susceptibility (Model A)
    susc_p90: Mapped[float | None] = mapped_column(Float)
    population: Mapped[int | None] = mapped_column(Integer)
    road_km: Mapped[float | None] = mapped_column(Float)
    critical_infra: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RiskCell(Base):
    """Current tile-serving state per zone. Rewritten by the risk recompute task."""

    __tablename__ = "risk_cells"

    zone_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("zones.id", ondelete="CASCADE"), primary_key=True
    )
    geom: Mapped[object] = mapped_column(Geometry(geometry_type="POLYGON", srid=4326))
    zone_code: Mapped[str | None] = mapped_column(String(20))
    name: Mapped[str | None] = mapped_column(String(160))
    district: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(80))
    hazard_level: Mapped[int] = mapped_column(SmallInteger, default=0)  # 0..4
    prob_24h: Mapped[float | None] = mapped_column(Float)
    model_version: Mapped[str | None] = mapped_column(String(40))
    driver: Mapped[dict] = mapped_column(JSONB, default=dict)  # cached top SHAP drivers
    consecutive_above: Mapped[int] = mapped_column(Integer, default=0)  # hysteresis state
    consecutive_below: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RiskSnapshot(Base):
    """Timescale hypertable: full history of hazard levels per horizon."""

    __tablename__ = "risk_snapshots"

    zone_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("zones.id", ondelete="CASCADE"), primary_key=True
    )
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    horizon: Mapped[str] = mapped_column(String(8), primary_key=True)  # now|f24|f48|f72
    hazard_level: Mapped[int] = mapped_column(SmallInteger, default=0)
    prob_24h: Mapped[float | None] = mapped_column(Float)
    model_version: Mapped[str | None] = mapped_column(String(40))
    driver: Mapped[dict] = mapped_column(JSONB, default=dict)


class RainfallObs(Base):
    """Timescale hypertable: rainfall + soil moisture per zone."""

    __tablename__ = "rainfall_obs"

    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    zone_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("zones.id", ondelete="CASCADE"), primary_key=True
    )
    rain_1h: Mapped[float | None] = mapped_column(Float)
    rain_24h: Mapped[float | None] = mapped_column(Float)
    rain_48h: Mapped[float | None] = mapped_column(Float)
    rain_72h: Mapped[float | None] = mapped_column(Float)
    rain_7d: Mapped[float | None] = mapped_column(Float)
    eff_rain: Mapped[float | None] = mapped_column(Float)  # Kohler-Linsley exponential decay
    soil_moisture: Mapped[float | None] = mapped_column(Float)
