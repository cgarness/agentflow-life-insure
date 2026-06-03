"""Twilio <-> Pipeline (Deepgram Flux ASR -> OpenRouter LLM -> Inworld TTS) bridge."""

from __future__ import annotations

import asyncio
import base64
import json
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional

from fastapi import WebSocket
from starlette.websockets import WebSocketState

from . import audio
from .config import Config
from .deepgram_flux import DeepgramFluxClient
from .inworld import InworldClient, InworldUsage
from .openrouter import OpenRouterClient, OpenRouterUsage
from .prompt import FIXED_GREETING
from .session import SessionStore, session_agent_instructions

STACK = "pipeline_voice_agent"
_SENTENCE_ENDERS = ".!?\n"
# Deepgram Flux recommends ~80 ms audio chunks.
_FLUX_CHUNK_SEC = 0.08


class PipelineBridge:
    def __init__(
        self,
        ws: WebSocket,
        config: Config,
        store: SessionStore,
        query_session_id: str,
    ) -> None:
        self.ws = ws
        self.config = config
        self.store = store

        self.session_id: str = query_session_id
        self.session: Optional[Dict[str, Any]] = None
        self.stream_sid: str = ""

        self.flux: Optional[DeepgramFluxClient] = None
        self.llm: Optional[OpenRouterClient] = None
        self.tts: Optional[InworldClient] = None

        self.messages: List[Dict[str, str]] = []
        self._turn_task: Optional[asyncio.Task] = None
        self._send_lock = asyncio.Lock()
        self._flux_buf = bytearray()
        self._flux_input_rate = config.deepgram_flux_sample_rate
        self._flux_chunk_bytes = int(self._flux_input_rate * _FLUX_CHUNK_SEC) * audio.PCM16_WIDTH
        self._flux_chunk_sec = _FLUX_CHUNK_SEC
        self._resampler = audio.Resampler(audio.TWILIO_RATE, self._flux_input_rate)
        self._pending_pcm16k: Deque[bytes] = deque(maxlen=800)

        self._started = False
        self._setup_task: Optional[asyncio.Task] = None
        self._logged_media_track = False
        self._closed = False
        self._connected_logged = False
        self._failed = False

        self._t0 = time.monotonic()
        self._media_in = 0
        self._media_out = 0
        self._amp_peak = 0
        self._amp_rms_sum = 0.0
        self._amp_frames = 0
        self._or_usage = OpenRouterUsage()
        self._tts_usage = InworldUsage()
        self._tts_started_logged = False

    async def run(self) -> None:
        try:
            while True:
                raw = await self.ws.receive_text()
                try:
                    msg = json.loads(raw)
                except (TypeError, ValueError):
                    continue
                await self._handle_twilio_event(msg)
        except Exception:  # noqa: BLE001
            pass
        finally:
            await self._shutdown(reason="receive_loop_end")

    async def _handle_twilio_event(self, msg: Dict[str, Any]) -> None:
        event = str(msg.get("event") or "")

        if event == "connected":
            if self.session_id and not self._connected_logged:
                self._connected_logged = True
                await self._log("info", "twilio.stream.connected", {})
            return

        if event == "start":
            await self._on_start(msg)
            return

        if event == "media":
            await self._on_media(msg)
            return

        if event == "stop":
            await self._log("info", "twilio.stream.stop", {
                "media_in_count": self._media_in,
                "media_out_count": self._media_out,
                "deepgram": self.flux.debug_stats if self.flux else None,
                "audio_chunks_sent": (
                    self.flux.debug_stats.get("audio_chunks_sent") if self.flux else 0
                ),
                "amp": self._amplitude_stats(),
            })
            await self._shutdown(reason="twilio_stop")
            return

    async def _on_start(self, msg: Dict[str, Any]) -> None:
        if self._started:
            return
        start = msg.get("start") or {}
        params = start.get("customParameters") or {}
        self.session_id = str(params.get("sessionId") or self.session_id or "").strip()
        token = str(params.get("bridgeToken") or "").strip()
        self.stream_sid = str(start.get("streamSid") or msg.get("streamSid") or "")

        if not self.session_id:
            await self._reject("start rejected: missing sessionId")
            return

        if not self._connected_logged:
            self._connected_logged = True
            await self._log("info", "twilio.stream.connected", {})

        if not await self.store.bridge_token_valid(self.session_id, token):
            await self._reject("start rejected: invalid bridge token")
            return

        session = await self.store.load_session(self.session_id)
        if not session or session.get("stack") != STACK:
            await self._log("error", "twilio.stream.session_invalid", {
                "found": bool(session),
                "stack": session.get("stack") if session else None,
            })
            await self._reject("invalid session")
            return

        self.session = session
        self._started = True
        await self.store.update_session(self.session_id, {"status": "in-progress"})

        if self._setup_task and not self._setup_task.done():
            return
        self._setup_task = asyncio.create_task(self._run_bridge_setup())

    async def _run_bridge_setup(self) -> None:
        try:
            await self._start_providers()
            await self._send_greeting()
        except Exception as exc:  # noqa: BLE001
            await self._log("error", "pipeline.bridge_setup_failed", {"message": str(exc)})
            await self._finish("failed", str(exc))
            await self._reject("bridge setup failed")

    async def _start_providers(self) -> None:
        assert self.session is not None
        tunables = self.session.get("tunables") or {}
        temperature = _as_float(self.session.get("temperature"), 0.7)
        max_tokens = _as_int(tunables.get("max_response_tokens"), 256)
        interruption = str(self.session.get("interruption_sensitivity") or "medium")
        model = (self.session.get("model_id") or "").strip() or self.config.openrouter_model
        voice = (self.session.get("voice_id") or "").strip() or self.config.inworld_voice_id

        self.messages = [{"role": "system", "content": session_agent_instructions(self.session)}]

        self.llm = OpenRouterClient(
            api_key=self.config.openrouter_api_key,
            base_url=self.config.openrouter_base_url,
            model=model,
            site_url=self.config.openrouter_site_url,
            app_name=self.config.openrouter_app_name,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        self.tts = InworldClient(
            api_key=self.config.inworld_api_key,
            base_url=self.config.inworld_base_url,
            model_id=self.config.inworld_model_id,
            voice_id=voice,
            sample_rate=self.config.inworld_sample_rate,
            auth_scheme=self.config.inworld_auth_scheme,
        )

        await self._log("info", "deepgram.flux.connecting", {
            "sample_rate": self.config.deepgram_flux_sample_rate,
            "model": self.config.deepgram_flux_model,
        })
        self.flux = DeepgramFluxClient(
            api_key=self.config.deepgram_api_key,
            model=self.config.deepgram_flux_model,
            sample_rate=self.config.deepgram_flux_sample_rate,
            interruption_sensitivity=interruption,
            on_speech_start=self._on_speech_start,
            on_final_transcript=self._on_final_transcript,
            on_ready=self._on_flux_ready,
            on_error=lambda stage, message: self._log("error", stage, {"message": message}),
            on_debug=lambda event, data: self._log("info", event, data),
        )
        await self.flux.connect()
        await self._log("info", "deepgram.flux.handshake_ready", {})
        await self._flush_pending_to_flux(paced=True)

    async def _send_greeting(self) -> None:
        await self._speak(FIXED_GREETING)
        self.messages.append({"role": "assistant", "content": FIXED_GREETING})
        await self.store.append_transcript(self.session_id, "assistant", FIXED_GREETING)
        await self._log("info", "pipeline.greeting_sent", {"greeting_length": len(FIXED_GREETING)})

    async def _on_media(self, msg: Dict[str, Any]) -> None:
        media = msg.get("media") or {}
        track = str(media.get("track") or "inbound")
        if not self._logged_media_track:
            self._logged_media_track = True
            await self._log("info", "twilio.media.track", {"track": track})
        if not _is_caller_media_track(track):
            return
        payload = media.get("payload")
        if not payload:
            return
        try:
            mulaw = base64.b64decode(payload)
            pcm8k = audio.mulaw_to_pcm16(mulaw)
            pcm16k = self._resampler.process(pcm8k)
            self._track_amplitude(pcm16k)
            self._media_in += 1
            if not self.flux or not self.flux.connected:
                self._pending_pcm16k.append(pcm16k)
                return
            if self._pending_pcm16k:
                await self._flush_pending_to_flux(paced=True)
            await self._send_pcm16k_to_flux(pcm16k, realtime=True)
        except Exception as exc:  # noqa: BLE001
            await self._log("error", "pipeline.media_forward_failed", {"message": str(exc)})

    async def _send_pcm16k_to_flux(self, pcm16k: bytes, *, realtime: bool) -> None:
        if not self.flux or not self.flux.connected:
            return
        self._flux_buf.extend(pcm16k)
        while len(self._flux_buf) >= self._flux_chunk_bytes:
            chunk = bytes(self._flux_buf[: self._flux_chunk_bytes])
            del self._flux_buf[: self._flux_chunk_bytes]
            await self.flux.send_audio(chunk)
            if not realtime:
                await asyncio.sleep(self._flux_chunk_sec)

    async def _flush_pending_to_flux(self, *, paced: bool) -> None:
        if not self._pending_pcm16k or not self.flux or not self.flux.connected:
            return
        pending_count = len(self._pending_pcm16k)
        while self._pending_pcm16k:
            pcm16k = self._pending_pcm16k.popleft()
            await self._send_pcm16k_to_flux(pcm16k, realtime=not paced)
        await self._log("info", "pipeline.pending_audio_flushed", {
            "frames": pending_count,
            "paced": paced,
        })

    def _track_amplitude(self, pcm16: bytes) -> None:
        if not pcm16:
            return
        try:
            import audioop
            self._amp_peak = max(self._amp_peak, audioop.max(pcm16, 2))
            self._amp_rms_sum += audioop.rms(pcm16, 2)
            self._amp_frames += 1
        except Exception:  # noqa: BLE001
            pass

    def _amplitude_stats(self) -> Dict[str, Any]:
        avg_rms = round(self._amp_rms_sum / self._amp_frames, 1) if self._amp_frames else 0
        return {"peak": self._amp_peak, "avg_rms": avg_rms, "frames": self._amp_frames}

    async def _on_flux_ready(self) -> None:
        await self._log("info", "deepgram.flux.ready", {})

    async def _on_speech_start(self) -> None:
        if self._turn_task and not self._turn_task.done():
            self._turn_task.cancel()
            await self._twilio_clear()
            await self._log("info", "pipeline.barge_in", {})

    async def _on_final_transcript(self, text: str) -> None:
        clean = text.strip()
        if not clean:
            return
        if self._turn_task and not self._turn_task.done():
            self._turn_task.cancel()
        self.messages.append({"role": "user", "content": clean})
        await self.store.append_transcript(self.session_id, "user", clean)
        await self._log("info", "user.transcript", {"text": clean[:500]})
        self._turn_task = asyncio.create_task(self._run_turn())

    async def _run_turn(self) -> None:
        assert self.llm is not None
        reply_parts: List[str] = []
        segment = ""
        self._tts_started_logged = False
        try:
            await self._log("info", "openrouter.reply.started", {"model": self.llm.model})
            async for delta in self.llm.stream_reply(self.messages, self._or_usage):
                reply_parts.append(delta)
                segment += delta
                while True:
                    idx = _first_boundary(segment)
                    if idx == -1:
                        break
                    chunk, segment = segment[: idx + 1], segment[idx + 1 :]
                    if chunk.strip():
                        await self._speak(chunk.strip())
            await self._log("info", "openrouter.reply.completed", {
                "prompt_tokens": self._or_usage.prompt_tokens,
                "completion_tokens": self._or_usage.completion_tokens,
                "usage_from_api": self._or_usage.from_api,
            })
            if segment.strip():
                await self._speak(segment.strip())
            if self._tts_started_logged:
                await self._log("info", "inworld.tts.completed", {"chars": self._tts_usage.chars})
            full = "".join(reply_parts).strip()
            if full:
                self.messages.append({"role": "assistant", "content": full})
                await self.store.append_transcript(self.session_id, "assistant", full)
                await self._log("info", "assistant.transcript", {"text": full[:500]})
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            await self._log("error", "openrouter.reply.failed", {"message": str(exc)})

    async def _speak(self, text: str) -> None:
        if not self.tts or not text:
            return
        if not self._tts_started_logged:
            self._tts_started_logged = True
            voice = (self.session.get("voice_id") if self.session else None) or self.config.inworld_voice_id
            await self._log("info", "inworld.tts.started", {"voice": voice})
        try:
            pcm = await self.tts.synthesize(text, usage=self._tts_usage)
        except Exception as exc:  # noqa: BLE001
            await self._log("error", "inworld.tts.failed", {"message": str(exc)})
            return
        if not pcm:
            return
        mulaw = audio.pcm16_any_to_twilio_mulaw(pcm, self.tts.sample_rate)
        await self._send_twilio_audio(mulaw)

    async def _send_twilio_audio(self, mulaw: bytes) -> None:
        if not self.stream_sid:
            return
        async with self._send_lock:
            for frame in audio.chunk_mulaw_frames(mulaw):
                if self._closed or self.ws.client_state != WebSocketState.CONNECTED:
                    return
                await self.ws.send_text(
                    json.dumps({
                        "event": "media",
                        "streamSid": self.stream_sid,
                        "media": {"payload": base64.b64encode(frame).decode("ascii")},
                    })
                )
                self._media_out += 1

    async def _twilio_clear(self) -> None:
        if not self.stream_sid or self._closed:
            return
        async with self._send_lock:
            if self.ws.client_state == WebSocketState.CONNECTED:
                await self.ws.send_text(json.dumps({"event": "clear", "streamSid": self.stream_sid}))

    async def _shutdown(self, reason: str) -> None:
        if self._closed:
            return
        self._closed = True

        if self._setup_task and not self._setup_task.done():
            self._setup_task.cancel()
        if self._turn_task and not self._turn_task.done():
            self._turn_task.cancel()

        await self._log("info", "twilio.stream.closed", {
            "reason": reason,
            "media_in_count": self._media_in,
            "media_out_count": self._media_out,
        })

        if self.flux:
            if self._flux_buf:
                await self.flux.send_audio(bytes(self._flux_buf))
                self._flux_buf.clear()
            await self.flux.close()
        if self.tts:
            await self.tts.aclose()
        if self.llm:
            await self.llm.aclose()

        await self._persist_usage()
        await self._log("info", "pipeline.closed", {})
        if not self._failed:
            await self._finish("completed")

        try:
            if self.ws.client_state == WebSocketState.CONNECTED:
                await self.ws.close()
        except Exception:  # noqa: BLE001
            pass

    async def _persist_usage(self) -> None:
        if not self.session_id:
            return
        session_sec = round(time.monotonic() - self._t0, 3)
        inbound_sec = round(self._media_in * audio.TWILIO_FRAME_BYTES / audio.TWILIO_RATE, 3)
        outbound_sec = round(self._media_out * audio.TWILIO_FRAME_BYTES / audio.TWILIO_RATE, 3)
        inworld_audio_sec = (
            round(self._tts_usage.audio_samples / self.tts.sample_rate, 3)
            if self.tts and self.tts.sample_rate
            else 0.0
        )
        patch = {
            "twilio": {
                "media_in_count": self._media_in,
                "media_out_count": self._media_out,
                "inbound_audio_sec": inbound_sec,
                "outbound_audio_sec": outbound_sec,
                "media_stream_sec": session_sec,
            },
            "pipeline": {
                "bridge_session_sec": session_sec,
                "deepgram_flux_asr_sec": inbound_sec,
                "inworld_chars": self._tts_usage.chars,
                "inworld_audio_sec": inworld_audio_sec,
                "openrouter_prompt_tokens": self._or_usage.prompt_tokens,
                "openrouter_completion_tokens": self._or_usage.completion_tokens,
                "openrouter_model": self.llm.model if self.llm else self.config.openrouter_model,
                "usage_from_api": self._or_usage.from_api,
            },
        }
        await self.store.merge_usage_metrics(self.session_id, patch)

    async def _finish(self, status: str, error_message: Optional[str] = None) -> None:
        if not self.session_id:
            return
        if status == "failed":
            self._failed = True
        patch: Dict[str, Any] = {"status": status}
        if error_message:
            patch["error_message"] = error_message
        await self.store.update_session(self.session_id, patch)
        if status == "completed":
            await self._log("info", "call.completed", {})

    async def _log(self, level: str, event: str, data: Dict[str, Any]) -> None:
        await self.store.append_debug_log(self.session_id, level, event, data)

    async def _reject(self, reason: str) -> None:
        await self._shutdown(reason=reason)


def _first_boundary(text: str) -> int:
    for i, ch in enumerate(text):
        if ch in _SENTENCE_ENDERS:
            return i
    return -1


def _as_float(value: Any, default: float) -> float:
    try:
        out = float(value)
        return out if out == out else default
    except (TypeError, ValueError):
        return default


def _as_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _is_caller_media_track(track: str) -> bool:
    t = track.strip().lower()
    if not t or t in ("inbound", "inbound_track"):
        return True
    return t not in ("outbound", "outbound_track")
