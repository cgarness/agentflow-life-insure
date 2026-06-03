"""Supabase session + debug_log + usage_metrics helpers.

Mirrors supabase/functions/_shared/aiTestingSession.ts and the Node bridge
session.ts / usageMetrics.ts. The synchronous supabase-py client is wrapped with
asyncio.to_thread so the event loop is never blocked. All writes are best-effort:
a failed DB write must never crash an in-flight call.
"""

from __future__ import annotations

import asyncio
import hmac
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from supabase import Client, create_client

from .prompt import build_agent_prompt, normalize_lead_context

DEBUG_LOG_CAP = 500


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_supabase(url: str, service_role_key: str) -> Client:
    return create_client(url, service_role_key)


class SessionStore:
    def __init__(self, supabase: Client) -> None:
        self.supabase = supabase

    # ----- reads -----------------------------------------------------------
    async def load_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        def _run() -> Optional[Dict[str, Any]]:
            res = (
                self.supabase.table("ai_test_sessions")
                .select(
                    "id, organization_id, stack, prompt, lead_context, status, "
                    "transcript, voice_id, model_id, temperature, speaking_rate, "
                    "interruption_sensitivity, bridge_token, tunables"
                )
                .eq("id", session_id)
                .maybe_single()
                .execute()
            )
            return res.data if res and res.data else None

        try:
            data = await asyncio.to_thread(_run)
        except Exception:  # noqa: BLE001 — best effort
            return None
        if not data:
            return None
        data["lead_context"] = normalize_lead_context(data.get("lead_context"))
        if not isinstance(data.get("transcript"), list):
            data["transcript"] = []
        if not isinstance(data.get("tunables"), dict):
            data["tunables"] = {}
        return data

    async def bridge_token_valid(self, session_id: str, token: str) -> bool:
        if not session_id or not token:
            return False

        def _run() -> str:
            res = (
                self.supabase.table("ai_test_sessions")
                .select("bridge_token")
                .eq("id", session_id)
                .maybe_single()
                .execute()
            )
            return str((res.data or {}).get("bridge_token") or "").strip() if res else ""

        try:
            expected = await asyncio.to_thread(_run)
        except Exception:  # noqa: BLE001
            return False
        if not expected:
            return False
        return hmac.compare_digest(token, expected)

    # ----- writes ----------------------------------------------------------
    async def update_session(self, session_id: str, patch: Dict[str, Any]) -> None:
        def _run() -> None:
            self.supabase.table("ai_test_sessions").update(
                {**patch, "updated_at": _now_iso()}
            ).eq("id", session_id).execute()

        try:
            await asyncio.to_thread(_run)
        except Exception:  # noqa: BLE001
            pass

    async def append_transcript(self, session_id: str, role: str, text: str) -> None:
        if not session_id or not text:
            return

        def _run() -> None:
            res = (
                self.supabase.table("ai_test_sessions")
                .select("transcript")
                .eq("id", session_id)
                .maybe_single()
                .execute()
            )
            existing = (res.data or {}).get("transcript") if res else None
            transcript: List[Dict[str, Any]] = existing if isinstance(existing, list) else []
            transcript.append({"role": role, "text": text, "at": _now_iso()})
            self.supabase.table("ai_test_sessions").update(
                {"transcript": transcript, "updated_at": _now_iso()}
            ).eq("id", session_id).execute()

        try:
            await asyncio.to_thread(_run)
        except Exception:  # noqa: BLE001
            pass

    async def append_debug_log(
        self,
        session_id: str,
        level: str,
        event: str,
        data: Optional[Dict[str, Any]] = None,
    ) -> None:
        entry = {"at": _now_iso(), "level": level, "event": event, "data": _safe(data)}
        print(f"[HYPERCHEAP-WS] {event} session={session_id} {json.dumps(_safe(data))[:500]}")
        if not session_id:
            return

        def _run() -> None:
            res = (
                self.supabase.table("ai_test_sessions")
                .select("debug_log")
                .eq("id", session_id)
                .maybe_single()
                .execute()
            )
            existing = (res.data or {}).get("debug_log") if res else None
            log: List[Dict[str, Any]] = existing if isinstance(existing, list) else []
            log.append(entry)
            log = log[-DEBUG_LOG_CAP:]
            self.supabase.table("ai_test_sessions").update(
                {"debug_log": log, "updated_at": _now_iso()}
            ).eq("id", session_id).execute()

        try:
            await asyncio.to_thread(_run)
        except Exception:  # noqa: BLE001
            pass

    async def merge_usage_metrics(self, session_id: str, patch: Dict[str, Any]) -> None:
        if not session_id:
            return

        def _run() -> None:
            res = (
                self.supabase.table("ai_test_sessions")
                .select("usage_metrics")
                .eq("id", session_id)
                .maybe_single()
                .execute()
            )
            existing = (res.data or {}).get("usage_metrics") if res else None
            base: Dict[str, Any] = existing if isinstance(existing, dict) else {}
            merged = _deep_merge(base, patch)
            merged["measured_at"] = _now_iso()
            self.supabase.table("ai_test_sessions").update(
                {"usage_metrics": merged, "updated_at": _now_iso()}
            ).eq("id", session_id).execute()

        try:
            await asyncio.to_thread(_run)
        except Exception:  # noqa: BLE001
            pass


def session_agent_instructions(session: Dict[str, Any]) -> str:
    return build_agent_prompt(session.get("prompt", ""), session.get("lead_context", {}))


def _deep_merge(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = {**out[key], **value}
        else:
            out[key] = value
    return out


def _safe(data: Any) -> Any:
    if data is None:
        return None
    try:
        return json.loads(json.dumps(data, default=str))
    except (TypeError, ValueError):
        return str(data)
