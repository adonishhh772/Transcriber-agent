# services/graph/nodes/finalize.py
from langchain_core.runnables import RunnableConfig

from services.transcriber.simple import summarize_transcript


def make(settings):
    """
    Produces one final summary across all utterances.
    This node is called from main.py after the WS disconnects.
    """

    async def step(state, config: RunnableConfig | None = None):
        if state._final_sent:
            return state

        full_text = " ".join(u["text"] for u in state.utterances).strip()
        summary = await summarize_transcript(full_text)
        state.final_summary = summary

        if state.ws_send:
            await state.ws_send({
                "type": "summary.final",
                "session_id": state.session_id,
                **summary,
            })

        state._final_sent = True
        return state

    return step
