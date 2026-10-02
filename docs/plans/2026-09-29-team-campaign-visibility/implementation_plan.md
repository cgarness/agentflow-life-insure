# October 2 staged production release update

Chris approved release at 11:47 LA. P1 and P1B are applied and verified as
20261002184930 and 20261002184954, exact SQL bytes unchanged. P2 and frontend release are
BLOCKED by explicit legacy review: 347 home-agency associations (four eligibility conflicts)
and 472 other-agency associations need their authorized managers. No business backfill,
forced unlock, ownership repair, actor impersonation, PR merge or frontend deploy performed.
Detailed postconditions and private bounded review artifact are recorded in the release design.
The original build record below is retained as history.

# Team campaign lead visibility

## Authority and current status

Chris requested full Team lead details with the same locking logic on September 29. On October 2,
2026 (America/Los_Angeles), he instructed: “I want you to start the build and complete the task.”
This and the subsequent “Start the next steps and complete the task” authorize the coordinated backend/frontend branch build and isolated verification. Production application remains separately gated under invariant #28.

Original base: `main` at `5fc4649f45a323c1ddc0863ffb4ec7fd0bb3f326` (Dialer appointment writer fix).
Rebased without conflicts onto `e04eb16dc6fc70734f85868ab5235186d0ce4813` (Reports privacy fix)
before handoff; the new main changes do not touch the Team display/lock/telephony files.
Merged `main` at `b630bf0ba5c5b3cb166252ca59ed3284f3e3db2d` after its concurrent Reports release
record landed. Preserved both Work Log/plan entries and all release fixes/renames; no Team runtime
file changed in that main update. This resolves the documentation conflicts that prevented a new CI run.
Branch: `codex/team-campaign-lead-visibility`.
Status: frontend implemented, verified and published in draft PR #401:
https://github.com/cgarness/agentflow-life-insure/pull/401. No production writes or deployments.
The subsequent “Start the next steps and complete the task” authorizes the coordinated backend/frontend branch build and isolated verification, now implemented. Exact production application remains gated under invariant #28; see full-record-access-design.md for the staged release and recovery.

Read: AGENT_RULES.md, VISION.md, the latest WORK_LOG.md, the existing root plan, the September 24
authorization findings, DialerPage, LeadCard, the Team/Open field/master/edit/reveal paths,
useLeadLock/useHardClaim, and current TwilioContext. No AGENTS.md is present in the repository tree.

## Approved behavior

- Show every populated, already-authorized field for the current Team lead once the canonical
  queue load confirms this agent's lock. Show it before dialing, during ringing, and after no answer.
- Reuse the existing field resolver and card: preserve field order, saved imported/custom values,
  0/false, empty-field filtering, and internal-key exclusions.
- Team presentation is independent from outbound-attempt state. Editing, conversion, hard claim,
  dispositions, and queue behavior continue using their existing gates.
- Keep Personal and Open Pool behavior. Do not add a Team queue browser or a manual pick/claim path.
- Immediately mask details on advancement, lock loss, or viewer/organization/campaign changes.
  An old load or A → B → A completion must not revive a previous visit's display permission.
- An unreadable master row still shows only its authorized campaign copy and a truthful notice.

## Files listed before edits

- `src/pages/DialerPage.tsx`: connect the new display hook to the existing successful queue load and card.
- `src/components/dialer/LeadCard.tsx`: optional Team-only presentation override; no action authorization.
- `src/lib/teamCampaignLeadVisibility.ts`: pure identity/context predicate.
- `src/hooks/useTeamCampaignLeadVisibility.ts`: display-only visit/generation tracking. This extraction
  is needed to keep stale loads from revealing a different visit and keep feature logic out of DialerPage.
- `src/hooks/__tests__/useTeamCampaignLeadVisibility.test.tsx`: stale starts/finishes, scope masking, and loading.
- `src/components/dialer/__tests__/teamCampaignLeadCard.test.tsx`: real card/field rendering before a call.
- `src/pages/__tests__/dialerAppointmentSave.test.tsx`: extend the existing real DialerPage harness
  for Team display/action/lifecycle checks instead of duplicating its process-boundary mocks.
- `src/pages/__tests__/dialerTeamOpenWiring.test.ts`: keep its existing edit contract accurate.
- `src/components/dialer/TeamOpenLeadDetails.tsx`: update the display documentation only.
- `src/contexts/__tests__/teamOpenRevealIntegration.test.tsx`: supply the missing SDK-wrapper
  audio lookup in its inert mock; the base branch reproduces an unhandled rejection without it.
- Existing Team/Open tests only if a test contract requires an additive update.
- This scoped implementation plan, root `implementation_plan.md` (additive pointer), and newest-first WORK_LOG entry.
- `docs/plans/2026-09-29-team-campaign-visibility/full-record-access-design.md`: separate review
  draft for the access dependency; specifications only, no backend implementation or command.
- CI follow-up listed before edits: `scripts/verify_reports_frontend.py`,
  `scripts/frontend_runtime_error_compare.py`, `scripts/vitest-runtime-error-reporter.mjs`.
  The newly inherited all-frontend gate requires matching runtime error counts where reported, and
  lacks explicit zero-error evidence when JSON omits the field. Capture explicit finished-run error
  evidence and reject new fingerprints while allowing removals. Include fail-closed self-tests. Fix only the three
  existing prefer-const findings in DialerPage; no queue/lock expressions or behavior changes.

No edits to locks/RPCs, useLeadLock/useHardClaim, teamOpenLeadAccess, dialer-api, TwilioContext,
Edge Functions, migrations/RLS, dependencies, or existing field/master read semantics.

## Implementation design

A separate display hook binds a successful canonical queue load to an organization/viewer/campaign
visit object, request generation, and campaign/master lead identity. Each queue load receives its own
confirmation callback. Only its still-current callback can mark that visit's row visible. The callback
does not acquire, renew, release, or transfer a lock. The existing confirmed lock ID remains required.

LeadCard gets `teamDetailsVisible` only for Team campaigns. True selects the full details grid; false
selects the existing loading state even if old outbound state says connected. Undefined preserves the
Personal/Open Pool path. The original `callStatus` still governs editing; a pre-call Team display may
never expose an active stale edit draft. No new reads, timers, dependencies, or telephony operations.

## Verification

- Demonstrate pre-dial/ringing display regression on the base card before the implementation.
- Exercise hook request/visit identity, different IDs, lock loss, disable/unmount, advancing, loading,
  and A → B → A completion. Test both stale load starts and stale load finishes.
- Render the real field grid: imported/custom values, false/0, empty/internal-key filtering, and unavailable/error notices.
- Mount the real DialerPage with inert process boundaries. Confirm Team gets the display override,
  Open Pool stays staged, and edit/conversion and lock-release behaviors are not changed.
- Run existing Team/Open field, reveal, master-read, edit, hard-claim, save/advance, Twilio-guard, and
  appointment-writer tests as relevant; no real production call.
- Run `npx tsc --noEmit` and `npx tsc -p tsconfig.app.json --noEmit`; compare the application diagnostics
  with this exact base. Root tsc compiles zero app files and is not sufficient.
- Run a production bundle build, focused lint, and diff/scope checks. Review the React changes.
- Record honest results below and in WORK_LOG; open a reviewable PR on the feature branch.

## Remaining full-record access dependency

This display step does not make an RLS-hidden master `leads` row readable. The documented September
24 findings remain a prerequisite to any expanded backend reader: direct client locks and editable
campaign-to-lead references cannot be used as new privileged-read authority. Do not widen general
Contacts access or hard-claim before a call to fetch display data.

Prepare the separate coordinated access design with exact changes and local adversarial verification
before asking for a production action. It must address trusted queue/association provenance,
membership/tenant isolation, existing records and active tabs, and preserve the operational lock
algorithm, TTL/heartbeat, retries, callbacks, and release behavior. Security work must not be silently
included in this frontend scope. Complete full-record parity is not claimed by this build.

## As-built and verification record

Local verified source commit: `1e2a664af05e5e62f53d7e7906ec6fbd33577caa` on the latest base above.
Published source + record commit: `71fa5d9dfd82720b478c8780eff572ed24c3fe44`. GitHub tools were used
because command-line push credentials were unavailable. Every uploaded file blob and the complete
published tree (`f8466bdaa5b6e25e7cdafca703f0dc89d174c59d`) matched the locally verified checkout.

- Added the display-only visit/generation hook and pure predicate. A canonical queue success confirms
  the organization/campaign/queue/master identity for the current viewer visit. The existing confirmed
  lock, loaded row and non-loading/non-advancing state remain required.
- Added the optional Team-only card override. The original outbound `callStatus`, field resolution,
  master reader, edit/save/claim/conversion and locking implementation remain intact.
- Team's details grid renders read-only if an old edit draft outlasts the action gate. Personal/Open
  presentation is unchanged. Shared grid comments now describe the two display paths accurately.
- Extended the existing real DialerPage harness rather than duplicating its mocks. Isolated its
  localStorage between mounts; otherwise cached campaign rows make later tests load twice. Supplied
  the missing remote-audio lookup in the inert Twilio mock after reproducing its unhandled rejection
  on the base branch. No Twilio runtime code was changed.

| Check | Result |
|---|---|
| Card on original base, before implementation | 3 failed / 4 passed: Team idle/ringing reveal and immediate lock-loss mask failed |
| Latest-base dialer regression run | 24 files, 308 tests passed, no unhandled errors |
| Feature + appointment checks in `America/Los_Angeles` | 5 files, 69 tests passed (before rebase; affected source files are unchanged by the rebase) |
| `npx tsc --noEmit` | Exit 0; root project compiles zero app files |
| App typecheck against exact latest base | 90 existing diagnostics in both; identical file/code/message multiset, no new errors |
| ESLint on feature/helper/test/shared-card files | Exit 0 |
| DialerPage ESLint | Exit 0, 18 existing warnings; three existing prefer-const findings corrected for the CI gate |
| `npm run build` on latest base + feature | Exit 0, production bundle generated; existing chunk/import warnings |
| React review and `git diff --check` | Completed; no new requests/timers, stable primitive context dependencies, surgical scope |

The regression set covers real card/field rendering, current identity, stale loads (including A → B → A),
lock loss/loading/advancing, unavailable master notices, inert real-provider outbound reveal events,
edit and conversion gates, appointment writers, queue preview/session guards, inbound device lifetime,
browser write guards and canonical Twilio status/duration contracts. The real-page harness checks a
single cold-mount queue request, unchanged 30-second renewal on the queue-row key, transient renewal
errors, definitive loss, release-before-next Skip with per-agent suppression/no attempt increment,
Save retention, Save & Next release, and failed-call-save retention.

This is isolated frontend verification with mocked external boundaries. No live call, production
lock collision, or new authenticated SQL harness was executed. The unchanged canonical RPC algorithm,
server TTL, retry/recent-call guard, callback ownership and hard-claim rules are preserved by leaving
their implementation untouched; this record does not claim a new production or backend verification.

The separate `full-record-access-design.md` is a review draft for the remaining dependency. It requires
coordinated claim/lock and association provenance work, legacy/active-tab compatibility, and direct
authenticated adversarial SQL tests before introducing a privileged Team display reader. No SQL or
backend implementation accompanies that draft. Merge, production release and backend mutations are
still outside this build approval.

CI follow-up: initial job 110926000929 passed the baseline type/test comparison, Reports checks and
build, but failed changed-file lint on the three old DialerPage prefer-const findings. Those declarations
are now const with identical expressions/control flow. Runtime comparison now uses an explicit Vitest
completion reporter (zero is observed, not inferred from an omitted JSON field), compares name/message
fingerprint multisets and permits removals while refusing any new error. Self-tests reject replacement
errors, duplicate increases, malformed/missing and interrupted evidence. A real installed-Vitest probe
captures the original mock error on main (one) and the corrected test on this branch (zero).
