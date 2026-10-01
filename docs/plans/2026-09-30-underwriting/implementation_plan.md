# FEATURE — FFL Agent Underwriting: direct integration

## Authority and scope
Chris approved proceeding with the existing underwriting plan and explicitly requested ChatGPT perform the work rather than hand it to Cursor or Claude. Implement on work/fflagent-underwriting-v1, based on main 5fc4649f45a323c1ddc0863ffb4ec7fd0bb3f326. No main push, merge, production deployment, Supabase mutation, DNS or environment changes are authorized by this integration step.

Canonical requested destination: https://fflagent.com/underwriting. Preserve the requested /underwritin alias. First-release scope remains Final Expense / Whole Life, Americo, Transamerica and Mutual of Omaha. No premium quotes or commission-dollar estimates.

## Read-only findings
- Reviewed AGENT_RULES.md and VISION.md for the inspected base; public entry must not import the CRM provider graph.
- src/App.tsx globally mounts Auth, Calendar, Notification and Twilio providers. Keep App.tsx unchanged; choose the standalone entry before its dynamic import.
- src/main.tsx is currently the five-line static App bootstrap. vercel.json already rewrites deep links to index.html.
- WORK_LOG.md is NOT empty. fetch_file returned an empty body; the contents endpoint returned its real history. Its inspected Git blob is 5091dd4bf5addb6578a6a8251619d8e2e4ea3682. Preserve every existing byte and prepend only this task's entry.
- No underwriting branch existed. GitHub reports push permission; feature branch creation succeeded.
- The previous isolated package exists and is being re-validated, not assumed to have passed full-repo integration.

## Exact intended file scope
- src/main.tsx (isolated dynamic entry dispatcher)
- src/underwriting/types.ts, data.ts, sources.ts, validation.ts, schema.ts, engine.ts, routing.ts
- src/underwriting/UnderwritingPage.tsx, bootstrap.tsx
- src/underwriting/rules/americo.ts, mutual.ts, transamerica.ts
- src/underwriting/ui/dom.ts, icons.ts, fields.ts, basics.ts, health.ts, questions.ts, results.ts, commission.ts, mount.ts
- tests/underwriting/engine.test.cjs, source-contract.test.cjs, browser integration tests as required
- tsconfig.underwriting.json (isolated strict check)
- docs/plans/2026-09-30-underwriting/implementation_plan.md, VERIFICATION.md, SOURCE_RECONCILIATION.md
- WORK_LOG.md (newest-first addition, old bytes preserved)
- Feature-scoped GitHub Actions validation/integration support only if required to obtain a full checkout and run locked-dependency build checks. No production credentials; no production deployment. Any temporary write-capable integration support is branch-bound, checksum-guarded and removed after use.

## Implementation sequence
1. Re-run isolated evaluator/source checks and inspect the actual UI modules.
2. Integrate the package without changing existing dependencies, App.tsx, index.css, Tailwind configuration, CRM, dialer, database or existing workflows.
3. Validate React/Zod host and Tailwind 3 in the real repository; compare app TypeScript failures against the exact base instead of declaring pre-existing errors fixed.
4. Add feature regressions: aliases, unknown-not-no, tier ceilings, validation, invalidation, reset, privacy, safe text rendering, failed bootstrap and no CRM provider import on underwriting routes.
5. Run npx tsc --noEmit; strict feature typecheck; relevant tests; npm run build; actual built-browser checks when supported. Record unrun gates accurately.
6. Prepend a truthful Work Log entry, preserve the original log, open a draft PR and inspect its diff and build results.
7. Stop before merge/production deployment pending reviewed release approval and source-readiness gates.

## Source and ranking invariants
- Americo 24-275-1 (11/25) is Chris's approved reference. Select 2 ceilings are not offers. No inferred Select 1 for nonsmoker COPD. Diabetes-complication/nicotine ambiguity remains explicit.
- Transamerica is held: on this review, the same URL again returned text describing Premier/100k while screenshots show Select-only/50k. Do not combine versions or activate disputed outcomes.
- Mutual of Omaha uses only Living Promise sections. State application mapping and visual verification remain required; generic impairment lists are not decision tables.
- No undocumented health rules, approval probabilities, medication-derived diagnoses, or mock production cases.
- Commission schedules are missing. No default winner. Optional in-memory agent-entered references are marked unverified and compared only for complete, in-date, equivalent supported candidates.
- No source PDFs or confidential schedules are public assets. Producer-use permission/presentation review remains a launch gate.

## Safety and verification boundaries
No Supabase changes or backend commands. No production data access needed. No health data in storage, URLs, logs, analytics or remote AI requests. No secrets. Future tenant records require organization_id and RLS; schema changes require migrations and separate exact approval. No change to telephony. UI uses Tailwind; forms are Zod-validated. Public entry and CRM navigation use separate document loads.

## Status
Feature branch created. Implementation and full-repository checks in progress; no application commit, PR, merge or deployment is claimed by this initial plan entry.

## As-built source expansion — 2026-09-30 Pacific

The preceding initial Transamerica hold is historical. Exact direct PDF retrieval resolved the mismatch; see SOURCE_RECONCILIATION.md for hashes and supported scope. Added transamerica-data.ts, rules/transamerica-conditions.ts and ui/transamerica-questions.ts, extended source/boundary and real-browser tests, and visually verified Living Promise table columns. Local core tests: 389 passed. The full integrated first release passed run 36814772583; expanded integration checks follow this commit. All code remains on the approved feature branch, with no production changes. Final verification is recorded separately; unknown rules and missing commission schedules are not silently filled.

## Approved chat-first revision
Chris rejected the four-stage form in favor of compact basics, one notes composer, concise color-coded results and medication spelling confirmation. He approved the AgentFlow dark style and existing logo, with no CRM integration. Detailed approval/scope and as-built limitations are in chat/implementation_plan.md. This supersedes only the public entry UX, not carrier-source or production-release gates.
