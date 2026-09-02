"""Feature 4 — Direct offline P2P transfer signaling (Wi-Fi Direct / BLE mesh).

Photos taken offline sync peer-to-peer: any peer with connectivity acts as a
relay. WebRTC needs offer/answer/candidate exchange even on a LAN, and BLE /
Wi-Fi-Direct transports need chunkACK bookkeeping. This router is that
signaling box — it stores nothing but ephemeral session state.

On a fully-isolated LAN (no cell), devices reach this API over the relay
phone's hotspot; if even that is down, the PWA falls back to transporting the
same messages over its BroadcastChannel loopback for same-device testing and
over Wi-Fi Direct multicast in the Android shell.
"""
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.models import User

router = APIRouter(prefix="/mesh", tags=["mesh"])

# session_id -> {"messages": [...], "created": ts}. Cap sizes; this is a
# rendezvous, not a store. Sessions expire after 30 minutes of silence.
_SESSIONS: dict[str, dict] = {}
_TTL = 30 * 60
_MAX_MSGS = 500
_MAX_BODY = 400_000  # ~300KB base64 chunk bound per message


def _gc() -> None:
    now = time.time()
    stale = [k for k, v in _SESSIONS.items() if now - v["created"] > _TTL]
    for k in stale:
        _SESSIONS.pop(k, None)


class MeshMessage(BaseModel):
    session_id: str = Field(min_length=8, max_length=64)
    sender_id: str = Field(min_length=1, max_length=64)
    kind: str = Field(pattern="^(offer|answer|candidate|chunk|chunkack|manifest|bye)$")
    to: str | None = None
    seq: int | None = None
    body: str = Field(max_length=_MAX_BODY, default="")


@router.post("/signal")
async def mesh_signal(msg: MeshMessage, user: User = Depends(get_current_user)):
    """Drop a signaling message into the session mailbox; returns messages
    addressed to the sender since `after` (long-poll in one round-trip).

    In-memory rendezvous only: no DB session, so it works even when Postgres
    is unhealthy — relay handshakes must not depend on the database."""
    _gc()
    if len(msg.body) > _MAX_BODY:
        raise HTTPException(413, "chunk too large")
    box = _SESSIONS.setdefault(msg.session_id, {"messages": [], "created": time.time()})
    box["created"] = time.time()
    entry = msg.model_dump()
    box["messages"].append(entry)
    if len(box["messages"]) > _MAX_MSGS:
        box["messages"] = box["messages"][-_MAX_MSGS:]
    inbox = [m for m in box["messages"] if m["sender_id"] != msg.sender_id
             and (m["to"] is None or m["to"] == msg.sender_id)]
    return {"accepted": True, "inbox": inbox[-100:]}


@router.get("/signal/{session_id}")
async def mesh_poll(session_id: str, after: int = 0,
                    user: User = Depends(get_current_user)):
    """Poll the session mailbox (messages the caller did not send)."""
    _gc()
    box = _SESSIONS.get(session_id)
    if box is None:
        return {"session_id": session_id, "messages": [], "cursor": after}
    msgs = box["messages"]
    return {
        "session_id": session_id,
        # seq is optional on stored messages: a None compares as "not after
        # the cursor" rather than TypeError-ing the poll loop.
        "messages": [m for m in msgs if (m.get("seq") or 0) > after][-200:],
        "cursor": len(msgs),
    }
