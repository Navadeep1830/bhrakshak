"""Dispatcher — fans out Alert to concrete adapters per ALERT_CHANNEL_POLICY.

Called from risk_engine.evaluate_zone after an Alert row is committed.
Never raises: failures are logged and returned for the audit trail.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from .base import DeliveryResult
from .ivr import IvrAdapter
from .push import PushAdapter
from .siren import SirenAdapter
from .sms import SmsAdapter

log = logging.getLogger("bhrakshak.dispatcher")

_ADAPTERS: dict[str, Any] = {
    "sms": SmsAdapter(),
    "push": PushAdapter(),
    "ivr": IvrAdapter(),
    "siren": SirenAdapter(),
}


async def dispatch_alert(*, zone_code: str, district: str, level: int, message: str, recipients: int, channels: list[str] | None = None) -> list[DeliveryResult]:
    """Dispatch to each requested channel concurrently (timeout 12s each)."""
    if not channels:
        from app.services.risk_engine import ALERT_CHANNEL_POLICY

        channels = ALERT_CHANNEL_POLICY.get(level, ["push"])

    tasks = []
    for ch in channels:
        adapter = _ADAPTERS.get(ch)
        if not adapter:
            log.warning("Unknown channel %s for zone %s — skipped", ch, zone_code)
            continue
        tasks.append(_safe_send(adapter, zone_code=zone_code, district=district, level=level, message=message, recipients=recipients))

    if not tasks:
        return []
    results = await asyncio.gather(*tasks)
    for r in results:
        if r.success:
            log.info("Channel %s delivered zone=%s level=%d provider=%s recipients=%d", r.channel, zone_code, level, r.provider, r.recipients)
        else:
            log.warning("Channel %s FAILED zone=%s error=%s", r.channel, zone_code, r.error)
    return list(results)


async def _safe_send(adapter, **kwargs) -> DeliveryResult:
    try:
        return await asyncio.wait_for(adapter.send(**kwargs), timeout=12)
    except asyncio.TimeoutError:
        log.warning("Channel %s timeout for zone %s", adapter.channel, kwargs.get("zone_code"))
        from .base import DeliveryResult

        return DeliveryResult(channel=adapter.channel, success=False, provider=adapter.provider, error="timeout", recipients=0)
    except Exception as e:
        log.warning("Channel %s exception: %s", adapter.channel, e)
        from .base import DeliveryResult

        return DeliveryResult(channel=adapter.channel, success=False, provider=adapter.provider, error=str(e)[:300], recipients=0)
