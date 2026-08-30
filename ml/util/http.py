"""Shared HTTP layer for the ingest pipeline.

Two things this buys us over calling ``requests`` directly:

1. **Proxy fallback.** Some machines route egress through a local proxy that
   returns 502 for certain hosts (observed with data.nasa.gov behind a
   WARP-style tunnel). Every call therefore tries the ambient proxy config
   first, then retries with proxy detection disabled.
2. **Bounded retries** with exponential backoff, so a transient blip does not
   silently downgrade a module to its synthetic fallback.

Nothing here raises on failure by default: ingest modules decide for themselves
whether to fall back, and every fallback is recorded so it can be audited.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Any

import requests

log = logging.getLogger("bhrakshak.http")

DEFAULT_TIMEOUT = 60
# Overridable because a 20-year backfill and an interactive dashboard call want
# very different patience. BHURAKSHAK_HTTP_RETRIES=6 with a 20s rate-limit base
# survives Open-Meteo throttling that a 3-attempt default does not.
RETRIES = int(os.environ.get("BHURAKSHAK_HTTP_RETRIES", "3"))
BACKOFF_BASE = 1.7
# Open-Meteo rate-limits aggressively when a backfill walks year by year. A 429
# needs a much longer AND growing pause: retrying after a flat 6s just spends
# another token from the same quota and extends the penalty. 20s -> 40s -> 80s,
# capped so a long backfill cannot stall forever.
RATE_LIMIT_SLEEP = float(os.environ.get("BHURAKSHAK_RATE_LIMIT_SLEEP", "20.0"))
RATE_LIMIT_MAX_SLEEP = 180.0

# Ambient-proxy session (honours HTTP(S)_PROXY) and a direct session that
# ignores it. Created once: building a Session per request is wasteful and
# defeats connection pooling.
_SESSION_ENV = requests.Session()
_SESSION_DIRECT = requests.Session()
_SESSION_DIRECT.trust_env = False


def get_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    timeout: int = DEFAULT_TIMEOUT,
    retries: int = RETRIES,
) -> dict[str, Any]:
    """GET a JSON document, trying the ambient proxy then a direct connection."""
    last: Exception | None = None
    for attempt in range(1, retries + 1):
        rate_limited = False
        for session in (_SESSION_ENV, _SESSION_DIRECT):
            try:
                resp = session.get(url, params=params, timeout=timeout)
                if resp.status_code == 429:
                    # Retrying another transport immediately just spends another
                    # token from the same quota, so stop and back off instead.
                    rate_limited = True
                    last = RuntimeError(f"429 Too Many Requests: {url}")
                    log.warning("rate limited on %s (attempt %d/%d)", url, attempt, retries)
                    break
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:  # noqa: BLE001 - we retry across transports
                last = exc
                log.debug("GET %s attempt %d failed (%s)", url, attempt, exc)
        if attempt < retries:
            if rate_limited:
                delay = min(RATE_LIMIT_SLEEP * (2 ** (attempt - 1)), RATE_LIMIT_MAX_SLEEP)
            else:
                delay = BACKOFF_BASE ** (attempt - 1)
            log.info("backing off %.0fs before attempt %d/%d", delay, attempt + 1, retries)
            time.sleep(delay)
    raise RuntimeError(f"GET {url} failed after {retries} attempts: {last}")


def try_get_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> tuple[dict[str, Any] | None, str | None]:
    """Non-raising variant. Returns (payload, error_message)."""
    try:
        return get_json(url, params=params, timeout=timeout), None
    except Exception as exc:  # noqa: BLE001
        return None, str(exc)


def download_file(
    url: str,
    dest: Path,
    *,
    timeout: int = 180,
    chunk_size: int = 1 << 16,
) -> Path:
    """Stream a file to disk. Idempotent: skipped when already present."""
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size > 0:
        log.info("already downloaded: %s (%d bytes)", dest, dest.stat().st_size)
        return dest

    dest.parent.mkdir(parents=True, exist_ok=True)
    last: Exception | None = None
    for session in (_SESSION_ENV, _SESSION_DIRECT):
        try:
            with session.get(url, timeout=timeout, stream=True) as resp:
                resp.raise_for_status()
                tmp = dest.with_suffix(dest.suffix + ".part")
                written = 0
                with open(tmp, "wb") as fh:
                    for chunk in resp.iter_content(chunk_size):
                        if chunk:
                            fh.write(chunk)
                            written += len(chunk)
                # atomic-ish swap so a killed download never looks complete
                tmp.replace(dest)
                log.info("downloaded %s (%d bytes)", dest, written)
                return dest
        except Exception as exc:  # noqa: BLE001
            last = exc
            log.debug("download %s failed (%s)", url, exc)
    raise RuntimeError(f"download {url} failed: {last}")
