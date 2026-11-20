## November 20, 2026 Pacific — manual-dial hotfix installed

Chris approved the exact Revision 2 packet. The one-function correction was applied to primary AGENTFLOW CRM as `20261120230232_sticky_unsaved_reconciled_call` at **3:02:32 PM Pacific**, advancing history to388 records. Both sticky channels remain enforced for Chris's agency; other organizations and the existing cap correction are unchanged.

Manual numbers with no saved CRM contact can now use new/reconciled empty history or reuse an established voice/SMS identity. The original guard incorrectly demanded a contact for these states. Only the private scope predicate changes; saved/hidden-contact access, review/reservation, actor/org/campaign/lock, DNC/readiness, binding and telemetry protections remain. The full unsaved call -> confirmed callback/provider evidence -> pin recovery -> repeat admission lifecycle passes.

Verified132 checks:38focused,66existing native,20cap,8migration/inverse/drift/data-preservation. Exact production SQL, nine function/security postimages, state constraints and unchanged setting fingerprints pass. Advisors add no findings. Native tests used managed PostgreSQL17.6 with synthetic fixtures and blocked external networking; no real call/text was placed. Root TypeScript and JS syntax pass; prior app/mobile limitations remain.

Exact files: new migration and rollback with recorded version20261120230232; `scripts/sticky-numbers/manual-dial-tests.mjs`; [manual-dial hotfix closeout](manual-dial-hotfix-2026-11-20.md); this focused-plan prefix; newest-first `WORK_LOG.md`. Preserve all prior content. No runtime deployment or main merge is needed; source publication stays on draftPR531. The earlier local empty-history-only candidate was never deployed and is superseded. Agent retry remains the practical live confirmation.

---

## November 20, 2026 Pacific — pinned voice cap correction installed

Chris authorized: “Ok correct the cap behavior and then I will run tests.” The exact correction was applied to AGENTFLOW CRM (`jncvvsvckxhqgqvkppmj`) as migration `20261120193109_sticky_pinned_voice_cap` at **11:31:09 AM Pacific**. Both sticky channels remain enforced for Chris's agency; the other five organizations remain off. The primary frontend and Edge packages are unchanged.

An established voice pin, or established SMS pin when voice is unset, now remains usable at and above the operational daily call cap. The database preview, call authorization and final admission use one endpoint-scoped helper. Rotation, one-call overrides, reservations and review states retain their existing restrictions. Ownership, active-number status, Inbounds-only exclusion, campaign groups, DNC, contact access, binding generation and telemetry are preserved.

Verified: six old defects reproduced; **20/20** focused actual-role cap checks; **66/66** existing native regression groups; **5/5** guarded migration/rollback/replay checks preserving exact content across 21 populated tables. PostgreSQL17.6 used the actual managed NOSUPERUSER postgres role. Root TypeScript5.8.3 and test-script syntax pass. The application TypeScript/mobile limitations in earlier records are not newly certified by this database-only change.

Production: all nine expected function definitions/security metadata match; the recorded migration statement is byte-identical to the tested 13,897-byte SQL (SHA-256 `6e88a3472e554ff38c98daa254bea4744dac98a7be82c637b43b6182de2a1bd4`). History is 387 records/head `20261120193109`. Fresh before/after modes, assignments, audit and communication aggregates match. Advisors add no findings; existing 2 security ERROR findings remain, and one performance INFO resolved. No real call/text was initiated by this work. Chris owns the live call/text acceptance.

See [the cap correction closeout](cap-correction-2026-11-20.md) for exact scope, tests, rollback and handoff. Prior statements that pinned numbers still block at cap describe the earlier installation and activation checkpoints; this correction supersedes that limitation. No main merge, secondary-project change, provider/number change, reseeding or arbitrary reassignment occurred.

---

## November 20, 2026 Pacific — approved pinned voice cap correction

Chris authorized: “Ok correct the cap behavior and then I will run tests.” Implement and release only the correction that keeps an established sticky voice number usable at its operational daily cap. Production target: AGENTFLOW CRM jncvvsvckxhqgqvkppmj. Current source is PR #531 at 9c8926bd897aa6ddd8b6ea156b817df8aa7da419; main is 2129fa8. Preserve enabled modes and all relationship, audit, communication and provider data. Chris owns real calling/texting tests; this work sends none.

Exact intended paths: root implementation_plan.md; this focused implementation_plan.md; AGENT_RULES.md (one cap invariant); WORK_LOG.md; focused ACCEPTANCE_TRACKER.md, verification.md and release-approval.md; new focused cap-correction-2026-11-20.md; new scripts/sticky-numbers/cap-tests.mjs; one CLI-generated supabase/migrations/*_sticky_pinned_voice_cap.sql and its guarded rollback under supabase/migrations/rollback/. Record the exact generated names before implementation. No existing applied migration is edited.

Design: keep private.affinity_number and private.affinity_default unchanged for rotation and all SMS readiness. Add a private, unexposed, security-invoker STABLE voice readiness helper taking organization, endpoint, number and current actor/group/override context. It delegates ordinary readiness and changes only daily_limit to ready for the endpoint's actual established voice pin, or established SMS pin when voice is unassigned, while voice is enforced/guard_only and no historical/channel review is pending. No caller-supplied flag can invent a pin; a reservation, arbitrary candidate, one-call override, personal number, foreign/missing/deleted/inactive/Inbounds-only number or group conflict receives no exception. Call only this helper from private.affinity_view, public.authorize_contact_call and public.admit_twilio_outbound. Preserve signatures, owners, ACLs, security modes, search paths, original admission, DNC checks, bindings and telemetry. The final admission re-evaluates actual current assignment and existing binding checks after the number's usage may have changed.

Frontend trace: verify actual pool population and preview binding, not comments alone. Current campaign pool retains active group numbers regardless of count; its membership check and caller ownership validation can remain unchanged. No frontend or Edge deployment is planned unless a reproducible test shows an additional cap defect.

Verification: recreate the prior isolated PostgreSQL17 baseline from preserved exact inputs, run the installed five-migration release under the managed NOSUPERUSER postgres role, then reproduce the old failure using actual authenticated authorization and service-role admission. Apply the new migration only locally and prove pinned-at/above-cap, SMS-established fallback, cap crossing between authorize/admit, preview read-only, guard_only continuity, rotation and one-off refusal, group/ownership/inactive/DNC/review/stale binding rejection, no broader grants, unchanged original functions and data. Run the relevant existing native suite to cover telemetry and authorization; root npx tsc --noEmit and JavaScript syntax/scoped checks. Rehearse guarded rollback on a separate isolated database; never apply it to production in this task.

Release: after tests and independent exact-SQL review, capture fresh live definition/security fingerprints and workload, compare advisor baseline, then apply the single drift-guarded migration with bounded lock/statement time. Read back exact definitions/owners/grants, migration statement, unchanged rotation helper, modes/assignment/audit/communication counts and advisor delta. Publish the exact files to the existing draft branch using expected-head compare-and-set, preserving unrelated local changes and all historical document text. No main merge, secondary-project operation, broad schema push, number/provider change, historical reassignment, cap-setting change or real communication. Save the release receipt and give Chris a concise test handoff.

## November 20, 2026 Pacific — agency sticky behavior enabled and verified

Chris's “Let’s enable the sticky behavior” instruction was completed for Family First Life - Chris Garness only (`a0000000-0000-0000-0000-000000000001`). Both voice and SMS are enforced as of 11:01:17 AM Pacific. The other five organizations remain off, with no cross-organization affinity writes.

One guarded transaction used the installed native functions: exact fingerprint/configuration checks, six settled disposition classifications, two fixed existing ClearPath allowlist routes, seven bounded dry-run/apply pages, and native completion-gated enforcement. Final result: 3,183 reconciled endpoints; two established SMS identities; 44 review; 3,137 unassigned. No historical voice identity, provider evidence, binding or completion marker was invented. All 22 agency numbers passed database readiness; provider handoff checks remain mandatory. No idle shadow period is claimed.

Immediate and post-UI readbacks agree; messages/dispatches remain 76/18, call bindings/bound dispatches zero. Reloaded authenticated contact preview exposes Calls/Texts/Change/Ready; no Call/Send/Change/Save action was taken. Nineteen preview RPC POSTs returned HTTP 200. Advisors add no findings; one unused-index INFO resolved. Installed voice caps still block at cap; no current number was at cap. No live call/media/SMS-delivery or activation-turn console check is claimed.

Exact documentation/receipt paths: root and focused `implementation_plan.md`, `WORK_LOG.md`, focused `release-approval.md`, new `production-activation-2026-11-20.md`, and `supabase/ops/sticky_numbers_activate_cg_financial_20261120.sql`. The applied operation is 25,396 bytes/SHA-256 `ba41c860604f745cb5c8be07d33ed9cf7396aac87979e360c33bf6262f07a8a1`; do not replay it. Runtime deployments, main and 386-migration history remain unchanged.

Refresh browser tabs for normal use. Preserve unresolved histories for deliberate review and guard_only for protective rollback. No main merge, secondary project, number/provider change, real communication, schema edit, arbitrary sender reassignment, consent/suppression change or resend was performed. Earlier all-off installation sections below describe their historical checkpoint.

---

## Historical installation records

All older all-off checkpoints below are preserved as history and are superseded only for Chris's agency by its authorized November 20 activation. The other five organizations remain off. These older records do not authorize repeating completed installation or activation operations.

## November 20, 2026 Pacific — primary installation verified; all sticky modes off

Chris approved the managed-role amendment and continuation of the exact primary-only release. The corrected five-migration transaction succeeded on `jncvvsvckxhqgqvkppmj`; history is now 386 records/head `20261120060345`, with the prior 381-record history unchanged. All five recorded source hashes and 55 function/11 table/1 role postimages match. Supplemental role checks confirm the intended postgres membership, no retained private-schema CREATE, and no application-role scope membership or direct helper execution. All six organizations retain voice/SMS off; settings, assignments, enforcement, reconciliation, classifications and internal-alert allowlist remain empty.

The five complete Edge packages are deployed and read back: SMS 62, workflow 51, confirmation worker 27, SMS webhook 48, inbound voice 73; all ACTIVE and `verify_jwt=false`. Every executable local dependency matches the approved source. Inbound bundling omitted only one erased TypeScript type-only dependency, as independently checked. ClearPath remains unchanged at 25.

Primary `agentflow` production deployment `dpl_56mpNPZEL3gNBBAqbHga3Es5Gq7f` is READY at frontend pin `f49e55b770b97155fac46f3e5eeae949ad9f3047`; both `fflagent.com` and `www.fflagent.com` point to it, with the apex redirect preserved. Authenticated contact preview passed, with no application console error and no call/text. The six observed browser-extension metadata errors are unrelated to the app.

Production advisors show zero new ERROR. The six authenticated-definer warnings and eleven private-RLS informational findings match the approved design. Twelve performance warnings enumerate existing PUBLIC policy combinations for the new restricted role; no policy DDL changed. Ten feature indexes are newly unused while the feature is off. Existing findings remain disclosed. Full record: `docs/plans/2026-11-12-sticky-contact-numbers/production-installation-2026-11-20.md`.

Final production checkpoint passed at 18:38:51 UTC (10:38 AM Pacific): exact history/postimages remain intact, all six organizations remain off, all eleven private feature tables are empty, and classification/bound-dispatch counts are zero. Authenticated preview logs show 17 POST and one OPTIONS request to `preview_contact_numbers`, all HTTP 200; the installed client uses this read-only RPC directly, not an Edge preview request. Production verification is complete; publish this documentation and the durable closeout. Preserve all original exclusions: no main merge, secondary-project work, seeding, activation, number/provider changes, or real calls/texts. Do not reinstall or replay the successful transaction. Pilot preparation and activation remain separate work requiring exact approval.

## November 20, 2026 Pacific — approved managed-role installation resume

Chris explicitly approved the three-statement role correction and resumption of the previously approved primary-only installation. Use the frozen amended installer SHA-256 `1d2d1a4d0a7872f6bc1e5c37e940fd37e8f4758c1ced56cda8df24017a9175b9` (191,807 bytes), five complete Edge packages, and frontend pin `f49e55b770b97155fac46f3e5eeae949ad9f3047`. Supabase target is `jncvvsvckxhqgqvkppmj`; Vercel is only `agentflow` / `fflagent.com`.

Exact documentation files to touch: root `implementation_plan.md`; focused `docs/plans/2026-11-12-sticky-contact-numbers/implementation_plan.md`, `release-approval.md`, new `production-installation-2026-11-20.md`; `WORK_LOG.md`. Record raw receipts and parsed summaries in the current operation directory and a durable closeout. No runtime source edits are planned.

Execute the documented ordered release: verify frozen payload hashes and current main/PR/primary domains; compare six database function preimages and six complete Edge preimages; capture migration-history digest, workload and security/performance/health advisors; run the approved five-migration transaction once with its 3s lock and 60s statement guards; require exact five history records, 55 function/11 table/1 role postimages, supplemental role permission checks, all modes off and no seed rows; compare advisor deltas. Then deploy and re-fetch each of the five pinned complete Edge packages in packet order. Deploy the exact approved frontend commit only to the primary, verify READY/source/domains and read-only behavior, and document the outcome.

On ambiguous transport, inspect current state before retrying. Retain all original exclusions: no main merge, secondary inspection/change, seeding, activation, number/provider setting changes, or real calls/texts. Existing user authorization covers this entire sequence; do not ask again for a step already approved.


## November 19, 2026 Pacific — managed-production role correction after atomic rollback

Additional exact verification/documentation paths: `scripts/sticky-numbers/managed-role-rehearsal.mjs` (new reproducible local-only production-role test), and `AGENT_RULES.md` (one managed-role rehearsal invariant). The release source manifest will include this test helper; no existing frontend or Edge source changes.

The approved installation was attempted once and rolled back on SQLSTATE 42501 at the first migration's ownership transfer. Production `postgres` is NOSUPERUSER/CREATEROLE/BYPASSRLS; the earlier isolated rehearsal used a superuser and missed the role SET and target-schema CREATE prerequisites. Readback confirms 381 migrations, head `20261113152433`, no sticky objects or role, and zero deployments. Do not retry the previous installer.

Isolated correction scope: amend only the never-applied foundation migration `supabase/migrations/20261114003115_sticky_contact_numbers_foundation.sql`, adding the existing production-project pattern `GRANT agentflow_affinity_scope TO postgres` plus temporary `GRANT CREATE ON SCHEMA private TO agentflow_affinity_scope` immediately around the ownership transfer, then revoke schema CREATE. This grants no scope membership to an application role and preserves the restricted owner's NOLOGIN/NOBYPASSRLS and authenticated RLS inheritance. Persistent installer membership also permits the existing postgres-owned wrappers to invoke the sealed helper and future migrations to manage it; it matches the existing commission operator/writer migrations. Four later migration sources, all frontend/Edge runtime source and pinned frontend remain unchanged.

Before any revised production attempt: reproduce the old failure with actual non-superuser postgres in isolated PostgreSQL17; test the complete revised five-migration installer and 66 native groups under that role; assert exact owner/function/table ACL postimages, role membership direction/options, no client membership, no final schema CREATE, all modes off and atomic rollback. Save a reproducible managed-role rehearsal and the new manifest/installer hashes. Update only the root/focused plans, WORK_LOG, focused release-approval/verification/ACCEPTANCE_TRACKER/candidate-manifest and production-installation record; add the managed-role test helper to the focused verification tools if required. Preserve the original approved artifact and failed-attempt evidence.

The production grant and revised installer are not covered by the previous frozen-hash approval. Finish the concrete correction and verification, then request approval only for this amendment. Previously approved primary frontend/Edge targets, no main merge, no secondary project, no seeding/activation/communications remain unchanged.

## November 19, 2026 Pacific — approved primary production installation

Chris explicitly approved the exact November 19 release packet: five migrations on `jncvvsvckxhqgqvkppmj`, the five frozen complete Edge packages, and frontend source `f49e55b770b97155fac46f3e5eeae949ad9f3047` on primary `agentflow` / `fflagent.com`. All sticky modes stay off. Main merge, secondary project changes, seeding, activation, number/provider changes, and real communications remain outside approval.

Exact executable payload: `install.sql` SHA-256 `8fc2e2f9822829e55496570d0c1ade708a969e3937e4de73f153ad0bbcf35bfc`; corrected postimages SHA-256 `663c58170e02358f2dd82c8bd39460b2fc88674aad11961703e567528f504814`. Source and packages are frozen; no implementation edits or new migrations are planned.

Documentation files for this release: this root plan; focused `implementation_plan.md`, `release-approval.md`, new `production-installation-2026-11-19.md`; `WORK_LOG.md`. Scratch evidence and a durable installation closeout record the exact approval, preflight, API receipts, readbacks, advisor deltas, hashes and final source/domain identities.

Execution: fresh repository/primary/domain, six DB preimage, migration-history, six complete Edge package and activity checks; capture security/performance/health advisors; execute the approved five-migration transaction once with retained 3s lock/60s statement limits; read back exact history/source hashes and 55-function/11-table/1-role metadata with zero settings/identity seeds; compare production advisors; deploy and retrieve each of the five complete Edge packages in approved order; deploy pinned frontend only to primary; verify READY/source/domain and read-only behavior; retain modes off and write newest-first Work Log. On ambiguous transport, read state before any retry. Stop on material drift or unsuccessful guard without changing the approved payload.

## November 19, 2026 Pacific — primary-only release follow-up and permission correction

CLI-generated migration path: `supabase/migrations/20261120060345_sticky_contact_numbers_edit_permissions.sql` (Supabase CLI 3.2.0; local file creation only).

Chris instructed continuation of Sticky Contact Numbers on `agentflow` (`prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc`, `fflagent.com`) only. The secondary Vercel project is out of scope and is not a release gate. Existing isolated implementation and draft-PR publication authority covers this correction; production installation, deployment, merge, seeding and activation remain separately held.

Baseline: PR #531 `dd3c9c418360a5977cb481902c4ee1a2b3d24be5`, main `2129fa8b195cee77ad75f614abe655facfad2725`, all 11 hosted workflows green. Current production has no sticky migrations; the six function preimages and all five full live Edge preimages match. All 22 active agency numbers are registered and selected; retain that newer setup. The canonical served frontend contains only the expected Supabase host and its public anon credential.

Concrete defect: `change_contact_number` checks row visibility/ownership but omits `has_contacts_permission('contacts.<type>.edit')`. Its shared-endpoint helper discards contact type. A NULL reason also bypasses its SQL length predicate. Correct these server boundaries without changing ordinary sending, previews, telephony, contact RLS or number registration.

Exact planned files: this root plan; `docs/plans/2026-11-12-sticky-contact-numbers/implementation_plan.md`; new `docs/plans/2026-11-12-sticky-contact-numbers/permission-hardening.md`; `WORK_LOG.md`; one narrow invariant in `AGENT_RULES.md`; a new CLI-generated `supabase/migrations/*_sticky_contact_numbers_edit_permissions.sql` (record the generated path before writing SQL); `scripts/sticky-numbers/database-tests.mjs`; focused `release-approval.md`, `verification.md`, `ACCEPTANCE_TRACKER.md`, and `candidate-manifest.json`. Release installation/postimage artifacts will be regenerated outside the repository with a reproducible scoped generator if needed; any additional committed generator path must be recorded before editing. Preserve all existing four migration bytes and all Edge/frontend sources.

Steps: generate the empty migration with `supabase migration new`; require the exact type-specific edit permission on the addressed contact and every same-phone contact while preserving ownership/hierarchy, real-actor and org checks; reject NULL/blank/out-of-range reasons and invalid channels; add actual authenticated-role negative/positive cases for leads/clients/recruits, mixed-type shared endpoints, Team Leader downline and Admin; prove the old candidate fails the new cases and the correction passes; run the existing native sticky suite plus exact package installation/history/postimage rehearsal; run `npx tsc --noEmit`, syntax/scoped lint on touched tests and the actual app TypeScript comparison as applicable. No production mocks, grants widening or remote SQL writes.

Verification environment: disposable PostgreSQL 17 on loopback, synthetic fixtures, no provider traffic or production credentials; install repository dependencies with the existing lockfile. Retain original CI evidence and regenerate only affected release hashes. Update the existing draft PR with the tested correction and primary-only release scope, never main. A later approved frontend release can target the primary project directly by exact Git SHA, avoiding a main-merge event.


Validation complete: old-candidate regression checks fail on the two confirmed defects; corrected66/66native groups, seven atomic release cases and zero-new-error advisor delta pass. Only two function definition hashes change; all owners/grants/security metadata remain exact. Full details: `permission-hardening.md` and updated `release-approval.md`. Primary-only publication uses the existing draftPR531; production remains held.

## November 14, 2026 Pacific — approved review publication

Chris approved the three exact preview pauses and one draft PR. Saved and reloaded: Preview Branch Tracking OFF on both agentflow Vercel projects; Supabase Automatic branching OFF, Deploy to production remains OFF, Supabase changes-only ON and branch limit3 retained. No credentials, production mappings, existing branches or protection settings changed. Main remains2129fa8; all78 frozen source files match. Publish only prereq/sticky-numbers-baseline-20261113, open one draft PR, inspect isolated CI. Production installation/merge/deployment, preview restoration, activation and real communication remain held. Documentation changes only: root/focused plans, WORK_LOG and focused release approval/publication record; source and migrations remain frozen.

## November 14, 2026 UTC — release preflight (read-only production)

Authorization: Chris said Proceed to the read-only release checks. No publication, production mutation, configuration change, pilot or communication is authorized.

Exact editable paths: root implementation_plan.md; WORK_LOG.md; docs/plans/2026-11-12-sticky-contact-numbers/implementation_plan.md; release-approval.md and new release-preflight.md in that same folder; evidence/release-preflight/*; the existing delivered approval Markdown replacement and a separate recoverable preflight evidence archive. Executable source, migrations, frozen package and source candidate remain unchanged.

Commands/actions: git status --short; git fetch origin main; git rev-parse HEAD origin/main; read current docs/workflows; GitHub GET open PRs/files/check-runs/workflows; Supabase SELECT-only captured catalog queries, migration history, relation sizes/activity/cron metadata; retrieve six live Edge packages; Vercel GET project/deployment/environment metadata; permitted read-only authenticated browser fallback if connector lacks fields. Compare complete normalized captures and all frozen source hashes locally; git diff --check; local doc-only checkpoint and archive checksum/CRC checks. Do not rerun feature tests absent code changes.

Complete:85/45/381 catalog/history matches; six complete Edge matches;78 source hashes; dashboard publication settings identified. Exact results and proposed three-switch/draft-PR authorization are in release-preflight.md. No settings/publication or production execution occurred. Secondary runtime configuration, quiet window/security review and production/pilot approvals remain gates.

# Sticky Contact Numbers — authorized isolated implementation

November 13, 2026 Pacific. Owner: Chris Garness. Integration owner: ChatGPT.

## Authority and exact base

The current user explicitly authorizes bounded prerequisite recovery and isolated Phases 1–5 under the complete attached takeover prompt. No repeated approval is required for this unchanged scope. Production is SELECT-only; publication is HELD. No push, PR, preview, deployment, main merge, provider operation, live history repair/backfill/activation, or real call/text.

Base: `2129fa8b195cee77ad75f614abe655facfad2725` (current origin/main). Accessible checkout searches and remote sticky branch search did not recover reported Claude commit `d070707`; do not claim recovery. Reconstruct only the two exact missing applied migration sources and scoped documentation. The supplied 9-entry manifest was verified locally. All six deployed function packages (75 returned source files) were captured independently, retaining version, verify_jwt, entrypoint, provider bundle digest and per-file SHA-256.

Read AGENT_RULES.md, VISION.md, current WORK_LOG head and the complete takeover/reference/acceptance requirements. Existing plans/logs are preserved by prepending. Open conflicting PRs: #429 (START), #444 (ClearPath), and documentation #530/#514 overlap shared docs; none will be merged/cherry-picked. Other open work is recorded in the external evidence capture.

## Prerequisite exact edit manifest

- `implementation_plan.md` — prepend this task and link here; preserve prior tasks.
- `WORK_LOG.md` — newest-first factual checkpoints.
- `docs/plans/2026-11-12-sticky-contact-numbers/implementation_plan.md` — this controlling execution record.
- `docs/plans/2026-11-12-sticky-contact-numbers/ACCEPTANCE_TRACKER.md` — preserve all 88 IDs, add correction assertions/evidence.
- `docs/plans/2026-11-12-sticky-contact-numbers/prerequisites.md` — source provenance, package drift, isolation, command evidence.
- `docs/plans/2026-11-12-sticky-contact-numbers/prerequisite-manifest.json` — exact hashes and metadata.
- `supabase/migrations/20261002203426_inbound_recent_outbound_routing.sql` — restore exact already-applied supplied bytes only if absent.
- `supabase/migrations/20261113152433_dialer_nonretryable_conflicts.sql` — restore exact applied statements read-only if absent.

Separate captures and disposable harness preparation remain outside the repository in `../evidence`, `../runtime`, and `../reference`. Downloads never overwrite repository function source. No applied migration is edited, reformatted or newly timestamped.

## Exact prerequisite commands / backend classification

Read-only production: Supabase get_project, list_edge_functions, get_edge_function for the five changed packages plus unchanged ClearPath, list_branches, list_migrations; SELECT migration version/name/statement counts/digests and the two missing statement arrays; SELECT scoped pg_proc definitions/owner/security/search_path/ACL plus dependency tables, columns, indexes, policies and trigger definitions. No SELECT invokes a mutating application helper. Store every executed query with its result. Vercel list_projects/get_project and environment metadata only (never decrypted secrets); GitHub branch/PR/file reads only.

Local: `git status --short`, `git log`, `git cat-file -t d070707`, `git switch -c prereq/sticky-numbers-baseline-20261113`; Python SHA-256/MD5/count verification and source comparison; `npm ci --ignore-scripts --no-audit --no-fund` after lifecycle inspection; existing pinned Supabase CLI `--version`, `--help`, and `migration new --help` only before generating new migrations. Local git commits disable hooks and have no remote side effects. No push.

Isolated database: native PostgreSQL 17 bound only to 127.0.0.1, a fresh task-owned data directory and synthetic credentials. Inspect repository migration chain/cron/net/Vault/hooks first. External dispatch extensions must be absent or replaced only by fail-closed test transports; real dial evidence, authorization, grants and core objects may not be stubbed. Preserve an explicit platform-only bootstrap/adaptation list; compare relevant replay definitions/security metadata with the production catalog. Do not claim a faithful baseline until this passes. No shared old test database is reused.

## Implementation and verification sequence

Prerequisites close before feature edits. Refine and enumerate exact feature/test filenames and CLI-generated migration identities here before editing them. Then implement the agreed persistent endpoint foundation, existing-ledger SMS binding/readiness/legacy compatibility, outbound and separate inbound voice evidence/bindings/recovery, shared UI including actual Dialer SMS, and bounded history/performance/rollback tooling. TAKEOVER.md corrections control over the historical plan; automatic SMS enrollment is excluded.

Run root `npx tsc --noEmit` AND `npx tsc --noEmit -p tsconfig.app.json`, scoped lint/tests, native SQL actual-role/HTTP/concurrency tests, downloaded old Edge package compatibility/serialized-From tests, browser/mobile/a11y workflows, 50,000 endpoints/100 concurrent distinct resolutions with same-base warm p95 added <=150 ms, cold measurements, production Vite build, migration/backfill/guard-only rollback rehearsals and isolated advisors where available. Record exact-base inherited failures rather than masking them. No live load test.

Export binary-safe local patch/bundle + hashes at milestones and verify recovery in a fresh checkout. One exact release approval packet will identify candidate/source/package hashes, current live preimages, all deployment targets, reconciliation/number-readiness/recipient/activation gates and protective rollback. Release remains held pending separate approval.

## Progress

| Milestone | Implemented | Verified locally | Published | Deployed | Production verified |
|---|---|---|---|---|---|
| Prerequisite recovery/isolation | Complete; reconstructed commit 6d62e773 | 9 hashes; six packages; 85 functions/45 tables match | No | No | Read-only capture only |
| 1 Foundation | Complete | Native role/RLS/scope/readiness and deletion proofs | No | No | No |
| 2 SMS continuity | Complete | Native CAS/races, actual Edge payloads, old packages, paused receipt replay | No | No | No |
| 3 Voice continuity | Complete | Actual admission/ingest/claim, inbound/outbound evidence, late recovery, existing SDK regressions | No | No | No |
| 4 UI/lifecycle | Complete | Real three-screen sends, mobile/focus/session/View As, regression suites | No | No | No |
| 5 Candidate/reconciliation | Complete | 52 SQL cases, scale with 55k assignments, replay/rollback/history transaction, build and source packages | No | No | No |

## Final context snapshot

Changes: source candidate `a57ea11168fff51156b8d624b4966c10869d8dcd`, complete isolated implementation and recoverable artifacts. Decisions: preserve stable identity/old consumers/call architecture; no automatic enrollment or merge feature. Migrations/deployments: native only, production unchanged. Verification: see verification.md, candidate-manifest.json and the 88-row tracker; inherited app type/global test limitations are retained. Blockers: publication isolation and exact production/pilot gates in release-approval.md. Next: deliver reviewed source/recovery artifact; await explicit authorization before any external publication or production action.

## Exact isolated implementation edit manifest — authorized November 13

New SQL identities are created locally with pinned CLI `node_modules/.bin/supabase migration new sticky_contact_numbers_foundation`, `sticky_contact_numbers_sms`, `sticky_contact_numbers_voice`, and `sticky_contact_numbers_reconciliation`; record each returned path below before editing content. No remote CLI command is authorized.

Exact source/test paths:
- `supabase/functions/_shared/sms/readiness.ts`, `affinity.ts`, `affinity.test.ts`, `dispatch.ts`, `manual.ts`, `scope.ts`
- `supabase/functions/twilio-sms/index.ts`, `workflow-executor/index.ts`, `sms-consent-worker/index.ts`, `twilio-sms-webhook/index.ts`, `twilio-voice-inbound/index.ts`
- `src/lib/number-affinity.ts`, `src/lib/__tests__/number-affinity.test.ts`, `src/hooks/useContactNumberAffinity.ts`
- `src/components/contacts/ContactNumberControl.tsx`, `ChangeNumberModal.tsx`, `src/components/dialer/DialerSmsComposer.tsx`
- `src/components/conversations/ConversationThread.tsx`, `src/components/contacts/FullScreenContactView.tsx`, `src/components/dialer/ConversationHistory.tsx`, `src/pages/Conversations.tsx`, `src/pages/DialerPage.tsx`
- `src/contexts/TwilioContext.tsx`, `src/lib/caller-id-selection.ts`, `src/lib/quick-call.ts`, `src/components/layout/FloatingDialer.tsx`
- `src/lib/sms-send/sendManualSms.ts`, `pendingSmsStore.ts`, `smsSendResult.ts`, `src/lib/sms-send/__tests__/stickyIntent.test.ts`
- `src/components/settings/DispositionsManager.tsx`, `src/integrations/supabase/types.ts`
- `scripts/sticky-numbers/run.mjs`, `baseline.mjs`, `database-tests.mjs`, `edge-tests.mjs`, `browser-tests.mjs`, `performance.mjs`, `fixtures.sql`, `platform-bootstrap.sql`, `run-local.sh`, `block-network.cjs`
- `supabase/ops/sticky_numbers_guard_only.sql`, `sticky_numbers_release_readback.sql`
- `docs/plans/2026-11-12-sticky-contact-numbers/verification.md`, `release-approval.md`, `candidate-manifest.json`, plus previously listed plans/tracker/log.

Only paths actually needed will change; this list does not require incidental refactoring. An exact new path will be recorded before adding it. No AGENT_RULES edit is planned; propose the invariant in the release packet.

Commands: local CLI migration generation; apply only new SQL to a cloned disposable `sticky_candidate` database using native PostgreSQL; actual SET ROLE/JWT claim tests, PostgREST loopback and Deno transport tests with no external network; Playwright through localhost with all nonlocal routes aborted; root/app tsc, scoped ESLint/Vitest and Vite build; synthetic 50k endpoint/100 concurrent measurements; local git diff/add/commit/bundle with hooks disabled. Local runner contains mandatory loopback/database-name assertions. Run same-base checks and preserve all outputs. No live provider transport.

Prerequisite checkpoint: `6d62e7733a103aa2fb43aae16a28a8248555ba21`, bundle verified. All 85 function and 45 table catalog comparisons have zero differences. UI/sender authorization will use current contact scope and freshly checked actual actor, never arbitrary raw-phone lookup. Database integration retains old SMS signatures and admission signature.

Generated foundation path: `supabase/migrations/20261114003115_sticky_contact_numbers_foundation.sql`.

Generated SMS path: `supabase/migrations/20261114003337_sticky_contact_numbers_sms.sql`.

Generated voice path: `supabase/migrations/20261114003652_sticky_contact_numbers_voice.sql`.

Generated reconciliation path: `supabase/migrations/20261114004102_sticky_contact_numbers_reconciliation.sql`.

Disposition integration requires these additional exact existing files: `src/lib/types.ts`, `src/lib/supabase-dispositions.ts`, `src/components/settings/dispositions/dispositionSchema.ts`. They will carry only the reviewed affinity classification through the existing Zod form/API; no labels, contacted counts or default outcomes are redefined. Native function additions remain within the four generated new migration files. Offline Edge checking uses the already-installed exact Supabase 2.98.0 npm package because esm.sh connection attempts were refused; that substitution is recorded, not described as a provider deployment check.

Test fixture compatibility path: `supabase/functions/_shared/sms/sms_test.ts` will add only an off-mode guard response to its existing boundary double; new enforcement assertions live in the new affinity.test.ts/native tests. This preserves baseline consent tests while requiring the newly installed guard RPC. Candidate application tsc currently matches all 78 exact-base diagnostics after normalizing line numbers; zero new diagnostics at this checkpoint. Five changed Edge entrypoint packages pass Deno check with the recorded exact npm import substitution.

Verification manifest refinement (isolated only): add `scripts/sticky-numbers/browser.html`, `browser-entry.tsx`, `browser-auth.ts`, `browser-vite.mjs`, `extended-database-tests.mjs`, and `supabase/functions/_shared/sms/legacy-affinity.test.ts`. These exercise actual components, actual database roles and the separately downloaded immutable legacy packages; synthetic auth/provider transports exist only in the test harness. Correctness fixes remain in the four new, never-applied migrations and listed UI files. Commands: native candidate rebuild, loopback PostgREST/Deno/Chromium tests, 50k fixture benchmark and same-base regression commands already listed.

Browser transport harness also requires `scripts/sticky-numbers/browser-edge.ts`: it starts the real manual Edge entrypoint against local PostgREST, replaces provider transport with deterministic synthetic receipts and refuses every unexpected external request. No production module imports test files. Chromium executes the actual Dialer SMS, Conversations and Full Contact View components with synthetic session context.

The actual Dialer composer exposed a nonfunctional Email toggle. Add one optional SMS-only presentation prop in `src/components/messaging/MessageComposePanel.tsx`, defaulting to the existing two-channel behavior everywhere else. This removes an inert control from the new Dialer SMS integration without changing email workflows.

Implementation checkpoint: Phases 1–5 source is present locally; final verification and packaging continue. Native role/Edge/Chromium/scale suites are running against the exact verified baseline. Full regression with synthetic Vite environment hung on both base and candidate and was interrupted with exit 130; rerun the repository's default environment with a bounded worker pool, retaining both attempt logs. This is not a clean global-test claim. Mobile screenshot inspection caught content overflowing inside a correctly sized modal; controls now have bounded grid widths and the browser test checks every visible control, not just the outer dialog.

Full-suite compatibility edit manifest: the existing component suites mock the consent hook and omit a QueryClient. Add the equivalent explicit off-mode affinity dependency to preserve their existing unrelated assertions; do not suppress enforcement tests (native/Edge/browser use real RPCs). Voice lifecycle doubles must return the documented off-mode authorization result rather than null. The old Reports-only whole-file hash is superseded by this explicitly authorized telephony change and will pin the reviewed candidate; the call-type fragment will assert the same value is used in authorization and the call row. Exact additional test files:
- `src/pages/__tests__/contactDeepLinkDuplicateParity.test.tsx`
- `src/pages/__tests__/contactDeepLinkQuickCall.test.tsx`
- `src/pages/__tests__/contactDeepLinkSaveIntegrity.test.tsx`
- `src/pages/__tests__/contactsFullScreenDuplicateParity.test.tsx`
- `src/pages/__tests__/conversationsSendContract.test.tsx`
- `src/pages/__tests__/conversationsViewAs.test.tsx`
- `src/components/conversations/__tests__/conversationThreadPendingSms.test.tsx`
- `src/components/contacts/__tests__/conversationDispositionColors.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewAdditionalPolicies.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewAssignee.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewClientLeadFields.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewConversation.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewFieldVisibility.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewQuickCall.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewSaveFailure.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewSchedule.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewScore.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewStatusSave.test.tsx`
- `src/components/contacts/__tests__/redundantDialogDescriptions.test.tsx`
- `src/contexts/__tests__/teamOpenRevealIntegration.test.tsx`
- `src/contexts/__tests__/twilioProviderLifecycle.test.tsx`
- `src/pages/__tests__/dialerPageReportsV2Exceptions.test.ts`
- `src/lib/__tests__/outboundPathPinned.test.ts`

Final replay correction: `_shared/sms/dispatch.ts` now checks an existing immutable ledger intent before mutable send readiness/consent. It validates current manual scope and the exact intent through the existing bound-prepare contract, returns accepted receipts, and keeps attempted/uncertain sends held. It never prepares new work before consent. Add paused-replay and changed-explicit-override assertions in the existing Edge/native suites; rerun those and five-entrypoint typechecking. No additional database API or production action.

Release artifact generation (no publication): write `../deliverables/AgentFlow_Sticky_Numbers_Candidate/release/install.sql` from the four exact new sources, including one transaction and their exact migration-history identities; `release/guard_only.sql`, `release/readback.sql`, `release/expected-postimages.json`; five complete source closures under `edge-packages/<slug>/`; `manifest.json`, an offline Git bundle, a binary patch, changed files, evidence and README. Rehearse the generated install transaction against a fresh native clone, with only the platform migration-history table supplied by the local harness; assert all four recorded source bytes and native postimages. This generated install file is held and never sent to production.
