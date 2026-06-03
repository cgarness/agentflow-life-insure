"""Environment configuration for the Hypercheap voice bridge.

All provider secrets are read from the Render environment. Nothing here is ever
returned to the browser or written to Supabase. Sensible defaults match the spec
(Fennec 16k mono, OpenRouter OpenAI-compatible base URL, Inworld inworld-tts-1).
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _get(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _get_int(name: str, default: int) -> int:
    raw = _get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    port: int

    # Fennec ASR
    fennec_api_key: str
    fennec_token_url: str
    fennec_ws_url: str
    fennec_sample_rate: int
    fennec_channels: int

    # OpenRouter LLM (OpenAI-compatible)
    openrouter_api_key: str
    openrouter_base_url: str
    openrouter_model: str
    openrouter_site_url: str
    openrouter_app_name: str

    # Inworld TTS
    inworld_api_key: str
    inworld_base_url: str
    inworld_model_id: str
    inworld_voice_id: str
    inworld_sample_rate: int
    inworld_auth_scheme: str

    # Supabase (service role — server only)
    supabase_url: str
    supabase_service_role_key: str

    @property
    def fennec_ready(self) -> bool:
        return bool(self.fennec_api_key and self.fennec_ws_url)

    @property
    def openrouter_ready(self) -> bool:
        return bool(self.openrouter_api_key and self.openrouter_base_url)

    @property
    def inworld_ready(self) -> bool:
        return bool(self.inworld_api_key and self.inworld_base_url)

    @property
    def supabase_ready(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)


def load_config() -> Config:
    return Config(
        port=_get_int("PORT", 10000),
        fennec_api_key=_get("FENNEC_API_KEY"),
        fennec_token_url=_get(
            "FENNEC_TOKEN_URL",
            "https://api.fennec-asr.com/api/v1/transcribe/streaming-token",
        ),
        # WebSocket base (token is appended at connect). Override only if Fennec changes hosts.
        fennec_ws_url=_get(
            "FENNEC_WS_URL",
            "wss://api.fennec-asr.com/api/v1/transcribe/stream",
        ),
        fennec_sample_rate=_get_int("FENNEC_SAMPLE_RATE", 16000),
        fennec_channels=_get_int("FENNEC_CHANNELS", 1),
        openrouter_api_key=_get("OPENROUTER_API_KEY"),
        openrouter_base_url=_get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        openrouter_model=_get("OPENROUTER_MODEL", "google/gemini-2.0-flash-001"),
        openrouter_site_url=_get("OPENROUTER_SITE_URL", "https://app.agentflowcrm.com"),
        openrouter_app_name=_get("OPENROUTER_APP_NAME", "AgentFlow"),
        inworld_api_key=_get("INWORLD_API_KEY"),
        inworld_base_url=_get("INWORLD_BASE_URL", "https://api.inworld.ai/tts/v1/voice"),
        inworld_model_id=_get("INWORLD_MODEL_ID", "inworld-tts-1"),
        inworld_voice_id=_get("INWORLD_VOICE_ID", "Ashley"),
        inworld_sample_rate=_get_int("INWORLD_SAMPLE_RATE", 48000),
        inworld_auth_scheme=_get("INWORLD_AUTH_SCHEME", "Basic"),
        supabase_url=_get("SUPABASE_URL"),
        supabase_service_role_key=_get("SUPABASE_SERVICE_ROLE_KEY"),
    )
