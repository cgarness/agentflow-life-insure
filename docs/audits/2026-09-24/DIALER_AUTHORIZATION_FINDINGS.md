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
