# Released — UV profile verification wizard

Chris approved the exact paired release on 2026-10-19 at 03:54:48 UTC. Backend changes were applied in compatibility order, followed by the approved UI merges.

## Backend release
- UV migration: hosted `20261019035753_agentflow_profile_verification`; source `20261019032157_agentflow_profile_verification.sql`, SHA256 `3cc77401f4cac1da813f77d6b0f13c1d74df1f711b182308e43653300de3be65`.
- UV `agentflow-profile-sync` v5 ACTIVE; all four deployed files exactly match the reviewed source; existing HMAC authentication and verify_jwt=false preserved.
- AF `uv-profile-sync-worker` v8 ACTIVE; all four deployed files exactly match the reviewed source; existing bearer authentication and verify_jwt=false preserved.
- AF migration: hosted `20261019035819_uv_profile_verification_wizard`; source `20261019032157_uv_profile_verification_wizard.sql`, SHA256 `79c9851c9d533bb48f0ac8acb8c613090512a35a640c3d4de5bbed22f6158268`.
- All eight new/replaced production function bodies match source MD5 checks. ACLs retain authenticated-only own-profile RPCs, service-only worker/receiver calls, and postgres-only private completeness helper. Legacy status/settings RPC body hashes are unchanged.
- No bulk requeue or automatic agent confirmation. Post-migration confirmation/bio counts were both zero. No source activation, secret rotation, RLS-policy, intake, consent, A2P, messaging or dialer changes.
- Security advisor comparison: UV unchanged; AF adds only the three expected authenticated own-profile SECURITY DEFINER RPC findings. Existing unrelated findings were not modified.

## Reviewed candidates and evidence
- AF #465: approved head `80b1381e775bc949f7eee77879bd68b4b127e391`; squash merge `f8887f90db85540d67fcc3a74b5eac8d1b08c16c`. Merged tree exactly matches the reviewed tree.
- UV #23: approved head `0dd9006f28dbe3c53c3492f6d90dd5e16c719216`; squash merge `e6a5d4911a81aad33453ab3a802b8f91d6f58c7b`. Merged tree exactly matches the reviewed tree.
- AF all six exact-head workflows passed. UV profile sync run 39195593767: 120 frontend tests, exact-base application TypeScript, native PostgreSQL paired concurrency/receiver checks, 15 save-driven + 10 verification SQL scenarios, Deno typechecks, and real-component 1440px/390px browser checks. Reports frontend run 39195593949 and Reporting integrity/Dialer DNC/SMS consent/A2P workflows passed.
- Browser artifact 12161503419: both widths passed with five status reads and three intentional saves; no overflow, JS errors or unexpected external requests. Synthetic browser auth/transport; not signed-in production acceptance.
- UV CI 39195277378 passed 125 tests, TypeScript, lint and build.

## Live verification
- AF production READY: `dpl_CJusa7LzwrWSbueTfH9LPFkMR32F`, assigned to `www.fflagent.com`; secondary AF deployment `dpl_CkgfeA6usiGAvmvF6ErnBh1GB2hw` also READY.
- UV production READY: `dpl_4DhQUgzePhPpuxVVsF8nYQzWydjW`, assigned to `www.underwriterverified.com`.
- Canonical sites return HTTP 200. AF served asset `/assets/index-Dsf0UB5F.js` includes Get verified and complete_my_uv_setup. UV served asset `/assets/index-_QH7PgOi.js` includes profile_verified and the agent-confirmation tooltip.
- Live test page loads with CA license 234343 and the correct unverified state. Protected owner page DOM snapshot is identical before/after interface release; protected owner full-row hash excluding the newly added default column is unchanged (`c5f500770807d42caacb6136ce5b17b1`). No application browser errors observed on these public pages; browser-extension metadata errors excluded.
- Signed-in production wizard completion remains the user's acceptance step; the available AF browser session is signed out.

## Behavior and acceptance
Settings > My Profile > Get verified prefills the agent's current data. Require photo, first and last name, phone, email, NPN and one numbered state license; expiration never gates confirmation. Optional plain-text bio is limited to 2000 characters. Success/emerald badge waits for acknowledged publication and means agent-confirmed profile completeness, not independent credential verification. Slate View and outlined Copy actions replace gold. Relevant saved changes drive sync; pending UI checks stop after a bounded 30-second window.

The user will run real account acceptance. No production agent was confirmed or edited for testing. The live test profile has no photo and remains unverified until the agent completes the required fields and confirms the wizard.

## Recovery
Revert frontend deployments to hide setup if needed. Retain additive columns, confirmations, bio and version/revision history. Keep compatible receiver/worker parsers while new payloads exist; never roll the receiver back before producers and queued payloads are reconciled. No destructive canonical profile/license rollback.
