# Permanent disposition / DNC fix — implementation handoff

Status: SHIPPED 2026-10-02 PDT / 2026-10-03 UTC under Chris's approval to release and validate with real agents. See [production-release.md](production-release.md) for the authoritative release record. The implementation/test evidence below is retained; pre-release descriptions do not imply the release remains pending. Historical repair was not performed.

## Confirmed root cause

Production's six-argument `advance_campaign_lead` advances one campaign membership without atomic organization-wide DNC persistence. DialerPage separately inserts DNC, which an ordinary Agent's RLS rejects, then can continue as though the save succeeded. Team/Open selection lacks normalized-phone suppression; Personal loading takes a separate browser path. Duplicate memberships/master leads therefore remain eligible. DNC verification could fail open. Queue removal followed by an array-index update could mutate the next lead.

The authoritative sources were read fully before implementation: AGENT_RULES.md, VISION.md, all 12,536 original WORK_LOG lines, and the new main entries/documents added during this task. Live function bodies, ACLs, owners, schemas, indexes, RLS, trigger definitions, deployed voice webhook and actual applied migrations were inspected rather than inferred from disk.

The final read-only refresh still found these live pre-migration fingerprints:

| Function | `md5(pg_get_functiondef(...))` |
| --- | --- |
| `advance_campaign_lead(uuid,uuid,uuid,timestamptz,text,boolean)` | `b857ea1abdf075d361f68656bba31a24` |
| `get_next_queue_lead(uuid,jsonb)` | `8bc7ec6830c9b3374c6b7bea1fd1a38e` |
| `get_queue_metrics(uuid)` | `7a9aedc3802d550709bdbf1004b1ee50` |

Queue/association provenance migrations `20261002184930` and `20261002184954` are now on main. The applied inbound routing migration `20261002203426` is still absent from the repository; full-history reconciliation remains outstanding, accepted by Chris for this live-validation release. PR #401's actual display-only Team change is preserved. The earlier P2 reader/claim proposal is withdrawn and is not activated here.

## Architecture implemented

- One `advance_campaign_lead` transaction resolves the organization's actual disposition UUID and writes call disposition, notes/history, campaign attempts/retry/callback/status, configured DNC, applicable hard claim and requested release. Operation receipts, per-call uniqueness, `last_advance_call_id` and membership versions reject conflicting/stale saves and prevent double advancement. No-call dispositions and Personal skips create no artificial call attempt.
- DNC lookup and new insertion use tenant-scoped canonical phone keys and organization+phone transaction locks. Existing canonical duplicates remain intact; a nonunique lookup index plus a forward uniqueness trigger handles new writes without historical cleanup. US formatting variations normalize consistently; explicit international prefixes are preserved.
- The existing Team/Open RPC retains `FOR UPDATE SKIP LOCKED`, callback ordering, retry/max-attempt rules, hard claims, licensing, permissions, agent suppressions and queue provenance. It excludes DNC before selection, skips contended phone locks, and rechecks before returning. Personal uses an owner-scoped RPC with filtering before pagination; master detail enrichment still obeys existing RLS.
- Voice.js still starts through `device.connect()`. The provider reserves its existing reentrancy guard before awaiting a fail-closed DNC check. An insertion guard closes the preflight-to-call-row race. The HMAC-validated voice webhook performs service-only admission before destination `<Dial>`; it binds the stored call, trusted Twilio identity, destination and authorized caller ID. No REST outbound dialing, SIP bridge or second-leg architecture was added. No browser or disposition writer was added for `calls.duration`.
- Disposition UI applies persisted results by stable membership ID and visit generation. Failure retains the draft/lead/appropriate lock, pauses auto-dial and reports no success. Save & Next waits for confirmed release. Conversion keeps its modal gate, actual conversion transaction, original membership lineage, converted client ID and retry behavior. Callback/appointment shadows remain nonfatal after core persistence.
- FloatingDialer uses the same authoritative path. Its ended-call identity and failed-save draft survive; conversion completes before disposition. The Team/Open attempt hook handles React batching without confusing a newly created Voice.js Call with the previous call.
- The new Team display behavior survives the integration: a confirmed lock shows details; lock loss masks them. An unsaved draft is retained, while a no-draft loss follows the existing next-lead recovery.

**Concurrency boundary:** DNC commit and signed outbound admission serialize on the same tenant/phone lock. If DNC commits first, admission cannot return destination Dial. If admission committed first, the already-admitted in-flight call is not retroactively terminated. Browser failures before call creation start neither Twilio nor a fake attempt. A later service admission failure is withheld from campaign attempt advancement.

## Security / RLS impact

No broad Agent DNC INSERT grant was added. The core derives the Active actor and organization from database-backed authorization and checks dial permission, own call, membership, version, and shared queue-issued lock. Private receipts/admissions/lineage have mandatory tenant identity, RLS enabled and no API grants. Modified SECURITY DEFINER functions have postgres ownership, fixed `pg_catalog, pg_temp` search paths and explicit PUBLIC/anon revocation. Only service_role can admit Twilio outbound; authenticated callers receive narrow actor-validated RPCs. The normalizer's index-expression EXECUTE grant is intentional and exercised by actual authenticated writes.

Invoker guards prevent stale browsers from directly advancing membership or assigning call dispositions/identity. New campaign call contact identity is derived from membership. Standalone contact references must be visible through existing invoker RLS in the same organization; browser updates cannot replace that lineage. Contact metadata editing and provider telemetry remain compatible. Admin force release never changes DNC/terminal status. Workflow dispatch exceptions are isolated from core writes, including injected failures of the existing workflow triggers.

## Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS; root project does not itself typecheck application files |
| `npx tsc --noEmit -p tsconfig.app.json` | 88 existing errors vs 90 on unchanged current main; **zero new diagnostics**, two old useLeadLock errors resolved |
| `npm run build` | PASS after main integration (13.85s); existing large-chunk warning |
| Focused Vitest, synthetic localhost config | **37 files / 465 tests PASS**, no unhandled errors |
| Full Vitest vs unchanged current main | Branch: 249 files pass / 12 fail; 3978 tests pass / 3 fail / 32 skip. Main: 245 files pass / 12 fail; 3934 tests pass / 1 fail / 32 skip. Details below |
| PostgreSQL 16.15, independent connections | PASS: behavioral/security/matrix suites and real concurrency |
| Forward migration with legacy canonical duplicates | PASS; rows preserved, normalized reads suppress them |
| Repeat migration | Correctly refuses changed precondition, without partial replay |
| Local restore, reapply, definition/owner/search_path/ACL comparison | PASS; exact manifest equality |
| Fail-closed recovery script on local fixture | PASS; admission/preflight sealed, DNC records preserved |
| Existing Team/Open isolation harness self-tests | 30 PASS; these are mocked isolation checks, not a browser/backend run |
| Supabase advisors | Post-migration advisors inspected; exact count delta recorded in production-release.md |

The unconfigured full-suite run has 10 existing collection failures (missing Supabase test environment) and the same existing recording-retention byte-fixture failure on both revisions. Main has one additional existing Dialer API collection failure resolved by the new mock. The branch's two additional FullScreenContactView failures followed a 5-second timeout during concurrent full-suite execution; the unchanged file passes all 11 tests on a focused rerun (6.49s). This supports a timing/cleanup flake, not a demonstrated product regression; the full run is still **not reported as green**. Neither revision emitted an unhandled-error summary in this comparison. No unrelated tests or timeouts were modified to obtain a pass.

Focused command (the new CI workflow uses the same patterns):

```sh
VITE_SUPABASE_URL=http://127.0.0.1:9 VITE_SUPABASE_ANON_KEY=synthetic_test_only \
npx vitest run dialer twilio teamOpen teamCampaign dncCheck useTeamOpen \
  caller-id-selection convertLeadModalPolicyFields leadDisposition outboundPathPinned
```

Database reproduction requires a disposable localhost PostgreSQL cluster and `psql`:

```sh
PGURL=postgresql://postgres:LOCAL_TEST_PASSWORD@127.0.0.1:5432 \
  bash scripts/run_dialer_dnc_tests.sh
```

The runner refuses non-loopback URLs, database/query/fragment overrides and hosted Supabase platform roles; it creates and removes a uniquely named synthetic database. `postgres-verification.txt` records the final successful run. `expected-functions.json` contains only definition fingerprints and security metadata, not operational data. Its identical reapply manifest was compared with `cmp`.

### Matrix coverage and limits

| Required area | Executed evidence |
| --- | --- |
| Personal DNC, configurable NI on/off, Save Only/Next, reload | Database behavioral/matrix suites; stable-ID queue and mounted save tests |
| Team/Open DNC, NI on/off, Save Only/Next, lock retention/release, never reclaim | Explicit 12-case SQL matrix plus failure injection and mounted UI tests |
| Personal+Personal, Personal+Team, Personal+Open, Team+Open; duplicate masters | Same-phone membership fixtures exercise all four paths; tenant-B control remains eligible |
| Stale UI / second agent | Provider refuses on DNC/outage before call insertion/connect; independent PostgreSQL admission waits for the racing DNC then refuses |
| Formatting / duplicate DNC | JS/SQL normalization tests, legacy duplicate upgrade, concurrent insert serialization |
| Duplicate RPC / A→B→A / queue races | Independent connections; same-call replay; stale Personal receipt rejection; contended phone skip and real row SKIP LOCKED |
| DNC persistence / workflow / advancement / release failures | Transaction failure injection proves rollback or workflow isolation; mounted UI retains draft and lock; initial and replay release failures rejected |
| Callback / appointment / conversion | Timezone, one shadow write/refresh, required notes, cancellation and conversion retry; actual conversion RPC/FK SET NULL exercised in PostgreSQL |
| Other non-regressions | Retry/max attempts, manual callback window, exhaustion, licensing, hard claim, caller ID, Team visibility, provider reentrancy/auto-dial and duration source checks |

**Remaining verification limits accepted for live validation:** full existing Docker/Supabase/Playwright Team/Open harness, complete historical Supabase migration replay, signed real Voice.js/Twilio calls and end-to-end agent UI behavior. Docker was unavailable locally. The focused PostgreSQL fixture does not recreate every association or contact policy. Corrected DNC CI run 37095891491 passed all 465 focused tests plus real PostgreSQL concurrency, replay and ACL checks. Reports CI run 37095891229 failed its exact base/branch TypeScript diagnostic equality assertion; local semantic comparison found 88 existing diagnostics versus 90 on main, with zero new diagnostics. The broad suite is not green and is not represented as such. Production package readback, public frontend HTTP smoke, unsigned-webhook rejection, normalization, grants and function metadata verification passed; these are not a substitute for a real call.

## Migration, release and rollback package

New migration only: `supabase/migrations/20261003043122_dialer_disposition_dnc_integrity.sql`. No applied migration was edited. `release-sha256.txt` pins the migration, both voice webhook files and both operational scripts. The full voice package is `index.ts` plus `dncGuard.ts`; deploy both together only after exact approval and re-reading the live function per AGENT_RULES.

Original coordinated release procedure (executed under Chris’s later live-validation approval; actual timestamps and accepted gaps are recorded in production-release.md):

1. Complete the missing isolated-stack/replay gates and review existing baseline failures. Recheck actual main, production migration history, the three precondition fingerprints, dependencies, function/table ACLs, and live webhook version/body. Stop on drift.
2. Obtain Chris's explicit approval for `dialer_dnc_release_pause.sql`, the exact migration hash, the exact two-file voice package/verification settings, the frontend commit and final resume action. This includes the temporary outbound/disposition pause; historical operational-data repair is excluded.
3. During the approved window, capture actual ACLs and execute the release pause before changing versions. Existing calls/provider callbacks continue. New browser call INSERT and the legacy disposition signature are sealed while DB/webhook/frontend versions change.
4. Apply only the approved migration; compare `dialer_dnc_metadata.sql` output with `expected-functions.json`; inspect table grants/RLS and advisor delta. Deploy the approved webhook and frontend while call INSERT remains paused. Old tabs fail closed and require reload.
5. Only after every approved verification gate passes, resume with the separately approved `GRANT INSERT ON public.calls TO authenticated;` and verify fresh and stale clients. Controlled records/calls and their cleanup require their own exact authorization. Append a newest-first shipped WORK_LOG entry only after shipment.

Production rollback is **pause and fix forward**, preserving DNC, receipts and history. `supabase/ops/dialer_dnc_fail_closed.sql` seals queue/preflight/admission. The inverse SQL under `supabase/rollback/` is explicitly guarded for localhost `dnc_test_*` databases and restores unsafe old definitions only in that disposable test fixture; never use it in production. Reverting the frontend alone cannot reopen dialing: the server gate remains authoritative.

## Historical cleanup

No records repaired. `historical-candidates.sql` is an organization-bound read-only review query, prepared but not run against production. It prefers the original call phone, flags missing/changed phone evidence and identifies peer memberships. Current Not Interested configuration cannot prove historical intent. `historical-repair-plan.md` requires an explicit reviewed organization/phone list and Chris's exact approval before any repair DML. Historical contacts, memberships, calls, dispositions and reporting lineage remain preserved.

## Context snapshot / next action

Changes: one canonical disposition transaction, tenant/phone suppression at every queue and outbound boundary, stable-ID frontend lifecycle, narrow write guards and real PostgreSQL tests. Decisions: configuration wins over names; no broad Agent DNC insertion; preserve duplicate history; single-leg Voice.js and Twilio duration ownership; fail closed on unknown admission; retain current Team display scope. Migration/deployments: permanent migration 20261003043122 applied between tracked pause/resume migrations; webhook v36 and frontend e5c15f7 shipped. Remaining validation: real agents, full-stack harness and historical replay. Next: refresh CRM tabs and validate Personal/Team/Open disposition and cross-campaign suppression with real agents. Historical repair remains separately gated.

## Actual changed files

The manifest below is relative to current main, including supporting tests and review artifacts. `src/lib/supabase-dispositions.ts`, `useDialerStateMachine.ts`, `ConvertLeadModal`, `e2e/team-open-local/scenarios.mjs`, existing applied migrations and WORK_LOG were inspected but not changed by this task. Planned test names were consolidated into the files below; webhook helper tests live in Vitest so they run with the app suite. The Team/Open call-binding fix is in `useTeamOpenDialSession.ts`.

```text
.github/workflows/dialer-dnc-backend.yml
AGENT_RULES.md
docs/plans/2026-10-02-dialer-dnc-integrity/advisors-baseline.json
docs/plans/2026-10-02-dialer-dnc-integrity/expected-functions.json
docs/plans/2026-10-02-dialer-dnc-integrity/historical-candidates.sql
docs/plans/2026-10-02-dialer-dnc-integrity/historical-repair-plan.md
docs/plans/2026-10-02-dialer-dnc-integrity/implementation_plan.md
docs/plans/2026-10-02-dialer-dnc-integrity/postgres-verification.txt
docs/plans/2026-10-02-dialer-dnc-integrity/release-sha256.txt
docs/plans/2026-10-02-dialer-dnc-integrity/verification.md
implementation_plan.md
scripts/run_dialer_dnc_tests.sh
src/components/layout/FloatingDialer.tsx
src/components/layout/__tests__/floatingDialerDisposition.test.tsx
src/components/settings/DNCSettings.tsx
src/contexts/TwilioContext.tsx
src/contexts/__tests__/teamOpenRevealIntegration.test.tsx
src/contexts/__tests__/twilioProviderLifecycle.test.tsx
src/hooks/useDispositionPersistence.ts
src/hooks/useHardClaim.ts
src/hooks/useLeadLock.ts
src/hooks/useTeamOpenDialSession.ts
src/integrations/supabase/types.ts
src/lib/__tests__/outboundPathPinned.test.ts
src/lib/dialer-api-attempt-cap.test.ts
src/lib/dialer-api.ts
src/lib/dialer-disposition.test.ts
src/lib/dialer-disposition.ts
src/lib/dialer-queue.ts
src/lib/queue-manager.ts
src/lib/twilio-dnc-admission.test.ts
src/pages/CampaignDetail.tsx
src/pages/DialerPage.tsx
src/pages/__tests__/dialerAppointmentSave.test.tsx
src/pages/__tests__/dialerAppointmentSaveContract.test.ts
src/pages/__tests__/dialerCallGate.test.ts
src/pages/__tests__/dialerTeamOpenWiring.test.ts
src/pages/dialerCallGate.ts
src/utils/dncCheck.test.ts
src/utils/dncCheck.ts
src/utils/phoneUtils.ts
supabase/functions/twilio-voice-webhook/dncGuard.ts
supabase/functions/twilio-voice-webhook/index.ts
supabase/migrations/20261003043122_dialer_disposition_dnc_integrity.sql
supabase/ops/dialer_dnc_fail_closed.sql
supabase/ops/dialer_dnc_release_pause.sql
supabase/rollback/dialer_dnc_integrity_local_restore.sql
supabase/tests/dialer_disposition_dnc.sql
supabase/tests/dialer_dnc_concurrency.sql
supabase/tests/dialer_dnc_fixtures.sql
supabase/tests/dialer_dnc_harness.sql
supabase/tests/dialer_dnc_matrix.sql
supabase/tests/dialer_dnc_metadata.sql
supabase/tests/dialer_dnc_security.sql
supabase/tests/dialer_dnc_upgrade.sql
```
