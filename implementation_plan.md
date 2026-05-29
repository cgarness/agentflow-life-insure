# Implementation Plan | P1 Build 2 — Frontend Session Lifecycle

**Status:** Implementation complete — **NOT pushed/deployed** (awaiting Chris)  
**Prerequisite:** P1 Build 1 applied (`20260529003210`)

---

## Summary

| Item | Value |
|------|-------|
| Session start | Campaign **Start** button → `startServerSession`; fallback first outbound dial |
| Heartbeat | 45 seconds; `p_session_id` only |
| Display timer | From server `started_at`; no DB persistence |
| End session | Explicit `endServerSession` + beforeunload keepalive |
| Unmount | Clears intervals only — does not end server session |

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/supabase-dialer-sessions.ts` | **NEW** — RPC helpers |
| `src/hooks/useDialerSession.ts` | Session lifecycle + heartbeat + display tick |
| `src/pages/DialerPage.tsx` | Minimal wiring; removed duration DB flush |
| `src/lib/supabase-dialer-stats.ts` | Always pass `p_session_duration_seconds: 0` |
| `AGENT_RULES.md` | Build 2 frontend wired note |
| `WORK_LOG.md` | Entry appended |

**Not touched:** Twilio, migrations, dispositions, queue, `calls.duration`

---

## Verification (Complete)

- `npx tsc --noEmit` → PASS
- `npm test -- --run` → 85/85 PASS
- No browser `session_duration_seconds` writes in DialerPage
- Heartbeat does not send duration

---

## Next

**P1 Build 3** — trusted stat rewiring from `calls`, `wins`, and `dialer_sessions`
