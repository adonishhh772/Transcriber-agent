# apps/api/main.py
from __future__ import annotations

import asyncio
import json
from typing import Optional

from fastapi import FastAPI, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from apps.api.settings import settings
from apps.api.routers import health as health_router
from apps.api.ws_events import (
    ClientHello,
    make_ack,
    make_error,
)

from services.graph.build import build_live_graph
from services.graph.state import LiveState
from services.graph.nodes.finalize import make as make_finalize_step
from services.transcriber.simple import summarize_transcript, transcribe_audio_bytes
from services.utils.session_log import SessionLogger, tee_send

app = FastAPI(title="Transcriber Live", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=settings.cors_allow_methods,
    allow_headers=settings.cors_allow_headers,
)

# Routers
app.include_router(health_router.router)

# Compile graph once
graph = build_live_graph(settings)
finalize_step = make_finalize_step(settings)


@app.get("/healthz")
async def healthz():
    return JSONResponse(
        {"ok": True, "asr_backend": settings.asr_backend, "llm": settings.llm_provider}
    )


@app.post("/v1/simple/transcribe")
async def simple_transcribe(
    audio: UploadFile = File(...),
    language: Optional[str] = Query(default=None, description="Language hint (e.g. 'en')."),
    summary: bool = Query(default=True, description="Set false to skip LLM summary."),
):
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty_audio")

    try:
        transcription = await transcribe_audio_bytes(data, language=language)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail="transcription_failed") from exc

    summary_payload = None
    if summary:
        try:
            summary_payload = await summarize_transcript(transcription["transcript"])
        except Exception as exc:
            raise HTTPException(status_code=500, detail="summary_failed") from exc

    print(summary_payload)
    return {
        "transcript": transcription["transcript"],
        "segments": transcription["segments"],
        "detected_language": transcription["language"],
        "summary": summary_payload,
    }

@app.websocket("/v1/stream/{session_id}")
async def stream(ws: WebSocket, session_id: str, lang: Optional[str] = "en"):
    """
    WebSocket contract:
    - Client may send a JSON 'client.hello' first (codec/sample_rate/etc.), then switches to binary audio frames.
    - Server emits JSON text messages: asr.partial, asr.final, summary.rolling, summary.final.
    - Client closes the WS to end; server emits final summary before closing.
    """
    await ws.accept()

    # Base sender (raw -> JSON string)
    async def _base_send_json(payload: dict):
        await ws.send_text(json.dumps(payload, ensure_ascii=False))

    # Session logger (NDJSON at data/sessions/{session_id}.ndjson)
    logger = SessionLogger(settings.data_dir, session_id)
    await logger.start()

    # Wrap sender with logger so all outbound events are captured
    send_json = tee_send(_base_send_json, logger)

    # Try to read an optional JSON hello (non-fatal if absent)
    negotiated_sr = settings.sample_rate
    negotiated_frame = settings.frame_ms
    negotiated_lang = (lang or "en")

    hello_payload = None
    try:
        hello_raw = await asyncio.wait_for(ws.receive_text(), timeout=1.0)
        try:
            hello_obj = ClientHello.model_validate_json(hello_raw)
            hello_payload = hello_obj.model_dump()
            if hello_obj.sample_rate:
                negotiated_sr = hello_obj.sample_rate
            if hello_obj.frame_ms:
                negotiated_frame = hello_obj.frame_ms
            if hello_obj.language_hint:
                negotiated_lang = hello_obj.language_hint
        except Exception:
            # Not a valid hello; treat as noise
            pass
    except asyncio.TimeoutError:
        pass

    # Log session start (+ optional hello)
    await logger.log({
        "type": "session.open",
        "session_id": session_id,
        "lang_query": lang,
        "hello": hello_payload,
        "negotiated": {
            "sample_rate": negotiated_sr,
            "frame_ms": negotiated_frame,
            "language": negotiated_lang,
        },
    })

    # Send ACK to confirm negotiated parameters (logged via tee_send)
    try:
        ack_event = make_ack(session_id, codec="pcm16", sample_rate=negotiated_sr)
        await send_json(ack_event.model_dump(exclude_none=True))
    except Exception:
        # If ack fails we still proceed; downstream nodes may emit errors
        pass

    # Build live state for this session
    state = LiveState(
        session_id=session_id,
        language=negotiated_lang,
        frame_ms=negotiated_frame,
        sample_rate=negotiated_sr,
    )

    # Provide the (logged) JSON sender to nodes
    state.ws_send = send_json

    # Run the streaming graph loop; it pulls frames from the WS inside nodes
    try:
        await graph.ainvoke(state, {"configurable": {"ws": ws}})
    except WebSocketDisconnect:
        # Client disconnectedâ€”fall through to finalize
        pass
    except Exception as e:
        # Try to notify client about the error (and log it)
        try:
            err_event = make_error(session_id, message=str(e))
            await send_json(err_event.model_dump(exclude_none=True))
        except Exception:
            pass
        # Still attempt to finalize
        try:
            if not state._final_sent:
                await finalize_step(state)
        except Exception:
            pass
        # Re-raise so this is visible in logs
        raise
    finally:
        # Ensure we always emit a final summary once
        try:
            if not state._final_sent:
                await finalize_step(state)
        except Exception:
            # If finalize fails, try to at least send a terse error
            try:
                err_event = make_error(session_id, message="finalize_failed")
                await send_json(err_event.model_dump(exclude_none=True))
            except Exception:
                pass

        # Log close
        await logger.log({"type": "session.close", "session_id": session_id})

        # Close the socket gracefully
        try:
            await ws.close()
        except Exception:
            pass

        # Flush and stop the session logger
        try:
            await logger.close()
        except Exception:
            pass





