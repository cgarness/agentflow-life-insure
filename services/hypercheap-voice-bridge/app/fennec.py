"""Fennec ASR streaming client.

Uses the official Fennec flow (see https://docs.fennec-asr.com/essentials/websockets):

  1. POST API key → short-lived streaming token
  2. WebSocket to /api/v1/transcribe/stream?streaming_token=...
  3. JSON start message (VAD config) then raw PCM16 16 kHz mono bytes
  4. JSON transcripts with a ``text`` field; optional partials for barge-in
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Awaitable, Callable, Dict, Optional
from urllib.parse import quote

import httpx
import websockets

VadCallback = Callable[[], Awaitable[None]]
TranscriptCallback = Callable[[str], Awaitable[None]]
ErrorCallback = Callable[[str, str], Awaitable[None]]  # (stage, message)

DEFAULT_TOKEN_URL = "https://api.fennec-asr.com/api/v1/transcribe/streaming-token"
DEFAULT_WS_BASE = "wss://api.fennec-asr.com/api/v1/transcribe/stream"

# Voice-agent tuned presets (docs: aggressive low-latency vs noisy environment).
_VAD_PRESETS: Dict[str, Dict[str, Any]] = {
    "low": {
        "threshold": 0.4,
        "min_silence_ms": 250,
        "speech_pad_ms": 200,
        "final_silence_s": 0.05,
        "start_trigger_ms": 30,
        "min_voiced_ms": 40,
        "min_chars": 1,
        "min_words": 1,
        "amp_extend": 1200,
        "force_decode_ms": 0,
        "debug": False,
    },
    "medium": {
        "threshold": 0.45,
        "min_silence_ms": 400,
        "speech_pad_ms": 200,
        "final_silence_s": 0.1,
        "start_trigger_ms": 36,
        "min_voiced_ms": 48,
        "min_chars": 1,
        "min_words": 1,
        "amp_extend": 1200,
        "force_decode_ms": 0,
        "debug": False,
    },
    "high": {
        "threshold": 0.65,
        "min_silence_ms": 400,
        "speech_pad_ms": 150,
        "final_silence_s": 0.1,
        "start_trigger_ms": 100,
        "min_voiced_ms": 250,
        "min_chars": 1,
        "min_words": 1,
        "amp_extend": 0,
        "force_decode_ms": 0,
        "debug": False,
    },
}


class FennecClient:
    def __init__(
        self,
        *,
        ws_base: str,
        token_url: str,
        api_key: str,
        sample_rate: int,
        channels: int,
        vad_aggressiveness: str,
        on_speech_start: VadCallback,
        on_final_transcript: TranscriptCallback,
        on_ready: Callable[[], Awaitable[None]],
        on_error: ErrorCallback,
    ) -> None:
        self._ws_base = ws_base.rstrip("/")
        self._token_url = token_url
        self._api_key = api_key
        self._sample_rate = sample_rate
        self._channels = channels
        self._vad_name = vad_aggressiveness if vad_aggressiveness in _VAD_PRESETS else "medium"
        self._on_speech_start = on_speech_start
        self._on_final_transcript = on_final_transcript
        self._on_ready = on_ready
        self._on_error = on_error

        self._ws: Optional[Any] = None
        self._recv_task: Optional[asyncio.Task] = None
        self._closed = False
        self._handshake_done = False

    @property
    def connected(self) -> bool:
        return self._ws is not None and self._handshake_done and not self._closed

    async def _fetch_streaming_token(self) -> str:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                self._token_url,
                headers={"X-API-Key": self._api_key, "content-type": "application/json"},
                json={},
            )
            resp.raise_for_status()
            data = resp.json()
            token = (data.get("token") or "").strip()
            if not token:
                raise RuntimeError(f"Fennec token endpoint returned no token: {data!r}")
            return token

    def _build_ws_url(self, streaming_token: str) -> str:
        # If Render still has the legacy placeholder path, ignore and use the official base.
        base = self._ws_base
        if "/v1/realtime" in base or "realtime" in base.split("/")[-1]:
            base = DEFAULT_WS_BASE
        sep = "&" if "?" in base else "?"
        return f"{base}{sep}streaming_token={quote(streaming_token, safe='')}"

    def _start_message(self) -> dict:
        return {
            "type": "start",
            "sample_rate": self._sample_rate,
            "channels": self._channels,
            "single_utterance": False,
            "vad": dict(_VAD_PRESETS[self._vad_name]),
        }

    async def connect(self) -> None:
        try:
            token = await self._fetch_streaming_token()
        except Exception as exc:  # noqa: BLE001
            await self._on_error("fennec.token_fetch_failed", str(exc))
            raise

        url = self._build_ws_url(token)
        try:
            self._ws = await websockets.connect(
                url,
                max_size=None,
                ping_interval=20,
            )
        except Exception as exc:  # noqa: BLE001
            await self._on_error("fennec.ws.connect_failed", str(exc))
            raise

        try:
            await self._send_json(self._start_message())
            ready_raw = await asyncio.wait_for(self._ws.recv(), timeout=10.0)
            ready_msg = json.loads(ready_raw)
            if not isinstance(ready_msg, dict) or ready_msg.get("type") != "ready":
                raise RuntimeError(f"expected type=ready, got: {ready_raw[:300]!r}")
            self._handshake_done = True
        except Exception as exc:  # noqa: BLE001
            await self._on_error("fennec.ws.handshake_failed", str(exc))
            raise

        self._recv_task = asyncio.create_task(self._recv_loop())
        await self._on_ready()

    async def send_audio(self, pcm16_16k: bytes) -> None:
        if not self.connected or not self._ws:
            return
        try:
            await self._ws.send(pcm16_16k)
        except Exception as exc:  # noqa: BLE001
            await self._on_error("fennec.audio.send_failed", str(exc))

    async def _send_json(self, payload: dict) -> None:
        if not self._ws:
            return
        await self._ws.send(json.dumps(payload))

    async def _recv_loop(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                if isinstance(raw, (bytes, bytearray)):
                    continue
                await self._handle_message(raw)
        except websockets.ConnectionClosed:
            return
        except Exception as exc:  # noqa: BLE001
            if not self._closed:
                await self._on_error("fennec.recv_failed", str(exc))

    async def _handle_message(self, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except (TypeError, ValueError):
            return
        if not isinstance(msg, dict):
            return

        mtype = str(msg.get("type") or "")

        if mtype in ("error", "Error"):
            await self._on_error("fennec.error", json.dumps(msg)[:300])
            return

        if mtype == "ready":
            return

        # Thought-detection mode (not used by default, but harmless to support).
        if mtype == "complete_thought":
            text = _extract_text(msg)
            if text:
                await self._on_final_transcript(text)
            return

        text = _extract_text(msg)
        if not text:
            return

        # Fennec often sends finalized utterances as {"text": "..."} with no type/is_final.
        # Only treat as partial (barge-in) when explicitly marked; otherwise run the LLM turn.
        if (
            mtype in ("partial", "interim")
            or msg.get("partial")
            or msg.get("is_partial")
            or msg.get("is_final") is False
        ):
            await self._on_speech_start()
            return

        await self._on_final_transcript(text)

    async def close(self) -> None:
        self._closed = True
        self._handshake_done = False
        if self._recv_task:
            self._recv_task.cancel()
        if self._ws:
            try:
                await self._ws.send(json.dumps({"type": "eos"}))
            except Exception:  # noqa: BLE001
                pass
            try:
                await self._ws.close()
            except Exception:  # noqa: BLE001
                pass
        self._ws = None


def _extract_text(msg: dict) -> str:
    if isinstance(msg.get("text"), str):
        return msg["text"].strip()
    if isinstance(msg.get("transcript"), str):
        return msg["transcript"].strip()
    return ""
