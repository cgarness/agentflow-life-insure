# Dialer / Campaign Authorization Findings — separate HIGH-PRIORITY security project

**Status:** OPEN. Documented only; **nothing here was fixed.** No migration, RLS, grant or function change was made.
**Found:** 2026-09-24, while fixing missing Team/Open dialer lead details (branch
`claude/lead-details-team-open-pool-03hfuh`; see `implementation_plan.md` §2 and §4).
**Evidence:** read-only catalog SELECTs against production `jncvvsvckxhqgqvkppmj` under Chris's approvals D-7 and D-7b:
- `pg_policies`
- `pg_class` RLS flags, owners and ACLs
- `information_schema.role_table_grants`
- `pg_get_functiondef` and `proacl`
- `has_function_privilege`
- `list_migrations`

No business rows and no `role_permissions` org overrides were read. No write, DDL or RPC invocation was made.

**Chris's direction (2026-09-24):**
- Treat this as ONE coordinated authorization review, not isolated patches.
- Address `claim_lead` first, because it undermines every ownership and access assumption.
- Do not widen backend access to solve display problems.

---

## Summary

| # | Finding | Severity | Live-confirmed |
|---|---|---|---|
| F1 | `claim_lead` lets any authenticated org member take ownership of **any** lead in the organization | **Critical** | Yes (D-7b) |
| F2 | `get_enterprise_queue_leads` is executable by `anon`/`PUBLIC` and returns any campaign's lead snapshots with no organization or caller check | **High** | Yes (D-7b) |
| F3 | Open Pool attach authority: any same-org user may attach **any** org lead to **any** Open Pool campaign, and the attach copies PII into rows every agent can read | **High** | Yes (D-7b) |
| F4 | `campaign_leads` INSERT/UPDATE are org-only: any member can create rows or re-point `lead_id` / `campaign_id` / `status` / `claimed_by` | **Medium** | Yes (D-7b) |
| F5 | `dialer_lead_locks` accepts direct client INSERTs with client-chosen `campaign_lead_id`, `locked_at` and `expires_at` | **Medium** | Yes (D-7b) |
| F6 | `calls` INSERT accepts any row with `agent_id = self` (any `campaign_lead_id`, `status` or `created_at`) — a telemetry-integrity gap | **Low–Medium** | Yes (D-7b) |
| F7 | Dialer Sold conversion of an unreadable Team/Open lead silently discarded `custom_fields` | **High (data loss)** | Code path (repo) + live policies |

`calls`, `campaign_leads`, `campaigns` and `dialer_lead_locks` all have RLS **enabled, not forced**, are owned by `postgres`, and grant full table privileges to `anon` / `authenticated` / `service_role`. RLS is the only boundary.

---

## F1 — `claim_lead` lead takeover (Critical)

**Live definition** (identical to repo baseline `20260806000000…:1319-1350`):
- SECURITY DEFINER, owner `postgres`, `search_path=public`.
- It checks only two things: that `p_campaign_id` is in `get_org_id()`, and that `p_campaign_lead_id` belongs to that campaign and org.
- It then runs `UPDATE public.leads SET assigned_agent_id = auth.uid() WHERE id = p_lead_id AND organization_id = v_org_id`.

**`p_lead_id` is never tied to `campaign_leads.lead_id`.** There is no lock check, campaign-type check, Team membership check, "already assigned" check or call/duration check.

**Live ACL:** `{=X/postgres, postgres=X, anon=X, authenticated=X, service_role=X}`.
- `PUBLIC` and `anon` hold EXECUTE. For `anon`, `get_org_id()` is null, so the first check raises.

**Impact:**
- Any authenticated user can take over a lead with a single RPC call. They need a campaign id and campaign-lead id visible to them (any Open Pool row) plus the target lead's UUID.
- `sync_leads_user_id` then sets `user_id`, which grants full RLS read/write through "Leads Hierarchical Access" (Personal leads, other agents' books, claimed leads).
- The only trace is the ownership change. The self-assignment notification is skipped.
- This makes every lead-level ownership and privacy guarantee bypassable.

**Direction (not implemented):**
- Bind `p_lead_id` to `campaign_leads.lead_id` (or drop the parameter).
- Require the caller's live lock on that campaign lead, a Team/Open campaign, and Team membership.
- Refuse leads already assigned to someone else.
- REVOKE from `PUBLIC` and `anon`.
- Keep the hard-claim rules (AGENT_RULES §5) unchanged.

## F2 — `get_enterprise_queue_leads` unauthenticated / cross-tenant read (High)

**Live:**
- SECURITY DEFINER, `search_path=public`, ACL `{=X, postgres, anon, authenticated, service_role}`.
- It reads the campaign by id with **no org or `auth.uid()` check**.
- With `p_org_id IS NULL` it returns `SETOF campaign_leads` (first/last name, phone, email, state, age) for that campaign.

**No `src/` caller** exists; only the generated type does.

**Impact:** an unauthenticated caller who holds the public anon key (in the frontend bundle) and a campaign UUID (these appear in `?campaign=` URLs) can read another tenant's lead snapshots.

**Direction:** REVOKE EXECUTE from `PUBLIC`, `anon` and `authenticated`, or drop the function after confirming it is unused.

## F3 — Open Pool attach authority (High)

**Live `private.can_administer_campaign`:** returns **true for every same-org actor on any Open Pool campaign**. This holds regardless of ownership or role.

**`add_leads_to_campaign` → `attach_leads_to_campaign_core`:** marks **every org lead** "eligible" for Open Pool (`20260811200920…:322-324`), including leads owned by other agents. The attach copies `first_name`, `last_name`, `phone`, `email`, `state` and `age` into `campaign_leads`. `campaign_leads_select` lets every Agent read Open Pool rows.

`campaigns_insert` lets any user create a campaign of any type.

**Impact:** any Agent can surface name, phone, email, state and age of any org lead, including other agents' books, via an Open Pool campaign.

**Direction:** decide who may create or attach to Open Pool/Team campaigns, and restrict Open Pool attach eligibility to leads the actor may see (or to Admin/authorized Team Leader).

## F4 — `campaign_leads` write policies are org-only (Medium)

**Live policies:**
- `campaign_leads_insert` WITH CHECK `organization_id = get_org_id()`.
- `campaign_leads_update` USING `super_admin_own_org(org) OR org = get_org_id()`, with no WITH CHECK.
- `campaign_leads_delete` is org-only.

**No client code** inserts rows or changes `lead_id`. Legitimate writes go through SECURITY DEFINER RPCs; client updates touch only status, `sort_order`, `claimed_by`, snapshot fields and lock columns.

**Impact:**
- Any member can re-point a queue row at another lead, alter status/claim fields across campaigns, or insert rows.
- Any future lock-scoped read path would inherit this (see `implementation_plan.md` §4.2).

**Direction:** drop client INSERT, and make `lead_id` / `campaign_id` / `organization_id` immutable for non-definer callers (trigger or column privileges).

## F5 — Direct lock writes (Medium)

**Live:** `dialer_lead_locks_insert` WITH CHECK `locked_by = auth.uid() AND organization_id = get_org_id()`. `locked_at` and `expires_at` are client-settable, and `renew_lead_lock` extends any own lock.

**No client code** inserts locks; `get_next_queue_lead` (SECURITY DEFINER) is the only legitimate writer.

**Impact:** an agent can pin arbitrary campaign leads (for example with `expires_at` in 2099), blocking them from other agents. It also makes "holds a lock" unusable as an authorization signal.

**Direction:** drop the INSERT policy (the RPCs bypass RLS). Review the DELETE policy's missing org predicate for Admin/Team Leader.

## F6 — `calls` INSERT accepts arbitrary own rows (Low–Medium, telemetry)

**Live:** "Calls Hierarchical Insert" admits `agent_id = auth.uid()` with no other constraint. The branch does not even constrain `organization_id`.

**Impact:** an agent can fabricate `calls` rows, which inflates "calls made" (AGENT_RULES #12–#14 trusted stats read `calls`). Durations remain webhook-owned (#8).

**Direction:** consider pinning `organization_id = get_org_id()` on the agent branch and server-owned `created_at`. Weigh this against the browser-originated call-record design.

## F7 — Sold conversion discarded `custom_fields` (High, data loss) — MITIGATED IN THE UI BY THIS BUILD

**How it happened:**
- When RLS hid the master row, the dialer's queue row had no `custom_fields`.
- `ConvertLeadModal` → `convertLeadToClient` built the client's `custom_fields` from it.
- `convert_lead_to_client_atomic` authorizes unassigned leads (`20260812042319…:101-109`), inserts that payload, then deletes the lead.

**This build:**
- Team/Open Sold/Convert now **fails closed** until the master row is loaded.
- `ConvertLeadModal` receives the authorized master's `custom_fields`.

**Still open (backend):** the RPC accepts an empty or partial `custom_fields` payload for a lead whose stored bag is non-empty. A server-side merge would make this impossible from any caller.

---

## Not verified

- `role_permissions` org overrides (whether any org grants Agents `view_unassigned` / `view_all`).
- Live bodies of `private.campaign_actor`, `can_dial_campaign`, `attach_leads_to_campaign_core` (repo only).
- Whether `get_enterprise_queue_leads` has callers outside this repository.
- Production migration `20260923224254 emergency_pause_org_leaderboard_20260923` exists live but not in the repository (unrelated; needs reconciliation).

---

## Containment plan (rev 5 — DOCUMENT ONLY; nothing executed)

**No revoke, grant, RLS change, migration, function replacement or production test has been run.** Each step
below needs Chris's separate exact approval, and then all of the following:
- a migration;
- a local as-`authenticated` authorization harness (AGENT_RULES #37 pattern);
- bounded read-only pre- and post-checks;
- explicit deployment approval;
- Supabase security advisors after the change.

### A. Evidence status

| Item | Status |
|---|---|
| F1–F6 policies, ACLs and function bodies | **Live-confirmed** (D-7 / D-7b catalog reads, 2026-09-24) |
| `get_enterprise_queue_leads` callers | **No `src/` or Edge Function caller.** API logs (`edge_logs`) show **0 requests** across nine 24-hour windows: 2026-09-16 06:00Z → 2026-09-24 06:25Z contiguous, plus 2026-09-09 06:00–2026-09-10 06:00Z. Each window had a positive `rpc/` control (18–7,299 requests). **This is "no observed calls", not "proven unused".** Not covered: direct Postgres connections, older history, and external services with a stored service key. |
| `private.campaign_actor`, `can_dial_campaign`, `attach_leads_to_campaign_core` live bodies | Repo only; UNVERIFIED live |
| `role_permissions` overrides | Not read |
| Pre-existing tampered rows (forged locks, re-pointed `campaign_leads.lead_id`) | **Cannot be proven absent.** At best, a bounded snapshot-vs-lead mismatch count gives evidence. |

### B. Why the steps cannot ship independently

A hardened `claim_lead` (the old M2) that trusts "the caller holds a lock on this campaign lead" is **not
secure on its own**:
- locks are still client-insertable (F5);
- `campaign_leads.lead_id` can still be re-pointed (F4);
- any same-org user can attach any lead to any Open Pool campaign (F3).

So M2's authorization inputs remain forgeable until F3–F5 are closed. The steps therefore ship as **one
atomic migration (Phase C)**, with M1 as a separate, independent containment step.

### C. Phases

**Phase 0 — read-only preflight (needs approval):**
- re-read every live policy and function body above;
- count live locks whose `expires_at > now() + interval '6 minutes'` or `locked_at > now()` (evidence of
  forged locks);
- count `campaign_leads` rows whose snapshot name, phone or email disagrees with the joined lead (evidence of
  re-pointing);
- count active dialer sessions (to choose a low-activity deploy window).

**Phase M1 — `get_enterprise_queue_leads` (independent candidate):**
- Change: `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`. Keep `service_role` and the function body, so
  nothing is deleted.
- Compatibility: no app caller exists and no calls were observed; external callers are uncertain.
- **Rollback must not reopen anonymous access.** The documented rollback re-grants only `authenticated`, and
  only if an internal caller surfaces. Re-granting `anon` or `PUBLIC` is never an automatic rollback.

**Phase C — one atomic migration: the ownership chain, dependent protections together.**

1. **Locks become server-authoritative (F5).**
   - Drop `dialer_lead_locks_insert`. Legitimate locks are written only by the SECURITY DEFINER
     `get_next_queue_lead`, which bypasses RLS.
   - Add the org predicate to the Admin/Team Leader branch of `dialer_lead_locks_delete`.
   - **Existing rows are NOT assumed trustworthy.**
     - In the same transaction, clamp every lock to `expires_at := LEAST(expires_at, now() + interval '5
       minutes')`.
     - Refuse renewal of rows with `locked_at > now()`, and cap renewal at `locked_at + 2 hours`, inside
       `renew_lead_lock`.
     - Result: a pre-existing forged lock dies within 5 minutes, or within 2 hours at most if its owner keeps
       renewing it.
     - Legitimate locks already expire within 5 minutes and are renewed every 30 s from a real `locked_at`,
       so they are unaffected.
     - The 2-hour renewal ceiling on legitimate very long sessions needs Chris's product decision.
2. **Campaign-lead identity becomes immutable (F4).**
   - Drop the client INSERT policy on `campaign_leads`. Legitimate inserts go only through the SECURITY
     DEFINER attach and import RPCs.
   - Add a BEFORE UPDATE trigger that rejects changes to `lead_id`, `campaign_id` or `organization_id`
     unless `current_user` is the function owner.
   - Existing client updates (status, `sort_order`, `claimed_by`, snapshot fields, lock columns) are
     unaffected. The repo audit found no client write to those three columns.
   - Already re-pointed rows are **not** repaired automatically; the Phase 0 count is reported for a
     decision.
3. **Attachment authority (F3).**
   - `private.can_administer_campaign`: the Open Pool branch is limited to the owner, Admin, super admin or
     an authorized Team Leader.
   - Open Pool attach eligibility is limited to leads the actor can read under the same RLS predicates
     (Admin/view_all: any org lead; otherwise own, or unassigned when `view_unassigned`).
   - Import-driven attaches keep their import-provenance path.
4. **`claim_lead` (F1).**
   - `p_lead_id` must equal the campaign lead's `lead_id`.
   - The caller must hold a live lock on `p_campaign_lead_id`. After steps 1–2 that lock can only come from
     the queue RPC.
   - The campaign must be Team/Open, and a Team campaign requires membership.
   - A single guarded UPDATE `SET assigned_agent_id = auth.uid() WHERE id = … AND (assigned_agent_id IS NULL
     OR assigned_agent_id = auth.uid())`.
   - A 0-row result raises `already_claimed` or `not_eligible`.
   - REVOKE from `PUBLIC` and `anon`.
   - **Rollback never restores the takeover-capable body.** It may only relax the lock requirement, never the
     lead binding.

### D. Compatibility (each case must be PROVEN in the local harness, not asserted)

| Case | Expected | How it is proven |
|---|---|---|
| Active call at deploy | The lock row keeps the same id and `locked_at`; the clamp is a no-op for legitimate locks. The heartbeat keeps renewing, the 46 s timer claim holds the lock, and a claim at Save / Save & Next runs in `saveCallData` **before** the release (`DialerPage.tsx:3721-3733` vs `:3894-3897`). | Harness: legitimate lock via `get_next_queue_lead` → deploy migration → renew → claim succeeds |
| Expired or lost lock | Behaviour change: a hard claim after lock loss now fails with `not_eligible` (today it succeeds). `useHardClaim` already logs and does not mark claimed. **Needs Chris's acceptance.** | Harness |
| Callbacks | `get_next_queue_lead` still serves own callbacks and still creates the lock; the claim path is unchanged apart from the checks. | Harness: callback lead claim |
| Same-owner retry | The guarded UPDATE matches (`assigned_agent_id = auth.uid()`), so it is idempotent. | Harness |
| Concurrent claims | The first UPDATE wins. The second matches 0 rows and raises `already_claimed`; the lock is unique per campaign lead anyway. | Harness: two sessions |
| Older open frontend tabs | The `claim_lead` signature is unchanged and the legitimate `p_lead_id` always matches. No tab inserts locks or `campaign_leads` directly. | Repo audit + harness replaying the old client payloads |
| Imports / attach | Import provenance is unchanged. A non-owner Agent's Open Pool attach of unreadable leads is refused (intended). | Harness: import-tagged attach; Agent attach refused |

### E. Ordering and rollback

1. Phase 0 preflight.
2. M1 (optional, independent).
3. Phase C as one migration in a low-activity window, then the read-only post-checks and advisors.

Phase C's rollback restores only non-security behaviour, and each step's rollback header states what it
would reopen. No automatic rollback re-grants `anon`/`PUBLIC` or restores the unbound `claim_lead` body.
