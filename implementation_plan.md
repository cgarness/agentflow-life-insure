# Implementation Plan — Queue-Eligibility Build (Build 2b)

**Owner:** Chris Garness · **Date:** 2026-06-08
**Branch:** _to be created_ → `claude/queue-eligibility-licensed-state` (off `main`)
**Status:** APPROVED (D1/D2/D4/D5 defaults; D3 = author-don't-deploy). **Phase 1 DONE** (frontend-only). **Phase 2 DONE** — `20260608170000_normalize_state_codes_usps.sql` [PENDING APPLY] + edge normalize (NOT deployed) + TS write paths; SQL/TS/Deno parity proven. **Phase 3 DONE** — `20260608170100_licensed_state_access.sql` [PENDING APPLY] (column + trigger + 11-arg RPC + licensed-state filter in get_next_queue_lead & get_enterprise_queue_leads) + checkbox UI + empty-state copy; predicate validated read-only. **ALL THREE PHASES COMPLETE — STOPPED for review. No migration applied, nothing committed/pushed/deployed.** FINALIZE: apply `20260608170000` BEFORE `20260608170100`.

**Scope:** Retry presets (P1) → state normalization (P2) → licensed-state queue access (P3). **PHASED — STOP between phases for review.** Migrations are **FILES ONLY** during the build (do NOT apply, do NOT commit/push). This build EXTENDS Build 2a (settings trigger + save RPC).

---

## 0. Pre-flight — VERIFIED CONTEXT re-confirmed against LIVE PROD (`jncvvsvckxhqgqvkppmj`, read-only)

Read this session: `AGENT_RULES.md`, `VISION.md`, `WORK_LOG.md` (top entries; no `[IN PROGRESS]` conflicts — newest is `[DEPLOYED]` Build 2a), the prior `implementation_plan.md`, the modal/controls/schema, the DialerPage retry + save regions, `queue-manager.ts`, `us-states.ts`, `stateUtils.ts`, `supabase-campaign-leads.ts`. Then live introspection (`execute_sql` / `pg_get_functiondef` / `list_migrations`).

### Sequencing gate (Build 2a must be live)
| Build 2a object | Live result | Verdict |
|---|---|---|
| `campaigns.settings_edit_policy` column | present | ✅ |
| `can_edit_campaign_settings(uuid)` | present | ✅ |
| `update_campaign_settings(10 args)` | present, identity matches the 10-arg signature verbatim | ✅ |
| `enforce_campaign_settings_edit_permission()` | present; guards 10 cols via `IS DISTINCT FROM` (max_attempts, calling_hours_start/end, retry_interval_hours, retry_interval_minutes, ring_timeout_seconds, auto_dial_enabled, local_presence_enabled, number_group_id, settings_edit_policy) | ✅ |
| `trg_enforce_campaign_settings_edit` on `campaigns` | present | ✅ |
| lead-serving RPCs `get_next_queue_lead` / `fetch_and_lock_next_lead` / `get_enterprise_queue_leads` | all present | ✅ |

**→ Build 2a is live. Proceeding.** (No `[IN PROGRESS]` WORK_LOG conflicts.)

### Migration state
- **Latest APPLIED prod migration = `20260608163256` (`campaign_settings_edit_permissions`).** Note the known drift: local 2a file is `20260607160000_*` but it applied remotely as `20260608163256` (documented in WORK_LOG). **My new files are timestamped after `20260608163256`** so chronological order is correct regardless of the drift:
  - P2 → `supabase/migrations/20260608170000_normalize_state_codes_usps.sql`
  - P3 → `supabase/migrations/20260608170100_licensed_state_access.sql`
  - (P2 < P3 so normalization applies before the filter, per the FINALIZE note.)

### Retry-timing reality (live code) — re-confirmed, with one discrepancy flagged
- Canonical field `campaigns.retry_interval_minutes` is **NOT NULL** (default 1440); `retry_interval_hours` is legacy/display. `update_campaign_settings` writes **both**. ✅
- `DialerPage.getRetryIntervalMinutes()` (DialerPage.tsx:2091): prefers `retry_interval_minutes`, falls back to `retry_interval_hours*60`, then 1440. ✅
- **Authoritative DB retry timing is server-side**: `advance_campaign_lead` computes `retry_eligible_at` from `campaigns.retry_interval_minutes` (invariant #19) — already minutes. ✅
- **Personal-skip path** (DialerPage.tsx:**2189**, not ~2044 — file grew): `const skipRetryHours = retryIntervalHours > 0 ? retryIntervalHours : 24;` → uses **hours** directly. ⛔ This is the path P1 fixes.
- ⚠️ **DISCREPANCY (flagged, see Decision D1):** VERIFIED CONTEXT says "disposition/advance uses `getRetryIntervalMinutes()`." The *persisted* value does (server RPC, minutes). But a **client-side display-only** queue reshuffle, `applyQueueLifecycle` → `applyDispositionToQueue(retryIntervalHours)` (DialerPage.tsx:1961 → `queue-manager.ts:140`), still computes a *local* `retry_eligible_at` from **hours** for tier ordering. It does not write the DB. Not a hard blocker (DB value is already minutes), but to satisfy "all retry timing reads minutes" I propose converting it too — see D1.

### State data (live audit; the five normalize-target tables + the two excluded)
| Table | total | blank/null | 2-letter | other (full-name) |
|---|---|---|---|---|
| `leads` | 517 | 1 | 506 | 10 |
| `campaign_leads` | 66 | 1 | 56 | 9 |
| `agent_state_licenses` | 12 | 0 | 0 | 12 (all full names) |
| `clients` | **0 rows** (column exists; empty) | — | — | — |
| `recruits` | **0 rows** (column exists; empty) | — | — | — |
| `area_code_mapping` | 324 | 0 | 0 | 324 — **EXCLUDED (reference table, leave alone)** |
| `email_oauth_states` | n/a | — | — | **EXCLUDED (OAuth token column)** |

- **All 16 distinct non-2-letter values are valid US state names** (California, Florida, Arizona, Nevada, Alaska, Georgia, North Carolina, Ohio, Texas, Alabama, Arkansas, Colorado, Connecticut, Delaware, Indiana, Tennessee). **No DC, no junk → the 50-state+DC map covers 100%; the "unrecognized" list is expected to be EMPTY.** (P2 still reports any it can't map.)
- `clients`/`recruits` empty ⇒ the one-time UPDATE is a no-op there today, but is still authored (idempotent + future-proof); the going-forward TS helper still applies to their write paths.

### `agent_state_licenses` shape (for the P3 filter)
Columns: `id`, `agent_id uuid NOT NULL`, `organization_id uuid NOT NULL`, `state text NOT NULL`, `license_number`, `expiration_date date NULL`, `created_at`. RLS: 4 policies. **Active license = ANY row for the state** (ignore `expiration_date` — locked decision).

### Lead-serving RPC reality (live `pg_get_functiondef`)
- **`get_next_queue_lead(p_campaign_id, p_filters)`** — the ONE live path (`useLeadLock.ts:101`). `SECURITY DEFINER`; computes `v_org := get_org_id()`, `v_uid := auth.uid()`; `JOIN leads l ON l.id = cl.lead_id`; the SKIP-LOCKED subquery already references `cl.state` with `l.state` fallback (`cl.state = v_filter_state OR (cl.state IS NULL AND l.state = v_filter_state)`). **This is where the licensed-state predicate goes.**
- **`fetch_and_lock_next_lead`** — a **pure delegating wrapper**: `RETURN QUERY SELECT * FROM public.get_next_queue_lead(...)`. Only referenced by dead `dialer-queue.ts`. **It inherits any filter automatically.** (See D5 — do NOT inline a second copy; that would violate invariant #15 / forbidden-patterns.)
- **`get_enterprise_queue_leads(p_campaign_id, p_limit, p_offset, p_org_id)`** — `SECURITY DEFINER`; uses only `cl.state` (no `leads` join); does **not** currently read `auth.uid()`. **Referenced ONLY in generated `types.ts` — no app caller (effectively dead).** Predicate still applied for completeness (D5).

### Phase 3 column / nullability
- `require_licensed_state_access` does **NOT** exist yet. ✅
- `campaigns.organization_id` and `campaign_leads.organization_id` are both **nullable** — the RPCs already scope org via `get_org_id()`/`p_org_id`; the license subquery uses the campaign's loaded org var, so nullability is handled.

**Verdict: no BLOCKERS** (D1 is a documented display-only refinement, not a context conflict on persisted behavior). STOP for approval before any write.

---

## 1. Files & migrations (exhaustive, by phase)

### Phase 1 — Retry presets (frontend only; NO migration)
| # | Path | Change |
|---|------|--------|
| 1 | `src/components/dialer/campaignSettingsControls.tsx` | **Add** `RETRY_PRESETS` + `RetryIntervalField` (preset `<select>` mapping to minutes + "Custom (minutes)" number input). Keep file < 200. |
| 2 | `src/components/dialer/campaignSettingsSchema.ts` | Replace `retryIntervalHours` rule with `retryIntervalMinutes` (`int`, `>= 0`, `<= 10080`). |
| 3 | `src/components/dialer/CampaignSettingsModal.tsx` | Swap the `NumberField "Retry Interval (hours)"` for `<RetryIntervalField>`; rename props `retryIntervalHours`→`retryIntervalMinutes` (+ setter). Re-verify `wc -l < 200`. |
| 4 | `src/pages/DialerPage.tsx` | (a) modal props at the **two** render sites (4067/4839); (b) save path: parse `retryIntervalMinutes`, set `p_retry_interval_minutes = minutes`, `p_retry_interval_hours = Math.ceil(minutes/60)`, mirror both locally; (c) modal-load (2726): populate preset from `retry_interval_minutes`; (d) **Personal-skip (2189): use `getRetryIntervalMinutes()` not `retryIntervalHours`**; (e) **D1**: optionally convert `applyDispositionToQueue` call (1961) to minutes. |
| 5 | `src/lib/queue-manager.ts` *(only if D1 = yes)* | `applyDispositionToQueue` param `retryIntervalHours`→`retryIntervalMinutes` (`now + minutes*60_000`); update its unit tests. |

### Phase 2 — State normalization (one migration FILE + going-forward TS)
| # | Path | Change |
|---|------|--------|
| 6 | `supabase/migrations/20260608170000_normalize_state_codes_usps.sql` | **NEW, [PENDING APPLY]**. `public.normalize_us_state(text)`; one-time UPDATE of `leads/clients/recruits/campaign_leads/agent_state_licenses`; `RAISE NOTICE` row-change counts + any unrecognized values; **D2**: optionally re-CREATE `add_leads_to_campaign` to normalize the copied `state`. Ends with `NOTIFY pgrst,'reload schema'`. |
| 7 | `src/utils/stateUtils.ts` | **Reuse** the existing `normalizeState`/`formatStateToAbbreviation` (already the exact normalizer: 2-letter uppercase passthrough, full-name→code, blank→`""`, unrecognized untouched). Add a thin `export const normalizeUsState = normalizeState` alias for the name the task uses. **No duplicate map.** |
| 8 | `src/lib/supabase-leads.ts`, `supabase-clients.ts`, `supabase-recruits.ts`, `supabase-contacts.ts` | Wire `normalizeUsState` into the create/update `state` writes (lib-layer chokepoint covers all UI callers). Exact functions confirmed at P2 build. |
| 9 | `src/components/contacts/ImportLeadsModal.tsx` | **Verify only** — already calls `formatStateToAbbreviation` (line 728). |
| 10 | `supabase/functions/import-contacts/index.ts` | **D3** — Deno import path does NOT normalize (`state: (row?.state ?? "").toString()`, line 224). Decide: author a Deno normalizer (NOT deployed this build) vs. rely on P2 migration + app paths. |

### Phase 3 — Licensed-state filter + checkbox (one migration FILE + UI)
| # | Path | Change |
|---|------|--------|
| 11 | `supabase/migrations/20260608170100_licensed_state_access.sql` | **NEW, [PENDING APPLY]**. (1) ALTER `campaigns` ADD `require_licensed_state_access boolean NOT NULL DEFAULT false`; (2) re-CREATE `enforce_campaign_settings_edit_permission()` adding the new col to `v_changed`; (3) **DROP** `update_campaign_settings(10-arg)` then **CREATE** the 11-arg version (append `p_require_licensed_state_access boolean`) + re-REVOKE/GRANT; (4) re-CREATE `get_next_queue_lead` + `get_enterprise_queue_leads` with the licensed-state predicate (**D5**: `fetch_and_lock` left as wrapper, inherits); (5) `NOTIFY pgrst,'reload schema'`. |
| 12 | `src/pages/DialerPage.tsx` | New `requireLicensedStateAccess` state; load it (modal-load + sync effects); pass to modal (2 sites); add `p_require_licensed_state_access` to the RPC call; mirror locally. |
| 13 | `src/components/dialer/CampaignSettingsModal.tsx` | Add "Require licensed-state access" checkbox in Settings, gated by `can_edit_campaign_settings` (settings-editors only) + helper copy. Re-verify `< 200`. |
| 14 | `src/components/dialer/campaignSettingsControls.tsx` / `campaignSettingsSchema.ts` | Reuse `ToggleRow`; add the checkbox helper/copy strings. |
| 15 | Empty-state UX (`QueueExhaustedNotice` / Team-Open + Personal notices in DialerPage) | "No leads in your licensed states for this campaign," — never a silent blank dialer. |

### Docs (each phase)
| # | Path | Change |
|---|------|--------|
| 16 | `WORK_LOG.md` | Newest-first entry per phase (changes, files, migration `[PENDING APPLY]`, non-DB verification, decisions, deferred, Context Snapshot). |
| 17 | `implementation_plan.md` | This file. |
| 18 | `AGENT_RULES.md` | Only if a new invariant is discovered (e.g., the state-normalization canon / licensed-state filter rule) — append in the same phase. |

**Will NOT touch:** `TwilioContext.tsx`, lock-ownership/claim semantics, `calls.duration`/telemetry, disposition logic, card stats, `campaigns_update` RLS, `email_oauth_states`, `area_code_mapping`, Contacts/kanban filtering (dialer-only). No mock data.

---

## 2. Phase 1 detail — Retry presets

**Control (`campaignSettingsControls.tsx`):**
```ts
export const RETRY_PRESETS = [
  { label: "Immediate", minutes: 0 }, { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 }, { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 }, { label: "4 hours", minutes: 240 },
  { label: "24 hours", minutes: 1440 },
] as const;
// RetryIntervalField({ minutes, onChange }): <select> of presets + "Custom (minutes)";
// when value isn't a preset (or user picks Custom) show a number input (min 0) bound to minutes.
```
**Schema:** `retryIntervalMinutes: z.number().int(">= whole minutes").min(0).max(10080)` (168h ceiling, matching the old hours bound). Replaces `retryIntervalHours`.
**Save (DialerPage):** `const nextRetryMinutes = parsed.data.retryIntervalMinutes;` → `p_retry_interval_minutes: nextRetryMinutes`, `p_retry_interval_hours: Math.ceil(nextRetryMinutes / 60)`. Mirror both into local campaign state.
**Modal-load (2726):** `const mins = campaignData.retry_interval_minutes ?? (campaignData.retry_interval_hours ?? 24) * 60; setRetryIntervalMinutes(mins);` (control decides preset vs custom). Drop the now-unused `setRetryIntervalHours` derivation in the modal-load (the `retryIntervalHours` state remains as `getRetryIntervalMinutes()`'s fallback, still loaded by the campaign-load at 1509/3014).
**Personal-skip (2189):** `const retryAt = new Date(Date.now() + getRetryIntervalMinutes() * 60_000).toISOString();` (delete `skipRetryHours`).
**Modal prop:** pass `retryIntervalMinutes={retryIntervalMinutes ?? 1440}` (modal always gets a number).

**P1 Verify (no DB mutation):** 30m preset persists as `retry_interval_minutes=30` (RPC arg inspection / local mirror); a skipped Personal lead's `retry_eligible_at ≈ now+30m` (not 0, not 24h); advance (server, minutes) and skip (now minutes) agree; `npx tsc --noEmit` clean; `vitest` green (incl. updated `queue-manager` tests if D1=yes).

---

## 3. Phase 2 detail — State normalization

**Migration `20260608170000_normalize_state_codes_usps.sql` (FILE ONLY, [PENDING APPLY]):**
```sql
CREATE OR REPLACE FUNCTION public.normalize_us_state(p_raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_raw IS NULL OR btrim(p_raw) = '' THEN p_raw                  -- blank untouched
    WHEN btrim(p_raw) ~ '^[A-Za-z]{2}$'
      AND upper(btrim(p_raw)) IN (<50 codes + DC>) THEN upper(btrim(p_raw))  -- uppercase valid 2-letter
    ELSE COALESCE(  (SELECT code FROM (VALUES ('alabama','AL'), ... ('district of columbia','DC')) m(name,code)
                      WHERE m.name = lower(btrim(p_raw))),
                    p_raw)                                              -- full-name→code, else untouched
  END;
$$;
-- One-time normalize (each guarded to only touch rows that actually change):
UPDATE public.leads               SET state = public.normalize_us_state(state) WHERE state IS DISTINCT FROM public.normalize_us_state(state);
-- ... clients, recruits, campaign_leads, agent_state_licenses (same form)
-- DO block: RAISE NOTICE the per-table changed counts + any value where normalize_us_state(state)=state AND state !~ '^[A-Z]{2}$' AND btrim(state)<>'' (unrecognized).
NOTIFY pgrst, 'reload schema';
```
- Map must mirror `stateUtils.STATE_ABBR_TO_NAME` exactly (50 + DC). Expected changed rows ≈ 10 (`leads`) + 9 (`campaign_leads`) + 12 (`agent_state_licenses`); `clients`/`recruits` 0. Expected unrecognized list: **empty**.
- **D2:** optionally re-CREATE `add_leads_to_campaign` so the copied `state` is wrapped `public.normalize_us_state(v_lead.state)` — defense-in-depth for the enqueue path (the only server-side `campaign_leads.state` writer). Recommended ON (one-line wrap; I have the full live body).

**Going-forward TS:** reuse `stateUtils` (alias `normalizeUsState`), wire into the lib-layer create/update `state` writes for leads/clients/recruits + the contact-edit save. ImportLeadsModal already covered.

**P2 Verify (read-only):** after a *dry-run mental apply* (migration stays a file), the five tables would hold only 2-letter or blank; unrecognized leftovers reported (expected none); new contact "California" → stored "CA" via the wired helper (unit-level). `npx tsc --noEmit` clean. **No DB mutation performed.**

---

## 4. Phase 3 detail — Licensed-state filter + checkbox

**Migration `20260608170100_licensed_state_access.sql` (FILE ONLY, [PENDING APPLY]):**
1. `ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS require_licensed_state_access boolean NOT NULL DEFAULT false;`
2. Re-CREATE `enforce_campaign_settings_edit_permission()` — append to `v_changed`: `OR NEW.require_licensed_state_access IS DISTINCT FROM OLD.require_licensed_state_access` (keeps the existing 10 checks).
3. `DROP FUNCTION public.update_campaign_settings(uuid,integer,time,time,integer,integer,integer,boolean,boolean,text);` then `CREATE` the 11-arg version (append `p_require_licensed_state_access boolean`); keep all existing logic; add `require_licensed_state_access = COALESCE(p_require_licensed_state_access, require_licensed_state_access)` to the UPDATE; re-`REVOKE ALL … FROM PUBLIC` + `GRANT EXECUTE … TO authenticated` on the new identity.
4. Re-CREATE `get_next_queue_lead` and `get_enterprise_queue_leads` with the **identical** predicate (load `require_licensed_state_access` + campaign org into a var first):
```sql
-- inside the SKIP-LOCKED subquery (get_next_queue_lead) / final WHERE (get_enterprise_queue_leads):
AND ( NOT v_require_licensed
   OR <eff_state> IS NULL
   OR upper(<eff_state>) IN ( SELECT upper(btrim(asl.state))
                              FROM public.agent_state_licenses asl
                              WHERE asl.agent_id = v_uid AND asl.organization_id = v_org ) )
```
   - `get_next_queue_lead`: `<eff_state> = NULLIF(btrim(COALESCE(NULLIF(btrim(cl.state),''), l.state)),'')` (cl.state with l.state fallback — mirrors the existing manager-filter), `v_uid := auth.uid()`, `v_org := get_org_id()` (already in body).
   - `get_enterprise_queue_leads`: `<eff_state> = NULLIF(btrim(cl.state),'')` (no leads join); add `v_uid uuid := auth.uid();` and load `organization_id` + `require_licensed_state_access` in the step-1 settings SELECT; use that org for `v_org`.
   - Filter is **inside** the eligibility query (before/at claim), never after locking. Lock ownership / claim semantics unchanged.
5. `NOTIFY pgrst, 'reload schema';`

**D5 (flagged):** `fetch_and_lock_next_lead` stays the thin wrapper → inherits the predicate via delegation. Inlining a second copy would create two divergent claim RPCs (violates AGENT_RULES invariant #15 + Forbidden Patterns). **Recommend: wrapper inherits (no separate edit).**

**UI:** "Require licensed-state access" checkbox (reuse `ToggleRow`) in the modal's Settings section, gated by `can_edit_campaign_settings` (only settings-editors toggle; others see it read-only/disabled). Helper: *"When on, agents only receive campaign contacts in states where they hold an active license. Contacts with no state are still shown."* Saved via the 11-arg `update_campaign_settings`.

**Empty-state UX:** when a filtered campaign yields no eligible leads, show **"No leads in your licensed states for this campaign,"** (Team/Open via `QueueExhaustedNotice`; Personal via its static notice) — not a silent blank dialer.

**P3 Verify (read-only / impersonation against the authored SQL only, never applied to prod):** checkbox OFF = unchanged; ON: agent licensed CA/AZ gets only CA/AZ + blank-state, none from unlicensed states, identical across all three RPC entrypoints (wrapper included); zero-license agent on a restricted campaign sees only blank-state / the empty state; toggling the checkbox requires settings-edit permission (trigger); `claim_lead` still atomic, no double-serve. `npx tsc --noEmit` clean. Migration valid SQL, left as a file **[PENDING APPLY]**.

---

## 5. Open decisions (defaults chosen — veto any before I build)
- **D1 — `applyDispositionToQueue` local display path → minutes.** VERIFIED CONTEXT says disposition/advance is minutes; the persisted value is (server RPC), but the client-side tier-display helper (`queue-manager.ts:140`, called at DialerPage 1961) still uses hours. **Default: convert it to minutes too** (param + the one caller + its unit tests) so display matches the server. Alt: leave it (DB is already correct; display granularity is coarse only when hours≠minutes/60). **Recommend: convert.**
- **D2 — normalize the enqueue RPC server-side.** `add_leads_to_campaign` copies `leads.state` → `campaign_leads.state` in SQL (no TS touchpoint). **Default: wrap that copy in `public.normalize_us_state(...)`** (defense-in-depth; covers any legacy unnormalized `leads.state`). Alt: rely solely on normalized `leads.state`. **Recommend: wrap.**
- **D3 — `import-contacts` edge function.** The Deno import path doesn't normalize. **Default: author a Deno-side normalize but do NOT deploy this build** (consistent with files-only). Alt: rely on the P2 one-time migration + app paths and defer the edge fn. **Tell me which.**
- **D4 — `normalizeUsState` naming.** **Default: reuse existing `stateUtils.normalizeState` + add a `normalizeUsState` alias** (no duplicate map). Alt: rename across callers. **Recommend: alias.**
- **D5 — `fetch_and_lock_next_lead`.** **Default: leave as the delegating wrapper (inherits the filter)** rather than inline a divergent copy (invariant #15). **Recommend: wrapper.**

---

## 6. Migration drift note (for FINALIZE, not this build)
Local 2a file `20260607160000_*` vs applied `20260608163256` already diverges; my files `…170000`/`…170100` sort after the latest applied, so apply-order is correct. When applying later: **P2 (`…170000`) BEFORE P3 (`…170100`)** so the filter compares clean 2-letter data. Reconciling the 2a filename/version drift is separate housekeeping.

## 7. DO-NOT adherence
No Twilio/telemetry/`calls.duration`; no disposition logic; no lock-ownership/claim changes; no global license enforcement; dialer-only (not Contacts/kanban); no mock data; `area_code_mapping`/`email_oauth_states` untouched; no `campaigns_update` RLS rewrite. Migrations authored as files, never applied/committed/pushed during the build. Components < 200 lines, Tailwind only, Zod on entry.

---

**STOP — awaiting Chris's explicit approval (and answers to D1–D5) before creating the branch, writing any Phase 1 code, or authoring any migration. Phases 2 and 3 each STOP again for review. No DB mutation will occur until you separately approve applying.**
