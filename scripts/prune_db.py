#!/usr/bin/env python3
"""Prune runtime bloat from db/custom.db after heavy test cycles.

Keeps: all zones/users/roads/shelters/etc (static seed), the LATEST risk
snapshot per zone (current map state), observations + notifications + SMS +
alerts + model runs from the last 24 h (live demo material), all field
messages / check-ins / reports (conversation history).
Then VACUUMs. Result: small, healthy repo DB.
"""
import sqlite3
import time

DB = 'db/custom.db'
# Prisma stores DateTime as epoch MILLISECONDS in SQLite
cutoff_ms = int(time.time() * 1000) - 24 * 3600 * 1000

c = sqlite3.connect(DB)
c.execute('PRAGMA foreign_keys=OFF')

# 1. RiskSnapshot: keep only the newest row per zone
before = c.execute('SELECT COUNT(*) FROM RiskSnapshot').fetchone()[0]
c.execute("""
    DELETE FROM RiskSnapshot WHERE id NOT IN (
        SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY zoneId ORDER BY ts DESC
            ) rn FROM RiskSnapshot
        ) WHERE rn = 1
    )
""")
after = c.execute('SELECT COUNT(*) FROM RiskSnapshot').fetchone()[0]
print(f'RiskSnapshot: {before} -> {after} (latest per zone)')

# 2. time-windowed tables
for table, col in [
    ('RainfallObs', 'ts'),
    ('NotificationEvent', 'createdAt'),
    ('SmsMessage', 'queuedAt'),
    ('ModelRun', 'createdAt'),
]:
    try:
        before = c.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
        c.execute(f"DELETE FROM {table} WHERE {col} < ?", (cutoff_ms,))
        after = c.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
        print(f'{table}: {before} -> {after}')
    except Exception as e:
        print(f'{table}: SKIP ({e})')

# 3. Alerts: keep recent + any active/acked (demo console material)
before = c.execute('SELECT COUNT(*) FROM Alert').fetchone()[0]
c.execute(f"DELETE FROM Alert WHERE createdAt < ? AND status = 'resolved'", (cutoff_ms,))
after = c.execute('SELECT COUNT(*) FROM Alert').fetchone()[0]
print(f'Alert: {before} -> {after}')

c.commit()
c.execute('VACUUM')
c.close()

import os
print('db size:', round(os.path.getsize(DB) / 1e6, 1), 'MB')
