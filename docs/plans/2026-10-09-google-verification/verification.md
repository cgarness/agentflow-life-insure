# Google verification website preparation — verification

Date: October 9, 2026. Base/main/production source: `8d53531d0edc509cc97fdc49a06c4873438ca67d`. Branch: `codex/google-verification-pages-20261009`.

## Approved publication release

Chris approved the exact policies and their publication at 12:58 PDT. The release sets `approved: true` and the effective date to October 9, 2026; all policy paragraphs are unchanged from the browser-reviewed text. Fresh main and production still match the recorded base. Final root TypeScript, scoped legal-content lint, diff checks and production build pass (21.18 seconds). Only the approval flag/date and documentation changed since the successful preview check. Production readback will be added after execution. The preparation-only statuses below describe the earlier checkpoints.

## Scope and review

- Two public legal routes, shared static legal copy/layout, homepage Google explanation, working footer links and submission documentation only.
- Existing AgentFlow icon inspected visually: transparent blue brand mark, 512 × 512 PNG, 12,409 bytes; unchanged.
- New React components stay below 200 lines. Reviewed hooks, stable keys, semantic headings/navigation, narrow effects, responsive layout, external link attributes, and direct imports using the Vercel React Best Practices checklist. No added dependency or data fetching.
- `/privacy` and `/terms` are outside ProtectedRoute; existing provider wrappers and Vercel SPA rewrite remain unchanged.
- Explicit review banner and unset effective date prevent this draft from being mistaken for a final published policy. Owner approval and an actual effective date are required for release.
- Copy and submission packet reflect live source, including unmatched Gmail imports, local-only disconnection, retained history and broad Calendar scopes. Neither asserts that old PR #378's security/deletion changes are live.

## Automated checks

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS; root project uses references, so meaningful app comparison is recorded separately. |
| Scoped ESLint: all eight changed/new application files | PASS, no diagnostics. |
| `git diff --check` | PASS at initial implementation checkpoint. |
| `npx tsc -p tsconfig.app.json --noEmit` | 85 base / 85 candidate diagnostics; full output byte-identical, zero new errors. Both exit 2 on existing errors. |
| `npm run build` | PASS, 22.57 seconds. Existing large-chunk and stale Browserslist warnings remain. |
| Vercel preview build | READY: `dpl_EgTvCN81nLUPmg8fhzstudUaUc7p`, source `4688d399d560d56ea82e8ec28ffc2a0aacdee521`, target preview. Application tree unchanged from the locally checked implementation. |
| Hosted public page render/navigation | PASS after Chris explicitly approved temporary preview access at 12:52 PDT. Privacy loads directly, Terms loads through its link and after a direct reload, Home returns to the homepage, both legal footer links work, and the Google summary privacy link works. No AgentFlow sign-in was needed. |
| Desktop visual check | PASS: readable Privacy/Terms layout and Google summary/footer inspected at 1349 × 926. Publication-review banner remains visible. Mobile-specific rendering was not exercised. |

No new low-impact tests were added. No authenticated integration, real mailbox send, event creation, deletion or Google submission was executed. Passing website checks cannot establish OAuth or assessment readiness.

The remote browser initially had a selector timeout during homepage Terms navigation; the visible accessibility link completed the same navigation successfully. The sampled browser errors were extension metadata errors, not application errors. No application changes were needed from visual review. Saved the privacy review screenshot as `agentflow-policy-review-20261009-1254.jpg` for the owner's review.

## Production evidence and limits

Read-only Vercel check found READY production `dpl_28cKkn6bUSTKXTCoRgZ39iSCKTkP`, main `8d53531d0edc509cc97fdc49a06c4873438ca67d`. Read-only Supabase function source: email-connect-start v30, email-sync-incremental v31, email-disconnect v28, google-oauth-start v491. No user message content or credential values were read.

Google Console is unavailable in the remote browser. The user's screenshots are the evidence for branding fields; saved state, Search Console ownership, complete Data Access inventory, client ID and Verification Center results are not independently verified. The submission packet explicitly lists those gaps.

No merge, production release, schema/function/configuration change, new account, email or appointment, paid assessment or Google submission occurred. This branch prepares concrete review material; it does not make AgentFlow Google-verified.

## Review handoff

- Draft PR: https://github.com/cgarness/agentflow-life-insure/pull/432
- Preview: https://agentflow-it5mp5cy1-cgarness-projects.vercel.app/privacy (requires existing Vercel access or the separately authorized temporary link).
- `policy-review.md` is generated directly from the exact application policy/terms text for readable owner review; `submission-packet.md` contains Google fields and remaining evidence gates.
- Automatic approval initially rejected creating a temporary link. Chris subsequently explicitly approved that action, and the link was created for this preview only; provider expiry is October 10, 2026 at 18:52:27 UTC. The token is not committed. No project-wide deployment-protection setting changed.
- Website preparation and available browser checks are complete. Exact policy publication approval, real effective date, production deployment and readback remain before the website URLs can support Google's review. The submission packet lists the separate domain/scope/security/assessment/demo gates.
