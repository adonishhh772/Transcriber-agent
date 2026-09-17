import asyncio

from fastapi import WebSocket
from langchain_core.runnables import RunnableConfig


def make(settings):
    async def step(state, config: RunnableConfig | None = None):
        ws = None
        if config:
            configurable = config.get("configurable") or {}
            ws = configurable.get("ws")

        if ws is None or not isinstance(ws, WebSocket):
            raise RuntimeError("frame_queue requires a WebSocket in runtime config")

        # Try to receive a binary frame (raw PCM16). Non-blocking with timeout.
        try:
            msg = await asyncio.wait_for(ws.receive(), timeout=0.05)
        except asyncio.TimeoutError:
            return state  # let other nodes run

        if msg["type"] == "websocket.receive":
            data = msg.get("bytes")
            if data:
                state.audio_queue.append(data)
        elif msg["type"] == "websocket.disconnect":
            # Break the loop by raising to top; finalize will run in main
            raise asyncio.CancelledError("Client disconnected")
        return state

    return step
