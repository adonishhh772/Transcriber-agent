from __future__ import annotations

from typing import Tuple


def resolve_whisper_runtime(settings, *, default_device: str = "cpu", default_compute: str = "int8") -> Tuple[str, str]:
    """Pick device/compute pair for faster-whisper based on settings and hardware."""
    device = getattr(settings, "whisper_device", None)
    compute = getattr(settings, "whisper_compute_type", None)

    if device and compute:
        return device, compute

    detected_device, detected_compute = default_device, default_compute
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            detected_device, detected_compute = "cuda", "float16"
    except Exception:
        pass

    return device or detected_device, compute or detected_compute
