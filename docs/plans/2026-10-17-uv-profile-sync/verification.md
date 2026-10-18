# Reconstructed candidate verification

This replaces assumptions about the unavailable earlier local AgentFlow candidate with evidence for the reconstructed source. No production or real-user test writes.

Local: 98 tests pass (22 new integration API/hook/control tests plus 76 existing profile regressions); 19 paired synthetic SQL/actual-handler scenarios pass in independent PGlite databases using service_role for worker/receiver RPCs. Root npx tsc --noEmit passes. Changed frontend ESLint passes. Vite production build passes. App typecheck has 84 diagnostics, none in the new modules; exact-baseline equality passed locally and in cloud runs 39085248605 and 39085953035.

## CI corrections and native evidence

Native run 39085248605 exposed a test-driver mismatch: PGlite requires an encoded JSON parameter while postgres.js encodes JSONB itself. The harness now stringifies only for PGlite; no application or authorization assertion was bypassed. The same 19 local scenarios passed again after this correction. An extra blank line at EOF in the Work Log entry template was also removed; the existing WORK_LOG.md content was preserved.

Run 39085953035 passed all 20 native PostgreSQL scenarios, including concurrent worker claims, using the complete actual AF/UV handlers and both candidate migrations. Its Deno check exposed an overly broad Uint8Array return annotation on signedBytes; both repositories now retain the actual Uint8Array<ArrayBuffer> type. Signing bytes, authentication, runtime logic, and protocol version are unchanged. Paired source is now pinned to UV 9fae219222e954bfb9fbe1421c2c223b6417b756. Protocol and payload modules must remain byte-identical; the paired test asserts this. The final exact-head CI rerun must validate this type correction, not inherit success from an older SHA.

The UV workflow omits npm's informational install-time audit to match other scoped CI jobs; no dependency, lockfile or test gate was removed. The earlier AF install reported 43 inherited dependency advisories, including 3 critical, in the unchanged dependency tree. Those require separate dependency-security triage and are not silently fixed by this feature.

Coverage: default-off/no enrollment, authenticated-only self preferences, identity/organization preconditions, stale preference rejection, false-by-default contact sharing, live profile and license reads, unchanged no-op, duplicate/lost acknowledgement retry, replay prevention, outage recovery, opt-out versus in-flight publication, invalid image withdrawal, license expiration/removal, existing identity/owner/slug/consent and biography preservation, agency disable, organization transfer, deletion, no requests/data under View As, stale async read/save isolation, compact settings and real canonical View/Copy controls.

Limits: fixtures are synthetic minimal baseline schemas, not live-schema proof. Deno check is a typecheck, not a hosted Edge deployment. No authenticated production browser walkthrough, hosted function invocation, cron, credential configuration, ownership mapping, public profile activation, migration or advisor-after-change result is claimed. Final CI run details belong to the linked PR #456 review record; release gates remain in release.md.
