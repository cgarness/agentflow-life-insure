# Dialer / Campaign Authorization Findings — separate HIGH-PRIORITY security project

**Status:** OPEN. Documented only; **nothing here was fixed.** No migration, RLS, grant or function change was made.
**Rev 6 (2026-09-24):** the containment plan was rewritten around lock **provenance**. The rev 5 clamp and 2-hour cap are withdrawn. F8 was added from a catalog-only read. The M1 proposal moved to `M1_ENTERPRISE_QUEUE_READER_PROPOSAL.md`.
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
| F8 | `wins` INSERT accepts any `agent_id` / premium / idempotency key within the org (rev 6) | **Medium (sales credit)** | Yes (rev 6 catalog) |

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


## F8 — `wins` INSERT accepts any `agent_id` in the organization (Medium, sales-credit integrity) — NEW in rev 6

**Live (rev 6 catalog read):** `wins_insert` is granted to `{public}`, and its WITH CHECK is only `organization_id = get_user_org_id()`.
`agent_id`, `premium_amount`, `contact_id` and `idempotency_key` are all chosen by the client. The browser
`triggerWin` (`src/lib/win-trigger.ts:50-66`) inserts the row directly after a conversion.

**Impact:**
- Any org member can credit a sale to any agent, including themselves, with no conversion behind it.
- They can also pre-claim a `conversion:<lead-id>` idempotency key, so that the real conversion's win later
  hits 23505 and is never recorded.
- The leaderboard and "policies sold" read `wins`.

**Why it matters here:** the short-Sold ownership proposal (`SC1_CONVERSION_MERGE_DESIGN.md` rev 6) moves
conversion-win attribution to the server. That fix is incomplete while the browser can still write `wins`
directly. **Direction (not implemented):** create conversion wins inside the conversion transaction, and
restrict or remove the direct client INSERT for conversion keys. This must be reviewed with the non-conversion
win paths (additional policies, quick call).

---

## Not verified

- `role_permissions` org overrides (whether any org grants Agents `view_unassigned` / `view_all`).
- Live bodies of `private.campaign_actor`, `can_dial_campaign` and `attach_leads_to_campaign_core`. Rev 6
  recorded their ACLs and body md5s, not the bodies.
- Whether `get_enterprise_queue_leads` has callers outside this repository (see `M1_ENTERPRISE_QUEUE_READER_PROPOSAL.md`).
- Production migration `20260923224254 emergency_pause_org_leaderboard_20260923` exists live but not in the
  repository (unrelated; needs reconciliation).
- **Whether any existing lock or `campaign_leads` row is forged.** Neither can be proven. The rev 6 aggregate
  queries (§R6-B) would give indicators only, and none has been run.

---

## Containment plan — rev 6 (DOCUMENT ONLY; nothing executed)

**Rev 6 supersedes the rev 5 containment plan.** Rev 5 is withdrawn in full. Specifically:
- the one-time lock **clamp** (`LEAST(expires_at, now() + 5 min)`);
- the **2-hour renewal ceiling** (Chris: not approved);
- the claim that clamp plus cap "handles" existing locks.

The clamp and cap only shortened a lock's lifetime. They never established **who issued** a pre-hardening
lock, so a forged lock would still have authorized a claim during its remaining life. Rev 6 replaces them with
**provenance**: authority comes only from a lock the queue RPC has marked as issued, and no pre-hardening row
is trusted.

**Nothing below has been run.** Each step needs Chris's separate exact approval, then all of the following:
- a migration;
- a local as-`authenticated` harness (AGENT_RULES #37 pattern);
- bounded read-only pre- and post-checks;
- explicit deployment approval;
- Supabase advisors after the change.

**No production lock or `campaign_leads` row is deleted, reset, clamped or reissued by any step here.**

### R6-A. Evidence status (rev 6 catalog-only preflight, 2026-09-24, production `jncvvsvckxhqgqvkppmj`)

**Function ACLs and body fingerprints** (`md5(pg_get_functiondef)`). These are the pre-apply baseline: any
future migration's preflight must re-read them and stop on drift.

| Function | SECURITY DEFINER | EXECUTE holders | md5 |
|---|---|---|---|
| `public.claim_lead` | yes, `search_path=public` | PUBLIC, anon, authenticated, service_role | `5e690e176fd87cd87e730062514215ac` |
| `public.get_enterprise_queue_leads` | yes | PUBLIC, anon, authenticated, service_role | `04bae0f0f116ad5b6a7f3b442bfdd432` |
| `public.release_lead_lock` | yes | PUBLIC, anon, authenticated, service_role | `c9dcd533…` |
| `public.release_all_agent_locks` | yes | PUBLIC, anon, authenticated, service_role | `112210cf…` |
| `public.get_next_queue_lead` | yes | anon, authenticated, service_role | `4eec4697…` |
| `public.renew_lead_lock` | yes | anon, authenticated, service_role | `3c869ba7…` |
| `public.fetch_and_lock_next_lead` | yes | anon, authenticated, service_role | `b1dd1955…` |
| `public.add_leads_to_campaign` / `advance_campaign_lead` / `can_dial_campaign` / `convert_lead_to_client_atomic` | yes | authenticated, service_role | `71862c3e…` / `b857ea1a…` / `59f749ff…` / `641ba66c…` |
| `private.attach_leads_to_campaign_core` / `campaign_actor` / `can_administer_campaign` | yes | postgres only | `44064a17…` / `f582e437…` / `4c0bcf56…` |

**Policy fingerprints** (count, and md5 over name|cmd|qual|with_check ordered by name):

| Table | Count | md5 |
|---|---|---|
| `calls` | 5 | `2506f1e7…` |
| `campaign_leads` | 4 | `b2a93a30…` |
| `campaigns` | 4 | `305059e4…` |
| `clients` | 1 | `a9349f49…` |
| `dialer_lead_locks` | 3 | `154ecb72…` |
| `leads` | 3 | `7343f830…` |
| `wins` | 2 | `b00d407c…` |

**Other catalog facts:**
- **Triggers:** none (non-internal) on `dialer_lead_locks`, `campaign_leads`, `leads`, `clients` or `wins`.
- **`dialer_lead_locks` columns:** `id`, `campaign_lead_id` (unique; the ON CONFLICT target), `campaign_id`,
  `locked_by`, `organization_id`, `locked_at` (default `now()`), `expires_at`. **No column records who
  created a row**, so nothing can separate a queue-issued lock from a client-inserted one.
- **`dialer_lead_locks` policies:**
  - `select`: own, or Admin/Team Leader in the same org;
  - `insert`: `locked_by = auth.uid() AND organization_id = get_org_id()`;
  - `delete`: own, or **any** Admin/Team Leader, with **no org predicate**;
  - **no UPDATE policy**, so clients cannot update a lock directly.
- **`renew_lead_lock` (live):** sets `expires_at = now() + 5 min` for the caller's own lock in the caller's
  org. It has no cap. A renewal therefore *shortens* a far-future forged lock; an unrenewed forged lock keeps
  its client-chosen expiry.
- **`get_next_queue_lead` (live):**
  - deletes expired locks in the campaign;
  - excludes leads locked by *others*, but not the caller's own locks;
  - requires `l.assigned_agent_id IS NULL OR = v_uid` and Team membership for TEAM campaigns;
  - inserts with `ON CONFLICT (campaign_lead_id) DO NOTHING`. If the caller already holds any lock on the
    chosen row, including one they inserted directly, that row is kept unchanged.
- **`clients` has one policy, `Clients Hierarchical Access`.** A client with `assigned_agent_id IS NULL` is
  readable only by Admin or super admin. This bears on SC-1: an unassigned client is invisible to the agent
  who sold it.
- **`wins_insert`:** see F8.

**Operational data:** not read. §R6-B proposes the queries; none has been run.

### R6-B. Proposed operational aggregate queries — NOT RUN (each needs approval before execution)

**Rules for all of these queries:**
- read-only;
- run with `SET LOCAL statement_timeout = '5s'` inside a `BEGIN READ ONLY … ROLLBACK`;
- scoped to **one organization per run**, passed as a literal;
- return aggregate counts only, never ids, names, phones or emails;
- no RPC is invoked.

**Interpreting the results:**
- A non-zero count is an **indicator for review, not proof of forgery**. Clock skew, a legitimate reconnect
  or a snapshot refreshed by a legitimate edit can all produce one.
- A zero count is **not proof of absence**. A forger can choose plausible timestamps.

```sql
-- Q1 lock-timestamp indicators (per org)
BEGIN READ ONLY; SET LOCAL statement_timeout = '5s';
SELECT count(*)                                                           AS live_locks,
       count(*) FILTER (WHERE expires_at > now() + interval '6 minutes')   AS expiry_beyond_rpc_window,
       count(*) FILTER (WHERE locked_at  > now() + interval '1 minute')    AS locked_in_future,
       count(*) FILTER (WHERE locked_at  < now() - interval '8 hours')     AS older_than_8h,
       count(DISTINCT locked_by)                                           AS distinct_holders
FROM public.dialer_lead_locks
WHERE organization_id = '<org-uuid>' AND expires_at > now();
ROLLBACK;

-- Q2 lock / campaign-lead consistency (per org): lock rows whose campaign or org disagrees with the campaign lead
BEGIN READ ONLY; SET LOCAL statement_timeout = '5s';
SELECT count(*) FILTER (WHERE cl.id IS NULL)                                  AS lock_without_campaign_lead,
       count(*) FILTER (WHERE cl.campaign_id IS DISTINCT FROM dll.campaign_id) AS campaign_mismatch,
       count(*) FILTER (WHERE cl.organization_id IS DISTINCT FROM dll.organization_id) AS org_mismatch
FROM public.dialer_lead_locks dll
LEFT JOIN public.campaign_leads cl ON cl.id = dll.campaign_lead_id
WHERE dll.organization_id = '<org-uuid>';
ROLLBACK;

-- Q3 snapshot-vs-lead mismatch (re-pointing indicator), Team/Open campaigns only, per org
BEGIN READ ONLY; SET LOCAL statement_timeout = '5s';
SELECT upper(btrim(c.type)) AS ctype,
       count(*)                                                                   AS rows_checked,
       count(*) FILTER (WHERE l.id IS NULL)                                       AS lead_missing,
       count(*) FILTER (WHERE l.id IS NOT NULL AND cl.phone IS DISTINCT FROM l.phone) AS phone_differs,
       count(*) FILTER (WHERE l.id IS NOT NULL AND lower(cl.email) IS DISTINCT FROM lower(l.email)) AS email_differs,
       count(*) FILTER (WHERE l.organization_id IS DISTINCT FROM cl.organization_id) AS cross_org_lead
FROM public.campaign_leads cl
JOIN public.campaigns c ON c.id = cl.campaign_id
LEFT JOIN public.leads l ON l.id = cl.lead_id
WHERE cl.organization_id = '<org-uuid>' AND upper(btrim(c.type)) IN ('TEAM','OPEN','OPEN POOL')
GROUP BY 1;
ROLLBACK;

-- Q4 current dialer activity (deploy-window choice), per org
BEGIN READ ONLY; SET LOCAL statement_timeout = '5s';
SELECT count(*) FILTER (WHERE expires_at > now())                 AS active_locks,
       count(DISTINCT locked_by) FILTER (WHERE expires_at > now()) AS active_agents
FROM public.dialer_lead_locks WHERE organization_id = '<org-uuid>';
ROLLBACK;
```

**Before any query runs:**
- The campaign-type spellings in Q3 match the repo normalizer: `upper(btrim(type))` in `('TEAM','OPEN POOL','OPEN')` (`src/lib/campaign-assignee-scope.ts:48`, baseline `:2230`).
- Organization ids come from Chris. Queries are not run across all orgs in one statement.
- Q3 is the heaviest. Its plan is checked with `EXPLAIN` (no `ANALYZE`) first.

### R6-C. Lock-provenance transition (replaces the rev 5 clamp and cap)

**Principle:**
- A lock grants authority to claim (and, under the SC-1 proposal, to convert and take the sale credit) **only
  if the queue RPC itself issued it**.
- A lock that existed before the provenance column **never** grants that authority. It is not deleted,
  clamped or shortened.
- The authority is **added** when the queue next selects that lead for that agent, because at that moment the
  queue has re-checked eligibility itself.

**Step P1 — additive, no change in authorization (one migration):**
1. Add `dialer_lead_locks.queue_issued_at timestamptz NULL`. It has no default, so every existing row reads
   NULL, meaning "unproven".
2. Add a BEFORE INSERT OR UPDATE trigger, `dialer_lead_locks_guard_provenance`:
   - If `current_user` is not the table owner, the trigger forces `NEW.queue_issued_at := NULL` on INSERT and
     `NEW.queue_issued_at := OLD.queue_issued_at` on UPDATE.
   - `current_user` is `postgres` inside the SECURITY DEFINER RPCs and `authenticated` for PostgREST.
   - So a client can never set or keep a provenance mark it did not receive from the RPC. This holds even while
     the client INSERT policy still exists (F5 is closed later, in P3).
3. `get_next_queue_lead`:
   - Change the lock insert to set `queue_issued_at = now()`.
   - Change `ON CONFLICT (campaign_lead_id) DO NOTHING` to `DO UPDATE SET queue_issued_at = now(), expires_at
     = now() + interval '5 minutes' WHERE dialer_lead_locks.locked_by = v_uid`. The queue has just re-run its
     full eligibility check for this agent and lead, so its selection is fresh authority.
   - A lock held by *another* agent is never touched. It was already excluded from selection.
   - `locked_at` is left unchanged.
4. `renew_lead_lock`: unchanged. Its UPDATE touches only `expires_at`, and the trigger preserves the mark. A
   renewal never grants provenance.
5. Nothing reads `queue_issued_at` yet, so P1 changes no one's access. Older tabs are unaffected: the
   function signatures and return shape (`SETOF campaign_leads`) are unchanged.

**Observation window after P1:**
- Run Q1 plus a P1-specific count: active locks with `queue_issued_at IS NULL`, split by `locked_at` age.
- Legitimate unmarked locks disappear naturally. Each ends at the next queue fetch (which marks the new
  lock), at a release, or 5 minutes after its heartbeat stops.
- The only unmarked locks that survive are those still being renewed (an agent sitting on one lead) or those
  with far-future client-chosen expiries (a forgery indicator).
- **P2 does not start until Chris has seen this count.**

**Step P2 — authority requires provenance (the rev 6 form of old Phase C step 4, in the same migration as
P3):**
- `claim_lead` requires all of the following:
  - a live lock on `p_campaign_lead_id` held by `auth.uid()`, in the caller's org;
  - `queue_issued_at IS NOT NULL` on that lock;
  - `campaign_leads.lead_id = p_lead_id`;
  - a Team/Open campaign, with Team membership;
  - a guarded UPDATE `WHERE assigned_agent_id IS NULL OR assigned_agent_id = auth.uid()`.
- A 0-row result raises `already_claimed` or `not_eligible`.
- `REVOKE EXECUTE … FROM PUBLIC, anon`.

**Step P3 — the dependent protections, shipped with P2 (unchanged in substance from rev 5, minus the clamp):**
- **F5:** drop `dialer_lead_locks_insert`, and add the org predicate to the Admin/Team Leader branch of
  `dialer_lead_locks_delete`.
- **F4:** drop the client INSERT on `campaign_leads`, and add a BEFORE UPDATE identity trigger that makes
  `lead_id`, `campaign_id` and `organization_id` immutable for non-owner callers.
- **F3:** narrow attach authority, as in rev 5 item 3.

**Compatibility matrix for P1 → P2/P3.** Each row must be **proven in the local harness**; none is asserted
as fact.

| Case | Behaviour | Proof |
|---|---|---|
| Active call at P1 deploy | No change: P1 grants and removes nothing. The heartbeat, the 46 s claim and the claim-on-disposition work as today. | Harness: lock via RPC → apply P1 → renew → claim (old body) succeeds |
| Active call at P2 deploy, lock issued after P1 | The lock is marked, so the claim succeeds. | Harness |
| Active call at P2 deploy, lock issued **before** P1 and still renewed | The claim is refused (`not_eligible`). The dialer keeps working: `useHardClaim` logs and does not mark the lead claimed, and the call, notes and disposition are unaffected. The lead stays unassigned in the pool, and the next queue fetch issues a marked lock. **Chris must accept this, or P2 waits until the P1-window count is zero.** | Harness: pre-P1 lock → P2 → claim refused → dialer save path completes |
| Renewal | Keeps the mark if present; never adds one. | Harness |
| Self-held unmarked lock, and the queue re-selects that lead | The queue marks it (DO UPDATE branch) after its own eligibility checks. | Harness |
| Unmarked lock held by another agent (possibly forged) | Never marked or taken over. It keeps blocking that lead until it expires or is released (same as today). **It is not deleted, clamped or reissued.** Its disposition is decision U-1 below. | Harness |
| Existing campaign-lead relationships (possibly re-pointed before P3) | P2 checks `lead_id` binding and unassigned status at claim time, so a re-pointed row cannot take over an **assigned** lead. **Residual:** a pre-P3 re-pointed row that targets an **unassigned** lead can still let an agent claim that unassigned lead. It cannot be proven absent. Q3 gives the indicator count, and repair is decision U-2. | Harness plus Q3 |
| Concurrent claims | The guarded UPDATE lets the first claim win; the second gets `already_claimed`. The lock is unique per campaign lead. | Harness: two sessions |
| Same-owner retry | Idempotent (`assigned_agent_id = auth.uid()` matches). | Harness |
| Older open tabs | Same RPC signatures. They never insert locks or `campaign_leads` rows (repo audit). A pre-P1 tab still fetches through `get_next_queue_lead`, so its new locks are marked. | Harness replaying the old client payloads |
| Callbacks | `get_next_queue_lead` still serves own callbacks and marks the lock. | Harness |
| Expired or lost lock | A claim after lock loss is refused (it succeeds today). **Chris must accept this** (unchanged from rev 5). | Harness |

**Decisions reserved for Chris (none is part of any migration yet):**
- **U-1:** what to do with unmarked, unrenewed far-future locks after Q1 quantifies them. Options:
  - (a) leave them;
  - (b) an admin-reviewed release, one lock at a time, through the existing release path;
  - (c) the queue treats *other agents'* unmarked locks older than a Chris-chosen age as non-blocking.
  Each option is a separate approval. **No clamp and no fixed ceiling is proposed.**
- **U-2:** what to do with `campaign_leads` rows flagged by Q3.
- **U-3:** whether to accept the "pre-P1 lock claim refused at P2" behaviour, or wait for a zero count.

### R6-D. Rollback rules (binding on every step)

1. **Never re-grant `authenticated`, `anon` or `PUBLIC` EXECUTE on an unchanged cross-tenant SECURITY DEFINER
   reader** (`get_enterprise_queue_leads`). The only recovery for a legitimate internal caller is a **new,
   fixed function** with caller and org checks. See `M1_ENTERPRISE_QUEUE_READER_PROPOSAL.md`.
2. **Never restore takeover-capable claim behaviour.** No rollback of P2 may:
   - remove the `lead_id` binding;
   - remove the org checks;
   - remove the guarded "unassigned or self" UPDATE;
   - remove the lock requirement;
   - re-grant `PUBLIC` or `anon`.

   If P2 breaks a legitimate path, the rollback is a **forward fix** that keeps the whole boundary: a
   corrected provenance rule, or a clearer refusal. **Relaxing the provenance requirement is not an allowed
   rollback**, because an unmarked lock is exactly what a forger holds.
3. **P3 rollbacks may not re-add the client INSERT policies** on `dialer_lead_locks` or `campaign_leads`, or
   remove the identity trigger. A broken legitimate writer is fixed by routing it through a SECURITY DEFINER
   RPC.
4. **P1 rollback** is safe only while nothing reads `queue_issued_at`. It drops the trigger and column and
   restores the `DO NOTHING` insert. After P2 ships, P1 cannot be rolled back on its own.
5. Every rollback file states in its header exactly what it would reopen. **No rollback is automatic**; each
   needs Chris's approval.

### R6-E. Ordering

1. Q1–Q4 (after approval, per org).
2. **M1** (independent; separate proposal and approval).
3. **P1** (additive), then the observation window.
4. **P2 + P3** as one migration in a low-activity window chosen from Q4, then post-checks and advisors.
5. **SC-1 + short-Sold ownership** (`SC1_CONVERSION_MERGE_DESIGN.md` rev 6) depends on P2/P3, because its
   conversion authority reads `queue_issued_at`. F8 (`wins`) ships with it or before it.

Only after step 5 may the frontend master-record requirement for Team/Open Sold be reconsidered, and that
needs its own approval.
