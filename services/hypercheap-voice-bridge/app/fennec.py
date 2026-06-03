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
DebugCallback = Callable[[str, Dict[str, Any]], Awaitable[None]]  # (event, data)

# TEMP DIAGNOSTIC: how many raw Fennec frames to capture into debug_log per session.
_RAW_DEBUG_LIMIT = 30

DEFAULT_TOKEN_URL = "https://api.fennec-asr.com/api/v1/transcribe/streaming-token"
DEFAULT_WS_BASE = "wss://api.fennec-asr.com/api/v1/transcribe/stream"
# Bumped when Fennec wire protocol changes — appears in ai_test_sessions.debug_log.
FENNEC_CLIENT_BUILD = "v5-source-vad-events"

# Every preset MUST request VAD events (events/event_hz) — the source repo
# (jordan-gibbs/hypercheap-voiceAI voice_backend/app/agent/fennec_ws.py) sets
# these in the VAD dict before transmission; without them Fennec returns the
# initial "ready" only and never emits VAD/transcript for streamed PCM.
_VAD_EVENTS = {"events": True, "event_hz": 8}

# Voice-agent tuned presets (docs: aggressive low-latency vs noisy environment).
# "source_default"/"medium" mirror the source repo's tuned low-latency turn config.
_VAD_PRESETS: Dict[str, Dict[str, Any]] = {
    "source_default": {
        # Verbatim from the source repo fennec_ws default VAD payload.
        "threshold": 0.35,
        "min_silence_ms": 50,
        "speech_pad_ms": 350,
        "final_silence_s": 0.05,
        "start_trigger_ms": 24,
        "min_voiced_ms": 36,
        "min_chars": 1,
        "min_words": 1,
        "amp_extend": 600,
        "force_decode_ms": 0,
        "debug": False,
        **_VAD_EVENTS,
    },
    "low": {
        # Matches Fennec docs "aggressive" live-transcription example.
        "threshold": 0.5,
        "min_silence_ms": 100,
        "speech_pad_ms": 200,
        "final_silence_s": 0.1,
        "start_trigger_ms": 36,
        "min_voiced_ms": 48,
        "min_chars": 1,
        "min_words": 1,
        "amp_extend": 1200,
        "force_decode_ms": 0,
        "debug": False,
        **_VAD_EVENTS,
    },
    "medium": {
        # Aligned to the source repo (was conservative: threshold 0.45 / silence 400ms).
        "threshold": 0.35,
        "min_silence_ms": 50,
        "speech_pad_ms": 350,
        "final_silence_s": 0.05,
        "start_trigger_ms": 24,
        "min_voiced_ms": 36,
        "min_chars": 1,
        "min_words": 1,
        "amp_extend": 600,
        "force_decode_ms": 0,
        "debug": False,
        **_VAD_EVENTS,
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
        **_VAD_EVENTS,
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
        on_debug: Optional[DebugCallback] = None,
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
        self._on_debug = on_debug

        self._ws: Optional[Any] = None
        self._recv_task: Optional[asyncio.Task] = None
        self._handshake_event: Optional[asyncio.Event] = None
        self._closed = False
        self._handshake_done = False

        # TEMP DIAGNOSTIC counters.
        self._raw_seen = 0
        self._raw_text = 0
        self._raw_binary = 0
        self._audio_chunks_sent = 0
        self._audio_bytes_sent = 0
        # Transcription-path health flags (drive fennec.no_transcript_timeout).
        self._vad_received = False
        self._transcript_received = False
        self._no_transcript_logged = False

    @property
    def connected(self) -> bool:
        return self._ws is not None and self._handshake_done and not self._closed

    @property
    def debug_stats(self) -> Dict[str, int]:
        # TEMP DIAGNOSTIC: totals of frames received from Fennec this session.
        return {
            "fennec_msgs_total": self._raw_seen,
            "fennec_msgs_text": self._raw_text,
            "fennec_msgs_binary": self._raw_binary,
            "audio_chunks_sent": self._audio_chunks_sent,
            "audio_bytes_sent": self._audio_bytes_sent,
        }

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
        vad = dict(_VAD_PRESETS[self._vad_name])
        # Defensive: ensure VAD events are always requested even for an external
        # preset that somehow lost them — Fennec stays silent without these.
        vad.setdefault("events", True)
        vad.setdefault("event_hz", 8)
        return {
            "type": "start",
            "sample_rate": self._sample_rate,
            "channels": self._channels,
            "single_utterance": False,
            "vad": vad,
        }

    async def connect(self) -> None:
        try:
            token = await self._fetch_streaming_token()
        except Exception as exc:  # noqa: BLE001
            await self._on_error("fennec.token_fetch_failed", str(exc))
            raise

        url = self._build_ws_url(token)
        try:
            # Fennec docs/examples disable permessage-deflate (Node: perMessageDeflate:
            # false). Default Python websockets compression breaks binary PCM streaming.
            self._ws = await websockets.connect(
                url,
                max_size=None,
                compression=None,
                ping_interval=5,
            )
        except Exception as exc:  # noqa: BLE001
            await self._on_error("fennec.ws.connect_failed", str(exc))
            raise

        self._handshake_event = asyncio.Event()
        self._recv_task = asyncio.create_task(self._recv_loop())
        start_payload = self._start_message()
        try:
            await self._send_json(start_payload)
            if self._on_debug:
                await self._dbg_force("fennec.ws.start_sent", {"vad": self._vad_name, "sample_rate": self._sample_rate})
            await asyncio.wait_for(self._handshake_event.wait(), timeout=10.0)
        except Exception as exc:  # noqa: BLE001
            if self._recv_task:
                self._recv_task.cancel()
            await self._on_error("fennec.ws.handshake_failed", str(exc))
            raise

        await self._on_ready()
        if self._on_debug:
            await self._dbg_force(
                "fennec.ws.config",
                {
                    "build": FENNEC_CLIENT_BUILD,
                    "ws_base": self._ws_base,
                    "compression": None,
                },
            )

    async def send_audio(self, pcm16_16k: bytes) -> None:
        if not self.connected or not self._ws:
            return
        try:
            await self._ws.send(pcm16_16k)
            # TEMP DIAGNOSTIC: confirm audio actually reaches the Fennec socket.
            self._audio_chunks_sent += 1
            self._audio_bytes_sent += len(pcm16_16k)
            if self._audio_chunks_sent == 1:
                await self._dbg_force("fennec.audio.sent_first", {"bytes": len(pcm16_16k)})
            elif self._audio_chunks_sent % 100 == 0:
                await self._dbg_force("fennec.audio.sent_every_100_chunks", {
                    "chunks": self._audio_chunks_sent,
                    "bytes": self._audio_bytes_sent,
                })
            await self._check_no_transcript_timeout()
        except Exception as exc:  # noqa: BLE001
            await self._on_error("fennec.audio.send_failed", str(exc))

    async def _check_no_transcript_timeout(self) -> None:
        # Fire once if ~8s of caller PCM reached Fennec with no VAD/transcript back.
        if self._no_transcript_logged or self._vad_received or self._transcript_received:
            return
        threshold = 8 * self._sample_rate * 2  # 8s of 16-bit mono PCM
        if self._audio_bytes_sent >= threshold:
            self._no_transcript_logged = True
            await self._dbg_force("fennec.no_transcript_timeout", {
                "audio_chunks_sent": self._audio_chunks_sent,
                "audio_bytes_sent": self._audio_bytes_sent,
                "seconds": round(self._audio_bytes_sent / (self._sample_rate * 2), 1),
                "fennec_msgs_total": self._raw_seen,
            })

    async def _send_json(self, payload: dict) -> None:
        if not self._ws:
            return
        await self._ws.send(json.dumps(payload))

    async def _recv_loop(self) -> None:
        assert self._ws is not None
        # TEMP DIAGNOSTIC: prove the recv loop actually started, and why it ends.
        await self._dbg_force("fennec.debug.recv_started", {"build": FENNEC_CLIENT_BUILD})
        exit_reason = "loop_end"
        try:
            # Use recv() only — do not mix a prior handshake recv() with async-for.
            while not self._closed:
                raw = await self._ws.recv()
                self._raw_seen += 1
                if isinstance(raw, (bytes, bytearray)):
                    self._raw_binary += 1
                    await self._dbg("fennec.debug.raw", {
                        "n": self._raw_seen, "kind": "binary", "bytes": len(raw),
                    })
                    continue
                self._raw_text += 1
                await self._dbg("fennec.debug.raw", {
                    "n": self._raw_seen, "kind": "text", "raw": str(raw)[:400],
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
                await self._on_error("fennec.recv_failed", str(exc))
        finally:
            await self._dbg_force("fennec.debug.recv_ended", {
                "reason": exit_reason,
                "msgs_total": self._raw_seen,
                "closed": self._closed,
                "build": FENNEC_CLIENT_BUILD,
            })

    async def _dbg(self, event: str, data: Dict[str, Any]) -> None:
        # TEMP DIAGNOSTIC: only emit while under the per-session cap to bound DB writes.
        if self._on_debug is None or self._raw_seen > _RAW_DEBUG_LIMIT:
            return
        await self._dbg_force(event, data)

    async def _dbg_force(self, event: str, data: Dict[str, Any]) -> None:
        # TEMP DIAGNOSTIC: emit regardless of the per-session cap (lifecycle events).
        if self._on_debug is None:
            return
        try:
            await self._on_debug(event, data)
        except Exception:  # noqa: BLE001
            pass

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
            if not self._handshake_done:
                self._handshake_done = True
                if self._handshake_event:
                    self._handshake_event.set()
            return

        text = _extract_text(msg)
        is_partial = (
            mtype in ("partial", "interim")
            or bool(msg.get("partial"))
            or bool(msg.get("is_partial"))
            or msg.get("is_final") is False
        )
        is_final_type = mtype in ("complete_thought", "corrected_transcript", "final_transcript")

        # VAD / utterance events: type vad|utterance, state==speech, or phase==begin.
        if _is_vad_event(mtype, msg) and not (text and is_final_type):
            self._vad_received = True
            await self._dbg_force("fennec.vad.received", {
                "type": mtype,
                "state": msg.get("state"),
                "phase": msg.get("phase"),
            })
            # Speech beginning → barge-in. A VAD frame that also carries finalized
            # text falls through below to the transcript path.
            if not text:
                await self._on_speech_start()
                return

        if not text:
            if mtype and mtype != "ready":
                await self._dbg("fennec.debug.no_text", {"type": mtype, "keys": list(msg.keys())[:12]})
            return

        # Partial/interim transcript → barge-in only, do not run the LLM turn.
        if is_partial and not is_final_type:
            await self._dbg_force("fennec.partial.received", {"chars": len(text)})
            await self._on_speech_start()
            return

        # Finalized utterance (explicit final type or a plain {"text": "..."}).
        self._transcript_received = True
        await self._dbg_force("fennec.final.received", {"type": mtype or "text", "chars": len(text)})
        await self._on_final_transcript(text)

    async def close(self) -> None:
        self._handshake_done = False
        if self._ws:
            try:
                await self._ws.send(json.dumps({"type": "eos"}))
            except Exception:  # noqa: BLE001
                pass
            # Let Fennec return finals after eos before we tear down the recv loop.
            await asyncio.sleep(0.75)
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


def _extract_text(msg: dict) -> str:
    # Support every Fennec final-text shape we have seen / the source repo emits.
    for key in ("text", "transcript", "corrected_transcript", "final_transcript"):
        val = msg.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    alts = msg.get("alternatives")
    if isinstance(alts, list) and alts and isinstance(alts[0], dict):
        first = alts[0]
        for key in ("text", "transcript"):
            if isinstance(first.get(key), str) and first[key].strip():
                return first[key].strip()
    channel = msg.get("channel")
    if isinstance(channel, dict):
        c_alts = channel.get("alternatives")
        if isinstance(c_alts, list) and c_alts and isinstance(c_alts[0], dict):
            first = c_alts[0]
            for key in ("transcript", "text"):
                if isinstance(first.get(key), str) and first[key].strip():
                    return first[key].strip()
    return ""


def _is_vad_event(mtype: str, msg: dict) -> bool:
    if mtype in ("vad", "utterance"):
        return True
    if str(msg.get("state") or "") == "speech":
        return True
    if str(msg.get("phase") or "") == "begin":
        return True
    return False
