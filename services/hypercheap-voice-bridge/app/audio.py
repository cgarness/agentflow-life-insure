"""Audio conversion helpers.

Twilio Media Streams use 8 kHz µ-law (PCMU). Fennec expects 16 kHz PCM16. Inworld
returns PCM16 (LINEAR16) at a configurable sample rate. All resampling uses the
stdlib ``audioop`` module (restored on 3.13 via ``audioop-lts``).
"""

from __future__ import annotations

import audioop
from typing import Optional

PCM16_WIDTH = 2  # bytes per sample
TWILIO_RATE = 8000
TWILIO_FRAME_BYTES = 160  # 20 ms of 8 kHz µ-law


def mulaw_to_pcm16(mulaw: bytes) -> bytes:
    """Twilio µ-law 8k -> linear PCM16 8k."""
    return audioop.ulaw2lin(mulaw, PCM16_WIDTH)


def pcm16_to_mulaw(pcm16: bytes) -> bytes:
    """Linear PCM16 8k -> Twilio µ-law 8k."""
    return audioop.lin2ulaw(pcm16, PCM16_WIDTH)


class Resampler:
    """Stateful PCM16 mono resampler (keeps ratecv filter state across chunks)."""

    def __init__(self, from_rate: int, to_rate: int) -> None:
        self.from_rate = from_rate
        self.to_rate = to_rate
        self._state: Optional[object] = None

    def process(self, pcm16: bytes) -> bytes:
        if self.from_rate == self.to_rate:
            return pcm16
        converted, self._state = audioop.ratecv(
            pcm16, PCM16_WIDTH, 1, self.from_rate, self.to_rate, self._state
        )
        return converted


def resample_pcm16(pcm16: bytes, from_rate: int, to_rate: int) -> bytes:
    """One-shot PCM16 mono resample (no retained state)."""
    if from_rate == to_rate:
        return pcm16
    converted, _ = audioop.ratecv(pcm16, PCM16_WIDTH, 1, from_rate, to_rate, None)
    return converted


def strip_wav_header(data: bytes) -> bytes:
    """Return raw PCM samples from a WAV container, or the input if it is raw PCM.

    Inworld may return LINEAR16 wrapped in a RIFF/WAVE container. Find the
    ``data`` sub-chunk and return its payload; otherwise assume raw PCM.
    """
    if len(data) < 12 or data[0:4] != b"RIFF" or data[8:12] != b"WAVE":
        return data
    pos = 12
    while pos + 8 <= len(data):
        chunk_id = data[pos : pos + 4]
        chunk_size = int.from_bytes(data[pos + 4 : pos + 8], "little")
        body = pos + 8
        if chunk_id == b"data":
            return data[body : body + chunk_size]
        pos = body + chunk_size + (chunk_size & 1)  # chunks are word-aligned
    return data


def pcm16_any_to_twilio_mulaw(pcm16: bytes, source_rate: int) -> bytes:
    """Resample arbitrary-rate PCM16 mono down to 8 kHz and µ-law encode for Twilio."""
    down = resample_pcm16(pcm16, source_rate, TWILIO_RATE)
    return pcm16_to_mulaw(down)


def chunk_mulaw_frames(mulaw: bytes, frame_bytes: int = TWILIO_FRAME_BYTES):
    """Yield fixed-size µ-law frames (last frame zero-padded to a full 20 ms)."""
    for i in range(0, len(mulaw), frame_bytes):
        frame = mulaw[i : i + frame_bytes]
        if len(frame) < frame_bytes:
            frame = frame + b"\xff" * (frame_bytes - len(frame))  # µ-law silence
        yield frame
