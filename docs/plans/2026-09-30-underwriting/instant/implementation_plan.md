# FEATURE / BUGFIX — Instant stated-history underwriting

## Approval and baseline
Chris approved this revision with “Proceed” after reviewing the proposed change: remove routine follow-up screening, recognize common conditions including high blood pressure, assume unlisted conditions absent for a disclosed quick screen, and keep uncertainty in short optional carrier-card notes. Implement directly on work/fflagent-underwriting-v1 / draft PR #398. Starting head 3396e1f9371da30151f230eceef07cf1a72b2042. No merge/main push, production release, Supabase/backend mutation, provider activation or environment/DNS change is approved.

Read AGENT_RULES.md, VISION.md and current WORK_LOG.md from the exact checkout before application edits. Check newer branch work for conflicts. Preserve the whole Work Log and existing task history. Existing source incompleteness and missing commission schedules remain explicit; this scope does not authorize invented carrier rules or live AI service activation.

## Behavior
1. Basics + typed known history immediately yields three short carrier cards. No automatic oxygen/care/hospital/other-conditions questionnaire. Keep dark AgentFlow style and branding.
2. Visible, single-line notice: “Based on the details entered. Unlisted conditions are assumed absent for this quick screen.” Treat this as an evaluation assumption, never store it as an agent-confirmed medical/application answer. Previously entered yes/unknown/contradictory facts always take precedence. Do not infer missing subtype, severity, diagnosis age, event or treatment dates for a listed condition.
3. A typed but unidentified condition is unresolved, never absent. Preserve original wording, show concise clarification/suggestions with optional correction, prevent unsupported green; independently proven exclusions can remain red. Remove any unconditional dismiss control that can silently turn an unresolved clinical fact into clearance.
4. Add high blood pressure, high BP, HBP, HTN and hypertension normalization. Distinguish systemic from pulmonary hypertension; do not map low blood pressure or negative/family history to positive hypertension. Confirm uncertain spellings instead of silently changing a clinical concept. Add additional common aliases only where recognition is justified. Recognized condition vs missing underwriting rule are distinct states.
5. Review the approved carrier source for hypertension. Implement only an explicit supported product-specific rule with provenance/page/version; otherwise yellow “Condition recognized—carrier guidance needs review.” Never treat recognition as carrier acceptance. Preserve full native evaluator defaults and unrelated carrier rules.
6. Required missing qualifiers become concise card notes (e.g. cancer type and last-treatment date). No mandatory question chain; agents may voluntarily add detail in the existing composer. Unknown remains unknown. No fabricated approval probabilities, quotes or commission ranking.
7. Green is a conditional preliminary source-supported screen using declared assumptions, not a carrier-issued decision or confirmed full history. Missing rules, important qualifier uncertainty and unresolved language stay yellow.

## Intended files
- src/underwriting/chat/{QuickUnderwriting,ChatComposer,CarrierCards,CapturedFacts,useQuickUnderwriting}.tsx/.ts where applicable
- src/underwriting/chat/{phrases,parse,evaluate,types,session}.ts; new focused assumption/recognition helpers if needed
- src/underwriting/data.ts and rules/transamerica-conditions.ts only if supported hypertension taxonomy/rule is verified
- tests/underwriting/** and src/underwriting/__tests__/host.test.tsx
- docs/plans/2026-09-30-underwriting/instant/**, parent chat plan/verification and WORK_LOG.md
- AGENT_RULES.md only for the newly established stated-history vs confirmed-answer invariant
- Temporary branch-bound checkout/transport/verification helpers may be used when container networking is unavailable; remove after use. Do not alter production workflows, lockfiles, global CSS, CRM App.tsx, dialer, telephony or backend schema.

## Verification
Run npx tsc --noEmit, strict feature checks, existing core/source tests plus new regression tests, actual React tests, scoped lint and Vite build. Compare whole-app diagnostics to unchanged base rather than claiming the repo is globally type-clean. Test common/unknown/negated/family/ambiguous conditions, hypertensive vs pulmonary terms, assumptions not written back, immediate results without follow-ups, missing date/subtype details, explicit uncertain and adverse corrections, medication confirmation and reset. Browser tests on actual built route at 320/375/390/768/1440, Chromium and WebKit as available; retain XSS/privacy checks and exact-source fingerprints. Physical iPhone is not claimed from emulation. Update newest-first Work Log and PR with honest completed/pending checks and an observed READY preview URL.

## Implemented locally

Removed Followups from the active chat and stopped calling hidden nextQuestions/contextualReply in its hook. Legacy question helpers remain for historical/native tests, not mounted or used to interpret unasked replies. Added an ephemeral statedHistoryScreen adapter, optional one-line card detail notes, longest-match diagnosis recognition, controlled-systemic vs pulmonary hypertension rules, condition-spelling confirmation, and targeted unresolved-wording edit mode without an unconditional dismiss button. Unrecognized original clauses are preserved rather than reduced to a lossy word list. Added common recognition-only identities without inventing carrier outcomes.

Regression coverage includes explicit unknown/adverse information overriding assumptions, no hidden form confirmations, no inferred dates/BP control, medication identity not diagnosis, systemic/pulmonary/low-BP distinctions, misspelling confirmation, original context retention and correction isolation. AGENT_RULES records the stated-history invariant. No remote model, external terminology service, backend write, CRM/global styling change or production release.
