# Emergency leaderboard containment — September 23, 2026

## Authorization and scope
Chris reported that AgentFlow was slow or not loading for several agents and authorized starting the emergency leaderboard pause. Production project: jncvvsvckxhqgqvkppmj. The containment is already applied; this commit records it, not a request to reapply it.

Only public.get_org_leaderboard_stats(timestamptz,timestamptz) changed. A marked PT503 maintenance exception was inserted after its existing auth.uid null check, before any business-table lookup or aggregate. The original function body remains intact after that block. This protects old browser bundles as well as the Dashboard widget and organization Leaderboard, without reloading active call tabs.

No lead/customer records, calling/routing functions, RLS policies, grants, function signature, database instance size, frontend source, or Vercel deployment was changed. The agency-group leaderboard was not changed. No database restart, user session termination, test call, lead deletion, or paid upgrade was performed.

## Applied migration and verification
- Applied via Supabase apply_migration at 2026-09-23 22:42:54 UTC (15:42:54 America/Los_Angeles), recorded version 20260923224254 / emergency_pause_org_leaderboard_20260923.
- Before-definition MD5: d26a38b59de90db91ed777236ee4acc4.
- After-definition MD5: 1314cefc781ff326540b83f748d48046.
- Read-back at 22:43:08 UTC confirmed marker installed, owner postgres, ACL {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}, STABLE SECURITY DEFINER, search_path public, pg_temp, anonymous EXECUTE false, authenticated EXECUTE true.
- Removing the exact marked block restores original MD5 d26a38b59de90db91ed777236ee4acc4. The applied DO block also asserts unchanged owner/ACL/config/volatility/return type/argument types and aborts on unexpected drift.
- Transaction-local authenticated-role test using a synthetic UUID, without inserting any record: expected PT503/message received; 3.578 ms execution. All settings were transaction-local. No aggregate/business-table query executes on this maintenance path.
- pg_stat_activity snapshot at 22:43:47 UTC: 21 client connections; 0 active client queries excluding the diagnostic; 0 lock waiters; 0 running leaderboard requests older than 1 second. This is an instantaneous snapshot, not a CPU measurement.

## First post-change observed traffic (Supabase edge_logs)
Requested range: 22:38:00–22:43:47 UTC. Split at applied timestamp 22:42:54 UTC. Durations are response.origin_time in milliseconds, not browser page-load times.

| Window / category | Requests | HTTP 5xx | Expected PT503 | Mean ms | p95 ms | Maximum ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Before / non-leaderboard | 414 | 4 | 0 | 3160.4 | 17821.9 | 41366 |
| After / non-leaderboard | 200 | 0 | 0 | 126.6 | 389.2 | 773 |
| Before / leaderboard | 38 | 31 | 0 | 20081.4 | 36623.3 | 43938 |
| After / leaderboard | 4 | 4 | 4 | 1881.5 | 2278.2 | 2331 |

The first 53-second post-change sample shows substantial improvement, not proof of sustained recovery or an authenticated browser/call smoke test. Intended leaderboard maintenance responses must be excluded from unexpected-error counts. Logs provide evidence that removing leaderboard computation relieved pressure, but the initial triggering cause and CPU/memory/disk utilization remain unproved.

## Current user experience and remaining work
The organization leaderboard is intentionally unavailable and existing frontend code can show its existing error/retry state. Browser polling was NOT changed by this mitigation; it can still send cheap maintenance requests. Do not claim that the polished maintenance UI, single-flight request protection, backoff, caching, or query optimization has shipped.

Users should leave unused Dashboard/Leaderboard/TV tabs closed, keep active call tabs open, and validate Contacts, opening a lead, and the Dialer. Do not refresh during an active call. No authenticated end-to-end browser test or test call was performed here.

Follow-up: suppress requests and show a maintenance state in both affected frontend entry points; add single-flight/backoff before re-enabling; inspect the underlying query/indices and resource metrics. Test through normal CI/release gates. Do not resume aggregate work simply because core operations recovered.

## Rollback
The paired supabase/rollback SQL removes only the exact pause block and refuses to overwrite any later function change. Apply rollback only as a newly approved migration after the load-control fix is ready. Never edit or replay the already-applied containment migration.

## Repository note
The root WORK_LOG.md fetch returned an empty content payload despite a nonempty blob SHA on two attempts. It was deliberately left untouched to avoid erasing history; this incident note is the durable closeout pending a verified append to WORK_LOG.md. No frontend TypeScript changed and no local TypeScript/build test is claimed.
