from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, cast
import re
from textwrap import shorten

from faster_whisper import WhisperModel

from apps.api.settings import settings
from services.asr.utils import resolve_whisper_runtime
from services.llm.client import get_llm
from services.llm.prompts import FINAL_TMPL, SYSTEM
from services.llm.schema import FINAL_SUMMARY_SCHEMA, validate_and_repair

_model: WhisperModel | None = None
_model_lock = asyncio.Lock()


def _normalize_text(value: str) -> str:
    return " ".join(value.lower().split())


def _extract_summary_text(summary: Dict[str, object]) -> str:
    if isinstance(summary, dict):
        for key in ("executiveSummary", "notes", "summary", "text"):
            val = summary.get(key)
            if isinstance(val, str) and val.strip():
                return val
    return ""


def _looks_verbatim(summary: Dict[str, object], transcript: str) -> bool:
    if not summary:
        return False
    summary_text = _extract_summary_text(summary)
    if not summary_text:
        return False
    norm_summary = _normalize_text(summary_text)
    norm_transcript = _normalize_text(transcript)
    if not norm_summary:
        return False
    if norm_summary == norm_transcript:
        return True
    if len(norm_transcript) < 32:
        return False
    ratio = len(norm_summary) / max(1, len(norm_transcript))
    return ratio > 0.8


def _fallback_summary(transcript: str) -> Dict[str, object]:
    sentences = [s.strip() for s in re.split(r"[.!?]+", transcript) if s.strip()]
    if not sentences:
        sentences = [transcript.strip()]

    executive = " ".join(sentences[:3])
    executive = shorten(executive, width=400, placeholder="...")

    key_points = sentences[: min(5, len(sentences))]
    key_points = [shorten(point, width=200, placeholder="...") for point in key_points]

    title_source = key_points[0] if key_points else sentences[0]
    title = shorten(title_source, width=60, placeholder="...") or "Meeting Summary"

    return {
        "title": title,
        "executiveSummary": executive,
        "keyPoints": key_points,
        "actionItems": [],
    }


async def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        async with _model_lock:
            if _model is None:
                device, compute = resolve_whisper_runtime(settings)
                _model = WhisperModel(
                    getattr(settings, "whisper_model", "medium"),
                    device=device,
                    compute_type=compute,
                )
    return cast(WhisperModel, _model)


async def transcribe_audio_bytes(payload: bytes, *, language: Optional[str] = None) -> Dict[str, object]:
    if not payload:
        raise ValueError("Empty audio payload")

    model = await _get_model()

    def _run() -> Dict[str, object]:
        tmp_path: Optional[Path] = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
                tmp.write(payload)
                tmp.flush()
                tmp_path = Path(tmp.name)

            segments, info = model.transcribe(
                str(tmp_path),
                language=language,
                vad_filter=True,
                beam_size=5,
            )

            transcript_parts: List[str] = []
            out_segments: List[Dict[str, object]] = []
            for seg in segments:
                text = (seg.text or "").strip()
                if not text:
                    continue
                transcript_parts.append(text)
                out_segments.append(
                    {
                        "text": text,
                        "start": float(seg.start or 0.0),
                        "end": float(seg.end or 0.0),
                    }
                )

            transcript = " ".join(transcript_parts).strip()
            detected_language = getattr(info, "language", None) or language or "unknown"
            return {
                "transcript": transcript,
                "segments": out_segments,
                "language": detected_language,
            }
        finally:
            if tmp_path:
                try:
                    tmp_path.unlink(missing_ok=True)
                except Exception:
                    pass

    return await asyncio.to_thread(_run)


async def summarize_transcript(transcript: str) -> Dict[str, object]:
    normalized = (transcript or "").strip()
    if not normalized:
        return validate_and_repair({}, FINAL_SUMMARY_SCHEMA)

    llm = get_llm(settings)
    user_prompt = FINAL_TMPL.format(
        full_text=normalized,
        schema=json.dumps(FINAL_SUMMARY_SCHEMA),
    )
    summary = await llm.json_call(SYSTEM, user_prompt, FINAL_SUMMARY_SCHEMA)
    # print(_looks_verbatim(summary, normalized))
    # if _looks_verbatim(summary, normalized):
    #     summary = _fallback_summary(normalized)
    return summary




