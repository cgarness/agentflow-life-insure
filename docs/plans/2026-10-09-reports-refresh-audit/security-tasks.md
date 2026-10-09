# Separate security tasks found during the Reports audit (not part of the Reports refresh)

**Status: documented only.** No RLS policy, grant, trigger, function, Edge Function or production row has been changed. Each item needs its own task, plan and approval. An RLS change also needs Chris's `#APPROVE_RLS_CHANGE` (AGENT_RULES §10). All evidence below is from read-only catalog reads and database-role simulations inside `begin read only … rollback` on production `jncvvsvckxhqgqvkppmj`, plus local synthetic reproduction. No write was attempted against production.

---

## S-1 — Team Leaders can change the agency reporting time zone (medium)

**What.** RLS policy `company_settings_team_leader_update` on `public.company_settings` is `FOR UPDATE TO authenticated`. Both its `USING` and its `WITH CHECK` are only:

```
organization_id = get_org_id() AND get_user_role() IN ('Team Leader','Team Lead')
```

It restricts rows, not columns. It was written for the TV banner text (`20260418160000`, carried into the baseline at line ~11903). `authenticated` holds table-wide `UPDATE`, so `has_column_privilege('authenticated','public.company_settings','timezone','UPDATE')` is `true`.

The only timezone guard is the trigger `trg_company_settings_validate_timezone` → `validate_iana_timezone()`. It skips `NULL` and accepts any `pg_timezone_names` entry, including `Factory` and every `posix/*` name.

**Why it matters.** `company_settings.timezone` is the sole authority for every agency Reports window, bucket and "today" (#38). Since #40 it also drives the Leaderboard and Dashboard agency bounds. A Team Leader could send `PATCH /rest/v1/company_settings?organization_id=eq.<org>` with `{"timezone":"Pacific/Kiritimati"}` and shift every agency report for every viewer. Sending `{"timezone":null}` or `"Factory"` would make every Reports RPC return SQLSTATE 55000, an org-wide "time zone not configured" outage. The UI restricts editing to Admins (`CompanyBranding.tsx:37`), but PostgREST does not.

**Evidence (read-only):**
- `pg_policies` definition as above; there are no restrictive policies on the table.
- Database-role simulation as the production Team Leader (`f809493e…`, JWT `app_metadata.role = 'Team Leader'`): the `USING` predicate matches the home-org row.
- `EXPLAIN` (not executed) of `UPDATE … SET timezone = 'Pacific/Kiritimati'` shows the planner admitting the row through the Team Leader branch.
- Two independent adversarial verifiers confirmed it.

**Proposed fix (to plan separately).** One guarded migration, which needs `#APPROVE_RLS_CHANGE` and exact approval to apply:
1. Limit Team Leader writes to the banner column. Either use column-level `UPDATE` grants, or add a `BEFORE UPDATE` guard trigger. The trigger would reject changes to any column other than `leaderboard_tv_banner_text` unless the actor's database profile is an Active Admin or Super Admin in that organization (never the JWT claim; cf. #20).
2. Harden `validate_iana_timezone()`: on update, reject `NULL`, blank, `Factory`, `localtime` and `posixrules`, matching `private.report_agency_time_zone`.
3. Native SQL tests: a Team Leader can still update the banner but cannot change the timezone; an Admin can; invalid zones are refused; the TV-mode banner write in `TVMode.tsx:231` keeps working.
4. A read-only preflight of the policy and trigger preimage, plus a documented rollback.

**AGENT_RULES proposal (after the fix ships):** "`company_settings.timezone` is Admin-only authority for agency reporting; banner-only Team Leader writes."

---

## S-3 — Agents can write their own Dialer session timestamps directly (medium)

**What.** `public.dialer_sessions` accepts direct `INSERT` and `UPDATE` from `authenticated`:
- `authenticated` holds table privileges, including column `UPDATE` on `started_at`, `ended_at`, `last_heartbeat_at`, `status`, `agent_id` and `organization_id`.
- RLS policies `dialer_sessions_agent_insert` and `dialer_sessions_agent_update` check only `organization_id = get_org_id() AND agent_id = auth.uid()`.
- The only trigger, `dialer_sessions_updated_at`, sets `updated_at`. Nothing guards the timestamps, and the only CHECK constraints are on `mode` and `status`.

The application writes sessions only through `start_dialer_session` / `heartbeat_dialer_session` / `end_dialer_session` (`src/lib/supabase-dialer-sessions.ts:34,47,60`); nothing in `src` writes the table directly.

**Why it matters.** AGENT_RULES #12 and #38 describe session time as "server-timestamped". The database doesn't enforce that. An agent could use PostgREST to write any start, end or heartbeat time for their own sessions, which would change their:
- Reports "Dialer session time", "Calls per session hour", "Talk time share of session" and Agent efficiency
- which of their calls count as session-matched
- trusted Dialer session stats

The Reports aggregation itself is correct for the rows it reads.

**Evidence (read-only):**
- Catalog reads of grants, policies, triggers and constraints (repo baseline `20260806000000…:12089, 12097, 14999`; no later migration changes them).
- A local synthetic reproduction with the exact production policies, grants and trigger: a direct authenticated insert with forged timestamps succeeds.
- Two independent adversarial verifiers confirmed it. No production write was attempted.

**Proposed fix (to plan separately).** Revoke direct `INSERT`/`UPDATE` on `public.dialer_sessions` from `authenticated`, because the RPCs (SECURITY DEFINER) are the intended writers. Alternatively, add a guard trigger that rejects client changes to the timestamp and status columns. Then:
- Check every writer first: `useDialerSession`, `useDialerSession.ts` unmount paths, and the stale-close helper.
- Add native SQL tests.
- If the fix ships, update #12 and #38 wording.

Historical rows would not be rewritten.

---

## Recorded, no action proposed now

- **S-2 (low, disputed).** Org-default `report_layouts` rows (`user_id IS NULL`) are writable by Team Leaders as well as Admins under policy "Admins can manage org default layouts". That was the original 2026-05-13 design. There is no profile-status check and no size CHECK on `layout`. The Reports UI never writes these rows, and the normalizer sanitizes any layout, so numbers are unaffected. Reconsider when an admin-only default editor is built.
- **X-1 (low, Dialer only).** The Dialer header's live Session Duration ticker adds the elapsed time of a session that started before the agent's local midnight, then drops it when the session ends. The header RPC counts sessions by `started_at >= local midnight`. Live instance: Alexa, session `8b1e6b54`, 2026-09-15 → 09-16. 4 of 526 sessions have crossed a local midnight with heartbeats. Reports is unaffected (it clips to the agency day). Fixing it is a Dialer change and is not in Reports scope.
