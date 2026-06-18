# Implementation Plan — Contacts Build 1: Data Integrity + Assignment

**Owner:** Chris Garness · **Date:** 2026-06-17
**Branch:** _to be created_ → `claude/contacts-build1-data-integrity` (off `main`)
**Status:** DRAFT — awaiting Chris's explicit approval. **No file modified, no backend command run, no migration authored/applied, nothing committed/pushed.**

**Type:** Surgical bugfix build. Fix Client policy-data read/write/display, real bulk assignment, remove fake-success actions, correct Last Disposition source, and harden zero-row lookups. **NO migration expected** (all canonical columns already exist — proven below).

> **OUT OF SCOPE (explicit confirmation):** The **My Contacts / Team Contacts / Agency Contacts scope selector is NOT in this build.** It is formally deferred to **Build 2**, where one server-side scope definition must drive filtering, totals, pagination, Kanban, select-all, and bulk actions. Also out: advanced Lead filter server-side redesign, pagination redesign, filtered-count repair, select-all across filtered pages, Kanban full-data loading, Import Undo redesign, Contacts.tsx large refactor, SMS/Email Blast, Twilio/Dialer changes, unrelated security findings, dropping `clients.premium_amount`.

---

## 0. Startup completed

Read in full this session: `AGENT_RULES.md` (v5.0.0), `VISION.md`, `WORK_LOG.md` (newest entries). Inspected: `Contacts.tsx`, `supabase-clients.ts`, `supabase-contacts.ts`, `supabase-recruits.ts`, `supabase-conversion.ts`, `AddClientModal.tsx`, `AddRecruitModal.tsx`, `ContactsFilterModal.tsx`, `dialer-api.ts` (saveCall), `supabase-dispositions.ts`, the `Lead`/`Client`/`Recruit`/`Call`/`Disposition` types, and the existing test suite (160 tests / 17 files, all green).

**No conflicting `[IN PROGRESS]` work-log entry.** Newest entries are Build 2b (queue-eligibility, DEPLOYED) and the leaderboard zero-standings fix (merged). Neither touches Contacts client mapping, bulk assignment, or disposition derivation. No recently-changed Contacts behavior collides with this build.

### No migration needed — canonical columns proven present
`conversionSupabaseApi.convertLeadToClient()` already **writes** `clients.premium`, `clients.face_amount`, `clients.issue_date`, `clients.effective_date`, `clients.policy_number`, beneficiary fields, `custom_fields`, `organization_id`, `assigned_agent_id` (see `supabase-conversion.ts:51-70`). Manual Client CRUD just isn't reading/writing the same columns. `calls.disposition_id` + `calls.disposition_name` are written together by `dialer-api.saveCall` (`disposition_id` UUID FK persisted on new rows; `disposition_name` is the legacy fallback — AGENT_RULES invariant #13). **Therefore Scopes A–E are entirely frontend/TS. If inspection during implementation surprises us into needing a migration, I STOP and explain before authoring one.**

---

## 1. Confirmed root causes (with evidence)

**SCOPE A — Client policy data:**
- `supabase-clients.ts` `rowToClient()` (lines 124-128) **fabricates** `faceAmount: "$0"` (hardcoded), `premiumAmount: row.premium ? … : "$0"`, and **substitutes `created_at`** for both `issueDate` and `effectiveDate`. The Clients table renders these columns directly (`renderClientCell` `case "premium"/"faceAmount"/"issueDate"`, lines 1656-1658), so users see fake `$0` and the creation date as policy dates.
- `clientToRow()` (139-156) writes **only** `premium`; never `face_amount`, `issue_date`, `effective_date`. It also calls `data.premiumAmount.replace(...)` unguarded → throws if `premiumAmount` is undefined, and coerces blank → `0` (`|| 0`).
- `update()` (72-104) writes `premium` only; never `face_amount`/`issue_date`/`effective_date`; blank premium → `0`.
- `getById()` (56-60) uses `.maybeSingle()` then passes possibly-`null` into `rowToClient` → mapper crash on a deep-link to a missing/RLS-hidden client.
- `handleAddClient` (Contacts.tsx:1457-1467) uses `const ownerId = user?.id || "u1"` and calls `clientsSupabaseApi.create({...})` **without** `organizationId` → new manual clients get `organization_id = null`.

**SCOPE B — Bulk assignment is fake:** `handleBulkAssign` (1446-1454) shows a success toast and clears selection. **No DB write at all.** The assign menu (1871-1872) passes only the agent's display name, not its id, and iterates **all** active org `agentProfiles` (not the viewer's authorized set).

**SCOPE C — Fake success:** `handleBulkAssign` (above) and `handleBulkAgentStatusChange` (1586-1590) both toast success with no persistence. `handleBulkAgentStatusChange` is **dead code** — defined but never referenced (the Agents tab renders no bulk toolbar; confirmed `grep` shows only the definition).

**SCOPE D — Last Disposition uses telephony status:** `leadsSupabaseApi.getAll` selects `calls(status, created_at)` (line 49) and `rowToLead` derives `lastDisposition` from the newest call's **`.status`** (line 428). That is Twilio call status, not a disposition. The Leads filter then compares it case-sensitively/exactly against fixed options.

**SCOPE E — Unsafe zero-row lookups:** Lead `getById` (supabase-contacts.ts:156) uses `.single()` (throws on 0 rows). Client/Recruit `getById` use `.maybeSingle()` but then map `null`.

---

## 2. Implementation steps (by scope)

### SCOPE A — Client policy data integrity (`supabase-clients.ts`, `AddClientModal.tsx`, `Contacts.tsx`)

**`supabase-clients.ts`:**
1. Add small pure helpers (exported for tests): `formatCurrencyValue(n)` → `""` when `null/undefined/NaN` (and **`0`** — see Decision D1), else `"$" + n.toLocaleString(en-US, 2dp)`; `parseCurrencyToNumberOrNull(s)` → strips non-numeric, returns `number | null` (blank/NaN → `null`, never `0`). Add `normalizeDateOrNull(s)` → trimmed `YYYY-MM-DD` text or `null`.
2. `rowToClient()`: `premiumAmount = formatCurrencyValue(row.premium)`, `faceAmount = formatCurrencyValue(row.face_amount)`, `issueDate = row.issue_date ?? ""`, `effectiveDate = row.effective_date ?? ""`. Add `policyNumber`, beneficiary fields, `notes`, `userId` passthrough. **Never** `created_at` for policy dates; **never** `"$0"`.
3. `clientToRow()`: write `premium`, `face_amount` (via `parseCurrencyToNumberOrNull` → `null` when blank), `issue_date`/`effective_date` (via `normalizeDateOrNull`), `policy_number`, beneficiary fields, `notes`, `custom_fields`, `state` (keep `normalizeUsState`). Guard against undefined amount strings (no `.replace` crash).
4. `update()`: extend to write `face_amount`, `issue_date`, `effective_date` (already handles `policy_number`); blank → `null`, not `0`; keep partial-update semantics (`!== undefined` guards).
5. `create(data, organizationId)`: **throw a deliberate error if `organizationId` is falsy** ("Cannot create client without an organization."). Keep returning the saved row via `rowToClient`.
6. `getById()`: keep `.maybeSingle()`, **return a not-found error** (`throw new Error("Client not found")`) instead of mapping `null`.
7. Export `rowToClient` + `clientToRow` (+ helpers) for unit tests.

**`AddClientModal.tsx`:**
- Add **Policy Number** (text) and **Effective Date** (`DateInput`) fields. Keep all existing fields (premium/face/issue already present).
- Expand the Zod schema: optional `premiumAmount`/`faceAmount` (free string), optional `issueDate`/`effectiveDate` validated/normalized to `YYYY-MM-DD` (blank allowed → emitted as `""`, stored `NULL` downstream). Run `safeParse` and **block save on failure** (toast + keep modal open). Fix the current control-flow bug where a non-Zod throw falls through.
- Normalize dates to `YYYY-MM-DD` before `onSave`. Prevent duplicate submission (`saving` guard at function entry; button already disabled). **Do not close the modal or toast success if `onSave` throws** (already structured that way — preserve it). Keep file < 200 lines.

**`Contacts.tsx` `handleAddClient`:** remove `"u1"`; `if (!user?.id || !organizationId) { toast.error("…"); return; }`; pass `organizationId` into `create`; use the returned saved row where practical.

**`Contacts.tsx` `renderClientCell`:** render `{c.premiumAmount || "—"}`, `{c.faceAmount || "—"}`, `{c.issueDate ? formatDate(c.issueDate) : "—"}` so blanks show `—` (guards `formatDate("")`).

### SCOPE B — Real bulk assignment (`supabase-contacts.ts`, `supabase-clients.ts`, `supabase-recruits.ts`, `Contacts.tsx`)
1. Add batched `bulkAssign(ids, agentId)` to each API:
   - **Leads:** `update({ assigned_agent_id: agentId, user_id: agentId })` `.in("id", chunk)` (chunked 1000) `.select("id")`; throw on error; return updated rows. (Matches `reassignAllContacts` precedent — `user_id` kept in sync for RLS.)
   - **Clients / Recruits:** `update({ assigned_agent_id: agentId })`; same pattern.
2. `handleBulkAssign(agentId, agentName)`:
   - If `tab === "Leads" && selectAllLeadsMode` → **disabled / no-op** (see step 3).
   - Build the selected-ID list for the active tab. `await api.bulkAssign(ids, agentId)`; **only on a non-error response**: update local rows' `assignedAgentId` (+ `userId` for leads), update the open contact if applicable, clear that tab's selection, close the menu, toast `Assigned N … to {agentName}`.
   - On failure: keep selection, keep previous local ownership, `toast.error`, **no success toast**, leave menu open.
3. `renderBulkActions`/assign menu:
   - Pass `(agent.id, "First Last")` separately.
   - Iterate the **viewer-authorized** assignable agents (reuse the existing role logic in `assignableAgentsForAddLead` — Agent → none, Team Leader → self + downline, Admin/Super Admin → org). If empty, render a muted "No agents available to assign." RLS remains the server-side backstop.
   - New `assignDisabled` option: when `tab === "Leads" && selectAllLeadsMode`, render Assign Agent **disabled** with tooltip: *"Assigning across all filtered leads will be available after Build 2's filter/scope safety work. Select specific leads to assign now."* Never infer/broaden the record set.

### SCOPE C — Remove fake success (`Contacts.tsx`)
- `handleBulkAssign` → now real (Scope B).
- `handleBulkAgentStatusChange` → **remove** the dead function (unreferenced; only toasts fake success). No Agents-admin functionality is added (out of scope). No other fake-success Contacts action found in this pass.

### SCOPE D — Last Disposition correction (`supabase-contacts.ts`, possibly `ContactsFilterModal.tsx`)
1. `getAll`: change the call join to `calls(disposition_id, disposition_name, created_at)` (drop `status`).
2. Add exported pure helpers: `deriveLastDisposition(calls)` and `normalizeDispositionValue(s)`.
   - A call "has a disposition" when `disposition_id` is present **OR** `trim(disposition_name)` is non-empty. Pick the **newest** such call deterministically (`created_at` desc, tie-break stable). Display value = trimmed `disposition_name`. Calls with neither field → **no disposition** (`undefined`). **Never** `calls.status`.
3. `rowToLead`: `lastDisposition = deriveLastDisposition(row.calls)`. (`attemptCount = calls.length` unchanged.)
4. Filter matching: compare with `normalizeDispositionValue` on both sides (trim + lowercase) so filter options match normalized stored values; legacy `disposition_name`-only rows still match. Preserve the locked/system **No Answer** behavior elsewhere (untouched).
5. **No** advanced-filter / pagination / filtered-total redesign (Build 2).

### SCOPE E — Safe lookups (`supabase-contacts.ts`, `supabase-clients.ts`, `supabase-recruits.ts`)
- Lead `getById`: `.single()` → `.maybeSingle()`; if `null` → `throw new Error("Lead not found")` (no mapper on null).
- Client `getById`: not-found error instead of mapping `null` (done in Scope A).
- Recruit `getById`: keep `.maybeSingle()`; not-found error instead of mapping `null`.
- RLS preserved; no service-role access introduced anywhere.

### SCOPE A (cont.) — Recruit creation ownership (`supabase-recruits.ts`, `Contacts.tsx`)
- `handleAddRecruit`: remove `"u1"`; `if (!user?.id || !organizationId) { toast.error(…); return; }`; keep passing `organizationId`.
- `recruitsSupabaseApi.create`: throw if `organizationId` falsy. Preserve `organization_id` on the row.

---

## 3. Files intended to be modified

| # | File | Scope |
|---|------|-------|
| 1 | `src/lib/supabase-clients.ts` | A, B, E — mapping, write, create org-guard, getById, bulkAssign, exports |
| 2 | `src/lib/supabase-contacts.ts` | B, D, E — disposition select+derive, getById maybeSingle, lead bulkAssign, exports |
| 3 | `src/lib/supabase-recruits.ts` | A, B, E — create org-guard, getById not-found, bulkAssign |
| 4 | `src/components/contacts/AddClientModal.tsx` | A — Policy Number + Effective Date, Zod, date normalize, no close-on-failure |
| 5 | `src/pages/Contacts.tsx` | A, B, C — handleAddClient/Recruit org-guards, real handleBulkAssign, remove dead handleBulkAgentStatusChange, assign menu (id+name, authorized list, selectAll disable), renderClientCell `—` |
| 6 | `src/components/contacts/ContactsFilterModal.tsx` | D — only if option-value normalization needs a tweak (likely none; matching handled in lib) |
| — | `src/lib/supabase-conversion.ts` | **NOT modified** — canonical reference; preserved verbatim |

**New test files:**
| # | File | Proves |
|---|------|--------|
| 7 | `src/lib/__tests__/clientMapping.test.ts` | rowToClient reads premium/face/issue/effective; missing → blank not `$0`; missing dates not `created_at`; clientToRow writes exact canonical columns; blank → `null` |
| 8 | `src/lib/__tests__/leadDisposition.test.ts` | deriveLastDisposition prefers id/name, never `status`; neither-field → no disposition; normalize matching |
| 9 | `src/lib/__tests__/contactsApi.test.ts` | (vi.mock supabase) client/recruit create includes `organization_id`; create throws on missing org; lead bulkAssign writes `assigned_agent_id` **and** `user_id`; client/recruit bulkAssign write `assigned_agent_id`; error response → API throws (caller keeps selection); getById zero rows → not-found error, no mapper crash; select-all leads → assign-disabled boolean guard |

---

## 4. Tests → requirement mapping
1-4 (mapping/blanks/dates) → file 7. 5-6 (org required) → file 9. 7-8 (bulk assign fields) → file 9. 9 (failed assign keeps selection) → file 9 (API throws) + handler logic. 10 (select-all disabled) → file 9 guard. 11-12 (disposition id/name not status; neither → none) → file 8. 13 (zero-row lookups) → file 9.

**Verification to run after approval+implementation:** `npx tsc --noEmit`; `npx vitest run`; targeted ESLint on touched files (separating pre-existing from new). Target: typecheck clean, ≥160 prior + new tests green, no new lint problems on touched files, `AddClientModal.tsx` < 200 lines.

---

## 5. Decisions for Chris (recommendations)

- **D1 — `0` vs missing for premium/face display.** Legacy converted clients store `premium = 0` / `face_amount = 0` for blanks (the conversion path's `|| 0`, which I am told not to change). **Recommend:** treat both `null` and `0` as blank/`—` for display, so no client ever shows a fabricated `$0` policy value; manual writes store `NULL` for blanks going forward (so a future real value is always distinguishable). _Alternative: format `0` as `$0.00`._ I'll implement the recommended option unless you say otherwise.
- **D2 — Assign authorization source.** Reuse the existing role logic already in `assignableAgentsForAddLead` (no new permission model) as the assign-target list, with RLS as the server backstop. Agents get no assign targets (Assign shows "No agents available").
- **D3 — Disposition display without a dispositions join.** Use the call row's own `disposition_name` for the label (id recognizes the row as dispositioned; name is the display). `saveCall` writes both together, so no per-page `dispositions` table join is added (keeps it surgical, avoids N+1). If you want id→canonical-name resolution, that's a small follow-up.

---

## 6. Risks & rollback
- **All changes are frontend/TS; no schema/RLS/migration/edge/Twilio/telemetry change.** Rollback = `git revert` of the branch; nothing to un-apply.
- **Display shift (low):** existing converted clients move from fake `$0`/`created_at` to real values or `—`. This is the intended correction; D1 governs the `0` case.
- **Bulk assign + RLS:** a user attempting to assign outside their authorization is blocked client-side (authorized list) and server-side (RLS); a partial/failed write throws → selection and local ownership are preserved, no success shown.
- **Disposition join change:** swapping `status` for disposition fields in the select keeps `created_at`, so `attemptCount` and ordering are unaffected.

---

## 7. Build 2 handoff — deferred (do NOT implement now)

**Contact scope selector — My Contacts / Team Contacts / Agency Contacts:**
- Only show scopes permitted by `getDataScope()`. **Team** = current user + their downline. **Agency** = all authorized organization contacts, **including unassigned**. Hide the selector when only one scope is available.
- Persist the selected scope in `user_preferences`.
- Apply the **same** scope **server-side** to Leads, Clients, Recruits, counts, pagination, Kanban, filters, select-all, and bulk actions — one shared scope definition.
- The selector must **never** widen access beyond RLS or role permissions.
- **Agents tab and Import History are NOT controlled by this selector.**
- Enables the currently-disabled "assign across all filtered leads" (select-all) path safely.

---

## 8. Process gates honored
No file modified, no backend/Supabase command run, no migration authored or applied, nothing deployed/committed/pushed. **Awaiting Chris's explicit approval to proceed to implementation.**
