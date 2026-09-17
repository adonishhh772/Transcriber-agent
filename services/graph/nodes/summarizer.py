# services/graph/nodes/summarizer.py
import json
from typing import Any, Dict, List, Tuple

from langchain_core.runnables import RunnableConfig

from services.llm.client import get_llm
from services.llm.prompts import SYSTEM, ROLLING_TMPL
from services.llm.schema import ROLLING_SUMMARY_SCHEMA


def _dedupe_actions(existing: List[Dict[str, Any]], new_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Deduplicate actions by (owner|"" + description) case-insensitive.
    """
    seen = set()
    out: List[Dict[str, Any]] = []
    for item in [*existing, *new_items]:
        key = (item.get("owner") or "").strip().lower() + "|" + (item.get("description") or "").strip().lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def make(settings):
    """
    Runs rolling LLM summarization for each prepared window and emits summary.rolling events.
    """
    llm = get_llm(settings)

    async def step(state, config: RunnableConfig | None = None):
        cw = state.current_window
        if not cw or not cw.get("text"):
            return state

        user = ROLLING_TMPL.format(
            window_text=cw["text"],
            schema=json.dumps(ROLLING_SUMMARY_SCHEMA),
        )
        rolling = await llm.json_call(SYSTEM, user, ROLLING_SUMMARY_SCHEMA)

        # Persist rolling summary
        blob = {
            "start_ms": cw["start_ms"],
            "end_ms": cw["end_ms"],
            **rolling,
        }
        state.rolling_notes.append(blob)

        # Merge actions with dedupe
        new_actions = rolling.get("actions") or []
        if new_actions:
            state.action_items = _dedupe_actions(state.action_items, new_actions)

        # Emit rolling summary event
        if state.ws_send:
            await state.ws_send({
                "type": "summary.rolling",
                "session_id": state.session_id,
                "window_start_ms": cw["start_ms"],
                "window_end_ms": cw["end_ms"],
                "key_points": rolling.get("key_points", []),
                "notes": rolling.get("notes", ""),
            })

        # Clear the current window so we only summarize it once
        state.reset_window()
        return state

    return step
