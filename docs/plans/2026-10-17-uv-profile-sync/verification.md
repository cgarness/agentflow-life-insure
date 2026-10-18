# Reconstructed candidate verification

This replaces assumptions about the unavailable earlier local AgentFlow candidate with evidence for the reconstructed source. No production or real-user test writes.

Local: 98 tests pass (22 new integration API/hook/control tests plus 76 existing profile regressions); 19 paired synthetic SQL/actual-handler scenarios pass in independent PGlite databases using service_role for worker/receiver RPCs. Root npx tsc --noEmit passes. Changed frontend ESLint passes. Vite production build passes. App typecheck has 84 diagnostics, none in the new modules; exact baseline comparison is enforced in CI and must pass before release.

Native CI is required to verify concurrent worker claims and the complete Edge entrypoints under Deno. Inspect the final candidate's workflow results; do not infer success from a previous SHA. Paired source is pinned to UV 869d95ebbcc646ec9c3b9b8e2f33aa66026fa037. Protocol and payload modules are asserted byte-identical between repositories.

Coverage: default-off/no enrollment, authenticated-only self preferences, identity/organization preconditions, stale preference rejection, false-by-default contact sharing, live profile and license reads, unchanged no-op, duplicate/lost acknowledgement retry, replay prevention, outage recovery, opt-out versus in-flight publication, invalid image withdrawal, license expiration/removal, existing identity/owner/slug/consent and biography preservation, agency disable, organization transfer, deletion, no requests/data under View As, stale async read/save isolation, compact settings and real canonical View/Copy controls.

Limits: fixtures are synthetic minimal baseline schemas, not live-schema proof. No authenticated production browser walkthrough, hosted Edge deployment, cron, credential configuration, ownership mapping, public profile activation, migration or advisor-after-change result is claimed. Release gates remain in release.md.
