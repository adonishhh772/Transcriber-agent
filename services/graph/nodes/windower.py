# services/graph/nodes/windower.py
from typing import Any, Dict, List

from langchain_core.runnables import RunnableConfig


def make(settings):
    """
    Creates a sliding window over recent utterances to feed the rolling summarizer.
    Emits a new window every hop = window_seconds - overlap.
    """
    window_ms = int(settings.window_seconds * 1000)
    hop_ms = int((settings.window_seconds - settings.window_overlap_seconds) * 1000)

    async def step(state, config: RunnableConfig | None = None):
        if not state.utterances:
            return state

        latest_end = state.utterances[-1]["end_ms"]
        if latest_end - state.last_window_end_ms < hop_ms:
            # Not time for a new window yet
            return state

        win_end = latest_end
        win_start = max(0, win_end - window_ms)

        window_utts: List[Dict[str, Any]] = [
            u for u in state.utterances
            if u["start_ms"] >= win_start and u["end_ms"] <= win_end
        ]
        window_text = " ".join(u["text"] for u in window_utts).strip()

        state.current_window = {
            "start_ms": int(win_start),
            "end_ms": int(win_end),
            "text": window_text,
        }
        state.last_window_end_ms = win_end
        return state

    return step
