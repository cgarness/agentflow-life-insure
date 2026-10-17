# Dashboard Callbacks Detail Modal — one-modal production experiment

**Owner authorization:** Chris requested the Callbacks dashboard detail modal alone be modernized in live production for side-by-side evaluation, October 16, 2026. Frontend-only; other dashboard detail modals are deliberately outside scope.

## Source of truth and base
- Reviewed AGENT_RULES.md, VISION.md, newest WORK_LOG.md, Dashboard.tsx, DashboardDetailModal.tsx, and dashboard-callbacks.ts.
- Base production SHA: 91eabff1896e9410a53a40afea6144336902b86d (Vercel READY).
- Canonical callback read contract stays intact: campaign_leads + appointments union, per-source callback ownership, stable global ordering, bounded 30-day lookback/4-day lookahead, 20-row pages, and request-generation/pagination serialization.

## Files to touch
- src/components/dashboard/DashboardDetailModal.tsx — callback-only presentation branch, unchanged canonical data loaders and call dispatch.
- src/components/dashboard/DashboardCallbacksModal.tsx — compact, accessible callback-specific dialog, status tabs and search limited to loaded rows, truthful counts, View/Call buttons, error/retry, responsive scroll/footer.
- src/components/dashboard/__tests__/dashboardCallbacksModal.test.tsx — new filters/actions/errors tests.
- src/components/dashboard/__tests__/dashboardCallbacks.test.ts — retain existing pagination and stale-request assertions with the new portaled dialog and Load more label.
- docs/plans/2026-10-16-dashboard-callback-modal/implementation_plan.md — this plan.
- WORK_LOG.md — newest-first verification and release entry.

## Design and behavior constraints
- The callback filters/search apply only to the already loaded rows and are explicitly labeled as such. No invented full-result count or search.
- All six other dashboard detail views stay in their original rendering path.
- No lead/contact/queue mutations, migrations, SQL, RLS, Edge Function, telephony change, scheduled job, or secrets.
- The canonical quick-call handler remains the only dialing path, including the existing contact-identity check and blocked-state behavior.
- Scroll pagination, page errors, and manual Load more continue to use the existing request generation and synchronous in-flight lock.
- Roll back the PR to restore the original callbacks presentation.

## Verification and release gates
1. Prepare isolated branch from verified main, and avoid direct commits to main.
2. Run dashboard tests, production build, ESLint on changed files, npx tsc --noEmit, strict app typecheck diffed against clean baseline, and git diff --check.
3. Publish PR and verify exact-commit CI results and Vercel preview.
4. User's production request authorizes this one-modal rollout only; merge after the required checks succeed.
5. Confirm production READY and alias for exact merge commit. No authenticated signed-in smoke test is claimed until performed.
