"""
WebSocket event models & helpers for the live transcriber.

Contract:
- Server -> Client sends JSON text frames that conform to the event models below.
- Client -> Server may send a small JSON "hello" once on connect, then switches to binary audio frames.
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any, Callable, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator


# -----------------------------
# Protocol metadata
# -----------------------------

PROTOCOL: Literal["transcriber.ws"] = "transcriber.ws"
PROTOCOL_VERSION: Literal["1.0"] = "1.0"


def _now_ms() -> int:
    return int(time.time() * 1000)


def _eid() -> str:
    return uuid.uuid4().hex


# -----------------------------
# Envelopes
# -----------------------------

class EventBase(BaseModel):
    """Common envelope for all server->client events."""
    protocol: Literal["transcriber.ws"] = Field(default=PROTOCOL)
    version: Literal["1.0"] = Field(default=PROTOCOL_VERSION)
    type: str
    session_id: str
    ts_ms: int = Field(default_factory=_now_ms)
    event_id: str = Field(default_factory=_eid)

    # Allow extra fields in derived classes
    model_config = dict(extra="forbid")


# -----------------------------
# Client -> Server (optional JSON hello before binary audio)
# -----------------------------

class ClientHello(BaseModel):
    """Optional first JSON message from client describing audio stream params."""
    type: Literal["client.hello"] = "client.hello"
    session_id: Optional[str] = None
    codec: Literal["linear16", "pcm16", "opus"] = "pcm16"
    sample_rate: int = 16000
    channels: Literal[1, 2] = 1
    frame_ms: int = 20
    language_hint: Optional[str] = None
    user_agent: Optional[str] = None

    @field_validator("sample_rate")
    @classmethod
    def _sr_ok(cls, v: int) -> int:
        if v not in (8000, 16000, 22050, 24000, 32000, 44100, 48000):
            raise ValueError("Unsupported sample_rate")
        return v


class ServerAck(EventBase):
    type: Literal["server.ack"] = "server.ack"
    accepted_codec: Literal["linear16", "pcm16", "opus"] = "pcm16"
    accepted_sample_rate: int = 16000
    accepted_channels: Literal[1] = 1
    message: str = "ok"


# -----------------------------
# ASR events (Server -> Client)
# -----------------------------

class AsrPartial(EventBase):
    type: Literal["asr.partial"] = "asr.partial"
    text: str
    start_ms: int
    end_ms: int
    speaker: Optional[str] = None


class WordToken(BaseModel):
    w: str
    t: int  # start_ms
    end: int  # end_ms


class AsrFinal(EventBase):
    type: Literal["asr.final"] = "asr.final"
    text: str
    start_ms: int
    end_ms: int
    speaker: Optional[str] = None
    words: List[WordToken] = Field(default_factory=list)


# -----------------------------
# Summarization events (Server -> Client)
# -----------------------------

class RollingSummary(EventBase):
    type: Literal["summary.rolling"] = "summary.rolling"
    window_start_ms: int
    window_end_ms: int
    key_points: List[str] = Field(default_factory=list)
    notes: str = ""


class ActionItem(BaseModel):
    owner: Optional[str] = None
    description: str
    dueDate: Optional[str] = None  # YYYY-MM-DD


class ActionsUpdate(EventBase):
    type: Literal["summary.actions"] = "summary.actions"
    items: List[ActionItem] = Field(default_factory=list)


class FinalSummary(EventBase):
    type: Literal["summary.final"] = "summary.final"
    title: str
    executiveSummary: str
    keyPoints: List[str] = Field(default_factory=list)
    actionItems: List[ActionItem] = Field(default_factory=list)


# -----------------------------
# Error / control events
# -----------------------------

class ServerError(EventBase):
    type: Literal["error"] = "error"
    code: str = "internal_error"
    message: str


class ServerInfo(EventBase):
    type: Literal["info"] = "info"
    message: str


# Union type for any outbound event
AnyEvent = Union[
    ServerAck,
    AsrPartial,
    AsrFinal,
    RollingSummary,
    ActionsUpdate,
    FinalSummary,
    ServerError,
    ServerInfo,
]


# -----------------------------
# Helpers to build events
# -----------------------------

def make_ack(session_id: str, *, codec="pcm16", sample_rate=16000) -> ServerAck:
    return ServerAck(
        session_id=session_id,
        accepted_codec=codec, accepted_sample_rate=sample_rate, accepted_channels=1
    )


def make_partial(session_id: str, *, text: str, start_ms: int, end_ms: int, speaker: str | None = None) -> AsrPartial:
    return AsrPartial(session_id=session_id, text=text, start_ms=start_ms, end_ms=end_ms, speaker=speaker)


def make_final(
    session_id: str, *, text: str, start_ms: int, end_ms: int, words: List[Dict[str, Any]] | None = None,
    speaker: str | None = None
) -> AsrFinal:
    word_tokens = [WordToken(**w) if not isinstance(w, WordToken) else w for w in (words or [])]
    return AsrFinal(session_id=session_id, text=text, start_ms=start_ms, end_ms=end_ms, words=word_tokens, speaker=speaker)


def make_rolling(session_id: str, *, window_start_ms: int, window_end_ms: int, key_points: List[str], notes: str) -> RollingSummary:
    return RollingSummary(
        session_id=session_id,
        window_start_ms=window_start_ms,
        window_end_ms=window_end_ms,
        key_points=key_points or [],
        notes=notes or "",
    )


def make_actions(session_id: str, *, items: List[Dict[str, Any]]) -> ActionsUpdate:
    ai = [ActionItem(**i) if not isinstance(i, ActionItem) else i for i in (items or [])]
    return ActionsUpdate(session_id=session_id, items=ai)


def make_final_summary(
    session_id: str, *, title: str, executiveSummary: str, keyPoints: List[str], actionItems: List[Dict[str, Any]]
) -> FinalSummary:
    ais = [ActionItem(**i) if not isinstance(i, ActionItem) else i for i in (actionItems or [])]
    return FinalSummary(
        session_id=session_id,
        title=title, executiveSummary=executiveSummary, keyPoints=keyPoints or [], actionItems=ais
    )


def make_error(session_id: str, *, message: str, code: str = "internal_error") -> ServerError:
    return ServerError(session_id=session_id, message=message, code=code)


def make_info(session_id: str, *, message: str) -> ServerInfo:
    return ServerInfo(session_id=session_id, message=message)


# -----------------------------
# Serialization / send helpers
# -----------------------------

def event_to_json(event: AnyEvent) -> str:
    """Serialize an event to a JSON string."""
    return event.model_dump_json(exclude_none=True)


async def send_event(send_text: Callable[[str], Any], event: AnyEvent) -> None:
    """Convenience helper to send an event via a WebSocket's send_text."""
    await send_text(event_to_json(event))


# -----------------------------
# Example usage in your WS handler
# -----------------------------
# from apps.api.ws_events import make_ack, make_partial, send_event
# ...
# await send_event(ws.send_text, make_ack(session_id))
# await send_event(ws.send_text, make_partial(session_id, text="hello", start_ms=0, end_ms=500))
