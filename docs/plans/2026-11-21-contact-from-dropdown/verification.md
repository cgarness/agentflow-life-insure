# Contact FROM dropdown — verified frontend candidate

November 21, 2026, Pacific. Chris approved the build with “yes and also remove the phone icon. proceed with build.” Implementation and isolated verification are complete. This packet does not record a production release.

## Source and scope

- Base: PR #531 head `8782695928e19991a82349faa441a81cb57e2152`, complete tree `af3637e639e5af966f3c0445d2dfdc3df38e6ffa`. All 3,479 tracked files in candidate and untouched base were verified against the remote tree before edits.
- Current production source at preflight: `eaf83fa9fb946bec94a3f6c646ae8aaeb17fd68b`, primary `agentflow`, deployment `dpl_5J1GgpEXDLdY1n4Pu3qQy2G2HNf4`. Base differs from that production source in release documentation only.
- The release candidate is the commit containing this packet. Its precise SHA is recorded in the PR publication receipt and supplied for release approval. Do not deploy an unpinned branch or `main`, which is behind the deployed runtime.
- Eleven frontend runtime files, seven test files and five documentation files change, exactly as listed in the focused plan. No backend, dependency, lockfile, workflow or Vercel configuration file changes. Automatic phone setup and unrelated work remain intact.

## Resulting behavior

Assigned Number is a quiet saved-identity field in left contact details. The phone icon, routine Calls & texts caption and separate Change action are removed. Matching saved channels display once. Split identities, pending assignments, unavailable snapshots and review remain honest; a preview candidate is never presented as saved.

The top FROM selector is the active number for both actions. Choosing an alternate opens one compact confirmation with an unchecked **Make this the assigned number** checkbox. Cancel preserves the prior active number and draft. Use number changes selection only; neither confirmation nor dropdown selection initiates a call or sends a text.

An unchecked choice is temporary for that contact visit and applies to each subsequent explicit Call or Send. The saved field stays unchanged. A checked choice uses the existing atomic `change_contact_number(..., 'both', ...)` API and updates the field only after verified success. Known missing edit permission hides the checkbox; final shared-endpoint, generation, readiness and unresolved-send authority remains on the server. A refusal never silently converts the request into a temporary choice.

Temporary choices and asynchronous work are scoped to contact ID/type/phone, real actor, organization, View As and the current visit. Returning A → B → A cannot revive an old response. No selection is written to the global caller preference. The Floating Dialer carries the exact contact choice and refuses an expired origin. Ordinary assigned/default actions retain their normal founding behavior; explicit temporary actions carry the existing per-action override IDs.

SMS retains the existing immutable pending request. Changing FROM cannot turn a pending or uncertain text into a new attempt from another number. Voice carries an expected caller through quick-call and checks the server-bound caller before inserting a call row or calling browser `device.connect()`. A mismatch stops with “The FROM number changed. Review it before calling.” Existing re-entrancy, DNC, group, disposition and telemetry paths remain.

Actions stay blocked until a verified preview is available. Option readiness refreshes on the existing bounded preview polling signal while the chosen number ID stays fixed; readiness changes do not assign or resend anything. A removed choice remains visible and unavailable. Per-channel unreadiness/review blocks only the affected action. Global history review or different saved channel identities requires a deliberate selection. Ordinary saved voice pins retain their cap exception; temporary selections use strict readiness.

## Verification results

### Automated behavior

All **235 candidate tests pass across 14 test files**, using synthetic fixtures and mocked communication boundaries.

| Area | Candidate | Exact-base comparison |
| --- | ---: | --- |
| Existing full-contact suites | 51 | Same 51 pass on base |
| New real full-contact FROM integration | 19 | New behavior |
| Quick-call, scoped ownership, real Floating Dialer and mounted TwilioProvider | 68 | All 47 pre-existing cases pass on base |
| Pure assignment/readiness helpers and controller | 32 | New behavior |
| Existing SMS intent, pending store and manual sender | 65 | Same 65 pass on base |

The real full-contact integration uses the actual affinity/controller hooks, manual sender and pending store, with database/session/provider transport mocked. It checks repeated temporary calls/texts, exact selected IDs and numbers, no automatic send on confirmation, cancellation, permanent success/refusal, split channels, channel unreadiness, all scope resets, late reassignment responses and stale readback. One case holds an original send unresolved, changes FROM, and proves its frozen snapshot is unchanged and the same message cannot be sent again from the alternate.

Mounted provider tests prove a different authorized caller is refused before call-row insertion or `device.connect()`, while a normalized matching number proceeds through the existing path. The bridge tests cover both Floating Call buttons, no global preference mutation, invalid destinations, expired owners and legacy quick-call behavior.

The controller/helper cases include failed/pending/absent preview, first-send founding, option readiness becoming ready or unavailable without assignment changes, old option responses, deleted/re-purchased digits, mode handling and the saved-pin cap exception.

### TypeScript, lint and build

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass; the repository's root check is limited, so the app check was also run |
| `npx tsc -p tsconfig.app.json --noEmit` | Same 78 inherited diagnostic messages as the exact base after normalizing line/column offsets; zero added or removed diagnostics |
| Scoped ESLint | Zero errors and zero new warnings; seven inherited TwilioContext warnings, down from eight on the base scope |
| `npm run build` | Pass; existing mixed-import/large-chunk warnings remain |
| Runtime source stability | All eleven runtime file hashes are unchanged across final checks and browser bundle preparation |

New components and hooks stay under 200 lines. Existing large contact/dialer/context files receive scoped wiring/guards. The new controls use the existing Radix/shadcn components, Tailwind and Zod. No dependency was introduced.

### Browser verification

**10 of 10 grouped synthetic-browser scenarios pass, with zero page errors.** The harness renders real contact/control components with in-memory data and mocked API/communication boundaries. It covers light/dark desktop presentation, no icon/caption/Change in details, temporary shared Call/Send choices, confirmation without communication, cancellation, permanent success/refusal, split assignments, channel unreadiness, narrow dialog layout, keyboard dismissal and focus restoration.

The light narrow Escape-focus assertion initially inspected focus before Radix's close callback. It passed when the assertion waited for that callback; no product change was made for the timing correction. Original successful scenarios were retained, and only the failed timing check was rerun. The test was not replaced by a visual-only claim.

The new picker/dialog fit narrow width. At 375 px, the real field is 343 × 58 and the settled confirmation is 343 × 206, both at x=16 in each theme. The full contact page's existing three-column mobile clipping is outside this change and remains; whole-page mobile acceptance is not claimed. Browser verification used a disposable isolated sandbox with external networking denied after tooling setup, no production credentials and no real calls/texts. Zero non-loopback browser requests were observed. Screenshots/results were retrieved and verified, the primary reviewer inspected the light/dark screen and narrow dialog, and the sandbox was stopped.

### Independent review and backend compatibility

Read-only primary database catalog review verified all **16 relevant function bodies** against current source. Existing preview, option, temporary override and permanent-both APIs support this UI without a database or Edge change. No customer rows were queried for this review.

Independent source review found and closed three issues before final checks: missing preview falling through to legacy calling, stale temporary option readiness, and one channel's review blocking the healthy channel. Final review found no remaining blocker in selection ownership, exact caller handoff, cap behavior, permission handling or late responses. The React review checklist was applied to the new components and hooks.

Supabase advisors were not rerun because no backend changes occurred. A synthetic frontend check does not prove real media quality or provider delivery; normal live agent acceptance follows an approved release.

## Publication and release boundary

Publish only the 23 planned paths to the existing draft branch with an expected-head check against the verified base. Preserve all other tracked blobs and modes. PR #531 remains draft and unmerged; do not merge or deploy `main`.

All 40 workflow files match base. Automatic PR workflows use no production repository secrets; production SQL/deployment/history workflows remain manual. The latest authoritative project records retain Preview Branch Tracking OFF, Supabase Automatic branching OFF and Deploy to production OFF. These switches are carried-forward verified records, not a new dashboard read. Updating the existing branch is within the approved publication scope; production release is a separate exact action.

The next approval is **primary frontend only**: deploy the exact candidate Git commit to project `agentflow` (`prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc`) at `fflagent.com`, using existing production configuration; check drift, READY state, Git SHA, aliases and read-only page behavior. Do not deploy the local synthetic verification bundle.

No Supabase migration, Edge deployment, sticky-mode change, seeding/reassignment, number/provider action, secondary-project change, main merge or real communication is included. If a post-release UI rollback is necessary, restore the prior primary frontend `eaf83fa9fb946bec94a3f6c646ae8aaeb17fd68b`; no affinity data is removed or reverted.

## Context snapshot

- Changes: simplified saved field, unified FROM confirmation, scoped temporary choices, exact call/SMS handoff, tests and documentation.
- Decisions: user-approved simple UI; existing backend authority retained; ordinary first actions remain ordinary.
- Migrations/deployments: none for this build.
- Build blockers: none after verification. Existing app diagnostics and whole-page mobile clipping remain documented.
- Next: exact commit publication/readback, followed by primary-only frontend release approval.
