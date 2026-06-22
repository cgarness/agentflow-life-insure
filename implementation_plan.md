# Implementation Plan — Contacts Build 3: Safe Import Undo + Contact Lifecycle Integrity

**Owner:** Chris Garness · **Date:** 2026-06-19 (rev. 3 — final pre-CP2 corrections)
**Branch:** `claude/contacts-build3-import-lifecycle` (off `main`, latest `470be56`) — **created.**
**Status:** **CHECKPOINT 4 — conversion migration `20260620000200` (SHA-256 `f5913df2…`) APPLIED to production as MCP version `20260621231958`; frontend NOT deployed.** Post-apply verified: both FKs dropped (clients/call_logs lineage), 3 partial indexes + `wins.idempotency_key` live, function owner-postgres/DEFINER/safe-search_path/anon-denied, no data mutated (leads 517, call_logs 54/22, wins 0, clients 0), advisors no-new-ERROR/no-anon, `call_logs` index used by EXPLAIN, types regenerated + cast removed. Repo: tsc clean · vitest 279/279 · 0 ESLint errors · diff clean. Nothing committed/pushed/deployed; CP5/Build 4 not started. **HOLD for post-apply approval.** **(Prior status line retained below.)**

**Status (prior):** **CHECKPOINT 4 — implemented; conversion migration authored NOT applied.** Conversion RPC + lineage/win idempotency + contact-graph transfer + contact-detail/nav fixes (incl. row-level Convert + post-convert client open + `"u1"`/fabricated-activity removal) done on-branch. Repo: tsc clean · vitest 279/279 · 0 new ESLint errors · diff-check clean. SQL conversion suite **validated on a temporary dev branch (created + deleted; all scenarios passed; advisors clean of new high-severity; ACLs verified)**. Import Undo (CP3) live in prod and untouched. Nothing applied/committed/deployed; CP5 not started. **(CP3 entry below retained.)**

**Status (CP3, retained):** Import Undo migration `20260620000100` (SHA-256 `27da0531e67e1eec74063f9d29f3bfbe6ead3a19b0346280d2f9cfc09cc91eda`) APPLIED to prod as MCP version `20260620184619`. Migration `20260620000100` (SHA-256 `27da0531e67e1eec74063f9d29f3bfbe6ead3a19b0346280d2f9cfc09cc91eda`) applied to prod as MCP version **`20260620184619`** after dev-branch validation (all 15 SQL scenarios + advisors + ACLs). Post-apply prod verification: live schema + owner-only helpers + browser-RPC ACLs confirmed; both legacy import rows preview as `legacy_no_ids` (no PII, nothing mutated); EXPLAIN uses the new index; advisor delta = no new ERROR / no new anon access (only the standard authenticated-DEFINER WARNs + one expected unused-index INFO); `types.ts` regenerated + temp casts removed. Repo: tsc clean · vitest 271/271 · ESLint 0 errors · diff-check clean. **Nothing committed/pushed/deployed; CP4 not started. HOLD for post-apply approval.**

> **DECISIONS LOCKED by Chris:** (1) Doc sequence corrected — Build 3 = Import Undo + Lifecycle; permissions → **Build 5**. (2) Conversion lineage = **`clients.lead_id`** (CP4: drop the FK so it survives lead deletion). (3) Win idempotency = **DB-enforced unique key** (CP4). (4) **Import Undo RPCs = narrowly-scoped SECURITY DEFINER**; no general `import_history` UPDATE policy. (5) Campaign provenance = **exact `campaign_leads.import_history_id` tag**. (6) **`finalize_contact_import` RPC** computes completion status server-side. (7) CHECK-constrained status vocab. (8) Hardened `imported_lead_ids` validation. (9) Narrow Team-Leader auth. (10) Generated `types.ts` regen deferred to **CP3**.

---

## 0. Documentation sequence correction (APPROVED)

Prior docs labeled Build 3 as "permissions/PermissionGate wiring." Corrected canonical sequence (in WORK_LOG): **B1 Data Integrity ✓ · B2 Scope/Filters/Sort/Bulk ✓ · B3 Import Undo + Contact Lifecycle (THIS BUILD) · B4 Kanban + List Consistency · B5 Permissions + Ownership QA · B6 UI Closeout.** Permissions stays Build 5; Build 3 safety comes from explicit in-function authorization (§8), not broad RLS.

---

## 1. Startup + git verdict

- `main` == `origin/main` == `470be56`; Build 2 merged + deployed + TDZ hotfix. Branch `claude/contacts-build3-import-lifecycle` created from `main`.
- **Unrelated working-tree files left untouched/unstaged:** `scripts/seed-test-leads.mjs`, `services/hypercheap-voice-bridge/*.py`, `tsconfig.*.tsbuildinfo`.
- 256 migrations on disk (latest `20260619180000_*`); new CP2 migration `20260620000100_*`.
- Read in full: `AGENT_RULES.md` v5.0.0, `VISION.md`, newest `WORK_LOG.md`, Build 1/2 plans. Inspected all conversion/import/undo/contact-detail source + `add_leads_to_campaign` body + `import-contacts` edge. Live read-only Supabase: 14 contact-graph tables, FK delete rules, triggers, `import_history` RLS (SELECT+INSERT only), function inventory, `import_history`/`workflow_executions` row state.

---

## 2. Confirmed root causes (file/line evidence)

- **A — provenance lost.** `ImportLeadsModal.tsx:796` reads `inserted_lead_ids` but builds `importedLeadIds:[]` (`:824`); `ImportLeadsPage.tsx:82-104` persists empty ids, omits `campaign_id`. Edge already returns ids + sets org/agent (`index.ts:346,361`) → **frontend provenance + tagging fix; no edge change**.
- **A.8 — `"u1"` defaults.** `ImportLeadsModal:205`; `FullScreenContactView:230`; `AgentModal.tsx` (Agents tab, out of scope).
- **B — non-transactional undo.** `Contacts.tsx:2700-2716` browser delete + audit-row delete (the audit delete is already RLS-denied — §8).
- **C — campaign rows detach.** Lead FKs ON DELETE SET NULL.
- **D/E/F/G — conversion + contact-detail** (CP4): non-atomic conversion returning `clientId` on failure; incomplete graph; `appointments` has no `contact_type`; `"u1"` + fabricated activities + discarded `clientId` + misleading row-Convert.

**Live state:** `import_history` = 2 legacy empty-ID rows, none in 24h → **zero undo-eligible in prod** (must stay ineligible). `workflow_executions` = 0 rows. No import/convert/undo RPCs exist. Edge import creates **no** `contact_activities`/`contact_notes`.

---

## 3. Contact-lifecycle relationship matrix

| Table | Link column(s) | FK on-delete | Conversion (CP4) | Undo eligibility (CP2) |
|---|---|---|---|---|
| `clients` | `lead_id` (de-FK'd CP4), `assigned_agent_id` | SET NULL→removed CP4 | CREATE; `lead_id=lead.id` (immutable lineage) | client w/ `lead_id=X` ⇒ converted (CP2: reads as `lead_missing`; CP4 → `converted`) |
| `contact_notes` | `contact_id`+`contact_type` | — | move | any (no import-origin note exists) ⇒ block |
| `contact_activities` | `contact_id`+`contact_type` | — | move | any non-import-origin ⇒ block |
| `appointments` | `contact_id` only | — | move `contact_id` only | any ⇒ block |
| `tasks` | `contact_id`+`contact_type` | — | move | any ⇒ block |
| `calls` | `contact_id`+`contact_type`+`lead_id` | lead_id SET NULL | preserve; repoint `contact_id` | any ⇒ block |
| `call_logs` | `lead_id` (de-FK'd CP4 → lineage) | SET NULL→removed CP4 | **preserve as source lineage** (CP4 drops `call_logs_lead_id_fkey` + indexes `lead_id`; RPC never touches duration/status/direction/user/org) | any ⇒ block |
| `messages` | `lead_id`+`contact_id`+`contact_type` | lead_id SET NULL | move `contact_id`; clear `lead_id` | any ⇒ block |
| `contact_emails` | `contact_id` | — | move `contact_id` | any ⇒ block |
| `workflow_executions` | `contact_id`+`contact_type` | — | move after no-active-run | running ⇒ block |
| `wins` | `contact_id` (+ `idempotency_key` CP4) | — | after-commit DB-idempotent (CP4) | any ⇒ block |
| `campaign_leads` | `lead_id` (SET NULL) **+ `import_history_id` (CP2)** | SET NULL | preserve queue telemetry | this import's tag = cleanup; different/null tag ⇒ block |

**Triggers:** `clients` AFTER INSERT → swallowing workflow dispatch; `campaign_leads` I/U/D → campaign-total sync (undo decrements correctly); no `wins` trigger/unique key (CP4 adds); no AFTER DELETE workflow on `leads` (undo is workflow-safe).

---

## 4. Product decisions (D1–D8; revised mechanisms)

D1 strict 24h all-or-nothing · D2 legacy empty-ID not undoable · D3 history audit, marked undone in-function, never deleted · D4 same-import campaign rows by **exact tag** (§6) · D5 conversion core atomic (CP4) · D6 lineage `clients.lead_id`, FK dropped CP4 · D7 history follows the person · D8 campaign queue telemetry preserved, Dialer gating (#11) + `advance_campaign_lead` (#19) untouched. Win = DB-idempotent after-commit (CP4).

---

## 5. Scope A — Import provenance + exact sequencing (CP2)

**Precise ordered sequence (frontend):**

1. Modal posts to `import-contacts`; edge returns **`inserted_lead_ids`** (newly inserted only; updated-duplicates excluded → never rollback candidates).
2. **Reconcile:** compute the **distinct valid-UUID** inserted-id set; compare its size to the edge's reported `imported`; on mismatch surface a non-fatal warning and persist the **actual ids** (ids, not the count, are the rollback source of truth).
3. If `insertedIds.length > 0`, modal calls parent **`persistImportHistory(entry)`** → inserts `import_history` with real `imported_lead_ids`, `campaign_id` (when chosen), authenticated `agent_id`, `organization_id`, `import_completion_status = 'pending_campaign'` (campaign) or `'completed'` (none). Returns the real `import_history.id`.
4. Receive the history UUID.
5. If a campaign was chosen, modal calls **`addLeadsToCampaignBatched(campaignId, insertedIds, importHistoryId)`** → the extended enqueue RPC stamps `campaign_leads.import_history_id` on every inserted row.
6. Modal calls **`finalize_contact_import(importHistoryId)`** → server computes/persists the final status from actual DB state and defensively re-tags untagged same-import rows. **Even on enqueue throw/partial, finalize is still called** so the audit row reflects truth.
7. Display the **finalized, DB-derived** status + counts. Do **not** navigate away as full success until finalize completes.

Remove the `currentUserId = "u1"` default; block completion without auth/org. Only `ImportLeadsPage` writes `import_history`.

**Failure behavior (never "fully successful" while incomplete):**

| Case | DB result | status | Undo | UI |
|---|---|---|---|---|
| Leads imported, **history insert fails** | leads exist, no history row | n/a | Not undoable | Recoverable screen: "Leads created, but import provenance failed to save." **Retry provenance** re-runs only `persistImportHistory` with the already-returned ids — **never re-imports**. Campaign attach deferred until history exists. |
| **Campaign attach fully fails** | history row, 0 tagged | `campaign_failed` | Undoable (leads only) | "Imported — campaign attach failed." Leads kept. |
| **Campaign attach partial** | some tagged | `campaign_partial` | Undoable (tagged rows + all leads) | "Imported — N of M added." Leads kept. |
| Rule-skips only | tagged==eligible<imported | `completed_with_skips` | Undoable | "Imported — N added, M skipped by campaign rules." |
| All succeed | tagged==eligible==imported / no campaign | `completed` | Undoable (24h, no engagement) | "Import complete." |

---

## 6. Exact campaign provenance — `campaign_leads.import_history_id`

The "1-hour window" heuristic is dropped (same-import `created_at` predates `import_history.created_at`). Replaced by an exact tag:

- Migration adds nullable **`campaign_leads.import_history_id uuid`**, FK → `public.import_history(id)` **ON DELETE SET NULL**, + partial `idx_campaign_leads_import_history_id`.
- **Tag-at-insert (hardened):** `public.add_leads_to_campaign(p_campaign_id, p_lead_ids)` → `(…, p_import_history_id uuid DEFAULT NULL)` (DROP 2-arg → CREATE 3-arg; 2-arg callers keep working via the default). When the id is provided it **validates** before tagging (via `_import_undo_context`): caller authorized for the import (same predicate as undo), import in home org, **`import.campaign_id = p_campaign_id`**, not undone, status still `pending_campaign`, and **every supplied lead id ∈ the import's recorded set** — else `RAISE` (reject the call, never silently omit). The tag is written **in the `INSERT`** (only newly inserted rows; duplicates/pre-existing memberships are never tagged or retagged). When the id is NULL the behavior is the original generic Add-to-Campaign exactly. Security posture (§11): SECURITY DEFINER, owner `postgres`, `search_path = pg_catalog, pg_temp`, fully-qualified, REVOKE PUBLIC/anon, GRANT `authenticated` + `service_role`. **⚠ The only object beyond the original §11 list — flagged; full SQL shown.**
- **No defensive tagging in finalize.** `finalize_contact_import` only *reads* tags; it never creates or repairs them by guessing. A failed/partial attach simply yields a non-`completed` status (§7b) and the row stays foreign (blocking undo where applicable).
- **Undo deletes only `campaign_leads` where `import_history_id = p_import_id`.** Different/null tag for an imported lead ⇒ **block**. Legacy imports stay non-undoable.

---

## 7. Three SECURITY DEFINER functions + a private helper

`public.preview_contact_import_undo(uuid)` (read-only), `public.undo_contact_import(uuid)` (transactional), `public.finalize_contact_import(uuid)` (status) — all **SECURITY DEFINER**. A shared internal helper `public._import_undo_context(uuid)` (SECURITY DEFINER; **REVOKE ALL FROM PUBLIC, anon, authenticated** — callable only by the three RPCs as owner) centralizes identity, authorization, and id validation. All:

- Accept **only `p_import_id`**; derive identity from `auth.uid()`, org from `public.get_org_id()`. **Never** accept caller-supplied org/user/role/status/counts/lead-ids/campaign-id/timestamps.
- Load the import row directly; require **caller's home org**; load+validate caller profile; Super Admin pinned to home org; reject unknown/null importers for ordinary users.
- Fully qualify every object; fixed `search_path = pg_catalog, public, pg_temp`; `REVOKE … FROM PUBLIC, anon`; `GRANT EXECUTE … TO authenticated` (the three public RPCs only).
- Return **counts/statuses/reason codes only** — no PII.

`preview`/`undo` enforce the server **24h** window, reject **legacy empty-ID**, run engagement checks. `undo` revalidates **inside the transaction**, deletes only the validated set (tagged `campaign_leads` first, then leads), updates `import_history` in-function (`undo_status='undone'`, `undone_at`, `undone_by`, `undo_deleted_count`, `undo_metadata`), returns counts; any failure rolls back. `finalize` requires only authorization + valid ids, is **idempotent** (transitions only from `NULL`/`pending_campaign`), computes status server-side (§7b).

### Hardened `imported_lead_ids` validation (in `_import_undo_context`)

Never cast malformed JSON text directly to `uuid`. Validate explicitly:
- empty array / `NULL` ⇒ **`legacy_no_ids`**.
- any non-string element / UUID-regex failure / `null` element / duplicate ⇒ **`invalid_import_provenance`**.
- any existing lead among the ids with `organization_id` ≠ import org ⇒ **`invalid_import_provenance`**.
- the validated set is the **only** set `undo` may delete (`WHERE leads.id = ANY(validated_ids)`).

### Engagement / blocking checks (preview + undo)

missing/deleted lead, any `calls` (compat linkage `lead_id` OR null-typed `contact_id`), `call_logs`, `messages`, `contact_emails`, `appointments`, `tasks`, `contact_notes`, `contact_activities` **other than import-origin** (`activity_type='import'`/`metadata->>'source'='import'`; none exist today), running `workflow_executions`, any `wins`, any `campaign_leads` membership **not** tagged with this `import_history_id`. **Reason codes:** `not_authenticated`, `no_org`, `not_found`, `cross_org`, `not_authorized`, `expired`, `legacy_no_ids`, `invalid_import_provenance`, `already_undone`, `lead_missing`, `has_calls`, `has_messages`, `has_emails`, `has_appointments`, `has_tasks`, `has_notes`, `has_activity`, `has_workflow`, `has_win`, `foreign_campaign_membership`.

### Caller-authorization predicate (`_import_undo_context`)

```text
v_uid := auth.uid();                  -- NULL -> 'not_authenticated'
v_org := public.get_org_id();         -- NULL -> 'no_org'
SELECT * INTO v_imp FROM public.import_history WHERE id = p_import_id;   -- none -> 'not_found'
IF v_imp.organization_id IS DISTINCT FROM v_org -> 'cross_org'           -- enforces home-org
SELECT role, organization_id, is_super_admin INTO v_prof
  FROM public.profiles WHERE id = v_uid;                                -- none / other org -> 'not_authorized'
authorized :=
     (v_imp.agent_id = v_uid)
  OR (v_prof.role = 'Admin')
  OR (v_prof.is_super_admin AND v_prof.organization_id = v_org)
  OR (v_prof.role IN ('Team Leader','Team Lead')
        AND v_imp.agent_id IS NOT NULL
        AND public.is_ancestor_of(v_uid, v_imp.agent_id));   -- canonical recursive ltree only; no team-id approx
IF v_imp.agent_id IS NULL AND NOT (Admin OR home-org Super Admin) -> 'not_authorized'
IF NOT authorized -> 'not_authorized'
```

**Team-Leader auth is narrow:** same org + non-null importer + `is_ancestor_of(auth.uid(), importer)` via `hierarchy_path` + caller role exactly `Team Leader`/`Team Lead`. No team-id approximation.

---

## 7b. Status vocabulary, transitions, server-side computation

`import_completion_status` (CHECK; `NULL` for legacy): `pending_campaign` · `completed` · `completed_with_skips` · `campaign_partial` · `campaign_failed`. `undo_status` (CHECK): `NULL` or `undone`.

- **Initial (on insert):** `pending_campaign` if a campaign was chosen, else `completed`.
- **Durable DB-generated metadata.** Each successful `add_leads_to_campaign(…, p_import_history_id)` call accumulates, **in its own transaction**, `import_history.import_completion_metadata = {attempted, added, skipped, batches, last_attempt_at}` (summed across the frontend's 500-row batches, from the actual result). No browser-supplied count is ever authoritative.
- **`finalize` derives status from immutable rows only** (`imported_count` = distinct valid ids; `attempted/added/skipped` from metadata; `tagged` = `COUNT(campaign_leads WHERE import_history_id=id)`), transitioning only from `NULL`/`pending_campaign`. It performs **no tagging**.

**Truth table (campaign chosen):**

| condition (DB-derived) | status |
|---|---|
| no campaign (`campaign_id IS NULL`) | `completed` |
| metadata absent **or** `attempted = 0` | `campaign_failed` |
| `attempted < imported_count` (a batch failed before all attempted) | `campaign_partial` |
| `attempted = imported_count` ∧ `tagged = added` ∧ `added + skipped = attempted` ∧ `skipped = 0` | `completed` |
| `attempted = imported_count` ∧ `tagged = added` ∧ `added + skipped = attempted` ∧ `skipped > 0` | `completed_with_skips` |
| any other (`tagged ≠ added`, count mismatch) | `campaign_partial` |

This lets the DB **distinguish** an interrupted partial (`attempted < imported_count` ⇒ `campaign_partial`) from honest rule/duplicate skips (`attempted = imported_count` ∧ `skipped > 0` ⇒ `completed_with_skips`) — so `completed_with_skips` is kept (it is DB-distinguishable).

- **Allowed transitions:** `NULL`/`pending_campaign` → terminal; terminal → itself (idempotent no-op); `undo` sets `undo_status` independently and never rewrites `import_completion_status`. The browser never sets a status — only `finalize`.

Exact vocabulary reused in: migration CHECKs · RPC results · local TS types in `supabase-import-undo.ts` · Contacts/CampaignDetail UI · tests.

---

## 8. SECURITY DEFINER threat model + owner assumptions

**Why DEFINER, not INVOKER.** A valid undo must be blocked by engagement the caller cannot see under RLS (a `call`/`email`/`appointment`/`task` owned by a different user on an imported lead). Under INVOKER those rows are invisible → an INVOKER preview/undo could declare an import "clean" and delete worked leads. DEFINER reads the full org-scoped engagement set, making all-or-nothing real.

**Owner/privileges.** Created by the migration role `postgres` ⇒ **owner = `postgres`**, which **owns the public tables**; postgres-owned objects are **not subject to RLS unless `FORCE ROW LEVEL SECURITY`** (not set here) → reads/writes inside the function **bypass RLS**. (Recorded exactly from `pg_class.relforcerowsecurity`/`pg_roles` at apply.)

**How explicit checks replace RLS.** Because RLS is bypassed inside, the sole boundary is in-function logic: `auth.uid()` + `public.get_org_id()` (never trusted input); import must be home-org; role predicate (§7); Super Admin pinned home-org; unknown/null importer rejected for ordinary users; every engagement/delete query constrained to `organization_id = v_org` **and** the validated set; counts/codes only; fixed `search_path` + fully-qualified names; `PUBLIC`/`anon` revoked, `authenticated` only. **No general `import_history` UPDATE policy is added** (the audit write happens inside the DEFINER function). The internal helper is revoked from `authenticated` too.

---

## 9. Conversion lineage correction — `clients.lead_id` (CP4 only)

Live `clients.lead_id → leads.id ON DELETE SET NULL` would null the key on lead deletion. **CP4** (not CP2): inspect FK-dependent code; **drop `clients_lead_id_fkey`**; keep `clients.lead_id` as an **immutable source-lead UUID**; add partial unique index `… ON public.clients(lead_id) WHERE lead_id IS NOT NULL`; document "lineage, not a live FK"; add AGENT_RULES invariant.

---

## 10. Win idempotency correction (CP4 only)

DB-enforced: nullable `wins.idempotency_key text` + unique index; conversion win = `insert … on conflict (idempotency_key) do nothing` with `'conversion:'||<lead-id>`; concurrent retries can't duplicate; additional-policy/future wins (different/null key) unaffected; runs after commit so celebration failure can't roll back the sale.

---

## 11. Checkpoint 2 migration objects (ONE migration file — applied at CP3)

`supabase/migrations/20260620000100_import_undo_provenance_and_rpcs.sql` (all functions: SECURITY DEFINER, owner `postgres`, `SET search_path = pg_catalog, pg_temp`, fully-qualified):
- `ALTER TABLE public.import_history ADD` (nullable, additive): `import_completion_status text` (+ CHECK), `import_completion_metadata jsonb`, `undo_status text` (+ CHECK), `undone_at timestamptz`, `undone_by uuid`, `undo_deleted_count integer`, `undo_metadata jsonb`.
- `ALTER TABLE public.campaign_leads ADD COLUMN import_history_id uuid` + FK → `public.import_history(id)` ON DELETE SET NULL + partial `idx_campaign_leads_import_history_id`.
- Private helpers (REVOKE ALL incl. `authenticated` **and `service_role`** — owner-only `{postgres=X/postgres}`, confirmed on the dev branch): `public._import_undo_context(uuid)` + `public._import_undo_blockers(uuid, uuid, uuid[])`.
- Public RPCs (REVOKE PUBLIC/anon, GRANT `authenticated`): `public.preview_contact_import_undo(uuid)` + `public.finalize_contact_import(uuid)` + `public.undo_contact_import(uuid)`.
- **⚠ `add_leads_to_campaign` extended** to `(p_campaign_id, p_lead_ids, p_import_history_id uuid DEFAULT NULL)` — DROP old 2-arg, CREATE 3-arg, all type-scope/dedup logic verbatim + provenance validation + tag-in-INSERT + metadata accumulation; REVOKE PUBLIC/anon, **GRANT `authenticated` + `service_role`** (flagged object beyond the original list; full SQL in the migration).
- `NOTIFY pgrst, 'reload schema';`.

**NOT in the CP2 migration:** general `import_history` UPDATE policy; `convert_lead_to_client_atomic`; any `clients.lead_id` FK/constraint/index change; any `wins` schema/idempotency change; any Twilio/Dialer-claim change.

---

## 12. Checkpoint 2 file list

- `src/components/contacts/ImportLeadsModal.tsx` — real ids; remove `"u1"`; 7-step sequence (reconcile → persist → tag-attach → finalize → DB-derived display); recoverable provenance-retry; honest completion.
- `src/pages/ImportLeadsPage.tsx` — `persistImportHistory` returns the id (real ids/campaign_id/auth/org/initial status); `finalizeImport` calls the RPC + logActivity; surface history-insert + attach errors.
- `src/lib/supabase-campaign-leads.ts` — `addLeadsToCampaignBatched(campaignId, ids, importHistoryId?)` passes `p_import_history_id`.
- `src/lib/supabase-import-undo.ts` **(new)** — **local typed** request/result interfaces + wrappers for `preview_contact_import_undo`/`finalize_contact_import`/`undo_contact_import` via a **surgical `(supabase as any).rpc` cast** (generated types not yet aware — regen is CP3).
- `src/pages/Contacts.tsx` — replace the browser undo block with preview + `undo_contact_import`; import-history **status UI** (Active / Undone / Undo unavailable / Expired) + disabled-with-reason; show **actual** rollback count; keep the row visible as Undone. **(Import-history/undo portions only — no conversion row-action / nav / FSCV change here.)**
- `src/pages/CampaignDetail.tsx` — import-history `import_completion_status`/undo status display parity (read-only).
- `implementation_plan.md`, `WORK_LOG.md`.

**Generated types deferred:** `src/integrations/supabase/types.ts` is **NOT** edited in CP2 (regenerated in CP3 after apply; temporary casts removed then).
**NOT touched in CP2:** `supabase-conversion.ts`, `win-trigger.ts`, `ConvertLeadModal.tsx`, conversion navigation, `FullScreenContactView.tsx` lifecycle/convert paths, conversion migration, `clients.lead_id` index/constraint, win schema/idempotency, edge functions, Twilio/Dialer.

---

## 13. Checkpoint 2 test strategy

**Automated SQL integration tests** (`supabase/tests/import_undo_integration.sql`, transactional + `ROLLBACK`) run against a **local Supabase stack (CLI) or an approved Supabase dev branch**, fixtures seeded **only there** — covering: eligible atomic undo (leads + tagged `campaign_leads`) + repeated-undo rejection; hidden cross-user engagement (a call owned by another agent) blocking undo + transaction integrity (lead NOT deleted); legacy/expired ineligibility; cross-org rejection; **and the extended `add_leads_to_campaign`**: generic 2-arg unchanged + nothing tagged; 3-arg tags only newly-inserted rows + accumulates metadata + `finalize → completed`; `completed_with_skips` via real rule-skips; `campaign_partial` when a later batch never attempted; campaign-mismatch / cross-org-history / lead-outside-set rejected; pre-existing membership skipped and never retagged; **ACLs** (anon denied, authenticated + service_role allowed, private helper denied to authenticated). **Run on local/dev before CP3 — not production-first.** Plus **TS unit tests** (`vitest`): `importUndo.test.ts` (id hygiene, row-status hints, reason messages, RPC wrappers) and `campaignLeadsBatch.test.ts` (500-row batching, exact aggregate counts across >500 leads, `p_import_history_id` forwarding, error propagation).

**Production after apply (CP3) = inspection only:** function-definition + ACL inspection, security + performance advisors, query plans, read-only counts, confirm the 2 legacy imports stay ineligible. **No fake prod leads/imports; no "proven via prod SQL" behavioral claims.**

---

## 14. Checkpoint rollout

- **CP1 (done):** audit + decisions + plan.
- **CP2 (now):** implement §12; author §11 migration as a **file** (apply nothing); §13 tests; `tsc`/`vitest`/targeted ESLint/`git diff --check`. **Run the SQL integration suite on a local Supabase stack or an approved dev branch before CP3** — prod must never be the first DB the destructive undo runs on. If a dev branch needs cost approval, **stop and request it** rather than applying to prod. **Stop for migration review.**
- **CP3 (only after the SQL suite passes on local/dev):** apply the migration to prod → advisors → function/ACL/plan inspection + read-only counts → confirm legacy ineligible → **regenerate `types.ts`** + drop temporary casts → re-typecheck/test. Hold before deploy.
- **CP4:** conversion + lifecycle + win idempotency + contact-view (Scopes D/E/F/G) — conversion migration (drop `clients_lead_id_fkey`, partial unique index, `wins.idempotency_key`) as a file; tests. Review gate.
- **CP5:** apply conversion migration → advisors/inspection → regen types. Hold.
- **CP6:** commit (Build-3 files only) → PR → merge → Vercel deploy → non-destructive smoke → WORK_LOG shipped entry.

---

## 15. Rollback plan (no destructive column drops once audited)

Frontend `git revert`; `REVOKE EXECUTE` then `DROP`/`CREATE OR REPLACE` the RPCs; **leave** additive `import_history` audit/completion columns and `campaign_leads.import_history_id` in place once they hold production data; restore the prior 2-arg `add_leads_to_campaign` if needed. An empty unreferenced index may be dropped. Idempotency (CP4) converges a retried conversion to one client.

---

## 16. Deferred / out of scope

Permissions (Build 5), Kanban full-data (Build 4), Contacts visual refactor (Build 6), multi-column sort, SMS/Email blast, Twilio/call-duration/queue-claim changes, `calls.contact_type` writer normalization (telephony), unrelated messages-RLS audit, `app_config`/`webhook_debug_log` hardening, `clients.premium_amount` cleanup, `AgentModal.tsx` `"u1"`, fake production records. **Scope H (delete audit) = report-only. Conversion/lifecycle/win/contact-view = CP4, not CP2.**

---

## 17. Process gates

CP2 authors code + ONE migration file + tests on this branch; **applies no migration, mutates no production, deploys nothing, commits nothing.** Stops for migration review with the full migration SQL, focused diff, tests, and file list.
