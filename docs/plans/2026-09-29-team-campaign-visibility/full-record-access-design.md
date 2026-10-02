# Team full-record access — separate coordinated authorization design

Status: Chris authorized the next implementation and verification steps on October 2 with
“Start the next steps and complete the task.” This authorizes a reviewable branch build and isolated
verification of the coordinated design below. Exact production application, legacy-association
validation targets, and the P1 observation/P2 transition remain separate release decisions under
AGENT_RULES invariant #28 and R6-C. No hosted mutation is authorized or performed by this document.

## October 2 implementation scope and as-built status

Catalog-only refresh confirmed the original claim body, client INSERT/identity policies and missing
lock provenance remain live; the September 25 recent-call queue guard is present. Build staged P1
provenance, then P2/P3 containment and a whitelisted display reader. Keep five-minute TTL, renewal,
callback/retry/SKIP LOCKED ordering and old-client signatures. Preserve unproven old lock lifetimes.
New explicit attachments validate source access; a separate manager-only operation validates a
historical association against its exact current campaign/org/master IDs, without changing business rows.
No historical association is auto-approved. The display DTO never becomes the master/edit/Sold record.

Files to touch before implementation:
- New CLI-created staged migrations for queue provenance/association proof and claim/identity/reader;
  a fail-closed reader-disable operations file (no inverse that reopens unsafe claim authority).
- New `supabase/tests/team_dialer_*` fixtures, authenticated assertions and compatibility/concurrency
  checks; `scripts/run_team_dialer_access_tests.sh`; isolated PostgreSQL workflow.
- New `src/hooks/useTeamDialerLeadDetails.ts` and visit/response tests; narrow DialerPage/details wiring
  and real-page tests. Existing master, edit, conversion and telephony code stays distinct.
- This design, the scoped implementation plan, root plan pointer and newest-first WORK_LOG entry.

Gate: exact candidate SQL must pass authenticated legitimate/forged/foreign/legacy cases, concurrent
queue/claim tests, old-client renewal/save behavior, drift/replay refusal and reader disable recovery.
Before production P2, observe the P1 unproven-lock count and review exact legacy association targets.

## Problem and evidence

The frontend can render every populated field returned under the viewer's current permissions.
It cannot recover an RLS-hidden master `leads` row or its `custom_fields`. Removing the call-state
blur solves presentation, but does not make every Agent's full record readable.

The September 24 catalog findings are recorded in
`docs/audits/2026-09-24/DIALER_AUTHORIZATION_FINDINGS.md` (F1/F4/F5 and R6-C). They describe
client-writable campaign-to-lead references and locks, and an insufficiently constrained claim RPC.
The September 29 plan also confirmed the missing-master path. These are dated evidence, not a
claim that the production catalog was refreshed during the October 2 frontend build.

Chris's recorded direction is to handle ONE coordinated authorization review, address `claim_lead`
first, and avoid widening backend access to solve display problems. A reader that merely joins the
current lock to `campaign_leads.lead_id` is therefore unsuitable. General Contacts RLS must stay as-is.

## Proposed delivery order

1. Review the existing R6-C P1/P2/P3 containment proposal together, including every legitimate
   attachment/queue/claim caller and the old-client payloads. Refresh catalog-only evidence under
   separately authorized read scope. Do not assume repository migration files were applied.
2. Build and verify those changes in an isolated database. P1 adds server-issued lock provenance;
   P2/P3 constrain claim authority and writable queue identities. Their existing approval and
   transition decisions remain open. No clamp, renewal cap, forced unlock, or reassignment is added.
3. Establish trustworthy Team campaign-to-master association provenance, including existing rows.
   This is an additional prerequisite: immutability after a deployment cannot prove earlier rows
   were legitimate. Do not treat a null-to-present mark on every old row as validation.
4. Only after those prerequisites are verified, implement a narrow read-only Team dialer reader
   and its visit-bound client adapter. Do not expand Open Pool visibility as part of this request.
5. Review exact migration bytes, test results, compatibility evidence, and recovery instructions
   before any approval for production application. Review frontend release separately.

The existing P1 proposal stamps a lock only after the canonical queue reruns selection eligibility.
Heartbeat renewal preserves provenance but never creates it. This design must not introduce another
lock acquisition route or grant a mark based solely on finding an existing client-created lock.

## Additional association provenance proposal

Use a private, client-unreachable association ledger (candidate name
`private.team_queue_associations`) keyed by `campaign_lead_id`. Bind the exact `organization_id`,
`campaign_id`, and `lead_id`, plus validation time and validating actor. No grants to PUBLIC, anon,
or authenticated. Authorized server attachment/validation paths are its only writers.

An entry is proof that an actor with authority over both the campaign and intended lead explicitly
approved that association. Reader checks must compare all four identities against the current rows;
a caller-supplied lead/org/agent ID never chooses the target. A legitimate detach/identity change
invalidates the proof atomically. Queue status, counters, ordering and lock timestamps are not proof.

New attachments write the ledger only after existing tenant, campaign administration, and lead-scope
checks pass. For historical rows, reuse an independently trustworthy attachment record if one exists
and proves the same authorization; otherwise require an authorized manager to validate the intended
association through an explicit server operation. That operation records consent without changing
queue identities, status, ownership, or active locks. It must be idempotent and separately approved
for production use. No guessed bulk backfill, mass cleanup, detach/reattach, or data reassignment.

Exact ledger DDL, trusted writer allowlist, existing-record evidence source and manager authorization
matrix must be reviewed before implementation. Unsupported historical associations stay unreadable
through the new reader; their existing queue/campaign-copy behavior remains available.

## Proposed reader contract

Candidate: `get_team_dialer_lead_details(p_campaign_lead_id uuid)`. Its only selector is the queue
row ID; identity and organization come from authenticated server context. Grant EXECUTE only to
authenticated after explicitly revoking PUBLIC/anon. If SECURITY DEFINER is used, pin its owner and
search path and keep all authorization in the function; never put a service key in the browser.

Before returning anything, require:

- A real authenticated actor with the server-resolved current organization.
- The campaign, queue row, master and ledger all in that organization, with exact matching IDs.
- A Team campaign this actor can currently dial, using the authoritative membership/access matrix.
- This actor's unexpired, canonically issued lock on this queue row; an arbitrary own lock is insufficient.
- A validated association and currently eligible ownership; no newly exposed lead owned by another agent.

Return a whitelisted display payload containing supported standard lead fields and the saved
`custom_fields` bag. Do not return unrelated contacts, queue inventories, assignment/export tools,
history, or arbitrary columns. The UI resolver continues excluding reserved metadata and blank values.
The database payload supplies display data only: editing, conversion and hard claim stay on their
existing authorization paths. Never treat this display DTO as a writable, complete contact record.

Unavailable/refused responses return no record. They do not reveal whether a foreign/private target
exists and do not claim, release, renew, reassign, convert, or increment attempts. Reader execution
must not hold row locks across user interaction or perform a fetch-then-lock sequence.

## Client and active-tab compatibility

Use a separate Team display-read adapter keyed by organization, viewer, campaign, campaign-lead,
master-lead and visit identity. Require the current successful queue-load confirmation. Cancel or
ignore old responses on any scope/lead/lock change, including A → B → A, unmount and membership loss.
No polling, privileged fallback, pre-call hard claim, or use of the reader for Personal/Open Pool.

Keep the current RLS-governed master/edit/conversion adapter distinct. A readable display DTO must
not change `canEditTeamOpenLead`, Sold/Convert completeness checks, Contacts access, or ownership.

Older tabs keep the existing RPC signatures and queue return shape. They do not receive extra
permissions through their old general `leads` reads. Unproven old locks retain their operational
lifetime/renewal behavior but do not authorize the new reader. Use the existing P1 observation window
and Chris's P2 transition decision; do not force old calls off a lead to accelerate rollout.

## Required isolated authenticated verification

| Case | Required outcome |
|---|---|
| Two Agents acquire simultaneously | One canonical lock per lead; existing SKIP LOCKED order unchanged |
| Authorized Team participant, proven association and own live queue-issued lock | Correct populated display fields before dialing, including saved imports/custom values |
| Forged own lock or forged provenance mark | No privileged record; client cannot create/preserve the mark |
| Re-pointed `lead_id`/campaign/org or forged association | Write refused or ledger mismatch; no target record |
| Legacy association without independently validated provenance | No privileged record; existing campaign copy remains usable |
| Removed Team participant, foreign org, other agent's lock/private book, or expired lock | No record and no information about the target |
| Claim with a different master ID or another owner's lead | Refused with no ownership transfer |
| Display permission without master edit/conversion permission | Read-only fields; existing writes/conversion remain refused |
| Stale start/finish, viewer change, A → B → A and old open tab | No obsolete record; compatible queue/heartbeat/save payloads |
| Renewal, transient error, definitive loss, Skip, Save, Save & Next, failed save | Existing cadence, retention, suppression, release and advancement behavior preserved |
| Callback/retry/recent-call guard/hard-claim thresholds | Existing operational rules preserved; no pre-call display claim |
| Unproven long-lived active lock | No forced unlock/cap; rollout follows reviewed observation decision |

Use the repository's isolated authenticated harness and exact candidate SQL; no production credentials,
business-row reads, live dialing or hosted mutation. Verify denial through direct SQL/RPC calls, not
only through UI gates. Catalog diff must show no general Contacts SELECT expansion and no new anon
or PUBLIC executable reader.

## Proposed files for the later implementation

- New staged Supabase migrations for reviewed provenance/claim protections, private association ledger,
  trusted writers and Team reader. Final names/versions assigned only with approved exact SQL.
- New isolated SQL fixtures/assertions for forged and legitimate paths; corresponding local runner.
- A separate Team display adapter/hook and targeted DialerPage/details wiring/tests.
- This design, the coordinated authorization findings, implementation plan and WORK_LOG.

Recovery disables the new reader/client path and restores the existing campaign-copy notices. It
must preserve the approved ownership/provenance protections. Do not roll back to takeover-capable
claim behavior or widen RLS as a recovery shortcut. Exact disable SQL and old-client replay evidence
are required with the candidate implementation.


## As-built release sequence and verification

Three candidate migrations are built, not applied. Exact production approval precedes P1 and P1B.
P2 refuses while any unproven active lock remains or a nonterminal Team/Open association lacks
exact reviewed source provenance. Locks must expire or release naturally; never shorten/delete
locks for deployment. Historical associations need individual manager review through
`validate_team_queue_association(queue_id,campaign_id,lead_id)` using genuine app authentication.
No blind backfill, actor spoof or blanket approval. Only then release P2 and the frontend.
Recovery: revoke the new reader with `supabase/ops/team_dialer_display_disable.sql` and roll back
the frontend; retain the hardened claim, immutable identities and contained ACLs. Recheck owners,
grants, search paths, function preimages, policies and triggers before any production application.

All staged authenticated SQL/RLS suites pass in isolated PostgreSQL WASM. Native multi-session
races, staged refusals and negative mutations run in the new PostgreSQL CI job; its exact-head
result is mandatory before release. Build/root tsc pass; app tsc retains 90 existing diagnostics;
changed-file lint has zero errors and 18 existing warnings. Final CI evidence is recorded in PR401.
Earlier proposal-only wording below the implementation scope is historical design rationale.


## October 2 production approval and staged application

Chris approved the production handoff at 11:47 America/Los_Angeles. Approved source head:
3927292fa12dfd47cdca5116779828c345be79ab. Preflight matched canonical function bodies/owners,
Contacts/queue/lock policies and existing counter triggers; both exact-head CI jobs passed.
Applied P1 as 20261002184930 and P1B as 20261002184954. Catalog postconditions match tested
queue/core/admin fingerprints, pinned owners/search paths, nullable no-default lock provenance,
private ledger RLS/ACL and authenticated-only manager validator. No legacy backfill or forced
unlock. Fresh operational queue selections are issuing proven locks. Claim and Contacts policies
remain unchanged; the Team display reader is not installed.

P2/merge/frontend are BLOCKED: review preflight finds 347 home-agency historical associations,
four with source/type eligibility conflicts, and 472 in other agencies needing their authorized
manager review. No genuine authenticated manager session was supplied for validation; do not
forge a JWT or use privileged SQL to impersonate an actor. One unproven lock was still active at
18:51 UTC, expiry 18:56:01 UTC; it must leave naturally. Exact home-agency review manifest is
prepared privately as a separate release artifact. Approval of the build/release is not blanket
consent to mark every association or repair ownership. No P2 application or merge/deploy attempted.

Repository filenames are aligned to the hosted P1/P1B history; SQL bytes are unchanged. The
unapplied P2 candidate was re-created with the CLI after them as 20261002185105; its approved
SQL bytes remain identical. The isolated runner references the new versions in explicit order.
Recovery remains reader-disable/frontend rollback while retaining provenance/claim containment.
