"""channels package — alert delivery adapters."""
from .dispatcher import dispatch_alert

__all__ = ["dispatch_alert"]
