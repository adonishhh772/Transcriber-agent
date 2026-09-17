# services/utils/session_log.py
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Awaitable, Callable, Dict, Optional


class SessionLogger:
    """
    Async NDJSON logger for a streaming session.
    - Non-blocking: uses an asyncio.Queue and a background writer task.
    - Each call to `log(event)` enqueues one JSON object (one line).
    - Call `close()` in a finally block to flush and stop the worker.

    Log file: {base_dir}/sessions/{session_id}.ndjson
    """

    def __init__(
        self,
        base_dir: str,
        session_id: str,
        *,
        flush_interval_s: float = 0.5,
        max_queue: int = 1000,
    ):
        self.session_id = session_id
        self.path = Path(base_dir).expanduser().resolve() / "sessions" / f"{session_id}.ndjson"
        self.path.parent.mkdir(parents=True, exist_ok=True)

        self._q: "asyncio.Queue[str]" = asyncio.Queue(maxsize=max_queue)
        self._flush_interval = float(flush_interval_s)
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._stop_event.clear()
        self._task = asyncio.create_task(self._writer_loop())

    async def log(self, event: Dict) -> None:
        """
        Enqueue a JSON line (adds session_id and ts_ms if missing).
        """
        if not self._running:
            # lazy start if not started explicitly
            await self.start()

        if "session_id" not in event:
            event["session_id"] = self.session_id
        if "ts_ms" not in event:
            event["ts_ms"] = int(time.time() * 1000)

        line = json.dumps(event, ensure_ascii=False)
        try:
            await self._q.put(line)
        except asyncio.QueueFull:
            # Drop if congested—keeps the stream responsive during spikes.
            # Optionally, you could implement backpressure here.
            pass

    async def close(self) -> None:
        """
        Stop the worker after draining the queue.
        """
        if not self._running:
            return
        self._running = False
        self._stop_event.set()
        if self._task:
            try:
                await self._task
            except Exception:
                pass
            self._task = None

    # ---------------- internal ----------------

    async def _writer_loop(self) -> None:
        """
        Drains the queue and appends to file in batches for efficiency.
        """
        try:
            # Open once and keep the handle; safer & faster than reopening.
            with self.path.open("a", encoding="utf-8") as f:
                while True:
                    batch = []
                    try:
                        # Always get at least one item or timeout to check stop signal
                        line = await asyncio.wait_for(self._q.get(), timeout=self._flush_interval)
                        batch.append(line)
                    except asyncio.TimeoutError:
                        # No item in this interval
                        pass

                    # Drain any remaining items quickly
                    while not self._q.empty():
                        try:
                            batch.append(self._q.get_nowait())
                        except asyncio.QueueEmpty:
                            break

                    if batch:
                        f.write("\n".join(batch) + "\n")
                        f.flush()

                    # Exit condition: stop signal and queue empty
                    if self._stop_event.is_set() and self._q.empty():
                        break
        except Exception:
            # Swallow logger exceptions; do not break the app
            pass


def tee_send(
    send_json: Callable[[Dict], Awaitable[None]],
    logger: SessionLogger,
) -> Callable[[Dict], Awaitable[None]]:
    """
    Wrap a `send_json(dict)` coroutine so that every outbound payload is also logged.
    """
    async def _wrapped(payload: Dict) -> None:
        # Fire-and-forget logging (don't block the critical path)
        try:
            asyncio.create_task(logger.log(dict(payload)))
        except Exception:
            pass
        await send_json(payload)
    return _wrapped
