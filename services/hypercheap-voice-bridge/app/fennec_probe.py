"""One-shot Fennec streaming probe for /fennec-probe (ops diagnostics)."""

from __future__ import annotations

import asyncio
import json
import math
import struct
from typing import Any, Dict, List

import httpx
import websockets

from .fennec import DEFAULT_TOKEN_URL, DEFAULT_WS_BASE, _VAD_PRESETS


def _tone_pcm16(sample_rate: int, seconds: float, hz: float = 440.0) -> bytes:
    """Generate mono PCM16 LE sine (audible test pattern for ASR)."""
    n = int(sample_rate * seconds)
    out = bytearray()
    for i in range(n):
        sample = int(12000 * math.sin(2 * math.pi * hz * i / sample_rate))
        out.extend(struct.pack("<h", sample))
    return bytes(out)


async def run_fennec_probe(
    *,
    api_key: str,
    token_url: str,
    ws_base: str,
    sample_rate: int = 16000,
) -> Dict[str, Any]:
    """Connect, send tone + silence, return every JSON message from Fennec."""
    messages: List[Dict[str, Any]] = []
    result: Dict[str, Any] = {
        "ok": False,
        "sample_rate": sample_rate,
        "messages": messages,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            token_url,
            headers={"X-API-Key": api_key, "content-type": "application/json"},
            json={},
        )
        resp.raise_for_status()
        token = (resp.json().get("token") or "").strip()
        if not token:
            result["error"] = "token endpoint returned no token"
            return result

    sep = "&" if "?" in ws_base else "?"
    url = f"{ws_base.rstrip('/')}{sep}streaming_token={token}"

    vad = dict(_VAD_PRESETS["low"])
    start_msg = {
        "type": "start",
        "sample_rate": sample_rate,
        "channels": 1,
        "single_utterance": False,
        "vad": vad,
    }

    chunk_samples = int(sample_rate * 0.032)
    chunk_bytes = chunk_samples * 2
    tone = _tone_pcm16(sample_rate, 1.5)
    silence = bytes(chunk_bytes)

    try:
        async with websockets.connect(url, max_size=None, compression=None, ping_interval=5) as ws:
            await ws.send(json.dumps(start_msg))
            ready_raw = await asyncio.wait_for(ws.recv(), timeout=10.0)
            messages.append(json.loads(ready_raw))

            for i in range(0, len(tone), chunk_bytes):
                await ws.send(tone[i : i + chunk_bytes])
                await asyncio.sleep(0.032)
            for _ in range(30):
                await ws.send(silence)
                await asyncio.sleep(0.032)

            await ws.send(json.dumps({"type": "eos"}))

            end = asyncio.get_running_loop().time() + 4.0
            while asyncio.get_running_loop().time() < end:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                if isinstance(raw, (bytes, bytearray)):
                    messages.append({"_binary_len": len(raw)})
                else:
                    messages.append(json.loads(raw))

        texts = [
            m.get("text") or m.get("transcript")
            for m in messages
            if isinstance(m, dict) and (m.get("text") or m.get("transcript"))
        ]
        result["ok"] = len(texts) > 0
        result["texts"] = texts
        result["message_count"] = len(messages)
    except Exception as exc:  # noqa: BLE001
        result["error"] = str(exc)

    return result
