# Google Sheets lead import V1 — implementation plan

## Approved migration re-stamp — 2026-10-22 06:25 UTC

Fresh read-only hosted SQL at `2026-10-22T06:25:20.775462Z` returned 342
migration-history rows, latest `20261021200000`, no Sheets history, relations,
database functions, cron jobs or Vault secret names, and permission-helper MD5
`a199d5ddfb9a56070aeb7706d3e9a4b8`. Supabase Deploy to production was observed
OFF after successful sign-in. All 10 GitHub Actions workflows passed on the
published reconciliation head `98074fb2e6b9053ad1bc88010c4f3c885d7d06c3`.

The approved next change is a release-version correction only:

1. Rename the unchanged foundation and paired rollback from `20261013120000`
   to `20261022062539`, chosen from the verified 06:25:39 UTC clock and later
   than the observed hosted head. Preserve SQL bytes and every Edge bundle.
2. Update the active paths in `.github/workflows/google-sheets.yml`,
   `scripts/run_google_sheets_tests.sh`, `scripts/run_google_sheets_cron_check.sh`,
   and `src/lib/google-sheets/__tests__/googleSheets.test.ts`. Update
   `scripts/google_sheets_regression_evidence.sh` to use the historical filename
   for its reviewed tree and the new filename for the current tree.
3. Update current release/verification references, this plan, the root plan and
   newest-first work log. Preserve historical evidence and the unchanged pending
   cron migration, which remains outside Phase B.
4. Verify the renamed SQL/rollback and Edge hashes, path resolution, shell syntax,
   and the path-dependent Sheets test. The feature behavior and earlier passing
   type/lint/build results are unchanged. Require new-head CI after publication.
5. After review and publication, re-pin PR #451 to that exact source with
   before/applied history `342 / 20261021200000` and recorded history
   `343 / 20261022062539`. Recheck hosted state immediately before its protected
   stages; stop on any drift rather than refreshing pins implicitly.

This checkpoint supersedes the earlier blocked-read status below. Subsequent
read-only dashboard checks found 77 deployed Edge functions and no Sheets
function, all six B1 secret names present, and `GOOGLE_SHEETS_ENABLED` absent.
Secret values were not read, changed or validated. Vercel project and shared
environment searches both confirmed `VITE_GOOGLE_SHEETS_ENABLED` absent. The
Ready/Production rollback candidate is `dpl_CnxbpTh4fae7Bi6RWvZvWsGBDxP3` at
main `1a7ea7a5`, current on `www.fflagent.com`; capture it again after the runner
merge before Phase C. GitHub credential readiness and the remaining release
gates are still outstanding. No production mutation, import or schedule is
authorized by this filename change, and none has been performed.

---

## Release continuation — 2026-10-22 UTC / October 21 PDT

Chris approved proceeding after the current status review. This authorizes the
release-branch reconciliation and preparation described below; the existing
separate production gates remain in force. Phase B's earlier approval is retained.

1. Merge current `main` `1a7ea7a5c1ee5d2b3cd1eece157900f77da24bf4` into the
   feature branch, preserving both histories without rebasing or force-pushing.
2. Resolve overlapping `AGENT_RULES.md`, `WORK_LOG.md`, `implementation_plan.md`
   and `supabase/config.toml` additively. Retain every existing function setting
   and the four Sheets function blocks. Preserve the reviewed Sheets SQL and
   Edge bundles byte-for-byte against the pinned release source.
3. Update this focused plan, `release-package.md`, `verification.md`, the root
   plan and the newest-first work log with the verified reconciliation and
   current access checkpoint. The separate runner PR #451 receives its own
   reconciliation and refreshed production-state pins only from live evidence.
4. Run the required TypeScript check, compare app diagnostics against current
   main, run focused Sheets tests/lint/build, and require the relevant exact-head
   CI checks before any release. Do not claim a real Google-account test from
   mocked or synthetic verification.
5. Verify the protected GitHub environment, deployment credentials, Supabase
   production auto-deploy setting and disabled frontend flag. Continue the
   documented Phase B stages only when their prerequisites and approvals hold.

Fresh browser check: `google-sheets-production` still requires `cgarness`, allows
only `main`, and disallows administrator bypass. It currently has no environment
secrets. Credential entry is therefore still required before the runner can
execute. No production command, migration, deployment, import or schedule has
been performed in this continuation.

**Release-order correction:** current `AGENT_RULES.md` requires every unapplied
migration to sort after the hosted head. This plan's §0.3 permits re-stamping.
After fresh hosted history is available, rename the unchanged foundation and
paired rollback, update active references, and re-pin the reviewed runner source.
The old October 17 count/latest and authored version must not be reused as
current release evidence. The runner must reject VERSION <= LATEST and expect
the new VERSION as the latest history entry after recording. Keep the approved
SQL and Edge digests unchanged. See the current checkpoint at the top of
`release-package.md`; it supersedes conflicting older operational instructions.

The connector has returned no fresh production result and the Supabase dashboard
requires sign-in. Hosted history, helper preimage, Sheets inventory, auto-deploy,
disabled flags and the current frontend rollback target remain unverified.
Branch reconciliation and local verification can finish while these live gates
remain blocked. The pending cron migration remains outside Phase B.

---

**Status (2026-10-13): APPROVED FOR IMPLEMENTATION, revised in §0.** Chris approved implementation with decisions D1–D11, the trigger/action model ("a new row in a connected tab → create a lead for the connected agent"), and new-rows-by-default activation.

§0 is authoritative: where it differs from §1–§14 (the original Phase 1 plan, kept below for history), §0 wins.

**Pre-release corrections (2026-10-13):** §0.9 was approved with amendments A–C. It is authoritative for the integrity corrections to PR #442.

**Reconciled with `main` `03ef0cb` (2026-10-15).** The branch was merged with current `main` (merge commit `94e9bc1`) before Phase B. The design, code, migration and Edge bundles are unchanged. Records: the root `implementation_plan.md` (2026-10-15 entry) and `verification.md` §13. Older statements below that `main` "is still `f91e4ba`" are dated history.

**Approved under this revision:**
- implementation;
- local verification;
- branch commits and pushes;
- a draft PR.

**Still gated** on review of the release package in `release-package.md`:
- production mutations;
- Google Cloud changes and secrets;
- migration apply and Edge deploy;
- live imports and cron activation;
- privacy publication;
- merge and release.

---

## 0. Approved revision (supersedes conflicting text below)

### 0.1 Resolved decisions

| # | Resolution |
|---|---|
| D1 | New capability `contacts.leads.import_google_sheets` defaults **ON for Agent and Team Leader**; Admin and Super Admin are always allowed. A stored explicit `false` wins. No other permission changes. Settings-section visibility (`role_permissions.s`) and import permission are separate controls: a user who can see the section but lacks the capability sees a one-line notice. |
| D2 | Dedicated "AgentFlow Sheets" OAuth client in project 87346168200. Sheets never calls `revoke`. |
| D3 | Refresh tokens are stored in Supabase Vault. |
| D4 | Per-sheet default Lead Source, initially "Google Sheets", used when no source column is mapped or the cell is blank. The dropdown offers the agency's existing lead sources plus "Google Sheets". Nothing is created in `lead_sources`. |
| D5 | Status is resolved on the server at insert time: the agency default lead stage, else the first by sort order, else `New`. This is the same rule as the CSV modal. |
| D6 | The existing `trg_workflow_lead_created` trigger fires once per inserted lead; the worker dispatches nothing itself. The "Also import existing rows" preview shows the concise existing-workflow warning when active Lead Created workflows exist. |
| D7 | Dedicated sync history (`google_sheets_sync_runs`). No Import History rows and no Undo. |
| D8 | Core contract only: first name, last name, phone. Full name is split with the CSV `splitFullName` rule, only when first and last are both unmapped or blank. A one-word Full name leaves last name blank, so the row is invalid; phone is always required. |
| D9 | 10,000 data rows per tab (exceeded → Needs review, never truncated); 500 new rows per source per run; 10 sources per worker tick. These are processing limits, not a cap on the number of sheets. |
| D10 | Prepared for a controlled pilot. Publishing status must be re-verified freshly in the release package; moving to In production is out of scope. |
| D11 | Sheets without a Source Lead ID are allowed, with full-prefix structural validation (§0.4). |

### 0.2 Activation: new rows by default

**Setup:** Connect → Add spreadsheet (Picker) → Tab → Map → Preview → **Enable**. The checkbox "Also import existing rows" is unchecked by default.
- Preview and draft save never create leads or start workflows. The preview is read-only; draft save writes only the source configuration.
- `activate` (server):
  1. performs one consistent server read of the tab (header plus all data rows, capped at 10,000 + 1 to detect overflow);
  2. validates the header and mapping;
  3. computes row identities and fingerprints;
  4. calls `google_sheets_activate`, which runs as **one transaction**.
- `google_sheets_activate` does all of the following:
  - locks the source row and requires `state='draft'` or a matching retry;
  - checks `expected_config_version`, owner eligibility, and connection status and `auth_generation`;
  - **unchecked:** writes a baseline record (kind `baseline`) for every data row of that read. **checked:** writes no baseline, and phase `initial` makes those rows candidates;
  - sets `state='enabled'`, `activated_at`, `baseline_row_count` and `next_sync_at=now()`.
- **Baseline records are distinct from receipts.** A baseline row was excluded on purpose, not imported. In no-ID mode a baselined row stays excluded even if edited. In ID mode an excluded ID stays excluded whatever its content.
- **Rows that arrive after the baseline read** have no record, so they are candidates.
- **Repeated or concurrent activation:** the second call sees `state<>'draft'` and returns the current state; it never takes a second baseline.
- **Failed activation** rolls back the transaction and leaves the same draft row (same id). A retry reuses it.
- **"Also import existing rows" with a re-added tab:** in ID mode, IDs with permanent receipts are skipped automatically. In no-ID mode, rows whose core fingerprint equals a permanent receipt of an earlier source for the same org, owner, spreadsheet and tab are baselined instead of imported. The preview shows this count ("N imported before"), so the exclusion is explicit and visible, not automatic classification of appended rows.

### 0.3 Data model

All new objects are in migration `supabase/migrations/20261022062539_google_sheets_import_foundation.sql`; the version is re-stamped on apply per invariant #35. The cron schedule is in `supabase/migrations/pending/20261013120100_google_sheets_sync_schedule.sql`.

**`public.google_sheets_connections`**
- Columns:
  - `organization_id`, `user_id` (FK cascade), `UNIQUE(organization_id, user_id)`;
  - `google_sub`, `google_email`, `granted_scopes`;
  - `status` ∈ connected | reconnect_required | disconnected;
  - **`auth_generation` bigint**, incremented on every connect, disconnect and reconnect-required transition;
  - `has_refresh_token`, `last_error_code`, timestamps.
- RLS: SELECT own (`user_id=auth.uid() AND organization_id=get_org_id()`); there are no client write grants.

**`public.google_sheets_sources`**
- Identity: `organization_id`, `user_id`, `connection_id`, `spreadsheet_id`, `sheet_id` (numeric gid).
- Names: `spreadsheet_name`, `sheet_title`, `display_name`.
- Configuration:
  - `mapping` jsonb (validated server-side);
  - `identity_mode` ∈ source_id | row_position; `id_header`;
  - `lead_source_default` (default `'Google Sheets'`);
  - `include_existing`;
  - **`config_version` int**, bumped on every configuration, identity or state change.
- Lifecycle:
  - `state` ∈ draft | enabled | paused (user intent);
  - `health` ∈ ok | needs_review | access_lost | error (system); `review_reason`;
  - `phase` ∈ initial | steady.
- Progress and scheduling: `row_epoch`, `activated_at`, `baseline_row_count`, `next_sync_at`, `lease_owner`, `lease_expires_at`, `consecutive_failures`.
- Results: `last_checked_at`, `last_success_at`, `last_result`, `last_error_code`, `last_error_message`.
- Constraints: `UNIQUE(organization_id, user_id, spreadsheet_id, sheet_id)`, which prevents duplicate configuration of the same tab. RLS: SELECT own.

**Operational row ledger: `private.google_sheets_source_rows`** (`source_id`, `row_key`)
- Columns: `row_number`, `fingerprint`, `kind` ∈ baseline | pending | done, `pending_reason`, `updated_at`.
- It cascades with the source; permanent protection lives in receipts.
- Uses by mode:
  - **ID mode:** baselines (`id:<value>`, plus `blank:<row>` for baseline rows with no ID) and pending rows (invalid, blank-ID, conflicting-ID).
  - **No-ID mode:** a record for every observed position (`pos:<row>`) with its fingerprint. This is the prefix used for structural validation.

**Permanent receipts: `private.google_sheets_receipts`**
- Key: `UNIQUE(organization_id, user_id, spreadsheet_id, sheet_id, receipt_key)`.
  - ID mode: `receipt_key='id:<value>'`. It is stable across sources, reconnects and remove/re-add.
  - No-ID mode: `'pos:<source_id>:<epoch>:<row>'`.
- Other columns: `outcome` ∈ imported | imported_flagged | skipped_duplicate; `lead_id` and `source_id` as lineage only (no FKs); `fingerprint`, `row_number`.
- Written in the same subtransaction as the lead insert, and never updated or deleted by this feature. It survives lead deletion, conversion, reconnects and source removal.
- Invalid rows never get a receipt, so a receipt never blocks a corrected row.

**Other tables**
- `private.google_sheets_oauth_states`: state hash, user, org, `auth_generation` at start, return origin, AES-GCM-encrypted PKCE verifier, `expires_at` (10 min), `consumed_at`.
- `public.google_sheets_sync_runs`: per-run results; SELECT own; pruned to 50 per source.

**Row fingerprint:** SHA-256 over the *core* normalised values (first name, last name, phone digits, lowercased email, after the Full name split). Edits to unmapped or optional columns therefore do not trip structural checks, and header renames or optional remaps do not invalidate the prefix.

### 0.4 Identity, retries and recovery

**Source Lead ID mode** (case-sensitive, trimmed)
- A row is a candidate when its ID has no receipt, no baseline and no conflict.
- Sorting and moving rows change nothing.
- **Conflicting duplicate IDs** (the same ID with different fingerprints): every unreceipted row of that ID is pending `duplicate_id`, reported as a row error, and nothing is imported until the conflict is resolved. There is no first-row-wins. Identical copies import once; the extra copies count as skipped.
- **Blank ID:** the row is pending `blank:<row>` ("Missing Lead ID") and is revisited every sync. Once an ID is entered it becomes a normal candidate. The one exception: if a baseline `blank:<row>` exists at the same row with the same fingerprint, the new ID is baselined, so editing an excluded row cannot create a lead.

**No-ID mode** (row position, with full-prefix validation)
- **One consistent read per sync:** a single `values.get` covering the header and all data rows up to the cap. The prefix and the new candidates are evaluated from that one snapshot.
- **Structural check:**
  - every `baseline` and `done` position 1..cursor must still match its stored fingerprint;
  - the data-row count must not fall below the cursor;
  - the header must resolve.
- **Pending positions are exempt from the fingerprint check,** because corrections are expected. They are revisited each sync even though they are behind the cursor.
- **Any mismatch** sets `health='needs_review'` with a reason, and **nothing is imported**. Progress, baseline, receipts and pending rows are preserved.
- This detects an insertion plus a compensating deletion above the tail, because every shifted position mismatches. A 25-row window would not.
- **Appended rows are never classified by content.** An identical-looking new row is a new position, so it reaches the duplicate policy.
- **Recovery (`review`):**
  1. a fresh read classifies the current rows: positions whose fingerprint matches a stored baseline or done fingerprint (multiset) are "known";
  2. the agent sees the counts and chooses **Import new rows** or **Skip them**;
  3. one transaction bumps `row_epoch` and `config_version`, rebuilds the positions (known → baseline-kind; unknown → pending `review_import` or baseline), and clears `needs_review`.

  The same review path applies whenever an activated source changes identity configuration (mode or ID column).

**Retries**
- The cursor advances only past positions that have a durable record (done or pending).
- An invalid or new incomplete row is stored as pending with its fingerprint. It counts as an error only when it is new or its fingerprint changed, and it is retried every sync until valid.
- A transient insert failure leaves no record, so the row is retried.

**Lifecycle**
- Pause/resume, edits that do not change identity, reconnect, and permission restoration all keep baselines, receipts and pending rows.
- Reconnect clears only the connection state. It never changes a source's `state`, so draft, paused and needs_review sources stay as they were.

### 0.5 Atomic ingest and concurrency

`private.google_sheets_ingest_batch` (called through a public, service-role-only wrapper) handles at most 50 rows per call, inside one transaction.

**Checks before anything is written** (with the source row locked FOR UPDATE):
- owner and organization match;
- `state='enabled'` and `health='ok'`;
- `config_version` is as expected;
- the lease matches and has not expired;
- the connection is `connected` with the expected `auth_generation`;
- the owner is eligible: an Active profile in that org, the org not suspended or archived, and the capability allowed.

If any check fails, it raises `stale` and nothing is written.

**Duplicate settings** are read from `contact_management_settings` on the server, with the CSV defaults: `phone_or_email`, `all_agents`, `flag`.

**Serialization:** `pg_advisory_xact_lock` on `(org)`, or `(org, owner)` when the scope is `assigned_only`, taken before evaluating duplicates. This serializes concurrent Sheets imports, including two sources importing the same person. It does not claim to fix CSV races.

**Per row (subtransaction):**
1. insert the receipt with ON CONFLICT DO NOTHING; a conflict means the row is already done, so count nothing;
2. evaluate duplicates with exact `import-contacts` semantics:
   - digits-only phone, and email lowercased and trimmed;
   - all four rules, with the candidate predicate matching the rule (phone OR email for `phone_or_email`; no phone-only prefilter);
   - `assigned_only` compares against the owner's leads;
   - rows inserted earlier in this batch or run count as existing;
3. skip → receipt `skipped_duplicate`; flag → insert with the `__agentflow.duplicateImport` and `tags:["Duplicate"]` marker; import → plain insert;
4. insert the lead:
   - `assigned_agent_id = user_id = imported_by_user_id = owner`, and `organization_id = org`;
   - `lead_score` 5, `status` per D5, `lead_source` per D4;
   - `state` via `normalize_us_state`;
   - the age and DOB rules from CSV;
5. set the receipt's `lead_id`, and the no-ID `done` position, in the same subtransaction;
6. a failure rolls back the receipt with it, and the row is counted as an error.

The existing triggers do the rest: `user_id` sync, one `lead_created` dispatch per insert, history, and no self-assignment notification. Skipped and invalid rows insert nothing, so no workflow fires for them. DNC, STOP, suppression and consent tables are never touched. Existing leads are never updated, merged or reassigned.

`google_sheets_finish_run` and every status or error write use the same lease plus `config_version` conditions, so an old worker cannot overwrite a newer run.

### 0.6 OAuth and Picker (amends §4)

**Start**
- Scopes: `openid email https://www.googleapis.com/auth/drive.file`; `include_granted_scopes=false`; PKCE S256; `access_type=offline`; `prompt=consent`.
- State: 32 random bytes, SHA-256-hashed at rest, single-use with an atomic consume and a 10-minute expiry. It is bound to the user, org and `auth_generation` at start.
- The return origin must be in a fixed allowlist (Edge secret), and the path is fixed.

**PKCE verifier:** encrypted with **AES-256-GCM in Edge** (key `GOOGLE_SHEETS_STATE_KEY`, AAD = state hash). This replaces the pgcrypto idea in §4.3, so the key never appears in SQL text or parameters.

**Callback**
- Identity: the id_token comes straight from Google's token endpoint over TLS, so the checks are `iss`, `aud` = Sheets client id, `exp`, `sub` and `email_verified`. The `userinfo` `sub` must match.
- Scopes: the granted `scope` is normalised (`email` ≡ `.../userinfo.email`). It must include `drive.file`, and anything outside {openid, email, drive.file} is rejected.
- Refresh token: a usable one is required. One that is absent never overwrites a stored one; the stored token is retained only for the same `sub`.
- `google_sheets_store_connection` writes the Vault secret and the connection row in one transaction, conditioned on the `auth_generation` captured at start. A late callback after a disconnect, or a superseded attempt, fails with "expired".

**Picker token:** a fresh access token is minted from the refresh token, and its **actual scopes are inspected** with Google `tokeninfo`. It is refused if any scope falls outside the allowlist. The returned `expires_in` is capped at the real expiry and at most 3,600 s. The token is held in memory only.

**Disconnect:** one transaction deletes the Vault secret, sets the connection to disconnected and bumps the generation. Sources stop; leads, receipts and baselines remain. It never calls `revoke`.

**Stale failures:** `invalid_grant` marks `reconnect_required` only `WHERE auth_generation = <generation used>`, so an old failure cannot disable a newer connection.

**Failure classification:**
- quota (`rateLimitExceeded` / `RESOURCE_EXHAUSTED` / 429) → backoff;
- `accessNotConfigured` / `SERVICE_DISABLED` → `error` `api_not_enabled`;
- `insufficientPermissions` / scope errors → reconnect;
- 404 or file-level `PERMISSION_DENIED` → `access_lost`.

**Callback hostname:** MCP `get_project_url` returns `https://jncvvsvckxhqgqvkppmj.supabase.co`, and no branded Supabase domain exists in the repository, its branches or the plans. The callback is `https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-sheets-oauth-callback`. The release package requires re-confirming that no custom domain is configured.

### 0.7 Worker, throughput and status

**Schedule:** pg_cron runs every minute and posts only while a source is due, authenticated with a Vault bearer token compared in constant time.

**Per invocation:** at most 10 sources are claimed with SKIP LOCKED and a 3-minute lease, within a 45 s budget, processing at most 500 rows per source.
- Steady state: `next_sync_at = finish + 5 min ± 30 s`.
- A source with remaining backlog (initial import, or more than 500 new rows) gets `next_sync_at = now()`, so it is picked up on the next one-minute tick with no 5-minute wait.

**Throughput (honest):**
- At most 10 source-checks per minute per worker invocation, so about 50 active sources are each checked about every 5 minutes.
- With N > 50 active sources, the interval stretches to about N/10 minutes.
- A 10,000-row backfill needs 20 runs, about 20 minutes.
- Google quota (300 reads/min per project) is not the binding limit; one check costs 2–3 reads.
- Raising capacity later means more concurrent invocations (leases make that safe), not changing the quota.

**Sync now** uses the same engine and checks, claims only that source, and has a 30 s cooldown.

**UI:** React Query polls every 10 s while any source is importing or syncing and the page is visible, and every 60 s otherwise. Processing never depends on the browser being open.

### 0.8 Exact files (this revision)

**New**
- `supabase/migrations/20261022062539_google_sheets_import_foundation.sql`
- `supabase/migrations/pending/20261013120100_google_sheets_sync_schedule.sql`
- `supabase/migrations/rollback/20261022062539_google_sheets_import_foundation.rollback.sql`
- `supabase/tests/google_sheets_harness.sql`, `supabase/tests/google_sheets_import.sql`
- `scripts/run_google_sheets_tests.sh` (native PostgreSQL plus a PostgREST role-access check)
- `supabase/functions/google-sheets-oauth-start/index.ts`
- `supabase/functions/google-sheets-oauth-callback/index.ts`
- `supabase/functions/google-sheets-api/index.ts`
- `supabase/functions/google-sheets-sync-worker/index.ts`
- `supabase/functions/_shared/googleSheets/`: `config.ts`, `http.ts`, `crypto.ts`, `oauth.ts`, `google.ts`, `mapping.ts`, `identity.ts`, `db.ts`, `engine.ts`, `errors.ts`, plus `*.test.ts`
- `src/lib/google-sheets/api.ts`, `schema.ts`, `picker.ts`, `status.ts`, plus tests
- `src/hooks/useGoogleSheets.ts`
- `src/components/settings/google-sheets/`: `GoogleSheetsSettings.tsx`, `GoogleConnectionCard.tsx`, `SheetSourceList.tsx`, `SheetSourceRow.tsx`, `AddSheetDialog.tsx`, `SheetPickStep.tsx`, `SheetMappingStep.tsx`, `SheetPreviewStep.tsx`, `SheetReviewDialog.tsx`, plus tests
- `docs/plans/2026-10-13-google-sheets-import/release-package.md`, `verification.md`

**Modified**
- `src/config/settingsConfig.ts`, `src/components/settings/SettingsRenderer.tsx`, `src/config/permissionDefaults.ts`
- the contacts-permission parity test, if one pins the SQL defaults
- `supabase/config.toml` (four new blocks)
- `implementation_plan.md` (root status), `WORK_LOG.md`, `AGENT_RULES.md` (new Google Sheets invariant)

**Not touched:** `import-contacts`, Gmail and Calendar functions, `_shared/google-token.ts`, workflows, dialer, Twilio, SMS, DNC, consent, `src/content/legal.ts` (privacy copy is proposed in the release package only).

### 0.9 Pre-release integrity corrections (review of `8b675e5`) — APPROVED 2026-10-13 WITH AMENDMENTS A–C

**Status:** Chris approved §0.9 on 2026-10-13, including decisions 1–4, subject to amendments A–C. This section is the amended, authoritative design. Approved: implementation, isolated local testing, Sheets-specific CI, branch commits/pushes, and updating draft PR #442. Still gated: merge, deploy, production migrations, Google Cloud, production secrets/settings, production cron, privacy publication, live imports.

**Implementation status (2026-10-13): IMPLEMENTED on `claude/keen-brown-e4u3ht`, draft PR #442. Nothing is applied, deployed or activated.**
- **Commits:** `0ffbbba` (SQL), `34d1b4e` (ops + cron check), `d9ac96a` (Edge), `3a0685f` (frontend), `1011a04` + `3e45be6` (CI), then docs.
- **Evidence:** `verification.md` — 26 regressions fail on `8b675e5` and pass here; 5 controls pass on both. Every Sheets CI job passed on `3e45be6`. The final head's CI is reported in the PR.
- **Where the build differs from the text below** (the text has been corrected to match):
  - an identical-looking new row next to its *anchored* excluded twin goes to review, as does one next to an unresolved twin. Content cannot tell the twin from the new row, so that is never a fast-path import. This follows from the "safely accounted" rule; only the test list said otherwise;
  - the dialog labels are "Keep out" / "Keep all out" (not "Keep excluded");
  - the end-to-end harness has 8 scenarios, including a reconnect between preview and apply;
  - one extra test file, `supabase/tests/google_sheets_finish_fixture.sql`, holds the fixture shared by the two-session race tests;
  - the workflow also triggers on this plan folder, so a docs-only head still gets exact-head Sheets CI.

**State checked before amending** (2026-10-13, read-only)
- **Code:** `main` is still `f91e4ba`. PR #442's head is `46445b7` (this plan's first version; docs only on top of the reviewed `8b675e5`). No open PR overlaps.
- **Migration status — environments actually checked:**
  - **Production** `jncvvsvckxhqgqvkppmj`, the only project in the Supabase account: no `20261013*` migration (latest `20261010172702`), no `google_sheets` relation, function or cron job, and the `_contacts_permission_default` MD5 is still `a199d5dd…b8`.
  - **PR #378's preview branch** `yngxvmpzaccmaowpqggs` (active): no Sheets migration or function (latest `20260922055909`).
  - **Not checked:** PR #294's preview branch is INACTIVE and was created on 2026-06-02, before this feature. No preview branch exists for PR #442.
  - **Conclusion:** the candidate migration is unapplied in every environment checked, so it is **amended in place**.
- **CI:** CI on `8b675e5` passed, but none of those workflows ran the Sheets suites.

**Reproductions on the reviewed code** (scratch scripts only; nothing committed)

| Finding | Result on `8b675e5` |
|---|---|
| 1 | Baseline `blank:2` (fp A) + `id:B`; sort so B is row 2 and A is row 3; give A an ID → `planSourceId` returns `id:NEWID` as an import candidate. |
| 3 | Two rows share ID `X` with identical core fields but `state` CA vs TX → no conflict; `id:X` is imported with CA (silent winner). |
| 2a | Claim → reconnect Google → finish the old run with `access_lost` → returns `true` and the source health becomes `access_lost`. |
| 2b | Claim → lease expires (not re-claimed) → finish → returns `true` and writes a new `last_success_at`. |
| Capacity | Claims go oldest-due first. A backlogged run re-queues behind already-due sources, and the same source is claimed again in the same invocation (S1 → S2 → S1). |

#### Finding 1 + Amendment A — excluded blank-ID rows stay excluded, and recovery works end to end

**Definitions (ID mode).**
- **Established ID:** has a permanent receipt `id:X` or an ID baseline. Definitive; never offered again.
- **Approved ID:** a new ledger kind `approved` (key `approved:X`), written only by an explicit Review decision. It is consumed (deleted) when the row's receipt is written. The planner clears it when the ID leaves the sheet.
- **Unseen-ID row:** a non-empty row whose ID is neither established nor approved.
- **Blank baseline:** `blank:<n>`, written at activation or by a review. It stores the position and the core fingerprint.

**Accounting each sync** (`identity.ts`, pure). For each core-fingerprint group `f` of blank baselines:
- A baseline is **anchored** when the row at its exact position has fingerprint `f` and no established or approved ID.
- The group is **safely accounted** only if every baseline in it is anchored, no other row with fingerprint `f` has an unseen ID, and an in-place ID completion (an anchored row that now has an ID) has no other blank or unseen-ID row with fingerprint `f`.
- **Unresolved set U** = the baselines in groups that are not safely accounted.

**Outcomes**
- **U empty → fast path** (unchanged in spirit):
  - anchored blank rows stay excluded silently;
  - an anchored row that received an ID is carried to an ID baseline (SQL re-validates the consumed `blank:<n>` key **and now its fingerprint**);
  - unseen-ID rows import under the F3 classifier, validation and the duplicate policy.
- **U non-empty and at least one unseen-ID row → `identity_ambiguous`.** This happens whatever the row's content or position. **Content match and original position are hints only and are never required** (Amendment A). The sheet goes to Needs review (decision 1): nothing imports and nothing is written that run. Baselines, receipts, approvals and pending rows are preserved.
- **U non-empty and no unseen-ID row:** nothing can be imported wrongly, so approved rows import and U stays preserved.

**Rules that always apply**
- Blank rows never import.
- A blank row that is not an anchored baseline is a `missing_id` error under the new pending key `noid:<n>`. This ends the old `blank:<n>` baseline/pending key collision. The row imports once it has an ID and identity is safe.
- Lead IDs stay optional: sheets without blank-ID baselines never take this path.

**Edited + moved + newly assigned ID is no longer an automatic import.** The excluded row's position stops anchoring, so U is non-empty and every unseen-ID row waits for review. The original plan's "documented limitation" is withdrawn.
**Remaining residual** (documented and tested): the edited/moved/completed excluded row is not caught only when a *different* row sits at its exact original position with the same name, phone and email and no Lead ID. That row then stands in for it, so the excluded content is still present and still excluded.

**Review paths.** Both are now generation-guarded (Amendment B) and bound to a snapshot.

*Identity review* (new, for `identity_ambiguous`):
- **`identity_review_preview`:**
  - reads the tab, capturing the generation of the refresh token actually used;
  - loads the ledger and receipt keys through the new owner-checked, read-only `google_sheets_review_state`;
  - classifies the rows into:
    - **established** rows — not shown for decision;
    - **kept** excluded rows — anchored, safe groups;
    - the **unresolved** excluded rows (shown by their original row numbers);
    - **decision rows** — every unseen-ID key (one per ID; repeats and conflicting copies share it) and every blank row that is not a kept baseline. Each carries a hint: same row (position + content), same content, original position, or none.
  - The snapshot token is computed **in SQL** by `google_sheets_resolve_identity(..., dry_run)`. It is SHA-256 over the source, `config_version`, generation, identity config, mapping, the **full ledger** and the classification.
- **Dialog** (new `SheetIdentityReviewDialog` + row list, both under 200 lines, Zod-validated):
  - every decision row is shown with an explicit choice and **no preselection**:
    - ID rows: "Import" or "Keep out";
    - blank rows: "Keep out" or "New row (imports once it has a Lead ID)";
  - "Import all" / "Keep all out" set every choice at once;
  - Apply stays disabled until every row has a choice.
- **`identity_review_apply`:**
  1. Repeats the fresh read and the classification.
  2. `google_sheets_resolve_identity` locks the source, then the connection. It checks owner eligibility, `state = enabled`, `health = needs_review`, reason `identity_ambiguous`, ID mode, the version, and the connection's status, owner and generation.
  3. It recomputes the snapshot and refuses with **`review_changed`** if anything material differs: rows, mapping, version, generation or ledger.
  4. It requires a decision for every decision row and that kept ∪ retired equals all blank baselines.
  5. Then, in one transaction:
     - Keep out (ID) → ID baseline;
     - Import (ID) → `approved:X`;
     - Keep out (blank) → `blank:<n>` baseline at its current position and fingerprint;
     - New row (blank) → nothing;
     - unresolved baselines are retired, because every row that could be them has been decided;
     - Needs review is cleared, the next check is set to now, and the version is bumped.

  Leads, receipts and other ledger rows are untouched.

*Structural / identity-change review* (existing `review_preview` / `review_apply` and `google_sheets_review`, corrected):
- **Classification** becomes **established** (ID receipt or baseline; definitive), **content-matched** (fingerprint multiset; ambiguous) and **unmatched**. Content-matched rows are no longer silently "already handled".
- **Dialog:** an explicit choice is required for content-matched rows ("Keep them out" / "Import them as new leads") and for unmatched rows ("Skip them" / "Import them as new leads"), with no preselection. Rows matched by Lead ID are shown only as a count.
- **Apply** carries `p_generation` and the snapshot, with the same locks and validation.
- **ID mode:** rows left for import that have an ID are recorded as `approved:X`, so the next sync does not ask again.

*Both paths*
- A failed apply (stale snapshot, version, generation or network error) **changes nothing on the server**.
- The dialog stays open with the agent's choices, refetches the preview, keeps choices for rows that still exist and asks only about new or changed rows.
- The mapping/identity override from Edit mapping (the "draft") is kept.
- Receipts keep preventing replay: established rows are never offered, and ingest refuses any key with a receipt, baseline or done record.

**SQL** (amends the unapplied migration)
- `source_rows.kind` gains `approved`.
- **Ingest:**
  - pending keys must match `^(id|dup|noid):`;
  - clear ops may also remove `approved:` records (pending/approved only, never baseline or done);
  - a carry checks the fingerprint;
  - a successful ID-mode import deletes pending `id:X` and `approved:X`.
- **New:** `google_sheets_review_state`, `google_sheets_resolve_identity`.
- **Changed:** `google_sheets_review` (generation, three-way split, snapshot, approvals).
- `load_state` returns approvals automatically.

**Tests** (all through real SQL):
- **Planner unit tests (Deno):** the exact repro; edited+moved+ID'd; several excluded rows; an identical-looking new row next to its excluded twin (review whether the twin is anchored or unresolved); the standing-in residual; carry; and incomplete rows becoming candidates once corrected.
- **End to end:** a new Deno harness, `scripts/google_sheets_e2e.ts`, runs the real `actions.ts` and engine code against the migration through the local PostgREST. Only Google HTTP is faked. Each scenario runs planner → Review preview → Review apply → next sync:
  1. the exact sorted blank-ID repro (explicit **Keep out** → never imported; repeated with explicit **Import** → imported once, no replay);
  2. an excluded row edited, moved and then given an ID;
  3. several excluded blank-ID rows (some stay blank and move, one completed, one deleted);
  4. a genuinely new identical-looking row next to its excluded twin → review → explicit Import, imported once (content cannot tell the twin from the new row, so this is never a fast-path import);
  5. a row arriving, and separately a row changing, between preview and apply → `review_changed`, nothing changed, a fresh preview includes it, then apply succeeds;
  6. a reconnect between preview and apply → the old snapshot is refused and nothing changes; a fresh review under the new generation applies;
  7. the structural review with explicit decisions for content-matched and unmatched rows.

  It also checks that established rows are never offered and are never re-imported.
- **SQL suite:** `resolve_identity` refusals (forged keys, missing decisions, a retire list that is not exactly the unresolved baselines, wrong state or version) and `review` snapshot refusal.

#### Finding 2 + Amendment B — authorization-generation safety everywhere it matters

**Finalization** — `private/public.google_sheets_finish(p_source, p_lease, p_version, p_generation, p_trigger, p_result)` returns text: `completed | released | not_owner | not_found`.
1. Lock order is **source FOR UPDATE, then connection FOR SHARE** — the same as `lock_for_work`/ingest and activate. Connection operations lock only the connection row, so there is no inversion.
2. **After both locks**, the clock is read with `clock_timestamp()` (never transaction-start `now()`).
3. **Valid only if all hold:**
   - `lease_owner = p_lease` and the lease is unexpired at real time;
   - `config_version = p_version` and `state = 'enabled'`;
   - the connection is `connected`, belongs to the same user and org, and has `auth_generation = p_generation`;
   - the owner is still eligible.
4. **Valid →** the current writes and `completed`.
5. **Another worker's lease →** `not_owner`, with no write of any kind.
6. **Our lease but otherwise invalid →** clear only our lease and return `released`. No health, review, success-time, error, schedule, result or history write (decision 2). Leads and receipts from earlier batches stay.

**Worker writes**
- `lock_for_work` evaluates every condition after both locks using `clock_timestamp()`.
- Ingest re-checks lease expiry with `clock_timestamp()` after waiting for the duplicate advisory lock.

**Review**
- Both review paths take the generation of the refresh token actually used for the read (`access()`), and validate inside the apply transaction, under the connection lock: connection ownership, `connected` status and the generation, alongside the source version.
- An unchanged Google account (the same `sub`) is not treated as an unchanged generation.
- A stale apply refuses with `connection_changed` (or `not_connected` after disconnect). It rebuilds no baseline, keeps Needs review, and changes no mapping or schedule.

**Engine**
- `db.finish` returns the outcome, and `RunOutcome.finalized` records it.
- Any outcome other than `completed` makes the run `stale`: the counts of already-committed batches are preserved, and no success timestamp is manufactured.
- Review, access-lost and error statuses are reported only when their finish completed.
- The worker log and the Sync now response carry the outcome, and the UI says the sync stopped because the sheet or connection changed (with the committed count) instead of "Checked".

**Picker**
- Immediately before returning, the new `google_sheets_connection_current(user, org, connection, generation)` must return `current`: same connection id, same generation, same owner, `connected`, and the owner currently eligible.
- Otherwise the response is 409 `connection_changed` / `not_connected` or 403 `not_permitted`, with no token, and **no `mark_reconnect`**, so a newer connection is never disabled.
- The actual-scope allowlist and `no-store` are kept.
- This does not revoke an access token Google already minted. It is never returned and expires on its own (at most 1 hour).

**Tests**
- **SQL:**
  - reconnect then finish with `access_lost`, `needs_review`, `error` and success → `released`, snapshot unchanged;
  - disconnect → `released`;
  - lease expired and not re-claimed → `released`;
  - takeover → `not_owner`, newer state and lease intact;
  - permission revoked → `released`;
  - review dry run → reconnect, and separately disconnect → apply refused, nothing changed;
  - `resolve_identity` likewise.
- **Two sessions:**
  - (a) session A holds the connection lock during a reconnect while B finishes the stale run → `released`; **negative control** with the connection lock removed → `completed`.
  - (b) the lease expires while finish waits for the source lock → `released`; **negative control** with `clock_timestamp()` replaced by `now()` → `completed`, proving real-time evaluation matters.
- **Deno:**
  - the engine passes the claimed generation, and a `released`/`not_owner` finish is reported as `stale` with the committed counts;
  - the Picker refuses when the generation changes between mint and return, without calling `mark_reconnect`.

#### Finding 3 — duplicate-ID conflicts compare all mapped values (unchanged from the approved plan)
- **Signature:** `mapping.ts` adds `rowSignature`, the SHA-256 of the trimmed raw cells of every mapped column (standard and custom) plus the ID column, in a stable order. Invalid rows keep their own values.
- **Shared classifier:** `identity.ts` adds `classifySourceIdRows`, used by both the planner and the preview:
  - blank ID → `missing_id`;
  - same ID with different signatures → `duplicate_id` for every row, nothing imported;
  - identical repeats → first `ok`, the rest `repeat`;
  - otherwise `ok`.
- **Preview precedence:** `missing_id` → `duplicate_id` → `repeat` → `invalid` → duplicate policy → ready. `SheetPreviewStep` gets labels for the new outcomes.
- **Unchanged:** the core fingerprint is still used for no-ID prefix validation, baselines, receipts and the Finding 1 groups.
- **Tests:** same core with a different state, DOB, notes or custom value; an invalid and a valid row sharing an ID with identical core; identical repeats imported once; preview/processing agreement.

#### Amendment C — shutdown documentation matches execution

**Facts the release package will state**
- **UI flag** `VITE_GOOGLE_SHEETS_ENABLED`: hides the Settings UI after a frontend redeploy. It stops no backend work.
- **Future cron scheduling:** `cron.unschedule('google-sheets-sync-every-minute')` stops new scheduled invocations only.
- **Queued HTTP requests:** a `net.http_post` already queued in `net.http_request_queue` can still be sent after unscheduling.
- **Already-running invocations:**
  - the worker reads `GOOGLE_SHEETS_ENABLED` **once, before its claim loop**, and the API reads it per request;
  - changing the flag does not stop an invocation already past that check, which keeps claiming until its 10-claim / 45 s cooperative budget ends;
  - a cooperative budget does not prove outstanding Google or database calls have finished;
  - secret changes reach later invocations only as the platform picks them up.
- **In-flight database operations:** each RPC is atomic. One that has started finishes or rolls back on its own.
- **Per-source pause / per-connection disconnect:** bump `config_version` / `auth_generation`, so that source's or connection's next ingest batch and its finish are refused. Leads, receipts and baselines stay.

**Admission gate** — the shutdown control that does not depend on any of the above. New ops files, following the `supabase/ops/` convention (NOT RUN; each needs approval; applied as a migration at the time):
- `supabase/ops/google_sheets_admission_close.sql` revokes EXECUTE on every `public.google_sheets_*` wrapper from `service_role`, except `google_sheets_disconnect`, so agents can still remove access. The effects:
  - every new database operation from any invocation (queued request, running worker, API, OAuth callback) fails with `42501`;
  - an RPC already executing completes atomically;
  - no data, source state or schedule changes.
- `supabase/ops/google_sheets_admission_open.sql` restores the exact grants.
- `supabase/ops/google_sheets_unschedule.sql` is idempotent.
- `supabase/ops/google_sheets_drain_check.sql` is read-only. It reports:
  - backends currently executing a Sheets wrapper (`pg_stat_activity`);
  - queued pg_net requests to the worker (when pg_net exists);
  - the gate's privilege state;
  - quiescence markers: receipt count and latest time, Sheets lead count, latest sync run, latest source/ledger/connection update.

**Non-destructive shutdown** (release package)
1. Record the markers.
2. Unschedule the cron job.
3. Close admission.
4. Poll until there are zero active Sheets backends **and** zero queued worker requests.
5. Wait 2 minutes and re-read the markers. They must be identical. If they are not, the result is **BLOCKED, not stopped**.
6. Optionally unset the backend flag and hide the UI.

Leases are reported but never used as proof of termination.

**Resume:** open admission → reschedule cron → set the flags. Interrupted leases expire within 3 minutes, and receipts prevent replay.

**Tests**
- **Local multi-session** (`run_google_sheets_tests.sh`), synthetic data:
  - a run commits batch 1, the gate closes, and the same session's next ingest and finish are refused with `42501`. Batch 1's lead and receipt stay, and the source state is unchanged.
  - Another session's ingest, already executing (waiting on the duplicate advisory lock held by a third session) when the gate closes, completes once released.
  - The drain check then reports 0 active and the markers stay identical.
  - Reopening restores the exact ACL (the T1 assertions run again), and the source resumes after lease expiry without replay.
- **Real pg_cron/pg_net** (`scripts/run_google_sheets_cron_check.sh`):
  - **Isolation:** `supabase/postgres:17.6.1.063` (the production version), started with `--network none`. Isolation is verified before the test, and the Vault worker token is synthetic.
  - **Schedule:** the harness, the foundation and the **exact** pending schedule migration are applied. The job exists. A due source makes the job run, and its request fails at the network layer — evidence that nothing is reachable.
  - **Unschedule:** after the unschedule ops file, the job is gone, no new `job_run_details` row appears for 70 s or more, and the queue is drained.
  - The drain check runs against real pg_net.
  - Empty due-work tables are not relied on.

**Capacity** (unchanged limits; decision 3)
- At most 10 claims per invocation and 500 rows per run (batches of 50).
- The oldest due source goes first.
- A backlogged source re-queues at `now()` and may run again in the same invocation.
- **5,000 rows per invocation is a conditional arithmetic ceiling** (10 × 500, only when one source is alone and every read is fast). It is not verified throughput and not a guaranteed per-minute rate.
- Steady state is about `max(5, N/10)` minutes per source when runs are fast.

#### CI against the exact candidate head
`.github/workflows/google-sheets.yml`:
- **Triggers:** `pull_request` on Sheets paths (including this plan folder, so a docs-only head is still checked), and `workflow_dispatch`.
- **Least privilege:** `permissions: contents: read`, no secrets, and no production URL or credential in any job.
- **Checkout:** `github.event.pull_request.head.sha`.

| Job | Runs |
|---|---|
| `sql` | `postgres:17.6` service + PostgREST v12.2.3 → `scripts/run_google_sheets_tests.sh`: the suite, the regression file, concurrency plus negative controls, the shutdown gate, rollback, PostgREST, and the end-to-end Review harness |
| `cron` | `scripts/run_google_sheets_cron_check.sh` (`supabase/postgres:17.6.1.063`, `--network none`) |
| `edge` | Deno 2.5.6 (npm) → Sheets `deno test` + `deno check` on the four entry points |
| `frontend` | `npm ci` → focused Vitest, Sheets ESLint, `npx tsc --noEmit`, app tsc versus the PR base (zero new diagnostics), `npm run build` |
| `ui` | Playwright 1.56.1 Chromium → Vite with mock env → `scripts/tests/google-sheets-ui/verify.mjs`; screenshots kept as an artifact |

If publishing the workflow file is refused, I report the exact blocker and continue all local verification. CI is not claimed.

#### Regression evidence (how it will be shown)
- **Regression tests** use only behaviour and APIs present in both versions:
  - Deno: `planRows`/`planSourceId`, `runSource` and `pickerToken` with fakes;
  - SQL: an adapter that calls whichever `finish`/`review` signature exists and asserts on **database state**, never on a missing symbol.
- They are run against a worktree of `8b675e5` (Deno `--no-check`; its own harness + migration) and must **fail there**, then pass on the candidate.
- They are listed separately from existing controls (tests that pass on both, such as the race negative control and takeover → `not_owner`).

#### Exact files (this correction)
**Modified**
- **Migration:** `supabase/migrations/20261022062539_google_sheets_import_foundation.sql` (unapplied candidate):
  - the `approved` kind; `lock_for_work`, ingest, finish, review; the new `review_state`, `resolve_identity` and `connection_current` (private + public); the ACL blocks pick these up by name.
- **Edge:**
  - `supabase/functions/_shared/googleSheets/{identity,mapping,engine,db}.ts`
  - `supabase/functions/google-sheets-api/{actions,index}.ts` (identity-review actions, Picker recheck, error mapping)
  - `supabase/functions/google-sheets-sync-worker/index.ts` (logs the finish outcome only; no behaviour change)
- **Frontend:**
  - `src/lib/google-sheets/{status,schema,api}.ts`
  - `src/components/settings/google-sheets/{SheetReviewDialog,SheetSourceRow,SheetSourceList,GoogleSheetsSettings,SheetPreviewStep}.tsx`
- **Tests:**
  - `supabase/functions/_shared/googleSheets/{identity,mapping,engine}.test.ts`
  - `supabase/tests/{google_sheets_harness,google_sheets_import}.sql`
  - `scripts/run_google_sheets_tests.sh`, `scripts/google_sheets_postgrest_check.mjs`
  - `src/lib/google-sheets/__tests__/googleSheets.test.ts`, `src/components/settings/google-sheets/__tests__/googleSheetsUi.test.tsx`
  - `scripts/tests/google-sheets-ui/verify.mjs`
- **Docs:**
  - this plan and the root `implementation_plan.md`;
  - `release-package.md`, `verification.md` (results and checksums);
  - `WORK_LOG.md`;
  - `AGENT_RULES.md` (the Sheets invariant: finalization/generation rules, blank-ID accounting, review contract, shutdown controls).

**New**
- **Frontend:** `src/components/settings/google-sheets/{SheetIdentityReviewDialog,IdentityReviewRows}.tsx`
- **Edge tests:**
  - `supabase/functions/_shared/googleSheets/regressions.test.ts`
  - `supabase/functions/google-sheets-api/{actions,index}.test.ts`
- **SQL tests:** `supabase/tests/google_sheets_regressions.sql`, `supabase/tests/google_sheets_finish_fixture.sql` (fixture shared by the two-session race tests)
- **Scripts:**
  - `scripts/google_sheets_e2e.ts` (+ `scripts/google_sheets_postgrest_client.ts`, a minimal PostgREST client for it)
  - `scripts/run_google_sheets_cron_check.sh` + `supabase/tests/google_sheets_cron_check.sql`
  - `scripts/google_sheets_regression_evidence.sh`
- **Ops:** `supabase/ops/google_sheets_{admission_close,admission_open,unschedule,drain_check}.sql`
- **CI:** `.github/workflows/google-sheets.yml`

**Not touched:**
- the rollback (it drops functions by name pattern and the tables wholesale — re-verified by the suite);
- the pending cron migration (tested as-is);
- OAuth start/callback;
- Gmail, Calendar, `import-contacts`, workflows, telephony, SMS, DNC and consent.

**Verification:**
- `npx tsc --noEmit`;
- `npx tsc -p tsconfig.app.json --noEmit` against a fresh baseline from `main`;
- focused SQL/Edge/frontend/browser tests and changed-file ESLint;
- `npm run build`;
- the regression evidence above;
- CI check runs reported for the exact pushed head.

**Unchanged release gate:** the real Google-account test (Picker selection → server read → fresh token from the stored refresh token → server read succeeds again). Mocked Picker checks are not that test.

**Decisions 1–4 (approved):**
1. Ambiguous row identity pauses that sheet until reviewed (Amendment A).
2. A stale finalization creates no run-history entry and changes no operational status; it may release only its own lease; committed leads and receipts stay.
3. Oldest-due scheduling and same-source repeats stay, with no limit change; 5,000 is a conditional ceiling.
4. Cron tests use the pinned `supabase/postgres:17.6.1.063`, with synthetic credentials and verified network isolation.

---

*Original Phase 1 plan follows (history; superseded where §0 differs).*

## 1. Sources reviewed

**Repository**
- AGENT_RULES.md: §3, §4 (#2, #4, #5, #10, #19–#21, #25–#28, #31, #33, #35–#39), §5, §7–§10, and the dated invariants.
- VISION.md.
- WORK_LOG.md: the newest six entries, plus every Google/OAuth/import/duplicate entry.
- There is no AGENTS.md or CLAUDE.md anywhere in the repository.
- `docs/plans/2026-10-09-google-verification/*`. This is the latest Google verification record:
  - Cloud project number `87346168200`;
  - consent screen **External / Testing**;
  - privacy policy published on October 9 and covering Gmail and Calendar only.
- Code paths:
  - `settingsConfig.ts`, `SettingsRenderer.tsx`, `SettingsPage.tsx`, `permissionDefaults.ts`;
  - `EmailSetup.tsx`, `supabase-email.ts`;
  - the `email-connect-*`, `google-oauth-*` and `google-calendar-*` functions, and `_shared/google-token.ts`;
  - `import-contacts`, `import-field-matching.ts`, `contactDuplicateDetection.ts`, `supabase-settings.ts`, `supabase-import-history.ts`, `ImportLeadsModal.tsx`;
  - `viewAsSurfaces.ts`, `AppLayout.tsx`, `usePermissions.ts`.

**Open PRs:** #441, #429, #425, #398, #383, #382, #381, #378, #294. None touches Settings → Google Sheets, `import-contacts` or `_contacts_permission_default`.
- **#378** (Google OAuth hardening) is an open, conflicting draft and is **not deployed**. This plan neither depends on it nor conflicts with it: every Sheets file and table is new.
- **#425** also edits `supabase/config.toml`. Our additions are new blocks only; reconcile them at merge time.

**Production, read-only via MCP**
- Extensions:
  - Installed: `pg_cron` 1.6.4, `pg_net` 0.19.5, `supabase_vault` 0.3.1, `pgcrypto`.
  - Not installed: `pgsodium`.
- Cron jobs: the newest pattern is the Vault bearer token (`sms-consent-recovery`, `a2p-reconcile`, `platform-admin-notify`).
- Lead triggers and their behaviour:
  - `tr_sync_leads_user_id`: sets `user_id := assigned_agent_id`.
  - `trg_workflow_lead_created`: runs per row. It calls `private.workflow_dispatch_event`, which POSTs through pg_net to `workflow-trigger-evaluator`.
  - `trg_notify_lead_assignments_ins`: runs per statement. It skips the row when `assigned_agent_id = imported_by_user_id`.
  - `contact_history_capture`: records action `imported` when `imported_by_user_id` is set.
- Duplicate policy and permissions:
  - `contact_management_settings` (one org row): rule `phone_or_email`, scope `assigned_only`, `csv_action` `flag`.
  - `has_contacts_permission(p_key)` depends on `auth.uid()` and `get_org_id()`, so it returns false for a service-role worker.
  - `_contacts_permission_default` is an IMMUTABLE SQL table of defaults.
  - `role_permissions` (Chris's org): Agent has `contacts.leads.import = true`. Team Leader has no `contacts` object, so it falls back to the defaults.
- Helpers available: `private.is_dnc_phone(uuid,text)`, `private.phone_digits_e164ish`, `public.phone_last10`, `public.normalize_us_state`, `private.campaign_actor`.
- Existing Google storage:
  - `user_email_connections`: tokens are Base64 only, and managers can SELECT them.
  - `calendar_integrations`: tokens are Base64 only, and the table has no `organization_id`.
  - `email_oauth_states`: deny-all RLS (a good pattern), but it is consumed non-atomically.

**Google documentation**, researched 2026-10-13. These are search-engine extracts; developers.google.com could not be fetched directly from this container. Items marked **[test]** must be confirmed by a real call before release.

---

## 2. Existing flaws to avoid (not fixed here)

The Sheets work will not copy these. Fixing them in Gmail or Calendar is out of scope, and PR #378 is the vehicle for that.

1. **Tokens are not encrypted.** Google tokens are Base64 (`_shared/google-token.ts:1-9`), and `user_email_connections` SELECT lets Admins and Team Leaders read other users' token columns.
2. **Open redirect.** `email-connect-start` stores a client-supplied `redirect_to`, and the callback redirects to it.
3. **OAuth state is checked, then marked used later.** Both callbacks do this, so a failed exchange leaves the state reusable. There is no PKCE.
4. **Shared grant and revoke.**
   - Gmail and Calendar share `GOOGLE_CLIENT_ID` with `include_granted_scopes=true`.
   - Calendar disconnect calls Google `revoke`. Google's documentation describes revocation as removing the grant for the app (wording varies between "client" and "all clients in the project").
   - So a Calendar disconnect likely kills Gmail.
5. **Unchecked scopes and identity.** The granted `scope` is never checked, the id_token is not verified, and raw error text goes into redirect query strings.
6. **Weak secret comparison.** Cron secrets are compared with `!==`, which is not constant-time.
7. **`import-contacts` gaps.**
   - It has no server-side `contacts.leads.import` or Active-profile check.
   - It takes the duplicate policy from the request body.
   - It reads org contacts without pagination, so the PostgREST row cap can truncate the set.
   - It has no within-batch dedupe.
   - Its two inserts are not atomic.
   These are recorded as follow-ups; this plan does **not** modify `import-contacts`.
8. **No identity-wide cache reset.** React Query has no reset on identity change. Correctness depends on identity-scoped query keys.

---

## 3. V1 scope

**Location:** Settings → Automation & API → **Google Sheets**, slug `google-sheets`. One Google account per agent per organization; multiple spreadsheet sources under it.

### 3.1 UI (compact, no inner page heading, matching the recent cleanup)

**Connection card:** Google account email, status badge, Connect / Reconnect / Disconnect.

**Source list:** one row per source showing:
- display name, and spreadsheet → tab;
- status badge: Active, Paused, Importing, Needs review, Reconnect, Error;
- last successful sync (relative time);
- the last run's imported / skipped / flagged / errors;
- actions: Sync now, Pause/Resume, Edit mapping, Remove.

**Add sheet** opens a dialog of four steps:
1. **Spreadsheet.** Google Picker, spreadsheets only.
2. **Tab.** Tabs listed by numeric `sheetId`. A spreadsheet/tab pair already configured for this agent is shown as disabled, with "Already added".
3. **Map.** Columns are auto-detected with `import-field-matching.ts`.
   - First name, last name and phone (or Full name) are required.
   - Optional fields: standard fields plus permitted active custom fields.
   - The agent can pick an optional **Source Lead ID** column.
   - There is a default Lead Source and a default Status.
4. **Preview.** Shows the first 20 rows with outcomes (Import / Duplicate–flag / Duplicate–skip / Invalid) and counts for the whole sheet, then **Start import**.

**Draft handling**
- The draft lives in component state, validated with Zod.
- A failed save keeps the dialog open with the draft intact and a concise error.
- Closing the dialog on purpose discards the draft.

**No initial import until Start.** Saving creates the source in `draft`. The initial import begins only after **Start import** from the preview.

**View As:** Settings is already withheld at the layout (`viewAsSurfaces.ts`). The component also returns a notice when `isImpersonating`, following the `OnboardingEmailPreference` convention, and runs no queries.

**Identity changes:** query keys are `["google-sheets", orgId, userId, ...]`. Per-identity state is cleared at render time when the identity key changes. Request generations discard late responses. Picker tokens and the dialog draft are dropped on any identity change.

### 3.2 Not in V1

- Updating existing leads when a sheet row is edited.
- Two-way sync or writing to sheets.
- Campaign attachment.
- Creating custom fields.
- More than one Google account per agent.
- Admin views of other agents' sources.
- Agency import-assignment rotation. All leads go to the connection owner.
- `import_history` rows and Undo (see D7).

---

## 4. Google connection design

### 4.1 Google Cloud requirements (Chris performs these; nothing is changed by me)

All in the existing project **87346168200** ("My First Project", `project-b7e9b5b4-d066-48c9-b36`).

| # | Item | Exact requirement |
|---|---|---|
| G1 | APIs | Enable **Google Sheets API**, **Google Drive API** and **Google Picker API**. |
| G2 | OAuth client | Create a **new Web application client "AgentFlow Sheets"**, with authorized redirect URI exactly `https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-sheets-oauth-callback`. No JavaScript origins are needed, because the code flow is server-side and the Picker uses a token our server supplies. Do not modify the existing "AgentFlow Web" or older clients. |
| G3 | Browser API key | Create an API key restricted to **HTTP referrers** `https://www.fflagent.com/*` and `https://fflagent.com/*`, plus approved preview origins if wanted, with API restriction **Google Picker API** only. It is public by design (a Picker developer key); referrer and API restrictions limit abuse. |
| G4 | Data Access | Add `openid`, `.../auth/userinfo.email` and `https://www.googleapis.com/auth/drive.file` (non-sensitive; no scope verification or CASA needed for these). Do **not** add `spreadsheets.readonly` (sensitive) or `drive.readonly` (restricted). |
| G5 | Publishing status | **Blocking dependency.** In **Testing**, only listed test users can connect and every grant **expires 7 days after consent**. The basic-profile exemption does not cover `drive.file`. The 5-minute worker would hit `invalid_grant` weekly. V1 can be piloted in Testing with test users and a visible Reconnect state. **Agency rollout requires "In production".** |
| G6 | Brand verification | Without verified branding the consent screen shows only the domain. Publishing to production affects the existing Gmail/Calendar flows too: unverified sensitive/restricted scopes show the unverified-app screen and the lifetime 100-user cap applies to those flows. That decision belongs with the Gmail verification track (see D10). |
| G7 | Privacy policy | `/privacy` currently discloses only Gmail and Calendar. Before any non-test user connects Sheets, a Google Sheets/Drive paragraph needs publishing (Limited Use; only files the user selects; rows imported as agency leads; background sync; disconnect behaviour). Draft copy is in §11 and needs Chris's exact-copy approval. |

**Why a dedicated client** in the same project:
- Picker `setAppId` must be the project number, and the token's client must be in the same project for `drive.file` grants to apply.
- A separate client isolates its secret, its 100-refresh-tokens-per-user cap and its granted scope set from Gmail/Calendar.
- We never use `include_granted_scopes`, so Sheets tokens carry only `openid email drive.file`, and Gmail scopes can never reach the browser.

### 4.2 OAuth flow

1. **Start.** `POST google-sheets-oauth-start` with the user's JWT.
   - The function validates the JWT in code (invariant #2).
   - It loads the profile from `public.profiles`, requiring Active status and an org. It requires the feature switch to be on and the new permission to pass.
   - It creates the state:
     - 32 random bytes; only the SHA-256 hash is stored;
     - a PKCE S256 `code_verifier`, stored encrypted;
     - `user_id`, `organization_id`, `return_key`, and `expires_at = now() + 10 min`.
   - It returns the Google URL with these parameters:
     - `client_id` = the Sheets client;
     - `scope=openid email https://www.googleapis.com/auth/drive.file`;
     - `access_type=offline`, `prompt=consent`, `code_challenge`;
     - `login_hint` = the connected email when reconnecting;
     - **no** `include_granted_scopes`.
2. **Return URL.** The client sends only `return_key` ∈ {`settings`}. The server maps it to `${origin}/settings?section=google-sheets`, where the origin must be in the Edge secret `GOOGLE_SHEETS_ALLOWED_RETURN_ORIGINS`. The default is `https://www.fflagent.com`. **No client-supplied URL is stored or followed.**
3. **Callback.** `GET google-sheets-oauth-callback` (Google redirect; `verify_jwt=false`).
   - **Atomic consume:** `UPDATE ... SET consumed_at=now() WHERE state_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING ...`, through a service-role-only RPC. A miss redirects with `sheets=expired`.
   - Re-check that the user is still Active, in the same org, and has the permission.
   - Exchange the code with the PKCE verifier and client secret.
   - **Verify identity:** decode the returned `id_token` and check `aud` = Sheets client id, `iss`, `exp`, `sub`, `email` and `email_verified`. The token comes straight from Google's token endpoint over TLS, so these checks are sufficient. Then also call `openidconnect.googleapis.com/v1/userinfo` and require the same `sub`.
   - **Verify scopes:** the response `scope` must contain `drive.file`. If it does not (the user unticked it), store nothing and redirect with `sheets=scope_denied`.
   - **Same account:** if a connection already exists with a different `google_sub` and has sources, refuse with `sheets=account_mismatch`. The agent must reconnect the same account, or remove its sources first. This prevents silent loss of access to picked files.
   - Encrypt and store the refresh token (§4.3), upsert the connection as `connected`, and clear `reconnect_required` on its sources.
   - Redirect with a status code only (`sheets=connected|expired|scope_denied|account_mismatch|error`). Never put raw error text in the URL.
4. **After return.** The frontend strips the query flag and **re-reads status from the server** before showing Connected.

### 4.3 Credential storage

**D3 recommendation: Supabase Vault**, the repository's existing real-encryption pattern (Twilio subaccount tokens).
- **Secret:** `google_sheets_refresh_<connection_id>`.
- **Access RPCs:** `private.google_sheets_set_refresh_token(conn uuid, token text)`, `private.google_sheets_get_refresh_token(conn uuid)` and `private.google_sheets_delete_refresh_token(conn uuid)`.
  - All are SECURITY DEFINER with `search_path` set to `public, vault, pg_temp`.
  - EXECUTE is revoked from PUBLIC, anon and authenticated, and granted to service_role only.
- **Access tokens are not persisted.** The worker refreshes once per connection per run and keeps the token in memory.
- **Logging and responses:** tokens are never logged. Errors pass through a `sanitizeError` that also redacts `ya29.` and `1//` token shapes.
- **Alternative:** AES-256-GCM in Edge, with key `GOOGLE_SHEETS_TOKEN_KEY_V1`, AAD = connection id + user id, and ciphertext in a private table. It is equally valid, but adds key management and rotation of our own. It is not chosen unless Chris prefers it.
- **PKCE verifiers** are short-lived. They are stored in the private state table, encrypted with `pgcrypto` `pgp_sym_encrypt` under a key from the Edge secret (`GOOGLE_SHEETS_STATE_KEY`), and deleted on consume. A purge of states older than one day runs inside the worker.

### 4.4 Picker token

`POST google-sheets-api {action:"picker_token"}` with the user's JWT:
- requires an Active profile, the permission and a connected status;
- refreshes from the stored refresh token;
- returns `{access_token, expires_in}` with `Cache-Control: no-store`;
- **only if the stored granted scopes are a subset of {openid, email, userinfo.email, drive.file}**; otherwise it fails closed with "Reconnect".

The token lives only in a component ref, is passed to `PickerBuilder.setOAuthToken`, and is discarded when the Picker closes or the identity changes. It is never stored in browser storage, React Query or logs. Google access tokens last about 1 hour; this is Google's short-lived token, scoped to `drive.file` only.

**Picker configuration**
- `setAppId("87346168200")`
- `setDeveloperKey(VITE_GOOGLE_PICKER_API_KEY)`
- `DocsView(ViewId.SPREADSHEETS)` with `setMimeTypes("application/vnd.google-apps.spreadsheet")` and multiselect off
- `setOrigin(window.location.origin)`

The Picker loader script `https://apis.google.com/js/api.js` is injected on demand. There is no CSP today (vercel.json has rewrites only), so nothing blocks it.

### 4.5 File access check

After a pick, the server (not the browser) calls Drive `files.get` with `fields=id,name,mimeType,trashed` and `supportsAllDrives=true`, using the server token. It requires the Google Sheets mimeType and `trashed=false`.

It then calls Sheets `spreadsheets.get` with `fields=properties.title,sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount))`.

Results:
- **404 or 403:** "This sheet isn't shared with AgentFlow — pick it again". This happens, for example, when the Picker account differs from the connected account.
- **[test]:** confirm that a file picked with the server-minted token is readable by the server's refresh token. Same client, same project and same user make this the documented `drive.file` behaviour, but it must be shown with a real account before release.

### 4.6 Disconnect, expiry and revocation

- **Disconnect (Sheets only).**
  - Deletes the Vault secret, sets the connection to `disconnected`, and pauses all its sources (status `reconnect_required`).
  - It **does not call Google `revoke`**. Google's documentation says revocation can remove the grant for every client in the project, which could disconnect Gmail or Calendar.
  - Existing leads and receipts remain.
  - The UI says once: "To remove AgentFlow's access at Google, use your Google Account connections page." This is the same link the privacy policy uses.
- **Removing a source** never touches the Google grant or the connection.
- **`invalid_grant` on refresh** covers revocation, the 7-day Testing expiry, the 6-month unused rule, the 100-token cap and password changes. The connection becomes `reconnect_required`, its sources stop, and the UI shows **Reconnect**. It is never retried automatically.
- **403/404 on one file** sets that source to `access_lost`; other sources continue.

---

## 5. Data model (new migration; no existing table is altered)

**Migration file:** `supabase/migrations/<timestamp>_google_sheets_import_foundation.sql`, created with `supabase migration new`. Per invariant #35 it is renamed to the recorded version after apply.

**The cron schedule is a separate file** in `supabase/migrations/pending/<timestamp>_google_sheets_sync_schedule.sql`. It stays outside the CLI glob until activation is approved.

### 5.1 `public.google_sheets_connections`

| Column | Notes |
|---|---|
| `id` | |
| `organization_id` | NOT NULL; FK organizations, on delete cascade |
| `user_id` | NOT NULL; FK profiles, on delete cascade |
| `google_sub` | NOT NULL |
| `google_email` | |
| `granted_scopes` | `text[]` |
| `status` | CHECK `connected` / `reconnect_required` / `disconnected` |
| `last_error_code` | |
| `connected_at`, `updated_at` | |

- `UNIQUE (organization_id, user_id)`.
- **No** uniqueness on `google_sub` across users. Two agents may legitimately use the same Google account. This avoids the Gmail `(provider, email)` trap.
- RLS SELECT: `user_id = auth.uid() AND organization_id = get_org_id()`. There are no client INSERT, UPDATE or DELETE policies.
- Column grants exclude nothing secret, because no secret is stored in this table.

### 5.2 `private.google_sheets_oauth_states` (service role only)

Columns:
- `state_hash` (PK, bytea), `user_id`, `organization_id`;
- `code_verifier_enc` (bytea), `return_origin`, `return_key`;
- `expires_at`, `consumed_at`, `created_at`.

Tables in `private` have no grants to anon or authenticated, and RLS is enabled with no policies.

### 5.3 `public.google_sheets_sources`

**Identity and ownership**
- `id`, `organization_id`, `user_id`, `connection_id` (FK, cascade)
- `spreadsheet_id` (text), `sheet_id` (bigint, the numeric gid)

**Last-seen names**
- `spreadsheet_name`, `sheet_title` (refreshed each sync), `display_name`

**Mapping and identity mode**
- `mapping` (jsonb, versioned `{v:1, columns:[{header, target}], full_name, defaults:{lead_source, status}, custom:[{header, custom_field_id}]}`)
- `identity_mode` CHECK `source_id` / `append_only`; `id_header`
- `header_snapshot` (jsonb, the normalised headers at save time)

**Progress**
- `watermark_row` (int, the last processed 1-based sheet row; for `append_only` and for initial-import progress)
- `initial_total_rows`

**State**
- `enabled` (bool)
- `status` CHECK `draft` / `importing` / `active` / `paused` / `needs_review` / `access_lost` / `reconnect_required` / `error`
- `review_reason`

**Scheduling and lease**
- `next_sync_at`, `lease_owner` (uuid), `lease_expires_at`, `consecutive_failures`

**Results**
- `last_sync_started_at`, `last_success_at`
- `last_result` (jsonb `{imported, flagged, skipped, errors, at}`)
- `last_error_code`, `last_error_message` (sanitised, at most 200 characters)

**Timestamps:** `created_at`, `updated_at`

**Constraints and access**
- `UNIQUE (organization_id, user_id, spreadsheet_id, sheet_id)`. This prevents duplicate configuration of the same spreadsheet and tab for an agent. Adding a different source never overwrites an existing one, because each insert gets a new row.
- RLS SELECT is own-only (as in §5.1). All writes go through Edge, which re-checks owner and org in every statement.

### 5.4 `private.google_sheets_row_receipts` (service role only; durable)

Columns:
- `id`, `organization_id`, `user_id`, `spreadsheet_id`, `sheet_id`, `row_key` (text)
- `identity_mode`, `source_id` (uuid, nullable, **no FK**, lineage only)
- `outcome` CHECK `imported` / `imported_flagged` / `skipped_duplicate` / `invalid`
- `lead_id` (uuid, nullable, **no FK**)
- `row_number` (at processing), `row_fingerprint` (bytea, SHA-256 of the normalised mapped values)
- `created_at`, `updated_at`

Key: `UNIQUE (organization_id, user_id, spreadsheet_id, sheet_id, row_key)`.

**Durability.** The natural key carries no FK to the source or the lead, so receipts survive:
- source removal, then re-adding the same tab (no replay);
- deletion of the CRM lead;
- lead→client conversion (`clients.lead_id` lineage is unaffected);
- reconnects.

`invalid` receipts are updatable. The row is retried only when its fingerprint changes, for example when the agent fixes a missing phone in the sheet.

### 5.5 `public.google_sheets_sync_runs` (results history; own-only SELECT)

Columns:
- `id`, `organization_id`, `user_id`, `source_id` (FK, cascade)
- `trigger` (`initial` / `schedule` / `manual`)
- `started_at`, `finished_at`, `rows_read`
- `imported`, `flagged`, `skipped`, `errors`
- `error_code`, `errors_sample` (jsonb; at most 20 entries of `{row, reason}`, with no row content beyond the row number and field name)

Pruned to the newest 50 runs per source by the worker.

### 5.6 Functions (all `SET search_path`; EXECUTE revoked from PUBLIC, anon and authenticated unless stated)

| Function | Notes |
|---|---|
| `private.google_sheets_actor_ok(p_user uuid, p_org uuid) → boolean` | Service-role-only, explicit-user variant of `has_contacts_permission`. It requires all of the following, and fails closed on null or non-boolean values (`coalesce(...,false)`):<ul><li>the profile exists with `organization_id = p_org` and `status = 'Active'`;</li><li>the organization's `status` is not suspended or archived (exact values confirmed against live data before implementation);</li><li>the role is Admin or `is_super_admin`, or the `role_permissions` value for `contacts.leads.import_google_sheets` is true, or else `_contacts_permission_default`.</li></ul> |
| `public._contacts_permission_default` | `CREATE OR REPLACE` with the **exact live preimage plus one row**: `('contacts.leads.import_google_sheets', <agent>, <tl>)` (see D1). It stays IMMUTABLE with the same signature and ACL. The preimage MD5 is checked in the migration and fails otherwise. |
| `private.google_sheets_consume_state(p_hash bytea)` | Atomic single-use consume. |
| `private.google_sheets_claim_sources(p_worker uuid, p_limit int, p_source uuid default null)` | `FOR UPDATE SKIP LOCKED`; 3-minute lease. Selects enabled sources in `importing` or `active` with `next_sync_at <= now()` and a free or expired lease. A non-null `p_source` claims exactly that source, for Sync now. |
| `private.google_sheets_ingest_batch(p_source uuid, p_lease uuid, p_rows jsonb, p_new_watermark int)` | The atomic writer; see §6.4. |
| `private.google_sheets_finish_run(...)` | Writes the run row, `last_result`, status, `next_sync_at` and backoff; releases the lease. |
| Vault RPCs | From §4.3. |

**Housekeeping**
- A trigger on connection DELETE removes its Vault secret.
- The organization purge path is verified during implementation. FK cascades cover the public tables; receipts and states are added to the purge function only if cascades do not reach them (a separate approved change).

---

## 6. Import engine

### 6.1 Worker and scheduling

- **Edge `google-sheets-sync-worker`** (`verify_jwt=false`). It accepts only `Authorization: Bearer <token>`, compared **in constant time** (`_shared/sms/wire.ts` `equal`) against Edge secret `GOOGLE_SHEETS_WORKER_TOKEN` (at least 32 characters). It has no service-role key in any GUC.
- **pg_cron** `google-sheets-sync-every-minute` (`* * * * *`). It uses the approved `platform-admin-notify` shape:
  - `net.http_post` with `vault.decrypted_secrets` `google_sheets_worker_token` (at least 32 characters);
  - **fires only while a source is due:** `EXISTS (select 1 from google_sheets_sources where enabled and status in ('importing','active') and next_sync_at <= now())`;
  - `timeout_milliseconds := 60000`.
- **Cadence.** Each source has its own `next_sync_at = finished + 5 min` (± 30 s jitter), so syncs run roughly every five minutes per source, spread across minutes, and any backlog drains.
- **Bounds per invocation:** at most 10 sources claimed and a 45 s wall-clock budget. Per source per run: at most 500 new rows ingested, in batches of 50. Initial imports continue on the next tick (status `importing` with progress) until done.
- **Sheet size cap:** at most 10,000 data rows per tab in V1. A larger tab gets `needs_review` "too large".
- **Kill switches:**
  - Edge env `GOOGLE_SHEETS_ENABLED`; when unset, the worker returns 200 with no work.
  - Frontend `VITE_GOOGLE_SHEETS_ENABLED`.
  - The pending cron migration.
- **Sync now** (`google-sheets-api {action:"sync_now"}`) checks the JWT, ownership and permission. It then claims **that one source** with a lease and runs the same engine inline. If the lease is held, it returns "Sync in progress". It has a 30 s per-source cooldown.
- **Works offline.** No browser polling and no stored AgentFlow session tokens. Ownership is re-validated server-side on every run with `google_sheets_actor_ok`.

### 6.2 Reading a sheet

1. Call `spreadsheets.get` with `fields=sheets.properties(sheetId,title,gridProperties)`. Resolve the **stored numeric `sheet_id` → current title**, which survives tab renames. A missing `sheet_id` gives `needs_review` "Tab was deleted".
2. Call `values.get` on `'<escaped title>'!1:1` for the header, then on bounded row windows such as `'<title>'!A{start}:{lastCol}{end}`, with:
   - `valueRenderOption=FORMATTED_VALUE`, so phones are not turned into floats;
   - `dateTimeRenderOption=FORMATTED_STRING`.
3. Quota: each sync is about 2–3 reads. The quota is 300 reads/min per project and 60/min per user, which allows roughly 500 sources at a 5-minute cadence before batching.
4. **Errors:**
   - 429/5xx/timeout: truncated exponential backoff (1, 2, 5, 15, 30, 60 min), with `consecutive_failures` and status kept.
   - 401: one token refresh, then `reconnect_required`.
   - 403/404: `access_lost`.

### 6.3 Source-row identity (explicit)

**Mode A — `source_id` (preferred).**
- The agent maps a **Source Lead ID** column. It is auto-suggested from headers such as `lead id`, `leadid`, `id`, `source id`, `leadgen id`, `facebook lead id`, `record id`, using exact normalised matching only.
- **`row_key = 'id:' + trim(value)`**, case-sensitive.
- **Effects:**
  - Sorting, inserting, deleting or moving rows cannot cause replay or loss, because identity does not depend on position.
  - Every sync scans the whole tab (capped) and processes only IDs without a receipt.
  - Editing an already-imported row does nothing in V1.
  - A blank ID gives a row error ("Missing Lead ID"), retried when filled.
  - Repeated IDs inside the sheet: the first is processed and later ones count as skipped.
  - A row whose ID was imported and is later deleted from the sheet: no effect; the lead remains.

**Mode B — `append_only` (no stable ID).** Documented as the V1 fallback, bounded and fail-closed.
- **`row_key = 'row:' + sheet row number`.** Each receipt stores the `row_fingerprint`.
- `watermark_row` is the last processed row. A sync processes only rows `> watermark_row`, up to the bounds.
- **Structural-change detection,** run before importing anything each sync:
  - (a) re-read the last **min(25, watermark)** processed rows and compare their fingerprints with the receipts;
  - (b) check that the current last data row is not below `watermark_row`;
  - (c) check that no candidate new row's fingerprint equals an existing receipt fingerprint for this tab (rows moved down by a sort or insert);
  - (d) check that the header still resolves (§6.5).
- **Any mismatch** sets the source to **`needs_review`** with a reason ("Rows above the last import changed or moved"), and **nothing is imported**. Nothing is silently replayed or lost.
- **Review choices** (Edit mapping):
  - (1) choose a Source Lead ID column and switch to Mode A, which is recommended. Existing `row:` receipts remain. Mode A treats a row as already imported when its fingerprint matches a `row:` receipt for this tab; the preview shows this mapping before Start.
  - (2) "Continue from current end": the preview lists the exact rows that will be skipped, the agent confirms, and the watermark moves to the current last row.
- **Rows edited below the watermark** but outside the 25-row check window are not detected. This is the documented V1 limitation of append-only mode. The UI recommends a Lead ID column when Mode B is chosen.

### 6.4 Atomic ingest (`private.google_sheets_ingest_batch`)

Runs inside one call. It first verifies:
- the lease matches `p_lease` and is unexpired;
- the source is `enabled` with a matching owner and org;
- `google_sheets_actor_ok(owner, org)` passes.

On failure it raises, and nothing is written. It **loads the duplicate settings from `contact_management_settings` on the server**: `duplicate_detection_rule`, `duplicate_detection_scope` and `csv_action`, with the same defaults as `supabase-settings.ts` (`phone_or_email`, `all_agents`, `flag`).

**For each row, inside a `BEGIN … EXCEPTION` block** (subtransaction):
1. `INSERT receipt … ON CONFLICT DO NOTHING RETURNING id`. If there is a conflict on a non-`invalid` receipt, the row was already processed: count nothing and continue. **This makes overlapping or repeated syncs idempotent.**
2. Rows that failed Edge validation arrive with `invalid` and a reason. They store or update an `invalid` receipt with the fingerprint, and count as errors only when the fingerprint is new.
3. **Duplicate check:** an exact port of `import-contacts` `rowsMatch` / scope / action semantics into SQL.
   - Phone: `regexp_replace(phone,'\D','','g')`, prefiltered with the existing `(organization_id, phone_last10(phone))` index.
   - Email: `lower(btrim(email))`.
   - `assigned_only` compares against rows whose `assigned_agent_id` is the connection owner. That is exactly the `import-contacts` behaviour for a `self` assignment.
   - Rows inserted earlier in the same run count as existing. This is a natural consequence of row-by-row processing; `import-contacts` lacks within-batch dedupe.
   - **No global uniqueness rule is added, and existing matches are never reassigned or updated.**
4. **Apply the action:**
   - `skip`: receipt `skipped_duplicate`, no lead.
   - `flag`: insert with `custom_fields.__agentflow.duplicateImport = true` and `"Duplicate"` appended to `custom_fields.tags` (the same as `import-contacts`), receipt `imported_flagged`.
   - `import`: insert with no marker, receipt `imported`.
5. **Lead insert columns** (identical to `import-contacts`):
   - `first_name`, `last_name`, `phone` (raw), `email` (raw), `state` (`normalize_us_state`), `notes`, `age` (int or null), `date_of_birth` (ISO), `best_time_to_call`;
   - `status` (from the source default; pipeline-stage name, default `New`);
   - `lead_source` (mapped column, else the source default; see D4); `lead_score` 5;
   - `custom_fields` (canonical-name keys), `organization_id` = org;
   - **`assigned_agent_id = user_id = imported_by_user_id = connection owner`.**
   - The `tr_sync_leads_user_id` and RLS contracts are preserved. The self-import rule suppresses the assignment notification, and contact history records action `imported` with actor `system`.
6. Set the receipt's `lead_id` in the **same subtransaction**. If the lead insert fails, the receipt rolls back with it, the row counts as an error, and it is retried next sync. **There is never a receipt without its lead, or a lead without its receipt.**
7. After the loop, update `watermark_row` (Mode B or initial progress) **in the same transaction** as the receipts.

A crash or timeout between batches leaves a consistent state. A new lease holder resumes, and the receipts block replay.

### 6.5 Validation, mapping and headers (Edge, shared TypeScript)

**Port, without importing app code into Deno, and pin by parity tests against fixtures from the app modules:**
- the core contract: blank first name, last name or phone digits means invalid (`import-contacts` `:192-206`);
- Full Name split (first token / rest; raw value kept in `custom_fields["Full Name"]`);
- `normalizeUsState`; age coercion;
- DOB parse (`parseDOBForImport` semantics; an invalid DOB is a row error, as in CSV);
- `import-field-matching` normalisation for header auto-detection. This lives in the frontend; the server re-resolves only by exact normalised header.

**Agency `required_fields_lead`** is not enforced in V1. That matches the server contract and the instruction; see D8.

**Custom fields.** The mapping stores `custom_field_id`. Each run resolves it to the **representative canonical name** with the logical-field rules:
- active;
- `applies_to` includes `Leads`;
- agency-wide or owned by the connection owner.

If a field is no longer resolvable, the source goes to `needs_review` (fail closed, invariant #33). No field is ever created, and `additional_policies` is reserved and rejected.

**Header changes**
- Mapped columns are resolved by normalised header **name** each sync, so moving columns is harmless and new unmapped columns are ignored.
- A missing or duplicated mapped header, or a missing ID column, gives **`needs_review` with nothing imported**. Edit mapping shows the current headers, and the preserved mapping is pre-filled.

### 6.6 DNC, STOP and consent

- The worker never reads or writes `dnc_list`, `sms_suppressions`, `sms_enrollments` or any consent record, and never creates consent.
- An imported number already on DNC is inserted exactly as CSV imports do. It stays undialable, because the queue and outbound admission enforce `is_dnc_phone`, and SMS gates remain.
- Optional addition, not recommended for V1: count DNC matches in results.

### 6.7 Workflow and side effects (inspected; unchanged)

- Each inserted lead fires `trg_workflow_lead_created`, which dispatches `lead_created` with `{source: lead_source}` to the org's active `lead_created` workflows. This is **the same as CSV import today.**
- A 2,000-row initial import can therefore start up to 2,000 workflow executions, some of which may send SMS. The SMS consent gates still apply. See D6.
- `notify_lead_assignments` is silent, because owner = `imported_by_user_id`.
- `contact_history_capture` records one `imported` event per lead.
- No workflow, trigger or notification code is changed.

---

## 7. Edge functions (all new; no existing deployed function is modified)

| Function | Auth | Purpose |
|---|---|---|
| `google-sheets-oauth-start` | JWT in code | Create state and PKCE; return the Google URL. |
| `google-sheets-oauth-callback` | none (Google redirect) | Atomic state consume, code exchange, identity/scope verification, Vault store, safe redirect. |
| `google-sheets-api` | JWT in code | Actions: `status`, `picker_token`, `inspect` (file access + tabs), `preview`, `save_source` (create/update mapping; draft), `start`, `sync_now`, `pause`, `resume`, `remove`, `disconnect`. Every action re-derives user and org from the JWT and profile and checks ownership with `.eq("user_id").eq("organization_id")`. |
| `google-sheets-sync-worker` | Bearer worker token (constant time) | Scheduled ingestion. |

**Common to all four**
- `verify_jwt = false` in `supabase/config.toml`, per invariant #2 (validation happens in code).
- CORS is limited to the allowed origins for the JSON functions. The callback and worker need no CORS.

**Shared modules** under `supabase/functions/_shared/googleSheets/`:
- `config.ts` (env, kill switch, allowed origins);
- `oauth.ts` (PKCE, auth URL, exchange, id_token checks);
- `tokens.ts` (Vault RPC wrappers, refresh, `invalid_grant` classification);
- `sheetsClient.ts` (Drive/Sheets calls, gid resolution, backoff classification);
- `mapping.ts` (validation, normalisation, Full Name, DOB, state, age);
- `identity.ts` (row keys, fingerprints, structural-change detection);
- `engine.ts` (claim → read → validate → ingest → finish);
- `errors.ts` (sanitizer).

Each has a Deno test.

---

## 8. Frontend files

| File | Change |
|---|---|
| `src/config/settingsConfig.ts` | Add `{slug:"google-sheets", label:"Google Sheets", icon: Sheet}` to "Automation & API" after `email-settings`. |
| `src/components/settings/SettingsRenderer.tsx` | Import and `case "google-sheets"`. |
| `src/config/permissionDefaults.ts` | Add `contacts.leads.import_google_sheets` to `CONTACTS_PERMISSIONS`, with the label "Import leads from own Google Sheets" and defaults per D1. The settings-section default for `google-sheets` follows D1 too, so the section is hidden from roles without the capability. |
| `src/components/settings/google-sheets/GoogleSheetsSettings.tsx` | Container: View As notice, feature flag, permission gate, identity reset. |
| `.../GoogleConnectionCard.tsx` | Connect, reconnect, disconnect; OAuth return handling; server re-read. |
| `.../SheetSourceList.tsx`, `.../SheetSourceRow.tsx` | Rows, results and actions; Remove confirmation (AlertDialog). |
| `.../AddSheetDialog.tsx` | Step shell and draft state. |
| `.../SheetTabStep.tsx`, `.../SheetMappingStep.tsx`, `.../SheetPreviewStep.tsx` | Steps. |
| `src/lib/google-sheets/api.ts` | Typed `invokeAuthedFunction` wrappers and response types. |
| `src/lib/google-sheets/schema.ts` | Zod: mapping draft, source form, API responses. |
| `src/lib/google-sheets/picker.ts` | On-demand script load and Picker build; token in memory only. |
| `src/hooks/useGoogleSheets.ts` | React Query with identity-scoped keys, generation guards, invalidation after mutations. |

**Constraints**
- Each component stays under 200 lines.
- Tailwind with existing shadcn primitives.
- No mock data.
- New env vars:
  - `VITE_GOOGLE_PICKER_API_KEY` (public, restricted);
  - `VITE_GOOGLE_CLOUD_PROJECT_NUMBER=87346168200`;
  - `VITE_GOOGLE_SHEETS_ENABLED`.
- No secret is ever in the frontend.

---

## 9. Secrets and configuration (exact names; values set by Chris, never committed)

| Name | Where | Value |
|---|---|---|
| `GOOGLE_SHEETS_CLIENT_ID` | Edge secret | the new "AgentFlow Sheets" client ID |
| `GOOGLE_SHEETS_CLIENT_SECRET` | Edge secret | its secret |
| `GOOGLE_SHEETS_REDIRECT_URI` | Edge secret | `https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-sheets-oauth-callback` |
| `GOOGLE_SHEETS_ALLOWED_RETURN_ORIGINS` | Edge secret | `https://www.fflagent.com,https://fflagent.com` |
| `GOOGLE_SHEETS_STATE_KEY` | Edge secret | 32+ random bytes (PKCE verifier encryption) |
| `GOOGLE_SHEETS_WORKER_TOKEN` | Edge secret | 32+ random characters |
| `google_sheets_worker_token` | Vault | the same value as above |
| `GOOGLE_SHEETS_ENABLED` | Edge secret | `true` at activation |
| `VITE_GOOGLE_PICKER_API_KEY`, `VITE_GOOGLE_CLOUD_PROJECT_NUMBER`, `VITE_GOOGLE_SHEETS_ENABLED` | Vercel env (Production, and Preview if piloting) | |

---

## 10. Exact files intended

**New**
- `supabase/migrations/<ts>_google_sheets_import_foundation.sql`
- `supabase/migrations/pending/<ts>_google_sheets_sync_schedule.sql`
- `supabase/functions/google-sheets-oauth-start/index.ts`
- `supabase/functions/google-sheets-oauth-callback/index.ts`
- `supabase/functions/google-sheets-api/index.ts`
- `supabase/functions/google-sheets-sync-worker/index.ts`
- `supabase/functions/_shared/googleSheets/{config,oauth,tokens,sheetsClient,mapping,identity,engine,errors}.ts`, each with a `*.test.ts`
- `supabase/tests/google_sheets_import.sql` and `scripts/run_google_sheets_tests.sh` (native PostgreSQL, following the existing `run_*_tests.sh` pattern)
- the frontend files in §8, plus tests under `src/**/__tests__` / `*.test.ts(x)`:
  - mapping schema and auto-detect;
  - draft preserved on failed save;
  - identity reset;
  - View As notice;
  - Picker token never persisted

**Modified**
- `src/config/settingsConfig.ts`, `src/components/settings/SettingsRenderer.tsx`, `src/config/permissionDefaults.ts`
- `src/components/settings/Permissions.tsx`, only if the contacts permission catalog is not rendered from `CONTACTS_PERMISSIONS` automatically (checked first)
- `supabase/config.toml` (four new `[functions.*]` blocks)
- the existing contacts-permission parity test, so the SQL and TypeScript defaults stay pinned equal
- `src/integrations/supabase/types.ts`, only if the repo's convention requires it for the new tables
- docs: this plan, the root `implementation_plan.md` status line, WORK_LOG.md (after implementation), and AGENT_RULES.md (a new "Google Sheets import invariant" in the same commit as the code)
- `src/content/legal.ts`: **only after separate exact-copy approval** (G7)

**Not touched:** `import-contacts`, every Gmail and Calendar function and table, `_shared/google-token.ts`, workflows, DNC, SMS and the dialer.

---

## 11. Proposed privacy addition (for approval; not applied)

> **Google Sheets information.** If you connect Google Sheets, AgentFlow requests your Google account identity and email address and access only to the specific spreadsheets you select in Google's file picker. AgentFlow reads the rows of the tab you choose and imports them as leads assigned to you in your agency workspace, checking for new rows in the background about every five minutes until you pause or remove the sheet. AgentFlow does not modify your spreadsheets. Imported leads remain after you remove a sheet or disconnect. Disconnecting removes AgentFlow's saved Sheets authorization; to revoke Google's authorization entirely, use your Google Account's third-party connections page.

---

## 12. Decisions for Chris

| # | Decision | Recommendation |
|---|---|---|
| D1 | Defaults for the new capability `contacts.leads.import_google_sheets` (Admin and Super Admin always allowed) | **Agent = false, Team Leader = true**, mirroring `contacts.leads.import`. Admins enable it for Agents in Permissions. Your org currently has Agent CSV import = true, but that does not grant this key. The Settings section is shown only to roles with the capability. |
| D2 | OAuth client | **New dedicated "AgentFlow Sheets" Web client** in project 87346168200. Never call `revoke` from Sheets. |
| D3 | Refresh-token storage | **Vault** (existing pattern). The alternative is AES-256-GCM in Edge. |
| D4 | Default Lead Source when no column is mapped | A per-source dropdown from the agency's lead sources, defaulting to **"Google Sheets"**. |
| D5 | Default Status | The agency's default lead pipeline stage (as CSV does), else `New`. |
| D6 | Initial import fires `lead_created` workflows per row | **Keep CSV parity.** The preview shows a one-line warning when the org has active `lead_created` workflows. |
| D7 | Write `import_history` rows? | **No** in V1. Results live in `google_sheets_sync_runs`, which avoids Undo interacting with receipts. |
| D8 | Enforce agency `required_fields_lead`? | **No.** Core first name, last name and phone only, matching the current server contract. |
| D9 | Bounds | 10,000 rows per tab; 500 new rows per source per run; 10 sources per worker tick; a 5-minute per-source interval. |
| D10 | Google publishing status | Pilot in Testing with test users (7-day reconnect). Moving to In production is your decision together with the Gmail verification track. |
| D11 | Append-only fallback allowed, or require a Lead ID column? | **Allow it,** with the fail-closed detection in §6.3, and recommend a Lead ID column in the UI. |

---

## 13. Verification plan

**Local and CI**
- Native PostgreSQL SQL suite, using the repo pattern and production-equivalent ACLs (`role_permissions`, `profiles`, leads triggers stubbed only where pg_net is absent). It covers:
  1. two agents and two orgs isolated in every table, for SELECT and denied writes as `authenticated`;
  2. receipts unique; repeated and **concurrent** `ingest_batch` calls in two sessions import each row once;
  3. a lease contention test using `SKIP LOCKED`;
  4. duplicate rule × scope × action parity matrix (16 cases) against fixtures taken from `import-contacts` behaviour;
  5. a failed lead insert rolls back its receipt;
  6. receipts survive lead deletion, conversion and source removal, with no replay after re-adding;
  7. pause and remove stop claims, and existing leads remain;
  8. a revoked permission or inactive profile blocks ingest;
  9. `_contacts_permission_default` preimage and new-key parity;
  10. the DNC table is untouched.
- Deno tests:
  - state atomic consume and expiry;
  - PKCE;
  - id_token claim checks;
  - a scope subset check that fails closed;
  - allowed origins;
  - picker-token refusal on extra scopes;
  - `invalid_grant` → `reconnect_required`;
  - 429 backoff;
  - header change → `needs_review`;
  - Mode A sort/edit safety;
  - Mode B sort/insert/delete detection;
  - invalid-row fingerprint retry;
  - sanitizer redaction.
- Vitest:
  - draft preserved on failed save;
  - identity change clears state and discards late responses;
  - View As renders the notice with no queries;
  - the Picker token is never in storage or the query cache;
  - duplicate tab disabled;
  - permission gating.
- Commands:
  - `npx tsc --noEmit`;
  - `npx tsc -p tsconfig.app.json --noEmit`, compared with the 85-diagnostic baseline (zero new);
  - changed-file ESLint;
  - focused test runs;
  - `npm run build`;
  - Deno check of the four functions.

**Hosted** (after the approved deploys, using Chris's test Google account and synthetic spreadsheets with obviously fake names and 555 numbers):
1. One agent adds two spreadsheets and syncs each independently.
2. A second test agent cannot see the first agent's sources.
3. Repeated Sync now creates no reimports.
4. A duplicate row follows the org policy (flag).
5. Pause stops ingestion, and Remove leaves the leads.
6. Renaming the header gives `needs_review`, and Edit mapping recovers.
7. Sorting the sheet causes no replay in Mode A, and `needs_review` in Mode B.
8. A failed save keeps the draft.
9. Removing access, or the Testing expiry, gives Reconnect.
10. Gmail and Calendar status are unchanged before and after (read-only status checks), and View As still withholds Settings.

Test leads are deleted afterwards only with separate approval (invariant #28).

---

## 14. Release sequence (each step separately approved)

1. Plan approval, including the D1–D11 answers.
2. Implementation and local verification on `claude/keen-brown-e4u3ht`; push; draft PR on request.
3. Google Cloud G1–G4 (Chris).
4. Edge secrets and the Vault secret (Chris, or by approved MCP action; values never echoed).
5. Apply the foundation migration (exact SQL shown first). Rename the file to the recorded version per #35.
6. Deploy the four new Edge functions (`verify_jwt=false`, exactly as in config.toml), with `GOOGLE_SHEETS_ENABLED` unset.
7. Frontend merge with `VITE_GOOGLE_SHEETS_ENABLED` off. Confirm GitHub "Deploy to production" is still OFF before merge.
8. Pilot activation: enable the flags, move the pending cron migration in and apply it, then run the hosted verification.
9. Privacy copy publication (G7) before any non-test user connects. Publishing status decision (G5/G6).
10. WORK_LOG, AGENT_RULES invariant, and the root plan status.

**Rollback:** unset `GOOGLE_SHEETS_ENABLED` (the worker and API go inert) → `cron.unschedule('google-sheets-sync-every-minute')` → hide the section with the Vercel flag. Tables and receipts stay in place; nothing in existing features depends on them.
