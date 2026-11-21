# Contact FROM dropdown — production release

Released November 21, 2026 at **10:53:12 AM Pacific** after Chris approved the exact primary-only frontend release of `553f89d`.

## Result

The left **Assigned Number** field is the saved default. Its phone icon, routine Calls & texts caption and separate Change action are removed. The header **FROM** is the active choice for both calling and texting in the full contact view.

Selecting another number opens one compact confirmation with an unchecked **Make this the assigned number** checkbox. Leaving it unchecked uses the selected number for the current contact visit. Checking it uses the existing authorized permanent assignment flow for both channels. Cancel preserves the previous choice; confirming a selection never starts a call or text. Saved identity stays distinct from a temporary choice.

Current readiness, ownership, shared-endpoint, unresolved-send and cap protections are preserved. A selected number that cannot use a channel blocks that action; the app does not silently substitute another number. The selection is scoped to contact/type/phone, real actor, organization, View As and visit. Other screens retain their existing controls.

## Release identity

| Item | Verified value |
| --- | --- |
| Primary project | `agentflow` / `prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc` |
| Owning team | `team_iPboOWpwdIQRwdxmA5GJp5Rq` |
| Deployment | `dpl_Ces2SKbmdQrjHJ3XyYwopGZebt7U` |
| Deployment hostname | `agentflow-2cbpvj386-cgarness-projects.vercel.app` |
| Approved source | `553f89d3a647770a6c722e4ae4ba89b15b2a3b09` |
| Source tree | `f2a3a48160c56423369e057620736ee1fd84b780` |
| Source branch | `prereq/sticky-numbers-baseline-20261113` |
| State | `READY`, production target, no alias error |
| Custom domains | `fflagent.com`, `www.fflagent.com` — both point to this deployment |
| Prior primary deployment | `dpl_5J1GgpEXDLdY1n4Pu3qQy2G2HNf4` |
| Prior production source | `eaf83fa9fb946bec94a3f6c646ae8aaeb17fd68b` |

Exactly one production deployment was created from the connected Git repository, pinned to the approved SHA and using the primary project's existing production configuration. The synthetic local test bundle was not deployed. No rollback was needed.

## Source and build verification

Fresh preflight matched all 23 candidate blob/mode identities and local SHA-256 values against the publication manifest. All eleven runtime files match the verified builds. Complete remote-tree comparison with the previous production source found only the approved candidate paths and prior release documentation: 25 total differing paths, with no unexplained delta. Backend, dependencies, lockfile, workflows, configuration and unrelated automatic phone setup remain unchanged.

Vercel cloned the correct repository, branch and exact approved commit. The build tail records Build Completed in /vercel/output and Deployment completed. The existing large-chunk warning remains informational. The READY readback reports the approved source and primary project. Both custom-domain deployment/alias checks resolve to the new release; the apex retains its existing redirect to www.

Public HTML and `/assets/index-gu6ID7rJ.js` return HTTP 200; that filename matches the emitted Vercel build asset. The served bundle contains the new confirmation and checkbox, permanent-both operation, expected caller guard, contact selection ownership hook and retained automatic phone setup markers. Exact source identity is established by the independently verified Git tree/blobs and deployment pin, supplemented by served-asset evidence. No byte comparison of Vercel's original TypeScript source files is claimed.

## Live UI verification

An authenticated production browser opened the existing synthetic contact used in Chris's screenshot. The left field showed Assigned Number without its old icon, caption or Change action; the old number strip remains absent above the composer. FROM loaded the saved number and its options were enabled.

Selecting another number opened **Use a different number?**, showing the current and proposed numbers. **Make this the assigned number** was unchecked. Cancel closed the dialog and kept the original FROM and saved assignment. The marked live tab is left on the contact screen. No Call, Send, Use number, permanent assignment or other contact mutation was submitted.

The captured console error entries came from browser-extension metadata handling. No AgentFlow error appeared in that returned readback. This is a bounded production UI check; it does not claim actual call media, text delivery or production assignment mutation was tested.

## Retained isolated verification

- **235 focused tests pass:** 70 full-contact tests, 68 call/ownership/provider tests, 32 selection/helper tests and 65 retained SMS intent/pending/sender tests. All 163 corresponding pre-existing tests pass on the exact base.
- **10/10 grouped isolated browser scenarios pass**, with zero page errors and no external browser requests. Light/dark layout, active selection, temporary/permanent success and refusal, cancellation, split identities, unreadiness, keyboard focus and narrow controls are covered.
- Root TypeScript and Vite build pass. Scoped lint has no errors or new warnings; seven inherited warnings remain versus eight on base. Application TypeScript retains the same **78 inherited diagnostic messages** after normalizing source positions.
- Independent source review is clear. The quick-call/Floating Dialer path preserves the expected caller, checked before call-row insertion or device.connect. The real SMS pending store retains unresolved request identity when FROM changes.
- The field and compact confirmation fit 375 px in both themes. Inherited whole-page mobile clipping remains out of scope. Exact-head hosted workflow lookup returned no runs; no CI-green claim is made.

See [the candidate verification record](verification.md) for detailed test evidence. Its candidate-stage approval wording is historical; this release record is the current outcome.

## Boundaries and continuation

Only the primary frontend was deployed. No Supabase mutation, migration, Edge deployment, sticky-mode change, seeding, assignment change, number/provider change, real call/text, main merge or secondary-project operation occurred. No backend advisors were required for this frontend-only release.

PR #531 remains draft and unmerged. The root/focused plans, Work Log and this release record are published as a later documentation-only closeout; the running frontend stays pinned to `553f89d3a647770a6c722e4ae4ba89b15b2a3b09`. Main is behind the deployed runtime, so future frontend releases must retain this update and automatic phone setup. Refresh the full contact view to load the release. No release blocker remains for this change.
