# November 7, 2026 Pacific — C-NULL-IDENTITY correction verification

The scoped correction is complete in the candidate; it is not deployed. Chris instructed proceeding after the blocker was disclosed. The exact 14 paths were listed in root implementation_plan.md before editing. Main remains `e2739c26e21f8e159b783ccf59046fed55560b16`; PR #486/#514 heads remain `2de28c320547983f68bed5f77d8ec9684ea3643d` / `3c54f4d13de7b6901db33c111d94fb70d4f42f6a`. This current record supersedes the historical documentation-only status below.

## Change and regression proof

The entire production logic change is `IF NOT (identity predicate)` → `IF (identity predicate) IS NOT TRUE` in unapplied …31. Missing identity is rejected rather than falling through. Existing organization, actor, age, sale operation, exception, retry and receipt checks are unchanged. The authenticated regression covers seven rejection/retry cases and four positive paths: direct client contact, original lead as contact, lead pointer, and same-org campaign membership. It checks persisted sales, no false failure records and one-sale replay. Conversion is exercised through the real companion API. Membership fixtures use retained legacy lineage because the canonical converter deletes its source lead and retains the lead's name; converted clients are addressed by their returned client_id.

The original frozen SQL was reconstructed in an isolated test copy and verified against its exact SHA-256 `35587f385eea207ec2eea9ae84421d1413ebccf1759ac1609bd490dceedc2016`. It fails the new authenticated regression with `FAIL: C-NULL-IDENTITY rejects manual_null`. The corrected SQL passes the entire commission harness, canonical L1–L16 coverage, the six multi-session failure-boundary checks, existing handoff/tracking regressions and rollback. The failure-boundary file remains byte-identical to the frozen candidate. The runner adds only its canonical Package C section; four CI path filters ensure the new migration/tests invoke that harness.

## Native environment and results

Synthetic loopback databases only, native PostgreSQL **17.6**, TLS enabled, Supabase CLI **2.121.0**, no production credentials. PostgreSQL source checksum and pinned CLI archive checksum passed; CLI archive SHA-256 is `4b481189efbdc57cf2d37bdee5f1a0d29574314398564b32a6dfb76c0fcf275f`. Native sandbox `sbx_FoEg6W78MEwylZKOgAAp9eZRci1w` is test infrastructure, not a production deployment.

| Check | Result |
| --- | --- |
| Full commission database harness | PASS, exit 0, 35.564 s; command `cmd_9343373aec884dffb22124b755c0` |
| New NULL/mismatch/positive wrapper regression | PASS; sales persist, rejected replay remains one sale |
| Lock/recover/cancel/replay/double/assert boundaries | 6/6 PASS; synthetic lock case 122 ms |
| Original-SQL negative control | Expected regression failure; verifier exit 0; command `cmd_9ce764e6d8c44854a312af3dc6f7` |
| Full protected release-runner rehearsal | 17/17 PASS, exit 0, 32.645 s; command `cmd_32f2c4dfe2844c1599c4561959e8` |
| Source pins / CLI history | 34/34 source pins pass; …31 recorded as 21 statements with new exact digest |
| Frozen release-file comparison | Exactly 2/36 differ: …31 and scripts/reports_release.py |
| TypeScript / syntax / whitespace | `npx tsc --noEmit`, bash/node syntax checks and `git diff --check` pass |

…31 now has 18,167 bytes, SHA-256 `4bfb733eaefd6bffffd1c6c759e592611eabe78c0157146d9774633f5cfda6d9`. A fresh isolated CLI `migration repair` reproduced statement SHA-256 `6cc671fa5fda16dec6ecaaf69a99642f13231a8ae8e10f3eb4d972d154a4d6a0`. The full release rehearsal independently reproduced it through the runner. Other migration/history/closure pins remain unchanged; capture is outside the report-definition closure.

Rehearsal inputs use the canonical frozen source plus the four previously approved Havana fixture corrections, with this corrected migration/runner/test overlay. They do not replace the backend-only main fixture set. Early setup attempts were stopped by missing archive/fixture dependencies and an uninstalled ltree extension; two new fixture mistakes (deleted lead and converted-client name) were corrected before the successful run. No production schema workaround or relaxed assertion was used. Native commission proof did not enable optional PostgREST integration or performance measurements; hosted CI runs those existing branches. Owner UI/CSV/map review, production smoke tests and independent human sign-off are not inferred from these checks. The human reviewer requirement remains waived, not signed off.

## Retained native output

Log SHA-256: commission-fixed `1d1b9ef3bfa49ea8bd21b98ce5302a54a458db978043b1fd138d672813474100`; commission-original `07de098509709f0f371a90cb663e7fea6ec090b0beb7ddd7adbcd2b37ef5de19`; release-fixed `3955075c9f0097beae3e861a014bb951af29cb60c09596ada32961c2edd39294`.

### commission-fixed.log

```text
PostgreSQL: 17.6
PASS migration guards and existing-object inventory (175 objects unchanged)
 PASS policy commission security
 PASS policy commission handoff
 PASS policy commission tracking
PASS expected windows guards and inventory (8 bodies replaced, 4 writer-only helpers, 175 other objects unchanged)
 PASS policy commission expected windows
PASS commissions center guards and inventory (5 reads, 2 indexes, 175 existing objects unchanged)
 PASS commissions center scenario built
 PASS overview cards, timeline, review and setup reconcile
 PASS statuses, excess, voids, holds, superseded, month timing, unknown dates, non-monthly and zero rates
 PASS card drill-downs reconcile across pagination; filters
 PASS policies list, setup state and completeness
 PASS drawer parity
 PASS reassignment: seller keeps financial history, contact restricted, assignee sees nothing
 PASS same-org admin and team leader, cross-org and Agency Group peer see only their own
 PASS permissions, sign-in, time zone and validation
 PASS commissions center reads
PASS commissions insights guards and inventory (6 functions, goals table, 179 existing objects unchanged)
 PASS commissions insights scenario built
 PASS breakdown cohort, carriers and products
 PASS drill-downs reconcile with every bar and slice; filters compose; released lists unchanged
 PASS comparison windows (month to date, completed months, custom, future, leap years, zero baseline)
 PASS Months 10–12
 PASS monthly goals
 PASS permissions, sign-in, time zone and validation
 PASS commissions insights
 PASS commissions center scenario built
 PASS overview cards, timeline, review and setup reconcile
 PASS statuses, excess, voids, holds, superseded, month timing, unknown dates, non-monthly and zero rates
 PASS card drill-downs reconcile across pagination; filters
 PASS policies list, setup state and completeness
 PASS drawer parity
 PASS reassignment: seller keeps financial history, contact restricted, assignee sees nothing
 PASS same-org admin and team leader, cross-org and Agency Group peer see only their own
 PASS permissions, sign-in, time zone and validation
 PASS commissions center reads
PASS independent-session races and lock contention
PASS existing sale recording, identity, performance, Sold Date and repair suites with both migrations applied
 PASS policy commission security
PASS non-destructive rollback, refusal, replay refusal and reapply
 PASS policy commission expected windows
PASS expected windows rollback: refusal, record-keeping rollback, exact restore (514 commission catalog lines), replay refusal and reapply
PASS commissions center rollback: exact restore, records kept, replay refusal and reapply
PASS commissions insights rollback: goal refusal, exact restore, records kept, replay refusal and reapply
PASS producing-call capture guards: order, replay, handoff preimage drift, dependency column
 PASS L1-L3, L8, L10 record capture, retry, replay, unchanged handoff and PT409 passthrough
 PASS L4, L14 validation rejections and tracked inbound
 PASS L5 conversion capture
 PASS L6, L9 immutability and privileges
 PASS L7, L15, L16 failure record, status read and retry
 PASS L12 lead lineage guard
 PASS L13 reversal
 PASS C-NULL-IDENTITY authenticated record/conversion rejection, valid lineage, sale persistence and retry
 PASS policy sale call links
PASS T-LOCK sale saved, link failure recorded as 55P03 in 122 ms
PASS T-RECOVER open_failure read in a new session, then linked by the retry RPC
PASS T-CANCEL a cancelled call leaves no sale, link or failure row
PASS T-REPLAY the same request afterwards saves the sale and its link
PASS T-DOUBLE one sale and one link for a request sent twice
PASS T-ASSERT an assertion failure is never caught: no sale, link or failure row
 PASS policy commission handoff
 PASS policy commission tracking
PASS the existing handoff and tracking suites with the producing-call capture installed
PASS producing-call capture rollback (L11): disabled capture, sales unaffected, links kept
PASS policy commission tracking database proofs
```

### commission-original.log

```text
PostgreSQL: 17.6
PASS producing-call capture guards: order, replay, handoff preimage drift, dependency column
psql:/vercel/negative/supabase/tests/policy_sale_call_links.sql:252: ERROR:  FAIL: C-NULL-IDENTITY rejects manual_null
CONTEXT:  PL/pgSQL function test_assert(boolean,text) line 2 at RAISE
 PASS L1-L3, L8, L10 record capture, retry, replay, unchanged handoff and PT409 passthrough
 PASS L4, L14 validation rejections and tracked inbound
 PASS L5 conversion capture
 PASS L6, L9 immutability and privileges
 PASS L7, L15, L16 failure record, status read and retry
 PASS L12 lead lineage guard
 PASS L13 reversal
```

### release-fixed.log

```text
PASS TEST: local PostgreSQL 17.6 with TLS and no production connection
PASS TEST: only manual dispatches on main; protected environment; only two scoped secrets; one choice per stage
PASS TEST: required reviewer is cgarness; admin bypass and other refs forbidden
PASS TEST: 34 checksum-pinned files (every migration, release enable, ops script and rollback) and the pinned CLI
PASS TEST: a different Supabase CLI version is refused (version drift)
PASS TEST: file tampering, duplicate and pending copies fail before any connection
PASS TEST: wrong confirmation, unknown stage and non-main branch refused
PASS TEST: the verified production history baseline (356 rows, head 20261105051037) and all 20 CLI digests are pinned
PASS TEST: the pinned production baseline (356 rows, head 20261105051037) classifies as pre-PKG-A; any other count refuses
PASS TEST: check (preflight) is read-only; out-of-order, read-back and record-history refuse before PKG-A
PASS TEST: PKG-A: six transactional files, the concurrent index, the enable, read-back and 8 history rows
PASS TEST: PKG-B: disable-v3, …20, …21, the PKG-B enable, read-back, history
PASS TEST: PKG-C: …30, …31, disable-v3, …32, the PKG-C enable, read-back, history
PASS TEST: PKG-D: …40, the 36-row baseline, …41, …42, disable-v3, …43, the PKG-D enable, read-back, 20 history rows; calls, sales and clients unchanged
PASS TEST: disable-all leaves class W on; re-enable restores the PKG-D pins and passes read-back
PASS TEST: recovery: D, C (…32, …31) rolled back in reverse order with history reverted; …30 has no rollback, so PKG-B cannot roll back past it; re-enable at the PKG-B pins passes read-back
PASS TEST: history drift stops every further stage
ALL PASSED: 17 release rehearsal checks
```

---

## Historical preflight and preparation (superseded where noted above)

# November 7, 2026 Pacific — Package C read-only preflight and Package B closeout

Base main `e2739c26e21f8e159b783ccf59046fed55560b16`; no drift. Production history 367/head …22, contract 3.1.0, sale_call_links/appointment_evidence not_installed. Link/failure tables and all seven new Package C functions are absent. Advisors 279 security/463 performance/0 health.

| Dependency | Definition MD5 | Body MD5 |
| --- | --- | --- |
| record_client_policy_handoff(uuid,uuid,jsonb,boolean,jsonb) | b02760be55132f0be3fa91b04955e839 | d39e03a7dd2cf122a68dc0fefcbfb44a |
| convert_lead_to_client_with_sales_handoff(uuid,uuid,uuid,jsonb,uuid,jsonb) | f331226b398134ea485d5543472d5ccf | 4d6803ff7d94b7735e3f1b3baf18456c |
| private.report_v3_sale_call_links(uuid,timestamptz) | 769d31d180bf61264b0609e87b3ea24f | — |
| private.report_v3_basis_flags() | 67c6a60a1004b4596a4a61487a41d17b | — |

Both handoffs are postgres-owned; all four preimages match frozen SQL. Matching pins do not establish safety; the blocker below overrides release readiness.

## Release blocker C-NULL-IDENTITY — confirmed by read-only predicate check

Frozen `20261105120031_policy_sale_call_link_capture.sql`, private.capture_policy_sale_call_link, uses `IF NOT (ca.contact_id = cl.id OR (cl.lead_id IS NOT NULL AND (...)))`. SQL NULL is not TRUE: a manual client with a call having NULL contact_id, or a converted client with unrelated contact_id and NULL calls.lead_id, can produce NULL and skip the rejection branch. A SELECT over synthetic VALUES confirmed both cases: identity_predicate=NULL, rejection_branch_taken=false; the positive matching control returned TRUE. No production rows were inserted or role-simulated.

The link-table trigger checks same-org sale/client and call/direction, but does not independently establish the call's buyer identity. Other checks (same organization, actor, call age, sale operation) still apply; this is a within-organization attribution integrity gap, not demonstrated cross-tenant access. Source control-flow review identifies a reachable missing-identity case; no complete wrapper exploit or synthetic sale was executed. The capture function is absent in production.

**Do not execute Package C as frozen.** A separately approved correction should make rejection fail closed when the identity predicate is not TRUE, add NULL/mismatch/matching regression cases in the canonical candidate test harness, and rerun the release/security/concurrency rehearsal. Review and update the frozen source/statement digests only under a new exact-file approval; never silently change the old candidate or pins. The current eight-file approval authorizes documentation only. Identify the canonical candidate test/harness paths and exact expanded file list before requesting correction approval. No patch or test file is included here.

## Lineage and frontend review

Live catalog text search for client INSERT/UPDATE with lead_id identified convert_lead_to_client_atomic and create_client_with_sale. Full returned bodies were reviewed: the converter establishes lead_id on INSERT and preserves call telemetry during contact reassignment; the manual writer rejects caller lead_id and uses an explicit column list without it. No direct clients.lead_id UPDATE writer was found. This is a catalog/static audit, not proof against arbitrary privileged/dynamic SQL.

Repository direct-client access search covered src and supabase/functions. clientToRow (supabase-clients.ts) omits lead_id; ordinary update/assignment paths do not set it; conversion passes p_lead_id to the canonical RPC. SMS lineage and contact-message lookups read it. Preserve this mapping and all existing auth/org checks. The proposed guard restricts UPDATE outside postgres, not INSERT or privileged postgres.

Current policySaleRecording uses the existing Phase 2A companions, with no _v2 routing. DialerPage ConvertLeadModal is currently near line 4546, not the historical plan's 4691: future patches must use current JSX context. It does not pass sourceCallId. FloatingDialer modal callbacks retain call-visit/config-version checks. TwilioContext retains isDialingRef and current-attempt guards, creates the call row before twilioMakeCall, and delegates to browser device.connect in src/lib/twilio-voice.ts. No telephony source changed. Future tracked-inbound selection must use server af_call_row_id, clear memory on sign-out/org change, and remain disabled under View As. Existing frozen retry and sale receipt semantics stay intact.

Canonical Package C tests/harness are not present on this backend-only main checkout (policy_sale_call_links.sql and reports_v3_fixture.py are absent). Locate them in the frozen candidate/integration source before any correction approval; do not invent a new production harness or claim it ran here. Prior native 17/17 and contract/concurrency evidence is retained as historical evidence and does not cover the newly identified NULL case.

## Local verification

PASS: root `npx tsc --noEmit`; `git diff --check`; exactly the eight authorized documentation paths; all 34 SQL size/SHA-256 pins; all 36 SQL/runner/workflow files byte-identical to frozen candidate 38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c. No new source tests were written or claimed for this documentation-only change. The newly discovered NULL case remains a release blocker despite historical suite success.

---

## Historical verification

# Reports V2 — Package B preparation verification

November 7, 2026 Pacific. Scope: technical source inspection, read-only production catalog/preimage checks and local documentation verification. No production writes, impersonation, workflow dispatch or independent human sign-off in this preparation.

## Fresh production preflight

| Check | Observed result |
|---|---|
| History | 364 rows; latest 20261105120017; all eight Package A rows recorded |
| Basis | contract 3.0.0; corrections/sale_call_links/appointment_evidence not_installed |
| V3 readers | Nine callable by authenticated |
| performance_sale_monthly function definition MD5 | 51e06b46a13c3a8eec4d672bec158376 — expected |
| performance_sale_monthly body MD5 | deb0d3330a432cd4324ea422856d67a0 — expected |
| performance_monthly body MD5 | 7e7063317a34f37d90faf14914b98827 — expected |
| report_v3_sale_premium definition MD5 | 37800ccc8ada2fae26b86dd5a610eb09 — expected |
| report_v3_basis_flags definition MD5 | e446177c344762bec8caf7d5e9321d9b — expected |
| Package B objects | Ledger, two RPCs, effective/original readers and book parser absent |
| Advisors | Security 276; performance 463; health 0 |

Only aggregate/catalog output was retrieved. Live campaign_actor definition confirms auth.uid is required, JWT organization must equal the database profile organization, profile must be Active, and role/is_super come from the database. No user_metadata authorization or caller-selected organization was introduced.

## Frozen SQL security and write review

Reviewed ...20 correction ledger/writer/history reader, ...21 basis replacement/grants, ...22 report enable, and ...20 rollback. Source bodies stay frozen.

| Area | Observed implementation and release implication |
|---|---|
| Tenant authorization | Writer resolves campaign_actor, requires Admin/Super Admin/is_super, selects sale and client in actor home organization; no organization input. Existing actor helper independently checked live. |
| Ledger isolation | Private schema, organization_id required, RLS enabled; no policies or client table grants. PUBLIC/anon/authenticated/service_role table privileges revoked. SECURITY DEFINER RPCs deliberately mediate access; RLS alone is not their authorization boundary. |
| Audit | Append-only revision chain, unique org/request and org/win/revision, predecessor and sale identity checks; UPDATE/DELETE/TRUNCATE refused by three triggers. No FK to wins so a ticketed reversal retains inert audit rows. |
| RPC exposure | ...20 creates both RPCs sealed; ...21 grants authenticated only and checks effective ACLs. Service role, anon and PUBLIC remain denied. Writer access becomes active before frontend release, so later ...21 approval must expressly include it. |
| History scope | Admin home org, original seller, or Team Leader ancestor of seller. Book values/request IDs/can_correct reserved for Admin. Correction notes/history are intentionally visible to the authorized seller/team reader. |
| Concurrency and idempotency | Organization-scoped request and policy transaction advisory locks; client FOR UPDATE; expected revision/effective amount/raw book value; same actor + identical payload returns prior result; conflicting replay gives PT409. |
| Book writes | keep_current leaves book untouched. match_sale requires a present matching policy and non-diverged book. Primary known-zero write refused; additional numeric zero permitted. Update targets the already locked home-org client. |
| Immutable sale/commissions | No writes to wins or saved commission tables; optional book update and ledger insert share one transaction. Corrected value credits original seller/Sold Date through shared calculation. |
| Input constraints | Required IDs/revision/reason/note/book mode; bounded two-decimal amount or unknown; same-value allowed only to freeze legacy fallback. Server errors distinguish denied, invalid, missing and stale/conflict. |
| Release value identity | ...20 and ...21 collect preimages and compare every sale's values before commit; attributes preserved. Empty ledger means no intentional AP change at installation. |
| Rollback | Always seals application RPCs; restores old functions only with empty ledger and exact compatible postimages. Never drops ledger/guards. If corrections exist, readers retain corrected values. A re-forward is a new reviewed migration. |

No new blocking defect was identified in this bounded source/preimage review. This is not fresh production authenticated-write testing or a claim that all repository security findings are resolved. The frozen native evidence below supplies the synthetic write/concurrency tests; production mutations remain gated.

## Conflicting work and evidence provenance

Current main is 15d967320af7a0bd9774e09bc57e0dd31f97900c. PR #486 is open at 2de28c320547983f68bed5f77d8ec9684ea3643d. Its 23-file diff does not replace or pin performance_sale_monthly; the older direct-function-overlap statement is superseded. It modifies commission validation/grid helpers and has its own historical premium derivation. Keep its backfill and exact financial approvals separate; do not redefine commission basis through this release. PR #514 at 3c54f4d13de7b6901db33c111d94fb70d4f42f6a overlaps shared docs only and was not incorporated.

Prior assembled native verification is retained, not rerun or relabelled as new: PostgreSQL 17.6 + TLS + CLI 2.121.0, release harness 17/17, non-performance security/contract/seal/index suites, premium correction concurrency in both orders, appointment-link race. Source: evidence/release-readiness-2026-11-06.md. Log hashes: release-rehearsal.log 3955075c9f0097beae3e861a014bb951af29cb60c09596ada32961c2edd39294; v3-suites.log c5c560008e702b6622aa2c250b4fc013d0767b53023714ba64fe67c3f4cb122d. Package A production verification and its conditional-scope limitation are recorded in production-release.md.

## Local verification

Passed: root `npx tsc --noEmit` (exit 0); `git diff --check`; exact eight-path allowlist; all 34 pinned SQL byte lengths/SHA-256 hashes and all 36 release files compared byte-for-byte with frozen candidate. The only command warning was npm's existing http-proxy environment-config deprecation; no TypeScript diagnostic. No new runtime tests are necessary for documentation-only changes; prior native/runtime evidence retains its stated limits. Hosted checks are not claimed before publication.

Existing advisors are tracked separately. Relevant remediation references: [authenticated SECURITY DEFINER exposure](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [public RLS disabled](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public). No unrelated hardening is authorized here.

Current GitHub push/pull_request workflow path filters have no match for these eight documentation files. This does not guarantee that Vercel or Supabase integrations will skip their own checks. Publication must observe their results without altering settings.
