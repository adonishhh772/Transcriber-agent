# services/graph/nodes/segmenter.py
import re
from typing import Any, Dict, List

from langchain_core.runnables import RunnableConfig


_CLEAN_SPACES = re.compile(r"\s+")


def _clean_text(t: str) -> str:
    return _CLEAN_SPACES.sub(" ", (t or "").strip())


def make(settings):
    """
    Optional normalization/merging step. For v1, we just lightly clean utterance text.
    """
    async def step(state, config: RunnableConfig | None = None):
        if not state.utterances:
            return state
        # Clean the last few utterances (avoid reprocessing all)
        start_idx = max(0, len(state.utterances) - 5)
        for i in range(start_idx, len(state.utterances)):
            u = state.utterances[i]
            u["text"] = _clean_text(u.get("text", ""))
        return state

    return step
