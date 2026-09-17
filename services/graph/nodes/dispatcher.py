# services/graph/nodes/dispatcher.py
from langchain_core.runnables import RunnableConfig


def make(settings):
    """
    Placeholder for downstream dispatch (e.g., throttling, ordering).
    Currently a no-op since nodes emit directly via state.ws_send.
    """
    async def step(state, config: RunnableConfig | None = None):
        return state

    return step
