# Sticky Contact Numbers — release preflight

November 14, 2026 UTC. Result: source and backend drift checks PASS; publication requires the exact preview-pause authorization below. Production installation is NOT authorized or ready for unconditional execution.

## Verified candidate and current state

Executable source remains `a57ea11168fff51156b8d624b4966c10869d8dcd`; delivered candidate checkpoint `c9f84ddde9ab493189c942f10794c3ad685d654d`. All 78 pinned non-document files match candidate-manifest.json. Current main is still `2129fa8b195cee77ad75f614abe655facfad2725`. No code, test, migration or frozen release-package byte changed during this preflight. Feature tests were not rerun for documentation-only work.

Fresh SELECT-only comparisons match all 85 function definitions/owners/ACLs/security/search paths, 39 primary + six additional table catalogs including columns/constraints/indexes/triggers/RLS/grants, and all 381 migration version/name/statement-count/source fingerprints. The six guarded SMS/voice preimages therefore match. The four proposed migration identities and sticky objects/scope role are absent. All six independent complete Edge packages, including unchanged ClearPath, match every file and configuration field. Current versions: twilio-sms61, workflow-executor50, sms-consent-worker26, twilio-sms-webhook47, twilio-voice-inbound72, ClearPath25; all verify_jwt=false.

Seventeen open PR file lists were read across all pages. #429 overlaps the existing SMS worker/webhook and is deliberately excluded; #444 changes the separately tested ClearPath consumer and is excluded. Other direct overlaps are shared documentation. #530 contains Team Commissions production closeout records and must be preserved if merged. #486 optional-age/backfill remains independent. No PR was changed.

## Production size and security observations

| Existing relation | Estimated rows | Heap bytes | Total bytes, including indexes/TOAST |
|---|---:|---:|---:|
| calls | 9199 | 5046272 | 18112512 |
| leads | 2137 | 1032192 | 3923968 |
| clients | 46 | 24576 | 368640 |
| recruits | 6 | 8192 | 245760 |
| messages | 75 | 24576 | 147456 |
| sms_dispatches | 18 | 16384 | 73728 |
| dispositions | 24 | 8192 | 131072 |

These are catalog estimates, not exact customer-row counts. The sample showed one active session, zero idle-in-transaction sessions, zero transactions older than one minute and zero ungranted relation locks. This is not a reserved maintenance window. The existing tables are small enough to retain the rehearsed ordinary-index package; installation must still occur in a Chris-approved quiet window and recheck activity immediately, retaining lock_timeout=3s and statement_timeout=60s. Abort rather than relaxing guards. Fourteen existing cron jobs remain active, including the every-minute consent worker; no schedule was changed and none is a sticky activation job.

Live advisors were captured before any change: seven grouped security findings (one ERROR, five WARN, one INFO), six grouped performance findings (three WARN, three INFO), and no health findings. Groups may contain many affected objects, so these are not object-level counts. These are inherited production findings, not introduced by the uninstalled candidate. Preserve their full captured context for post-install delta comparison. The isolated candidate review remains zero new ERROR findings and six authenticated-definer warnings backed by actual-role tests; it is not human-independent sign-off. Existing public-RLS findings remain outside this feature's scope. Advisor reference: https://supabase.com/docs/guides/database/database-linter .

## Publication findings from authenticated dashboards

The connector environment endpoint returned403 on both projects; there is no local Vercel CLI/authentication. Authenticated dashboard fallback succeeded without a new login. No environment key value was exposed. A reveal attempt for the non-secret URL requested email re-verification and was cancelled without sending a code. No service setting was saved; only an account setup reminder was dismissed.

Exactly two projects match GitHub repository ID1170119250 under team_iPboOWpwdIQRwdxmA5GJp5Rq. Both are linked to cgarness/agentflow-life-insure, use main for Production, automatically assign production domains, have Preview Branch Tracking checked for all unassigned branches and have no deploy hooks. Both have Vercel Authentication protection for non-custom-domain deployments. Protection is not backend isolation. The primary Ignored Build Step is Automatic.

Current production deployments are READY at the exact tested base: agentflow `dpl_BkWJopDn2qqe76eomPdMMcyibrPg`; agentflow-life-insure `dpl_HMMPmAWo1Foz5kXsy6TAs6DSGgSZ`. Existing #530 produced READY previews on both (`dpl_Do4892SQ7uxdHeAp3F9HgTmP847a`, `dpl_xugXLPHEhLwcYhhXfgCgheb2iRFe`), corroborating automatic publication behavior. READY means a build completed, not that the app's backend runtime works.

Primary agentflow: filtered Production inventory shows VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY scoped to All Environments. Their values were not revealed. Preview also contains branch-specific credentials for codex/google-production-readiness; these do not establish isolation for the sticky branch. No shared variables are linked. Secondary agentflow-life-insure: project and shared inventories show none, and VITE_SUPABASE searches in Production and Preview show no results. Since this app reads those two Vite keys, reconcile the secondary build/runtime configuration before approving its frontend release. Do not invent keys, copy server credentials, or change that configuration under this preflight. This observation does not by itself prove the currently deployed app is broken.

Supabase integrations page: Deploy to production OFF; Automatic branching ON; Supabase changes only ON; branch limit3; working directory dot. Vercel connection only to primary agentflow: production credentials sync ON, Preview OFF, Development OFF, public prefix NEXT_PUBLIC_. These controls do not override manually configured All Environments VITE keys. Existing branch list has two non-default previews, plus production; the branch limit is not a safety control. GitHub #530's Supabase check skipped because docs-only; sticky changes would match its supabase path trigger. Current main's check skipped because it was not associated with a Supabase branch; do not infer future safety from that skip.

All40 current checked-in Actions workflows were inventoried. The eight workflows referencing production-capable Supabase secret names are workflow_dispatch-only; no automatic hosted deployment was found in these repository workflows. The separate GitHub/Supabase/Vercel integrations are the automatic side effects. The GitHub workflow-list API route was unsupported; exact-base checked-in workflow source and current check-runs were used instead.

## Exact next approval: publication preparation only

After a fresh settings/base check, approve these three reversible changes:

1. agentflow (`prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc`): Preview environment Branch Tracking ON→OFF.
2. agentflow-life-insure (`prj_PctERc2MEVcpKkYtBtQYc1ruunKb`): Preview environment Branch Tracking ON→OFF.
3. Supabase jncvvsvckxhqgqvkppmj GitHub integration: Automatic branching ON→OFF, retaining Deploy to production OFF, existing branches, branch limit, working directory and all other settings.

Verify all three saved states BEFORE any push. This pauses future automatic previews for other new branch/PR changes in these projects during review; it does not stop existing preview instances or production service. No environment value, security protection or production branch mapping changes. Leave the pause in place for the review; restoration is held until queued events and branch state are reviewed in the same release packet. Stop if any target or setting differs.

Then publish only local branch prereq/sticky-numbers-baseline-20261113 (source frozen at a57ea111 plus documented local verification/doc commits), open one draft PR against main and inspect existing isolated GitHub CI. Do not merge main, dispatch production workflows, provision a preview, deploy DB/Edge/frontend, configure secrets, seed history, activate modes or send communications. Stop if an unexpected integration starts a deployment; no rollback/cancel action outside this exact scope is implied. A failure before verified isolation leaves publication held.

This is a proposal requiring Chris's explicit approval, not work performed. The existing exact off-by-default installation packet remains the sole later production approval record, with unchanged SQL/Edge/source hashes. It now references these concrete publication settings and the secondary configuration gate.

## Context snapshot

Changes: docs/evidence only; recovered dashboard access and closed source/backend-drift ambiguity. Decisions: preserve the frozen implementation; pause automatic previews before review publication instead of assuming isolation. Migrations/deployments: none. Verification: exact85/45/381 catalog/history matches, six complete Edge matches,78 source hashes,17 PR file lists,40 workflow sources and live dashboard state; historical local acceptance evidence retained. Blockers: approval of the three preview settings and draft publication; secondary production config verification; final approved install window/security review and exact production release; pilot identities/readiness/history/recipients/activation still held. Next: execute only approved publication preparation, collect actual PR CI, then finish the held off-by-default release preconditions.
