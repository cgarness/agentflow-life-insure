"""FastAPI entrypoint for the Hypercheap voice bridge.

Endpoints:
  GET  /health             liveness
  GET  /healthz            liveness (Render healthCheckPath)
  GET  /ready              readiness — which providers are configured (no secrets)
  WS   /twilio/hypercheap  Twilio Media Stream bridge
"""

from __future__ import annotations

from fastapi import FastAPI, WebSocket
from fastapi.responses import JSONResponse

from .bridge import HypercheapBridge
from .config import load_config
from .session import SessionStore, create_supabase

config = load_config()
app = FastAPI(title="hypercheap-voice-bridge")

# The Supabase client is created lazily so the service can boot (and serve
# /health) even if SUPABASE_* is briefly missing during initial Render setup.
_store: SessionStore | None = None


def get_store() -> SessionStore | None:
    global _store
    if _store is None and config.supabase_ready:
        try:
            _store = SessionStore(
                create_supabase(config.supabase_url, config.supabase_service_role_key)
            )
        except Exception as exc:  # noqa: BLE001 — misconfigured key, etc.
            print(f"[hypercheap-voice-bridge] Supabase client init failed: {exc}")
            return None
    return _store


@app.get("/health")
@app.get("/healthz")
def health() -> JSONResponse:
    return JSONResponse({"ok": True, "service": "hypercheap-voice-bridge"})


@app.get("/ready")
def ready() -> JSONResponse:
    configured = {
        "fennec": config.fennec_ready,
        "openrouter": config.openrouter_ready,
        "inworld": config.inworld_ready,
        "supabase": config.supabase_ready,
    }
    ok = all(configured.values())
    return JSONResponse(
        status_code=200 if ok else 503,
        content={
            "ok": ok,
            "service": "hypercheap-voice-bridge",
            "paths": ["/twilio/hypercheap"],
            "configured": configured,
        },
    )


@app.websocket("/twilio/hypercheap")
async def twilio_hypercheap(ws: WebSocket) -> None:
    await ws.accept()
    query_session_id = (ws.query_params.get("sessionId") or "").strip()
    store = get_store()
    if store is None:
        print("[hypercheap-voice-bridge] Supabase not configured — closing stream")
        await ws.close(code=1011)
        return
    bridge = HypercheapBridge(ws, config, store, query_session_id)
    await bridge.run()


if __name__ == "__main__":  # pragma: no cover — Render uses the uvicorn start command
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=config.port)
