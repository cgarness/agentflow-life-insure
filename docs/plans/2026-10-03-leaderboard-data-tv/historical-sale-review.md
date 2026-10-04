# Bounded historical sale review — no production repair executed

Inspected October 3, 2026, using read-only production queries in organization `a0000000-0000-0000-0000-000000000001`. This document is a proposed correction for review, not authorization to run it.

| Field | Candidate 1 | Candidate 2 |
| --- | --- | --- |
| Client ID | `54d44dc5-98c8-4778-a71d-f0b1d595d992` | `71137434-036b-4b3f-8e0a-c6e290b096ba` |
| Current agent | Teo Hampton | Will Harrison |
| Agent ID | `4ef505e0-7520-4a7a-a622-095914ba40c1` | `e5c4ee04-a792-47ce-ad18-953777f6d1d9` |
| Policy | Final Expense / Americo | Whole Life / Americo (stored carrier has trailing whitespace) |
| Stored Sold Date | 2026-09-28 | 2026-09-28 |
| Monthly premium | $58.45 | $41.64 |
| Annualized premium | $701.40 | $499.68 |
| Exact client creation timestamp | 2026-09-28 23:44:55.365470+00 | 2026-09-29 17:39:18.606999+00 |
| Matching client-linked wins | 0 | 0 |
| Same carrier/policy-number duplicate clients, case/space normalized | 0 | 0 |
| Same agent/type/premium and sale-date or nearby event-time win candidates | 0 | 0 |
| Org win notifications within five minutes of client creation | 0 | 0 |
| Converted lead lineage / additional policy array | Absent / absent | Absent / absent |

Both records have policy numbers; raw policy numbers and customer identities are intentionally omitted here. The duplicate check is bounded to the stored identity and the candidate-win comparison is bounded to the indicated fields/dates. This is not proof that no differently encoded duplicate exists.

## What is still unproven

The database proves that these policy-bearing clients have no linked canonical sale events. It does **not** establish that each was a newly sold policy entered at creation (rather than an existing-book entry), that the current assignee was the original selling agent, or that `clients.created_at` was the original sale-recording event time. No original win or associated win notification exists from which to recover that event timestamp. Chris must confirm sale legitimacy, credit and event-time treatment before any insert.

## Exact conditional correction proposed

If Chris confirms those three points, prepare one new migration that inserts exactly one primary-policy win for each client above:

- Organization, agent, policy type and monthly premium are the exact values in the table. Set `premium_snapshot=true` and `sold_date=2026-09-28` for both.
- Proposed deterministic keys: `repair:manual-client:54d44dc5-98c8-4778-a71d-f0b1d595d992:primary` and `repair:manual-client:71137434-036b-4b3f-8e0a-c6e290b096ba:primary`.
- Generate new win UUIDs. Derive display names from the verified client/profile rows at execution; set the exact client IDs above. Leave campaign/call links null because none is proven.
- **Proposed, subject to explicit confirmation:** use each exact client-creation timestamp above as the accepted proxy for its missing sale-recording event. Do not substitute Sold Date midnight, deployment time, or an inferred time of day. This proxy must be approved; it is not an established fact.
- Suppress celebrations: do not call `notify_win`; insert no notifications. Leave client records, policies, call metrics and assignments unchanged.
- In the same transaction, verify the exact client preimages, expected organization/agent/date/premium, no linked win, no repair key, and no duplicate policy identity. Stop for any drift, discrepancy or conflicting win. Re-running a completed repair must verify and return the identical two events, never create more.
- Read back exact rows and reconcile metrics after the separately approved migration. Keep a deletion rollback manifest limited to those two generated IDs/keys, only usable under a separately approved rollback.

## Expected change under that timestamp proposal

At the October 3 inspection time, both timestamps fall in the America/Los_Angeles week beginning September 28. That week's standings gain **2 policies and $1,201.08 annualized premium** (Teo +1/$701.40; Will +1/$499.68). September gains the same amounts; October/Today gain zero. Rolling seven-day wins increase only while each timestamp remains within the rolling window. Calls, appointments, talk time, and the underlying client book remain unchanged. Reports already use stored policy facts, so these wins must not create extra policy rows.

No repair migration has been authored or applied. Implementation approval for the forward fix does not authorize this historical correction.
