## 2026-10-17 — AgentFlow → Underwriter Verified profile sync reconstructed (approved isolated build; NOT released)

**Status:** Recovered after interruption. UV receiver remains in draft PR #18. The AF transfer stopped at 77347a0f; the uncommitted candidate was unavailable and was rebuilt rather than treated as recovered. Source is now paired with UV 869d95e. Original scoped plan retained; recovery details at docs/plans/2026-10-17-uv-profile-sync/recovery.md.

**Changes:** Opt-in public profile controls on Agent Profile/My Profile; separate public phone/email choices; own-profile/organization/revision checks; durable leased/versioned worker and receiver contract; canonical fresh license/profile reads; retries and privacy tombstones. Normal profile/license saves and telephony unchanged. Existing UV identity/URLs/ownership/consent and UV-owned content preserved. Both activation gates default off.

**Files:** scoped plan package; src/lib/uv-profile/api.ts; useUnderwriterVerifiedProfile.ts; two underwriter-verified components; two profile composition insertions; src/test/uvProfile.test.tsx; shared UV protocol/payload and worker index/handler; only the new config block; migration candidate 20261018002956_uv_profile_sync.sql; paired.mjs; read-only UV CI. Removed interrupted transfer payload/writer.

**Verification:** 98 frontend/profile tests; 19 paired synthetic SQL/handler cases in isolated PGlite databases; root TypeScript, changed-file lint and Vite build pass. App typecheck retains 84 pre-existing diagnostics; exact-baseline comparison, native PostgreSQL concurrency and native Deno checks are CI gates. Inspect final-head CI before release. Earlier AF test totals did not verify the recovered candidate.

**Migrations/deploys:** NONE to production. No secrets, cron, ownership mapping, SMS, lead import, RLS application, frontend release or main push.

**Blockers/next:** final-head CI and browser acceptance; UV live management/schema preflight; exact separately approved UV backend/mapping, AF backend/credentials, frontend and pilot gates. New-profile intake/legal/owner access acceptance before provisioning. Actual verification is not part of this feature. Withdrawals are asynchronous and must be acknowledged before shutting down the worker. Deactivation/transfer revokes publication intent; reactivation requires a new opt-in.

---

