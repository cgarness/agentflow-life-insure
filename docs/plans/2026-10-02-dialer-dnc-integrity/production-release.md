# Production release — 2026-10-02 PDT / 2026-10-03 UTC

Chris explicitly requested production deployment and testing with real agents, accepting the remaining isolated-stack and historical-replay gaps. This authorizes the coordinated release, not historical operational-data repair. No direct push to main was used.

## Actions completed

Project: `jncvvsvckxhqgqvkppmj` (AGENTFLOW CRM).

| Action | Actual production identifier |
| --- | --- |
| Pre-release activity check | 04:26 UTC: zero active calls and zero fresh dialer sessions |
| Temporary outbound pause | `20261003042846_dialer_dnc_release_pause` |
| Permanent disposition / DNC migration | `20261003043122_dialer_disposition_dnc_integrity` |
| Voice webhook | `twilio-voice-webhook` v36 ACTIVE; existing `verify_jwt=false` and Twilio HMAC validation preserved |
| Application merge | PR #402, `e5c15f7f46a8d569a430f7ec237b854e2f319fe3` |
| Primary production deployment | `dpl_5Fi4pHTHBva1cSyLgtHUjvdT5zeH`, READY, aliases include `www.fflagent.com` and `fflagent.com` |
| Second production project | `dpl_EaedHK1RsC6JEWjb14CZ1zfH8qyG`, READY, `agentflow-life-insure.vercel.app` |
| Authenticated call creation resumed | `20261003043738_dialer_dnc_release_resume` |

Both frontend deployments report the exact merged commit. The follow-up release-record PR changes documentation and migration bookkeeping only; no application runtime behavior changes.

The authored permanent migration filename was renamed from `20261003022218` to the actual applied `20261003043122` timestamp. Its SQL bytes remain unchanged: SHA256 `d83999fffeda22dd36b0bb027d7bc0ee56f8b85affc1f3b706ab06d978ad7e3a`. Pause and resume SQL are recorded under their actual applied timestamps. Historical pre-release comments inside the immutable SQL are retained; this record establishes applied status. Never re-execute these migrations manually on production.

## Verification

- The migration's live precondition fingerprints matched before execution. All 20 resulting function definitions, owners, search paths and ACLs matched `expected-functions.json` exactly. Metadata was inspected again after resume.
- Webhook v35 was read before deployment and matched main. Both v36 source files were read back exactly: `index.ts` SHA256 `54b141050de84aa4f322a7a1723c9e5b4fea9dac8a80166c4f8c3ed4da1cd23a`; `dncGuard.ts` SHA256 `f0ea6630baee5ca8f006a9e8d7d8ddd07ed052a6c2764ccd166f8207dd81ea0c`.
- `https://www.fflagent.com` and its `/assets/index-Ca4k9eOT.js` bundle returned HTTP 200. An unsigned POST to the voice webhook returned HTTP 403; no real call was placed.
- After resume, authenticated `calls` INSERT is true; anon INSERT remains false. The old disposition signature and unsafe anonymous access were not restored.
- Production normalization of `(555) 123-4567`, `+1 555 123 4567` and `5551234567` consistently returned `15551234567`.
- DNC CI run **37095891491**, job **111125620673**, passed: 37 files / 465 focused tests plus PostgreSQL 16.15 behavioral/security matrix, independent-connection concurrency, migration replay rejection and local restore/reapply metadata equality. Root `npx tsc --noEmit` and production build passed.
- Reports CI run **37095891229**, job **111125737047**, failed at `assert type_errors('base') == type_errors('branch')`. Local semantic diagnostic comparison found 88 existing app errors versus 90 on main, zero new errors. No CI gate or comparator was disabled. The broad suite is not green; detailed baseline failures remain in `verification.md`.

No authenticated browser smoke or successful real Voice.js call is claimed. Full Supabase/browser Team/Open regression, complete historical migration replay and live-agent call/conversion behavior remain unverified. Chris selected production testing with agents for these remaining gaps. The unrelated applied inbound migration `20261002203426` is still absent from repository history; it was not reconstructed or changed here.

## Post-migration advisors

| Advisor | Before | After |
| --- | ---: | ---: |
| RLS enabled without policy | 3 | 6 |
| Mutable function search path | 22 | 22 |
| Public tables with RLS disabled | 2 | 2 |
| Extensions in public | 3 | 3 |
| Anon-executable SECURITY DEFINER | 65 | 59 |
| Authenticated-executable SECURITY DEFINER | 99 | 103 |
| Leaked-password protection | 1 | 1 |
| Unindexed foreign keys | 75 | 75 |
| RLS initplan | 109 | 109 |
| Unused indexes | 124 | 125 |
| Multiple permissive policies | 86 | 86 |
| Duplicate indexes | 5 | 5 |
| Table bloat | 1 | 1 |
| Absolute auth DB connections | 1 | 1 |

The three added no-policy findings are intentional private tables: `dialer_conversion_lineage`, `dialer_disposition_receipts`, and `dialer_outbound_admissions`; they expose no browser API privileges. The narrow authenticated RPCs validate actor/organization internally; exact ACLs are pinned in the function manifest. Existing unrelated advisor findings remain unresolved. A fresh index being reported unused immediately after release is expected; this is not evidence of measured production performance.

## Live-agent validation and recovery

Agents must refresh every CRM tab before dialing; stale clients cannot use the old write path. Validate ordinary calling, No Answer, Save Only/Next, callbacks and conversion, then configured DNC in Personal, Team and Open Pool. Have a second agent with an already-loaded matching phone verify refusal across campaigns; repeat with duplicate lead records and phone formats. Check lock release/retention and configured Not Interested behavior. Do not change another tenant's records for testing. No test fixtures, live calls, outbound messages or historical repairs were created by this release task.

On a material calling or suppression failure, pause new outbound calls and fix forward using the reviewed fail-closed operations package. Preserve DNC, history and receipts. Never run the localhost inverse against production or revert to an unsafe disposition/queue path. A DNC commit blocks later admission; an already-admitted call is not retroactively terminated.

No additional approval is needed for the release already performed. Historical repairs still require Chris's approval of the exact organization/phone list and DML. `historical-repair-plan.md` and the read-only candidate query remain separate and unexecuted.
