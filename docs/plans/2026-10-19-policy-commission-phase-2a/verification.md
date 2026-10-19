# Phase 2A — verification record

**Scope:** Gate 2 plus the approved correction pass (plan §12) on branch `claude/friendly-ptolemy-pvpmfj`, draft PR
#469 against `main` `84ba4f6`. Nothing here touched production: no production migration, RLS or grant change,
production read or write, merge, deployment or production test. Synthetic data only. Authenticated end-to-end
acceptance in an authorized environment is still outstanding.

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

## 4. Save overhead (PostgreSQL 17.6, CI run `39315398293`)

Server time per save inside PostgreSQL (`clock_timestamp()`), each sample on a fresh request and lead in one warm
session. Overhead = companion percentile minus the matching unchanged writer's. Contention cases hold a lock from a
second session while a warmed session saves; autovacuum is settled first. **Measured maxima are observations, not
guarantees.**

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

HTTP through PostgREST on 17.6 (median of 15, warm, sequential): create 1 policy 2.1 → 4.9 ms (+2.7); convert 1 policy
2.2 → 5.0 (+2.8); 5 policies 2.6 → 8.6 (+6.0); 25 policies 5.9 → 29.7 (+23.9).

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

Head `b599c96` (code identical to the final head; later commits change documentation only): Policy commission
tracking (PostgreSQL 17.6 + PostgREST, frontend tests), Commission grids (PostgreSQL 17.6 suites, calculator tests), UV
profile sync (frontend typecheck parity, browser, paired-native), SMS consent, Reporting integrity, Dialer DNC
integrity: success. Supabase Preview: skipped. Exact final-head results are recorded on the PR and in the hand-off.
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
3. **100-slot saves** take ~125 ms on 17.6 CI hardware and up to ~0.4 s on a slow shared container; not a guarantee.
4. **Team Leader read access inherits the `is_ancestor_of` defect** (AGENT_RULES debt): affected Team Leaders see less,
   never more.
5. **Receipts show no recorder name** (the audit events keep the actor).
6. **Writer coupling**: the companions map the writers' exact conflict messages to PT409 and recompute their sale
   hashes; the preimage guard protects only the apply.
7. **Vercel preview** of this branch runs the new frontend against whatever backend its environment points to; without
   the migration, companion saves are refused (function missing). Do not use the preview for sale or commission
   testing.

## 12. Proposed database-only release package (Gate 3; not approved, nothing done)

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
