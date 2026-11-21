# Contact FROM dropdown simplification

Status: implementation and isolated verification complete; exact candidate publication/readback and primary frontend release approval follow. See [verification](verification.md) for 235 passing tests, ten grouped browser scenarios, source review, inherited limitations and the exact release boundary.

## Approval and baseline

Chris approved the proposed single-FROM behavior and said “yes and also remove the phone icon. proceed with build” on November 21, 2026. This authorizes isolated implementation, meaningful verification and publication to the existing draft branch. Production release is separate under the project's exact-release rule; no backend/provider mutation or real communication is part of this build.

Verified source is PR #531 head `8782695928e19991a82349faa441a81cb57e2152`, tree `af3637e639e5af966f3c0445d2dfdc3df38e6ffa`. Primary production is `eaf83fa9fb946bec94a3f6c646ae8aaeb17fd68b`, deployment `dpl_5J1GgpEXDLdY1n4Pu3qQy2G2HNf4`. The branch differs only in release documentation. All 3,479 tracked files in both candidate and untouched base were matched to the complete remote tree. Main is `83a0ed509be89274d18b229239a3112de0a5dbf6`. Preserve automatic number setup and separate Automations PR #534 work. No main merge or secondary-project work.

Read AGENT_RULES, VISION, latest WORK_LOG and the design palette from the prior verified UI build. Apply current organization/contact access, View As, permission and single-leg device.connect guards. Reuse existing Supabase RPCs; no schema/function/consent change is planned.

## Product behavior

- Left contact details show Assigned Number without a phone icon, Calls & texts caption or separate Change button. It shows saved state, never a temporary choice.
- FROM is the active number for both calls and texts. Initialize from the shared saved assignment (including one established channel used by the other through the current resolver). Preserve honest review/pending/unavailable state.
- Existing different saved call/text numbers remain explicit until an authorized choice unifies them; never silently change history or present a candidate as saved. Require a deliberate FROM selection for an ambiguous split.
- Choosing an alternate opens one compact confirmation showing current and selected numbers and an unchecked “Make this the assigned number” checkbox. Cancel preserves the prior effective choice. Confirm changes selection only; no call/text starts.
- An unchecked selection applies to this contact visit for calls and texts. No repeated prompt for each action. Leaving the record, switching contact/type/phone, real actor, organization or View As context discards it. A refresh starts from saved state. Scope choices and pending asynchronous work so old responses cannot leak into a later visit.
- A checked choice uses existing change_contact_number with channel both and a truthful generated audit reason. Preserve permission/shared-endpoint/generation/unresolved-send checks and validate Zod inputs. Update saved display only after authoritative success. Failure leaves prior selection and assignment intact; the user may choose the temporary path separately.
- Respect selected number readiness separately for calling and texting. An unavailable channel blocks only that action and explains why. Never silently substitute a number. Existing pinned-number cap exception is retained; strict option daily_limit must not incorrectly disable a saved pin.
- Call/Send must use an immutable captured choice for the action. SMS uses existing expected/override sender IDs; uncertain or in-flight receipts retain the original identity. Call carries the displayed expected caller through quick-call and checks the server-bound number before creating a call row/device.connect.
- A contact-scoped selection must not write the global voice preference. Preserve all other quick-call consumers, dialer guards, call records, disposition and telemetry paths.
- Preserve other screens' current controls. The full contact view is the scope of this simplification; use isolated shared helpers where required.

## Exact intended file list before edits

Documentation:
- implementation_plan.md (top pointer, preserve other work)
- docs/plans/2026-11-21-contact-from-dropdown/implementation_plan.md (this plan)
- docs/plans/2026-11-21-contact-from-dropdown/verification.md (results/limitations/release pin)
- WORK_LOG.md (newest-first)
- AGENT_RULES.md (active FROM/saved assignment and scope invariant)

Product:
- src/components/contacts/FullScreenContactView.tsx (surgical wiring, replace header selector mount)
- src/components/contacts/ContactNumberControl.tsx (details presentation simplified; other presentation preserved)
- src/components/contacts/ContactFromNumberControl.tsx (new compact picker and confirmation, under 200 lines)
- src/hooks/useContactFromNumber.ts (new scoped selection controller, under 200 lines; extract helpers below as needed)
- src/lib/contact-from-number.ts (new pure assignment/selection helpers)
- src/hooks/useContactNumberAffinity.ts (optional phone scope for preview cache/temporary state)
- src/lib/number-affinity.ts (export typed existing option schema/result as needed; no RPC contract change)
- src/lib/quick-call.ts (expected caller/contact-local intent)
- src/hooks/useQuickCallNumberSelection.ts (new narrow state bridge if needed, under 200 lines)
- src/components/layout/FloatingDialer.tsx (preserve contact choice without persisting global selection)
- src/contexts/TwilioContext.tsx (expected caller equality guard only; retain all existing guards)

Verification:
- src/lib/__tests__/contactFromNumber.test.ts
- src/hooks/__tests__/useContactFromNumber.test.tsx
- src/hooks/__tests__/useQuickCallNumberSelection.test.tsx (if extracted hook is used)
- src/components/contacts/__tests__/fullScreenContactViewFromNumber.test.tsx
- src/lib/__tests__/quickCall.test.ts (extend expected caller event coverage)
- src/contexts/__tests__/twilioProviderLifecycle.test.tsx (existing real-provider harness; normalized expected-caller match/mismatch and no insert/connect on mismatch)
- src/components/layout/__tests__/floatingDialerRecentStates.test.tsx (existing real-floating-dialer harness; verify scoped FROM forwarding, no global preference write, stale-owner refusal and legacy caller behavior)

No dependency/lockfile/backend file changes. Disposable browser adapters/evidence remain outside product source; do not commit synthetic production paths. Adjust this list before any additional path is edited.

## Verification and release

Before edits, record exact-base root/app TypeScript and relevant regression tests. Run candidate root TypeScript, app diagnostics comparison, scoped lint, meaningful selection/race/permission tests, existing full-contact and quick-call/dialer suites, and Vite build. Include actual-hook integration with mocked network/provider boundaries rather than off-mode-only mocks.

Browser verification uses real contact components with isolated synthetic data. Check desktop light/dark, picker/confirmation narrow width, no icon/caption/Change in details, ordinary assigned FROM, temporary call and SMS payload equality, confirmation never sends, cancel, permanent success/failure, stale choice, unreadiness, split assignment, pending/uncertain SMS identity and contact/phone/actor changes. The pre-existing whole-contact mobile clipping is tracked separately; do not claim it fixed.

Independent review checks call selection leakage, exact sender handoff and stale asynchronous ownership. No real calls/texts. Run Supabase advisors only if backend changes occur (none planned). Finish implementation/verification/docs and publish exact changes to draft PR with expected-head protection; production frontend approval is requested only after a concrete reviewed pin exists.

