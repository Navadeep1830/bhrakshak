"""safe_checkins table: citizen "I am safe" roll call.

Revision ID: 0004_safe_checkins
Revises: 0003_ble_sightings
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg
from geoalchemy2 import Geometry

revision = "0004_safe_checkins"
down_revision = "0003_ble_sightings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE IF NOT EXISTS safe_checkins (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      geom geometry(POINT,4326),
      district VARCHAR(120),
      device_hash VARCHAR(64),
      note TEXT
    )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_safe_checkins_ts ON safe_checkins(ts)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_safe_checkins_district ON safe_checkins(district)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS safe_checkins")
