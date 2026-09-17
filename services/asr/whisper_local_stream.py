# services/asr/whisper_local_stream.py
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

import numpy as np
from faster_whisper import WhisperModel

from services.asr.base import StreamingASR


class WhisperLocalStreamingASR(StreamingASR):
    """
    Pseudo-streaming adapter over faster-whisper.

    Strategy:
      - Accumulate raw PCM16 frames in a buffer.
      - A background worker periodically transcribes the NEW portion of audio
        using a rolling window (chunk_size_s) with overlap (hop_s).
      - Convert segment/word timestamps to absolute ms using a running offset.
      - Emit `final` utterances that end AFTER the last emitted end_ms (dedupe).
      - Optionally emit a synthetic `partial` using the latest segment text.
    """

    def __init__(
        self,
        model_name: str = "medium",
        sample_rate: int = 16000,
        language: Optional[str] = None,
        compute_type: str = "float16",
        device: Optional[str] = None,  # "cuda" or "cpu"
        chunk_size_s: float = 6.0,
        hop_s: float = 3.0,
        emit_partials: bool = True,
    ):
        self.sample_rate = int(sample_rate)
        self.language = language
        self.chunk_size_s = float(chunk_size_s)
        self.hop_s = float(hop_s)
        self.emit_partials = emit_partials

        # PCM16 ring buffer
        self._pcm = bytearray()
        self._lock = asyncio.Lock()

        # Book-keeping
        self._last_processed_samples = 0
        self._last_emitted_end_ms = 0
        self._events: List[Dict[str, Any]] = []

        # Worker control
        self._worker_task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()

        # Model
        self._model = WhisperModel(
            model_name,
            device=device or ("cuda" if compute_type.startswith("float") else "cpu"),
            compute_type=compute_type,
        )

    # -------- internal --------
    def _ensure_worker(self) -> None:
        # Start the worker only when the event loop is running
        if self._worker_task is None or self._worker_task.done():
            loop = asyncio.get_running_loop()
            self._stop.clear()
            self._worker_task = loop.create_task(self._worker_loop())

    # -------- public API --------
    async def feed(self, pcm16_frame: bytes) -> None:
        self._ensure_worker()
        async with self._lock:
            self._pcm.extend(pcm16_frame)

    async def read(self) -> List[Dict[str, Any]]:
        self._ensure_worker()
        out, self._events = self._events, []
        return out

    async def close(self) -> None:
        self._stop.set()
        if self._worker_task:
            try:
                await self._worker_task
            except Exception:
                pass
            self._worker_task = None

    # -------- worker --------
    async def _worker_loop(self):
        try:
            while not self._stop.is_set():
                await asyncio.sleep(0.15)

                total_samples = await self._pcm_len_samples()
                need_samples = self._last_processed_samples + int(self.hop_s * self.sample_rate)
                if total_samples < need_samples:
                    continue

                end_samp = min(total_samples, self._last_processed_samples + int(self.chunk_size_s * self.sample_rate))
                start_samp = max(0, end_samp - int(self.chunk_size_s * self.sample_rate))

                chunk = await self._pcm_slice(start_samp, end_samp)
                audio = self._pcm16_to_float32(chunk)

                seg_iter, _info = self._model.transcribe(
                    audio,
                    language=self.language,
                    vad_filter=True,
                    word_timestamps=True,
                    beam_size=5,
                )

                win_offset_ms = int(start_samp * 1000 / self.sample_rate)

                assembled = ""
                for seg in seg_iter:
                    seg_start_ms = win_offset_ms + int(1000 * (seg.start or 0.0))
                    seg_end_ms   = win_offset_ms + int(1000 * (seg.end   or 0.0))
                    text = (seg.text or "").strip()
                    words = []
                    if seg.words:
                        for w in seg.words:
                            w_start_ms = win_offset_ms + int(1000 * (w.start or 0.0))
                            w_end_ms   = win_offset_ms + int(1000 * (w.end   or 0.0))
                            words.append({"w": (w.word or "").strip(), "t": w_start_ms, "end": w_end_ms})

                    if text and seg_end_ms > self._last_emitted_end_ms:
                        self._events.append({
                            "type": "final",
                            "utterance": {
                                "text": text,
                                "start_ms": seg_start_ms,
                                "end_ms": seg_end_ms,
                                "words": words,
                                "speaker": None,
                            }
                        })
                        self._last_emitted_end_ms = seg_end_ms

                    if text:
                        assembled += ((" " if assembled else "") + text)

                if self.emit_partials and assembled:
                    self._events.append({
                        "type": "partial",
                        "text": assembled,
                        "start_ms": win_offset_ms,
                        "end_ms": win_offset_ms + int(1000 * self.chunk_size_s),
                    })

                self._last_processed_samples = min(
                    total_samples, self._last_processed_samples + int(self.hop_s * self.sample_rate)
                )
        except asyncio.CancelledError:
            return
        except Exception as e:
            self._events.append({"type": "error", "message": f"whisper_worker_error: {e}"})

    # -------- helpers --------
    async def _pcm_len_samples(self) -> int:
        async with self._lock:
            return len(self._pcm) // 2

    async def _pcm_slice(self, start_samp: int, end_samp: int) -> bytes:
        start_b = max(0, start_samp * 2)
        end_b = max(start_b, end_samp * 2)
        async with self._lock:
            return bytes(self._pcm[start_b:end_b])

    @staticmethod
    def _pcm16_to_float32(pcm: bytes) -> np.ndarray:
        if not pcm:
            return np.zeros((0,), dtype=np.float32)
        pcm_i16 = np.frombuffer(pcm, dtype=np.int16)
        return (pcm_i16.astype(np.float32) / 32768.0)
