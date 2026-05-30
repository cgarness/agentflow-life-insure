# Implementation Plan | Queue / Campaign Behavior — Build 4: Campaign Card Stats Consistency

**Status:** PLAN — awaiting Chris approval before modifying any source files or applying any migration
**Date:** 2026-05-29
**Production project:** `jncvvsvckxhqgqvkppmj`
**Production changes this session:** NONE (read-only audit only)
**Scope:** Make the Campaigns page card stats (Total / Called / Contacted / Converted) accurate and consistent with the trusted Dialer model via a derived read-only aggregate. NOT a Twilio build, NOT a Reports rebuild, NOT a Sold/Convert-gating change, NOT a queue lock/claim change.

---

## 0. Build 4 goal

Campaign cards currently read four stored columns directly (`campaigns.total_leads / leads_called / leads_contacted / leads_converted`). Two of them are **never maintained** (no triggers) so they always show `0`. Replace the card's data source with a derived, org-scoped, read-only aggregate RPC that mirrors the trusted Dialer definitions. Treat the stored counters as legacy/display-only; do **not** add new contacted/converted triggers or backfill in this build.

---

## 1. Phase A — Read-only audit (COMPLETE)

### 1.1 How the card loads stats today
- `src/pages/Campaigns.tsx` → `fetchCampaigns()` does `campaigns.select("*")` and renders the 4-stat grid straight from `c.total_leads`, `c.leads_called`, `c.leads_contacted`, `c.leads_converted`. `LeadHealthBar` uses `total / leads_contacted / leads_converted`.
- `src/pages/CampaignDetail.tsx` and `src/lib/supabase-dashboard.ts` / `src/lib/reports-queries.ts` also read `leads_contacted` / `leads_converted` from the stored columns. **Out of scope for Build 4** (campaign-card focus only) but flagged — they inherit the same `0` bug. Reports boundary respected.
- `src/components/dialer/CampaignSelection.tsx` (Dialer campaign select screen) shows **`contacts` + state chips only** — it does **not** read any of the four stored counters. So it is unaffected by stale counters; **defer its visual polish to final QA** (Phase G), no data fix needed.

### 1.2 Live trigger / function inventory (prod, read-only)
| Object | Finding |
|--------|---------|
| `trg_sync_campaign_total_leads` → `sync_campaign_total_leads()` | INSERT/UPDATE/DELETE on `campaign_leads`. Increments/decrements `campaigns.total_leads` by **all** campaign_leads rows (no status filter). **Maintained + accurate.** |
| `trg_sync_campaign_leads_called` → `sync_campaign_leads_called()` | INSERT/UPDATE/DELETE on `campaign_leads`. Maintains `campaigns.leads_called` = count of campaign_leads whose `call_attempts` crossed `0 → >0`. **Maintained + accurate.** |
| `leads_contacted` | **NO trigger. Unmaintained.** |
| `leads_converted` | **NO trigger. Unmaintained.** |
| campaign-stats refresh/backfill function | **None exists.** |

### 1.3 Stored counters vs derived truth (live, all 5 campaigns)
| campaign | stored total | stored called | stored contacted | stored converted | derived total | derived called | derived contacted (calls) | derived converted |
|----------|-----|-----|-----|-----|-----|-----|-----|-----|
| testing | 6 | 6 | **0** | **0** | 6 | 6 | 4 | 0 |
| test camp | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| test | 3 | 3 | **0** | 0 | 3 | 3 | 3 | 0 |
| new test | 5 | 4 | **0** | 0 | 5 | 4 | 3 | 0 |
| team test | 15 | 2 | **0** | 0 | 15 | 2 | 2 | 0 |

⇒ `total` and `called` stored columns **match** derived truth (triggers work). `contacted` is **always 0 but truly 2–4**. `converted` is 0 (and there are genuinely 0 conversions in prod). Confirms: contacted/converted stored columns are wrong; total/called are fine but we will still derive all four in one RPC for a single trusted source and to avoid future trigger drift.

### 1.4 Column / FK reliability (the 22 confirm points, condensed)
1. **`calls.campaign_id`** present, `→ campaigns ON DELETE SET NULL`. Coverage 35/51 (16 legacy pre-wiring NULLs).
2. **`calls.campaign_lead_id`** present, `→ campaign_leads ON DELETE SET NULL`. Coverage **35/51 — identical to `campaign_id`**. Either is equally reliable for new rows; per the brief I will scope via `campaign_lead_id → campaign_leads.campaign_id` (ties the call to the queue entity and dedupes per lead).
3. **`calls.disposition_id`** present, `→ dispositions ON DELETE SET NULL`. Coverage 15/51 (new rows). **`disposition_name`** coverage 31/51 → legacy name fallback required (matches Build 3A contacted model).
4. **`dispositions.counts_as_contacted`** boolean, org-scoped — reliable (Build 3A).
5. **`pipeline_stages.convert_to_client`** boolean, org-scoped — **confirmed exact field name.** FFL org has exactly one convert stage `"Sold"` (`25d7e7c3…`) with one linked disposition `"Sold"` (`84e2ea46…`, `campaign_action='remove_from_queue'`, `counts_as_contacted=true`).
6. **System `No Answer`** excludable by canonical locked name (`isSystemNoAnswerName`), same as Dialer.
7. **`campaign_leads.lead_id` → `leads ON DELETE SET NULL`** (NOT cascade). On conversion the lead is deleted but **the `campaign_leads` row survives** with `lead_id = NULL` → Total correctly keeps converted leads in the campaign; the converting `calls` row keeps its `campaign_lead_id` + `disposition_id`.
8. **`wins`** table is **EMPTY (0 rows)**; **`clients`** table is **EMPTY (0 rows)** → no conversion has ever run in prod. `wins` has `campaign_id (→ campaigns SET NULL)`, `contact_id` (polymorphic, no FK, = client id), `organization_id`, `agent_id`, `policy_type`, `premium_amount`, `call_id`.
9. **`clients` has no `campaign_id`.** It has `lead_id → leads ON DELETE SET NULL`, but the conversion path (`convertLeadToClient`) **does not set `lead_id`** and deletes the lead → `clients.lead_id` is unreliable as a campaign link. ⇒ **client→campaign fallback is NOT viable.** Do not use it.

### 1.5 Wins audit gate (Phase D crux)
- **Current code:** the only campaign-linked win path is `conversionSupabaseApi.convertLeadToClient` (Dialer Sold) → `triggerWin` **once per conversion**, even when `additionalPolicies[]` are supplied. So today wins is *de-facto* one-per-conversion. `FloatingDialer` also calls `triggerWin` but passes **no `campaign_id`** (non-campaign quick-call, by design — Build 3B).
- **Product direction (Chris):** Reports must count **multiple policies per client as multiple wins/policies sold**. So `wins` is **destined to become one-per-policy.** Per the build's own rule, raw `COUNT(wins)` is therefore **unsafe** for Converted.
- **Data:** wins/clients empty → cannot validate cardinality empirically; decision must be made on semantics.
- **Verdict:** Do **not** use `wins` for Converted. A reliable unique-conversion source **does** exist that survives lead deletion and is campaign-scoped + unique-per-lead: the **`calls → disposition → pipeline_stages.convert_to_client` path**, counting **distinct `campaign_lead`**. This mirrors the Dialer's own `isConvertedDisposition` and is consistent with how Contacted is derived (same `calls` source). `wins` count is offered only as an optional, separately-labeled `policies_sold` field for future Reports — never as Converted.

### 1.6 Audit verdict
- **Needs migration (1):** `get_campaign_card_stats` read-only `SECURITY DEFINER STABLE` aggregate RPC (Phase B).
- **Frontend-only:** repoint `Campaigns.tsx` cards + health bar at the RPC.
- **Do NOT:** add contacted/converted triggers, backfill stored counters, change Reports, change Sold/Convert gating, change queue lock/claim, touch the Dialer campaign-select visual.

---

## 2. Phase B — Derived aggregate RPC (REQUIRES MIGRATION — separate approval gate)

### 2.1 New RPC: `public.get_campaign_card_stats(p_campaign_ids uuid[] DEFAULT NULL)`
- `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `STABLE`, `LANGUAGE sql` (or plpgsql).
- **Org-scoped** via `public.get_org_id()`. Returns **one row per campaign in the caller's org** (no PII — aggregate counts only). `p_campaign_ids` optional: when non-null, restrict to those ids (the page passes the already-visible/assignee-filtered ids to mirror existing card visibility); when null, all org campaigns.
- **Returns** (`TABLE`): `campaign_id uuid, total_leads int, called_leads int, contacted_leads int, converted_leads int, policies_sold int`.
  - `policies_sold` = `COUNT(wins WHERE campaign_id = c.id)` — **separately labeled, NOT Converted, not rendered on the card in this build** (returned for forward-compat only; UI ignores it for now).
- **Predicates** (per campaign `c` in org):
  - `total_leads` = `COUNT(campaign_leads cl WHERE cl.campaign_id = c.id)` — includes terminal/DNC/converted rows that remain in the campaign (Phase F default rule).
  - `called_leads` = `COUNT(campaign_leads cl WHERE cl.campaign_id = c.id AND COALESCE(cl.call_attempts,0) > 0)` — matches the live `sync_campaign_leads_called` semantics + queue behavior. Skip does not increment attempts → not Called.
  - `contacted_leads` = `COUNT(DISTINCT cl.id)` over campaign_leads with ≥1 **contacted call** (Phase C predicate).
  - `converted_leads` = `COUNT(DISTINCT cl.id)` over campaign_leads with ≥1 **converting call** (Phase D predicate).
- Grants: `REVOKE … FROM PUBLIC`, `GRANT EXECUTE … TO authenticated`. Ends with `NOTIFY pgrst, 'reload schema';`.
- **Returns all visible campaigns in one call → no N+1** (page already fetches the campaign list; one extra RPC call returns every card's stats).

### 2.2 Phase C — Contacted predicate (mirror trusted Dialer `isContactedCallRow`)
A `calls` row `ca` for `cl` counts as a contact when, with the system `No Answer` exclusion applied first:
```
lower(coalesce(disp_name_via_id, ca.disposition_name, '')) <> 'no answer'
AND (
      COALESCE(ca.duration,0) > 45                              -- Twilio-backed
   OR d_by_id.counts_as_contacted = true                        -- prefer disposition_id
   OR d_by_name.counts_as_contacted = true                      -- legacy name fallback (org-scoped, lowercased)
)
```
- Join `dispositions d_by_id ON d_by_id.id = ca.disposition_id` (preferred) and `dispositions d_by_name ON lower(d_by_name.name) = lower(ca.disposition_name) AND d_by_name.organization_id = c.organization_id` (legacy fallback only when `disposition_id` is null).
- No hardcoded agency disposition names except the single canonical locked `No Answer` exclusion (same one allowed check as Build 3A). DNC may count Contacted if its disposition has `counts_as_contacted = true`; it must **not** imply Converted.
- Validated live: yields 4 / 0 / 3 / 3 / 2 contacted — exactly the derived truth in §1.3.

### 2.3 Phase D — Converted predicate (unique conversion via pipeline-stage path)
A `calls` row `ca` for `cl` is **converting** when its disposition maps to a `pipeline_stages` row with `convert_to_client = true`:
```
   (d_by_id.pipeline_stage_id has convert_to_client = true)      -- prefer disposition_id
OR (d_by_name.pipeline_stage_id has convert_to_client = true)    -- legacy name fallback, org-scoped
```
`converted_leads = COUNT(DISTINCT cl.id WHERE ≥1 converting call)` → **unique per campaign lead/client, never per policy.** Survives lead deletion (calls keep `campaign_lead_id` + `disposition_id`; campaign_leads row survives with `lead_id` nulled). DNC / appointment / callback dispositions are **not** converting. `wins` is not consulted for Converted.

### 2.4 Phase E — Called source
`campaign_leads.call_attempts > 0` (reliable, trigger-maintained today, aligns with queue + `saveCall`). No-answer after an actual call increments attempts → counts Called; Skip does not.

### 2.5 Phase F — Total source
`COUNT(campaign_leads)` in the campaign — keep terminal/DNC/converted rows that remain in the campaign (default product rule). Conversion nulls `lead_id` but the campaign_lead row stays, so converted leads remain in Total.

---

## 3. Phase G — UI wiring (`src/pages/Campaigns.tsx`, surgical)
- After `fetchCampaigns()` loads the list, call `supabase.rpc("get_campaign_card_stats", { p_campaign_ids: <visible ids> })` (narrow `(supabase as any)` cast — RPC absent from generated types; matches Build 1/3 precedent) and merge the four derived counts onto each card by `campaign_id`.
- Render `Total / Called / Contacted / Converted` from the derived values; `LeadHealthBar` uses derived `total / contacted / converted`. Labels unchanged.
- Loading: keep the existing skeleton; show cards once the campaign list resolves, fill stat numbers when the RPC resolves (no blocking redesign). No browser-derived counters.
- **Do not** touch the Dialer campaign-select screen (`CampaignSelection.tsx`) — deferred to final QA (its data is not materially wrong; it shows contacts/state chips).
- Helper option: a tiny `src/lib/campaign-card-stats.ts` wrapper (typed) for the RPC call to keep `Campaigns.tsx` clean; otherwise inline. (Decision D-help below.)

---

## 4. Phase H — Stored counters / backfill
- Using the derived RPC ⇒ **no backfill** of `leads_contacted` / `leads_converted` this build. Document them as legacy/display-only. **No new triggers.** `total_leads` / `leads_called` triggers stay as-is (accurate; still used elsewhere until those surfaces migrate in a later build).

## 5. Phase I — Reports boundary
- No Reports changes. Future Reports will show **Converted clients/leads** (unique) **and** **Policies sold / wins** (multiple policies per client allowed) — out of scope here. The RPC's optional `policies_sold` field is the forward hook, separately labeled, not on the card.

## 6. Phase J — Docs
- This plan; `WORK_LOG.md` (newest-first); `AGENT_RULES.md` new invariants:
  - Campaign-card stats come from `get_campaign_card_stats` (org-scoped read-only aggregate), not stored `campaigns.leads_*` columns.
  - Campaign-card **Contacted** uses the same `counts_as_contacted` + `duration > 45` model as the Dialer (prefer `disposition_id`, name fallback, exclude system `No Answer`).
  - Campaign-card **Converted** = unique converted campaign leads via the `convert_to_client` pipeline-stage path — **not** `COUNT(wins)`; wins/policies are policy-level production metrics for Reports.
  - Stored `campaigns.leads_contacted` / `leads_converted` are **unmaintained/legacy** (no triggers); `total_leads` / `leads_called` remain trigger-maintained.

---

## 7. Files & DB objects intended to touch (AFTER approval)
| Object | Why | Migration? |
|--------|-----|-----------|
| `supabase/migrations/<ts>_get_campaign_card_stats_rpc.sql` (NEW) | Phase B aggregate RPC | **YES — separate apply approval** |
| `src/pages/Campaigns.tsx` | Phase G: fetch RPC, merge derived counts, health bar | No |
| `src/lib/campaign-card-stats.ts` (NEW, optional) | typed RPC wrapper | No |
| `src/integrations/supabase/types.ts` | only if Chris prefers a regen over the `(supabase as any)` cast | No |
| `AGENT_RULES.md`, `WORK_LOG.md`, `implementation_plan.md` | Phase J docs | No |

**Explicitly NOT touched:** Twilio files, `twilio-voice-status`/`-webhook`, `answerOnBridge`, `TwilioContext` guards, Edge Functions, Reports surfaces, `CampaignDetail.tsx`, `supabase-dashboard.ts`, `reports-queries.ts`, disposition settings, Sold/Convert gating, queue lock/claim RPCs, P0/P1 stats internals, `calls.duration`, the stored-counter triggers, `CampaignSelection.tsx`, direct `leads.assigned_agent_id` writes. No broad Campaigns/DialerPage rewrite. No mock data.

---

## 8. Decisions for Chris
- **D1 — Source of truth:** ✅ proposed — derived read-only `get_campaign_card_stats` RPC; stored contacted/converted columns left legacy/display-only; no triggers/backfill. (Accuracy over premature performance.)
- **D2 — Converted source (HEADLINE):** ✅ proposed — **`calls → disposition → pipeline_stages.convert_to_client`, distinct campaign lead** (NOT `COUNT(wins)`). `wins` is destined one-per-policy per your Reports direction, so it is unsafe for Converted. Confirm.
- **D3 — `policies_sold` field:** return `COUNT(wins)` as a separate forward-compat field but **do not render** it on the card this build. Confirm (alt: omit entirely).
- **D4 — RPC shape:** one call returning all visible campaigns (no N+1), optional `p_campaign_ids` to mirror the page's assignee visibility. Confirm (alt: per-campaign RPC — simpler but N+1).
- **D5 — types.ts:** narrow `(supabase as any).rpc` cast, no full regen (Build 1/3 precedent). Confirm.
- **D-help — helper file:** add small `src/lib/campaign-card-stats.ts` wrapper vs inline in `Campaigns.tsx`. Default: small wrapper.

---

## 9. Verification before commit/push/deploy
1. `npx tsc --noEmit` → exit 0.
2. `npm test -- --run` → expect prior 90/90 (no test files changed unless a pure helper is extracted + unit-tested).
3. Static: no Twilio files; no `calls.duration` write; no Reports changes; no queue lock/claim change; no broad Campaigns/DialerPage rewrite; no unapproved migration applied; no stored-counter trigger added.
4. Show diff summary. **STOP** before commit/push/deploy (separate approval). Migration apply is its own separate approval gate.

## 10. Context snapshot
| Item | Detail |
|------|--------|
| Source of truth | derived read-only `get_campaign_card_stats` RPC |
| Total | `COUNT(campaign_leads)` (keeps terminal/DNC/converted in campaign) |
| Called | `campaign_leads.call_attempts > 0` |
| Contacted | calls model: `duration>45 OR counts_as_contacted`, prefer `disposition_id`, name fallback, exclude system `No Answer`; distinct campaign lead |
| Converted | calls→`convert_to_client` pipeline-stage path; distinct campaign lead; **not** `COUNT(wins)` |
| Wins/policies | deferred to Reports; optional separately-labeled `policies_sold` field, not on card |
| Deferred | Dialer campaign-select visual (final QA); CampaignDetail/dashboard/reports surfaces inherit same stored-column bug (separate build) |
| Migration | ONE: `get_campaign_card_stats`. Separate apply approval. |
| Production changes this session | NONE (read-only audit) |

**Next step for Chris:** approve §8 decisions + §2–§7 plan → I make the surgical edits + write the migration file (no apply, no commit/push). Separate gates for migration apply and for commit/push/deploy. **Next: full Dialer QA pass.**
