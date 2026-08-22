"""initial schema: zones, risk_cells, hypertables, reports, alerts, roads, auth

Revision ID: 0001_initial
Revises:
Create Date: 2026-08-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg
from geoalchemy2 import Geometry

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    bind = op.get_bind()
    ctx = bind.dialect.name
    if ctx != "postgresql":
        # tests / local sqlite fallback: skip timescale-specific DDL
        pass

    # create_type=False: SQLAlchemy would otherwise emit CREATE TYPE again in
    # op.create_table below (DuplicateObjectError). Guarded DDL keeps reruns safe.
    op.execute(
        "DO $$ BEGIN "
        "IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN "
        "CREATE TYPE user_role AS ENUM ('admin','district_admin','field_official','citizen'); "
        "END IF; END $$;"
    )
    role_enum = pg.ENUM(
        "admin", "district_admin", "field_official", "citizen",
        name="user_role", create_type=False,
    )

    op.create_table(
        "users",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True, index=True),
        sa.Column("phone_hash", sa.String(64), nullable=True),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("role", role_enum, nullable=False),
        sa.Column("district", sa.String(120), nullable=True),
        sa.Column("preferred_lang", sa.String(10), nullable=False, server_default="en"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "refresh_tokens",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", pg.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), index=True),
        sa.Column("family_id", pg.UUID(as_uuid=True), index=True),
        sa.Column("token_hash", sa.String(64), unique=True, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "zones",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("zone_code", sa.String(20), nullable=False, unique=True, index=True),
        sa.Column("name", sa.String(160)),
        sa.Column("district", sa.String(120), index=True),
        sa.Column("state", sa.String(80)),
        sa.Column("geom", Geometry(geometry_type="POLYGON", srid=4326), nullable=False),
        sa.Column("susc_mean", sa.Float),
        sa.Column("susc_p90", sa.Float),
        sa.Column("population", sa.Integer),
        sa.Column("road_km", sa.Float),
        sa.Column("critical_infra", pg.JSONB, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_zones_geom", "zones", ["geom"], postgresql_using="gist")

    op.create_table(
        "risk_cells",
        sa.Column("zone_id", pg.UUID(as_uuid=True), sa.ForeignKey("zones.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("geom", Geometry(geometry_type="POLYGON", srid=4326)),
        sa.Column("zone_code", sa.String(20)),
        sa.Column("name", sa.String(160)),
        sa.Column("district", sa.String(120)),
        sa.Column("state", sa.String(80)),
        sa.Column("hazard_level", sa.SmallInteger, nullable=False, server_default="0"),
        sa.Column("prob_24h", sa.Float),
        sa.Column("model_version", sa.String(40)),
        sa.Column("driver", pg.JSONB, server_default="{}"),
        sa.Column("consecutive_above", sa.Integer, server_default="0"),
        sa.Column("consecutive_below", sa.Integer, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_risk_cells_geom", "risk_cells", ["geom"], postgresql_using="gist")
    op.create_index("ix_risk_cells_level", "risk_cells", ["hazard_level"])

    op.create_table(
        "risk_snapshots",
        sa.Column("zone_id", pg.UUID(as_uuid=True), sa.ForeignKey("zones.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("ts", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("horizon", sa.String(8), primary_key=True),
        sa.Column("hazard_level", sa.SmallInteger, nullable=False, server_default="0"),
        sa.Column("prob_24h", sa.Float),
        sa.Column("model_version", sa.String(40)),
        sa.Column("driver", pg.JSONB, server_default="{}"),
    )

    op.create_table(
        "rainfall_obs",
        sa.Column("ts", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("zone_id", pg.UUID(as_uuid=True), sa.ForeignKey("zones.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("rain_1h", sa.Float), sa.Column("rain_24h", sa.Float),
        sa.Column("rain_48h", sa.Float), sa.Column("rain_72h", sa.Float),
        sa.Column("rain_7d", sa.Float), sa.Column("eff_rain", sa.Float),
        sa.Column("soil_moisture", sa.Float),
    )

    op.create_table(
        "citizen_reports",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("author_id", pg.UUID(as_uuid=True), nullable=True),
        sa.Column("role", sa.String(30)),
        sa.Column("category", sa.String(30), nullable=False),
        sa.Column("geom", Geometry(geometry_type="POINT", srid=4326), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("media_refs", sa.ARRAY(sa.Text)),
        sa.Column("taken_at", sa.DateTime(timezone=True)),
        sa.Column("sync_batch", pg.UUID(as_uuid=True)),
        sa.Column("status", sa.String(20), server_default="pending"),
        sa.Column("verified_by", pg.UUID(as_uuid=True)),
        sa.Column("exif_geo_ok", sa.Boolean),
        sa.Column("dup_count", sa.Integer, server_default="0"),
        sa.Column("risk_contribution", sa.Float, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_reports_geom", "citizen_reports", ["geom"], postgresql_using="gist")

    op.create_table(
        "alerts",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("zone_id", pg.UUID(as_uuid=True), sa.ForeignKey("zones.id"), index=True),
        sa.Column("level", sa.Integer, nullable=False),
        sa.Column("message_template", sa.Text),
        sa.Column("lang", sa.String(10), server_default="en"),
        sa.Column("channels", sa.ARRAY(sa.Text)),
        sa.Column("recipients", sa.Integer, server_default="0"),
        sa.Column("ack_by", pg.UUID(as_uuid=True)),
        sa.Column("ack_at", sa.DateTime(timezone=True)),
        sa.Column("fired_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
    )

    op.create_table(
        "road_status",
        sa.Column("osm_way_id", sa.BigInteger, primary_key=True, autoincrement=False),
        sa.Column("road_name", sa.String(160)),
        sa.Column("segment_geom", Geometry(geometry_type="LINESTRING", srid=4326), nullable=False),
        sa.Column("status", sa.String(24), server_default="open"),
        sa.Column("source", sa.String(20), server_default="model"),
        sa.Column("detour_geom", Geometry(geometry_type="LINESTRING", srid=4326)),
        sa.Column("delay_min", sa.Integer),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_road_status_geom", "road_status", ["segment_geom"], postgresql_using="gist")

    op.create_table(
        "displacement_points",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("geom", Geometry(geometry_type="POINT", srid=4326)),
        sa.Column("vel_mm_yr", sa.Float),
        sa.Column("p_value", sa.Float),
        sa.Column("cluster_id", sa.Integer, index=True),
    )

    op.create_table(
        "displacement_series",
        sa.Column("point_id", sa.Integer, primary_key=True),
        sa.Column("ts", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("los_mm", sa.Float),
    )

    op.create_table(
        "model_registry",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(80), index=True),
        sa.Column("version", sa.String(40)),
        sa.Column("git_sha", sa.String(40)),
        sa.Column("metrics", pg.JSONB, server_default="{}"),
        sa.Column("artifact_uri", sa.Text),
        sa.Column("notes", sa.Text),
        sa.Column("trained_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "i18n_messages",
        sa.Column("key", sa.String(80), primary_key=True),
        sa.Column("lang", sa.String(10), primary_key=True),
        sa.Column("template", sa.Text, nullable=False),
    )

    op.create_table(
        "sensor_readings",
        sa.Column("sensor_id", sa.String(80), primary_key=True),
        sa.Column("ts", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("zone_id", pg.UUID(as_uuid=True), sa.ForeignKey("zones.id"), nullable=True),
        sa.Column("soil_moisture", sa.Float),
        sa.Column("rainfall_mm", sa.Float),
        sa.Column("battery_pct", sa.Float),
        sa.Column("extra", pg.JSONB, server_default="{}"),
    )

    op.create_table(
        "seismic_events",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("magnitude", sa.Float, nullable=False),
        sa.Column("lon", sa.Float, nullable=False),
        sa.Column("lat", sa.Float, nullable=False),
        sa.Column("depth_km", sa.Float),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("trigger_flag", sa.Boolean, server_default=sa.false()),
        sa.Column("fetched_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    if ctx == "postgresql":
        op.execute("SELECT create_hypertable('risk_snapshots','ts', if_not_exists => TRUE, migrate_data => TRUE)")
        op.execute("SELECT create_hypertable('rainfall_obs','ts', if_not_exists => TRUE, migrate_data => TRUE)")
        op.execute("SELECT create_hypertable('displacement_series','ts', if_not_exists => TRUE, migrate_data => TRUE)")
        op.execute("SELECT create_hypertable('sensor_readings','ts', if_not_exists => TRUE, migrate_data => TRUE)")
        # retention + compression policy (Timescale community)
        op.execute("SELECT add_retention_policy('rainfall_obs', INTERVAL '400 days', if_not_exists => TRUE)")


def downgrade() -> None:
    for t in ("seismic_events", "sensor_readings", "i18n_messages", "model_registry",
              "displacement_series", "displacement_points", "road_status", "alerts",
              "citizen_reports", "rainfall_obs", "risk_snapshots", "risk_cells", "zones",
              "refresh_tokens", "users"):
        op.drop_table(t)
    sa.Enum(name="user_role").drop(op.get_bind(), checkfirst=True)
