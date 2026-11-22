# Builder visibility decision for PR #534

**Pending one production decision for CG Financial.** The pilot targets agency `a0000000-0000-0000-0000-000000000001` only. Chris waived the complete-schema rehearsal for this builder-only release. The last full replay matched 26 of 29 catalog families, both application fingerprints and all 84 Auth migration IDs. Later targeted tests reproduced the role and membership and 55 of 56 extension routines. The GraphQL placeholder and PgBouncer authentication routine still lack a private capture. The four migrations have been tested on the scoped PostgreSQL fixture. Live execution, including scheduler ownership and cadence and verified per-recipient eligibility/time-zone refresh, is a separate decision. [Full-schema procedure](schema-only-rehearsal.md) · [Live execution decision](live-execution-decision.md)

## Candidate and experience

PR #534 incorporates the primary frontend `b1a1d31f4330c750af73b2817f40b5234ab96ad1` and its documentation closeout `21bc8709a24cc35bb0d472be4ca1facf0e76d98b`. At preflight, both primary aliases, `www.fflagent.com` and `fflagent.com`, served READY deployment `dpl_4ep4y3sDxcb4kuUpEqgey9fX9ZNU` on primary Vercel project `agentflow`, ID `prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc`, team `cgarness-projects`. The database target is Supabase `jncvvsvckxhqgqvkppmj`. Recheck the project, deployment, source SHA, ledger and counts immediately before release.

The proposed immutable frontend is `666387b06236281a1e61b1d0fc765284bc63cd99`. The integration commit `b8364c8947c9b58a7c6e9775845dfcf4095c7800` includes the live labeled From selector, sticky voice/SMS, Quick Call, floating dialer and contact view. The contact Activity tab adds the gated Automations timeline. Check the four migrations and two operator files against the table below and their original pin `2631ea7fd7ae8a53a273b4302c3e7672887474fa`. Changes since the original harness `2b82ab1cacaacef145329b9d20a646c3685fa420` include a cutover from the actual preceding primary frontend and a signed-in blank-canvas Back check.

An authorized author sees one **Create automation** action in a fresh agency. The canvas starts at **Choose trigger**. Opening, previewing and abandoning it creates zero definitions, runs or messages. Save draft persists an incomplete graph. Review & publish saves a locally valid graph for server review, even if the author later leaves without publishing. Preview uses synthetic eligibility inputs. Publish validates the graph, audience, configured channels and author, and pins a version. An email action needs a verified agency sender to publish. A fresh agency may have zero eligible email senders. Authors can still draft and preview. A rollout requires zero sample workflows or configuration of live sending.

The following matrix shows the versioned runtime behavior verified in isolation. Production currently runs the legacy worker. For a published, active version, the review, confirmation, reopened editor and workflow list describe the following effects. Pausing or archiving prevents new enrollments and future handoffs. Messages already handed off may receive a later receipt. The server checks that the two settings still match the review inside the publish transaction. Unavailable settings prevent confirmation.

| Agency enrollment | Provider dispatch | What an author can expect |
| --- | --- | --- |
| Off | Off | New qualifying events cannot start a run. Messages cannot go out. This is the builder-only release. |
| On | Off | Qualifying events can start runs. Messages wait for provider dispatch. |
| Off | On | New events cannot start runs. Existing eligible runs may send. |
| On | On | Qualifying events can start runs. Eligible messages may go out after current authority, consent, sender, timing and quota checks. |

These settings apply to versioned Automations. Existing legacy graphs retain their IDs, records and history and open for inspection. Deployment changes workflow-table grants and routing across the installation, including the old Settings entry. Agencies whose builder stays hidden will lose access to the previous workflow editor through that entry. The migrations revoke direct browser writes on shared workflow definitions, nodes, edges, folders, executions, steps, versions and activation intervals. Scoped authenticated reads and session-checked authoring RPCs provide access. Worker bookkeeping remains server-owned. Ordinary CRM, manual messaging and dialer paths continue to use their existing authorization.

## Exact database and operator artifacts

Apply these four files in order. The database transaction that publishes a graph consults the runtime and channel validation installed by the last two migrations. Treat the four as one release before exposing the builder.

| File under `supabase/migrations/` | Scope | SHA-256 |
| --- | --- | --- |
| `20261121075959_automation_sessions.sql` | Private verified actor/session state, transition RPCs and visibility cutoff | `ef1df7180757d9e2b2fab0e48d3843bf1ef0c4184ba7fa8a8eb2c6d121946de7` |
| `20261121080000_automation_authoring.sql` | Graph drafts, immutable versions, authoring RPCs, org-scoped RLS/grants and independent agency controls | `cbd33b79853aae41317846f486cfecb2545643c5ca45388b4f68ab4d094b0132` |
| `20261121080100_automation_runtime.sql` | Committed CRM event hooks, worker-only ledger, claims, waits, lifecycle and scoped activity | `5e6e8368114a94e957b641f49bedc0c9d6a65b17367c9f02c4de88fdd8b7b49a` |
| `20261121080200_automation_message_history.sql` | Channel checks, worker receipts, typed reply hooks, scoped message provenance in Conversations | `5bdc1246420ff80972751e1a4933a9ca26647e1192331614c684b77e93721da0` |

| File under `supabase/ops/` | SHA-256 |
| --- | --- |
| `automations_builder_audit.sql` | `809095fd2fd5906e96ce7a1dfd77bac5e714ae3a3ce845630bec5566ce762db1` |
| `automations_builder_visibility.sql` | `178cb1bf097c7174ecc8fec7e9fd638932ae8ea22e328c7149d9bf2c5ae947a5` |

Visibility needs the primary frontend and these database changes. The live legacy evaluator v45 calls the RPC that excludes versioned graphs. The v52 executor and v44 resume worker read legacy executions, while the v45 time worker selects different trigger types. All 23 inspected package files matched the pinned production source. A signed author in the isolated database published each new trigger with both gates off. Legacy trigger lookups selected the two legacy positive controls and subsequent lead and campaign inserts created zero versioned events or runs. The reviewed action set contains zero Edge deployments, auth configuration changes, scheduled jobs, provider configuration changes, or enrollment/dispatch enables. The secondary Vercel project has no role in this release. Keep the feature branch excluded from automatic deployments. Merge is a separate decision.

## Procedure for a separately approved window

Proposed window: Saturday, November 21, 2026, 4:00–5:00 p.m. Pacific Standard Time (November 22, 00:00–01:00 UTC). The authorization must identify frontend `666387b06236281a1e61b1d0fc765284bc63cd99`, the four hashes above, the shared grants/Settings transition, and show/hide only for `a0000000-0000-0000-0000-000000000001`. Keep both execution switches off for every agency. Record the exact staged deployment ID and its source before promoting. If staging access or approval is outstanding when the window ends, hold production.

1. Record the explicit approval for this SHA, project, agency, migration and grant changes, stage/promotion, visibility operation, Pacific window and hide authority. Recheck Vercel’s current alias and Supabase’s ledger, grants, deployed worker/auth metadata and catalog receipts for drift. Record the pilot-only complete-schema waiver and the scoped rehearsal results. Retain before/after aggregate audit receipts and measured lock times. Stop on a different ledger, unreviewed policy/trigger change, restore discrepancy or test failure. Inspect production for unexpected legacy workflow use and review the impact with affected agencies.
2. From an immutable checkout at the application SHA, run the checksum and read-only audit commands below. Verify the named agency exists, the four feature objects are absent on first install, and record aggregate legacy definition, active workflow, run and step counts. The read-only preflight at 3:03 p.m. Pacific on November 21 found the agency, 391 ledger entries through `20261121045526`, none of the four feature entries, and zero legacy definitions, active workflows, runs and steps. The new relations were absent. Reconcile any change to this baseline before proceeding. Identify unrelated concurrent CRM activity when comparing later aggregates. Confirm the latest successful managed backup or the available PITR window for this project before the first mutation. The connected database tools do not expose this metadata, and the runner received HTTP 401 from the backup metadata endpoint. A dated operator confirmation or an authorized metadata read suffices. The rehearsed rollback hides the feature in place and preserves existing records.
3. Release that exact frontend to the primary Vercel project through its ordinary production build and promotion path. Verify the deployed Git SHA, project and production alias. New Automations routes must stay unavailable while the RPCs are absent. Inform authors of the temporary workflow-editor transition. Have users reload/close tabs serving the old frontend, especially tabs in View As, before signing in anew. Repeat the global counts and ledger immediately after promotion and before the first migration. If a graph or a conflicting ledger entry appeared, pause, preserve it and reconcile the change.
4. Submit the four SQL files above individually to Supabase’s migration operation for project `jncvvsvckxhqgqvkppmj`. Use Supabase `apply_migration`, selecting the existing connection that owns this project. The arguments are `project_id=jncvvsvckxhqgqvkppmj`, `name` equal to the filename stem after the timestamp and `query` equal to the checksum-verified UTF-8 file contents. The four names in order are `automation_sessions`, `automation_authoring`, `automation_runtime` and `automation_message_history`. Record the returned ledger version, migration name and source hash before continuing. The operation must target only these four files. On partial failure keep visibility off, inspect the committed ledger and reconcile the remaining migrations in isolation before continuing. Verify PostgREST sees the new session, access, draft and publish signatures in the production API schema. With visibility still off, the current frontend must keep Automations unavailable. Run Supabase security advisors against this approved policy change. Compare individual findings with the immediate preinstall baseline and the isolated change set before showing the builder. The 3:04 p.m. Pacific read returned 317 findings across seven rules (69 informational, 246 warnings, two existing errors).
5. Audit again before showing anything. Legacy counts must reconcile. On first install expect zero builder definitions, versions, activation intervals, events, runs, intents, automation messages and attributed channel history, with zero agencies visible, enrolling or dispatching. Apply `show` only to each named agency using the reviewed operator artifact. Its first use seals the server cutoff while all release gates are off across the installation. Repeating it does not move that cutoff. Confirm the only visible row belongs to the named pilot and the global counts of enrollment-enabled and dispatch-enabled agencies both equal zero. Read the counts back independently before the fresh sign-in. The first-show and hide operations abort on conflicting live gates.
6. Sessions opened before or at first visibility, including tokens refreshed afterward, require a **new sign-in** for Automations. A server cannot reconstruct historical client-only View As intent from a legacy JWT. The same rule applies to all roles, including a former Super Admin. Do not sign everyone out of CRM. An authorized fresh session on the current frontend can open Automations and Settings. Confirm per-agency visibility, open the blank canvas and leave via Back without selecting Save draft or Review & publish, then reread the audit. Compare every count to the pre-open and preinstall reads. Confirm the only visible agency is the target and every enrollment and dispatch flag is false. Production smoke verification requires no authored test graph, synthetic event injection or test message.

For the approved frontend step, use a clean checkout linked to the primary project and an authorized Vercel CLI session. The prepared CLI is version 66.6.0 and exposes the per-deployment skip-domain flag. Keep authentication in the protected runner. The connected deployment creation operation omits the per-deployment skip-domain option; verify staging capability before any production mutation. The connected promotion and rollback operations accept an exact deployment ID. Confirm that the project inspection returns the primary project ID above. Stage the production build first, inspect its source SHA and READY state, and promote the verified deployment ID. The release should record the actual ID returned at staging.

```bash
test "${APPROVED_FRONTEND_SHA:?Use the immutable SHA in the approved packet}" = 666387b06236281a1e61b1d0fc765284bc63cd99
test "$(git rev-parse HEAD)" = "$APPROVED_FRONTEND_SHA"
test -z "$(git status --porcelain)"
vercel project inspect --scope cgarness-projects --non-interactive
vercel deploy --prod --skip-domain --scope cgarness-projects
: "${STAGED_DEPLOYMENT:?Set the observed deployment ID for the exact candidate}"
vercel inspect "$STAGED_DEPLOYMENT" --scope cgarness-projects
# Confirm the approved SHA is READY and the primary alias still serves the recorded rollback ID.
vercel inspect www.fflagent.com --scope cgarness-projects
vercel promote "$STAGED_DEPLOYMENT" --scope cgarness-projects
vercel inspect www.fflagent.com --scope cgarness-projects
```

Run the database checks from the same immutable checkout. For the audit and visibility commands, `PGSERVICE` identifies a privately configured, target-verified service. Use read-only credentials for audit and an explicitly approved operations identity for the bounded visibility update. Never place a password in command output.

```bash
git rev-parse HEAD
sha256sum supabase/migrations/202611210{75959,80000,80100,80200}_automation_*.sql \
  supabase/ops/automations_builder_{audit,visibility}.sql
: "${PGSERVICE:?Set the approved service for this step}"
AGENCY_ID=a0000000-0000-0000-0000-000000000001
psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 -v agency_id="$AGENCY_ID" \
  -f supabase/ops/automations_builder_audit.sql
```

Only during a separately approved release, repeat the following for each named agency, followed by the same audit.

```bash
psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 -v agency_id="$AGENCY_ID" -v action=show \
  -f supabase/ops/automations_builder_visibility.sql
```

The pinned audit counts global workflows, legacy runs and steps, published versions, intervals, events, versioned runs, dispatch intents, logical messages and both channel attribution columns. Supplement it with the following aggregate. Run the first query at every checkpoint, and the second once its relation exists. A missing preinstall relation is recorded as absent. Use a short read-only transaction and the same database snapshot for the audit and its supplement.

```sql
SELECT count(*) FILTER (WHERE status = 'active') AS active_workflows FROM public.workflows;
SELECT count(*) AS versioned_steps FROM private.automation_steps;
```

The operator scripts use psql metacommands. The project-scoped SQL connection can execute the same statements by binding the approved UUID and the literal action inside the transaction, omitting psql-only directives, and selecting the installation-dependent read statements only after their relations exist. Retain the original first-show guard, global lock, checked target, cutoff and final three-flag readback. After show the aggregate must be one visible agency, the target itself visible, and zero enrolling or dispatching agencies. After hide all three aggregates must be zero.

## Rollback

Hide each affected agency with the same operator and verified target. Read back all three controls. Fresh navigation through both routes must close and stale clients must be denied on their next server operation. A previously rendered tab may display its local graph until refreshed. Verify stored definitions, graph revisions, versions, receipts, existing history and the sealed session cutoff survive. If either live gate is already on, the script aborts; that agency requires a separately reviewed live-execution rollback. Keep the installed RLS and data tables intact. The rehearsed rollback keeps the candidate frontend in place. A site-wide rollback to the old client-only View As frontend requires separate approval and a global audit showing zero visible, enrolling or dispatching agencies. Keep every agency hidden while that build is served. After verifying the rollout target still matches the recorded prior deployment, the frontend recovery command is `vercel rollback dpl_4ep4y3sDxcb4kuUpEqgey9fX9ZNU --scope cgarness-projects`. Verify `www.fflagent.com` again. A Vercel rollback suspends automatic domain assignment until the next explicit promotion. The old workflow editor will encounter the new database restrictions. A second rollout after an alias rollback requires a separately reviewed session cutoff or equivalent revocation for sessions created while the legacy frontend was live. The one-time `show` operation deliberately leaves an existing cutoff intact. The native rehearsal exercises hide on the compatible frontend; it does not test re-promotion after serving the legacy bundle again. A destructive database downgrade is outside this visibility rollback.

```bash
psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 -v agency_id="$AGENCY_ID" -v action=hide \
  -f supabase/ops/automations_builder_visibility.sql
psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 -v agency_id="$AGENCY_ID" \
  -f supabase/ops/automations_builder_audit.sql
```

## Verification on the corrected frontend

| Check on November 21 | Observed result |
| --- | --- |
| Live-base preservation | Every production-changed runtime file outside the one shared contact screen matches the live client. The screen diff adds the gated Activity rendering and imports. The production-build Chromium fixture showed the Denver label and made zero provider requests from preview. |
| Empty pilot | The signed-in author saw exactly one Create automation, an empty name, Choose trigger and zero steps. Back returned to the empty list. Eleven database counts were zero before and after. Only the pilot fixture agency was visible and both execution controls were off across the fixture. This ran in both native suites. |
| Cutover and rollback | The scoped fixture applied all four pinned migrations in 2.68 seconds. Six legacy graph/history tables matched before and after (SHA-256 `92861d855faac8815ebf74dde31660cb1837543ff211d3e0fa34e852b18ec485`). Existing sessions, including a tab in View As, needed fresh authentication for Automations. Ordinary CRM remained accessible. Hiding twice preserved seven fixture definitions, six versions, two runs and two logical messages produced in the subsequent synthetic execution cases. |
| Authorization and execution controls | Two tabs sharing a session, an independent session, stale edits, all four enrollment/dispatch combinations, concurrent intake/claims, a 1,000-lead synthetic backlog, immutable waiting runs and late receipts passed. Both test-authored graphs completed with the intended synthetic channel. |
| Frontend and phone | Both root TypeScript checks and production Vite builds passed. The app-specific project produced the same 78 diagnostics on both revisions. All 954 focused phone/CRM Vitest assertions and 120 phone/SMS Edge tests passed. Six Chromium From/Conversations checks and the native phone-purchase, setup, concurrency and dialer DNC suites passed. Desktop manual messaging passed in isolation; the same two 390 px manual messaging layout limitations reproduced on the live base. |
| Hosted CI at the proposed SHA | All 15 GitHub Actions workflows and all 33 executed jobs passed. Supabase Preview was skipped. |
| Full Vitest | 506 files, 7,327 assertions passed, 38 skipped, one failed after replaying the six subprocess-sensitive suites with native IPC. The remaining voicemail-retention assertion failed identically on the live frontend base. |
| Builder Edge and scoped security | All 71 offline builder/receipt/channel tests passed. The isolated advisor set moved from 423 to 447: 18 new informational findings, 16 new warnings, ten resolved warnings and zero added errors. Use the independent production baseline for the actual rollout. |

[Immutable candidate CI](https://github.com/cgarness/agentflow-life-insure/commit/666387b06236281a1e61b1d0fc765284bc63cd99/checks)

## Earlier scoped verification

| Check | Result in the isolated environment |
| --- | --- |
| Normal UI and control changes | Four signed-in publishes verified the review, confirmation, reloaded editor and list. Real CRM intake and the existing-run handoff gate matched each switch pair. A settings change after review returned HTTP 409 (`PT409`) and created zero versions. Re-review succeeded with the current values. Pause, resume and archive were exercised. |
| Existing workflow and zero-install audit | All four files applied in order in 1.67 seconds on the scoped PostgreSQL 17.6 fixture. The legacy folder, graph, nodes/edges, run and completed step retained the same six-table digest before and after, `24ee26d61a10ac6bed0006fcb8b3d05c836487197037ee96f3a7171d5073181e`. Definition, enrollment, message, contact and control-row deltas were all zero. The old graph and its completed history reopened through Settings. |
| Open sessions, direct requests and ordinary CRM | Old, already-signed-in Admin and Super Admin sessions, including a tab in legacy View As and a login between install and first visibility, were refused. Token refresh and demotion kept the fence. A fresh login could author; the older login could still use Contacts and see human SMS/email. Scoped Conversations hid Automation-attributed messages from that older login. |
| Rollback and synthetic execution | Two authors used the normal UI to publish a lead-created email-only workflow with no wait and a campaign-membership workflow with a wait before SMS. Exactly two synthetic runs completed and produced two receipts. Hiding both fixture agencies twice preserved all seven final definitions (one legacy), six immutable versions, two runs and two logical messages. It also preserved all snapshotted drafts, versions, graph/history, events, runs, intents, messages and leads, with all controls off afterward. |
| Deployed legacy compatibility | For both V1 triggers, real authenticated publish and the service-role legacy lookup returned zero new-format matches. Legacy lead/manual positive controls matched. Real synthetic lead and campaign inserts with both controls off left events, recovery work, runs and messages empty. |
| Sending prerequisite on actual CRM intake | Fifteen native assertions traced an ordinary CRM lead to a qualifying run and explicit policy/recipient-timezone holds. The SMS evidence path recorded purpose-specific decisions. A connected Google mailbox supplied zero verified workflow senders. Zero provider handoffs, receipts or projected messages. |
| Client, Edge and regression checks | Root `tsc --noEmit` and the Vite production build passed. App-specific TypeScript diagnostics remained at 78 on both the previous PR head and candidate, zero new. A focused React/CRM run passed 263 tests in 16 files. The eight graph, runtime, channel, receipt, A2P and manual SMS Deno suites passed 71 tests offline. The earlier branch comparison records a pre-existing voicemail-retention test failure. |
| Database security | All 22 pinned Splinter security queries ran in the disposable database. Findings changed from 423 to 447. Additions were 18 informational private RLS tables with no client policy, 15 authenticated security-definer RPC warnings and one authenticated GraphQL table warning. Ten earlier warnings resolved. Zero added errors. Repeat advisors in the matching full rehearsal and after any approved production RLS operations. |
| Full current production schema | **Waived by Chris for this single-agency builder-only pilot.** The native restore harness passed on independent synthetic and managed-image archives, including pg_cron, pg_net and GraphQL privileges. Digest-pinned GoTrue v2.198.0 reproduced the 84 provider migration IDs, survived restart and retained zero users and sessions before fixtures. Read-only production inspection captured 29 catalog-family receipts and both repository-mandated canonical fingerprints. The historical fixture differs in 24 families. No complete-copy result or production installation is claimed. |

[Observed control matrix](evidence/release-controls.json) · [Both off](evidence/release-controls-00.png) · [Enrollment off, dispatch on](evidence/release-controls-01.png) · [Enrollment on, dispatch off](evidence/release-controls-10.png) · [Both on](evidence/release-controls-11.png)

[Signed-in control and stale-review test](../../../e2e/automations-local/release-controls.mjs) · [Session and migration cutover, rollback](../../../e2e/automations-local/release-cutover.mjs) · [Legacy evaluator isolation](../../../supabase/tests/automation_legacy_dispatch.sql) · [New lead eligibility test](../../../supabase/tests/automation_intake_eligibility.sql) · [Previous branch verification](context-snapshot.md)

The outstanding full-schema evidence remains in the release history. The waiver covers this agency's blank builder with both execution gates off. The source procedure and independent receipts remain available for a future complete rehearsal. [Complete-schema instructions](schema-only-rehearsal.md) · [Independent production receipt](production-schema-fingerprint.json) · [Scoped acceptance suite](../../../e2e/automations-local/README.md)
