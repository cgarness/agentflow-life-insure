# Candidate verification — 2026-10-19

Status: local candidate verified; not published, applied, merged or deployed.

- 109 frontend tests passed across UV controls, Agent Profile, My Profile and setup-wizard-removal contracts. Includes protected owner link, no protected sync RPC/settings, wrong identity/agency/View As/sign-out/loading rejection, no settled status polling, maximum pending refresh window, and saved-data versus presence changes.
- 15 save-driven SQL scenarios passed on PGlite using the complete actual new migration with synthetic Vault, pg_net and cron stubs. Checked original finish-function/cron preimages, preserved ACLs, no private helper access, idle/no-op/unpublished behavior, one first-opt-in dispatch, saved changes, rolled-back saves, dispatch failure recovery, obsolete leases, backoff, expired leases, license deadlines and duplicate-label handling, source disable/re-enable, exclusions, deactivation, tenant transfer and deletion tombstones.
- Existing paired suite: 24 SQL and real worker/receiver-handler scenarios passed on PGlite. This exercises the previously deployed base migrations and unchanged Edge protocol, separately from the 15 new-migration scenarios; it is not a native concurrency result for the new triggers.
- `npx tsc --noEmit` passed. App project comparison against exact main a18874e13e674020039264944d07b22d5b8eb855 has identical diagnostics (230 output lines each), with no new diagnostics. The existing app-project errors were not repaired by this task.
- Scoped ESLint passed. Production Vite build passed with existing large-chunk warnings. `git diff --check` passed.
- Read-only production check confirmed the actual pg_net and cron function signatures accept the named arguments used by the candidate. Current finish body MD5 is `9f1f6e670dc5d07ef2d042458e1fdd73`, RPC ACL remains postgres/service_role only. Named job command MD5 is `00cc7e5adf58d661d709c2df08a07196`. These preimages are enforced by the candidate migration.

Limits: HTTP/Vault/cron were simulated in local SQL tests; no real secret or consumer data used. No new authenticated production walkthrough or signed live-agent save/delivery was performed. Chris requested live acceptance after launch. Native PostgreSQL is unavailable locally; an attempted package-manager setup failed due runtime UID/group restrictions and was not bypassed. The existing GitHub native job now includes the 15 new-migration scenarios and must pass before release. No native/concurrent or browser screenshot result is claimed for this candidate.

Live preflight remains: enrolled sync rows 0, protected Chris exclusion 1, UV job 14 active every minute. No production mutation occurred during this task.
