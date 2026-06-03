"""Fennec ASR streaming client.

Streams PCM16 16 kHz mono audio to Fennec over a WebSocket and surfaces two
events the bridge cares about:

  * VAD speech-start  -> used for barge-in (cancel the active TTS/LLM turn)
  * final transcript  -> used to drive the next OpenRouter turn

The Fennec wire format is configurable (FENNEC_WS_URL) and message field names
follow common streaming-ASR conventions; confirm exact shapes against the Fennec
ASR docs and adjust the parser below if needed. All failures are reported with
the exact stage via the on_error callback so they show up in debug_log.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Awaitable, Callable, Optional

import websockets

VadCallback = Callable[[], Awaitable[None]]
TranscriptCallback = Callable[[str], Awaitable[None]]
ErrorCallback = Callable[[str, str], Awaitable[None]]  # (stage, message)

_VAD_AGGRESSIVENESS = {"low": 1, "medium": 2, "high": 3}


class FennecClient:
    def __init__(
        self,
        *,
        ws_url: str,
        api_key: str,
        sample_rate: int,
        channels: int,
        vad_aggressiveness: str,
        on_speech_start: VadCallback,
        on_final_transcript: TranscriptCallback,
        on_ready: Callable[[], Awaitable[None]],
        on_error: ErrorCallback,
    ) -> None:
        self._ws_url = ws_url
        self._api_key = api_key
        self._sample_rate = sample_rate
        self._channels = channels
        self._vad = _VAD_AGGRESSIVENESS.get(vad_aggressiveness, 2)
        self._on_speech_start = on_speech_start
        self._on_final_transcript = on_final_transcript
        self._on_ready = on_ready
        self._on_error = on_error

        self._ws: Optional[Any] = None
        self._recv_task: Optional[asyncio.Task] = None
        self._closed = False

    @property
    def connected(self) -> bool:
        return self._ws is not None and not self._closed

    async def connect(self) -> None:
        # API key is sent both as a header and on the URL query — Fennec accepts
        # one of these depending on deployment; both are harmless if unused.
        sep = "&" if "?" in self._ws_url else "?"
        url = f"{self._ws_url}{sep}api_key={self._api_key}"
        try:
            self._ws = await websockets.connect(
                url,
                additional_headers={"Authorization": f"Bearer {self._api_key}"},
                max_size=None,
                ping_interval=20,
            )
        except Exception as exc:  # noqa: BLE001
            await self._on_error("fennec.ws.connect_failed", str(exc))
            raise

        await self._send_json(
            {
                "type": "start",
                "encoding": "pcm_s16le",
                "sample_rate": self._sample_rate,
                "channels": self._channels,
                "interim_results": True,
                "vad": {"enabled": True, "aggressiveness": self._vad},
            }
        )
        await self._on_ready()
        self._recv_task = asyncio.create_task(self._recv_loop())

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

        # VAD speech-start events (a few common shapes).
        is_speech_start = (
            mtype in ("vad", "speech_started", "VadEvent")
            and str(msg.get("event") or msg.get("state") or "")
            in ("speech_start", "started", "start", "")
            and mtype != "transcript"
        )
        if mtype in ("speech_started",) or (mtype == "vad" and msg.get("speech")):
            is_speech_start = True
        if is_speech_start and mtype in ("vad", "speech_started", "VadEvent"):
            await self._on_speech_start()
            return

        # Transcript events.
        if mtype in ("transcript", "Results", "result", "final"):
            is_final = bool(
                msg.get("is_final")
                or msg.get("final")
                or msg.get("speech_final")
                or mtype == "final"
            )
            text = _extract_text(msg)
            if is_final and text:
                await self._on_final_transcript(text)
            return

        if mtype in ("error", "Error"):
            await self._on_error("fennec.error", json.dumps(msg)[:300])

    async def close(self) -> None:
        self._closed = True
        if self._recv_task:
            self._recv_task.cancel()
        if self._ws:
            try:
                await self._ws.send(json.dumps({"type": "stop"}))
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
    # Deepgram-like nested shape: channel.alternatives[0].transcript
    channel = msg.get("channel")
    if isinstance(channel, dict):
        alts = channel.get("alternatives")
        if isinstance(alts, list) and alts and isinstance(alts[0], dict):
            return str(alts[0].get("transcript") or "").strip()
    return ""
