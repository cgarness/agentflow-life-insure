# Assigned Number in contact details

**Current status: released to the primary frontend on November 21, 2026 at 9:35:23 AM Pacific.** Chris approved exact source `eaf83fa9fb946bec94a3f6c646ae8aaeb17fd68b`; production deployment `dpl_5J1GgpEXDLdY1n4Pu3qQy2G2HNf4` is READY on both fflagent.com domains. The authenticated contact layout and delivered assets passed readback. Earlier approval-gate paragraphs below describe the pre-release sequence; that gate is now closed. See [the production release record](production-release.md).

## Scope and authorization

Chris requested an Assigned Number field in the left contact details, with emphasis similar to Assigned Agent, and removal of the Calls / Texts strip above the composer. This authorizes the presentation change and isolated verification. Production frontend release remains a separate exact approval; no backend operation is part of this work.

Source baseline: PR #531 head `1536db4d957f256b5706d948545409cac2e1cfe1`, tree `3da80f2fd4b17303a9fb52657df82c1729041f32`. Its runtime is identical to primary production commit `7914faefc750aaf38d3659a71d9a01b3298f9107`; only WORK_LOG differs. This preserves the newer automatic number setup release. Main `83a0ed509be89274d18b229239a3112de0a5dbf6` adds the design palette, which is read as guidance without merging main. PR #534's separate AutomationActivity additions must be preserved in future integration.

## Implementation

1. Add a details presentation to the existing ContactNumberControl. Keep one hook/model, one modal and the current authorization, refetch and temporary sender callbacks.
2. Place that presentation after the configurable detail grid in FullScreenContactView, so it remains visible when Assigned Agent is absent or reordered. Remove the center-column control mount. Keep the existing Conversations and main Dialer presentation.
3. Use a muted full-width field, compact label, modest phone icon, formatted value and Change action. Honor the existing light/dark tokens and AgentFlow Design Palette v1; show concise exceptional states rather than routine readiness prose.
4. Render permanent state from the preview's voice/SMS channel state, never from a candidate's presence, the provisional readiness flag or a one-text override. Combine identical assignments; show separate channel values when they differ. Unassigned stays Not assigned; pending and review remain explicit; an unavailable assigned number remains visible.
5. Keep temporary choices visibly temporary, preserve Reply once / clear choice, modal focus return and composer send guards. No assignment, API, SQL, calling, texting or readiness logic changes.

Review clarification: the current preview coalesces the other channel's number into an unresolved `needs_review` channel. Its response cannot distinguish that candidate from a prior review snapshot. Only `established` and `reserved` prove a saved channel number for this display. Show Review required for an unresolved channel, and retain the independently established channel's number; never collapse the unresolved candidate into a shared assignment. Keep an established but unavailable/deleted number visible.

## Exact file list before product edits

- `src/components/contacts/ContactNumberControl.tsx` — optional details presentation and unchanged default behavior.
- `src/components/contacts/FullScreenContactView.tsx` — move the existing mount to left details.
- `implementation_plan.md` — new top-level pointer, preserving other work.
- `docs/plans/2026-11-21-assigned-number-ui/implementation_plan.md` — scope, verification and release status.
- `WORK_LOG.md` — newest-first entry after verification.

After the source review identified cross-channel fallback in unresolved previews, add `AGENT_RULES.md` to the documentation-only manifest before editing it: record the preview-versus-assignment distinction so later UI work does not reintroduce a false assignment label.

Temporary synthetic browser fixtures and evidence stay outside product source. Add no dependency, lockfile or backend changes. If presentation complexity requires a small extracted component, list that file here before creating it.

## Verification

Capture exact-base root and app TypeScript and relevant existing full-contact tests. Run scoped lint, the affected existing tests and the production build. Compare inherited diagnostics instead of claiming a clean application typecheck if the base fails.

Use the existing synthetic SMS responsiveness harness with real contact components and the real affinity hook. Inspect desktop light/dark and the field at narrow width; verify same/different/unassigned/pending/review/unavailable/temporary states, Change keyboard/focus, contact switching and removal of the composer strip. Do not contact production or send a real communication. Record inherited whole-contact mobile limitations separately from the new field's fit.

## Release status

Implementation is complete. Final isolated source checks passed: root TypeScript, all 51 existing tests across FullScreenContactView assignment, field visibility, quick call and conversation suites, clean lint for both changed components, and the Vite production build. Application TypeScript has exactly the same 78 diagnostics as the untouched base, byte for byte; this is zero new diagnostics, not a clean application typecheck. Package manifests, the lockfile, affinity hook/API, composer guards and backend sources are unchanged.

Independent review found the review-candidate presentation issue described above; it is corrected. The Contact numbers region now has a semantic group role. All 23 browser checks passed with zero unhandled page errors, using the real components/hook with isolated synthetic adapters. Checks cover desktop light/dark placement, assignment states, mixed unresolved/established channels, exceptional readiness, one-text choose/clear, Reply once, Change keyboard dismissal and focus return. The 23 includes two base desktop comparisons. Root visually reviewed the light and dark full-contact screenshots.

The real number field and settled Change dialog fit a 375 px container in both themes (x=16, width=343). The existing full contact screen still clips its fixed three-column layout at 375 px on both base and candidate. That inherited whole-screen limitation is recorded separately and is not passed mobile acceptance. No unrelated mobile layout refactor is included. The disposable browser sandbox and local test server are stopped; no real call/text or production request was made.

Publish only the six listed source/documentation files to the existing draft branch using an expected-head lease. No production release, main merge, secondary project change, provider change or real call/text is performed by this task. Production deployment requires Chris's exact approval under the project's Vercel rule; deploy the published candidate by exact Git SHA directly to `agentflow` / `fflagent.com`, preserving the currently released automatic-number-setup code, without a main merge. This UI change needs no migration, Edge deployment, mode change, seed or provider operation. Build from source through the primary project's configured environment; the locally generated bundles use synthetic verification settings and are not production artifacts.

Before an approved release, recheck the primary deployment and exact candidate diff. The currently verified production baseline is `dpl_Ew8mAsZojSs5MbbTAJd8etB1okCE`, source `7914faefc750aaf38d3659a71d9a01b3298f9107`. Do not overwrite a later unrelated production release. A failed frontend readback should restore that verified pre-release primary deployment under the release's conditional rollback scope.

## November 21 release approval

Chris replied APPROVED to the exact primary-only frontend release of `eaf83fa9fb946bec94a3f6c646ae8aaeb17fd68b`. Fresh preflight confirms the primary still serves `dpl_Ew8mAsZojSs5MbbTAJd8etB1okCE` at `7914faef`; the reviewed candidate changes only the two TSX presentation files plus documentation. Deploy from the connected Git repository with the exact SHA and existing production configuration. Verify source identity, build, both domain mappings and the live contact layout using read-only actions. Conditional recovery is the verified prior primary deployment if the new frontend fails readback.

Release documentation file list before edits: this focused plan, root `implementation_plan.md`, newest-first `WORK_LOG.md`, and `docs/plans/2026-11-21-assigned-number-ui/production-release.md`. Publish documentation only after the release; do not change the approved runtime bytes, merge main, touch the secondary project, mutate Supabase/settings/provider data, or send a real communication. Supabase advisors are unnecessary for this frontend-only release because no backend change occurs.
