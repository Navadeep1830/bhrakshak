"""ble_sightings table: live offline crowd density from BLE beacon counts.

Revision ID: 0003_ble_sightings
Revises: 0002_shelters_ai
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = "0003_ble_sightings"
down_revision = "0002_shelters_ai"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE IF NOT EXISTS ble_sightings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      n_devices INTEGER NOT NULL,
      n_android INTEGER NOT NULL DEFAULT 0,
      n_ios INTEGER NOT NULL DEFAULT 0,
      n_unknown INTEGER NOT NULL DEFAULT 0,
      mean_rssi DOUBLE PRECISION,
      n_reporters INTEGER NOT NULL DEFAULT 1
    )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_ble_sightings_zone ON ble_sightings(zone_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_ble_sightings_ts ON ble_sightings(ts)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ble_sightings")
