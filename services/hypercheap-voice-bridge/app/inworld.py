"""Inworld TTS client (inworld-tts-1).

Synthesizes a text segment to PCM16 (LINEAR16) at the configured sample rate via
the Inworld TTS REST API. The bridge then resamples to 8 kHz µ-law for Twilio.
Per-segment synthesis keeps latency low for short conversational replies and lets
the bridge cancel cleanly on barge-in.

Auth scheme and endpoint are configurable so they can be corrected on Render
without a code change; confirm exact request/response shapes against Inworld docs.
"""

from __future__ import annotations

import base64
from typing import Optional

import httpx

from .audio import strip_wav_header


class InworldUsage:
    def __init__(self) -> None:
        self.chars: int = 0
        self.audio_samples: int = 0  # PCM16 samples produced (pre-resample)


class InworldClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model_id: str,
        voice_id: str,
        sample_rate: int,
        auth_scheme: str = "Basic",
        timeout_sec: float = 30.0,
    ) -> None:
        self._base_url = base_url
        self._model_id = model_id
        self._voice_id = voice_id
        self._sample_rate = sample_rate
        self._auth = f"{auth_scheme} {api_key}"
        self._client = httpx.AsyncClient(timeout=timeout_sec)

    @property
    def sample_rate(self) -> int:
        return self._sample_rate

    async def synthesize(
        self, text: str, voice_id: Optional[str] = None, usage: Optional[InworldUsage] = None
    ) -> bytes:
        """Return raw PCM16 mono at ``self._sample_rate`` for the given text."""
        clean = text.strip()
        if not clean:
            return b""
        body = {
            "text": clean,
            "voiceId": voice_id or self._voice_id,
            "modelId": self._model_id,
            "audioConfig": {
                "audioEncoding": "LINEAR16",
                "sampleRateHertz": self._sample_rate,
            },
        }
        resp = await self._client.post(
            self._base_url,
            headers={"Authorization": self._auth, "Content-Type": "application/json"},
            json=body,
        )
        resp.raise_for_status()
        pcm = self._extract_pcm(resp)
        if usage is not None:
            usage.chars += len(clean)
            usage.audio_samples += len(pcm) // 2
        return pcm

    def _extract_pcm(self, resp: httpx.Response) -> bytes:
        ctype = resp.headers.get("content-type", "")
        if "application/json" in ctype:
            data = resp.json()
            b64 = (
                data.get("audioContent")
                or data.get("audio")
                or (data.get("result") or {}).get("audioContent")
                or ""
            )
            if not b64:
                return b""
            raw = base64.b64decode(b64)
        else:
            raw = resp.content
        return strip_wav_header(raw)

    async def aclose(self) -> None:
        await self._client.aclose()
