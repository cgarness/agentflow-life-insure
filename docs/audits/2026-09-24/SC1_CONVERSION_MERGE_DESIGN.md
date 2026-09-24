# SC-1 — Server-side `custom_fields` merge in `convert_lead_to_client_atomic` (DESIGN PROPOSAL ONLY)

**Status:** proposal. **Nothing implemented, authored as a migration, or applied.** This branch keeps the
frontend master-record requirement and does not change the claim order. SC-1 needs its own exact approval,
a migration, authorization tests, bounded pre/post checks, deployment approval and post-change Supabase
advisors.

## 1. Current contract (repo, `20260812042319…:60-200`; the live body is not re-read in this pass)

**Browser:**
- `conversionSupabaseApi.convertLeadToClient` builds
  `p_client.custom_fields = mergeCustomFieldsOnConversion(lead, additionalPolicies)`.
- That function copies the browser's `lead.customFields`.
- It sets `additional_policies` when the modal collected any; otherwise it **deletes** the key.
- It returns `null` when the bag ends up empty.

**RPC** (SECURITY DEFINER; checks auth, org and profile):
1. **Idempotency:** if a client already exists for `lead_id`, it returns the existing id.
2. **Lock:** `SELECT … FROM leads … FOR UPDATE`.
3. **Authorization:**
   - owner;
   - assignee;
   - **both NULL (unassigned)**;
   - Admin, or super admin in the same org;
   - Team Leader ancestor.
4. **`custom_fields`:** `v_cf := p_client->'custom_fields'` when it is an object, else NULL. **The stored
   `v_lead.custom_fields` is never read.**
5. **Client insert:** `assigned_agent_id := v_lead.assigned_agent_id`. The lead's calls, notes, appointments
   and other records are moved to the client. **The lead is deleted.**

**Win (after commit, in the browser):** `triggerWin({ agentId: lead.assignedAgentId, idempotencyKey:
'conversion:<lead-id>' })`.

**Loss mechanism:** whenever the browser's copy lacks stored keys, the client receives an incomplete bag and
the lead is deleted, so the stored values are gone. This includes the Team/Open unreadable-master case, a
stale form, and an old tab.

## 2. Proposed merge semantics (inside the same authorized transaction, after the `FOR UPDATE` read)

| Input | Rule |
|---|---|
| Stored `v_lead.custom_fields` is an object | This is the base. Every stored key is preserved. |
| Stored is NULL | The base is `{}`. |
| Stored is malformed (not an object) | **Refuse** with `malformed_custom_fields` (22023). Nothing is inserted or deleted. The lead survives for repair under invariant #28. It is never coerced or dropped. |
| Payload `custom_fields` absent or NULL | Nothing is added; the stored base is kept. |
| Payload is not an object | Refuse (22023). |
| Payload key not in stored | Added. This is legitimate new conversion data. |
| Payload key already in stored, same value | No-op. |
| Payload key already in stored, different value | **Stored wins.** Conversion is not an edit surface, and a stale browser copy must not overwrite newer stored data. The difference is returned in `custom_fields_conflicts` so the UI can tell the user. Alternative for Chris: payload wins only for keys the modal itself edits. Today the modal edits none except `additional_policies`. |
| `additional_policies` | **Exception:** this key is owned by the conversion. Payload present with an array: the payload replaces it (the canonical writer, invariant #35). Payload present but not an array: refuse. Payload absent: the stored value (if any, and only if an array) is kept, never deleted. A stored non-array is refused, as above. |
| Internal keys (`__agentflow`, `tags`) | Always preserved from stored. Never taken from the payload. |

The resulting bag is written to `clients.custom_fields`. A `{}` result is stored as NULL, which matches today's
null-when-empty behaviour.

## 3. Concurrency and idempotency

- The `FOR UPDATE` lock on the lead row serializes against concurrent lead edits. A concurrent `leads` UPDATE
  either commits first, and is then included in the base, or waits.
- An idempotent retry returns the existing client **before** any merge and never re-merges. This is
  unchanged.
- Double submission is prevented by the existing `clients.lead_id` partial unique index plus the pre-checks.
- The win keeps its `conversion:<lead-id>` idempotency key.

## 4. Tenant isolation, ownership, telemetry, rollback

- **Tenant isolation and authorization:** the org checks and the authorization predicate are unchanged. SC-1
  does not widen who may convert. The unassigned branch is itself on the security-review list (findings F1–F4
  context).
- **Telemetry:** calls, recordings and durations are untouched; only the `custom_fields` expression changes.
- **Rollback:** restore the previous function body. That rollback **reopens the data-loss path**, and its
  header must say so.

## 5. Does SC-1 alone make a short Sold safe to complete? **No.**

SC-1 removes the data-loss reason for the frontend master-record gate. But for an unclaimed, unassigned
Team/Open lead converted by a non-owning Agent:
- **The client gets no owner.** `clients.assigned_agent_id := v_lead.assigned_agent_id` is NULL, so the
  agent's sale becomes an unassigned client.
- **The sale gets no credit.** The win is credited to `lead.assignedAgentId`, which comes from the browser
  and is `""` for an unclaimed lead. The win therefore has no agent: no leaderboard or "policies sold"
  credit.
- **The claim never happens.** The hard claim (`claimOnDisposition`) runs only after conversion. By then
  the lead is deleted, so the claim never lands.

**Correct short-Sold completion needs both of these:**
- SC-1, for data integrity;
- an explicitly approved **server-side ownership decision inside the conversion transaction**, for example
  "a converting disposition by a lock holder assigns the client and the win to the caller". That decision
  belongs to the coordinated authorization review (it depends on F1 and F5 being fixed, so that "lock holder"
  is trustworthy). It is not a frontend workaround, and not an earlier `claim_lead`.

## 6. Tests required if approved

- A local as-`authenticated` harness (AGENT_RULES #37) covering:
  - stored-only;
  - payload-only;
  - both, with and without conflicts;
  - NULL and malformed stored or payload values;
  - `additional_policies` present, absent and malformed;
  - internal keys;
  - an idempotent retry that returns before the merge;
  - concurrent-edit ordering;
  - cross-org refusal.
- Pre-apply catalog preflight and post-apply read-only verification.
- Advisors after the change.
