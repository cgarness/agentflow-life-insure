# Implementation Plan — Lead-import campaign ownership/attachment/visibility/retry + CSV custom-field auto-detection

**Status:** **AS-BUILT — LOCAL IMPLEMENTATION COMPLETE on branch `bugfix/import-campaign-attachment`** (cut from a freshly fetched `origin/main` = **`4798ce4a372bf6b361c7b8851b065fca3a39fa01`**). **NOT committed, NOT pushed, NOT merged, NOT deployed. No migration applied to production, no Edge Function deployed, no production data mutated, neither repair runbook executed.**
**Date:** 2026-08-07
**Type:** Backend (3 migration files, 5 new + 3 changed database functions) + frontend + tests. **No Edge Function change** (D-6 A). **No RLS policy change** (D-7 A).

### As-built delta from the approved plan

1. **`public.can_dial_campaign(uuid)` added** (approved as C-4) — server-authoritative Dialer authorization consumed by every entry point.
2. **`CampaignDetail.tsx` has no "Start Dialing" control.** Inspection during implementation confirmed its ONLY dialing path is the per-lead quick-call (`handleQuickCall` → `FloatingDialer` → `TwilioContext.makeCall()`). Both the button and the handler are now gated on `can_dial_campaign`; there was no separate Start-Dialing button to gate.
3. **Two extra private helpers** beyond the plan (`private.campaign_actor`, `private.can_administer_campaign`, `private.assert_may_assign_to`, `private.import_attachment_status`) so actor resolution, campaign authorization, assignment authorization and status derivation are shared rather than duplicated across four public RPCs. All are revoked from PUBLIC/anon/authenticated.
4. **`.github/workflows/sql-tests.yml` added** (D-5 A) — the repository's first CI workflow.
5. **`AddToCampaignModal` needed one extra structural change**: its single `useEffect` was split into a reset effect and a fetch effect so the new dependencies could be declared honestly without letting an org/user identity change wipe an in-progress selection.
6. **`src/components/contacts/importCampaignSchemas.ts` IS created** (corrective pass, 2026-08-07). My earlier decision to omit it was rejected and is reversed. See §16.
7. **SQL suite is NOT EXECUTED** — see §14.
8. **`.github/workflows/sql-tests.yml` is `workflow_dispatch` only** (corrective pass) — it must not add a guaranteed-red required check while the baseline-migration drift is unrepaired. See §17.
9. **`start_dialer_session` grants tightened** (corrective pass) — its live pre-change ACL granted EXECUTE to **PUBLIC and anon**, and `CREATE OR REPLACE` does not reset an ACL, so M3 would have inherited them. See §18.
10. **`supabase/rollback/20260807_import_campaign_attachment_rollback.sql` added** — executable rollback holding md5-verified verbatim prior definitions. See §19.

### Locked decisions (Chris, 2026-08-07)

| # | Locked | Detail |
|---|---|---|
| **D-1** | **Option A** | New RPCs read the caller's role from **`public.profiles`** — and additionally validate the profile is **active** and belongs to the **authoritative organization** (`public.get_org_id()`). |
| **D-2** | **Option A** | Team Leaders **fail closed** (`is_ancestor_of` only). No hierarchy repair, no org broadening, in this PR. |
| **D-3** | **Option A** | Team + Unassigned ⇒ `assigned_agent_ids = [caller]`, with explicit UI/doc note that an authorized manager must add the intended agents first. |
| **D-4** | **Option A** | Retry is **not** limited by the 24-hour undo window. Allowed only for an **incomplete, non-undone** import, using its **immutable campaign and lead provenance**. |
| **D-5** | **A → B → stop** | Ship the SQL suite; attempt it via **local Docker** and the proposed **GitHub Actions** environment. **Do not repair unrelated historical migration drift in this PR.** If drift blocks execution: report **NOT EXECUTED**, name the exact blocker, and **stop before proposing a paid dev branch**. Never run mutation tests against production. |
| **D-6** | **Option A** | `import-contacts` Edge Function **unchanged**. The target-agent authorization gap is a **required follow-up that must be completed together with the `hierarchy_path` repair**. |
| **D-7** | **Option A** | **No change** to `campaign_leads` UPDATE / DELETE / SELECT RLS. Existing cross-user permissions recorded as a separate security-hardening task requiring full dialer regression coverage. |
| **C-4** | **Accepted** | `public.can_dial_campaign(uuid)` is the **server-authoritative authorization source** for Campaign Detail, the campaign picker, direct campaign parameters, Start Dialing, and quick-call UI gating. `TwilioContext.tsx` is **not** modified. No D-7 RLS changes. |

### Quick-call limitation — stated precisely (required wording)

- When `can_dial_campaign` returns **false**, Campaign Detail **hides or disables** Start Dialing and quick-call and **never invokes `makeCall()`**.
- `start_dialer_session` **independently rejects** unauthorized Personal-campaign sessions at the database.
- **Campaign Detail quick-call is NOT non-bypassable at the database layer.** It does not pass through `start_dialer_session`, so its enforcement is a server-authoritative *decision* (`can_dial_campaign`) consumed by a cooperating client — **not** a database-level block. This residual limitation is documented here, in `AGENT_RULES.md`, in `WORK_LOG.md`, and in the PR body.
- Admins may still dial the same lead through their **authorized Contacts access** (`Leads Hierarchical Access` grants org-wide lead access by design). **This task blocks using another agent's Personal campaign as the dialing context** — it does not, and is not intended to, remove an Admin's legitimate access to the lead itself.

### Mandatory pre-V1 security follow-ups (not optional cleanup)

1. **Repair and verify `profiles.hierarchy_path`** so `public.is_ancestor_of` functions (currently returns false for every pair; all 6 profiles are depth-1 self-labels).
2. **Close the `import-contacts` Edge Function target-agent authorization gap** (`index.ts:150-168`, org-membership only) **using the repaired canonical hierarchy** — must land with follow-up 1.
3. **Review and harden Personal-campaign SELECT visibility for Team Leaders** (live `campaigns_select` / `campaign_leads_select` grant `'Team Leader'` the same role short-circuit as `'Admin'`).
4. **Review and harden `campaign_leads` UPDATE/DELETE RLS** with complete **queue, callback, retry, disposition, and redial-loop** regression coverage (see AGENT_RULES invariant #19 for the outage class this risks).

> Supersedes the lead-score plan (shipped as PR #350, squash-merged to `origin/main` as `ec80150`; durable record in the 2026-08-06 `WORK_LOG.md` entry).

---

## 0. Baseline, branch, and conflict check (AGENT_RULES §8 step 1)

| Item | Finding |
|---|---|
| `origin/main` | **`4798ce4`** — `fix(telephony): repair new caller ID ownership (#351)`, on top of `ec80150` (#350), `2ca129b` (#349), `4d54d01` (#348), `a411892` (#347) |
| Current local branch | `bugfix/hide-lead-score-ui` @ `12c93f1` — **already merged upstream as #350**; stale/behind `origin/main` by 2 commits |
| **PR #347** | **NOT open — MERGED 2026-08-06T02:59:31Z** as `a411892`. Nothing to avoid basing on and nothing to un-bundle. Its files (`useLeaderboardData.ts`, `Leaderboard.tsx`, `LeaderboardWidget.tsx`, `src/integrations/supabase/types.ts`, `supabase/migrations/20260805090000_*`, `supabase/tests/leaderboard_aggregate_rpc.sql`) are already in `main`. |
| Open PRs (all) | **Exactly one: #294** `Modernize OpenAI Realtime to GA schema (gpt-realtime-2)` (`claude/openai-realtime-s2s-testing-7XJ0T`, last touched 2026-06-02). Zero file overlap with this work. |
| **Branch plan (needs approval)** | Cut **`bugfix/import-campaign-attachment`** from **`origin/main` (`4798ce4`)**. Do not build on the stale merged branch. |
| WORK_LOG conflict scan (newest 6 entries) | Lead-score UI (#350), calendar list filter (#349), leaderboard metric switch (#348), leaderboard RPC ×3 (#347). **Zero overlap** with import/campaign/custom-field/dialer-access files. Only shared files are `implementation_plan.md` (superseded here) and `WORK_LOG.md` (append-only). |
| Working tree | Clean except standing noise: `deno.lock` (M), `.claude/`, `.cursor/settings.json`, `tsconfig*.tsbuildinfo` (untracked) — excluded from commits as always |
| Migration drift (repo vs live) | 265 files on disk / 262 applied rows. **3 genuinely unapplied**: `phone_system_rls_harden`, `call_recordings_storage_update_policy`, `20260614120000_leaderboard_rpc_tiebreak`. None mentions `campaign` (verified `grep -ci campaign` = 0 each). `20240401_standardize_state_rls` is a filename-prefix artefact, applied as `standardize_state_rls`. **No drift affecting this work.** |
| Edge Function drift | `import-contacts` live **version 43**, `verify_jwt = false`, updated 2026-06-29T23:21Z. Fetched via MCP `get_edge_function` and diffed against `supabase/functions/import-contacts/index.ts`: **identical apart from em-dash→hyphen in comments.** No stale-deploy risk. |

---

## 1. Confirmed root causes (each proven against live code + live database)

### 1.1 The 106-lead incident — exact production evidence

Read-only, resolved by immutable UUID (names are annotation only):

| Object | UUID | Facts |
|---|---|---|
| Organization | `a0000000-0000-0000-0000-000000000001` | the only org with campaigns/imports |
| `import_history` | **`d7811230-abf6-47b5-bf8b-6aacfac976ef`** | `agent_id = ecf2bb91…`, `campaign_id = 8b680353…`, `106/106/0/0`, `import_completion_status = 'completed_with_skips'`, metadata `{"added":0,"tagged":0,"batches":1,"skipped":106,"attempted":106,"finalized_at":"2026-08-05T17:25:46.678927+00:00"}`, `undo_status = NULL`, `created_at 2026-08-05 17:25:45.64344+00`, `jsonb_array_length(imported_lead_ids) = 106` |
| Campaign | **`8b680353-d9c8-4d1c-a479-d29896bde760`** | name `testoingg`, **type `Personal`**, **`user_id = ecf2bb91…` (the Admin importer)**, `created_by = ecf2bb91…`, **`assigned_agent_ids = []`**, `status Active`, `total_leads 0`, created 3.9 s before the import row |
| Importer (Admin) | **`ecf2bb91-0350-4542-85ec-14d914311e99`** | `role Admin`, `platform_role platform_admin`, `is_super_admin true`, org `a000…0001` — "Chris Garness" |
| Intended owner (Agent) | **`812e26e7-3f77-45d5-84fa-ff519886ac7b`** | `role Agent`, `upline_id = ecf2bb91…`, org `a000…0001` — "chris test" |
| The 106 leads | in `import_history.imported_lead_ids` | **106/106 still exist**; all carry `assigned_agent_id = user_id = 812e26e7…`, `imported_by_user_id = ecf2bb91…`, `status 'New'`, identical `created_at = updated_at = 2026-08-05 17:25:45.158685+00` (single bulk insert, never modified) |
| Attachment | — | `campaign_leads WHERE campaign_id = 8b680353…` = **0**; `WHERE import_history_id = d7811230…` = **0** |

**Chain, each link verified:**

1. `src/pages/ImportLeadsPage.tsx:143-155` creates the campaign with a direct table INSERT writing only `name, type, description, status, total_leads, organization_id, created_by`. **`user_id` and `assigned_agent_ids` are never written.**
2. The prop contract itself is the structural defect: `onCampaignCreated?: (campaign: { name; type; description }) => Promise<{id}|null>` (`ImportLeadsModal.tsx:207`), invoked at `ImportLeadsModal.tsx:782-786`. **The selected agent is not in the contract at all.**
3. `campaigns.user_id DEFAULT auth.uid()` therefore stamps the Admin — and it *has* to, because live RLS `campaigns_insert` is `WITH CHECK ((organization_id = get_org_id()) AND (user_id = auth.uid()))`. A browser insert **cannot** create an agent-owned campaign; it would fail, not merely misattribute.
4. Live `public.add_leads_to_campaign(uuid,uuid[],uuid)`, Personal branch, verbatim:
   ```sql
   IF v_campaign_type = 'Personal' THEN
     IF v_lead.assigned_agent_id IS DISTINCT FROM v_campaign_user_id THEN
       v_skipped_ids := array_append(v_skipped_ids, v_lead_id);
       v_skipped := v_skipped + 1; CONTINUE;
     END IF;
   ```
   `ecf2bb91… IS DISTINCT FROM 812e26e7…` → true for all 106 → `v_added = 0` → the `IF v_added > 0 THEN INSERT` block never runs. HTTP 200, `{added:0, skipped:106}`, **no error**.
5. `public.finalize_contact_import` then computes `tagged(0) = added(0)` AND `added+skipped(106) = attempted(106)` → **`completed_with_skips`**, which the UI reads as a benign partial.
6. `ImportLeadsModal.tsx:1656-1659`: the green `CheckCircle2` and the string `"Import Complete!"` are gated **solely on `savingProvenance`**, never on `finalizeStatus`. Even `campaign_failed` renders the green icon.

### 1.2 Additional confirmed defects

| # | Defect | Evidence |
|---|---|---|
| D1 | `add_leads_to_campaign` omits `campaign_leads.user_id` from its INSERT column list, so `DEFAULT auth.uid()` records the *clicker* | Live INSERT list is exactly `(campaign_id, lead_id, first_name, last_name, phone, email, state, age, status, organization_id, import_history_id)`. **Already drifted in production: 32/32 rows in Open Pool campaign `e1556ede-7d36-4b9a-bf01-6da142581e59` have `campaign_leads.user_id = ecf2bb91…` while `leads.assigned_agent_id = 7c692e64…`.** Personal drift is 0/38 *only because the eligibility check has so far filtered out every case that would expose it.* **Fixing 1.1 without fixing D1 converts the bug into invisible leads** — `campaign_leads_select`'s Agent+Personal branch requires `(claimed_by = auth.uid()) OR (user_id = auth.uid())`, so the owning agent could not see their own queue while the card showed 106. |
| D2 | Team eligibility uses owner/downline inference, never `assigned_agent_ids` | Live Team branch: `IF NOT (v_lead.assigned_agent_id = v_campaign_user_id OR public.is_ancestor_of(v_campaign_user_id, v_lead.assigned_agent_id)) THEN skip`. |
| D3 | **`public.is_ancestor_of` returns FALSE for every pair in this database.** I re-verified personally: `SELECT public.is_ancestor_of('ecf2bb91…','812e26e7…')` → **false**; `SELECT count(*) FROM public.profiles WHERE nlevel(hierarchy_path) > 1` → **0 of 6**. Every `hierarchy_path` is a depth-1 self-label despite `upline_id` being populated. | Every Team-Leader-downline branch in the schema (`Leads Hierarchical Access`, `profiles_select_hierarchical`, `_import_undo_context`, `add_leads_to_campaign`) is **dead code today**. See decision **D-2**. |
| D4 | Team + unassigned leads are added **by accident**, not by design | `NULL = uuid` → NULL; `is_ancestor_of(uuid, NULL)` → false; `NULL OR false` → NULL; `NOT NULL` → NULL; PL/pgSQL treats a NULL `IF` as false → skip branch not taken → lead inserted. I re-verified this expression live (`or_expr = null`, `not_expr = null`). The desired behaviour is correct but rests on NULL semantics with no explicit guard — it must be made explicit. |
| D5 | Duplicate check is `SELECT EXISTS` then `INSERT` — race-prone — and **there is no unique constraint to fall back on**. `pg_indexes` for `public.campaign_leads` returns only `campaign_leads_pkey (id)` plus five non-unique indexes. | The mission's instruction to "use the existing campaign/lead uniqueness constraint" **cannot be followed — none exists.** One must be created. |
| D6 | Management and Dialer share ONE access rule, and it is **owner-only for Personal in both directions** | `filterCampaignsForAssignee`/`canUserAccessCampaign` (`campaign-assignee-scope.ts:51-70`) is called by `Campaigns.tsx:219` (management) and `useDialerSession.ts:312` (dialer). `viewAll` widens **Team only** (`:59`). So today: **Admins cannot manage agent-owned Personal campaigns** (violates locked decision 4a) while several server/UI paths *do* expose them (below). |
| D7 | `/campaigns/:id` has **no access check at all** | `CampaignDetail.tsx:452-455`: `supabase.from("campaigns").select("*").eq("id", id).maybeSingle()`. Live `campaigns_select` short-circuits on `get_user_role() = ANY(ARRAY['Admin','Team Leader','Team Lead'])` → any Admin/TL opens any Personal campaign, sees its leads (`campaign_leads_select` has the same role short-circuit), and can rename/retag/change status/delete it. |
| D8 | **Live dialing path into another agent's Personal campaign**: `CampaignDetail.tsx:619-625` `handleQuickCall` dispatches a `quick-call` CustomEvent consumed by `FloatingDialer.tsx:279`. No scope check anywhere; per-lead phone button at `CampaignDetail.tsx:347`. Phone masking is gated on `isOpenPool` only (`CampaignDetail.tsx:327`), so raw numbers are visible too. | This is the strongest current violation of locked decision 4b. |
| D9 | The `?campaign=` Dialer param is never validated | `useDialerSession.ts:139` `searchParams.get("campaign")`; `:147-149` is a `find()` that silently yields `undefined`. `DialerPage` then uses the **raw id** for `getCampaignLeads` (`:1507`), `get_next_queue_lead` (`:1399`), campaign reads (`:1377/:1393/:1520/:2716/:2763`) and `start_dialer_session` (`:2172`). Today it fails closed **by accident** — the defensive guard at `DialerPage.tsx:1497-1501` (`if (lockMode === false && !selectedCampaign) return;`) is permanently true on the forced-id path. That is a race guard, not an access rule; it must become an explicit one. |
| D10 | `public.start_dialer_session` performs **zero** campaign validation | Live definition validates only `get_org_id()`/`auth.uid()`, then inserts `p_campaign_id` verbatim. SECURITY DEFINER, so RLS is bypassed on the insert. |
| D11 | `AddToCampaignModal` fetches campaigns with **no `organization_id` filter and no scope filter** (`:41-46`), and its create-tab reports total failure as a **success toast** (`:130-134`: `toast.success("Campaign created — 0 leads added, 106 skipped")`). It also writes no `assigned_agent_ids`, so a Team campaign created there is invisible to every Agent. | Same false-success class as the import screen. |
| D12 | Retry is **hard-blocked** through every sanctioned path today | `add_leads_to_campaign` raises `'import % already finalized (%)'` (ERRCODE 22023) when `completion_status <> 'pending_campaign'`. Undo is *also* out: `_import_undo_context` sets `expired` at 24 h (import is from 2026-08-05), **and** `_import_undo_blockers` now returns `foreign_campaign_membership` because one of the 106 leads (`fe1b16d2-…`) was manually added to campaign `153f8d9e-…` on 2026-08-06 with `import_history_id NULL`. |
| D13 | `add_leads_to_campaign` **rebuilds** `import_completion_metadata` with `jsonb_build_object` instead of merging, destroying `tagged`/`finalized_at` on every batch | Live body. Matters for truthful multi-batch reporting. |
| D14 | `import_history` has UPDATE/DELETE **table privileges** granted to `anon`/`authenticated` but **zero UPDATE/DELETE policies** | A direct PostgREST `PATCH` is a silent 0-row no-op (HTTP 200), not an error. The three SECDEF writers (`add_leads_to_campaign`, `finalize_contact_import`, `undo_contact_import`) are the only sanctioned path — verified complete by regex over every non-system function, and `import_history` has zero triggers. |

### 1.3 CSV custom fields — the actual root cause is **not** what the brief hypothesised

I audited every hypothesis in the brief. Result:

| Hypothesis | Verdict | Evidence |
|---|---|---|
| (a) `"(custom)"` accidentally persisted in the DB | **RULED OUT — ZERO rows.** | Read-only production audit of `public.custom_fields` (100 rows): `name ILIKE '%(custom)%'` = **0**; `name ILIKE '%custom%'` = **0**; `name LIKE '%(%' OR '%)%'` = **0**; `name <> btrim(name)` = **0**. Distinct JSON keys across `public.leads.custom_fields` (13 total) contain no `(Custom)` either. **Collision analysis for a suffix-strip is therefore vacuous. No data-cleanup migration is required or proposed.** |
| (b) auto-detect compares against rendered display labels | **RULED OUT** | Auto-detect never sees labels *or* custom fields — see below. |
| (c) mapping state stores display text | **RULED OUT** | `mappings` is `Record<number,string>` (`:255`) holding `option.value`; option `value={f}` is the raw name (`:1148/:1149`), never the `(Custom)`-suffixed text. |
| (d) created field not inserted into options | **RULED OUT for the same session** (`:537` appends optimistically) — but **CONFIRMED across users** (below). |
| (e) inconsistent normalization across mapping paths | **CONFIRMED, secondary** — five distinct recipes coexist. |

**PRIMARY ROOT CAUSE (proven empirically, not just by reading):** `fuzzyMatch` is *structurally incapable* of returning a custom field.

```ts
// src/components/contacts/ImportLeadsModal.tsx:134
function fuzzyMatch(csvHeader: string): AgentFlowField | null {
```
One parameter. It iterates only `Object.entries(FIELD_VARIATIONS)` (`:74-87`) and can return only one of the 12 hardcoded `AGENTFLOW_FIELDS` (`:67-70`). A verifier re-executed the exact `:134-159` algorithm against all 14 production custom-field names plus `"New Field"` — **all 15 return `null`** → `"Do Not Import"`. Three live call sites: `:415-416` (initial upload), `:557-558` (Auto-detect again), `:1123` (the `isAutoMatched` badge, additionally gated on `isStandardField` so a custom field could never show the badge even if matching were fixed).

`allFields` at `:456-458` (`[...AGENTFLOW_FIELDS, ...customFieldNames]`) is **dead code with exactly one occurrence** — almost certainly the intended candidate list for a custom-field-aware matcher that was never wired up.

**The `(Custom)` suffix is a red herring.** Exactly one producer repo-wide, capital-C, render-only:
```tsx
// ImportLeadsModal.tsx:1149
{customFieldNames.map(f => <option key={f} value={f}>{f} (Custom)</option>)}
```

**SECONDARY (must also be fixed, or the fix is unsafe):**

- **Duplicate names make options ambiguous today.** Production holds **28 personal custom fields across only 14 distinct names** in org `a000…0001` (owners: `ecf2bb91…` Admin ×11, `812e26e7…` ×7, `7c692e64…` ×10). `custom_fields_personal_lower_name_unique` keys on `created_by`, so per-user duplicates are legal. For the **Admin**, `custom_fields_select` exposes all 28 → `:1149` renders 28 `<option>`s with **14 duplicate React `key`s and 14 duplicate `value`s**. This is precisely the "ambiguous normalized match" case the brief requires be left unmapped, and it is why option identity must become a stable id.
- **The created row is discarded.** `await customFieldsApi.create(...)` at `:528` is unassigned; `:537` appends the **local input string** instead of the server row. `activeLeadCustomFields` (`:257`) is never updated, so a field created with `required: true` is missing from the required-field gate for the rest of the session.
- **The import-mapping create path bypasses Zod entirely.** Settings validates through `customFieldSchema` (`src/components/settings/contact-flow/contactFlowSchemas.ts:29-56`, incl. `name … .max(40)`); `ImportLeadsModal.tsx:515-544` does an ad-hoc check and calls the API directly. `pg_constraint` on `custom_fields` has no CHECK on `name`, so a 200-char CSV header becomes a 200-char field name via import but is rejected via Settings.
- **No refetch race exists** (no react-query in this file; the only load is `useEffect([open, organizationId])` at `:332-358`) — so a timing race must simply not be *introduced*.

**Hard constraint discovered — this bounds the whole fix:** `leads.custom_fields` / `clients.custom_fields` / `recruits.custom_fields` are flat JSONB **keyed by the custom field's NAME** (`supabase/migrations/20260403000000_*`), with **no rename propagation anywhere** (the only trigger on `custom_fields` is `custom_fields_updated_at`). Name is the canonical storage key across: the import payload (`:823`), `FullScreenContactView.tsx:1007/1013/1065-1069/1083`, `contactRequiredFields.ts:124-125`, layout ids `custom:<name>` (`contactFieldLayout.ts:123-127`, `ContactManagement.tsx:1615`), and workflow trigger configs (`panels/triggerForms/forms.tsx:146`). **Therefore: the stable ID becomes the option/mapping identity, but the submitted payload key must remain the canonical NAME.** Anything else orphans production data.

---

## 2. Locked decisions → concrete contracts

### 2.1 Campaign creation matrix (enforced server-side)

| Type | Import strategy | `campaigns.user_id` | `campaigns.assigned_agent_ids` | `created_by` |
|---|---|---|---|---|
| Personal | Myself | caller | `[caller]` | caller |
| Personal | **Specific Agent** | **selected agent** | **`[selected agent]`** | **caller (audit)** |
| Personal | Round Robin | **REJECT** (22023) | — | — |
| Personal | Unassigned | **REJECT** (22023) | — | — |
| Team | Myself | caller *(existing owner semantics preserved)* | `[caller]` | caller |
| Team | Specific Agent | caller | `[selected agent]` | caller |
| Team | Round Robin | caller | unique selected agents | caller |
| Team | Unassigned | caller | `[caller]` — see decision **D-3** | caller |
| Open Pool | any | caller | `[]` (org-wide by type) | caller |

`organization_id` always from `public.get_org_id()` server-side — never from the request.

### 2.2 Attachment eligibility (server, explicit — no NULL-semantics accidents)

| Campaign type | Lead assigned to a participant | Lead unassigned (`assigned_agent_id IS NULL`) |
|---|---|---|
| Personal | eligible **iff** `lead.assigned_agent_id = campaigns.user_id` | **ineligible** (explicit `IS DISTINCT FROM` skip, unchanged) |
| Team | eligible **iff** `lead.assigned_agent_id::text ∈ campaigns.assigned_agent_ids` — **`user_id`/`is_ancestor_of` inference removed** | **eligible, and stays unassigned** (explicit `IS NULL` branch replacing today's accidental NULL fall-through) |
| Open Pool | eligible (same-org) | eligible |

`campaign_leads.user_id` is written **explicitly** as `leads.assigned_agent_id` — NULL for legitimately unassigned Team/Open-Pool leads. Never `auth.uid()`.

### 2.3 Completion states (server-derived from actual rows, never from client status)

| Status | Meaning | Retryable? |
|---|---|---|
| `pending_campaign` | attach not attempted yet | n/a |
| `completed` | every imported lead is a member (or no campaign was chosen) | no |
| `completed_with_skips` | attach finished; remainder is **permanently ineligible** by campaign rules | no |
| `campaign_partial` | some attached, remainder is still attachable | **yes** |
| `campaign_failed` | **zero** attached and remainder is still attachable | **yes** |

All five already exist in `import_history_completion_status_chk` — **no constraint change needed**. The 106 case must land on **`campaign_failed`** under the corrected logic (0 attached), not `completed_with_skips`.

### 2.4 Management access vs Dialer access

| Concept | Rule | Helper |
|---|---|---|
| **Management** | Open Pool: all in org · Team: participants, **plus** Admin/Super Admin/authorized-TL (`viewAll`) · **Personal: owner, plus same-org Admin/Super Admin** | `canUserManageCampaign(c, userId, {isAdmin, isSuperAdmin, viewAll})` |
| **Dialer** | Open Pool: all in org · Team: participants only · **Personal: owner ONLY — no Admin, no Super Admin, no viewAll** | `canUserDialCampaign(c, userId)` |

Enforced at: campaign picker, `?campaign=` query param, DialerPage lead-load, `CampaignDetail` Start Dialing **and** per-lead quick-call, and server-side in `start_dialer_session`.

---

## 3. Proposed implementation

### 3.1 Migration M1 — `campaign_leads_membership_uniqueness_and_attachment_core`

1. **Pre-flight guard, then unique index.** A `DO $$ … RAISE EXCEPTION` block aborts if any `(campaign_id, lead_id)` duplicate exists (production: **0** today; table is 70 rows), then:
   ```sql
   CREATE UNIQUE INDEX campaign_leads_campaign_lead_unique
     ON public.campaign_leads (campaign_id, lead_id)
     WHERE lead_id IS NOT NULL;
   ```
   Partial so the `ON DELETE SET NULL` orphan case (multiple NULL `lead_id` rows per campaign) stays legal. Plain (non-`CONCURRENTLY`) because migrations run in a transaction and the table is tiny.
2. **New `private.attach_leads_to_campaign_core(p_campaign_id uuid, p_lead_ids uuid[], p_import_history_id uuid) RETURNS jsonb`** — `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`, **`REVOKE ALL FROM PUBLIC, anon, authenticated`** (internal only, mirroring `_import_undo_context` / `_import_undo_blockers` which are `postgres`-only today). Contains the whole eligibility + insert engine:
   - one set-based eligibility CTE implementing §2.2 explicitly,
   - a single atomic `INSERT … SELECT … ON CONFLICT (campaign_id, lead_id) WHERE lead_id IS NOT NULL DO NOTHING RETURNING lead_id` — **replaces the SELECT-then-INSERT race**,
   - **explicit `user_id` column** = `leads.assigned_agent_id`, plus `organization_id` and `import_history_id`,
   - returns `{added, skipped, skipped_ids, skipped_already_present, skipped_ineligible, skipped_not_found, already_present_ids, ineligible_ids}`.
3. **`public.add_leads_to_campaign(uuid, uuid[], uuid)` — CREATE OR REPLACE, same signature, same 3 arg names.** No new overload (generated types at `src/integrations/supabase/types.ts:5468-5475` and `campaignLeadsBatch.test.ts` lock `p_campaign_id`/`p_lead_ids`/`p_import_history_id`; the 2-arg call resolves to the default).
   - The existing provenance gate (six `RAISE EXCEPTION`s) is **preserved byte-for-behaviour**.
   - **New caller authorization** (it is SECURITY DEFINER and currently any same-org authenticated user can write into any campaign): require `auth.uid()`; campaign in `get_org_id()`; and for `Personal` require caller = `campaigns.user_id` **or** an Admin / same-org Super Admin / authorized Team Leader read from `public.profiles` (not `get_user_role()` — see decision **D-1**). This is a net **tightening only** for callers whose calls previously skipped 100% anyway.
   - Body delegates to `private.attach_leads_to_campaign_core`.
   - **Backward-compatible response**: `added`, `skipped`, `skipped_ids` keys unchanged and first; new reason-specific keys added alongside.
   - Metadata accumulation switched from `jsonb_build_object` to `COALESCE(import_completion_metadata,'{}') || jsonb_build_object(...)` (fixes D13).

### 3.2 Migration M2 — `import_campaign_creation_and_retry`

1. **NEW `public.create_import_campaign(p_name text, p_type text, p_description text DEFAULT '', p_owner_id uuid DEFAULT NULL, p_participant_ids uuid[] DEFAULT NULL, p_assignment_strategy text DEFAULT NULL) RETURNS jsonb`**
   - `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`, `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon`, `GRANT EXECUTE … TO authenticated, service_role`.
   - Requires `auth.uid()`; derives `organization_id` from `public.get_org_id()`.
   - Validates `p_type ∈ ('Personal','Team','Open Pool')` (matches `campaigns_type_check`).
   - Validates every owner/participant UUID resolves to an **Active, same-org** `public.profiles` row. **The frontend `assignableAgentIds` list is never trusted.**
   - Role scope from `public.profiles` (see decision **D-1**): Agent → self only; Team Leader → self + `public.is_ancestor_of` downline; Admin / same-org Super Admin → any active same-org profile.
   - Enforces §2.1 including **Round Robin + Personal → reject** and **Unassigned + Personal → reject**.
   - Writes `created_by`, `user_id`, `assigned_agent_ids`, `organization_id`, `type`, `status='Active'` explicitly.
   - **Why an RPC and not an RLS change:** `campaigns_insert`'s `user_id = auth.uid()` check is load-bearing for every other campaign path (`CreateCampaignModal.tsx:97`, `AddToCampaignModal.tsx:115`, `Campaigns.tsx`). Weakening it is explicitly forbidden by the brief and would be a broad regression. A narrow SECDEF RPC is the correct seam.
2. **NEW `public.retry_import_campaign_attachment(p_import_id uuid) RETURNS jsonb`** — `SECURITY DEFINER`, pinned `search_path`, revoked from PUBLIC/anon, granted to `authenticated`+`service_role`.
   - Authorization + org + provenance via the canonical `public._import_undo_context(p_import_id)` (own import OR Admin OR same-org Super Admin OR TL-ancestor; validates `imported_lead_ids` are distinct valid UUIDs, all same-org).
   - **Rejects**: `not_authenticated`, `no_org`, `not_found`, `cross_org`, `not_authorized`, `already_undone`, `legacy_no_ids`, `invalid_import_provenance`, missing/mismatched campaign, campaign not found or cross-org, incompatible campaign type.
   - **Does not reject on `expired`** — the 24 h window is an *undo* concept (data destruction), not a *retry* concept (idempotent additive repair). See decision **D-4**.
   - `SELECT … FROM public.import_history WHERE id = p_import_id FOR UPDATE` — short lock, deterministic order, **no external calls while held**.
   - Retry set = `validated_ids` **minus** actual current `campaign_leads` membership for that campaign. **The client supplies only the import id — never lead ids.**
   - Delegates to `private.attach_leads_to_campaign_core` → `ON CONFLICT DO NOTHING` makes double-click and two-tab concurrency safe.
   - **Never** re-creates leads, never touches the Edge Function, never accepts forged ids (anything outside `validated_ids` is structurally unreachable).
   - Recomputes status from **actual `campaign_leads` rows** per §2.3 and updates `import_history` (status + merged metadata) from server-derived values only.
   - Returns `{ok, status, imported_count, attached_count, newly_attached, already_present, ineligible_count, remaining_count, reason?}`.
3. **`public.finalize_contact_import(uuid)` — CREATE OR REPLACE.** Replaces the metadata-arithmetic inference with the same **actual-membership** computation as the retry RPC, so a 0/N attach finalizes as **`campaign_failed`**, not `completed_with_skips`. Idempotency and the early-return branches (`reason`, already-finalized) are preserved; return shape is a superset of today's.

### 3.3 Migration M3 — `dialer_session_campaign_access`

`public.start_dialer_session(...)` — CREATE OR REPLACE, same signature. Adds a campaign check before insert: the campaign must be same-org **and** dialable by `auth.uid()` per §2.4 (Personal → `campaigns.user_id = auth.uid()`; Team → `auth.uid() ∈ assigned_agent_ids`; Open Pool → org). Raises `42501` otherwise. Everything else (org/uid validation, session reuse branch, stale-session cleanup) is untouched.

*This closes D10 so hiding UI controls is not the only defence — per the brief's explicit requirement.*

### 3.4 Frontend — campaign ownership & attachment

| File | Change |
|---|---|
| `src/pages/ImportLeadsPage.tsx` | `handleCampaignCreated` calls the new RPC (via the new typed wrapper) instead of the direct `campaigns` insert, forwarding owner/participants/strategy. Campaign list query gains `.eq("organization_id", organizationId)`. |
| `src/components/contacts/ImportLeadsModal.tsx` | Widen the `onCampaignCreated` prop contract to carry `{ownerId, participantIds, strategy}`; hide/disable **Personal** for `round_robin` (mirroring the existing `unassigned` pattern at `:636`/`:1362-1364`); submit-time validation; existing-campaign picker filtered by the new compatibility helper for **all** strategies (today only `unassigned` is filtered, `:619-622`); truthful result screen (§3.5); Retry button. |
| **NEW** `src/lib/import-campaign-compatibility.ts` | Pure predicates for §2.1/§2.2 — `isCampaignCompatibleWithImport({campaign, strategy, agentIds})`, `newCampaignTypesForStrategy(strategy)`. Zero React, zero I/O, fully unit-testable. Used for display **and** submit-time validation; the server remains the authority. |
| **NEW** `src/lib/supabase-import-campaign.ts` | Typed wrappers + result types for `create_import_campaign` and `retry_import_campaign_attachment`, matching the house style of `supabase-import-undo.ts` (narrow `(supabase as any).rpc` cast until types are regenerated). |
| **NEW** `src/components/contacts/importCampaignSchemas.ts` | Zod schemas for the new/modified modal contracts (`AGENT_RULES §7`). Today the import flow has **zero** Zod (grep-confirmed). |
| `src/components/contacts/AddToCampaignModal.tsx` | Add the missing `.eq("organization_id", …)`; apply the management-scope filter; **fix the false-success toast** on the create tab (`:130-134`) so `added === 0` is reported as a failure; write `assigned_agent_ids` when creating a Team campaign. |
| `src/pages/CampaignDetail.tsx` | Import-history tab: render completion status with truthful tone + **Retry Campaign Attachment**; handle `NULL` status (today `:1252` renders no pill at all). Also §3.7 access changes. |
| `src/pages/Contacts.tsx` | Import-history drawer: surface `import_completion_status` (today `importCompletionStatus` is written at `:1008` and **read nowhere**; the pill at `:2694` is derived only from undo state, so a `campaign_failed` import renders green "Active") + Retry. |

### 3.5 Frontend — truthful result & retry surface

`ImportLeadsModal.tsx:1645-1680` currently hardcodes the green `CheckCircle2` and `"Import Complete!"`. Replace with a state-derived header driven by `finalizeStatus` **plus** the attach counts:

- `completed` → green check, "Import Complete!"
- `completed_with_skips` → amber, "Imported — some leads were not eligible for this campaign"
- `campaign_partial` → amber, "Imported — campaign attachment incomplete" + **Retry**
- `campaign_failed` → amber/red, "Imported — campaign attachment failed (all leads kept)" + **Retry**
- `null` (three paths reach it: `insertedLeadIds.length === 0` at `:920`, `ImportLeadsPage.tsx:132-135` catch, `ImportLeadsModal.tsx:744-746` catch) → neutral "Couldn't confirm the campaign attachment" + Retry, **never** a green success.

Counts shown, each from the server response (no client arithmetic): leads imported · leads attached · already present · ineligible/skipped · remaining.

### 3.6 Edge Function — **no change proposed**

`import-contacts` (live v43 ≡ repo) creates leads and writes nothing to `campaigns`/`campaign_leads`/`import_history`. Every defect in scope lives in the frontend and the database. Per the brief's "keep this change surgical" and "preserve `verify_jwt`", **I propose leaving it untouched and not redeploying it.**

⚠️ **Reported, not fixed here (needs its own approval):** `index.ts:150-168` validates target agents **only** for org membership — no role or downline check. A crafted request can assign imported leads to any same-org user regardless of the caller's role. `assignableAgentIds` (`ImportLeadsPage.tsx:76-81`) is UI-only. My `create_import_campaign` closes the *campaign-ownership* half of this server-side; the *lead-assignment* half stays open in the Edge Function. Say the word and I will fold it in — it is a genuine authorization gap, but it is outside the stated scope and touches the lead-creation path.

### 3.7 Frontend — management vs Dialer split

| File | Change |
|---|---|
| `src/lib/campaign-assignee-scope.ts` | Split the single rule into **`canUserDialCampaign`** (today's `canUserAccessCampaign`, unchanged semantics, Personal = owner only) and **`canUserManageCampaign`** (adds same-org Personal for Admin/Super Admin). `filterCampaignsForAssignee` keeps its attachment-eligibility meaning; `canUserAccessCampaign` is removed and every call site made explicit (only 4 exist). |
| `src/pages/Campaigns.tsx:219` | → `canUserManageCampaign` (**broadens**: Admin/Super Admin now see agent-owned Personal campaigns, per locked decision 4a). |
| `src/hooks/useDialerSession.ts:312` | → `canUserDialCampaign` (**unchanged behaviour**). Plus: validate `searchParams.get("campaign")` against the dialable set; if not dialable, clear the param, show the picker, toast. |
| `src/pages/DialerPage.tsx` | Replace the accidental `:1497` race guard with an explicit `canUserDialCampaign` gate before any lead load / queue claim / session start. Minimal, extracted-helper edits only — `DialerPage.tsx` is a documented >200-line exception (AGENT_RULES §7). |
| `src/pages/CampaignDetail.tsx` | Gate "Start Dialing" **and** the per-lead quick-call button (`:347`, `handleQuickCall` `:619-625`) on `canUserDialCampaign`; keep management actions on `canUserManageCampaign`. |

**Not proposed:** any RLS widening. Live `campaigns_select`/`campaign_leads_select` already grant same-org Admin/TL read (which is what makes decision 4a work today at the data layer). Locked decision 4 says do **not** broaden Agent/Team-Leader access, and I am not.

⚠️ **Reported, not fixed here:** live `campaign_leads_update` / `campaign_leads_delete` are `organization_id = get_org_id()` only — any authenticated org member can mutate or delete rows in another agent's Personal campaign. Tightening this is an RLS change (needs `#APPROVE_RLS_CHANGE`) and is out of the stated scope.

### 3.8 CSV custom fields

| File | Change |
|---|---|
| **NEW** `src/lib/import-field-matching.ts` | The single shared contract + matcher. `ImportFieldOption = { value: string; canonicalName: string; label: string; kind: "standard" \| "custom"; customFieldId?: string }` — **stable value, canonical name, display label, and kind kept separate**. `normalizeFieldName(s)` = trim → collapse repeated internal whitespace → lowercase (**punctuation preserved**, per the brief). `buildImportFieldOptions(customFields)` marks names whose normalized form is non-unique. `matchCsvHeaderToField(header, options)`: built-ins first via the **byte-identical existing `fuzzyMatch`** (moved, not modified — preserves built-in behaviour exactly), then custom fields via normalized exact match; **ambiguous → `null` → column left unmapped**. |
| `src/components/contacts/ImportLeadsModal.tsx` | Options come from `buildImportFieldOptions`; option `value` becomes the **stable key** (`custom:<uuid>` for custom, the name for standard) while the label keeps `"(Custom)"`; mapping state stores stable keys; **payload construction resolves stable key → canonical NAME** (preserves the `leads.custom_fields` keyed-by-name contract — §1.3); all three `fuzzyMatch` call sites (`:415`, `:557`, `:1123`) go through the shared matcher, and `isAutoMatched` (`:1122-1123`) stops being gated on `isStandardField`; `handleCreateCustomField` uses the **returned DB row** (id + canonical name), inserts it into the option list, updates `activeLeadCustomFields`, and maps the originating column by stable id **in the same commit** (no timing race, no refetch); create-failure leaves the column at its prior value (never a false mapping); `reset()`/`handleFile` state hygiene for `activeLeadCustomFields` and `creatingFieldForCol`. |
| `src/components/contacts/importCampaignSchemas.ts` | Reuse `customFieldSchema`'s name rules (or a shared subset) so the import create path stops bypassing Zod. |

**Data cleanup: none proposed.** The production audit returns **ZERO** rows containing `(custom)` in any form. I explicitly propose **no** migration touching `custom_fields.name` — a rename would silently orphan every stored value keyed by the old name across `leads`/`clients`/`recruits`, every `custom:<name>` layout id, and every `custom_date_approaching` workflow trigger config, with no propagation mechanism anywhere.

📋 **Reported for a separate task (not fixed here):** 28 personal custom fields across 14 distinct names in org `a000…0001` (5 names ×3 owners, 4 ×2, plus the typo pair `Date/Time Received` / `Date/Time Recieved`). Legal under the unique indexes. My ambiguity rule makes them safe (they will be left unmapped rather than mis-selected), but consolidating them is its own reviewed migration — and note `custom_fields_created_by_fkey ON DELETE SET NULL` means deleting one of several duplicate owners can violate `custom_fields_agency_lower_name_unique` and block the profile delete.

---

## 4. Complete file list

### Migrations (created with `supabase migration new <name>`)

| # | File | Reason |
|---|---|---|
| M1 | `supabase/migrations/<ts>_campaign_leads_membership_uniqueness_and_attachment_core.sql` | Unique index (none exists — D5); `private.attach_leads_to_campaign_core`; `add_leads_to_campaign` v2 (explicit `user_id`, `assigned_agent_ids` Team rule, explicit unassigned branch, atomic upsert, caller authz, reason counts, metadata merge) |
| M2 | `supabase/migrations/<ts>_import_campaign_creation_and_retry.sql` | `create_import_campaign`; `retry_import_campaign_attachment`; `finalize_contact_import` v2 (membership-derived status) |
| M3 | `supabase/migrations/<ts>_dialer_session_campaign_access.sql` | `start_dialer_session` campaign-scope validation (D10) |

### Frontend — new

| File | Reason |
|---|---|
| `src/lib/import-field-matching.ts` | Canonical name / stable id / label / kind separation + one shared normalization + ambiguity rule |
| `src/lib/import-campaign-compatibility.ts` | Pure campaign↔import compatibility predicates (display + submit-time) |
| `src/lib/supabase-import-campaign.ts` | Typed wrappers for the two new RPCs |
| `src/components/contacts/importCampaignSchemas.ts` | Zod for the new/modified modal contracts |

### Frontend — edited

| File | Reason |
|---|---|
| `src/pages/ImportLeadsPage.tsx` | Campaign creation → RPC with agent context; org-filter the campaigns query |
| `src/components/contacts/ImportLeadsModal.tsx` | Owner/participant plumbing; Round-Robin↛Personal; picker compatibility; truthful result + Retry; the whole custom-field mapping contract |
| `src/lib/campaign-assignee-scope.ts` | Split management vs dialer access |
| `src/pages/Campaigns.tsx` | Management scope (Admin/SA see agent Personal campaigns) |
| `src/hooks/useDialerSession.ts` | Dialer scope + `?campaign=` validation |
| `src/pages/DialerPage.tsx` | Explicit dial-access gate replacing the accidental race guard |
| `src/pages/CampaignDetail.tsx` | Dial gate on Start Dialing + quick-call; import-history status + Retry |
| `src/pages/Contacts.tsx` | Import-history completion status + Retry |
| `src/components/contacts/AddToCampaignModal.tsx` | Org filter, management scope, false-success toast, Team `assigned_agent_ids` |
| `src/integrations/supabase/types.ts` | Regenerated **only** for the new/changed functions — surgical diff, reviewed hunk by hunk; **nothing copied from another branch** |
| `AGENT_RULES.md` | New invariants (§7) |
| `WORK_LOG.md` | Newest-first entry |
| `implementation_plan.md` | This file + as-built delta |

### Deliberately untouched

`TwilioContext.tsx` · the single-leg WebRTC path · call telemetry · `calls.duration` writers · dispositions · hard-claim (`useHardClaim`) · queue locking (`get_next_queue_lead`, `dialer_lead_locks`, `renew/release_lead_lock`) · recordings · reporting · `advance_campaign_lead` · `undo_contact_import` / `preview_contact_import_undo` / `_import_undo_context` / `_import_undo_blockers` · **`supabase/functions/**` (no Edge deploy)** · all RLS policies · `CreateCampaignModal.tsx` · dependencies.

---

## 5. Tests (fail-first, written and run against unmodified source first)

Baseline to preserve: **991/991 in 76 files** (host TZ `America/Los_Angeles`); `TZ=UTC` 979 passed + 12 known `laOnly` DST skips.

### 5.1 Frontend / application (Vitest) — new files

| File | Covers (brief items) |
|---|---|
| `src/lib/__tests__/importCampaignCompatibility.test.ts` | 4, 5, 22 + the full §2.1/§2.2 matrix; Round-Robin↛Personal; Specific-Agent+Team participant rule; unassigned+Team allowed; Open Pool |
| `src/lib/__tests__/campaignAccessScope.test.ts` | 12, 13, 14 — management vs dialer split; Admin manages but cannot dial another's Personal; TL/Agent excluded both ways |
| `src/lib/__tests__/importFieldMatching.test.ts` | **All 14 custom-field items** — canonical name ≠ label; dropdown shows `"(Custom)"`; later CSV auto-selects; case / leading-trailing whitespace / repeated internal whitespace; payload uses the stable id→canonical name; `"(custom)"` never in a created name; ambiguous normalized match left unmapped; built-in↔custom collision; **built-in auto-detection unchanged** (pinned against the current `fuzzyMatch` output for the 12 standard fields + their variations) |
| `src/components/contacts/__tests__/importLeadsModalCampaign.test.tsx` | 1, 2, 3, 6, 7 — the RPC receives the **selected agent** as owner with `created_by` = importer; Personal absent for Round Robin; Team participant propagation |
| `src/components/contacts/__tests__/importLeadsModalResult.test.tsx` | 17, 18, 19, 20, 21 — 0/N ⇒ no green check, no "Import Complete!"; partial counts truthful; N/N complete; Retry present only when retryable; post-retry refresh |
| `src/components/contacts/__tests__/importLeadsCustomFields.test.tsx` | 1, 13, 14 — create-and-map in one commit; mapping survives rerenders/list refresh; create failure leaves no false mapping |
| `src/lib/__tests__/importRetry.test.ts` | Wrapper contract for `retry_import_campaign_attachment` (arg shape, error propagation, result typing) |

Existing suites that must stay green **unchanged**: `campaignLeadsBatch.test.ts` (locks `[500,500,200]` batching, RPC name, `p_import_history_id` forwarding, 2-arg `toBeUndefined()`, error propagation — item 22), `importUndo.test.ts`, `custom-fields-settings.test.ts`, `contactScope.test.ts`.

House style confirmed: `vitest` + `jsdom`, `globals: true`, single setup file, **no global Supabase mock** — each suite declares its own `vi.mock("@/integrations/supabase/client", …)` (25 of 76 files do). New suites will follow that pattern exactly.

### 5.2 SQL / security regression — `supabase/tests/import_campaign_attachment.sql`

All 24 required cases, following the established `supabase/tests/leaderboard_aggregate_rpc.sql` convention (fixture inserts, simulated JWT claims, explicit assertions): authorized Admin creating an agent-owned Personal campaign · Agent self-only · Team Leader self/downline · cross-org owner & participant rejection · Personal/Team/Open-Pool eligibility · Team unassigned behaviour · explicit `campaign_leads.user_id` · **Admin attaching to an agent's Personal campaign without stamping the Admin's UUID** · `ON CONFLICT` duplicate handling · provenance preservation · Undo compatibility · retry after total failure · retry after partial · double-click idempotency · concurrent idempotency · cross-org campaign/lead/owner/participant/import rejection · forged `imported_lead_ids` · campaign mismatch · undone import · **PUBLIC/anon cannot execute** · generic RPC contract preserved · restricted grants + pinned `search_path`.

🚫 **BLOCKER — this suite cannot be executed in this environment.** Verified, exact:
- `supabase --version` → `zsh: command not found` (CLI only via devDep: `npx --no-install supabase --version` → `2.84.5`)
- `docker info` → `Cannot connect to the Docker daemon at unix:///Users/chrisgarness/.docker/run/docker.sock. Is the docker daemon running?`
- `npx --no-install supabase status` → same daemon error
- `supabase/config.toml` has **no `[db]`/`[api]`/`[auth]` sections at all** (194 lines: `project_id` + ~45 `[functions.*] verify_jwt` blocks), so `supabase start` would run on unpinned CLI defaults.

Options, needing your call (**decision D-5**): (a) you start Docker Desktop and I run it locally; (b) approved temporary Supabase **dev branch** via MCP (`create_branch` — billable, needs `confirm_cost`); (c) I write the suite and mark it **NOT EXECUTED** with the reason. **I will never run mutation tests against production, and I will never report an unexecuted test as passed.**

### 5.3 Manual / browser

Standing limitation recorded in prior WORK_LOG entries: **no authenticated session exists in this environment** (dev server redirects to `/login`; no credentials entered). I will verify what I can via a scratchpad-only render harness (deleted before handoff, exactly as in the 2026-08-03/04/06 builds) and state plainly which surfaces were verified live vs by harness vs by test/code only.

---

## 6. Verification gates (after approval, before handoff)

`npx tsc --noEmit` (exit 0) → focused Vitest on every touched suite → full `npx vitest run` host TZ (expect **991 baseline + new, zero regressions**) → `TZ=UTC` → `TZ=America/Los_Angeles` → `npx eslint --max-warnings 0` on every touched file (pre-existing debt in `DialerPage.tsx`/`CampaignDetail.tsx` measured against `origin/main` and reported as *zero new findings*) → `npm run build` → `git diff --check` → scope audit vs `origin/main`.

Explicit anti-regression checks: no unrelated files touched · **no generated types copied from another branch** (surgical hunks only) · no cross-tenant authorization expansion · no service-role key in frontend code · no false success state · no `campaign_leads` ownership regression · no Import-Undo regression · no built-in CSV auto-detection regression.

After any **approved** production migration: Supabase **security** and **performance** advisors, reported as *new* vs *pre-existing* (the 2026-08-05 leaderboard entry establishes lint 0029 for authenticated SECDEF RPCs as an expected, pre-existing class).

---

## 7. `AGENT_RULES.md` additions (only if implementation confirms them)

New invariant covering: import-created Personal campaign ownership (`user_id` = selected agent, `created_by` = importer, org from `get_org_id()`, created only via `create_import_campaign`) · Team participant eligibility via `assigned_agent_ids` (never owner/downline inference) · **management access ≠ Dialer access** for Personal campaigns · retry/provenance rules (retry derives its set from `imported_lead_ids` minus real membership; status is recomputed from rows, never trusted from the client) · **canonical custom-field identity is the DB id + canonical name; `"(Custom)"` is UI decoration only and must never be persisted or matched against** · and the schema-gotcha that **`leads.custom_fields` is keyed by field NAME with no rename propagation**.

---

## 8. Deployment order & rollback

**Order (each step gated on the previous succeeding):**
1. Merge-blocking review of the diff + the three migration files.
2. Apply **M1** → verify `campaign_leads_campaign_lead_unique` exists, `add_leads_to_campaign` signature/grants/`search_path` unchanged, `private.attach_leads_to_campaign_core` has no `authenticated`/`anon`/`PUBLIC` EXECUTE.
3. Apply **M2** → verify both new functions exist as `SECURITY DEFINER` with pinned `search_path`, revoked from `PUBLIC`/`anon`, granted to `authenticated`+`service_role`; `finalize_contact_import` idempotency preserved.
4. Apply **M3** → verify `start_dialer_session` still starts a session for a legitimate owner and refuses a non-owner Personal campaign.
5. Run security + performance advisors; report new vs pre-existing.
6. **Only then** deploy the frontend (Vercel, via merge). Backend-first is mandatory: the new frontend calls RPCs that must already exist. The old frontend is unaffected by M1–M3 (`add_leads_to_campaign`'s response is a superset; `finalize_contact_import` returns a superset).
7. Live smoke: one small import per locked scenario, with `add_leads_to_campaign`/`finalize` results checked against actual `campaign_leads` rows.
8. **Production repair (§9) — separate approval, after all of the above.**

**Rollback:**
- Frontend: revert the merge, redeploy previous build. Safe standalone — the old UI never calls the new RPCs.
- M3: `CREATE OR REPLACE` back to the captured prior `pg_get_functiondef` of `start_dialer_session`.
- M2: `DROP FUNCTION public.create_import_campaign(...)`, `DROP FUNCTION public.retry_import_campaign_attachment(uuid)`, `CREATE OR REPLACE` `finalize_contact_import` from its captured prior definition.
- M1: `CREATE OR REPLACE` `add_leads_to_campaign` from its captured prior definition, `DROP FUNCTION private.attach_leads_to_campaign_core(...)`, `DROP INDEX public.campaign_leads_campaign_lead_unique`.
- Each rollback removes only its own `supabase_migrations.schema_migrations` row, atomically with the DDL.
- **Every prior definition will be captured verbatim via `pg_get_functiondef` and pasted into the WORK_LOG entry before any apply.** No data is destroyed by any migration; M1's only data-affecting object is an index whose pre-flight guard aborts rather than deduplicating.

---

## 9. Production repair runbook — 106-lead import (PREPARED, **NOT EXECUTED**, separately gated)

Immutable UUIDs — never identified by name:

| Role | UUID |
|---|---|
| Organization | `a0000000-0000-0000-0000-000000000001` |
| Import history | `d7811230-abf6-47b5-bf8b-6aacfac976ef` |
| Campaign (currently empty, Admin-owned) | `8b680353-d9c8-4d1c-a479-d29896bde760` |
| Intended owner (Agent) | `812e26e7-3f77-45d5-84fa-ff519886ac7b` |
| Importer / current owner (Admin) | `ecf2bb91-0350-4542-85ec-14d914311e99` |
| The 106 leads | `import_history.imported_lead_ids` for `d7811230…` — **never a name/date query** |

**Preflight (read-only, must all hold):** campaign still exists, `type='Personal'`, `user_id = ecf2bb91…`, `assigned_agent_ids = []`, org matches · `campaign_leads` for that campaign = 0 · all 106 ids still in `public.leads`, all `assigned_agent_id = 812e26e7…`, all org-matched · `undo_status IS NULL` · `812e26e7…` is an Active same-org profile · no `campaign_leads` row already links any of the 106 to `8b680353…`.

**Repair (single transaction, executed as an approved migration — never ad-hoc SQL):**
1. `UPDATE public.campaigns SET user_id = '812e26e7…', assigned_agent_ids = '["812e26e7-3f77-45d5-84fa-ff519886ac7b"]'::jsonb WHERE id = '8b680353…' AND organization_id = 'a000…0001' AND type = 'Personal'` — `organization_id`, `created_by`, `name`, `type` all preserved.
2. Attach the exact 106 via `private.attach_leads_to_campaign_core` with `p_import_history_id = 'd7811230…'` → writes `campaign_leads.user_id = 812e26e7…` (the lead/campaign owner, **never the Admin**) and preserves `organization_id` + provenance.
3. Reconcile `import_history` status + metadata from actual membership (expect `completed`).

**Post-repair verification:** `campaign_leads` for the campaign = 106, all `user_id = 812e26e7…`, all `import_history_id = d7811230…` · `campaigns.user_id`/`assigned_agent_ids` correct, `organization_id` unchanged · `campaigns.total_leads = 106` (trigger-maintained) · `import_completion_status = 'completed'` · all 106 leads still `assigned_agent_id = 812e26e7…` · the agent (not the Admin) sees the campaign in **their** Dialer picker, and the Admin does **not**.

**Rollback:** `DELETE FROM public.campaign_leads WHERE campaign_id = '8b680353…' AND import_history_id = 'd7811230…'` (bounded to exactly the rows this repair created), restore `campaigns.user_id = 'ecf2bb91…'` and `assigned_agent_ids = '[]'`, restore the prior `import_completion_status`/metadata (captured verbatim in the preflight).

**Gate:** requires code review + migration review + automated verification + your manual validation, then a **separate explicit approval**. Not part of this task.

**Also found, needing your decision separately (not in this repair):**
- `import_history` `59ad8e97-efcf-44c6-9abc-8a911a3ed029` — 32 ids, `campaign_id` now NULL, status `completed_with_skips`, `{added:0, skipped:32}`. **Already worked around in production**: all 32 leads sit in Open Pool campaign `e1556ede-…` with `import_history_id NULL` (added 0.35 s after that campaign was created). Its 32 `campaign_leads.user_id` values are the **Admin**, not `leads.assigned_agent_id = 7c692e64…` — the D1 drift, pre-existing.
- `import_history` `d8e8c294-99d3-4cf3-9e72-2764fe214bf3` (106 ids, **0 leads alive**) and `6458c84c-5a35-41fa-9885-3ec973c2a1a7` (says `completed`/109, **0 leads and 0 tagged rows alive**, `undo_status NULL`). Both are stale provenance from deletions that did **not** go through `undo_contact_import`. Actor/mechanism **NOT VERIFIED** — no audit table exists. Nothing here is repairable; flagged for awareness only.

---

## 10. Decisions — full list, options, recommendations, impact

> Chris gave provisional direction on **D-2, D-3, D-4, D-5, D-8** on 2026-08-07 (recorded below as **ACCEPTED**). **D-1, D-6, D-7** remain open.

---

### D-1 — Where do the new RPCs read the caller's role from? **(OPEN)**

**Evidence.** `public.get_user_role()` is `prosecdef=false`, `proconfig=NULL` (search_path **not** pinned), body `SELECT NULLIF(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'role','')` — **JWT-only, no `profiles` fallback**. `public.is_super_admin()` is the same. `public.get_org_id()` *does* fall back to `profiles`. `AGENT_RULES` invariant #19 documents this exact asymmetry causing the dialer redial-loop outage; invariant #20 states the canonical rule: *"The guard's trusted source is `public.profiles` read for `auth.uid()` — never the JWT."* `public._import_undo_context` already reads `profiles.role` directly.

| Option | What it means | Impact |
|---|---|---|
| **A — read `public.profiles`** *(recommended)* | `SELECT role, organization_id, is_super_admin FROM public.profiles WHERE id = auth.uid()` inside each new RPC | Immune to a stale `app_metadata.role` claim. Matches invariant #20 and `_import_undo_context`. Cost: one PK lookup per RPC call (the RPC runs once per import/retry, **not per lead row**). **Not self-promotable — verified: `information_schema.role_table_grants` gives `authenticated` only `SELECT` on `public.profiles`; `anon` has no grants at all. A user cannot edit their own role to authorize themselves.** |
| B — use `get_user_role()` / `is_super_admin()` | Consistent with surrounding RLS policies | A stale/missing claim silently demotes an Admin → their import is rejected with "not authorized". This is the precise failure class invariant #19 was written about, and it is confusing rather than fail-safe. |
| C — JWT with `profiles` fallback | Hybrid | Two sources of truth in an authorization path; harder to reason about and to test. Rejected. |

**Recommendation: A.** It is the rule `AGENT_RULES` already mandates for authorization guards, and the grant audit proves it cannot be self-escalated.

---

### D-2 — Team Leader downline authorization, given `is_ancestor_of` is dead **(ACCEPTED: A)**

**Evidence.** I verified personally: `SELECT public.is_ancestor_of('ecf2bb91…','812e26e7…')` → **false**; `SELECT count(*) FROM public.profiles WHERE nlevel(hierarchy_path) > 1` → **0 of 6**. Every `hierarchy_path` is a depth-1 self-label despite `upline_id` being populated.

| Option | What it means | Impact |
|---|---|---|
| **A — use `is_ancestor_of` only; fail closed** *(ACCEPTED)* | TL downline authorization denies everything today; TL may still act on **self** | No new semantics, no blast radius, no organization-wide broadening. **Known cost (flagged, see §11.8):** a Team Leader can no longer create a Personal campaign *owned by a downline agent* through the import flow — they get a clear authorization error. This is a narrow, security-correct regression, and it does **not** affect lead assignment (which stays in the untouched Edge Function, D-6). |
| B — fall back to `profiles.upline_id` (direct reports) in these RPCs only | Second hierarchy source of truth | Broadens access relative to today, and leaves 4+ RLS policies on the dead source — an inconsistent authorization surface. |
| C — recursive `upline_id` CTE in these RPCs | As B, deeper | Same objection, larger. |
| D — repair `hierarchy_path` in this PR | Fix the root | Silently re-activates TL branches in `Leads Hierarchical Access`, `profiles_select_hierarchical`, `_import_undo_context` **and** `add_leads_to_campaign` **all at once** — a large unreviewed access expansion inside a bugfix PR. |

**ACCEPTED: A.** Fail closed for Team Leaders in this PR; do not trust the broken hierarchy; do not broaden to the organization. **`hierarchy_path` repair is recorded as a separate required follow-up** (§11.9) and will be named in `WORK_LOG.md` and the PR body.

---

### D-3 — `assigned_agent_ids` for a new **Team** campaign on an **Unassigned** import **(ACCEPTED: A)**

**Evidence.** The brief specifies participants for Myself / Specific Agent / Round Robin, not for Unassigned. Live `campaigns_select`'s TEAM branch requires `auth.uid() ∈ assigned_agent_ids` for Agents. `ImportLeadsModal.tsx:670` already permits Team for the unassigned strategy.

| Option | Impact |
|---|---|
| **A — `[caller]`** *(ACCEPTED)* | Creator keeps visibility; unassigned leads attach and stay unassigned; Admin/TL see it via the role branch regardless. Consistent with the "Myself" rule. |
| B — `[]` | Campaign invisible to every Agent including an Agent creator. Confusing dead-end. |
| C — reject Team + Unassigned | Removes a combination that works today — a regression. |

**ACCEPTED: A**, *with explicit documentation*: an inline hint on the new-Team-campaign form for the Unassigned strategy stating that **an authorized manager must add the intended agents before those agents can use the campaign**, plus the same note in `WORK_LOG.md` and `AGENT_RULES.md`.

---

### D-4 — Does campaign-attachment retry honour the 24-hour undo window? **(ACCEPTED: A)**

**Evidence.** `_import_undo_context` sets `expired := (created_at < now() - interval '24 hours')`. That guard exists for `undo_contact_import`, which **deletes leads**. Retry only inserts `campaign_leads` rows.

| Option | Impact |
|---|---|
| **A — retry ignores `expired`** *(ACCEPTED)* | The 106-lead import (2026-08-05) becomes repairable through a sanctioned, idempotent, additive path. No new destructive capability: the retry set is structurally bounded to `imported_lead_ids` ∩ eligible. |
| B — retry honours `expired` | The incident is permanently unrecoverable through any sanctioned path — the exact situation this task exists to fix. |
| C — a separate, longer retry window | Arbitrary; no principled boundary. |

**ACCEPTED: A**, bounded exactly as Chris specified — retry is allowed **only** for an **incomplete, non-undone** import, using its **immutable campaign and lead provenance**. Concretely the retry RPC rejects: `not_authenticated`, `no_org`, `not_found`, `cross_org`, `not_authorized`, `already_undone`, `legacy_no_ids`, `invalid_import_provenance`, missing/mismatched/cross-org campaign, and incompatible campaign type.

**One design consequence, stated explicitly:** retry does **not** gate on the *stored* `import_completion_status`. It recomputes actual `campaign_leads` membership first and is a no-op returning `completed` when membership is already complete. This is required by the brief ("recompute the final status from actual database membership") **and** is what makes the existing mis-stamped `completed_with_skips` row (the 106 import) recoverable rather than permanently frozen by a status the old code got wrong.

---

### D-5 — Where does the SQL regression suite actually execute? **(ACCEPTED with a caveat)**

**Verified environment facts:** `supabase --version` → `command not found` (CLI only via devDep, `npx --no-install supabase --version` → `2.84.5`); `docker info` → *"Cannot connect to the Docker daemon at unix:///Users/chrisgarness/.docker/run/docker.sock"*; `npx --no-install supabase status` → same error. **`.github/workflows` does not exist — this repo has zero CI.** `supabase/config.toml` is 194 lines of `project_id` + ~45 `[functions.*] verify_jwt` blocks with **no `[db]`/`[api]`/`[auth]` sections**, so nothing is version-pinned.

| Option | Impact |
|---|---|
| **A — GitHub Actions + ephemeral local Supabase** *(Chris's preference; recommended as the durable target)* | New file `.github/workflows/sql-tests.yml`; `supabase start` + `supabase db reset` on the runner (Docker is present on GH runners), then run the suite. **Durable and repeatable on every PR forever.** Requires pinning `[db] major_version` in `config.toml`. **Risk to surface now: `db reset` replays all 265 local migrations, 3 of which are unapplied to production, and the 2026-08-05 `WORK_LOG.md` entry records that lower-environment replay was previously *blocked by unrelated historical migration drift*.** That drift may need resolving before A is green — work that is unrelated to this bugfix. Adding CI is also new repo infrastructure, i.e. scope you should bless explicitly. |
| B — local Docker on your machine | You start Docker Desktop; I run it locally | Fastest feedback loop while implementing; same replay-drift risk; no new repo files; **not durable or repeatable**. |
| C — disposable Supabase dev/preview branch via MCP `create_branch` | Closest to production topology; replays migrations server-side; deleted after | **Billable — requires `confirm_cost` and your explicit go-ahead.** |
| D — written but **NOT EXECUTED** | Honest fallback | The suite ships unproven; must be labelled as such everywhere. |

**ACCEPTED plan: A as the target, B as the immediate unblocker, C as the fallback if replay drift blocks A.** I will use B for fast feedback during implementation, then land A in the same PR so the suite is durable. **Under no circumstance will I run mutation tests against production, and I will not merge or report the suite as passing unless it actually ran** — if it did not, it is labelled **NOT EXECUTED** with the reason, in the plan, the `WORK_LOG.md` entry, and the PR body.

---

### D-6 — Fold the Edge Function target-agent authorization gap into this PR? **(OPEN)**

**Evidence.** `supabase/functions/import-contacts/index.ts:150-168` validates `targetIds` **only** with `.eq("organization_id", orgId)` — no role check, no downline check. Live v43 ≡ repo (diffed via MCP `get_edge_function`). So any authenticated org member can POST `{strategy:"specific_agent", targetAgentId:<any org member>}` and assign imported leads to them. `assignableAgentIds` (`ImportLeadsPage.tsx:76-81`) is a UI filter, never a boundary.

| Option | Impact |
|---|---|
| **A — leave untouched, document precisely** *(recommended)* | `create_import_campaign` closes the **campaign-ownership** half server-side. The **lead-assignment** half stays open and is written up as its own task. Scope stays surgical; **no Edge deploy**; the lead-creation path — the one path that has already lost data once — is not disturbed. |
| B — fold the role-scope check into the Edge Function now | Closes it immediately, but requires `get_edge_function` before deploy (invariant #4), shipping the full `index.ts`, preserving `verify_jwt=false` (invariant #2), and a **production Edge deploy inside a PR whose entire premise is that lead creation must not be disturbed**. **Decisive objection: it compounds D-2.** With `is_ancestor_of` dead and TL failing closed, enforcing role scope on *lead assignment* today would break Team Leader lead imports **entirely** — a far larger blast radius than the narrow campaign-ownership regression D-2 accepts. |
| C — move lead-assignment authorization into a DB RPC the Edge Function calls | Cleanest long-term architecture | Largest change; same D-2 blast-radius problem; belongs with the `hierarchy_path` repair. |

**Recommendation: A**, with B/C queued as an immediately-following task that should land **together with** the `hierarchy_path` repair from D-2.

---

### D-7 — Tighten `campaign_leads_update` / `campaign_leads_delete` RLS in this PR? **(OPEN)**

**Evidence.** Both live policies are `USING (super_admin_own_org(organization_id) OR (organization_id = get_org_id()))` — **any authenticated org member can UPDATE or DELETE any `campaign_leads` row in the organization**, including rows in another agent's Personal campaign.

| Option | Impact |
|---|---|
| **A — leave untouched, document** *(recommended, strongly)* | Pre-existing and orthogonal to the reported defects. **Nothing in this PR widens it.** |
| B — tighten both now | Requires `#APPROVE_RLS_CHANGE` (AGENT_RULES §10). **`campaign_leads` UPDATE is the dialer hot path.** Invariant #19 documents precisely what a too-narrow `campaign_leads` policy causes: every dialer UPDATE silently affected **0 rows with no error**, `call_attempts`/`retry_eligible_at`/callback/terminal-status never persisted, and `get_next_queue_lead` re-served the same lead — the redial-loop outage. Reproducing that class of failure is a real risk, and the brief explicitly forbids touching queue locking. |
| C — tighten DELETE only, leave UPDATE | Safer than B, still needs `#APPROVE_RLS_CHANGE` and its own full test matrix; leaves the larger hole open. |

**Recommendation: A.** Flag as its own security task with its own approval and its own regression suite against the dialer queue path.

---

### D-8 — Branch **(ACCEPTED)**

| Option | Impact |
|---|---|
| **A — `bugfix/import-campaign-attachment` cut from a freshly fetched `origin/main`** *(ACCEPTED)* | I will run `git fetch origin` immediately before cutting and **record the actual SHA at cut time** in `implementation_plan.md` and `WORK_LOG.md`. `4798ce4` in §0 is the SHA observed during inspection, **not** a pin. |
| B — cut from the hardcoded `4798ce4` | Silently stale if `main` advances. Rejected. |
| C — build on the current `bugfix/hide-lead-score-ui` | Already merged as #350; stale. Rejected. |

---

## 13. Confirmations requested 2026-08-07 — all accepted and bound into the plan

**1. Read-only duplicate audit before the unique constraint; migration stops clearly; never silently deletes or merges.** Confirmed, and **already performed read-only**: `public.campaign_leads` = **70 rows**, **70 with `lead_id NOT NULL`**, **0 duplicate `(campaign_id, lead_id)` pairs**, total relation size **320 kB**. The audit will be re-run immediately before apply, and M1 additionally carries an in-migration `DO $$ … RAISE EXCEPTION` guard that **aborts the transaction** if any duplicate is present, so the index can never be created over dirty data. **No migration in this PR contains a `DELETE` or a merge against `campaign_leads`.**

**2. Locking risk assessed against the actual row count.** `CREATE UNIQUE INDEX` (non-`CONCURRENTLY`, because migrations run inside a transaction) takes `ACCESS EXCLUSIVE` on `public.campaign_leads` for the build duration. At **70 rows / 320 kB** that is sub-millisecond and `CONCURRENTLY` is unnecessary. The row count will be **re-measured in the preflight at apply time**; if it has grown by orders of magnitude I will stop and re-propose (a separate non-transactional `CONCURRENTLY` step) rather than proceed.

**3. The 32 Open Pool ownership-drift rows are a separate, explicitly approved production repair.** Confirmed. M1 changes **future inserts only**. **No `UPDATE public.campaign_leads` statement appears in any migration in this PR.** A second, separately gated runbook (preflight → repair → verification → rollback, all by immutable UUID) will be prepared alongside the 106-lead one and executed only on its own approval.

**4. Personal-campaign dialing enforced server-side on every dialing path.** Confirmed for every path where the server acts, plus one honest limit you should decide on:
   - `start_dialer_session` gains a hard server-side campaign-scope check (**M3**) — this is the real gate for a Dialer session.
   - **NEW in this revision:** a read-only `public.can_dial_campaign(p_campaign_id uuid) RETURNS boolean` (`SECURITY DEFINER STABLE`, pinned `search_path`, revoked from `PUBLIC`/`anon`, granted to `authenticated`) implementing §2.4 **server-side**. Every dialing entry point — picker, `?campaign=` param, DialerPage lead load, CampaignDetail "Start Dialing", CampaignDetail quick-call — gates on the **server's** answer rather than a client-side predicate. This replaces "hidden frontend controls" with a server-authoritative decision at each entry point.
   - **Honest limit, needs your call.** The CampaignDetail quick-call path goes `FloatingDialer` → `TwilioContext.makeCall()` → `calls` INSERT + `twilioMakeCall`. It does **not** pass through `start_dialer_session`. A *hard, non-bypassable* server block on it needs either (i) tightening `campaign_leads_select` (that is D-7 territory, dialer hot path, `#APPROVE_RLS_CHANGE`), or (ii) a guard in `TwilioContext.tsx`, which the brief forbids. **Reframing worth your attention:** an Admin already has org-wide lead access by design (`Leads Hierarchical Access` grants Admins every lead in the org), so they can dial that same person from Contacts regardless. The locked decision is about **Personal campaign dialing sessions**, which M3 + `can_dial_campaign` do hard-block. I therefore propose: hard-block the session paths server-side now, remove the campaign-context quick-call affordance for non-owner Personal campaigns, and treat the residual `campaign_leads_select` tightening as the D-7 follow-up. **If you want the quick-call hard-blocked at the database in this PR, that is a D-7 approval and I will scope it.**

**5. SQL tests prove same-org Admin *management* is permitted while unauthorized Agent/Team Leader access is blocked.** Confirmed, with one **conflict I must surface rather than paper over**: live `campaigns_select` grants the role short-circuit to `ANY(ARRAY['Admin','Team Leader','Team Lead'])`, and `campaign_leads_select` does the same — **a Team Leader already has management read on another agent's Personal campaign at the database layer.** Locked decision 4 says TLs must not gain access; the brief also says do not *broaden* TL access. Both are satisfiable only as: I do **not** broaden it, the new frontend **management** helper does **not** grant TL cross-user Personal access, and the **dialer** helper blocks TL outright. The residual DB-level TL read is **pre-existing** and closing it is an RLS change (D-7 family). The SQL suite will therefore contain **characterization tests that pin this true current behaviour** (Admin ✓, Agent ✗, TL ✓-at-DB-but-✗-in-app) rather than assertions that would falsely imply the DB blocks TLs today.

**6. Private attachment core is not directly executable.** Confirmed, explicit: `REVOKE ALL ON FUNCTION private.attach_leads_to_campaign_core(uuid, uuid[], uuid) FROM PUBLIC, anon, authenticated;` with no compensating grant (mirroring `_import_undo_context` / `_import_undo_blockers`, which are `postgres`-only today). Every public wrapper (`add_leads_to_campaign`, `create_import_campaign`, `retry_import_campaign_attachment`, `can_dial_campaign`) validates **`auth.uid()`, organization via `get_org_id()`, role scope, campaign compatibility, and immutable provenance** internally before delegating. A SQL test asserts `has_function_privilege('authenticated', …, 'EXECUTE')` and `has_function_privilege('anon', …, 'EXECUTE')` are both **false** for the core, and that `anon` cannot execute any of the public wrappers.

**7. The 106-lead repair stays separately gated and unexecuted.** Confirmed. §9 is a prepared runbook only. Nothing in it runs until code review + migration review + automated verification + your manual validation + a **separate explicit approval**.

---

## 11. Risks & unresolved evidence

1. **`campaign_leads.user_id` for Open Pool changes meaning.** Today all 32 Open-Pool rows carry the importer's UUID; after M1 new rows carry `leads.assigned_agent_id` (often NULL). No consumer of Open-Pool `user_id` was found (`campaign_leads_select`'s Open-Pool branch does not read it), but I will re-audit every reader before implementing and will **not** backfill existing rows without separate approval.
2. **The unique index is new.** Production has 0 duplicates today, but the migration aborts on any it finds rather than deduplicating silently.
3. **Team has zero production coverage** — 9 Personal + 1 Open Pool, **no Team campaign exists anywhere**. The Team eligibility rewrite is therefore unexercisable against real data; it will be proven by the SQL suite (subject to D-5) and unit tests only. I will say so plainly in the handoff.
4. **Broadening management visibility is a real behaviour change** — Admins/Super Admins will start seeing agent-owned Personal campaigns on `/campaigns`. That is locked decision 4a, but it will look like a regression to anyone who hasn't read it, so it goes in the WORK_LOG and the PR body.
5. **Not reproducible:** no `custom_fields` row named `New Field` exists in production, so the exact "New Field" repro could not be replayed against live data. The root cause is proven by executing the real algorithm against the 14 real custom-field names (all `null`), which is stronger, but the specific row is gone.
6. **NOT VERIFIED and not investigated further:** who deleted the leads behind imports `d8e8c294…` and `6458c84c…`, and by what mechanism (no audit table exists).
7. **No CI exists on this repo** (no `.github/workflows`), so the local gates in §6 remain the only authority — as in every recent entry. Under D-5 option A this changes: `.github/workflows/sql-tests.yml` would be the repo's first CI workflow.
8. **D-2 carries a narrow, deliberate regression.** With Team Leaders failing closed, a TL can no longer create a Personal campaign **owned by a downline agent** through the import flow; they get a clear authorization error. Lead *assignment* is unaffected (D-6 leaves the Edge Function untouched). This is security-correct but user-visible, so it goes in `WORK_LOG.md`, `AGENT_RULES.md` and the PR body — and the frontend must surface the server's error clearly rather than appearing to succeed.
9. **Required follow-ups created by this plan** (each its own approval): repair `profiles.hierarchy_path` so `is_ancestor_of` works (D-2) · Edge Function target-agent role scope (D-6) · `campaign_leads_update`/`campaign_leads_delete` RLS tightening (D-7) · the 32-row Open Pool `campaign_leads.user_id` drift repair (§13.1) · consolidation of the 28 duplicate personal custom fields (§3.8).

---

## 12. Stop condition

**Nothing beyond this file has been changed.** No product source file, no migration, no RPC, no Edge Function, no deployment, no commit, no push, no PR, no production data. Awaiting Chris's explicit approval — and answers to §10 — before implementation begins.


---

## 14. As-built verification record (2026-08-07)

### Executed and green

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| Full `npx vitest run` (host TZ `America/Los_Angeles`) | **1131 passed / 1131 in 83 files** (991 baseline + 140 new, **zero regressions**) |
| `TZ=UTC npx vitest run` | **1119 passed / 12 skipped (1131)** — the known `laOnly` DST skips |
| `TZ=America/Los_Angeles npx vitest run` | **1131 / 1131** |
| ESLint `--max-warnings 0` on all 10 NEW files | **0 problems** |
| ESLint on all 9 EDITED files | **byte-identical warning counts vs `origin/main`** (measured per file by swapping in the HEAD version): campaign-assignee-scope 0/0 · useDialerSession 3/3 · ImportLeadsPage 5/5 · Campaigns 4/4 · Contacts 10/10 · CampaignDetail 9/9 · DialerPage 23/23 · AddToCampaignModal 0/0 · ImportLeadsModal 4/4. **Zero new findings.** |
| `npm run build` | succeeds (18.4 s) |
| `git diff --check` | clean |
| Scope audit vs `origin/main` | exactly the approved file set + the CI workflow; standing tree noise (`deno.lock`, `.claude/`, `.cursor/`, `tsconfig*.tsbuildinfo`) excluded as always |

### Fail-first proof (run against unmodified source FIRST)

- **Pure-lib suites** (`importFieldMatching`, `importCampaignCompatibility`, `campaignAccessScope`, `importCampaignRpc`): **18 failed / 1 passed** — the single pass is the `filterCampaignsForAssignee` preservation pin. After implementation: **112 / 112**.
- **Component suites** (`importLeadsModalCampaign`, `importLeadsModalResult`, `importLeadsCustomFields`): run with `ImportLeadsModal.tsx` reverted to `origin/main` → **24 failed / 4 passed (28)**. The 4 passes are preservation pins (built-in auto-detection unchanged, ambiguity default, create-failure leaves no mapping, Personal offered for Specific Agent). After implementation: **28 / 28**.

### NOT EXECUTED — SQL regression suite (`supabase/tests/import_campaign_attachment.sql`, 32 assertions)

Both approved paths were **attempted**, per D-5.

1. **Local Docker** — Docker Desktop was started successfully (daemon reachable after ~20 s) and `supabase start` ran. It **failed during the from-scratch migration replay**:
   ```
   ERROR: relation "public.campaign_leads" does not exist (SQLSTATE 42P01)
   At statement: 0
   ALTER TABLE public.campaign_leads ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0
   ```
   failing migration: `supabase/migrations/20260308221542_0b777191-986d-4a61-9f2f-73e78d532fc1.sql:1`.
2. **Exact blocker, confirmed:** **40 local migrations reference `campaign_leads`; ZERO of them create it** (`grep -rli "create table.*campaign_leads" supabase/migrations/` → **0 files**). The table exists in production but its `CREATE TABLE` was never captured in a repo migration. A from-scratch replay therefore **cannot** succeed — in local Docker or in GitHub Actions, which uses the same `supabase db reset`.
3. **This is pre-existing historical drift, not caused by this PR.** The failure is at migration `20260308…`; this PR's migrations are `20260807165600/165610/165620` and are never reached. It matches the 2026-08-05 `WORK_LOG.md` note that lower-environment replay was previously blocked by unrelated migration drift.
4. **Per D-5 I did not repair the drift, and I stopped before proposing a paid development branch.** The local stack was stopped cleanly (`supabase stop --no-backup`). No mutation test was run against production at any point.

The suite ships with a `T0` guard that aborts loudly if the migrations are absent, and wraps everything in `BEGIN … ROLLBACK`. **It is reported NOT EXECUTED and must not be represented as passing.**

### NOT EXECUTED — authenticated browser verification

Standing environment limitation recorded in prior WORK_LOG entries: no authenticated session exists here. No credentials were entered. The Dialer/Campaign/Import surfaces should be eyeballed on the PR preview at review time.

---

## 15. Next approval required

1. Review the diff and the three migration files.
2. Approve **committing and pushing** the branch and opening a PR (not done — no commit, no push, no PR exists).
3. Approve **applying M1 → M2 → M3 to production** in that order, with the advisor runs, before any frontend deploy.
4. Decide the SQL-suite path now that the blocker is known: repair the missing `campaign_leads` baseline migration as its own task (recommended, unblocks CI permanently), or authorize a disposable dev branch.
5. Separately gate the **106-lead production repair** (§9) and the **32-row Open Pool ownership-drift repair** (§13.1).


---

## 16. Zod contracts (corrective pass — §1 of the review)

**Reused, not duplicated.** The custom-field creation form is already fully covered by the shared
`customFieldSchema` in **`src/components/settings/contact-flow/contactFlowSchemas.ts:29-56`**
(trim / min 1 / max 40 name, type enum, `appliesTo`, `required`, `active`, `defaultValue`,
dropdown options via `superRefine`). The import mapper previously bypassed it with an ad-hoc
check; it now calls `customFieldSchema.safeParse(...)` directly, so a 200-character CSV header can
no longer become a 200-character field name via import while Settings rejects it. Covered by
`src/components/contacts/__tests__/importCampaignSchemas.test.ts` ("shared customFieldSchema is
reused, not duplicated").

**New — `src/components/contacts/importCampaignSchemas.ts`.** Shape only: UUIDs, enums, counts,
nullable fields, RPC envelopes. **No eligibility or authorization logic is duplicated** — those stay
in `import-campaign-compatibility.ts` and, authoritatively, in the database functions. There is an
explicit test asserting the schema *accepts* a Round-Robin+Personal payload so the **server** remains
the rejecting authority.

| Boundary | Schema | Enforced where |
|---|---|---|
| `create_import_campaign` request | `createImportCampaignArgsSchema` | `createImportCampaign()` validates **before** the call; a bad UUID never leaves the browser |
| `create_import_campaign` response | `createdImportCampaignSchema` | throws on a malformed envelope rather than returning a half-built campaign |
| `retry_import_campaign_attachment` response | `importRetryResultSchema` | counts are rendered to the user, so negative/fractional values are rejected |
| `finalize_contact_import` response | `importFinalizeOutcomeSchema` | status constrained to the DB CHECK set, nullable for legacy rows |
| `can_dial_campaign` response | `canDialCampaignSchema` | **strictly boolean**; anything else is not a grant — fails closed |
| Edge Function `customFields` payload | `importCustomFieldsPayloadSchema` | see §20 |

---

## 17. SQL workflow (corrective pass — §2 of the review)

`.github/workflows/sql-tests.yml` is now **`workflow_dispatch` only**. It is *not* wired to
`pull_request`/`push`, because a clean replay cannot currently reach these migrations and an
automatic trigger would add a guaranteed-red required check to every PR. The file header documents
the exact blocker, states plainly that the job is expected to fail today, and gives the enabling
condition (land the baseline-migration repair, dispatch once to confirm green, then add the
`pull_request` trigger in that same PR).

**The suite is not weakened, skipped, or made to pass artificially.** It opens with a `T0` guard that
aborts if the migrations under test are absent and wraps everything in `BEGIN … ROLLBACK`. It remains
**NOT EXECUTED**.

---

## 18. M1 production preflight + locking analysis (corrective pass — §3 of the review)

Read-only, production, 2026-08-07. **No rows were modified.**

| Measure | Value |
|---|---|
| `count(*)` | **70** |
| `lead_id IS NOT NULL` / `IS NULL` | **70 / 0** |
| Duplicate `(campaign_id, lead_id)` groups | **0** |
| Excess duplicate rows | **0** |
| Exact duplicate groups | **none — query returned `[]`** |
| Table size / indexes / total | **88 kB / 232 kB / 320 kB** |
| Planner `reltuples` | 38 (stale stats; actual 70) |

Existing indexes on the table: `campaign_leads_pkey (id)` UNIQUE PRIMARY, plus seven **non-unique**
indexes (`idx_campaign_leads_campaign_id`, `_status`, `_org`, `_callback_due_at`,
`_retry_eligible_at`, `_scheduled_callback (campaign_id, scheduled_callback_at)`,
`_import_history_id`). Constraints touching either column: **only two foreign keys** —
`campaign_leads_campaign_id_fkey … ON DELETE CASCADE` and `campaign_leads_lead_id_fkey … ON DELETE
SET NULL`. **No unique constraint or unique index covers `(campaign_id, lead_id)` today.**

**Exact DDL and its locking implications.**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS campaign_leads_campaign_lead_unique
  ON public.campaign_leads (campaign_id, lead_id)
  WHERE lead_id IS NOT NULL;
```
- Non-`CONCURRENTLY`, because a Supabase migration runs inside a transaction and `CREATE INDEX
  CONCURRENTLY` cannot. It therefore takes **`ACCESS EXCLUSIVE`** on `public.campaign_leads` for the
  build — blocking reads and writes for that window.
- At **70 rows / 88 kB** the build is sub-millisecond. The dialer's queue reads/writes would block
  for less time than a normal statement round-trip.
- **Partial** (`WHERE lead_id IS NOT NULL`) because `campaign_leads_lead_id_fkey` is `ON DELETE SET
  NULL`: deleting a lead leaves an orphan row, and multiple orphans per campaign must stay legal.
- `IF NOT EXISTS` makes re-application a no-op.
- **The preflight is re-run at apply time inside the migration**: a `DO $$ … RAISE EXCEPTION …
  ERRCODE '23505'` block aborts the whole transaction if *any* duplicate exists — including one that
  appears between now and apply. **It never deletes, merges, or repairs.** If it fires, nothing is
  created and nothing is changed.
- **Escalation rule:** if the row count has grown by orders of magnitude at apply time, I stop and
  re-propose a non-transactional `CONCURRENTLY` step rather than proceed.

**The 32-row Open Pool ownership drift is untouched.** No migration in this change set contains an
`UPDATE` or `DELETE` against `public.campaign_leads` — verified by grep. It remains a separate,
separately-approved production repair.

---

## 19. Rollback artifact (corrective pass — §7 of the review)

**`supabase/rollback/20260807_import_campaign_attachment_rollback.sql`** — a single transactional,
executable script. It contains the **verbatim** pre-change definitions of all three replaced
functions, captured from production via `pg_get_functiondef` before any migration was authored, and
**md5-verified byte-identical to production**:

| Function | md5 (production == artifact) |
|---|---|
| `public.add_leads_to_campaign(uuid,uuid[],uuid)` | `23209844230a3bfe6a4eb6c0c14d4a77` |
| `public.finalize_contact_import(uuid)` | `64f3dec2e9759edd61ed6931ec0c9c46` |
| `public.start_dialer_session(uuid)` | `055b53e760e3e4d6bb7e13c5c1577709` |

It also drops the eight new functions, drops the unique index, restores the pre-change ACLs
(including the fact that `start_dialer_session` **did** have PUBLIC + anon EXECUTE), deletes the three
`supabase_migrations.schema_migrations` rows in the same transaction, and ends with a verification
`DO` block that raises if anything is left behind. Each migration header links to it by path.

---

## 20. Custom-field data path, end to end (corrective pass — §5 of the review)

```
CSV header  "New Field"
   │  matchCsvHeaderToField(header, options)                      import-field-matching.ts
   ▼
ImportFieldOption { value:"custom:<uuid>", canonicalName:"New Field",
                    label:"New Field (Custom)", kind:"custom", customFieldId:"<uuid>" }
   │  mappings[colIdx] = option.value          <-- UI STATE HOLDS THE STABLE ID
   ▼
"custom:<uuid>"
   │  resolveMappingToCanonicalName(value, options)               ImportLeadsModal.tsx
   ▼
"New Field"                                    <-- CANONICAL NAME
   │  customFieldsData[canonical] = cellValue
   │  importCustomFieldsPayloadSchema.safeParse(row.customFields)  <-- BOUNDARY GUARD
   ▼
POST /functions/v1/import-contacts  { customFields: { "New Field": "…" } }
   │  UNCHANGED Edge Function (live v43): incomingCf = {...row.customFields}
   │            custom_fields: Object.keys(incomingCf).length > 0 ? incomingCf : null
   ▼
leads.custom_fields  =  { "New Field": "…" }   <-- flat JSONB KEYED BY NAME
```

**Why the unchanged Edge Function still gets the contract it expects.** `import-contacts`
(`index.ts:266-268, 289`) passes `row.customFields` through **verbatim with no key rewriting**, and
`leads.custom_fields` is flat JSONB keyed by the field's canonical NAME (migration
`20260403000000`) with **no rename propagation anywhere**. Every existing reader keys by name
(`FullScreenContactView.tsx:1007/1013/1065-1069/1083`, `contactRequiredFields.ts:124-125`,
`contactFieldLayout.ts:123-127` via `custom:<name>` layout ids). So the payload key **must** stay the
name — which is exactly what `resolveMappingToCanonicalName` produces. The stable UUID exists only in
UI state and never crosses the wire.

**Proof that a UUID cannot be submitted where a name is expected.** `importCustomFieldsPayloadSchema`
rejects any key that is a `custom:` option value, a bare UUID, or carries the `(Custom)` suffix, and
`doImport` runs it over **every** row before the POST — aborting the import on violation rather than
persisting a corrupted shape. Regression coverage in
`src/components/contacts/__tests__/importCampaignSchemas.test.ts`:
- "END-TO-END KEY CONTRACT: CSV header → stable id → canonical name → Edge Function" walks the real
  helpers and asserts the final key is `"New Field"` and contains neither the UUID, nor `custom:`,
  nor `(Custom)`.
- "catches the regression where the stable id is submitted instead of the name" asserts the exact bug
  is rejected.
- "a display label can never become a payload key".


---

## 21. Final pre-PR corrections (2026-08-07)

**21.1 Rollback no longer touches migration history.** Every `INSERT`/`UPDATE`/`DELETE` against
`supabase_migrations.schema_migrations` is removed from
`supabase/rollback/20260807_import_campaign_attachment_rollback.sql`. Verified: grepping the file
with comment lines excluded returns **zero** executable statements referencing `schema_migrations`.
The script now restores **application schema and function state only**.

History reconciliation is a documented **separate operator step**, performed only after (1) the
schema rollback transaction commits, (2) post-rollback verification raises nothing, (3) the actual
remote migration list is inspected (`supabase migration list --linked` / MCP `list_migrations`), and
(4) the operator explicitly approves. The supported commands, listed but **not executed**:

```
supabase migration repair --status reverted 20260807165620
supabase migration repair --status reverted 20260807165610
supabase migration repair --status reverted 20260807165600
```

**21.2 Rollback preserves the permission hardening — deliberate exception to byte-identical
restoration.** The pre-change ACL for `public.start_dialer_session(uuid)` granted EXECUTE to
**PUBLIC and anon**. The rollback restores the previous function **body** (md5-verified identical)
but intentionally does **not** restore those grants: re-opening a privileged `SECURITY DEFINER`
function to unauthenticated roles during an incident response would be a security regression, and
nothing depends on them — the restored body still raises `authentication required` when
`auth.uid()` is NULL. The rollback keeps `REVOKE ALL … FROM PUBLIC, anon` plus
`GRANT EXECUTE … TO authenticated, service_role`, and its verification block now **fails** if `anon`
regained EXECUTE or if `authenticated` lost it.

**21.3 The unique index fails closed.** `IF NOT EXISTS` is removed. M1 now aborts the whole
transaction if: duplicates exist (pre-existing guard, `ERRCODE 23505`); **an object already occupies
the intended name** (new guard, `ERRCODE 42710` — the migration will not adopt a pre-existing object);
or the index cannot be created exactly as designed. A new post-create assertion re-reads
`pg_get_indexdef` and requires the index to be UNIQUE, on `(campaign_id, lead_id)`, and
`WHERE (lead_id IS NOT NULL)`. The read-only preflight evidence (§18) and the transactional duplicate
guard are retained. **No duplicate row is ever repaired or deleted.**

**21.4 `start_dialer_session` search_path hardened.** Was `search_path TO 'public','private','pg_temp'`;
now `search_path = pg_catalog, pg_temp` — the same restrictive pattern as the other ten functions
(**all 11 now declare exactly `SET search_path = pg_catalog, pg_temp`**). This is behaviour-preserving
because every application object the body touches was already schema-qualified —
`public.dialer_sessions` (SELECT, INSERT and the `%ROWTYPE` declaration), `public.get_org_id()`,
`public.can_dial_campaign(uuid)`, `private.close_stale_dialer_sessions(uuid,uuid,int)`, `auth.uid()`
— and the only remaining unqualified references, `now()` and `jsonb_build_object()`, are now written
as `pg_catalog.now()` / `pg_catalog.jsonb_build_object()`. **There is therefore no unqualified name an
attacker could resolve through this function's search path**, and no reasoning about implicit
`pg_catalog` precedence is required. **No dialer behaviour changed** — no scope expansion was needed.
SQL suite `T31` now asserts the exact string `search_path=pg_catalog, pg_temp` for all 11 functions.

---

## 22. Merge-readiness

**The SQL regression suite remains a PRE-MERGE BLOCKER.** `supabase/tests/import_campaign_attachment.sql`
is **NOT EXECUTED** and must not be represented otherwise. It cannot run until a faithful
non-production environment can replay the necessary schema — today blocked by the missing
`public.campaign_leads` `CREATE TABLE` (40 local migrations reference the table, **zero** create it),
which fails `supabase db reset` at `20260308221542_…sql:1` long before this branch's migrations are
reached. Repairing that baseline is a separate, tracked task.

Authenticated browser verification is likewise **NOT EXECUTED** (no session in this environment).

Neither may be reported as passing. The PR is opened as a **draft** for this reason.


---

## 23. Corrective pass #2 — intended file list (recorded BEFORE editing, 2026-08-07)

Approved scope: PR #352 review items 1–8. No approved product decision is reopened. Branch
`bugfix/import-campaign-attachment`, on top of commit `3562d9e`.

| # | File | Action | Reason |
|---|---|---|---|
| 1 | `supabase/migrations/20260807165620_dialer_session_campaign_access.sql` | EDIT | Item 1 — authorize the EXISTING active session's own `campaign_id` before returning it; refuse a mismatched requested campaign; correct the rollback comment (item 7) |
| 2 | `supabase/migrations/20260807165600_campaign_leads_membership_uniqueness_and_attachment_core.sql` | EDIT | Item 2 — `private.can_administer_campaign` implements the full management matrix for Team (owner / participant / Admin / SA / authorized TL) instead of returning true for every non-Personal campaign. Item 4 — provenance-aware, non-overlapping counts from `private.attach_leads_to_campaign_core` |
| 3 | `supabase/migrations/20260807165610_import_campaign_creation_and_retry.sql` | EDIT | Item 3 — strict strategy↔owner/participant contract in `create_import_campaign`; import-set compatibility precheck. Item 4 — `private.import_attachment_status` returns the non-overlapping partition; `finalize_contact_import` + `retry_import_campaign_attachment` return it |
| 4 | `src/hooks/useDialerSession.ts` | EDIT | Item 1 — cached active-session state may not bypass campaign revalidation |
| 5 | `src/pages/CampaignDetail.tsx` | EDIT | Item 1 — bind the dial-authorization result to the campaign id it was resolved for |
| 6 | `src/components/contacts/ImportLeadsModal.tsx` | EDIT | Items 4 + 6 — truthful non-overlapping counts, no campaign-attachment wording for a no-campaign import, reset the settings-loaded gate per opening |
| 7 | `src/pages/Contacts.tsx` | EDIT | Item 4 — no attachment retry/wording for an import with no campaign |
| 8 | `src/pages/CampaignDetail.tsx` (import-history tab) | EDIT | Item 4 — same |
| 9 | **NEW** `src/lib/import-campaign-schemas.ts` | ADD | Item 5 — schemas move to a shared non-UI module so `src/lib` no longer depends on a component |
| 10 | `src/components/contacts/importCampaignSchemas.ts` | DELETE | Item 5 — superseded by (9) |
| 11 | `src/lib/supabase-import-undo.ts` | EDIT | Item 5 — validate the `finalize_contact_import` envelope at the real RPC boundary |
| 12 | `src/lib/supabase-import-campaign.ts` | EDIT | Item 5 — import from the shared module |
| 13 | `src/components/contacts/__tests__/importCampaignSchemas.test.ts` | EDIT | Item 5 — retarget to the shared module; add finalize-envelope cases |
| 14 | `src/lib/__tests__/importUndo.test.ts` | EDIT | Item 5 — finalize envelope validation tests |
| 15 | `src/lib/__tests__/importCampaignRpc.test.ts` | EDIT | Item 4 — partition-identity coverage |
| 16 | `src/components/contacts/__tests__/importLeadsModalResult.test.tsx` | EDIT | Item 4 — all four categories + no-campaign import |
| 17 | `src/components/contacts/__tests__/importLeadsCustomFields.test.tsx` | EDIT | Item 6 — deferred-promise reopen race |
| 18 | **NEW** `src/hooks/__tests__/dialerSessionCampaignScope.test.ts` | ADD | Item 1 — cached-session bypass coverage |
| 19 | `supabase/tests/import_campaign_attachment.sql` | EDIT | Items 1–4 — new SQL regression cases |
| 20 | `supabase/rollback/20260807_import_campaign_attachment_rollback.sql` | EDIT | Item 7 — comment corrections only |
| 21 | `implementation_plan.md`, `WORK_LOG.md` | EDIT | Item 7 |

**Nothing else.** Explicitly untouched: `TwilioContext.tsx`, call telemetry, `calls.duration` writers,
dispositions, queue locking/claiming, `advance_campaign_lead`, the undo RPC family's behaviour,
`supabase/functions/**`, every RLS policy, generated types, dependencies.


---

## 24. Corrective pass #2 — as-built (2026-08-07)

### 24.1 Saved/active dialer session authorization (item 1)

`start_dialer_session` previously authorized only the SUPPLIED `p_campaign_id` and then returned any
existing active session without authorizing that session's own campaign. The reuse branch now:

- re-authorizes `v_session.campaign_id` via `public.can_dial_campaign` and **raises 42501** if the
  caller may not dial it — closing `start_dialer_session(NULL)` (guard skipped entirely) and the
  authorized-request/unauthorized-session shape;
- **refuses** when a non-null `p_campaign_id` differs from the active session's campaign, rather than
  silently returning the mismatched session;
- **does not end, abandon, rewrite or replace any session.** Nothing in `dialer_sessions` is mutated
  as an authorization workaround — `T34c` asserts the session is still `active` after the refusals.

`useDialerSession` gained `activeSessionCampaignRef`: `startServerSession` now short-circuits **only**
when the cached session is for the requested campaign, so cached state can no longer bypass the
server's revalidation. The ref is cleared with the rest of the session state.

`CampaignDetail` stores the authorization answer **with the campaign id it was resolved for**
(`{campaignId, allowed}`) and derives `dialAllowed` during render. A bare boolean left a one-render
window after a route change where the previous campaign's `true` authorized the newly navigated
campaign; deriving it makes an id change fail-closed immediately.

Tests: SQL `T33`–`T34`; `src/hooks/__tests__/dialerSessionCampaignScope.test.ts` (10 cases).

### 24.2 Team campaign RPC authorization (item 2)

`private.can_administer_campaign` returned `true` for **every** non-Personal campaign after only an
org check, leaving `add_leads_to_campaign` a same-org arbitrary-write endpoint for Team campaigns.
It now implements the approved matrix: Personal → owner / Admin / Super Admin / canonically
authorized TL; **Team → owner / listed participant / Admin / Super Admin / canonically authorized
TL**; Open Pool → org-wide; cross-org always rejected. Role comes from `public.profiles`, never the
request. Tests: SQL `T35` (non-participant TL refused, including with an unassigned lead; cross-org
refused) and `T36` (a listed participant may still attach).

### 24.3 Import strategy contract + routing precheck (item 3)

`create_import_campaign` now rejects inconsistent strategy/owner/participant combinations instead of
reinterpreting them: `myself` may not name another owner or other participants; `specific_agent`
requires exactly one participant equal to the owner (Personal) or exactly one participant (Team);
`round_robin` requires a non-empty unique participant set and is rejected for Personal;
`unassigned` is rejected for Personal and takes exactly the caller for Team (D-3); Open Pool takes
no participant list at all.

`add_leads_to_campaign` gained an **import-only** routing precheck that reads ownership from the
database over the immutable imported id set and refuses **before inserting anything**: Personal
cannot receive unassigned leads or leads owned by more than one agent (or by anyone other than the
campaign owner); Team must cover every assigned imported lead's agent (unassigned stay allowed);
Open Pool keeps same-org behaviour. **Generic non-import callers are untouched** and keep their
per-lead skip behaviour and reason-specific response. Tests: SQL `T37` (six rejections), `T38`
(nothing inserted before the refusal).

### 24.4 Non-overlapping, truthful counts (item 4)

`private.import_attachment_status` now returns a genuine partition computed from actual rows and
`import_history_id` provenance:

```
imported_count = attached_count + already_present + ineligible_count + remaining_count
```

- **attached** — membership rows created by THIS import (provenance match)
- **already present** — in the campaign but not created by this import
- **ineligible** — currently incompatible and not a member
- **remaining** — eligible and not yet a member (the only retryable category)

The function raises if the partition does not cover the distinct imported set, and
`attach_leads_to_campaign_core` raises if its own per-call categories do not. For an import with **no
campaign** all four are `NULL` and `has_campaign` is `false`, so no surface can render
"0 attached to the campaign" or campaign-attachment wording for an import that never targeted one.

Frontend: `applyAttachCounts` no longer hardcodes `alreadyPresent: 0` — it sets nothing unless the
server supplied all four. The result screen shows "N attached by this import" and reports ineligible
separately from "still to attach". `hadCampaignTarget` gates the whole attachment block and the retry
button; `Contacts` and `CampaignDetail` history rows gate retry on `campaign_id`.

Tests: `importCampaignSchemas.test.ts` partition identity (incl. rejecting the old double-counting
shape); `importLeadsModalResult.test.tsx` four-category + no-campaign cases; SQL `T39`–`T40`.

### 24.5 Finalization Zod contract is consumed (item 5)

The schemas moved to **`src/lib/import-campaign-schemas.ts`** so `src/lib` no longer depends on a
component directory. `src/lib/supabase-import-undo.ts` `finalizeImport` now parses the envelope with
`importFinalizeOutcomeSchema` and **throws** on a malformed response instead of
`data as unknown as ImportFinalizeResult`. Tests: 7 cases in `importUndo.test.ts`.

### 24.6 Custom-field reopen/loading race (item 6)

`loadSettings` now resets `settingsLoaded` and the per-file detection guard at the start of **each
opening**, so auto-detection waits for that opening's authoritative custom-field result.

**Correction made during this pass:** an initial attempt also cleared `activeLeadCustomFields` and
`settingsLoaded` inside `reset()`. That was wrong — `loadSettings` only re-runs on an `open`/org
change, so "Import Another File" would have been left with an empty field list and no reload,
permanently breaking detection. `reset()` now clears only the per-file guard. Covered by a
regression case.

Fail-first proven: with the gate reset removed, "waits for THIS opening's custom fields before
latching auto-detection" fails with `expected 'Do Not Import' to be 'custom:cf-x'`.

### 24.7 Documentation corrections (item 7)

M3's header no longer claims the rollback restores the prior PUBLIC/anon ACL — it states the
opposite, matching the approved hardening.

**Read-only production preflight, re-measured 2026-08-07 (no rows modified):**

| Measure | First preflight | **Current** |
|---|---|---|
| `campaign_leads` rows | 70 | **180** |
| Duplicate `(campaign_id, lead_id)` groups | 0 | **0** |
| `pg_relation_size` (heap only) | — | **48 kB** |
| `pg_table_size` (incl. TOAST/FSM) | 88 kB | **88 kB** |
| `pg_indexes_size` | 232 kB | **232 kB** |
| `pg_total_relation_size` | 320 kB | **320 kB** |
| These three migrations applied | 0 of 3 | **0 of 3** |

⚠️ **The row count moved from 70 to 180 while this branch was in review** — 110 rows created since
the first preflight, newest at `2026-08-07 19:20:54Z`, across 8 campaigns. The environment is live.
This does not change the locking conclusion (180 rows is still a sub-millisecond index build) and
duplicates remain 0, but it is why the migration re-checks duplicates at apply time inside the
transaction rather than trusting this snapshot. The earlier "70 rows" figure is stale, and the review
brief's restatement of it is superseded by this measurement.

Commit `3562d9e` is **not** rewritten or force-pushed; the inferred author identity is left as-is and
no replacement is guessed.
