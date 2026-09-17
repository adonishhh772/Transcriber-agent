# apps/api/settings.py  (only the changed/added bits shown; you can replace the whole file with this if easier)
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Literal, Optional, List

from dotenv import load_dotenv
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()

ASRBackend = Literal["deepgram_stream", "azure_stream", "whisper_local_stream"]
LLMProvider = Literal["openai", "anthropic", "deepseek"]


class Settings(BaseSettings):
    # --- Server ---
    api_host: str = "0.0.0.0"
    api_port: int = 8080
    cors_allow_origins: List[str] = Field(default_factory=lambda: ["*"])
    cors_allow_credentials: bool = True
    cors_allow_methods: List[str] = Field(default_factory=lambda: ["*"])
    cors_allow_headers: List[str] = Field(default_factory=lambda: ["*"])

    # --- Audio/Streaming ---
    sample_rate: int = 16000
    frame_ms: int = 20
    asr_detect_language: bool = True

    # --- Rolling windows ---
    window_seconds: int = 90
    window_overlap_seconds: int = 30

    # --- Storage/Dev ---
    data_dir: str = "./data"
    log_level: str = "INFO"

    # --- ASR selection ---
    asr_backend: ASRBackend = "whisper_local_stream"

    # Deepgram
    deepgram_api_key: Optional[str] = None
    deepgram_base_url: str = "wss://api.deepgram.com/v1/listen"

    # Azure Speech
    azure_speech_key: Optional[str] = None
    azure_speech_region: Optional[str] = None

    # --- Whisper (faster-whisper) ---
    whisper_model: str = "medium"
    whisper_device: Optional[str] = None
    whisper_compute_type: Optional[str] = None
    whisper_chunk_size_s: float = 6.0
    whisper_hop_s: float = 3.0
    whisper_emit_partials: bool = True

    # --- LLM selection & credentials ---
    # Use DeepSeek by default
    llm_provider: LLMProvider = "deepseek"
    llm_model: str = "deepseek-chat"

    # OpenAI
    openai_api_key: Optional[str] = None

    # Anthropic
    anthropic_api_key: Optional[str] = None

    # DeepSeek
    deepseek_api_key: Optional[str] = None
    deepseek_base_url: str = "https://api.deepseek.com"  # override if self-hosted/proxy

    # --- Feature toggles ---
    emit_debug_events: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- Validators ----
    @field_validator("sample_rate")
    @classmethod
    def _validate_sample_rate(cls, v: int) -> int:
        if v not in (8000, 16000, 22050, 24000, 32000, 44100, 48000):
            raise ValueError("Unsupported sample_rate")
        return v

    @field_validator("frame_ms")
    @classmethod
    def _validate_frame_ms(cls, v: int) -> int:
        if v not in (10, 20, 30, 40, 60):
            raise ValueError("frame_ms should be one of {10,20,30,40,60}")
        return v

    @field_validator("log_level")
    @classmethod
    def _validate_log_level(cls, v: str) -> str:
        v_up = v.upper()
        if v_up not in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"):
            raise ValueError("log_level must be DEBUG|INFO|WARNING|ERROR|CRITICAL")
        return v_up

    @field_validator("whisper_compute_type")
    @classmethod
    def _validate_compute_type(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.lower()
        if v not in ("float16", "float32", "int8"):
            raise ValueError("whisper_compute_type must be one of {'float16','float32','int8'} or empty for auto")
        return v

    @field_validator("whisper_device")
    @classmethod
    def _validate_device(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.lower()
        if v not in ("cuda", "cpu"):
            raise ValueError("whisper_device must be 'cuda' or 'cpu' or empty for auto")
        return v

    @model_validator(mode="after")
    def _validate_windows(self):
        if self.window_seconds <= 0:
            raise ValueError("window_seconds must be > 0")
        if self.window_overlap_seconds >= self.window_seconds:
            raise ValueError("window_overlap_seconds must be < window_seconds")
        if self.whisper_chunk_size_s <= 0:
            raise ValueError("whisper_chunk_size_s must be > 0")
        if self.whisper_hop_s <= 0:
            raise ValueError("whisper_hop_s must be > 0")
        if self.whisper_hop_s > self.whisper_chunk_size_s:
            raise ValueError("whisper_hop_s must be <= whisper_chunk_size_s")
        return self

    # ---- Computed ----
    @property
    def asr_requires_api_key(self) -> bool:
        return self.asr_backend in ("deepgram_stream", "azure_stream")

    @property
    def llm_api_key(self) -> Optional[str]:
        if self.llm_provider == "openai":
            return self.openai_api_key
        if self.llm_provider == "anthropic":
            return self.anthropic_api_key
        if self.llm_provider == "deepseek":
            return self.deepseek_api_key
        return None

    @property
    def is_llm_configured(self) -> bool:
        return bool(self.llm_api_key)

    @property
    def is_asr_configured(self) -> bool:
        if self.asr_backend == "deepgram_stream":
            return bool(self.deepgram_api_key)
        if self.asr_backend == "azure_stream":
            return bool(self.azure_speech_key and self.azure_speech_region)
        return True

    # ---- Helpers ----
    def configure_logging(self) -> None:
        level = getattr(logging, self.log_level, logging.INFO)
        logging.basicConfig(level=level, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")

    def assert_minimal(self) -> None:
        if not self.is_asr_configured:
            if self.asr_backend == "deepgram_stream":
                raise ValueError("Deepgram selected but DEEPGRAM_API_KEY is missing")
            if self.asr_backend == "azure_stream":
                raise ValueError("Azure Speech selected but AZURE_SPEECH_KEY/REGION are missing")
        if not self.is_llm_configured:
            raise ValueError(f"LLM provider '{self.llm_provider}' requires an API key")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    s = Settings()
    s.configure_logging()
    s.assert_minimal()
    return s

settings = get_settings()
