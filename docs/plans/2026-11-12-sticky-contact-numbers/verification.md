# Sticky Contact Numbers — verified isolated candidate

November 14, 2026. Source commit `a57ea11168fff51156b8d624b4966c10869d8dcd`; base `2129fa8b195cee77ad75f614abe655facfad2725`. Production and publication remain held.

## What is implemented

Phases 1–5 are implemented: persistent agency/normalized-endpoint voice and SMS identities; immutable sender binding in the existing dispatch ledger; current readiness checks separate from identity; legacy package protection; reviewed customer-leg outbound qualification and separate signed/claimed inbound qualification; late evidence recovery; shared controls in the three real messaging surfaces including an actual Dialer SMS composer; channel-specific and one-time choices; deleted-number retention; bounded reconciliation and protective rollback.

Twilio remains browser Voice.js `device.connect()` through the existing wrapper. Original admission, inbound ingestion/claim and dispatch function bodies are retained behind narrow wrappers. Existing status, canonical duration, dispositions, recordings, re-entrancy and queue locks remain covered by original-body, SDK-lifecycle, native admission and browser regression checks. No provider call/text was made.

The prerequisite is reconstructed, not recovered from Claude's missing `d070707`. The exact already-applied sources `20261002203426` and `20261113152433` were restored under their historical identities. They must never be replayed in production. Nine supplied hashes and six independently captured deployed source packages were verified. Eight live/main source differences were inspected; current guards and older package compatibility were retained, with neither PR #429 nor #444 imported.

## Measured checks

| Check | Actual result |
|---|---|
| Fresh native PostgreSQL baseline | 85 function and 45 table catalog comparisons, zero differences |
| Native database/role/race/recovery suite | 52 scenarios passed, including actual authenticated/anon/service roles and existing RLS |
| Generated release transaction | Preimage-drift rollback, four exact history entries, schema/security postimages, all-org-off state and duplicate-install refusal rehearsed |
| Edge integration | Five suites passed through actual local PostgREST and Deno; captured provider payload compared with stored From/account/service |
| Deployed package compatibility | All four actual deployed outbound dispatchers tested; current and deployed confirmation worker entrypoints tested; ClearPath exemption remained narrow |
| Existing SMS Edge regression | 20 passed |
| Browser | Eight real-component Chromium flows passed; three screens generated three local synthetic receipts with the same sender; reload/session/cache/mobile/View As/focus checked |
| Existing dialer browser regression | Rapid Skip, queue reorder/URL ownership, stale Call, drafts and calling-hours regression passed |
| Focused unit / compatibility | 140 focused tests passed; expanded 127 compatibility tests passed |
| Full Vitest | Base 7,164 passed / 3 failed / 8 pending of 7,175; candidate 7,170 passed / 1 failed / 8 pending of 7,179; zero new failing assertions |
| Environment-dependent test file loading | Same eight files fail to load with `supabaseUrl is required`; neither full suite is clean |
| Root TypeScript | `npx tsc --noEmit`: exit 0 |
| Application TypeScript | `npx tsc --noEmit -p tsconfig.app.json`: exit 2, exactly the same 78 base diagnostics after line-number normalization; no new diagnostics |
| Scoped ESLint | Both base and candidate: 0 errors, 18 warnings |
| Five changed Edge entrypoints | Deno typecheck passes, with the dependency substitution below |
| Production Vite build command | Pass; existing chunk-size warnings. Build uses synthetic loopback configuration and is not a deployable production asset |
| Git whitespace | `git diff --check` passes |

The one remaining failing assertion is `src/lib/__tests__/recordingRetentionVoicemail.test.ts`: retained v29 source equality, already failing on the exact base. Two base Full Contact save-test failures passed on the candidate run. All eight load failures and complete test identities are in `evidence/regression-comparison.json`. Attempts using synthetic Vite environment values hung on both base and candidate and were interrupted (130); those logs are retained. The completed full comparison uses the repository's default environment with network blocked and four workers. Existing fixtures were updated only to supply explicit off-mode affinity responses; their original behavior assertions remain. The old Reports-only Twilio hash was updated for this separately authorized scope, alongside preserved behavior checks.

## Performance

The final fixture contains 50,000 contacts **and stored endpoint assignments** in one agency, plus 5,000 in a second agency. Both agencies have isolated policy/readiness/number records. Actual service-role transactions compare the old prepare contract with the new bound prepare contract. Five warm batches of 100 distinct endpoints follow a separately recorded cold connection-pool batch.

| Measurement | Exact-base ms | Candidate ms | Added ms |
|---|---:|---:|---:|
| Warm serial p95 (120 requests) | 3.76 | 5.53 | 1.77 |
| Warm distinct-recipient p95 (500 requests, 100 concurrent) | 52.90 | 145.90 | 93.00 |
| Warm mixed-agency p95 (100 concurrent) | 52.15 | 74.44 | 22.29 |
| Same-recipient p95 (100 concurrent) | 153.57 | 427.95 | 274.38 |
| Cold connection-pool p95 (100 concurrent) | 360.89 | 739.23 | 378.34 |

The required added warm distinct-recipient p95 target is ≤150 ms; final added p95 is **93.00 ms**. Mixed-agency added p95 is 22.29 ms; serial added p95 is 1.77 ms. Same-recipient operations deliberately serialize: 100 distinct messages retain one sender. Their latency and cold pool costs are reported separately, not represented as meeting a 150 ms total-latency target. Indexed endpoint plans are saved in performance.json. Earlier contact-only runs are retained as earlier evidence, not mislabeled as 50,000 assignments.

This is isolated capacity evidence, not a production throughput guarantee. Recovery processes at most 20 changed calls per normal request and commits progress before refusing further communication if more remain; the 25-call test proves this. Detecting changed fingerprints still examines that endpoint's indexed call history. Arbitrarily large per-endpoint history is not a strict 20-row read bound, and was not load-tested at production extremes. Reconciliation returns ≤500 endpoints per batch but its union/cursor search can scan more underlying rows. These limits must be included in rollout monitoring, not hidden behind “bounded.” No agency-wide communication lock is taken.

## Security and isolation

PostgreSQL 17.6 and PostgREST 14 run on loopback only. Deno 2.5.2 and Chromium headless shell 141 use synthetic sessions and provider responses. External requests are rejected by the test transports; browser requests are limited to localhost. Platform-only auth/storage, inert cron metadata and a throwing HTTP extension stand in for hosted platform services. Real contact authorization/RLS, call evidence, ledger, functions and grants are replayed, not replaced by permissive stubs. Production repair/activation statements are excluded. The three extra as-applied Reports/Fidelity/carrier captures complete the native baseline without widening historical repository edits.

The offline import map resolves remote Supabase SDK imports to installed npm 2.98.0 (including the captured 2.49.1 import). This is explicit test dependency substitution; it is not proof of the hosted provider's compiled dependency bundle. The deployment source packages retain original external import URLs and no test import map. A later authorized deployment must re-fetch complete live packages and validate the actual bundle/environment.

Official Supabase Splinter advisor SQL was executed read-only against baseline and candidate. Latest delta: **zero new ERROR**, six authenticated SECURITY DEFINER warnings, eleven private RLS/no-policy informational findings and three unused-index informational differences (including statistics-dependent existing indexes). The six exposed APIs validate the actual actor/contact scope; the special scope owner is NOLOGIN, NOBYPASSRLS and inherits existing authenticated RLS. Direct private/table access is revoked. Actual role tests cover hidden/foreign contacts, shared endpoints, Team Leader downline, Admin and forged call contexts. No human-independent sign-off is claimed. Unrelated `app_config` / `webhook_debug_log` findings were left alone. `supabase db lint` was attempted but could not negotiate TLS with the local native server; that command did not pass and is not substituted for the advisor result.

## Remaining boundaries

- Production deployment, live advisors/readbacks, authorized recipient calls/texts and activation are unexecuted and require separate exact approval.
- Publication is held: both Vercel projects link this repository, and environment metadata inspection returned 403. Preview isolation/automatic deployment behavior must be verified before any push or PR.
- The current base has no merge workflow. Conflicting duplicates and phone edits are tested; future merging must retain distinct endpoint history and require conflict review. No merge feature is added.
- Legacy packages can refuse a stale candidate safely; they cannot be forced to transparently send from a new bound number because their serialized From was chosen earlier. Do not interpret safe refusal as old-client UX parity. The updated dispatcher returns accepted receipts before mutable readiness and never retries uncertain sends.
- Old historical voice records without trustworthy override provenance require review; no bindings are fabricated. Existing confirmation wording remains limited to its already-approved CG Financial template. Neither is broadened by this feature.
- The first schema migration creates ordinary indexes with a 3-second lock timeout and 60-second statement timeout. Production relation sizes and a suitable install window must be reviewed. A timeout stops the transaction; it is not permission to remove the bound or silently switch migration strategy.

## Proposed repository invariant (not applied)

Proposed narrow AGENT_RULES addition for a later approved documentation update: “For an organization that has ever enabled sticky numbers, customer communications must retain a server-bound endpoint identity through retries, readiness changes and rollback. Never clear durable enforcement, deleted-number snapshots or unresolved dispatch evidence to restore legacy fallback. Re-fetch complete live packages separately before changing shared Edge contracts.” No existing rule was changed in this build.

## Context snapshot

Changes: complete isolated implementation, source closures, migration/history transaction, recovery and verification artifacts. Decisions: stable endpoint identity; current readiness checked at handoff; keep uncertain sends and review states conservative; preserve old consumers and original call architecture. Migrations/deployments: local only. Verification: results and limitations above, all 88 IDs retained in ACCEPTANCE_TRACKER.md. Blockers: publication isolation, hosted review and explicit production/pilot scope. Next: review the single frozen release packet, clear its prerequisites, then obtain exact production authorization. No background work or live success is implied.
