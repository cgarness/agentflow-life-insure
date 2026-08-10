# Archived pre-baseline migrations (immutable historical evidence)

**Archived 2026-08-09** on branch `repair/migration-baseline`. These 265 files are the repository's
migration history up to and including production version `20260805090000`, plus three
never-applied files. They are preserved verbatim (`git mv`, nothing deleted) and are **never
replayed**: the active history begins at
`supabase/migrations/20260806000000_baseline_production_schema.sql`, a production-derived snapshot.

## Why this history cannot replay (Phase 0 investigation, 2026-08-08 — evidence in WORK_LOG)

1. **Nine core tables were never created by any migration** (`campaign_leads`, `campaigns`, `leads`,
   `calls`, `dialer_sessions`, `organizations`, `import_history`, `wins`, `agent_scorecards`) —
   created via the dashboard before tracking began. First failure: `20260308221542` (`ALTER TABLE
   public.campaign_leads` → 42P01).
2. **Data-dependent statements**: the `20260309035008` demo seed references production `auth.users`
   rows and disposition UUIDs no migration creates; `appointments` FK violations are unavoidable on
   any fresh database.
3. **Dashboard drift beyond the nine tables**: `profiles.organization_id/is_super_admin/team_id`,
   `dispositions.organization_id`, `clients.organization_id` (early), and `get_user_org_id()` exist
   in production but in no migration — later migrations hard-fail without them.
4. **Duplicate version prefixes** `20260602120000` and `20260603120000` (two files each) —
   `schema_migrations.version` is the primary key.
5. **25 files differ from what production actually executed** (as-applied SQL exists only in
   production's `supabase_migrations.schema_migrations`; snapshots preserved in the Phase 0
   workspace and the reconciliation runbook). All 25 deltas were verified **cosmetic**
   (comments/whitespace) — but the practice is why the *"applied migrations are immutable"*
   invariant now exists in AGENT_RULES.

## The three never-applied files (dispositions ratified 2026-08-09)

| File | Disposition | Evidence |
|---|---|---|
| `20260527000000_phone_system_rls_harden.sql` | Archived — **production already equivalent** | all 7 intended policies live with identical expressions; `organization_id NOT NULL` on both tables; partial unique index present |
| `20260527133000_call_recordings_storage_update_policy.sql` | Archived — **secure part already live; the missing bucket-wide policy would weaken tenant isolation** | `call_recordings_update_own_org` live with org-scoped USING+CHECK (+ insert/select companions) |
| `20260614120000_leaderboard_rpc_tiebreak.sql` | Archived here; **re-author forward** as a separate reviewed migration after PR #352 | production `get_agency_group_leaderboard` still ends `ORDER BY policies_sold DESC, calls_made DESC;` — no stable tie-break |

## Rules

- **Never edit these files.** They are evidence, not code.
- **Never move a file back** into `supabase/migrations/` — every one either already ran on
  production under some version, is production-equivalent, or is superseded.
- Production's migration-history reconciliation for the baseline is metadata-only — see
  `supabase/rollback/20260806_baseline_history_reconciliation_runbook.md`.
