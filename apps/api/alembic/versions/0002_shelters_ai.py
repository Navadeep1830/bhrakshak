"""shelters table + citizen_reports.ai_analysis (Model V geo-photo verification)

Revision ID: 0002_shelters_ai
Revises: 0001_initial
Create Date: 2026-09-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg
from geoalchemy2 import Geometry

revision = "0002_shelters_ai"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    # Model V verdict storage on citizen reports (photo AI pre-screen).
    # IF NOT EXISTS: a previous crashed attempt may have applied this DDL —
    # migrations must be re-runnable to converge, not explode.
    op.execute("ALTER TABLE citizen_reports ADD COLUMN IF NOT EXISTS ai_analysis JSONB")

    # Evacuation targets for the pathway model
    op.execute("""
    CREATE TABLE IF NOT EXISTS shelters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(160) NOT NULL,
      district VARCHAR(120),
      geom geometry(POINT,4326) NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 200,
      occupancy INTEGER NOT NULL DEFAULT 0,
      shelter_type VARCHAR(40) NOT NULL DEFAULT 'community_hall',
      has_medical BOOLEAN NOT NULL DEFAULT false,
      water_liters INTEGER NOT NULL DEFAULT 0,
      ration_packets INTEGER NOT NULL DEFAULT 0,
      elevation_m DOUBLE PRECISION,
      slope_deg DOUBLE PRECISION,
      distance_to_steep_slope_m DOUBLE PRECISION,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    )""")
    op.execute("CREATE INDEX IF NOT EXISTS idx_shelters_geom ON shelters USING GIST (geom)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shelters")
    op.execute("ALTER TABLE citizen_reports DROP COLUMN IF EXISTS ai_analysis")
