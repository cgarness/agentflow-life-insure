"""Deepgram Flux v2 streaming STT client for the Pipeline voice stack.

Uses wss://api.deepgram.com/v2/listen with linear16 PCM at 16 kHz — same audio path
as Fennec in the Hypercheap bridge, but Deepgram Flux turn detection (EndOfTurn).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Awaitable, Callable, Dict, Optional, Tuple
from urllib.parse import urlencode

import websockets

SpeechCallback = Callable[[], Awaitable[None]]
TranscriptCallback = Callable[[str], Awaitable[None]]
ErrorCallback = Callable[[str, str], Awaitable[None]]
ReadyCallback = Callable[[], Awaitable[None]]
DebugCallback = Callable[[str, Dict[str, Any]], Awaitable[None]]

DEEPGRAM_FLUX_WS_BASE = "wss://api.deepgram.com/v2/listen"
DEEPGRAM_FLUX_CLIENT_BUILD = "v1-flux-80ms-chunks"

_RAW_DEBUG_LIMIT = 30


def flux_turn_params_from_interruption(level: str) -> Tuple[float, int]:
    """Map AI Testing interruption_sensitivity to Flux EOT params (matches Node bridge)."""
    if level == "low":
        return 0.9, 8000
    if level == "high":
        return 0.6, 3000
    return 0.8, 5000


def build_flux_listen_url(
    *,
    model: str,
    sample_rate: int,
    eot_threshold: float,
    eot_timeout_ms: int,
) -> str:
    params = {
        "model": model,
        "encoding": "linear16",
        "sample_rate": str(sample_rate),
        "eot_threshold": str(eot_threshold),
        "eot_timeout_ms": str(eot_timeout_ms),
    }
    return f"{DEEPGRAM_FLUX_WS_BASE}?{urlencode(params)}"


class DeepgramFluxClient:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        sample_rate: int,
        interruption_sensitivity: str,
        on_speech_start: SpeechCallback,
        on_final_transcript: TranscriptCallback,
        on_ready: ReadyCallback,
        on_error: ErrorCallback,
        on_debug: Optional[DebugCallback] = None,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._sample_rate = sample_rate
        self._interruption = (
            interruption_sensitivity
            if interruption_sensitivity in ("low", "medium", "high")
            else "medium"
        )
        self._on_speech_start = on_speech_start
        self._on_final_transcript = on_final_transcript
        self._on_ready = on_ready
        self._on_error = on_error
        self._on_debug = on_debug

        eot_threshold, eot_timeout_ms = flux_turn_params_from_interruption(self._interruption)
        self._eot_threshold = eot_threshold
        self._eot_timeout_ms = eot_timeout_ms

        self._ws: Optional[Any] = None
        self._recv_task: Optional[asyncio.Task] = None
        self._handshake_event: Optional[asyncio.Event] = None
        self._closed = False
        self._handshake_done = False
        self._eager_transcript: str = ""

        self._msgs_total = 0
        self._msgs_text = 0
        self._audio_chunks_sent = 0
        self._audio_bytes_sent = 0

    @property
    def connected(self) -> bool:
        return self._ws is not None and self._handshake_done and not self._closed

    @property
    def debug_stats(self) -> Dict[str, int]:
        return {
            "deepgram_msgs_total": self._msgs_total,
            "deepgram_msgs_text": self._msgs_text,
            "audio_chunks_sent": self._audio_chunks_sent,
            "audio_bytes_sent": self._audio_bytes_sent,
        }

    async def connect(self) -> None:
        url = build_flux_listen_url(
            model=self._model,
            sample_rate=self._sample_rate,
            eot_threshold=self._eot_threshold,
            eot_timeout_ms=self._eot_timeout_ms,
        )
        headers = {"Authorization": f"Token {self._api_key}"}
        try:
            self._ws = await websockets.connect(
                url,
                additional_headers=headers,
                max_size=None,
                compression=None,
                ping_interval=5,
            )
        except Exception as exc:  # noqa: BLE001
            await self._on_error("deepgram.flux.ws.connect_failed", str(exc))
            raise

        self._handshake_event = asyncio.Event()
        self._recv_task = asyncio.create_task(self._recv_loop())
        try:
            await asyncio.wait_for(self._handshake_event.wait(), timeout=10.0)
        except Exception as exc:  # noqa: BLE001
            if self._recv_task:
                self._recv_task.cancel()
            await self._on_error("deepgram.flux.ws.handshake_failed", str(exc))
            raise

        ready_result = self._on_ready()
        if asyncio.iscoroutine(ready_result):
            await ready_result
        if self._on_debug:
            await self._dbg_force(
                "deepgram.flux.config",
                {
                    "build": DEEPGRAM_FLUX_CLIENT_BUILD,
                    "model": self._model,
                    "sample_rate": self._sample_rate,
                    "eot_threshold": self._eot_threshold,
                    "eot_timeout_ms": self._eot_timeout_ms,
                    "interruption_sensitivity": self._interruption,
                },
            )

    async def send_audio(self, pcm16: bytes) -> None:
        if not self.connected or not self._ws:
            return
        try:
            await self._ws.send(pcm16)
            self._audio_chunks_sent += 1
            self._audio_bytes_sent += len(pcm16)
        except Exception as exc:  # noqa: BLE001
            await self._on_error("deepgram.flux.audio.send_failed", str(exc))

    async def _recv_loop(self) -> None:
        assert self._ws is not None
        await self._dbg_force("deepgram.flux.debug.recv_started", {"build": DEEPGRAM_FLUX_CLIENT_BUILD})
        exit_reason = "loop_end"
        try:
            while not self._closed:
                raw = await self._ws.recv()
                self._msgs_total += 1
                if isinstance(raw, (bytes, bytearray)):
                    await self._dbg("deepgram.flux.debug.raw", {
                        "n": self._msgs_total,
                        "kind": "binary",
                        "bytes": len(raw),
                    })
                    continue
                self._msgs_text += 1
                await self._dbg("deepgram.flux.debug.raw", {
                    "n": self._msgs_total,
                    "kind": "text",
                    "raw": str(raw)[:400],
                })
                await self._handle_message(raw)
        except websockets.ConnectionClosed as exc:
            exit_reason = f"connection_closed: code={getattr(exc, 'code', '?')}"
        except asyncio.CancelledError:
            exit_reason = "cancelled"
            raise
        except Exception as exc:  # noqa: BLE001
            exit_reason = f"error: {exc}"
            if not self._closed:
                await self._on_error("deepgram.flux.recv_failed", str(exc))
        finally:
            await self._dbg_force("deepgram.flux.debug.recv_ended", {
                "reason": exit_reason,
                "msgs_total": self._msgs_total,
                "closed": self._closed,
                "build": DEEPGRAM_FLUX_CLIENT_BUILD,
            })

    async def _handle_message(self, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except (TypeError, ValueError):
            return
        if not isinstance(msg, dict):
            return

        mtype = str(msg.get("type") or "")

        if mtype in ("Connected", "ListenV2Connected") or "connected" in mtype.lower():
            self._mark_handshake_ready()
            return

        if mtype in ("Error", "FatalError", "ListenV2FatalError"):
            err = msg.get("message") or msg.get("description") or json.dumps(msg)[:300]
            await self._on_error("deepgram.flux.error", str(err))
            return

        if mtype != "TurnInfo":
            self._mark_handshake_ready()
            return

        event = str(msg.get("event") or "")
        transcript = _extract_transcript(msg)

        if event in ("StartOfTurn", "SpeechStarted"):
            self._eager_transcript = ""
            await self._on_speech_start()
            return

        if event == "TurnResumed":
            self._eager_transcript = ""
            await self._on_speech_start()
            return

        if event == "EagerEndOfTurn" and transcript:
            self._eager_transcript = transcript
            return

        if event == "EndOfTurn" and transcript:
            self._eager_transcript = ""
            await self._on_final_transcript(transcript)
            return

        if event in ("Update", "Transcript") and transcript:
            if not msg.get("is_final", True):
                await self._on_speech_start()

    def _turn_task_pending(self) -> bool:
        return False

    def _mark_handshake_ready(self) -> None:
        if not self._handshake_done:
            self._handshake_done = True
            if self._handshake_event:
                self._handshake_event.set()

    async def _dbg(self, event: str, data: Dict[str, Any]) -> None:
        if self._on_debug is None or self._msgs_total > _RAW_DEBUG_LIMIT:
            return
        await self._dbg_force(event, data)

    async def _dbg_force(self, event: str, data: Dict[str, Any]) -> None:
        if self._on_debug is None:
            return
        try:
            await self._on_debug(event, data)
        except Exception:  # noqa: BLE001
            pass

    async def close(self) -> None:
        self._handshake_done = False
        self._closed = True
        if self._recv_task:
            self._recv_task.cancel()
            try:
                await self._recv_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._recv_task = None
        if self._ws:
            try:
                await self._ws.close()
            except Exception:  # noqa: BLE001
                pass
        self._ws = None


def _extract_transcript(msg: dict) -> str:
    for key in ("transcript", "text", "utterance"):
        val = msg.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""
