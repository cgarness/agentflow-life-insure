# FEATURE — AgentFlow Quick Underwriting, chat-first revision

## Approval and scope
Chris approved the proposed chat-first replacement and explicitly requested ChatGPT build it directly. He approved AgentFlow's existing dark styles and logos, with the tool outside the CRM. This is approval to implement and test on work/fflagent-underwriting-v1 / draft PR #398, not to merge main, mutate Supabase, expose secrets, or change production/DNS/environment settings.

Inspected starting head: 7336504943d017ae512a049790b435a1a97b489f. Read AGENT_RULES.md, VISION.md, task plan and PR metadata. WORK_LOG.md fetch_file returns empty despite a nonempty blob; obtain the actual checkout and read it before implementation, preserve its entire content and prepend the new entry only.

## Approved experience
- AgentFlow dark styling and existing brand assets, public standalone /underwriting with existing /underwritin alias.
- Compact age, state, height, weight, smoker/nonsmoker controls. Recently quit/other nicotine/unknown available without guessing classification.
- One health-and-medication chat composer. No long diagnosis/medication questionnaires, source-application checklist or commission form in the main flow.
- Natural notes and follow-up replies add explicit structured facts. Negation, historical dates, uncertain statements and corrections must not silently become favorable answers.
- Medication misspellings generate reviewable suggestions; confirmation required for uncertain matches. Never diagnose from a drug or send the full health note to a terminology API.
- At most two short, decision-relevant questions at a time. Short green Likely fit, yellow Possible fit, red Likely decline cards, with native tier only when supported, benefit type, one reason, details collapsed.
- No actual approval probabilities; no yellow 50% or false carrier-issued decline. No fabricated premiums/commissions. Verified comparable compensation may sort eligible peers; missing schedules display a short unavailable note.
- UI supports corrections and reset and invalidates stale results; memory-only by default.

## Implementation and file scope
1. Obtain exact branch checkout and locked dependencies through isolated read-only GitHub runner if necessary; inspect all underwriting files, current Work Log and branding components.
2. Build new React chat components under src/underwriting/chat/, wire UnderwritingPage.tsx to them. Keep components under 200 readable lines; Tailwind only and Zod form validation. Reuse existing dark theme tokens/assets without changing global CRM CSS.
3. Implement typed fact extraction, confirmation and targeted follow-up orchestration. Preserve the source-backed evaluators; add a separate explicit quick-screen adapter where needed, never set unasked carrier-application answers to No or claim an application has been reviewed.
4. Assess secure AI interpretation feasibility. No frontend credentials. Any remote processing must use a narrow server endpoint, bounded validated extraction schema, private-response headers, timeouts and cost/abuse controls. Do not activate an unconfigured external AI service, deploy Supabase functions or change environments without exact approval. Clearly distinguish local supported-language interpretation from a live AI model.
5. Add parser/negation/medication/updates/ranking regressions and actual React/browser tests for dark styling, compact layout, keyboard/mobile, reset and XSS. Retain legacy engine tests. Update feature checks/scripts/configs only as necessary.
6. Run npx tsc --noEmit, strict feature checks, scoped lint, full Vite build, baseline app diagnostics comparison, Chromium and WebKit where available. Record actual tested SHA and artifacts. Physical iOS is not claimed from emulation.
7. Prepend WORK_LOG.md, append the parent task plan and update verification. Publish only this feature branch, update draft PR #398 and verify the preview.

Expected changes: src/underwriting/UnderwritingPage.tsx; new src/underwriting/chat/**; narrowly scoped shared underwriting types/validation/schema/engine helpers if needed; tests/underwriting/**; feature host tests; scripts/underwriting/** and .github/workflows/underwriting-checks.yml if needed; task documentation; WORK_LOG.md. Optional new preview-only server endpoint requires documented controls and remains unconfigured without explicit provider setup. No App.tsx, CRM/dialer/telephony/RLS/schema changes. Temporary checksum-guarded, branch-bound integration/checkout workflows may be used and removed after use.

## Release boundaries
Existing Americo ambiguity, Mutual state-question coverage, carrier producer-material permission and missing real commission schedules remain explicit. Do not fill those gaps with AI or a mock ranking. Source PDFs are not public assets. No production deployment or merge in this revision.
