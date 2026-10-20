# Phase 2A — verification record

**Scope:** Gate 2 plus the approved correction pass (plan §12) on branch `claude/friendly-ptolemy-pvpmfj`, draft PR
#469 against `main` `84ba4f6`. Sections 1–12 used synthetic data only and touched nothing in production. §13 records
the separately approved Gate 3 database release (2026-10-19): the migration only, applied once and recorded as
`20261019170000`; no merge, deployment, Vercel change or production test write. §14 records the approved local
implementation of the §13/§13.7 amendment; §15 records its separately approved Gate 3b database release (2026-10-20):
`20261020040000` only, applied once; no merge, deployment, preview-access change or production test write.
Authenticated end-to-end acceptance in an authorized environment is still outstanding.

Estimates are illustrative and receipts are manually recorded; nothing here verifies either against a carrier.

## 1. Environments

| Item | Version |
|---|---|
| CI database (`policy-commission-tracking.yml`, GitHub-hosted runner, loopback service container) | PostgreSQL 17.6 (Debian 17.6-2.pgdg13+1) |
| Local disposable cluster (loopback, trust auth, `/tmp`) | PostgreSQL 16.15 |
| PostgREST (binary checked against the workflow's pinned sha256) | 12.2.3 |
| `@supabase/supabase-js` | 2.98.0 |
| Type generator (disposable migrated schema) | `@supabase/postgres-meta` 0.100.0 |
| Browser | Playwright 1.56.1 Chromium |

Every workflow on the PR runs on GitHub-hosted runners against loopback databases built from synthetic fixtures; none
references secrets or runs `supabase db push`/`link`/`functions deploy`. The Supabase Preview check reported "skipped". Vercel built a preview deployment of the frontend only.

## 2. Database proofs — `scripts/run_policy_commission_tests.sh`

PostgreSQL 17.6 in CI (run `39315398293`, head `b599c96`) and PostgreSQL 16.15 locally, final migration, both exit 0:

```
PostgreSQL: 17.6 (Debian 17.6-2.pgdg13+1)
PASS migration guards and existing-object inventory (175 objects unchanged)
 PASS policy commission security
 PASS policy commission handoff
 PASS policy commission tracking
PASS independent-session races and lock contention
PASS existing sale recording, identity, performance, Sold Date and repair suites with the migration applied
 PASS policy commission security
PASS non-destructive rollback, refusal, replay refusal and reapply
PASS PostgREST integration (12 checks)
PASS policy commission tracking database proofs
```

(Local 16.15 inventories 173 existing objects; the counts differ by server version, each run compares its own
before/after.) Covered: preimage refusal of a drifted writer with no residue, replay refusal, ACL/ownership inventory,
writer role attributes and membership, writer subject to RLS, no client table writes, Own/Others matrix and parity with
`permission_defaults.json`, server-proven binding for all four companions (including the D7 receipt), byte-identical
replay, PT409 only for the writers' committed-operation conflicts, explicit empty payload, commission failure never
failing a sale, 57014 not swallowed, 100-slot cap, budget exhaustion, independent-session races, lock contention,
payments/overpayment/voids/replacements/timing/holds and their audit events, the retention guard, rollback refusal with
rows, rollback and reapply, and (this pass) the capture lifecycle in §5.3.

## 3. Real PostgREST + supabase-js

All 12 checks pass on PostgreSQL 17.6 and 16.15: anon refused (401/42501); service_role cannot call a companion or read
commission rows; companion saves the sale and records the estimate; byte-identical replay; committed-operation conflict
is HTTP 409 PT409; other writer errors unchanged; legacy writer unchanged; no direct table writes and private helpers
not exposed; contact read scoped to the seller; receipts, voids and stale revisions over HTTP; operation status read;
conversion with additional rows and a conversion conflict.

## 4. Save overhead (PostgreSQL 17.6)

Server time per save inside PostgreSQL (`clock_timestamp()`), each sample on a fresh request and lead in one warm
session. Overhead = companion percentile minus the matching unchanged writer's. Contention cases hold a lock from a
second session while a warmed session saves; autovacuum is settled first. **Measured maxima are observations, not
guarantees.** The two runs below use identical code on different GitHub-hosted runners; the final-head runner was
about 1.4× slower, which is runner variance, not a code change.

**Final head `fc05082` (the Gate 3 source commit; CI job `118281521488`):**

| Case | Samples | Total p50 / p95 / max (ms) | Writer p50 / p95 | Overhead p50 / p95 | Outcome |
|---|---|---|---|---|---|
| Create, explicit empty payload | 30 | 1.09 / 1.23 / 1.29 | 0.35 / 0.42 | +0.74 / +0.81 | sale saved |
| Create, 1 estimate | 30 | 3.34 / 4.59 / 4.63 | 0.35 / 0.42 | +2.99 / +4.17 | 1/1 recorded |
| Create, commission step fails | 30 | 1.03 / 1.10 / 1.15 | 0.35 / 0.42 | +0.68 / +0.68 | sale saved, `not_recorded` |
| Convert, 1 policy | 30 | 6.71 / 6.91 / 6.94 | 3.37 / 3.56 | +3.34 / +3.35 | 1/1 recorded |
| Convert, 5 policies | 30 | 12.38 / 13.40 / 13.64 | 3.95 / 4.13 | +8.44 / +9.26 | 5/5 recorded |
| Convert, 25 policies (benchmark) | 30 | 41.99 / 49.94 / 55.79 | 6.28 / 6.75 | +35.72 / +43.19 | 25/25 recorded |
| Convert, 100 policies (defensive cap) | 20 | 182.60 / 197.16 / 198.69 | 17.25 / 18.18 | +165.35 / +178.98 | 100/100 recorded |
| Create, commission tables locked | 10 | 103.60 / 103.71 / 103.77 | 0.35 / 0.42 | +103.25 / +103.30 | sale saved, `not_recorded` after `lock_timeout` |
| Create, grid row locked | 10 | 8.22 / 8.33 / 8.40 | 0.35 / 0.42 | +7.87 / +7.91 | 1/1 recorded (not blocked) |

HTTP through PostgREST at `fc05082` (median of 15, warm, sequential): create 1 policy 2.1 → 5.4 ms (+3.3); convert 1
policy 2.5 → 6.0 (+3.6); 5 policies 3.5 → 12.6 (+9.1); 25 policies 8.1 → 43.1 (+35.0).

**Earlier run, head `b599c96` (CI run `39315398293`; code identical to `fc05082`):**

| Case | Samples | Total p50 / p95 / max (ms) | Writer p50 / p95 | Overhead p50 / p95 | Outcome |
|---|---|---|---|---|---|
| Create, explicit empty payload | 30 | 0.81 / 0.96 / 0.99 | 0.27 / 0.34 | +0.54 / +0.62 | sale saved |
| Create, 1 estimate | 30 | 2.51 / 3.67 / 3.70 | 0.27 / 0.34 | +2.25 / +3.34 | 1/1 recorded |
| Create, commission step fails | 30 | 0.82 / 0.89 / 0.94 | 0.27 / 0.34 | +0.56 / +0.55 | sale saved, `not_recorded` |
| Convert, 1 policy | 30 | 4.85 / 5.08 / 5.15 | 2.42 / 2.57 | +2.43 / +2.51 | 1/1 recorded |
| Convert, 5 policies | 30 | 8.49 / 8.87 / 9.09 | 2.66 / 2.79 | +5.83 / +6.08 | 5/5 recorded |
| Convert, 25 policies (benchmark) | 30 | 29.07 / 30.23 / 30.72 | 4.35 / 4.57 | +24.72 / +25.66 | 25/25 recorded |
| Convert, 100 policies (defensive cap) | 20 | 124.75 / 136.85 / 139.86 | 11.83 / 12.09 | +112.91 / +124.76 | 100/100 recorded |
| Create, commission tables locked | 10 | 103.33 / 103.39 / 103.39 | 0.27 / 0.34 | +103.06 / +103.05 | sale saved, `not_recorded` after `lock_timeout` |
| Create, grid row locked | 10 | 6.95 / 7.17 / 7.18 | 0.27 / 0.34 | +6.69 / +6.83 | 1/1 recorded (not blocked) |

HTTP through PostgREST at `b599c96` (median of 15, warm, sequential): create 1 policy 2.1 → 4.9 ms (+2.7); convert 1
policy 2.2 → 5.0 (+2.8); 5 policies 2.6 → 8.6 (+6.0); 25 policies 5.9 → 29.7 (+23.9).

**Budget and cap.** 250 ms is a *soft calculation-start budget*: a slot's calculation only starts before 250 ms have
elapsed; validation, evidence, capture inserts, the slot in progress and result building are not cut off, so it is not
an end-to-end guarantee. The 100-slot cap is defensive; policy entry is not limited and an over-cap payload fails the
commission step as a whole with a visible notice. 25 policies is a benchmark, not a limit (none is enforced anywhere).

**The same script locally (PostgreSQL 16.15, slower shared container):** 1 policy +4.69 / +5.00; 5 policies
+14.35 / +16.37; 25 policies +56.27 / +70.06; 100 policies 269.72 / 390.51 / 392.81 total (+250.05 / +365.22), still
100/100 recorded; tables locked 106.11 p50; empty payload +1.33; failure +1.13. On that container the slowest 100-policy
saves reached about 0.4 s and the budget never tripped. A first local contention run measured the grid-lock case at
~89 ms p50 because autovacuum was working through the bulk-inserted rows; with autovacuum settled it is ~12 ms (local)
and 6.95 ms (17.6), and a grid row lock never blocks capture. No timeout was raised.

## 5. Correction evidence

### 5.1 Unknown tracking outcomes survive dismissal and remount

- **Regression** (`RecordPaymentDialog.test.tsx`): a receipt commits on a fake server but its response is lost; the
  dialog is cancelled, closed and unmounted; the reopened dialog shows the submitted payment locked with Retry; the
  retry sends the identical arguments with the same `p_request_id`; the server holds **one** receipt.
- **Hook** (`useClientPolicyCommissions.test.tsx`): restart refuses while unresolved; a different callback is never sent
  (the stored call is replayed); after an unknown outcome a 42501 permission error and a `PGRST301` expired-JWT error
  keep it unresolved with the same id until a success; a PT409 refusal of that same request proves nothing was saved
  and frees the inputs with a new id; a response arriving after the signed-in user changed is ignored and nothing is
  kept for the new user; switching users drops unresolved writes from memory.
- **Every helper user** (`trackingRecovery.test.tsx`): void (submitted reason restored and locked), timing, hold,
  schedule start (inline control remounted), record estimate (submitted figures shown, picker hidden), capture confirm
  and dismiss: each resends exactly the same call and id after close and remount.
- **Server basis:** every tracking function takes the request-scoped advisory lock and returns the stored result before
  any other check, so a retry with the same id and payload either returns the committed result or proves nothing was
  committed. No browser storage is used.

### 5.2 Installment selection

Tests and the browser check: Month 11 suggests $110.00; a fully received advance suggests nothing; a partially received
Month 10 suggests its $60.00 remaining; an edited amount is cleared (with a visible note) when the installment changes;
partial and excess amounts are still accepted. Receipt validation is a Zod schema with the previous rules and messages.

### 5.3 Capture lifecycle

`policy_commission_tracking.sql`: recording an estimate later while the sale-time capture is open marks it
`superseded`, links `resolved_by_estimate_id`, keeps the original rate, first-year and advance figures and `captured_by`,
records actor, time and reason, and never sets `capture_id` on the later estimate. The contact read shows `recorded` with
no open capture; confirm and dismiss of the old capture are refused (22023); a replay of the original sale reports the
slot as `superseded`. Runner race, both orders, separate sessions: confirm first → later estimate refused, capture
`recorded`; later estimate first → confirm refused, capture `superseded` and linked; one current estimate either way.

### 5.4 Generated types

Types generated by `postgres-meta` 0.100.0 from the disposable migrated schema were compared with the hand-written
entries: same 14 functions, argument names, base types, optional (defaulted) arguments and `Json` returns; differences
were key order and hand-added `| null`. The 14 entries in `src/integrations/supabase/types.ts` now equal the generated
text byte for byte. Table types were not added (the frontend never reads the commission tables directly).

## 6. Advisors (local, splinter `main`)

New with the migration, against the same fixture without it: 13 × `authenticated_security_definer_function_executable`
(WARN; the four companions, eight tracking RPCs and the operation-status read, by design, as for the existing sale
writers; `get_client_policy_commissions` is SECURITY INVOKER) and 13 × `unused_index` (INFO, fresh database). No
unindexed foreign key (the new `resolved_by_estimate_id` key has a covering index). Production advisor deltas belong to
Gate 3.

## 7. Frontend — baseline `84ba4f6` vs branch

| Check | Result |
|---|---|
| Full Vitest, no Supabase env (as `reports-frontend` CI) | Same 10 failed files and 1 failed test as the baseline; 5,836 passed (baseline 5,738) |
| Full Vitest, inert env | Only the pre-existing `recordingRetentionVoicemail` failure; 5,925 passed |
| Phase 2A, contacts, sale and hook suites | 52 files, 499 tests pass |
| `tsc --noEmit` (root) | exit 0 |
| `tsc -p tsconfig.app.json` | output identical to the base, positions included (as `uv-profile-sync.yml` requires) |
| ESLint, changed files | 0 errors |
| `vite build` | pass; main chunk 4,502.64 kB (1,222.32 kB gzip; baseline 1,218.04) plus lazy `PolicyCommissionSection` 41.07 kB |
| `git diff --check` | clean |

TwilioContext, DialerPage, FloatingDialer and the dialer contracts are unchanged; their suites are in both full runs.

## 8. Browser checks and screenshots (`screenshots/`)

A local, uncommitted Vite harness mounts the real `ClientPolicies` (lazy `PolicyCommissionSection`), dialogs and
notices with the app theme; `AuthContext`, `useEffectiveViewer` and the Supabase client are stubbed. For the payment
check the stub is a small in-memory server that stores receipts by request id, loses the first response after
committing it, and serves the contact read from what it stored. Not the full contact page; no login.

Interactive check of the real payment controls in Chromium, 1440 px light and 390 px dark: **22/22 PASS** — suggested
amounts per installment, edited amount cleared on switch with the note, unknown outcome locks the inputs, close and
reopen keeps Month 12 / $30.00 / reference locked, the re-read history already shows the committed receipt, Retry
reuses the request id, exactly one receipt exists, no page errors.

Screenshots: `contact-commissions-*`, `record-payment-*`, `void-receipt-*` (1440/390 × light/dark) and
`payment-installment-switch-*`, `payment-unconfirmed-*`, `payment-reopened-*` (desktop light, mobile dark).

## 9. CI on the PR

Heads `b599c96` and `fc05082` (the Gate 3 source commit; code identical, later commits change documentation only):
Policy commission tracking (PostgreSQL 17.6 + PostgREST, frontend tests), Commission grids (PostgreSQL 17.6 suites,
calculator tests), UV profile sync (frontend typecheck parity, browser, paired-native), SMS consent, Reporting
integrity (frontend), Dialer DNC integrity: success on both, all 12 jobs at `fc05082`. Supabase Preview: skipped.
An earlier head failed `uv-profile-sync` because this PR moved one existing ConvertLeadModal diagnostic from line 182
to 202; fixed without behaviour change (plan §12).

## 10. Migration checksums (final files)

| File | Bytes | SHA-256 | MD5 |
|---|---|---|---|
| `supabase/migrations/20261019170000_policy_commission_tracking.sql` | 119,951 | `b3e4d53fcced800be3c8b09567ef66c2faebb21937634e3f17aa2d6228011f1f` | `689a0a41d3d3c124cb97e9640305831a` |
| `supabase/migrations/rollback/20261019170000_policy_commission_tracking.rollback.sql` | 5,232 | `928800dec6dca11a228980df79e285013a1d66758ee8680ecf639de3ec08b70e` | `b2ad91a9ad687bcaa4b419046ca131e6` |

The migration refuses unless the seven production preimages match (md5 of `pg_get_functiondef`):
`create_client_with_sale` `0fd43910…`, `convert_lead_to_client_with_sales` `3d974a5c…`, `record_client_policy`
`b9ffa1e0…`, `update_client_with_policy_sale` `96e8f6e7…`, `private.insert_policy_sale` `3f600b75…`,
`convert_lead_to_client_atomic` `641ba66c…`, `private.campaign_actor` `f582e437…`.

## 11. Remaining risks and open items

1. **Authenticated end-to-end acceptance is outstanding**: no real sign-in against a Supabase stack has exercised the
   UI; the browser evidence uses stubs and the HTTP contract is covered by PostgREST.
2. **Unresolved writes are memory-only.** A reload, a new tab or a sign-out loses the retry state; the contact read then
   shows the authoritative history (including a payment that did commit) and a new entry uses a new request id, so a
   person who re-enters a payment without looking could still duplicate it.
3. **100-slot saves** took 124.75 ms (`b599c96`) and 182.60 ms (`fc05082`) p50 on two 17.6 CI runners and up to
   ~0.4 s on a slow shared container; not a guarantee.
4. **Team Leader read access inherits the `is_ancestor_of` defect** (AGENT_RULES debt): affected Team Leaders see less,
   never more.
5. **Receipts show no recorder name** (the audit events keep the actor).
6. **Writer coupling**: the companions map the writers' exact conflict messages to PT409 and recompute their sale
   hashes; the preimage guard protects only the apply.
7. **Vercel preview** of this branch runs the new frontend against whatever backend its environment points to. Since
   Gate 3 the production database accepts the companion saves and tracking writes, so a preview connected to
   production would create real sales and commission rows. Do not use any preview for sale or commission testing.

## 12. Database-only release package (Gate 3; approved and applied 2026-10-19, see §13)

1. Final head with every check green, the draft PR still unmerged.
2. Read-only production preflight: `SHOW server_version`; the seven preimage md5s match; none of the new role, schema,
   tables or functions exists; current advisor list saved for the delta; no other pending migration.
3. Apply exactly `20261019170000_policy_commission_tracking.sql` (SHA-256 above) in one transaction with its own
   `lock_timeout 1s` / `statement_timeout 60s`, at a low-traffic time. It briefly locks `public.wins` for the
   `wins_commission_link_key` index; on a lock timeout, retry later, never raise the timeouts.
4. Read-only post-checks: stored migration matches; writer role NOLOGIN/NOBYPASSRLS with only `postgres` as a member and
   only USAGE on `public`/`private`; function owners and ACLs as inventoried; RLS on the six tables; no client table
   write grants; the seven preimages unchanged; advisor delta limited to the expected entries.
5. No production test writes unless separately approved. The rollback is ready and refuses once any row exists. The
   frontend (Gate 4) stays on the legacy writers until the merge and release are separately approved.

## 13. Gate 3 production release record (2026-10-19)

Chris approved Gate 3 only: the schema, new RLS policies, restricted writer role, grants, functions and supporting
index in the exact reviewed bytes, recorded under version `20261019170000`. Project `jncvvsvckxhqgqvkppmj`
(AGENTFLOW CRM, PostgreSQL 17.6). Source commit `fc05082b11573fbb88c50c429fd5c1867b8cfb98`; the file there and on
disk has SHA-256 `b3e4d53fcced800be3c8b09567ef66c2faebb21937634e3f17aa2d6228011f1f` (MD5
`689a0a41d3d3c124cb97e9640305831a`, 119,951 bytes). No merge, deployment, Vercel change or production test write.

**Preflight (read-only, 21:52–22:02 UTC).** `main` unchanged at `84ba4f6`; AGENT_RULES, VISION and WORK_LOG re-read
with no release conflict. All seven preimage md5s matched; no new table, schema, role, function or `wins` index
existed; version `20261019170000` was free and the latest recorded version was `20261019035819` (UV verification
wizard), so the new version sorts last. No other open PR carries a pending schema release; no lock waits, no other
active sessions, no write locks on `public.wins` or `public.organizations` (17 and 6 rows); the 13 cron jobs run no
DDL; the six event triggers are the standard Supabase ones. `postgres` (the SQL role) owns `wins`, `organizations`
and `private`, holds REFERENCES and grant options, and may record history. Baselines were captured for the
existing-object fingerprint (functions, policies, relations, column ACLs, schemas, roles, memberships, default ACLs,
triggers, indexes, constraints, cron jobs, event triggers, publications) and both advisor lists (240 security, 432
performance findings).

**Execution method.** `apply_migration` stamps its own version, so it could not preserve `20261019170000`. The
hosted SQL endpoint ran one multi-statement string in one transaction (confirmed beforehand: `SET LOCAL` carries
across its statements; separate calls use separate backends, so nothing can be staged between calls):
`SET LOCAL lock_timeout = '1s'; SET LOCAL statement_timeout = '60s';` (the file's own values, so they bind the
whole statement) and one `DO` block that (1) holds the migration text as a dollar-quoted literal, its eleven
box-drawing rules sent as placeholders and expanded server-side; (2) refuses unless the expanded text's MD5,
SHA-256 and byte length equal the reviewed file's; (3) refuses if the version is already recorded; (4) `EXECUTE`s
the text unchanged; (5) inserts `('20261019170000', 'policy_commission_tracking', ARRAY[text])` into
`supabase_migrations.schema_migrations` (`created_by` left NULL). Any error rolls back everything. Rehearsed first on
disposable PostgreSQL 16.15 databases: schema dump and role identical to `psql -1 -f` of the file; history row
byte-identical; replay refused; a one-byte change refused before anything ran; a held lock on `wins` failed after
1.05 s and rolled back completely.

**Result.** Applied once, between 22:02:32 and 22:08:47 UTC, with no error. `schema_migrations` now holds 337 rows,
the newest `20261019170000 / policy_commission_tracking`, one statement whose MD5, SHA-256 and length equal the file.

**Read-back (read-only, 22:08–22:15 UTC).**

- Existing objects: every baseline fingerprint is identical (576 functions, 354 policies, 202 relations, 72 column
  ACLs, 16 other schemas, 33 roles, 24 memberships, 27 default ACLs, 137 triggers, 772 indexes, 816 constraints,
  13 cron jobs, 6 event triggers, 16 publication tables). The only changes are the intended
  `agentflow_policy_commission_writer=U` on `public` and `private` and the new history row. No existing policy changed.
- The seven reviewed sale-writer/helper definitions are unchanged (md5 preimages match).
- New objects equal a locally migrated reference exactly, category by category: 36 function bodies and settings, 6
  tables' columns, 88 constraints, 33 indexes (including `wins_commission_link_key`, valid and unique), 22 RLS
  policies, 13 triggers, RLS enabled on all six tables, owners and table comments, the writer role and the
  authorization schema.
- Privileges: each table grants `authenticated` SELECT and the writer SELECT/INSERT (plus UPDATE on 24 named columns
  only); the event sequence grants the writer USAGE; no `anon`, `service_role` or PUBLIC grant. All 36 functions have
  explicit ACLs: 13 entry points executable by `authenticated`, the handoff by `postgres`, helpers by the writer, the
  rest by no one but their owner. The writer is NOLOGIN, NOINHERIT, NOBYPASSRLS, not superuser; `postgres` is its
  only member (the implicit creator grant plus the explicit grant); it owns 17 functions and no relation, has USAGE on
  `public`, `private` and `policy_commission_authz` only, CREATE nowhere, and no grant on any existing object.
- Row counts: all six tables 0 rows with zero inserts, updates or deletes; no unexpected activity.

**Advisor delta (each finding reviewed).** Security +13, −0: `authenticated_security_definer_function_executable`
(WARN) for exactly the four companions, the eight tracking RPCs and `get_policy_sale_operation_status`, the intended
authenticated entry points, each deriving actor and organization on the server. No new ERROR, `anon`, search-path or
RLS finding. Performance +25, −0: 13 `unused_index` (INFO) on the new, empty tables; 12 `multiple_permissive_policies`
(WARN) naming the writer role on eight existing tables (`agency_resource_categories`, `agency_resources`,
`organizations` SELECT/UPDATE, `report_layouts` SELECT/INSERT/UPDATE/DELETE, `tasks`, `training_categories`,
`training_progress`, `training_resources`). Those were not in the local delta and were investigated: the tables'
permissive policies target `{public}`, and the lint lists every role, so the same 12 findings already existed for
`agentflow_comp_operator`, `anon`, `authenticator`, `cli_login_postgres`, `dashboard_user` and
`supabase_privileged_role`. The writer holds no table or column privilege on any of the eight and PUBLIC has no grant
on them, so those policies never apply to it; no access path was added. No unindexed foreign key was added.

**Not done / outstanding.** No production sale, commission or payment call was made, so PostgREST exposure of the new
RPCs is not proven over HTTP in production (its schema-reload event trigger is the standard one). The deployed
frontend still calls the legacy writers. Signed-in acceptance and Gate 4 (merge, frontend release, type regeneration
from production) need separate approval. The rollback file is unchanged and refuses once any commission row exists.
Never edit, rename or replay the applied migration file.

## 14. Amendment §13.7 — simpler copy and expected date windows (local, 2026-10-20)

Approved by Chris for local implementation and disposable-database verification only, with the date-basis safeguard:
a first premium date is used only when a person establishes it in Edit dates; otherwise the policy's own Effective
Date is assumed. Draft Date (the next scheduled draft) is never read. Synthetic data only; nothing hosted was queried or
changed. Migration `20261019170000` is byte-identical to the applied file (SHA-256 `b3e4d53f…011f1f`).

**Package.** `supabase/migrations/20261020040000_policy_commission_expected_windows.sql` — SHA-256
`10897ad6123dc052e5cbe5340a821e3ce8595f99f1448e74832e18fb2d0a5ea8`, MD5 `44f590529c0a8bb574f253cc392eb78f`, 45,440
bytes. Rollback `rollback/20261020040000_policy_commission_expected_windows.rollback.sql` — SHA-256
`f596d2135189a9fcd93f9b9ad9e486b0ab68fa27766ea1a9f405a9c43c8c5bc2`, MD5 `b1ea7b27958f2c1177c89f8d6bb0fd17`, 31,869
bytes. The migration refuses unless the seven sale-writer preimages and the eight replaced functions match their
`20261019170000` definitions (md5 of `pg_get_functiondef`; the local reference equals the production-verified Gate 3
aggregate `db8dee08…`), and refuses replay. Changes: `expected_until` on installments and a rebuilt timing check;
`schedule_assumed` (default false, metadata-only), `schedule_frequency`, `schedule_convention` and a schedule check on
estimates; writer UPDATE on those four columns; guard lists; four postgres-owned IMMUTABLE calendar helpers executable
by the writer only; eight bodies replaced with owners, definer flags and ACLs unchanged. Writer-owned bodies are
replaced under `SET LOCAL ROLE` with CREATE on `public`/`private` granted only for that step (the same capability
production exercised for Gate 3's ownership transfers).

**Database proofs (PostgreSQL 16.15 local; CI repeats on 17.6).** `scripts/run_policy_commission_tests.sh` passes end
to end (39 s; 81 s with PostgREST and measurement):
- Guards: refused without `20261019170000`, refused when a replaced function drifted (nothing created), refused on
  replay. Existing-object inventory unchanged (173 non-commission objects); exactly the eight intended bodies changed
  and four writer-only helpers added.
- Suites with both migrations: security, handoff, the new expected-windows suite, races and lock contention, and the
  existing sale/identity/reporting suites. The tracking suite runs against `20261019170000` alone (its month-level
  timing rules are the applied behaviour the new migration supersedes).
- Expected-windows suite: holiday rules including Saturday/Sunday fixed-date cases and Juneteenth from 2022 (10 weekday
  holidays in 2026, 9 in 2027); every premium date 2000-01-01…2100-12-24 yields a business-day window starting after it
  and within 14 days; the documented examples (Oct 2 → Oct 5–7; Jul 2, 2027 → Jul 6–8; Nov 25 → Nov 27–Dec 1; Dec 30 →
  Dec 31–Jan 5; Jan 31 → Oct 31/Nov 30/Dec 31 premiums; May 31, 2027 → Feb 29, 2028); untrusted dates (`2026-02-30`,
  `11/01/2026`, out of range) treated as missing. Sale entry assumes the effective date; a differing Draft Date is
  ignored (and was saved on the client); missing or invalid dates save the estimate with every payment "Date needed";
  quarterly/annual get only the Advance window; an additional policy uses its own effective date and never the
  primary's dates or frequency; confirmation reads the effective date at confirmation; record-later is automatic.
  Edit dates: first premium date (confirmed, all four windows), replay-safe, changed payload refused, stale revision
  PT409, effective-date mismatch refused, unknown source refused; manual month and manual "Date needed" survive start
  changes; `automatic` restores a payment; current frequency re-read (annual → Advance only); clearing keeps manual
  dates; Team Leader 42501, other agency PT404. Replacement carries an assumed schedule verbatim even after the
  effective date changed; replacing an undated estimate gets the automatic schedule with its manual date kept.
  Receipts and voids leave dates unchanged. Contact reads assign no transaction id (they write nothing). Audit shape
  equals the estimate state; the new checks reject a >14-day window, a manual window end, a month-level Advance, an
  assumed manual start, an unknown frequency and an unknown convention. The writer keeps no CREATE.
- Rollback: refused once a window exists (records kept); allowed with rows that use no new field (rows kept); on an
  unused database it restores the `20261019170000` commission catalog exactly (512 lines: functions with owners, ACLs
  and digests, constraints, columns with column ACLs, table and schema ACLs); replay refused; reapply passes.
- PostgREST 12.2.3 + supabase-js: 13 checks pass, including the contact read returning the assumed windows over HTTP,
  Edit dates, manual "Date needed", `automatic`, an invalid precision (HTTP 400, 22023) and a Team Leader edit (403).
- Save overhead (this slower container; A/B on the same cluster): the date calculation itself is ~0.04 ms per estimate
  and call counts are identical with and without the migration; differences are within run-to-run noise (convert 25:
  65.5 → 69.4 ms p50). The 100-slot defensive case sits at the existing soft 250 ms calculation-start budget here (A:
  100/100 recorded at ~300 ms; B: ~81 recorded, the rest `budget_exhausted` as designed). CI measurements for the
  pushed head are recorded in the PR body.
- Advisors (splinter on the fixture, `20261019170000` alone vs both): 93 → 93 findings, none added or removed.

**Frontend.** Copy per §13.1/§13.7: "Estimated commission · Received · Remaining", Advance and Month 10/11/12,
"Expected Oct 5 – 7, 2026" ranges (month and year crossings), "Date needed", Record payment, Edit date (per payment:
Automatic, Exact date, Month, Date needed), Edit dates (Effective date, First premium date, Date needed), one ⓘ note by
the Commission heading. Removed: the pay-grid/rate/level basis panel (`CommissionBasis.tsx` deleted; the saved
calculation provenance is unchanged and still returned), the footer paragraph and the grid/carrier-statement sentences.
Zod validates both date forms and the new response fields; responses from before `20261020040000` parse with safe
defaults (tested), so the updated preview renders against production before Gate 3b; the current client keeps parsing
new responses (windows use precision `date`). Results: `npx tsc --noEmit` passes; app typecheck output identical to
`main` `84ba4f6` (230 lines, positions included); scoped ESLint clean; `npm run build` passes; `git diff --check`
clean; the CI frontend set 523 passed / 7 skipped; full Vitest 5,930 passed, 36 skipped, 1 failed — the
`recordingRetentionVoicemail` v29 byte-identity test, which fails identically on `main` `84ba4f6` and is unrelated.

**Browser (synthetic stub, no backend).** 1440 px and 390 px, light and dark: no console errors or warnings, no
horizontal overflow. Screenshots: `screenshots/s13-contact-commissions-desktop-1440-light.png`,
`s13-contact-commissions-mobile-390-dark.png`, `s13-edit-dates-desktop-1440-light.png`,
`s13-edit-dates-mobile-390-dark.png`, `s13-payment-date-mobile-390-dark.png`,
`s13-estimate-note-page-mobile-390-dark.png`.

**Release gates still open (each separately approved).** Gate 3b: apply `20261020040000` to production with its exact
bytes (version-preserving method, preflight, advisor delta), before Gate 4. Remaining Agent own-client read on the
updated preview (read-only; share link only once the candidate is ready and the access scope is authorized). Gate 4:
merge and frontend release. The preview conversion of 2026-10-20 02:10 UTC (client `2325bc9d`, estimate `7e2c476a`)
is still awaiting Chris's classification; it was not touched. After Gate 3b that estimate keeps showing "Date needed"
(no backfill) until someone uses Edit dates.

## 15. Gate 3b production release record (2026-10-20)

Chris approved Gate 3b only: the exact reviewed `supabase/migrations/20261020040000_policy_commission_expected_windows.sql`
from source `cb0cdfc9ac4d55018c0c7517e538dafda1f41a88`, its column grants and function changes, and recording version
`20261020040000`. Not approved: merge, frontend deployment, preview-access changes, backfill, production test writes or
cleanup of existing records.

**Preflight (read-only, 05:27–05:33 UTC).** AGENT_RULES, VISION and the newest WORK_LOG re-read, no conflict; plan §13.7
names Gate 3b as this exact apply before Gate 4. `main` unchanged at `84ba4f6`; branch head `cb0cdfc` (CI green). The
file recomputed from the pinned source: SHA-256 `10897ad6123dc052e5cbe5340a821e3ce8595f99f1448e74832e18fb2d0a5ea8`, MD5
`44f590529c0a8bb574f253cc392eb78f`, 45,440 bytes. Production (PostgreSQL 17.6): the stored `20261019170000` statement
still equals the reviewed file (`b3e4d53f…011f1f`, 119,951 bytes); version `20261020040000` absent; 337 history rows,
latest `20261019170000`; all 15 prerequisite fingerprints matched (seven sale writers, eight replaced functions); the four
columns, four helpers and the schedule check absent; the timing check still the applied definition. The one estimate
(`7e2c476a`, its four installments: Advance $1,125.00 and $125.00 × 3, all unset/unknown) already satisfied the new checks.
Session `postgres` with no role set (so the migration's `RESET ROLE` returns to it); `postgres` may `SET ROLE` to the writer
(explicit membership, SET true); the writer had no CREATE. The two production event triggers that fire on this DDL
(`issue_pg_graphql_access` on CREATE FUNCTION, `pgrst_ddl_watch`) were read: as the writer they only check for
`pg_graphql` and send a schema-reload NOTIFY. No other active session, DDL, lock wait, lock on the two tables or long
transaction; no other pending schema release (open PRs and Supabase branches checked). Baselines saved: existing-object
fingerprints (equal to the Gate 3 post-apply read-back: 576 functions, 354 policies, 202 relations, 72 column ACLs, 16
schemas, 33 roles, 24 memberships, 27 default ACLs, 137 triggers, 772 indexes, 816 constraints, 13 cron jobs, 6 event
triggers, 16 publications), the 70-line commission catalog, row digests of all six tables (1 handoff, 1 capture, 1
estimate, 4 installments, 0 receipts, 1 event), write counters, and advisors (security 253, performance 451 findings).

**Method and rehearsal.** `apply_migration` stamps its own version, so as for Gate 3 one simple-query string ran on the
hosted SQL endpoint: the file's own `lock_timeout 1s` / `statement_timeout 60s`; a DO block holding the reviewed text
(long box-drawing rules sent as placeholders and expanded); refusal unless MD5, SHA-256 and length equal the reviewed
file, unless the base version is recorded, or if `20261020040000` already exists; `EXECUTE` of the unchanged text; a check
that the session is back to `postgres`; then the history row (`statements` = the exact text, `created_by` NULL).
Rehearsed on disposable PostgreSQL 16.15 with replicas of the two production event triggers (the writer lacking USAGE
on `extensions`, as in production) and a probe trigger: file and wrapper produced identical schema dumps (8,709 lines);
the history row stored the exact bytes; the triggers ran as the writer for its five CREATE FUNCTION commands without
error; the writer ended with no CREATE; the expected-windows suite passed on the wrapper-applied database; a replay, one
altered byte and a held reader lock (cancelled at 1.07 s) were each refused with nothing changed.

**Apply.** Once, without error. Committed at **05:36:31.86 UTC** (PostgREST received the schema-reload message then and
reloaded its cache at 05:36:32.1). No retry was needed.

**Read-back (read-only, 05:37–05:40 UTC).**
- History: `20261020040000 / policy_commission_expected_windows`, one statement whose MD5, SHA-256 and length equal the
  reviewed file; 338 rows; `20261019170000` row unchanged.
- Catalog diff (production before vs after), exactly the intended change: the eight replaced bodies with owners, definer
  flags and ACLs unchanged; four helpers added (postgres-owned, IMMUTABLE, invoker, EXECUTE for the writer only — not
  PUBLIC, `anon`, `authenticated` or `service_role`); four new columns with writer-only UPDATE (`schedule_assumed`
  boolean NOT NULL DEFAULT false; `schedule_frequency`, `schedule_convention`, `expected_until` nullable); columns
  209 → 213; constraints 88 → 89 (timing check rebuilt, schedule check added, both validated); RLS still enabled on all
  six tables; policies, triggers, table ACLs, schema ACLs and the writer role (NOLOGIN, NOINHERIT, NOBYPASSRLS; `postgres`
  its only member) unchanged; the writer has no CREATE on `public` or `private`. All twelve changed or new function
  digests and both check definitions equal the locally migrated reference.
- Seven original sale-writer fingerprints unchanged (7/7). Existing non-commission objects: every fingerprint identical
  to the preflight (only the commission function count 36 → 40 and history 337 → 338 changed).
- Data: row counts unchanged; every table's row digest (excluding the four new columns) equals the preflight digest; the
  new columns hold only their defaults (no assumed start, frequency, convention or window anywhere); write counters
  unchanged (no row inserted, updated or deleted). Estimate `7e2c476a` unchanged (active, sale entry, $1,500.00
  first-year, $1,125.00 Advance, $125.00 × 3, revision 1, all four payments unset); client `2325bc9d` untouched and still
  without an effective date, so its payments stay "Date needed" until someone uses Edit dates. No backfill, receipt or
  classification change.
- The IMMUTABLE helpers give the reviewed examples on production (Oct 2 → Oct 5–7; Jul 2, 2027 → Jul 6–8; Nov 25 →
  Nov 27–Dec 1; Dec 30 → Dec 31–Jan 5; Saturday Christmas 2027 → Dec 24–28; MLK Day; Juneteenth 2021 not observed;
  Memorial Day premium; the clamped Jan 31 schedule; quarterly → Advance only).

**Advisor delta (by finding key).** Security 253 → 253, performance 451 → 451: none added, none removed. Expected: the
helpers live in `private` (not exposed), pin `search_path` and are not SECURITY DEFINER; the replaced functions keep
their existing findings. (Performance was 457 right after Gate 3; six `unused_index` notices cleared since because those
indexes have been used.) PostgREST's periodic "Thread killed by timeout manager" lines occur every 90 s before and after
the apply and are unrelated.

**Correction to the §13.7 release report.** At `cb0cdfc` the CI 100-policy benchmark recorded a **median of 99.5/100**
estimates (p95 100/100), not 100/100 as one chat summary said; the PR body already showed 99.5/100. Slots not started
within the soft 250 ms calculation-start budget are saved as `needs_attention / budget_exhausted` with the sale
committed. Existing recovery evidence: the handoff suite's "Aggregate budget" scenario (slow persistence → later slots
`budget_exhausted`, then `confirm_policy_commission_capture` records one: "a budget-exhausted capture is recoverable by
confirmation"), passing at `cb0cdfc` on PostgreSQL 17.6 with both migrations; recording later also resolves an open
capture (tracking suite). 25 policies remains the benchmark; 100 is a defensive cap.

**Not done / still gated.** No production sale, commission, Edit dates or payment call; PostgREST exposure of the new
fields is proven only by its schema reload and the CI HTTP checks. The deployed frontend still calls the legacy writers,
so no estimate is created in production except through a preview (do not test with one). Remaining: the Agent own-client
read on the updated preview (read-only; no share link until authorized), Gate 4 (merge, frontend release, type
regeneration from production), and Chris's classification of client `2325bc9d` / estimate `7e2c476a`. The rollback for
`20261020040000` still refuses once any new-field value exists; it is not needed and was not run.

**Re-check after a repeated approval (14:57 UTC, read-only).** The same Gate 3b approval was sent again at about 14:55 UTC.
The pinned source still hashes to `10897ad6…0a5ea8`, but production already records `20261020040000` and the new objects
exist, so the preflight's absence checks fail by design and nothing was applied a second time. Production again matched the
05:37–05:40 read-back exactly: the history rows (338; both statements' MD5, SHA-256 and length unchanged), 7/7 sale
writers, the four columns with writer-only UPDATE, both checks validated, the four helpers (owners, IMMUTABLE, ACLs, digests;
not executable by `anon`, `authenticated` or `service_role`), the writer with no CREATE, RLS on all six tables, the whole
commission catalog line for line, every existing-object fingerprint, and every row digest, new-column value and write counter
(no commission row inserted, updated or deleted since). Estimate `7e2c476a` and client `2325bc9d` unchanged. Advisors:
security 253 and performance 451, none added or removed since the post-apply read-back.
