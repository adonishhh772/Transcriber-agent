# apps/api/deps.py
from __future__ import annotations

import time
from functools import lru_cache
from typing import Any, Dict

from fastapi import Depends

from apps.api.settings import settings as app_settings, Settings
from services.graph.build import build_live_graph
from services.llm.client import get_llm
from apps.api.ws_events import PROTOCOL as WS_PROTOCOL, PROTOCOL_VERSION as WS_PROTOCOL_VERSION

# Process start time for uptime reporting
START_MONO = time.monotonic()
START_UNIX = time.time()


def app_started_unix_ts() -> float:
    return START_UNIX


def app_uptime_seconds() -> float:
    return max(0.0, time.monotonic() - START_MONO)


# ---- Dependency providers ----------------------------------------------------

def get_settings() -> Settings:
    """
    FastAPI dependency to access validated application settings.
    """
    return app_settings


@lru_cache(maxsize=1)
def _compile_graph():
    """Compile the live LangGraph once and reuse."""
    return build_live_graph(app_settings)


def get_live_graph():
    """
    FastAPI dependency to access the compiled live LangGraph.
    Returns a compiled graph object supporting .ainvoke(...)
    """
    return _compile_graph()


@lru_cache(maxsize=1)
def _llm_client():
    """Create a singleton LLM client based on current settings."""
    return get_llm(app_settings)


def get_llm_client():
    """
    FastAPI dependency to access the LLM client with a json_call(system, user, schema) coroutine.
    """
    return _llm_client()


def runtime_meta(settings: Settings = Depends(get_settings)) -> Dict[str, Any]:
    """
    FastAPI dependency that returns runtime metadata for health endpoints.
    """
    return {
        "ws_protocol": WS_PROTOCOL,
        "ws_protocol_version": WS_PROTOCOL_VERSION,
        "asr_backend": settings.asr_backend,
        "asr_configured": settings.is_asr_configured,
        "llm_provider": settings.llm_provider,
        "llm_model": settings.llm_model,
        "llm_configured": settings.is_llm_configured,
        "sample_rate": settings.sample_rate,
        "frame_ms": settings.frame_ms,
        "window_seconds": settings.window_seconds,
        "window_overlap_seconds": settings.window_overlap_seconds,
        "started_unix": START_UNIX,
        "uptime_seconds": app_uptime_seconds(),
    }
