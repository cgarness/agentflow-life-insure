"""One-shot Deepgram Flux probe for /deepgram-flux-probe (ops diagnostics)."""

from __future__ import annotations

import asyncio
import json
import math
import struct
from typing import Any, Dict, List

import websockets

from .deepgram_flux import (
    DEEPGRAM_FLUX_CLIENT_BUILD,
    build_flux_listen_url,
    flux_turn_params_from_interruption,
)


def _tone_pcm16(sample_rate: int, seconds: float, hz: float = 440.0) -> bytes:
    n = int(sample_rate * seconds)
    out = bytearray()
    for i in range(n):
        sample = int(12000 * math.sin(2 * math.pi * hz * i / sample_rate))
        out.extend(struct.pack("<h", sample))
    return bytes(out)


async def run_deepgram_flux_probe(
    *,
    api_key: str,
    model: str = "flux-general-en",
    sample_rate: int = 16000,
) -> Dict[str, Any]:
    """Connect, send tone + silence, return transcripts from Flux EndOfTurn events."""
    messages: List[Dict[str, Any]] = []
    result: Dict[str, Any] = {
        "ok": False,
        "sample_rate": sample_rate,
        "model": model,
        "build": DEEPGRAM_FLUX_CLIENT_BUILD,
        "messages": messages,
    }

    eot_threshold, eot_timeout_ms = flux_turn_params_from_interruption("low")
    url = build_flux_listen_url(
        model=model,
        sample_rate=sample_rate,
        eot_threshold=eot_threshold,
        eot_timeout_ms=eot_timeout_ms,
    )
    headers = {"Authorization": f"Token {api_key}"}

    chunk_sec = 0.08
    chunk_samples = int(sample_rate * chunk_sec)
    chunk_bytes = chunk_samples * 2
    tone = _tone_pcm16(sample_rate, 2.0)
    silence = bytes(chunk_bytes)

    texts: List[str] = []

    try:
        async with websockets.connect(
            url,
            additional_headers=headers,
            max_size=None,
            compression=None,
            ping_interval=5,
        ) as ws:
            end = asyncio.get_running_loop().time() + 8.0

            async def drain() -> None:
                while asyncio.get_running_loop().time() < end:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                    except asyncio.TimeoutError:
                        continue
                    if isinstance(raw, (bytes, bytearray)):
                        messages.append({"_binary_len": len(raw)})
                        continue
                    try:
                        msg = json.loads(raw)
                    except (TypeError, ValueError):
                        continue
                    messages.append(msg)
                    if isinstance(msg, dict) and msg.get("type") == "TurnInfo":
                        event = str(msg.get("event") or "")
                        t = msg.get("transcript") or msg.get("text") or ""
                        if event == "EndOfTurn" and isinstance(t, str) and t.strip():
                            texts.append(t.strip())

            drain_task = asyncio.create_task(drain())

            for i in range(0, len(tone), chunk_bytes):
                await ws.send(tone[i : i + chunk_bytes])
                await asyncio.sleep(chunk_sec)
            for _ in range(40):
                await ws.send(silence)
                await asyncio.sleep(chunk_sec)

            await asyncio.sleep(2.0)
            drain_task.cancel()
            try:
                await drain_task
            except asyncio.CancelledError:
                pass

        result["ok"] = len(texts) > 0
        result["texts"] = texts
        result["message_count"] = len(messages)
    except Exception as exc:  # noqa: BLE001
        result["error"] = str(exc)

    return result
