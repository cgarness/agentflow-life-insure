# Phase 2A — local verification record

**Scope:** Gate 2 (local implementation and disposable-database testing) on branch `claude/friendly-ptolemy-pvpmfj`,
based on `main` `84ba4f6`. Nothing here touched production: no production migration, RLS or grant change, production
read or write, merge, deployment or production test. Synthetic data only. Commit hashes and the final branch head are
in the WORK_LOG entry and the hand-off report.

Estimates are illustrative and receipts are manually recorded; nothing in this record verifies either against a
carrier.

## 1. Environment

| Item | Version |
|---|---|
| PostgreSQL (disposable loopback cluster, trust auth, `/tmp`) | 16.15 |
| PostgreSQL in CI (`.github/workflows/policy-commission-tracking.yml`) | 17.6 — **not executed** (see §9) |
| PostgREST (binary checked against the workflow's pinned sha256) | 12.2.3 |
| `@supabase/supabase-js` | 2.98.0 |
| Node / Vitest / Vite | 22 / repository lockfile versions |
| Browser | Playwright 1.56.1 Chromium (pre-installed) |

## 2. Database proofs — `scripts/run_policy_commission_tests.sh`

Full runner on the final migration (PostgreSQL 16.15, `POSTGREST_BIN` set, `PC_MEASURE=1`): **exit 0**.

```
PASS migration guards and existing-object inventory (173 objects unchanged)
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

Covered (see the suite files for each assertion): preimage refusal of a drifted writer with no residue, replay
refusal, ACL/ownership inventory of every pre-existing object, writer role attributes and membership, writer subject
to RLS, no client table writes, Own/Others permission matrix and parity with `permission_defaults.json`, server-proven
binding for all four companions (including the D7 first-policy edit receipt), byte-identical replay, PT409 mapping
only for the writers' committed-operation conflicts, explicit empty payload, commission failure never failing a sale,
57014 not swallowed, 100-slot cap, budget exhaustion, independent-session races (duplicate submissions, receipt vs
replacement, concurrent first-policy edits), lock contention (locked commission tables leave the sale saved within
`lock_timeout`; a grid row lock does not block capture), payments/overpayment/voids/replacements/timing/holds and their
audit events, the delete/truncate retention guard, and rollback refusal with rows, rollback and reapply.

## 3. Real PostgREST + supabase-js — `scripts/tests/policy_commission/postgrest_integration.mjs`

Real PostgREST 12.2.3 and supabase-js 2.98.0 against a disposable database with Supabase-shaped JWT roles:

```
ok  anon cannot call a companion (401, 42501)
ok  service_role cannot call a companion or read commission rows
ok  companion saves the sale and records the estimate
ok  a byte-identical replay returns the stored sale and commission outcome
ok  a committed-operation conflict is HTTP 409 PT409
ok  other writer errors are unchanged
ok  legacy writer remains callable unchanged
ok  no direct table writes; private helpers are not exposed
ok  contact read: estimate, schedule and access for the seller; hidden from other agents
ok  receipts, voids and stale revisions over HTTP
ok  operation status read
ok  conversion with additional rows and a conversion conflict
```

## 4. Save overhead — `scripts/tests/policy_commission/measure_save_overhead.sh`

Server time per save, measured inside PostgreSQL (`clock_timestamp()`), each sample on a fresh request and lead in
one warm session, synthetic grid, final migration. Writer = the unchanged sale writer; companion = writer + evidence
+ captures + estimates.

| Case | Writer p50 / p95 (ms) | Companion p50 / p95 (ms) | Added p50 (ms) | Slots recorded |
|---|---|---|---|---|
| Create client, 1 policy, estimate | 0.54 / 0.73 | 5.00 / 8.46 | +4.5 | 1 / 1 |
| Create client, 1 policy, explicit empty payload | 0.54 / 0.73 | 1.58 / 2.10 | +1.0 | — |
| Create client, 1 policy, commission step fails | 0.54 / 0.73 | 1.53 / 2.25 | +1.0 | sale saved, `not_recorded` |
| Convert, 1 policy | 1.93 / 2.11 | 6.49 / 7.02 | +4.6 | 1 / 1 |
| Convert, 5 policies | 2.92 / 3.96 | 17.54 / 24.22 | +14.6 | 5 / 5 |
| Convert, 25 policies (supported boundary) | 6.63 / 10.20 | 68.20 / 75.02 | +61.6 | 25 / 25 |
| Convert, 100 policies (defensive cap; 10 samples) | 20.46 / 26.37 | 277.19 / 378.03 | +256.7 | 100 / 100 |

HTTP through PostgREST (median of 15, warm, sequential): create 1 policy 4.3 → 11.4 ms (+7.1); convert 1 policy
4.0 → 8.9 ms (+4.9); convert 5 policies 5.0 → 17.2 ms (+12.2); convert 25 policies 12.3 → 65.7 ms (+53.4).

**At the 100-slot cap** two further isolated runs gave companion p50/p95/max of 261.7 / 347.2 / 397.7 ms and (with
`jit = off`) 269.3 / 372.5 / 392.8 ms; an earlier run of the same design on this container gave about 237 / 264 ms.
The budgeted part (handoff row to last capture update) averaged 214 ms with a maximum of 260 ms, and the budget never
tripped. The 250 ms budget gates when each slot's calculation starts (plan §2.1); validation, evidence, capture
inserts and result building around it are not budgeted, which is why the slowest 100-policy saves reach about 0.4 s.
No timeout was raised. Realistic sales (1–5 policies) add about 5–15 ms server and 5–12 ms HTTP.

Per-function profile (all samples, `track_functions = 'pl'`): `policy_commission_insert_estimate` dominates (about
1.6 ms per estimate including its four installments), then the handoff body, `campaign_actor` and the RLS
`access()` checks.

## 5. Advisors (local)

Supabase's open-source advisor lints (`supabase/splinter`, `splinter.sql` from `main`) ran on two disposable databases
built from the same fixture: without and with the migration. Hosted-only advisors cannot run locally; the production
advisor delta belongs to Gate 3.

| Finding (new with the migration) | Level | Count | Assessment |
|---|---|---|---|
| `authenticated_security_definer_function_executable` | WARN | 13 | By design: the four companions, eight tracking RPCs and the operation-status read are the only write/read paths and authorize the real JWT actor internally (the existing sale writers carry the same finding). `get_client_policy_commissions` is SECURITY INVOKER and is not flagged. |
| `unused_index` | INFO | 12 | Expected on a fresh database with no traffic. |

No other new finding; none resolved. The first pass also reported `unindexed_foreign_keys` for
`policy_commission_captures_handoff_fk (handoff_id, organization_id)`; the index was widened to
`(handoff_id, organization_id)` and every database proof was re-run on the final migration.

## 6. Frontend — baseline (`84ba4f6`) vs branch

| Check | Baseline `84ba4f6` | Branch | Result |
|---|---|---|---|
| Vitest, full, **no Supabase env** (as `reports-frontend` CI) | 10 failed files, 1 failed test, 5,738 passed | same 10 files, same 1 test, 5,819 passed | no new failure (81 new passing tests) |
| Vitest, full, inert env (`VITE_SUPABASE_URL=http://127.0.0.1:54321`) | — | 1 failed file: `recordingRetentionVoicemail` (the baseline's failing test), 5,908 passed | only the pre-existing failure |
| `commission-grids.yml` frontend test set, no env | — | 23 passed, 2 skipped (DB integration) | pass |
| Phase 2A and affected suites, inert env | — | 26 files passed, 2 skipped; 247 tests | pass |
| `tsc -p tsconfig.app.json` | 84 diagnostics | 84, identical | no new diagnostic |
| `tsc --noEmit` (root) | exit 0 | exit 0 | pass |
| ESLint on all 53 changed TS/TSX files | — | 0 errors, 14 warnings on pre-existing lines (one moved verbatim into `clientUpdatePatch`) | pass |
| `vite build` | pass; main chunk 4,489.89 kB (1,218.04 kB gzip) | pass; main chunk 4,502.54 kB (1,222.29 kB gzip) + lazy `PolicyCommissionSection` chunk 36.59 kB | pass |
| `git diff --check` | — | clean | pass |

TwilioContext, DialerPage, FloatingDialer and the dialer contracts were reviewed and are unchanged; the existing
dialer/telephony suites are part of both full runs above.

## 7. Browser screenshots (`screenshots/`)

Rendered by a local, uncommitted Vite harness that mounts the real `ClientPolicies` (with the lazily loaded
`PolicyCommissionSection`), `RecordPaymentDialog`, `VoidReceiptDialog` and `SaleSubmissionNotice` components and the
app's Tailwind theme, with `AuthContext`, `useEffectiveViewer` and the Supabase client stubbed to return synthetic
`get_client_policy_commissions` data (no login, no network). It is not the full contact page.

| File | Shows |
|---|---|
| `contact-commissions-{desktop-1440,mobile-390}-{light,dark}.png` | A two-policy client (recorded estimate with a voided and replaced receipt, a partial Month 10 payment and a confirmed schedule start; a second policy whose sale-time estimate awaits confirmation), a single-policy client on hold with unconfirmed timing, a client with no estimate, and the frozen / conflict / rejected sale-save notices |
| `record-payment-{desktop-1440,mobile-390}-{light,dark}.png` | Record payment for Month 10 (remaining amount prefilled) |
| `void-receipt-{desktop-1440,mobile-390}-{light,dark}.png` | Void a receipt with a reason, optionally recording a corrected payment |

Every capture asserted no console error or warning, no page error and no horizontal overflow at 1440 px and 390 px.
The first dark-mode pass showed the app's dark `--destructive` text was hard to read on cards; the new notices and the
Void action now add `dark:text-red-400` (plan §11).

## 8. Migration checksums (final files)

| File | Bytes | SHA-256 | MD5 |
|---|---|---|---|
| `supabase/migrations/20261019170000_policy_commission_tracking.sql` | 117,415 | `a5cf9c7dc15ac6bdee12fa83cff9676b8fd70009d32f96af44af826f1fea67c5` | `2b7cb7cb8dc92e63757187af96cef03d` |
| `supabase/migrations/rollback/20261019170000_policy_commission_tracking.rollback.sql` | 5,130 | `60a5691c3802802ef9239f1927c6aae8dffc01433b6bce5388055826a008b118` | `c55d06bc0a311a3ea7c924fff5f31099` |

The migration refuses unless these production preimages (md5 of `pg_get_functiondef`) match: `create_client_with_sale`
`0fd43910…`, `convert_lead_to_client_with_sales` `3d974a5c…`, `record_client_policy` `b9ffa1e0…`,
`update_client_with_policy_sale` `96e8f6e7…`, `private.insert_policy_sale` `3f600b75…`, `convert_lead_to_client_atomic`
`641ba66c…`, `private.campaign_actor` `f582e437…` (full values in the migration's guard).

## 9. Remaining risks and open items

1. **PostgreSQL 17.6 not executed.** Every database proof ran on local 16.15. The workflow pins 17.6 and the same
   PostgREST, but it triggers on pull requests only; no PR has been opened (not approved). It must pass before Gate 3.
2. **No end-to-end authenticated browser run.** The browser evidence is a component harness with stubbed auth and
   data; the PostgREST suite covers the HTTP contract. A real login against a Supabase stack (GoTrue) was not
   available here.
3. **Save time at the 100-slot cap** reaches about 0.4 s in the slowest samples (§4) because only the calculation is
   budgeted. Supported sizes are fast. If a tighter worst case is wanted, lowering the cap (for example to 50) is a
   design change for Chris to approve; no timeout was or should be raised.
4. **Team Leader read access inherits the `is_ancestor_of` defect** (AGENT_RULES known debt: true for 3 of 11
   profiles with an upline on 2026-10-17). Affected Team Leaders see less, never more.
5. **Recording an estimate later leaves the earlier open capture row** (`awaiting_confirmation`/`needs_attention`)
   in place. The contact view shows the recorded estimate, and confirming the old capture is refused because an
   estimate exists, but the row stays open. Any future report must not count open captures as pending work.
6. **Receipts show amounts, dates and references but not the recorder's name** (ids are returned; names are not
   joined). Audit events keep the actor.
7. **Writer coupling.** The companions map four writers' exact conflict messages to PT409 and recompute their sale
   hashes. The preimage guard protects only the apply; a later writer change must re-verify the companions.
8. **`src/integrations/supabase/types.ts` entries are hand-written** for the new RPCs and must be compared with
   regenerated types after Gate 3.
9. **A failed lazy chunk load hides the commission section** until the page reloads (by design; the contact view is
   unaffected).

## 10. Proposed release steps (not approved; nothing below has been done)

**Gate 3 — production migration (backend only; the deployed frontend keeps calling the legacy writers).**
1. Open a PR from this branch (no merge) so `policy-commission-tracking.yml` runs the full DB proof on PostgreSQL
   17.6 with real PostgREST, plus `reports-frontend`, `commission-grids` and the other path-triggered checks. All green
   on the exact head.
2. Read-only production preflight: `SHOW server_version`; md5 of the seven reviewed function definitions equals the
   migration's preimage table; `agentflow_policy_commission_writer` and the six tables do not exist; existing advisor
   list saved for a delta; no other pending migration.
3. Apply the exact migration file (SHA-256 recorded in §8) as one transaction with its own `lock_timeout 1s` /
   `statement_timeout 60s` at a low-traffic moment. It takes a brief lock on `public.wins` for the new unique index
   (`wins_commission_link_key`); retry on lock timeout, never raise the timeouts.
4. Read-only post-checks: stored migration text matches; role NOLOGIN/NOBYPASSRLS with only `postgres` as a member;
   function owners/ACLs as in the inventory; the writer has only USAGE on `public`/`private`; RLS enabled on the six
   tables; no table write grants to `anon`/`authenticated`; the seven writer bodies unchanged; advisor delta limited
   to the expected SECURITY DEFINER WARNs and fresh-index INFOs.
5. No production test writes unless separately approved. Rollback file is ready and refuses once any row exists.

**Gate 4 — merge and frontend release.**
6. Regenerate `src/integrations/supabase/types.ts` from production and confirm it matches the hand-written entries.
7. Merge the PR; Vercel production deploy; served-bundle check that the four modals call the `*_handoff` companions.
8. Chris's acceptance on his own account (approved test writes only): record a policy with an estimate, confirm it
   appears under the policy with four installments, record and void a payment, place and release a hold; then
   confirm a Team Leader sees it read-only and an Agent without the Own toggle sees nothing.
9. Record evidence in WORK_LOG/verification; keep the rollback available until acceptance passes.
