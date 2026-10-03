# Permanent disposition and organization DNC integrity

Status: SHIPPED with Chris's explicit instruction to release to production and validate with real agents. PR #402 merged as `e5c15f7f46a8d569a430f7ec237b854e2f319fe3`; production migration `20261003043122`, voice webhook v36 and both Vercel production projects are deployed. Calls resumed at 2026-10-03 04:37:38 UTC. No historical operational-data repair was performed. See [production-release.md](production-release.md) for exact actions, evidence and outstanding live-agent validation. Earlier approval gates below describe the original plan; the release record supersedes their pending status.

AGENT_RULES.md, VISION.md and WORK_LOG.md were read completely before implementation. This dedicated plan preserves the unrelated root implementation plan; the root contains a pointer here. The existing Single-leg Voice.js architecture, conversion gate, queue concurrency, duration ownership and workflow isolation remain requirements.

## 1. Confirmed root cause

The live six-argument `advance_campaign_lead` advances one membership and can label it DNC, but does not persist organization-wide suppression. DialerPage separately inserts into `dnc_list`; ordinary Agents lack that direct insertion permission, and insertion errors do not fail the disposition save. The live Team/Open queue checks terminal membership status without a normalized-phone DNC predicate. Personal queue loading is a separate browser query. A duplicate membership/master lead can therefore stay dialable. DNC lookup can fail open, and the final Voice.js boundary has no authoritative DNC admission check. DialerPage also removes an array index and subsequently updates that index after the queue has shifted. Several failure paths clear/advance even when persistence or release fails.

Read-only evidence: live queue definition MD5 `8bc7ec6830c9b3374c6b7bea1fd1a38e`; metrics `7a9aedc3802d550709bdbf1004b1ee50`. Live DNC has raw `(organization_id, phone_number)` uniqueness, not canonical-phone uniqueness. Existing canonical duplicates prohibit adding a unique canonical index without repairing history. October 2 aggregate audit found 44 terminal DNC memberships, 43 missing normalized DNC entries, and 10 nonterminal memberships sharing terminal-DNC phones. These are audit observations, not approved repair targets or proof of actual dispatch.

Production migration history includes queue/association provenance `20261002184930` / `20261002184954`, now present on current main after PR #401. Its narrowed, display-only Team visibility change is preserved; the earlier broader reader/claim design was withdrawn. Inbound recent-outbound routing `20261002203426` remains applied-production history absent from main. Read actual definitions, retain their behavior, and fail migration preconditions on unexpected drift. Do not revive the withdrawn P2 design or modify applied migrations.

## 2. Architecture

Extend ONE canonical `advance_campaign_lead` operation. It resolves actual disposition configuration by UUID in the authenticated actor's organization. Browser behavior flags, names, organization IDs and role claims are not authority. Atomically persist call disposition, campaign progression, callback fields, DNC insertion, notes/history, and requested lock release. Return persisted status, attempt count, retry/callback values, suppression and lock outcome. Standalone call dispositions use the same core; explicit no-call actions create neither calls nor attempts.

Retain `last_advance_call_id`; add durable operation receipts to prevent replay of A after B. A retried operation returns its original result, without resetting timestamps or emitting duplicate history/workflows. A per-call receipt prevents double attempt increments. Save Only followed by Save & Next can release the same saved visit without a second attempt. Reject conflicting payload reuse and stale mutations that would overwrite newer progression. DNC is monotonic unless explicitly removed through the existing authorized administration path.

Configuration drives `campaign_action`, `dnc_auto_add`, callback/appointment schedulers, required notes and pipeline stage. Never infer Not Interested behavior from its label. `remove_from_queue` becomes a persisted nondialable state; `remove_from_campaign` retains membership history. Do not delete leads, contacts, calls or campaign memberships for DNC.

## 3. Database and normalization

Reuse `private.phone_digits_e164ish` semantics: digits-only country-qualified key, bare US ten digits gain `1`, explicitly international numbers retain their country code. Reject empty/invalid dial targets. JS normalization must agree for US formatting variants without collapsing international numbers by last ten digits.

Add a tenant-scoped expression lookup index on DNC. Preserve raw entries and raw uniqueness. Serialize new canonical DNC insertions with an organization+phone transaction advisory lock and a fresh existence check. A forward-only trigger enforces canonical uniqueness for new/changed phone identities; existing duplicate historical rows remain untouched. All new persistence tables require non-null organization IDs, narrow grants and RLS. No historical DML is included in the migration.

## 4. RPC and security changes

Derive identity through `auth.uid()` and Active database profile via the existing `private.campaign_actor`. Use `can_dial_campaign`, not management permissions. SECURITY DEFINER functions are owned by postgres, use `search_path = pg_catalog, pg_temp`, fully qualify objects, and explicitly revoke PUBLIC/anon/default grants. Grant authenticated only the narrow actor-validated entry points; webhook admission is service-role only. Grant expression-helper EXECUTE to actual table writers as required by invariant #37, without exposing private schema access.

Do not broaden Agent DNC insertion. Protect direct browser writes to authoritative call-disposition and campaign-lifecycle columns so stale tabs cannot recreate a split write. Preserve ordinary contact metadata editing and Twilio-owned telemetry. Derive new campaign call contact identity from membership, validate standalone contact references through existing invoker RLS, and prevent browser reassignment of a call's contact lineage. Remove browser TRUNCATE privilege on DNC. Harden claim/release to validate actor, organization, membership-to-master identity and own lock. CampaignDetail force release uses an authorized server operation and never resets DNC status to Queued.

Workflow dispatch is isolated with exception handling; an automation failure must not abort any core CRM write. Preserve active triggers; avoid duplicate dispatch on receipt replay.

## 5. Queue behavior

Team/Open: modify the canonical `get_next_queue_lead`, retaining `FOR UPDATE SKIP LOCKED`, callback ordering, retry/max attempts, recent-call guard, licensed states, queue filters, hard claims, participation permissions, per-agent suppressions, five-minute locks and live `queue_issued_at` provenance. Authenticate before expired-lock cleanup and scope cleanup to the actor's organization. Exclude normalized DNC before selection, then acquire a nonblocking organization+phone advisory lock and recheck before issuing the row. Skip contended phones without blocking unrelated work. Deprecated wrappers remain delegates.

Personal: use an authenticated owner-only, nonlocking queue RPC. Apply DNC, terminal, retry/max attempts and callback eligibility before pagination. All Personal loading paths delegate to it; browser state cannot redefine retry windows. Queue metrics reflect DNC and relevant eligibility, while historical totals remain intact.

## 6. Final outbound admission

Keep `device.connect()` as the sole outbound start; no REST dialing, bridge, SIP replacement or provider change. Reserve the existing `isDialingRef` guard before the first await and preserve every other re-entrancy guard.

Run a fail-closed server DNC check for the actual normalized destination immediately before creating an outbound call row/connecting. A database failure shows “Unable to verify DNC status. Call was not started.” It creates no call, increments no attempt, starts no Twilio call and stops auto-dial. A database insertion guard closes the preflight-to-insert race.

The signed Twilio voice webhook performs service-only admission before returning destination `<Dial>`. Resolve the actor from trusted Twilio client identity and verify stored call actor/org/destination/caller ID; ignore browser OrgId authority and remove missing-row fallback insertion. Serialize admission with DNC for that organization+phone. Database failure or suppression returns no destination Dial. Return/persist a distinct refused-admission outcome so a parent SDK disconnect is not misclassified as No Answer or counted as a campaign attempt. Already-admitted in-flight calls are not retroactively terminated; admission and DNC commit define the concurrency order. `calls.duration` remains exclusively Twilio-owned.

## 7. Frontend lifecycle and conversion

Extract a small persistence coordinator and typed API. Capture stable campaign-lead ID plus visit generation before awaiting. Adopt persisted results only for the same visit. Remove/hide by ID after successful persistence, never by shifted index. On failure retain draft, lead and Team/Open lock; no success message or auto-advance. Definitive lock loss masks Team details and retains any unsaved draft; without a pending draft, preserve the existing next-lead recovery. Save Only keeps wrap-up and the lock; Save & Next requires confirmed release before navigation. Route manual, automatic No Answer/timeout and Personal skip through the canonical operation; never fabricate a call to save a disposition.

Remove the separate browser DNC insertion and all DNC override actions. FloatingDialer standalone dispositions use the same persistence core. Preserve caller-ID selection and all inbound behavior.

Keep ConvertLeadModal: validate required notes before opening; cancellation clears the selection and preserves the lock; success uses returned clientId for call/note/history, preserving campaign/call lineage even when conversion nulls the membership's master-lead FK. Retain clientId across persistence retry to avoid reconverting. Server verifies the converted client and original lineage. Do not alter the conversion transaction or corrupt client metadata. DNC remains required even for a converting disposition.

Preserve the September 30 appointment timezone/created_by behavior, nonfatal shadow writes and one silent history refresh. Core callback persistence belongs in the authoritative transaction.

## 8. Concurrency

Use consistent organization+phone locking for DNC/admission and membership row locking for progression. Document and test lock ordering to avoid deadlocks. Queue candidates use SKIP LOCKED and nonblocking phone locks; DNC writes/admission serialize and recheck after waiting. Durable receipt keys are tenant scoped. Include simultaneous duplicate saves, simultaneous DNC, two-agent stale state, queue-claim-versus-DNC and A→B→A replay tests using independent PostgreSQL connections. No browser mutex is a substitute for these database guarantees.

## 9. Required test matrix

| Area | Required cases |
| --- | --- |
| Personal | DNC; configured Not Interested on/off; Save Only/Next; reload; stale loaded lead; filtering before pagination |
| Team | DNC; configured Not Interested; Save Only/Next; retain/release/failing release; never reclaim DNC |
| Open Pool | Same cases; two agents; one commits DNC while the other's UI is stale; no destination dispatch |
| Cross-campaign | Personal+Personal, Personal+Team, Personal+Open, Team+Open; duplicate master rows; same-org suppression; other organization unaffected |
| Normalization | US punctuation, +1, bare ten digits; international preservation; invalid input; existing canonical duplicates |
| Concurrency | Simultaneous DNC, claim race, stale queue, duplicate RPC, operation payload conflict, old replay after newer save, independent SKIP LOCKED throughput |
| Failure | DNC persistence, lookup/DB outage, advancement, release, workflow dispatch; no false success or fake attempt |
| Non-regression | No Answer; Callback including +5-minute manual window; Appointment; Sold/Convert cancel/success/retry; required notes; retry/max; exhaustion; hard claim; locks; caller ID; auto-dial; duration ownership |
| Security | Actual anon/authenticated/service roles; Active actor; spoofed org/actor/call/lead; direct lifecycle write rejection; helper/index EXECUTE; owner/search_path/ACL; webhook identity/destination |

Run `npx tsc --noEmit`, also compare `tsconfig.app.json` against the existing baseline (root check alone is insufficient). Run relevant Vitest suites and existing Team/Open queue/concurrency regressions. Use real PostgreSQL for concurrency, migration replay, rollback and actual-role writes. Record blocked/unrun checks honestly; never describe synthetic tests as live Twilio validation.

## 10. Migration and rollback

Create a new CLI-timestamped migration only. Check current applied history, definitions and ACLs before authoring/release. Include reviewed production provenance dependencies in the isolated test fixture without activating the withdrawn P2 reader/claim design. Rehearse against the production-derived schema and existing active history, documenting pre-existing replay drift separately. Apply forward twice as appropriate for defensive guards; verify intended function definitions and exact privileges after local replay. Run Supabase security/performance advisors read-only and record baseline/delta limitations.

Local rollback restores captured schema/functions and verifies replay in a disposable database. Production rollback is fail-closed: pause queue/admission, preserve suppression/receipts/history, and fix forward. Never restore unsafe browser grants or remove DNC records to recover availability. The production pause script is reviewable but not executed.

## 11. Production verification and approvals

After implementation, present exact migration hash, dependencies/preconditions, Edge package file list/hash, frontend commit, tests and residual blockers. Obtain separate explicit approval for the exact production migration, webhook deployment and frontend deployment. Recheck drift immediately before any approved operation. After an approved release verify definitions/ACLs, advisor delta, organization isolation, normalization, queue exclusion and controlled two-agent call behavior with separately authorized test records/calls. WORK_LOG receives a newest-first shipped entry only when actually shipped.

## 12. Historical cleanup (separate)

See `historical-repair-plan.md`. Prepare a read-only candidate query, normalized-phone provenance and ambiguous/missing-phone counts. No UPDATE/INSERT/DELETE of production operational data is approved. Durable prevention comes first; no repair is hidden in a schema migration.

## 13. Intended file manifest

Some files may need no change after implementation review; record omissions/additions in verification before handoff.

```text
AGENT_RULES.md
implementation_plan.md
docs/plans/2026-10-02-dialer-dnc-integrity/implementation_plan.md
docs/plans/2026-10-02-dialer-dnc-integrity/verification.md
docs/plans/2026-10-02-dialer-dnc-integrity/historical-repair-plan.md
src/pages/DialerPage.tsx
src/pages/CampaignDetail.tsx
src/pages/dialerCallGate.ts
src/lib/dialer-api.ts
src/lib/dialer-queue.ts
src/lib/queue-manager.ts
src/lib/dialer-disposition.ts
src/utils/dncCheck.ts
src/utils/phoneUtils.ts
src/lib/supabase-dispositions.ts (inspect; change only if canonical mapping requires it)
src/hooks/useDispositionPersistence.ts
src/hooks/useLeadLock.ts
src/hooks/useHardClaim.ts
src/hooks/useDialerStateMachine.ts
src/contexts/TwilioContext.tsx
src/components/layout/FloatingDialer.tsx
src/components/settings/DNCSettings.tsx
src/integrations/supabase/types.ts
supabase/migrations/<CLI-version>_dialer_disposition_dnc_integrity.sql
supabase/functions/twilio-voice-webhook/index.ts
supabase/functions/twilio-voice-webhook/dncGuard.ts
supabase/functions/twilio-voice-webhook/dncGuard.test.ts
supabase/rollback/dialer_dnc_integrity_local_restore.sql
supabase/ops/dialer_dnc_fail_closed.sql
src/lib/dialer-api-attempt-cap.test.ts
src/lib/__tests__/dialerDispositionPersistence.test.ts
src/lib/__tests__/queueManagerPersistence.test.ts
src/utils/__tests__/dncCheck.test.ts
src/pages/__tests__/dialerCallGate.test.ts
src/pages/__tests__/dialerAppointmentSave.test.tsx
src/pages/__tests__/dialerDispositionIntegrity.test.tsx
src/contexts/__tests__/twilioOutboundDnc.test.tsx
src/contexts/__tests__/twilioProviderLifecycle.test.tsx
src/components/layout/__tests__/floatingDialerDisposition.test.tsx
supabase/tests/dialer_dnc_harness.sql
supabase/tests/dialer_dnc_fixtures.sql
supabase/tests/dialer_disposition_dnc.sql
supabase/tests/dialer_dnc_security.sql
supabase/tests/dialer_dnc_concurrency.sql
scripts/run_dialer_dnc_tests.sh
e2e/team-open-local/scenarios.mjs
.github/workflows/dialer-dnc-backend.yml
WORK_LOG.md (only after shipping)
```
