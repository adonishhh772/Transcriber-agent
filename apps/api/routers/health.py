# apps/api/routers/health.py
from __future__ import annotations

from fastapi import APIRouter, Depends
from starlette.responses import JSONResponse

from apps.api.deps import (
    get_settings,
    runtime_meta,
    app_uptime_seconds,
)
from apps.api.settings import Settings

router = APIRouter(prefix="", tags=["health"])


@router.get("/healthz")
async def healthz(meta = Depends(runtime_meta)):
    """
    Liveness probe. Returns basic runtime metadata.
    """
    return JSONResponse({"ok": True, **meta})


@router.get("/ready")
async def ready(settings: Settings = Depends(get_settings)):
    """
    Readiness probe. Ensures external providers are configured.
    Returns 200 if ready; 503 otherwise.
    """
    problems = []

    # Check LLM config
    if not settings.is_llm_configured:
        problems.append(f"LLM provider '{settings.llm_provider}' API key not configured")

    # Check ASR config if using a managed streaming backend
    if not settings.is_asr_configured:
        problems.append(f"ASR backend '{settings.asr_backend}' not properly configured")

    # Window sanity
    if settings.window_overlap_seconds >= settings.window_seconds:
        problems.append("window_overlap_seconds must be < window_seconds")

    status = 200 if not problems else 503
    return JSONResponse(
        {
            "ready": status == 200,
            "uptime_seconds": app_uptime_seconds(),
            "issues": problems,
        },
        status_code=status,
    )
