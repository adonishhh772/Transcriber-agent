# services/graph/build.py
from __future__ import annotations

from langgraph.graph import StateGraph

from services.graph.state import LiveState
from services.graph.nodes import (
    frame_queue,
    asr_stream,
    segmenter,
    windower,
    summarizer,
    dispatcher,
    finalize,
)


def build_live_graph(settings):
    """
    Build and compile the streaming LangGraph.
    The loop runs:
      frame_queue -> asr_stream -> segmenter -> windower -> summarizer -> dispatcher -> (back to) frame_queue
    Finalization is executed explicitly in main.py on disconnect.
    """
    g = StateGraph(LiveState)

    g.add_node("frame_queue", frame_queue.make(settings))
    g.add_node("asr_stream", asr_stream.make(settings))
    g.add_node("segmenter", segmenter.make(settings))
    g.add_node("windower", windower.make(settings))
    g.add_node("summarizer", summarizer.make(settings))
    g.add_node("dispatcher", dispatcher.make(settings))
    g.add_node("finalize", finalize.make(settings))  # used by main.py directly

    g.set_entry_point("frame_queue")
    g.add_edge("frame_queue", "asr_stream")
    g.add_edge("asr_stream", "segmenter")
    g.add_edge("segmenter", "windower")
    g.add_edge("windower", "summarizer")
    g.add_edge("summarizer", "dispatcher")
    g.add_edge("dispatcher", "frame_queue")  # loop

    return g.compile()
