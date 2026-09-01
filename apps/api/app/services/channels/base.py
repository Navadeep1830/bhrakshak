from __future__ import annotations

import abc
import logging
from dataclasses import dataclass

log = logging.getLogger("bhrakshak.channels")


@dataclass
class DeliveryResult:
    channel: str
    success: bool
    provider: str
    latency_ms: int | None = None
    error: str | None = None
    recipients: int = 0


class ChannelAdapter(abc.ABC):
    """Abstract alert channel. Implementations must be env-configurable and never raise."""

    channel: str = "unknown"
    provider: str = "unknown"

    @abc.abstractmethod
    async def send(self, *, zone_code: str, district: str, level: int, message: str, recipients: int) -> DeliveryResult:
        """Attempt delivery. Must swallow exceptions and return a DeliveryResult."""
