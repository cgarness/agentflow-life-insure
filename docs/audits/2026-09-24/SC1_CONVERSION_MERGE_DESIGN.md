# SC-1 + short-Sold ownership — one coherent server-side conversion proposal (DESIGN ONLY, rev 6)

**Status:** proposal.
- **Nothing is implemented, authored as a migration, or applied.**
- This branch keeps the frontend master-record requirement for Team/Open Sold.
- It does not invoke `claim_lead` earlier and does not change telemetry.
- Rev 6 replaces the rev 5 SC-1-only design. Rev 5 §5 concluded that SC-1 alone leaves an unassigned client
  and a win with no agent. This revision puts SC-1 and the ownership decision into one transaction.

**Depends on:**
- the lock-provenance transition P1–P3 in `DIALER_AUTHORIZATION_FINDINGS.md` §R6-C, because conversion
  authority reads `queue_issued_at`;
- F8 (`wins` client INSERT).

**Approvals needed:** its own exact approval, a migration, a local as-`authenticated` harness, bounded
pre/post checks, deployment approval, and advisors.

## 1. Current contract (live body re-read in rev 6, md5 `641ba66c…`, matches repo `20260812042319…`)

**`convert_lead_to_client_atomic(p_lead_id, p_client)`:**
- SECURITY DEFINER, `search_path = pg_catalog, pg_temp`.
- Steps, in order:
  1. auth and org checks;
  2. idempotent early return when a client exists for `lead_id`;
  3. `SELECT … FOR UPDATE` on the lead;
  4. cross-org refusal;
  5. profile check;
  6. authorization: owner, assignee, **both NULL**, Admin, super admin, or Team Leader ancestor;
  7. an idempotency re-check;
  8. `v_cf := p_client->'custom_fields'`. **The stored bag is ignored.**
  9. the client is inserted with `assigned_agent_id := v_lead.assigned_agent_id`;
  10. the contact graph is moved;
  11. the lead is deleted.
- The `clients` policy (`Clients Hierarchical Access`) means a client with a NULL `assigned_agent_id` is
  visible **only** to Admin and super admin.

**Browser:**
- `supabase-conversion.ts:74-137` builds `custom_fields` from the browser's copy.
- After the commit it runs `triggerWin({ agentId: lead.assignedAgentId, idempotencyKey: 'conversion:<lead-id>' })`,
  a direct `wins` INSERT (F8).

**Defects this proposal closes:**
- (a) **Stored `custom_fields` are lost** when the browser copy is incomplete (F7).
- (b) **Unassigned Team/Open short-Sold:**
  - the client is unassigned and invisible to the selling agent;
  - `agentId = ""`, so the win insert fails;
  - the post-conversion hard claim cannot land, because the lead is already deleted.
- (c) **Sale credit is browser-chosen** (F8).

## 2. Recommended direction

1. **Earned ownership.** An authorized agent who converts an **unassigned** Team/Open lead they legitimately
   worked, under a queue-issued lock, receives the client (`clients.assigned_agent_id`) and the sale credit.
2. **No silent reassignment.** No path ever reassigns a lead or client already owned by another agent.
3. **Unchanged elsewhere.** Every other conversion keeps today's owner rule (`v_lead.assigned_agent_id`).

## 3. API change (additive, backward compatible)

```
convert_lead_to_client_atomic(
  p_lead_id          uuid,
  p_client           jsonb,
  p_campaign_lead_id uuid DEFAULT NULL   -- NEW: the dialled Team/Open queue row, if converting from the dialer
) RETURNS jsonb
```

**Signature and return value:**
- It is `CREATE OR REPLACE` of the same function with one defaulted parameter. The old two-argument overload
  is **dropped in the same migration**, so the call is not ambiguous.
- PostgREST resolves `{p_lead_id, p_client}` to the new function through the default, so older tabs keep
  working.
- New return fields:
  - `owner_agent_id`;
  - `ownership_basis`: `existing_owner` | `earned_team_open` | `unassigned`;
  - `win_id`;
  - `custom_fields_conflicts` (a key list).

  The existing fields are unchanged.

## 4. Conversion authority (server-validated)

Evaluated in order, after the `FOR UPDATE` read:

| Path | Condition | Result |
|---|---|---|
| **A. Existing authorization** (today's predicate, unchanged) | owner, assignee, Admin, super admin, or Team Leader ancestor | Allowed. `owner := v_lead.assigned_agent_id`, `basis := existing_owner`. |
| **B. Earned Team/Open** (only when `p_campaign_lead_id` is non-NULL) | **All** of the following hold:<br>- a `dialer_lead_locks` row for `p_campaign_lead_id` with `locked_by = auth.uid()`, `organization_id = v_org`, `expires_at > now()` and **`queue_issued_at IS NOT NULL`**;<br>- `campaign_leads.id = p_campaign_lead_id`, `lead_id = p_lead_id` and `organization_id = v_org`;<br>- the campaign is in `v_org` and its type is TEAM (caller in `assigned_agent_ids`) or OPEN / OPEN POOL;<br>- **`v_lead.assigned_agent_id IS NULL AND v_lead.user_id IS NULL`**. | Allowed. `owner := auth.uid()`, `basis := earned_team_open`. |
| **B′** | Path B's lock conditions hold, but the lead is **already assigned to the caller** | Same as A (`existing_owner`). |
| **B″** | Path B's lock conditions hold, but the lead is **assigned to another agent** | **Refused**: `owned_by_another_agent` (42501). Never reassigned. |
| **C. Legacy unassigned branch** (`user_id IS NULL AND assigned_agent_id IS NULL` without a valid Path B) | Allowed to **Admin or super admin only**. `owner := NULL` (`basis := unassigned`), exactly as today. | For Agents and Team Leaders **this branch is removed**. An Agent converting an unassigned lead must come through Path B. This closes the non-dialer route by which any Agent could convert (and delete) any unassigned lead. **Chris decides whether this narrowing ships with SC-1 or separately (decision S-3).** |

**What counts as "legitimately worked":**
- The server evidence is the **queue-issued lock**. `get_next_queue_lead` issued it after checking
  eligibility, Team membership, licensing and "unassigned or self".
- `calls` rows are **not** used as evidence, because they are client-insertable (F6).
- **Option (decision S-1):** additionally require a webhook-confirmed call for this `campaign_lead_id` by
  this agent since `queue_issued_at`. A confirmed call is one whose server-owned status/duration is set by
  `twilio-voice-webhook`. It is stronger, but depends on webhook timing, so a very fast Sold could be
  refused. It is off by default.

## 5. Ownership, lead state and admin-on-behalf

**Path B (earned):**
- The client is inserted with `assigned_agent_id := auth.uid()`.
- The client row is the new home of the record, and the lead is deleted as today. No separate `claim_lead`
  runs, so the later frontend `claimOnDisposition` is a no-op against a deleted lead. That is today's order;
  it is not changed here.
- The `campaign_leads` row is preserved as today (`campaign_leads_preserved`).
- `claimed_by` is set to the caller in the same transaction, **only if** it is NULL or already the caller,
  so the queue shows who converted it. Telemetry columns (`call_attempts`, `last_called_at`, calls rows) are
  not touched.

**Admin-on-behalf:**
- An Admin, super admin or Team Leader converting a lead that **has** an owner (Path A) keeps that owner,
  and the owner gets the sale credit. This is unchanged.
- An Admin converting an **unassigned** lead outside the dialer (Path C) produces an unassigned client and
  **no win**, which is today's effective outcome. An explicit `p_credit_agent_id` for this case is
  **decision S-2** and is not in this proposal by default. If approved, it would be validated as an active
  agent in `v_org` and recorded as `basis := admin_assigned`.
- An Admin converting from **their own dialer session** under a queue-issued lock on an unassigned lead
  takes Path B and is credited as the seller, like any agent.

**Existing owners:** they are never changed by any path (B″ refuses).

## 6. `custom_fields` merge (SC-1), inside the same transaction after the `FOR UPDATE` read

| Input | Rule |
|---|---|
| Stored `v_lead.custom_fields` is an object | This is the base. Every stored key is preserved. |
| Stored is NULL | The base is `{}`. |
| Stored is malformed (not an object) | **Refuse** with `malformed_custom_fields` (22023). Nothing is inserted or deleted, and the lead survives for repair (invariant #28). |
| Payload `custom_fields` absent or NULL | Nothing is added. |
| Payload is not an object | Refuse (22023). |
| Payload key absent from stored | Added. This is new conversion data. |
| Payload key present, same value | No-op. |
| Payload key present, different value | **Stored wins.** The key is listed in `custom_fields_conflicts`, and the UI shows a notice. Conversion is not an edit surface, and a stale tab must not overwrite newer data. |
| `additional_policies` (owned by conversion, invariant #35) | Payload is an array: it replaces the stored value. Payload absent: the stored array is kept, never deleted. A non-array on either side: refuse (22023). |
| Internal keys (`__agentflow`, `tags`, anything `isReservedCustomFieldKey` marks internal other than `additional_policies`) | Always taken from stored; payload values are ignored and **not** reported as conflicts. |
| Result `{}` | Stored as NULL, matching today's null-when-empty behaviour. |

**Size and shape guard:** payload keys must be non-empty strings of 200 characters or fewer, and the payload
must be 64 KB or smaller when serialised. Anything else is refused (22023).

## 7. Server-side win (sales-credit attribution)

Inside the same transaction, after the client insert:
- If `owner` is non-NULL, the transaction runs `INSERT INTO wins (agent_id = owner, agent_name` (resolved
  from `profiles`), `contact_name, contact_id = client, campaign_id` (from `p_campaign_lead_id`'s campaign,
  when on Path B), `policy_type, premium_amount, sold_date, organization_id = v_org, idempotency_key =
  'conversion:' || p_lead_id) ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`. The conflict target must match the existing partial unique index exactly; the preflight re-reads that index definition, which is returned as
  `win_id`.
- If `owner` is NULL, no win is created, which matches today's effective outcome.

**The broadcast stays after the commit, in the browser:** `notify_win(p_win_id)`, which is already
server-authoritative and exactly-once through `win:<id>`.

**F8 companion (same migration):** tighten `wins_insert` so clients cannot insert rows whose
`idempotency_key LIKE 'conversion:%'`. The quick-call and additional-policy win paths are unchanged, pending
a separate F8 review of `agent_id = auth.uid()`.

## 8. Concurrency and idempotency

- **Lead lock:** `FOR UPDATE` on the lead serializes against edits, claims (`claim_lead` updates the same
  row) and a second conversion.
- **Lock row:** Path B reads the lock row `FOR SHARE`. A concurrent `release_lead_lock` waits and then
  deletes, but the conversion has already validated. `renew_lead_lock` is compatible.
- **Idempotent retry:** a retry returns the existing client **before** any merge, ownership or win work. It
  also returns the existing `win_id`, looked up by idempotency key, so the browser can re-broadcast.
- **Double submission:** the existing `clients.lead_id` unique index and the `wins.idempotency_key` unique
  index prevent it.
- **Two agents race to Sold the same unassigned lead:** the lock is unique per campaign lead, so only one
  agent can hold a queue-issued lock on that row. A second Open Pool row for the same lead (through a
  different campaign) is serialized by the lead `FOR UPDATE`. The second conversion then finds the client
  and returns it as idempotent, with `owner_agent_id` showing the first seller. The UI must show "already
  converted by another agent" when `owner_agent_id <> me`.
- **Lock lost mid-save:** Path B is refused with `lock_not_held` and nothing changes. The UI keeps the
  disposition and notes on screen (same pattern as the current `notDialled` message).

## 9. Frontend changes (only after the backend is live; separate approval)

| File | Change |
|---|---|
| `src/lib/supabase-conversion.ts` | Pass `p_campaign_lead_id` when present. Use `result.owner_agent_id` / `win_id`. Replace the conversion `triggerWin` insert with a broadcast of the returned `win_id` (`notify_win`). Surface `custom_fields_conflicts`. |
| `src/lib/win-trigger.ts` | Export a `broadcastWinById` (or equivalent) for the conversion path. Non-conversion paths are unchanged. |
| `src/components/contacts/ConvertLeadModal.tsx` | Accept an optional `campaignLeadId` and pass it through. Show the conflict notice and the "converted by another agent" notice. |
| `src/pages/DialerPage.tsx` | Pass the dialled `campaignLeadId` (the existing `lastDialCampaignLeadIdRef` / confirmed-lock value) to the modal **only** for Team/Open. Keep the master-record gate (removing it is a later decision). Map the new error codes to on-screen messages. Telemetry is untouched. |
| `src/lib/teamOpenLeadAccess.ts` | New messages for `lock_not_held` and `owned_by_another_agent`. |
| `src/integrations/supabase/types.ts` | Regenerate. |
| Tests | Contract tests for the new args and result, the win-broadcast path, and the error-to-message mapping. The existing `conversionContract` and `winTriggerIdempotency` suites are updated, not deleted. |

## 10. Migration scope

One migration, `YYYYMMDDHHMMSS_sc1_conversion_merge_and_earned_ownership.sql`:
1. `DROP FUNCTION public.convert_lead_to_client_atomic(uuid, jsonb)`, then `CREATE FUNCTION …(uuid, jsonb,
   uuid DEFAULT NULL)` with §4–§8. It keeps `SECURITY DEFINER` and `search_path = pg_catalog, pg_temp`,
   with every reference schema-qualified.
2. `REVOKE ALL … FROM PUBLIC, anon`, then `GRANT EXECUTE … TO authenticated, service_role`. This matches
   today's ACL.
3. The `wins_insert` policy tightening (§7).
4. No data backfill. No existing lead, client, lock or win row is modified.

**Pre-apply read-only preflight:**
- the conversion function md5 is still `641ba66c…`;
- the `wins` and `clients` policy fingerprints match `DIALER_AUTHORIZATION_FINDINGS.md` §R6-A;
- P1–P3 are applied (the `queue_issued_at` column and guard trigger exist).

## 11. Tests (local as-`authenticated` harness, AGENT_RULES #37)

**Merge:**
- stored-only;
- payload-only;
- both, with and without conflicts;
- stored NULL;
- stored malformed (refused; the lead survives);
- payload malformed;
- `additional_policies` present, absent, and malformed on either side;
- internal keys (stored kept, payload ignored);
- the size guard;
- `{}` stored as NULL.

**Authority:**
- Path A for each role;
- Path B with a queue-issued lock (Team member and Open Pool);
- Path B with an **unmarked** (pre-P1 or client-inserted) lock: refused;
- Path B with an expired lock: refused;
- Path B with another agent's lock: refused;
- Path B with a `campaign_lead_id` whose `lead_id` differs: refused;
- Path B on a Team campaign where the caller is not a member: refused;
- Path B″ (owned by another agent): refused, no change;
- Path C for Admin: an unassigned client, no win;
- Path C for Agent: refused (if S-3 is approved);
- cross-org: refused.

**Ownership and credit:**
- Path B sets `clients.assigned_agent_id = caller` and creates one win with `agent_id = caller`;
- Path A credits the existing owner;
- the selling agent can read the client under `Clients Hierarchical Access`;
- a client INSERT into `wins` with a `conversion:` key is refused.

**Concurrency and idempotency:**
- two sessions converting the same lead: one client and one win; the second returns idempotent with
  `owner_agent_id` set to the first seller;
- a retry after commit returns the same `client_id` and `win_id`;
- a concurrent `release_lead_lock` or `renew_lead_lock`;
- a concurrent lead edit (the lock ordering holds).

**Compatibility:**
- the two-argument call from an old tab still converts, via Paths A and C, with the merge applied;
- an old tab's `triggerWin` after a server win: either 23505 (resolved, then broadcast) or a failed insert
  for an unassigned lead (logged, no duplicate).

**Telemetry:** calls, recordings, durations and `call_attempts` are unchanged by conversion.

## 12. Risks

- **R1:** Path C narrowing (S-3) changes behaviour for Agents who convert unassigned leads outside the
  dialer today. That workflow must be confirmed before the change.
- **R2:** A pre-P1 unmarked lock at deploy time cannot use Path B. A short-Sold on it is refused with an
  on-screen message until the agent's next queue fetch. Same trade-off as §R6-C U-3.
- **R3:** Pre-P3 re-pointed `campaign_leads` rows that target an unassigned lead could give an agent earned
  ownership of that lead. This is bounded to unassigned leads. The indicator is Q3; repair is U-2.
- **R4:** The server win changes where conversion wins are created. Any report that assumes the browser
  inserted them must be re-checked. (AGENT_RULES #12–#14 read `wins` by `agent_id` / `created_at`, which are
  unchanged.)
- **R5:** Dropping the two-argument overload briefly invalidates cached PostgREST schemas. Reload the schema
  as part of the deploy.

## 13. Deployment ordering

1. P1, the observation window, then P2 + P3 (`DIALER_AUTHORIZATION_FINDINGS.md` §R6-E).
2. The SC-1 + ownership migration (backend first; old tabs stay compatible).
3. Post-checks:
   - md5, ACL and policy fingerprints;
   - advisors;
   - a bounded read-only count of conversions by `ownership_basis` over 24 hours. This requires logging the
     basis, for example in the returned JSON only; **no new table** is proposed.
4. The frontend change (§9) on a preview **against an isolated backend**, then production after approval.
5. Only then, as a separate decision: whether the Team/Open master-record gate can relax. SC-1 removes the
   data-loss reason, and Path B removes the ownership reason.

## 14. Rollback

**Backend:**
- The rollback restores the previous two-argument body and the previous `wins_insert` policy. The rollback
  header must state that it **reopens**:
  - F7 data loss;
  - unassigned short-Sold clients with no credit;
  - browser-chosen conversion credit.
- It must **not** restore any broader authorization than today's. In particular it does not add a path that
  reassigns owned leads.

**Frontend:**
- The frontend rollback reverts the §9 files. The new backend still accepts two-argument calls, so the
  frontend can roll back independently.

**Data:** clients and wins created under the new rules stay as they are, since they are correct records. No
automatic data rollback.

## 15. Decisions for Chris

- **S-1:** require a webhook-confirmed call in Path B? (Off by default.)
- **S-2:** an explicit Admin `p_credit_agent_id` for unassigned conversions outside the dialer? (Not
  included by default.)
- **S-3:** remove the Agent/Team Leader "both NULL" branch (Path C narrowing) in this migration, or
  separately?
- Approve the migration scope (§10), the frontend scope (§9) and the ordering (§13) as separate steps.
