# Implementation Plan — Dialer campaign selector cards (slow / wrong counts / reload)

**Owner:** Chris Garness · **Date:** 2026-06-04  
**Status:** DONE — implemented 2026-06-04.

---

## 0. Pre-flight

| Check | Result |
|-------|--------|
| Read `AGENT_RULES.md`, `VISION.md`, `WORK_LOG.md` | Done |
| Latest WORK_LOG conflict | **None.** Newest entry (2026-06-04) is **[DONE]** campaign calling-settings runtime fix. Prior same-day entry is **[DONE]** `advance_campaign_lead` redial loop. No `[IN PROGRESS]` dialer selector work. |
| Scope | Frontend-only reliability. No migrations, no Edge deploys, no Twilio/queue RPC changes. |

**Relevant invariants:** Multi-tenancy (`organization_id` + RLS), feature-before-permissions, **#17** (Campaigns page uses `get_campaign_card_stats` RPC — dialer selector uses a separate client aggregate; we are not changing that RPC), **#8** / **#19** (do not touch `calls.duration`, `advance_campaign_lead`, `get_next_queue_lead`).

---

## 1. Symptom

On `/dialer` (no campaign selected):

- Campaign cards load slowly or look empty until a manual reload.
- Contact totals and state badges show **0** or **“No leads”** while data is still loading or when stats failed.
- Agents with narrow campaign visibility sometimes see **too few** campaigns until reload (permissions not ready when fetch runs).

Live DB volume is tiny — this is a **frontend race / UX**, not raw query scale.

---

## 2. Root cause (confirmed in code)

### 2a. Campaign list fetch races permissions

`useDialerSession.refetchCampaigns`:

- Runs when `organizationId` is set; does **not** wait for `usePermissions().isLoading`.
- `campaignsViewAll` is derived from `getDataScope` / `hasFeatureAccess` / `profile` — unstable until permissions finish loading.
- When `user?.id` is missing, visible list is forced to `[]` (`filterCampaignsForAssignee` skipped).
- On fetch error, sets `campaigns` to `[]` and clears `hasLoadedCampaignsRef`.

**Effect:** First fetch may filter with `viewAll: false` → empty or partial list; reload after permissions settle shows correct cards.

### 2b. Stats and cards are decoupled; missing stats read as empty

`DialerPage` loads `campaignStateStats` via TanStack Query **separately** from `useDialerSession.campaigns`.

`CampaignSelection` / `CampaignCard`:

- `states={campaignStateStats[campaign.id] || []}` → missing key ⇒ empty array.
- Empty `states` ⇒ **0 contacts** + italic **“No leads”** — indistinguishable from a loaded empty campaign.

### 2c. Stats query scope issues

Current query (`DialerPage` ~811–846):

- `enabled`: `organizationId && (campaignsViewAll || visibleCampaignIds.length > 0)`.
- When `campaignsViewAll`, **no** `campaign_id` filter → scans all org `campaign_leads` (unnecessary; also runs before `visibleCampaignIds` populated).
- **No** `.eq("organization_id", organizationId)` (column exists on `campaign_leads`; RLS applies but explicit filter is safer/clearer).
- Only destructures `data` — no loading/error surfaced to UI.

`useCampaignSelectionLive` still invalidates stats on poll/focus/realtime — **unchanged**; fixes must remain compatible.

---

## 3. Fix design

### A. `src/hooks/useDialerSession.ts`

1. Destructure permissions loading:
   ```ts
   const { getDataScope, hasFeatureAccess, isLoading: permissionsLoading } = usePermissions();
   ```
2. `refetchCampaigns` early-return when **not ready**:
   - `!organizationId` OR `!user?.id` OR `permissionsLoading`
   - Do **not** set `campaignsLoading` false on this path (avoid flashing “no campaigns”).
   - Do **not** set `campaigns` to `[]`.
3. Add `permissionsLoading` to `refetchCampaigns` dependency array.
4. Keep: `filterCampaignsForAssignee`, `.eq("organization_id")`, `.eq("status", "Active")`, `order("name")`, silent refresh via `hasLoadedCampaignsRef`.
5. On real fetch error (non-silent): existing toast; set loading false so UI is not stuck; clearing campaigns on error is acceptable **only after** a real failed fetch (not on “not ready”).

**Note:** Initial `campaignsLoading: true` stays until first successful ready fetch completes.

### B. `src/pages/DialerPage.tsx`

1. Destructure from `useQuery`: `data`, `isLoading`, `isFetching`, `isError`, `error`, `refetch`.
2. `enabled`: `!!organizationId && visibleCampaignIds.length > 0`  
   (drops `campaignsViewAll`-only enable — admins still get IDs once campaign list loads).
3. Query builder:
   - Always `.eq("organization_id", organizationId)`.
   - When `visibleCampaignIds.length > 0`: `.in("campaign_id", visibleCampaignIds)` (including view-all).
4. Keep `queryKey` shape; include `visibleCampaignIds` (stable when campaigns stable — no loop if `enabled` gates empty list).
5. Keep aggregation: `row.state || row.lead?.state`, `normalizeState`, sort by count.
6. On query error: `console.error("[Dialer] campaignStateStats:", error)`.
7. Pass to `CampaignSelection`:
   - `campaignStatsLoading={isLoading || isFetching}` (or `isLoading` only if we want skeleton only on first load — prefer `isLoading || (isFetching && !data)` to avoid flicker on background refetch; plan: **`isLoading || (isFetching && Object.keys(campaignStateStats).length === 0)`** for per-card skeleton, plus top-level error banner when `isError`).
   - `campaignStatsError={isError}`
   - `onRetryStats={() => void refetch()}`
8. Optional: pass `onRefreshCampaigns={() => void refetchCampaigns()}` and surface subtle retry if campaigns fail (hook does not expose campaigns error today — optional v1: stats retry + “Refresh campaigns” calling `refetchCampaigns`).

### C. `src/components/dialer/CampaignSelection.tsx`

New optional props:

- `campaignStatsLoading?: boolean`
- `campaignStatsError?: boolean`
- `onRetryStats?: () => void`
- `onRefreshCampaigns?: () => void` (optional D)

**CampaignCard** — per-card stats UX:

| Condition | Contacts line | State badges |
|-----------|---------------|--------------|
| `campaignStatsLoading` && no stats for card yet | “Loading counts…” (small, muted) | omit or skeleton line |
| `campaignStatsError` | don’t fake 0 | selector-level message |
| Stats loaded, empty states | 0 contacts | “No leads” |
| Stats loaded with states | sum of counts | badges |

Do **not** show **0 contacts** / **“No leads”** while stats still loading for that card.

**Selector-level** (cleaner than per-card): if `campaignStatsError`, compact banner: “Could not load lead counts” + Retry button → `onRetryStats`.

**Optional D:** subtle “Refresh campaigns” near header when `onRefreshCampaigns` provided (icon button or text link).

### D. `WORK_LOG.md`

After implementation + verification: newest-first **[DONE]** entry with root cause, files, no migration/deploy, verification notes, context snapshot.

---

## 4. Files to touch

| File | Change |
|------|--------|
| `src/hooks/useDialerSession.ts` | Wait for `permissionsLoading`; guard premature empty/loading |
| `src/pages/DialerPage.tsx` | Stats query scope + loading/error/retry props |
| `src/components/dialer/CampaignSelection.tsx` | Loading/error UX on cards + optional refresh |
| `implementation_plan.md` | This plan |
| `WORK_LOG.md` | Post-merge entry |

**Will NOT touch:** `TwilioContext.tsx`, `advance_campaign_lead`, `get_next_queue_lead`, `calls.duration` paths, migrations, Campaign Detail, Reports, AI voice, `useCampaignSelectionLive.ts` (unless retry wiring needs a one-line comment only).

---

## 5. Verification plan

### Automated

```bash
npx tsc --noEmit
```

### Static checklist

- [ ] `refetchCampaigns` waits for `permissionsLoading === false` and `user?.id`
- [ ] Not-ready path does not clear `campaigns` or drop `campaignsLoading` early
- [ ] Cards do not treat missing stats as 0 / “No leads”
- [ ] `campaignStateStats` uses `.eq("organization_id", organizationId)` and `.in("campaign_id", visibleCampaignIds)` when IDs exist
- [ ] Query disabled when `visibleCampaignIds.length === 0`
- [ ] No Twilio / queue RPC / migration changes

### Manual QA (Chris)

1. Hard refresh `/dialer` — cards appear without reload.
2. Counts show “Loading counts…” if stats lag; then correct totals/states.
3. Roles: Agent, Team Leader, Admin (campaign visibility differs).
4. Navigate away/back to `/dialer`; focus window after background — poll/live refresh still works.
5. Start + campaign settings modal from card still work.

---

## 6. Risks / tradeoffs

| Risk | Mitigation |
|------|------------|
| Campaign list stays on skeleton longer while permissions load | Correct — better than wrong empty state |
| Stats query waits until `campaigns` populated | `enabled` tied to `visibleCampaignIds.length > 0` |
| Background refetch flicker | Use loading copy only when no stats data yet for card |
| Admin with zero visible campaigns | Same as today — “No active campaigns”; stats query off |

---

## 7. Approval gate

**Chris:** Reply **approve** (or edits) before any file modifications or backend commands.
