# services/graph/nodes/asr_stream.py
from langchain_core.runnables import RunnableConfig

from services.asr.utils import resolve_whisper_runtime
from services.asr.whisper_local_stream import WhisperLocalStreamingASR


def make(settings):
    """
    Streams frames from state's audio_queue into a Whisper-based streaming adapter
    and emits asr.partial / asr.final events.
    """

    model_name = getattr(settings, "whisper_model", "medium")
    device, compute_type = resolve_whisper_runtime(settings)

    chunk_size_s = float(getattr(settings, "whisper_chunk_size_s", 6.0))
    hop_s = float(getattr(settings, "whisper_hop_s", 3.0))
    emit_partials = bool(getattr(settings, "whisper_emit_partials", True))

    asr = WhisperLocalStreamingASR(
        model_name=model_name,
        sample_rate=settings.sample_rate,
        language=None if settings.asr_detect_language else (getattr(settings, "language", "en") or "en"),
        compute_type=compute_type,
        device=device,
        chunk_size_s=chunk_size_s,
        hop_s=hop_s,
        emit_partials=emit_partials,
    )

    async def step(state, config: RunnableConfig | None = None):
        # Push frames currently in the queue to the ASR
        while state.audio_queue:
            frame = state.audio_queue.popleft()
            await asr.feed(frame)

        # Pull any available ASR events
        events = await asr.read()
        for evt in events:
            et = evt.get("type")
            if et == "partial":
                state.partial = {
                    "text": evt["text"],
                    "start_ms": int(evt["start_ms"]),
                    "end_ms": int(evt["end_ms"]),
                }
                if state.ws_send:
                    await state.ws_send({
                        "type": "asr.partial",
                        "session_id": state.session_id,
                        **state.partial,
                    })

            elif et == "final":
                utt = evt["utterance"]
                normalized = {
                    "text": (utt.get("text") or "").strip(),
                    "start_ms": int(utt.get("start_ms", 0)),
                    "end_ms": int(utt.get("end_ms", 0)),
                    "words": utt.get("words", []),
                    "speaker": utt.get("speaker"),
                }
                state.utterances.append(normalized)
                if state.ws_send:
                    await state.ws_send({
                        "type": "asr.final",
                        "session_id": state.session_id,
                        **normalized,
                    })
        return state

    return step
