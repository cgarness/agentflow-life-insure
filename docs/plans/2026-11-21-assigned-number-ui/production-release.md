# Assigned Number UI — production release

Released November 21, 2026 at **9:35:23 AM Pacific**, following Chris's exact primary-only frontend approval. This is a presentation update to the full contact view.

## Result

Assigned Number now appears in the left contact details with a muted field treatment, formatted value and the existing Change action. Identical saved voice/SMS assignments display once; different assignments retain channel labels. Unassigned and review states are explicit. Temporary one-text choices remain visibly temporary. The former Calls / Texts strip above the full-contact composer is removed. Conversations and the main Dialer retain their existing presentation.

## Release identity

| Item | Verified value |
| --- | --- |
| Project | `agentflow` / `prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc` |
| Production deployment | `dpl_5J1GgpEXDLdY1n4Pu3qQy2G2HNf4` |
| Deployment hostname | `agentflow-c67mg50fy-cgarness-projects.vercel.app` |
| Approved Git source | `eaf83fa9fb946bec94a3f6c646ae8aaeb17fd68b` |
| Source tree | `3992a63a4dd8a506c2aaadd3f814ce62f9ed97df` |
| Source branch | `prereq/sticky-numbers-baseline-20261113` |
| Prior primary deployment | `dpl_Ew8mAsZojSs5MbbTAJd8etB1okCE` |
| Prior production source | `7914faefc750aaf38d3659a71d9a01b3298f9107` |
| Domains | `fflagent.com`, `www.fflagent.com` — both resolve to the new deployment |
| State | `READY`, production target, no alias error |

The build used the connected Git repository at the exact approved SHA and the primary project's existing configuration. The synthetic local verification build was never deployed. Complete-tree preflight compared the approved source with the prior production commit: exactly two TSX files and four documentation paths differ; every other tracked blob and mode matches. Automatic phone setup, dependencies, backend files and workflows are preserved.

## Readback

- Vercel reports the exact approved Git SHA, primary project and production target. The build completed successfully; its large-chunk warning remains informational.
- Both custom-domain lookups return the new READY deployment. The signed-in browser loaded `www.fflagent.com` and the contact view normally.
- The actual full-contact screen shows Assigned Number and Change in the left panel. An existing synthetic test contact displays Not assigned; the old strip is absent above the SMS composer. No call, send, assignment edit or contact mutation was initiated.
- Served HTML and `/assets/index-DrHNmX4T.js` return HTTP 200. The actual JavaScript includes Assigned Number, This text only and the `variant:"details"` mount, plus preserved SMS ready, Retry setup and phone_number_setup_status markers.
- Served JavaScript: 4,818,312 UTF-8 bytes, SHA-256 `95da6fb6bf7152000ddf3ad905d40e88745f8a2dd669f6eb18630ccfb13851d2`.
- Source-byte retrieval from Vercel returned 404 for the two TSX paths and its file tree. Exact source identity is supported by the independently verified Git blobs/tree and deployment pin; served-asset evidence confirms delivery. No byte comparison of Vercel's original TSX files is claimed.

## Isolated verification retained

Root TypeScript, scoped lint, 51 existing full-contact tests, the Vite build and all 23 browser checks pass. The browser checks use the real components/hook with isolated synthetic adapters and include two base desktop comparisons; there were zero unhandled page errors. Desktop light/dark placement, saved and unresolved assignment states, exceptional readiness, one-text choose/clear, Reply once and Change focus behavior were checked.

Application TypeScript has the same 78 inherited diagnostics as the exact base, byte for byte. The real new field and settled Change dialog fit 375 px in both themes. The full contact page's fixed-column clipping at that width exists on both base and candidate and remains separate work. This release does not claim a clean full-application typecheck or whole-page mobile acceptance.

## Boundaries and continuation

Only the primary frontend was deployed. No Supabase operation, migration, Edge deployment, sticky-mode change, seeding, assignment change, provider/number change, real call/text, main merge or secondary-project operation occurred. Backend advisors were not needed for this frontend-only release. No rollback was needed; the prior deployment is recorded above for recovery.

PR #531 remains draft and unmerged. Release documentation is published as a later documentation-only commit; the running frontend remains pinned to `eaf83fa9fb946bec94a3f6c646ae8aaeb17fd68b`. Main is behind the deployed runtime; future frontend releases must retain automatic phone setup and this Assigned Number update. Refresh the full contact view to see the new field. There is no remaining release blocker for this UI update.
