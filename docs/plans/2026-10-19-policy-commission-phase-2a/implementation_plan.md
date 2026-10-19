# Phase 2A — saved policy commissions, expected payments and manual receipts

**Status:** approved by Chris on 2026-10-19 for **local implementation and disposable-database testing only**
(branch `claude/friendly-ptolemy-pvpmfj`, from `main` `84ba4f6`). Feature-branch commits and pushes are approved.
**Not approved:** any production migration, RLS or grant change, production test write, merge to `main`, deployment,
reminders, cron, calendar integration or commission dashboards. The Gate 3 release method is chosen only once the
tested migration package exists.

This document is the single current contract. It consolidates the approved plan, its amendments (A1–A5), the
companion-function correction and the local-build approval requirements. **Superseded and not current:** the Phase 1
§8 deferred snapshot design (root `implementation_plan.md`), every pre-sale "staging"/"session"/"attempt" design, the
15-minute first-primary rule, browser-side detached finalization, "only one open session" attribution, and
postgres-owned commission writers. Where an earlier message differs from this file, this file wins.

Public document: synthetic examples only; no compensation values, carrier products or private grid data (D1).

---

## 1. Outcome

Each newly saved policy can carry the commission estimate the agent saw while entering it, bound on the server to the
exact sale that created the policy. The contact view shows, per policy, the estimated first-year commission, four
expected installments (Advance 75%, Month 10, Month 11, Month 12), manually recorded receipts and what remains.
Estimates are illustrative: never carrier-verified, guaranteed, earned, paid, payroll or booked commission. Manually
recorded receipts are the agent's own record of money received, never a carrier reconciliation.

## 2. Save handoff — companion functions (server-proven binding)

All upgraded modal save paths call a **companion** that delegates to the existing sale writer (body, signature and ACL
unchanged) and, in the same transaction, records operation-to-result evidence. When no estimate was displayed the
modal sends an **explicit empty commission payload** `{"v":"policy-commission-v1","slots":[]}`; the companion still
records evidence. Legacy callers (no options) keep calling the old writers unchanged.

| Companion | Delegates to | Operation key | Sale hash (server-recomputed, the writer's own formula) |
|---|---|---|---|
| `record_client_policy_handoff(p_request_id, p_client_id, p_policy, p_primary, p_commission)` | `record_client_policy` | `policy:<request>` | `sha256([client_id, policy, primary])` |
| `create_client_with_sale_handoff(p_request_id, p_expected_org, p_client, p_record_sale, p_commission)` | `create_client_with_sale` | `manual:<actor>:<request>` | `sha256([client, record_sale])` |
| `convert_lead_to_client_with_sales_handoff(p_request_id, p_lead_id, p_expected_org, p_client, p_campaign_id, p_commission)` | `convert_lead_to_client_with_sales` | `conversion:<lead>` | `sha256([client, campaign_id])` |
| `update_client_with_policy_sale_handoff(p_request_id, p_client_id, p_patch, p_commission)` (D7) | `update_client_with_policy_sale` | new receipt `client-edit:<actor>:<request>` in `private.policy_sale_receipts` | `sha256([client_id, patch − updated_at])` |

The D7 companion takes the existing advisory-lock pattern on its key; an identical replay returns the stored `win_ids`
(client row returned only under the writer's own authorization predicate); a different hash is a conflict; otherwise it
calls the unchanged writer and writes the receipt. `updated_at` is excluded because the writer sets it itself.

### 2.1 Transaction and error boundaries

```
[request txn]
 1. sale := existing writer(exact args)
      inside BEGIN…EXCEPTION that maps ONLY the writer's committed-operation conflicts to PT409 (HTTP 409) and re-raises:
        22023 "Policy request already saved different details"
        22023 "This request already saved different details; refresh the client before editing"
        22023 "This lead is already converted; refresh the client before editing"
        42501 "Conversion retry belongs to another actor" | "Previously saved client is no longer available"
              | "Previously converted client is no longer available"
        40001 "Lead was converted concurrently; refresh before retrying"
      every other error re-raises unchanged → the request fails and nothing commits (as today)
 2. sale_hash := writer formula over the same args
 3. commission step (postgres-owned private.policy_sale_commission_step), ALL optional work inside one
    BEGIN…EXCEPTION WHEN OTHERS savepoint S1 (digesting, validation, evidence, captures, calculation, result building):
      created-in-this-call → private.policy_commission_handoff('create', …)   -- writer-owned
      idempotent replay    → private.policy_commission_handoff('replay', …)   -- read-only
      on any caught error  → S1 rolls back only commission work; result {status:'not_recorded'|'unavailable'}
 4. RETURN sale || {commission}
```

- `WHEN OTHERS` does **not** catch `query_canceled` (57014) or `assert_failure`. A genuine cancellation or statement
  timeout aborts the whole request: the sale rolls back and the client receives an error. It is never swallowed or
  relabelled as a saved sale.
- Request-wide failures (cancellation, connection loss, COMMIT-time failures such as the existing deferred
  sale-completeness trigger or resource errors) may abort the whole transaction; the client follows §5.
- Commission tables have no deferrable constraints, so commission work adds no COMMIT-time checks; this does not
  guarantee every COMMIT succeeds.
- **Soft calculation-start budget (not an end-to-end guarantee):** S1 sets `lock_timeout = 100ms` locally and the
  handoff measures elapsed wall-clock time from its start. Evidence and capture rows are written set-based first; a
  slot's calculation (nested savepoint S2) only *starts* while total elapsed time is below **250 ms**. Validation,
  evidence, capture inserts, the slot in progress and result building are not cut off, so the total can exceed 250 ms
  (measured in `verification.md`). When the budget is exhausted, remaining
  captures stay persisted with `needs_attention / budget_exhausted` (recoverable by explicit confirmation). Grid
  facts are read once per handoff for all slots (one helper call); no grid or receipt row is locked by commission
  work. A capture is never reported as persisted when S1 rolled back.
- Defensive cap: more than **100** slots fails S1 as a whole (`not_recorded` for every slot; never partial). The
  conversion row count itself is not limited (no policy-count limit is enforced anywhere). Measured benchmark: 25
  policies per save.

### 2.2 Evidence and captures

- `policy_commission_handoffs`: one row per committed operation (`UNIQUE (organization_id, sale_operation_key)`),
  written **only by the call that created the sale**, always (even with an empty payload): actor, kind, key,
  `request_id`, `sale_payload_hash`, `commission_digest` (server SHA-256 of the canonical payload), client, returned
  `policy_ids` / `win_ids`, the seller (`wins.agent_id`), and the immutable per-slot outcomes.
- `policy_commission_captures`: one per displayed slot whose presented seller equals `win.agent_id` and which the
  actor may read; immutable presented inputs + `capture_hash`; status `recorded | awaiting_confirmation |
  needs_attention | dismissed`. `UNIQUE (handoff_id, slot)`, `UNIQUE (organization_id, policy_id)`.
- Before writing, `private.policy_commission_handoff` re-validates through postgres-owned helpers: the receipt for the
  key exists with actor = caller, the recomputed sale hash and the same `win_ids`; every win is in the actor's agency,
  belongs to the receipt's client and matches the operation (record: `policy_id = request`; create/edit: the
  receipt's win; convert primary: key `conversion:<lead>`; convert additional: `policy_id` = the row UUID). Unknown,
  duplicate or unmatched slots fail S1 (never silently dropped). Client-supplied ids and digests are identifiers only.
- Replay: same request id + same sale hash + same digest → stored outcome; same request + different digest →
  `already_captured` (original kept); different request id → `other_operation` (nothing claimed); no evidence (old
  tab, inline edit, failed S1) → `not_recorded`, permanently for entry provenance. A replay never creates evidence.
- `sale_entry` provenance exists only for captures written in the creating call. Every other estimate is
  `recorded_later` ("Recorded later · current rates").

### 2.3 Ownership and grants

| Object | Owner | EXECUTE |
|---|---|---|
| 4 companions, `private.policy_sale_commission_step` | `postgres` (sale-wrapper precedent), SECURITY DEFINER, `search_path = pg_catalog, pg_temp` | companions: `authenticated` only; step: none (owner only) |
| `private.policy_commission_handoff` | `agentflow_policy_commission_writer` | `postgres` only |
| Tracking write functions (§4) | `agentflow_policy_commission_writer` | `authenticated` |
| Private read helpers (`policy_commission_operation_facts`, `_policy_facts`, `_grid_facts`, `_toggle`) | `postgres` | writer only (toggle: owner only) |
| `policy_commission_authz.{actor_uid, actor_org, access}` | `postgres` | writer; `actor_org`/`access` also `authenticated` |
| `get_client_policy_commissions` (SECURITY INVOKER read) | `postgres` | `authenticated` |
| `get_policy_sale_operation_status` (read-only, caller-scoped) | `postgres` | `authenticated` |

- `agentflow_policy_commission_writer`: NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION
  NOBYPASSRLS; only member `postgres`; owns **no table** (so RLS applies to it); USAGE on `public`, `private`,
  `policy_commission_authz`; SELECT/INSERT on the six tables and UPDATE on named columns only; temporary CREATE on
  `public` for the ownership transfer, revoked in the same migration; no privilege on any existing table or function.
  It never calls `auth.uid()` (policies use `policy_commission_authz.actor_uid()`).
- No ACL change on any existing function or table. `PUBLIC`, `anon` and `service_role` are explicitly revoked on
  every new object (Supabase default privileges would otherwise grant them).
- One additive constraint on `public.wins`: `UNIQUE (id, organization_id, policy_id, agent_id)`, so estimates can carry
  a composite foreign key proving org/policy/sale/seller consistency. No column, data, policy or grant change.

## 3. Data model (six tables, all owned by `postgres`, RLS enabled, not forced)

1. `policy_commission_handoffs` — evidence (§2.2).
2. `policy_commission_captures` — presented inputs per displayed slot.
3. `policy_commission_estimates` — immutable calculation basis: composite FK
   `(win_id, organization_id, policy_id, credited_agent_id)` → `wins(id, organization_id, policy_id, agent_id)` ON
   DELETE RESTRICT; grid/product/variant snapshot labels (no FK to comp tables); age, term, contract level, rate,
   monthly/annual premium + `premium_source`, exact first-year and advance (multiplication-only CHECKs), cents
   (half-up CHECKs), `calculation_version = 'policy-commission-v1'`, `capture_mode`, recorded by/at. Mutable only
   through the functions: `status` (`active | on_hold | superseded`) with reason/actor/time, `superseded_by`, schedule
   basis (`schedule_start_on`, `schedule_start_source`, set by/at) and `state_revision`.
   **`UNIQUE (organization_id, policy_id) WHERE status IN ('active','on_hold')`** — one current estimate per policy.
4. `policy_commission_installments` — exactly four per estimate (statement-level check, immediate): kind, sequence,
   immutable `expected_cents`; timing `unknown | month | date`, `expected_on`, `timing_source unset | schedule_basis |
   manual`, set by/at.
5. `policy_commission_receipts` — append-only manual receipts: `request_id` (unique per org) + `payload_hash`,
   `amount_cents > 0` (cap $1,000,000.00), `received_on` (business date) separate from `recorded_at`, optional
   reference ≤ 200 chars, `entry_method = 'manual'`, `replaces_receipt_id`, set-once void columns.
6. `policy_commission_events` — append-only audit with complete before/after of affected fields, request id +
   payload hash for idempotency: `estimate_recorded` (baseline: initial timing and hold state), `estimate_replaced`,
   `schedule_basis_set`, `installment_timing_set`, `hold_placed`, `hold_released`, `receipt_voided`. References are never
   copied into events.

Guard triggers refuse INSERT/UPDATE unless `current_user` is the writer role, refuse every DELETE and TRUNCATE, and
enforce immutable and set-once columns. Retention: nothing cascades from clients, leads, grids or profiles; deleting a
contact or grid keeps every commission row; a win with an estimate cannot be deleted. Rows hold linked identifiers,
amounts and free-text references that may contain client or statement details: treated as sensitive tenant data (RLS
only, no Agency Group peer access, not echoed into events, toasts or logs, no export in 2A).

## 4. Tracking functions (writer-owned SECURITY DEFINER; EXECUTE `authenticated`)

Each validates the actor (Active, JWT agency), loads targets only in that agency through composite keys, checks the
required access for the credited seller, then writes (RLS re-checks the same rules).

- `confirm_policy_commission_capture(p_request_id, p_capture_id)` — seller/Admin; re-validates the capture against
  current facts; valid → estimate with `sale_entry` provenance (captured_by = original actor, recorded_by = confirmer);
  invalid → stays `needs_attention` with a code.
- `dismiss_policy_commission_capture(p_request_id, p_capture_id, p_reason)`.
- `record_policy_commission_estimate_later(p_request_id, p_policy_id, p_inputs, p_replace_estimate_id,
  p_expected_revision, p_reason)` — re-entry (`recorded_later`) and D4 replacement.
- `set_policy_commission_schedule_basis`, `set_policy_commission_installment_timing`, `set_policy_commission_hold`.
- `record_policy_commission_receipt`, `void_policy_commission_receipt` (optional replacement in the same call).
- Reads: `get_client_policy_commissions(p_client_id)` (invoker: client visibility via clients RLS ∩ commission RLS);
  `get_policy_sale_operation_status(p_kind, p_request_id, p_lead_id, p_sale_args)` (hash recomputed server-side).

Server validation for any estimate: selected active grid id **and revision** equal the presented ones; product active
in that grid, category matches the policy type mapping (Final Expense → whole life candidates), carrier matches after
trim/case; unique variant for age/term equals the presented variant; seller's strict contract level is on the grid and
equals the presented level; rate equals; premium = the win's snapshot (entry) or the stored policy premium for legacy
non-snapshot wins (later, labelled); recomputed cents equal the presented cents. Any difference → `needs_attention`
with a specific code; never a silently different figure.

## 5. Frontend submission and retry classification

The API layer throws `SaleRequestError` (message unchanged; `code`, `status`, `class`), never carrying the submission.
A per-send tracker records whether the HTTP request started.

| Outcome | Signals | Fresh attempt | Retry of a frozen submission |
|---|---|---|---|
| Not sent | error before the tracker marks the request sent | editable | stays frozen |
| Success | 2xx with a valid **sale** shape (commission metadata parsed separately; malformed → saved + commission attention) | success path once | resolves; success path once |
| Confirmed rejection | explicit allowlist: 22023, 22P02, 22007, 22008, 23502, 23503, 23505, 23514, 42501, P0002, 40001, 40P01, 55P03, 57014 (server-reported), PGRST1xx–3xx | editable, same request id | **stays frozen** (a failed retry proves nothing about the earlier attempt) |
| Conflict | PT409 | frozen → status read | resolved-as-conflict: closeable, never editable |
| Unknown | no response, network/abort, 5xx without a recognised code, 40003, 08007, class 08, 57P01–03, 53xxx, XX000–XX002, any unrecognised code, malformed 2xx | frozen | stays frozen |

While frozen: every field (preview controls included) is disabled; the request id, exact sale arguments, row UUIDs
and commission payload are retained in memory only (never logged, toasted, persisted or sent to analytics); the
submit button keeps its label and replays the identical submission through the companion (never the legacy writer,
never a new request id). A status read showing no receipt is not proof of rollback (the original may be in flight).
Closing keeps today's semantics (the Dialer treats it as cancel; server truth appears in the contact view).
A saved sale is never shown as failed: commission toasts are separate ("Policy saved; commission needs attention /
awaits confirmation / not recorded").

## 6. Permissions (server-enforced for the new records)

`policy_commission_authz.access(seller)` mirrors `usePermissions` exactly: Admin role or `is_super_admin` → full;
role key `Agent` / `Team Leader`; missing `role_permissions` row or non-array `c` → defaults; first item with the exact
name decides (JSON `true` only); missing item → deny. Defaults are pinned by
`supabase/tests/fixtures/policy_commission/permission_defaults.json` (TS and SQL parity tests).

| Viewer | Read | Write (estimate, confirm, receipts, voids, timing, basis, hold, replace) |
|---|---|---|
| Credited seller with "View Own Commission Percentage" | yes | yes |
| Admin / `is_super_admin`, same agency | yes | yes |
| Team Leader, `is_ancestor_of` downline, "View Others' Commission Percentage" on | yes | no |
| New assignee after reassignment (not Admin) | no | no |
| Agency Group peer, `anon`, `service_role` | no | no |
| View As | no requests (server sees the real user) | none |

Phase 1 calculator, preview and profile gates are unchanged (screen-level). Known limit kept: `is_ancestor_of`
hierarchy defect (separate follow-up).

## 7. Payments, timing and allocation (unchanged decisions)

- Cents: T = round½↑(first-year), A = round½↑(advance), R = T − A; Months 10/11/12 = ⌊R/3⌋ with leftover cents to
  Month 10 then Month 11; the four always sum to T.
- Timing per installment: `unknown` ("Payment timing unconfirmed"), `month` (first of month; "Expected Oct 2026"),
  `date`. Basis is confirmed per estimate; "Use effective date" is offered, never applied automatically; Sold Date and
  Draft Date are never used. Month 10/11/12 = basis month + 9/10/11 calendar months (day ignored). Advance timing is
  set separately. Manual timing survives basis changes. Calendar dates, no time-zone shift; no "due"/"overdue" in 2A.
- Receipts: partial receipts, per-installment remaining = max(expected − received, 0), excess shown separately; an
  advance overpayment never marks Months 10–12 received. Voids require a reason and may carry a replacement.
  Receipt creation, void/replacement and estimate replacement lock the estimate row (`session → estimate → installment
  → receipt`) and bump `state_revision`; replacement rechecks "no active receipts" under the lock; superseded
  estimates refuse new receipts. Replacement carries over basis, per-installment timing and hold.
- Hold: estimate-level, reason required, audited; receipts still recordable.

## 8. Exact files

**Database and SQL test infrastructure**
- `supabase/migrations/20261019170000_policy_commission_tracking.sql` (new; version kept by the release method)
- `supabase/migrations/rollback/20261019170000_policy_commission_tracking.rollback.sql` (new; refuses if any of the
  six tables has rows; never deletes `client-edit:` sale receipts)
- `supabase/tests/policy_commission_harness.sql`, `policy_commission_security.sql`, `policy_commission_handoff.sql`,
  `policy_commission_tracking.sql` (new)
- `supabase/tests/fixtures/policy_commission/permission_defaults.json` (new)
- `scripts/policy_commission_fixture.py`, `scripts/run_policy_commission_tests.sh` (new)
- `scripts/tests/policy_commission/postgrest_integration.mjs`, `scripts/tests/policy_commission/measure_save_overhead.sh` (new)
- `.github/workflows/policy-commission-tracking.yml` (new)

**Frontend — new**
- `src/lib/policySaleOutcome.ts`
- `src/lib/commission/{capture,installments,trackingSchemas,trackingApi}.ts`
- `src/hooks/usePolicySaleSubmission.ts`, `src/hooks/useClientPolicyCommissions.ts`
- `src/components/contacts/SaleSubmissionNotice.tsx`
- `src/components/commission/preview/ClientSaleCommissionPanel.tsx`
- `src/components/commission/policy/{PolicyCommissionSection,PolicyCommissionSummary,PolicyCommissionDetail,
  InstallmentRow,ReceiptList,RecordPaymentDialog,VoidReceiptDialog,InstallmentTimingDialog,ScheduleBasisControl,
  CommissionHoldDialog,RecordEstimateDialog,CommissionBasis,CaptureAttentionNotice}.tsx`

**Frontend — modified**
- `src/components/commission/preview/{PolicyCommissionEstimate,PolicyCommissionInputs}.tsx`
- `src/hooks/usePolicyCommissionPreview.ts`, `src/lib/commission/policyPreview.ts`
- `src/components/contacts/{ConvertLeadModal,RecordPolicyModal,AddClientModal,ClientPolicies}.tsx`
- `src/lib/{client-policy-display,supabase-conversion,policySaleRecording,supabase-clients}.ts`,
  `src/lib/profile/normalized-policy.ts`
- `src/pages/Contacts.tsx` (create handler: not-sent errors typed; edit lambda routes first-policy edits to the D7
  companion)
- `src/integrations/supabase/types.ts`

**Tests — new**
- `src/lib/__tests__/{policySaleOutcome,saleHandoffApis}.test.ts`
- `src/lib/commission/__tests__/{capture,installments,trackingApi,permissionParity}.test.ts`
- `src/hooks/__tests__/{usePolicySaleSubmission,useClientPolicyCommissions}.test.tsx`
- `src/components/commission/policy/__tests__/{PolicyCommissionSection,RecordPaymentDialog,receiptCorrections,
  scheduleTiming}.test.tsx`
- `src/components/contacts/__tests__/policyCommissionHandoffModals.test.tsx`
- `src/pages/__tests__/contactsClientSaleHandoff.test.tsx`

**Tests — modified (minimal; original behavioural assertions retained)**
- `src/components/contacts/__tests__/{policyCommissionPreviewModals,recordPolicyModal,addClientSale,
  convertLeadModalPolicyFields,clientPolicies}.test.tsx`, `src/lib/__tests__/normalizedPolicy.test.ts`
- Harness-only `QueryClient`/section mocks, only if they fail without one:
  `fullScreenContactView{AdditionalPolicies,Schedule,SaveFailure}.test.tsx`,
  `src/pages/__tests__/contactsFullScreenSaveIntegrity.test.tsx`. Any other existing test needing a change → stop
  and ask.

**Docs:** this file, `docs/plans/2026-10-19-policy-commission-phase-2a/verification.md`, root `implementation_plan.md`,
`WORK_LOG.md`, `AGENT_RULES.md`.

**Unchanged:** sale-writer bodies and ACLs, `FullScreenContactView`, `DialerPage`, `FloatingDialer`, `TwilioContext`,
`policyIdentity`, `clientSaleForm`, the calculator engine, `usePermissions`, `useCommissionCalculator`, existing RLS.

## 9. Verification (local only)

- Fresh baseline on refreshed `main`: root and strict type checks, full Vitest per file with CI's inert Supabase
  environment, scoped ESLint, build.
- Disposable loopback PostgreSQL 16 (CI 17.6 authoritative): security/ACL/role inventory, restricted writer subject to
  its policies, permission matrix and parity, handoff binding and replay, two-session races (duplicate submissions,
  receipt vs replacement, concurrent first-policy edits), payments/overpayment/timing/audit/retention, rollback guard
  and reapply, existing policy-sale and identity suites unchanged.
- Real PostgREST 12.2.3 + `@supabase/supabase-js` against that database: companion responses, PT409 → HTTP 409,
  error codes, permission denials, no direct table writes, private helpers not exposed, status read.
- Measured server and HTTP save overhead (baseline writer vs companion): 1 policy, 5 policies, 25 policies (benchmark)
  and 100 (cap); grid and sale-lock contention; failed commission persistence; cancellation.
  If acceptable overhead cannot be achieved within this design, stop with the evidence before proposing a change.
- Frontend: new/modified suites, commission/contacts/sale/dialer regressions, scoped lint, `npx tsc --noEmit`, strict
  diagnostics vs baseline, build, `git diff --check`; Chromium at 1440 px and 390 px, light and dark.
- Advisors only where the local environment supports them; production advisor deltas belong to Gate 3.

## 10. Gates

1. Plan — approved.
2. Local implementation and verification — this branch: **complete** (`verification.md`); PostgreSQL 17.6 CI still
   to run on a pull request.
3. Production migration/RLS/grant release — separately approved; release method chosen with the tested package.
4. Merge, frontend release and production testing — separately approved.

## 11. Implementation record — deviations from §8 (local build, 2026-10-19)

None of these widens scope, authority or data; each keeps an existing contract intact.

- **`src/lib/profile/normalized-policy.ts` and `src/lib/__tests__/normalizedPolicy.test.ts` are unchanged.**
  `reportsPolicySource.test.ts` pins the Reports policy canon by blob hash. The stored policy identity
  (`clients.primary_policy_id`, each additional entry's `policyId`) is attached display-only in
  `src/lib/client-policy-display.ts` instead.
- **`PolicyCommissionInputs.tsx`, `clientPolicies.test.tsx` and the conditional harness tests are unchanged** (not
  needed). Tests modified: `policyCommissionPreviewModals`, `recordPolicyModal`, `addClientSale`,
  `convertLeadModalPolicyFields` (original behavioural assertions kept; the preview-modal sonner mock gains `warning`
  because commission notices use `toast.warning`).
- **No transport in the sale state module.** `policySaleOutcome.ts` holds only types, classification, freezing,
  parsing and messages (plus `clientSaleRecordsPolicy`). The companion calls (`sendPreparedSale`, `runPreparedSale`,
  `readSaleOperationStatus`) live in `policySaleRecording.ts`; a PT409 conflict reads the operation's server status in
  the transport and carries it on `SaleRequestError.operation`. This also removes an import cycle.
- **`ClientPolicies` lazy-loads the commission section** behind a load boundary (a failed chunk renders nothing). The
  policy list and the sale modals therefore never load the Supabase client themselves, which keeps the full Vitest
  run without Supabase environment (as `.github/workflows/reports-frontend.yml` runs it) at the baseline's failures.
- **Not found is `PT404` (HTTP 404), not `P0002`.** PostgREST maps P0002 to HTTP 500. Both codes are confirmed
  rejections in the sale classifier.
- **Record estimate later:** `PreviewOwner` gains `{ kind: "agent", id }` (the credited agent comes from the saved
  sale) and the preview's ready state carries an optional `creditedAgentId`.
- **Ownership transfer** grants the writer role `CREATE` on `public` and `private` only around the `ALTER FUNCTION …
  OWNER` statements (PostgreSQL requires it) and revokes it in the same migration; the runner's ACL inventory check
  proves the writer keeps only `USAGE` on both schemas.
- **Dark mode:** the new conflict/rejection notice text and the receipt Void action add `dark:text-red-400` (the
  app's dark `--destructive` token is too dark for text on the card background).

## 12. Correction pass — draft PR (approved 2026-10-19; reviewed checkpoint `d262d9a`)

Approved: open a **draft** PR against `main` (unchanged at `84ba4f6`) so the PostgreSQL 17.6/PostgREST workflow and the
existing checks run, and make only the corrections below. Not approved: production migration, RLS/grant application,
production reads or test writes, merge, deployment, reminders, cron, calendar work or dashboards. Every workflow runs on
GitHub-hosted runners against loopback databases built from synthetic fixtures; none uses secrets or production
commands.

1. **Draft PR** stays draft; production approval is requested only after checks pass on the final head.
2. **Cap and wording.** The 100-slot defensive cap stays; policy-entry capacity is unchanged (no existing enforced
   policy-count limit exists) and over-cap payloads keep failing the commission step as a whole with a visible notice.
   "25-policy supported limit" becomes "25-policy benchmark"; 250 ms is a **soft calculation-start budget**, not an
   end-to-end guarantee. `measure_save_overhead.sh` adds contention cases (commission tables locked; grid row locked)
   and reports sample counts, p50/p95/max totals and overhead; 1/5/25/100-slot, empty-payload, failure and contention
   measurements are taken from the PostgreSQL 17.6 CI run.
3. **Unknown tracking outcomes survive dismissal and remount.** `useTrackingMutation` takes an operation key and keeps
   each unresolved write (request id plus the exact submitted call and form values) in an in-memory registry scoped to
   the signed-in user and organization: never browser storage, dropped when the signed-in user changes. Reopening the
   dialog restores the locked state; `restart()` refuses while unresolved; any submit replays the stored call. Only a
   success resolves it; a definitive server refusal of the same request (PT409/22023/PT404) proves nothing committed,
   because every tracking function checks the request's stored result first under a request-scoped lock. Auth,
   permission and transport errors keep it unresolved. Responses that arrive after an identity change are ignored. A
   reopened dialog re-reads the contact's commission data. Applies to every user of the helper: payment, void,
   timing, hold, schedule start, record/replace estimate, confirm and dismiss.
4. **Installment selection.** While the amount is untouched it follows the selected installment's remaining amount
   (empty when nothing remains); an edited amount is cleared on a switch with a visible note. Partial payments and
   overpayments stay valid. Receipt validation moves to a Zod schema (same rules and messages).
5. **Capture lifecycle.** Recording an estimate later while the policy's sale-time capture is still open marks that
   capture `superseded` (terminal), keeps its original inputs and provenance, and records `resolved_by_estimate_id`,
   actor, time and reason; it is never shown or counted as confirmed. Confirm and record-later serialize per policy
   (transaction advisory lock, then the capture row lock), so either order ends with exactly one current estimate and
   a consistent capture. Sale replays report the slot as `superseded`; the contact read, recovery reads and the
   AGENT_RULES definition of "open capture" (`awaiting_confirmation`/`needs_attention` only) agree.
6. **Types and verification.** The hand-written RPC types are compared with types generated (Supabase
   `postgres-meta`) from the disposable migrated schema; only mismatches in the new entries are corrected.

**Exact files for this pass**
- `supabase/migrations/20261019170000_policy_commission_tracking.sql` (capture status/column/constraint, guard,
  record-later and confirm locking; checksum updated)
- `supabase/migrations/rollback/20261019170000_policy_commission_tracking.rollback.sql` (added during the pass: one
  statement drops the new capture → estimate constraint before the tables, because the two tables now reference each
  other; no other rollback change)
- `src/components/contacts/ConvertLeadModal.tsx` (added for the final CI: `uv-profile-sync.yml` requires the app
  typecheck output to equal the base exactly, positions included, and this PR's earlier edits moved one existing
  diagnostic from line 182 to 202. Helpers moved below `handleConvert` and the per-open request id and captures
  merged into one ref; no behaviour change)
- `supabase/tests/policy_commission_tracking.sql`, `scripts/run_policy_commission_tests.sh` (lifecycle tests and the
  confirm vs record-later race in both orders), `scripts/tests/policy_commission/measure_save_overhead.sh`
- `src/hooks/useClientPolicyCommissions.ts`, `src/lib/commission/installments.ts`, `src/lib/policySaleOutcome.ts`,
  `src/integrations/supabase/types.ts` (only if the generated comparison differs)
- `src/components/commission/policy/{RecordPaymentDialog,VoidReceiptDialog,InstallmentTimingDialog,CommissionHoldDialog,
  RecordEstimateDialog,ScheduleBasisControl,CaptureAttentionNotice}.tsx`
- Tests: `src/hooks/__tests__/useClientPolicyCommissions.test.tsx`,
  `src/components/commission/policy/__tests__/RecordPaymentDialog.test.tsx`,
  `src/components/commission/policy/__tests__/trackingRecovery.test.tsx` (new),
  `src/lib/__tests__/policySaleOutcome.test.ts`, `src/lib/commission/__tests__/installments.test.ts`
- Docs: this file, `verification.md` (and `screenshots/`), root `implementation_plan.md`, `AGENT_RULES.md`,
  `WORK_LOG.md`

Unchanged: sale-writer bodies, organization scoping, RLS policies and grants, the restricted writer, seller
ownership, no peer access, idempotency keys, telemetry, TwilioContext and dialer callbacks.
