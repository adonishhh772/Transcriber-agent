# services/graph/state.py
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Deque, Dict, List, Optional


SendFn = Callable[[Dict[str, Any]], Awaitable[None]]


@dataclass
class LiveState:
    """
    Shared mutable state passed through the LangGraph streaming loop.
    """
    session_id: str
    language: Optional[str] = "en"
    sample_rate: int = 16000
    frame_ms: int = 20

    # Audio frames ring buffer (raw PCM16 bytes)
    audio_queue: Deque[bytes] = field(default_factory=lambda: deque(maxlen=5000))  # ~100s @ 20ms

    # ASR rolling state
    partial: Optional[Dict[str, Any]] = None
    utterances: List[Dict[str, Any]] = field(default_factory=list)

    # Current window for rolling summarization
    current_window: Optional[Dict[str, Any]] = None
    window_seconds: int = 90
    window_overlap_seconds: int = 30
    last_window_end_ms: int = 0

    # Summaries and actions
    rolling_notes: List[Dict[str, Any]] = field(default_factory=list)
    action_items: List[Dict[str, Any]] = field(default_factory=list)
    final_summary: Optional[Dict[str, Any]] = None

    # Outbound event sender (injected by main.py)
    ws_send: Optional[SendFn] = None

    # Internal flags
    _final_sent: bool = False

    def reset_window(self) -> None:
        self.current_window = None
