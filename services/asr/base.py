# services/asr/base.py
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List


class StreamingASR(ABC):
    """
    Minimal async interface for streaming ASR adapters.

    Contract:
      - feed(pcm16_frame): awaitable; push one audio frame of raw PCM16 (mono, 16 kHz).
      - read(): awaitable; returns a list of event dicts, each being either:
          {"type":"partial", "text": str, "start_ms": int, "end_ms": int}
          {"type":"final", "utterance": {
              "text": str, "start_ms": int, "end_ms": int,
              "words": [{"w": str, "t": int, "end": int}],  # optional
              "speaker": str|None
          }}
      - close(): optional; stop any background worker/connection.
    """

    @abstractmethod
    async def feed(self, pcm16_frame: bytes) -> None:
        ...

    @abstractmethod
    async def read(self) -> List[Dict[str, Any]]:
        ...

    async def close(self) -> None:
        return None
