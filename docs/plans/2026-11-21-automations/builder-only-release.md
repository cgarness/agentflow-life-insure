# Builder visibility decision for PR #534

**Hold production visibility.** Signed-in authors can create, preview and publish their own graphs in isolation. A release still needs a successful rehearsal on a verified copy of the complete current production schema. The available historical fixture differs from production in 24 catalog families. Chris’s next approval must name the agency UUIDs, exact database and frontend artifacts and release window. Live execution has additional prerequisites. [Schema source and reproduction](schema-only-rehearsal.md) · [Live execution decision](live-execution-decision.md)

## Candidate and experience

Application and SQL revision `2631ea7fd7ae8a53a273b4302c3e7672887474fa` stacks on the phone release branch at `1536db4d957f256b5706d948545409cac2e1cfe1`. The production frontend for Vercel project `agentflow` was `7914faefc750aaf38d3659a71d9a01b3298f9107`, deployment `dpl_Ew8mAsZojSs5MbbTAJd8etB1okCE`, at inspection. Its primary alias is `www.fflagent.com` and its project ID is `prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc` under team `cgarness-projects`. The database target is Supabase `jncvvsvckxhqgqvkppmj`. Recheck both pins at the release window.

Run the rehearsal harness from the final PR revision containing this packet. Verify the product files against the application SHA with `git diff --exit-code 2631ea7fd7ae8a53a273b4302c3e7672887474fa HEAD -- src supabase/migrations supabase/functions supabase/ops vercel.json`.

An authorized author sees one **Create automation** action in a fresh agency. The canvas starts at **Choose trigger**. Opening, previewing and abandoning it creates zero definitions, runs or messages. Save draft persists an incomplete graph. Review & publish saves a locally valid graph for server review, even if the author later leaves without publishing. Preview uses synthetic eligibility inputs. Publish validates the graph, audience, configured channels and author, and pins a version. An email action needs a verified agency sender to publish. A fresh agency may have zero eligible email senders. Authors can still draft and preview. A rollout requires zero sample workflows or configuration of live sending.

The following matrix shows the versioned runtime behavior verified in isolation. Production currently runs the legacy worker. For a published, active version, the review, confirmation, reopened editor and workflow list describe the following effects. Pausing or archiving prevents new enrollments and future handoffs. Messages already handed off may receive a later receipt. The server checks that the two settings still match the review inside the publish transaction. Unavailable settings prevent confirmation.

| Agency enrollment | Provider dispatch | What an author can expect |
| --- | --- | --- |
| Off | Off | New qualifying events cannot start a run. Messages cannot go out. This is the builder-only release. |
| On | Off | Qualifying events can start runs. Messages wait for provider dispatch. |
| Off | On | New events cannot start runs. Existing eligible runs may send. |
| On | On | Qualifying events can start runs. Eligible messages may go out after current authority, consent, sender, timing and quota checks. |

These settings apply to versioned Automations. Existing legacy graphs retain their IDs, records and history and open for inspection. Deployment changes workflow-table grants and routing across the installation, including the old Settings entry. Agencies whose builder stays hidden will lose access to the previous workflow editor through that entry. Ordinary CRM, manual messaging and dialer paths continue to use their existing authorization.

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

1. Record the approved project, agency UUIDs, code SHA, migration hashes, frontend promotion, operator, window and rollback authority. Recheck Vercel’s current alias and Supabase’s ledger, grants, deployed worker/auth metadata and catalog receipts for drift. Obtain the cleared current schema-only bundle and complete the full isolated rehearsal below. Retain before/after aggregate audit receipts and measured lock times. Stop on a different ledger, unreviewed policy/trigger change, restore discrepancy or test failure. Inspect production for unexpected legacy workflow use and review the impact with affected agencies.
2. From an immutable checkout at the application SHA, run the checksum and read-only audit commands below. Verify the named agency exists, the four feature objects are absent on first install, and record aggregate legacy definition/run/step counts. Identify unrelated concurrent CRM activity when comparing later aggregates. Keep a recoverable production backup per the existing release procedure.
3. Release that exact frontend to the primary Vercel project through its ordinary production build and promotion path. Verify the deployed Git SHA, project and production alias. New Automations routes must stay unavailable while the RPCs are absent. Inform authors of the temporary workflow-editor transition. Have users reload/close tabs serving the old frontend, especially tabs in View As, before signing in anew.
4. Submit the four SQL files above individually to Supabase’s migration operation for project `jncvvsvckxhqgqvkppmj`. Use Supabase `apply_migration`, selecting the existing connection that owns this project. The arguments are `project_id=jncvvsvckxhqgqvkppmj`, `name` equal to the filename stem after the timestamp and `query` equal to the checksum-verified UTF-8 file contents. The four names in order are `automation_sessions`, `automation_authoring`, `automation_runtime` and `automation_message_history`. Record the returned ledger version, migration name and source hash before continuing. The operation must target only these four files. On partial failure keep visibility off, inspect the committed ledger and reconcile the remaining migrations in isolation before continuing. Verify PostgREST sees the new session, access, draft and publish signatures in the production API schema. With visibility still off, the current frontend must keep Automations unavailable. Run Supabase security advisors against this approved policy change and compare with the rehearsed result.
5. Audit again before showing anything. Legacy counts must reconcile. On first install expect zero builder definitions, versions, activation intervals, events, runs, intents, automation messages and attributed channel history, with zero agencies visible, enrolling or dispatching. Apply `show` only to each named agency using the reviewed operator artifact. Its first use seals the server cutoff while all release gates are off across the installation. Repeating it does not move that cutoff. Confirm each target reads visible/on, enrollment/off, dispatch/off. The first-show and hide operations abort on conflicting live gates.
6. Sessions opened before or at first visibility, including tokens refreshed afterward, require a **new sign-in** for Automations. A server cannot reconstruct historical client-only View As intent from a legacy JWT. The same rule applies to all roles, including a former Super Admin. Do not sign everyone out of CRM. An authorized fresh session on the current frontend can open Automations and Settings. Confirm per-agency visibility, open the blank canvas and leave via Back without selecting Save draft or Review & publish, then reread the audit. Compare to the pre-open counts. Production smoke verification requires no authored test graph, synthetic event injection or test message.

For the approved frontend step, use a clean, already-linked checkout. Confirm that the project inspection returns the primary project ID above. Stage the production build first, inspect its source SHA and READY state, and promote the verified deployment ID. The release should record the actual ID returned at staging.

```bash
test "$(git rev-parse HEAD)" = '2631ea7fd7ae8a53a273b4302c3e7672887474fa'
test -z "$(git status --porcelain)"
vercel project inspect --scope cgarness-projects --non-interactive
vercel deploy --prod --skip-domain --scope cgarness-projects
: "${STAGED_DEPLOYMENT:?Set the observed deployment ID for the exact candidate}"
vercel inspect "$STAGED_DEPLOYMENT" --scope cgarness-projects
vercel promote "$STAGED_DEPLOYMENT" --scope cgarness-projects
vercel inspect www.fflagent.com --scope cgarness-projects
```

Run the database checks from the same immutable checkout. For the audit and visibility commands, `PGSERVICE` identifies a privately configured, target-verified service. Use read-only credentials for audit and an explicitly approved operations identity for the bounded visibility update. Never place a password in command output.

```bash
git rev-parse HEAD
sha256sum supabase/migrations/202611210{75959,80000,80100,80200}_automation_*.sql \
  supabase/ops/automations_builder_{audit,visibility}.sql
: "${PGSERVICE:?Set the approved service for this step}"
: "${AGENCY_ID:?Set one agency UUID explicitly named in the approval}"
psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 -v agency_id="$AGENCY_ID" \
  -f supabase/ops/automations_builder_audit.sql
```

Only during a separately approved release, repeat the following for each named agency, followed by the same audit.

```bash
psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 -v agency_id="$AGENCY_ID" -v action=show \
  -f supabase/ops/automations_builder_visibility.sql
```

## Rollback

Hide each affected agency with the same operator and verified target. Read back all three controls. Fresh navigation through both routes must close and stale clients must be denied on their next server operation. A previously rendered tab may display its local graph until refreshed. Verify stored definitions, graph revisions, versions, receipts, existing history and the sealed session cutoff survive. If either live gate is already on, the script aborts; that agency requires a separately reviewed live-execution rollback. Keep the installed RLS and data tables intact. The rehearsed rollback keeps the candidate frontend in place. A site-wide rollback to the old client-only View As frontend requires separate approval and a global audit showing zero visible, enrolling or dispatching agencies. Keep every agency hidden while that build is served. After verifying the rollout target still matches the recorded prior deployment, the frontend recovery command is `vercel rollback dpl_Ew8mAsZojSs5MbbTAJd8etB1okCE --scope cgarness-projects`. Verify `www.fflagent.com` again. A Vercel rollback suspends automatic domain assignment until the next explicit promotion. The old workflow editor will encounter the new database restrictions. A second rollout after an alias rollback requires a separately reviewed session cutoff or equivalent revocation for sessions created while the legacy frontend was live. The one-time `show` operation deliberately leaves an existing cutoff intact. The native rehearsal exercises hide on the compatible frontend; it does not test re-promotion after serving the legacy bundle again. A destructive database downgrade is outside this visibility rollback.

```bash
psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 -v agency_id="$AGENCY_ID" -v action=hide \
  -f supabase/ops/automations_builder_visibility.sql
psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 -v agency_id="$AGENCY_ID" \
  -f supabase/ops/automations_builder_audit.sql
```

## Verification evidence

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
| Full current production schema | **Blocked.** The native restore harness passed on independent synthetic and managed-image archives, including pg_cron, pg_net and GraphQL privileges. Digest-pinned GoTrue v2.198.0 reproduced the 84 provider migration IDs, survived restart and retained zero users and sessions before fixtures. Read-only production inspection captured 29 catalog-family receipts and both repository-mandated canonical fingerprints. The historical fixture differs in 24 families. No complete-copy result or production installation is claimed. |

[Observed control matrix](evidence/release-controls.json) · [Both off](evidence/release-controls-00.png) · [Enrollment off, dispatch on](evidence/release-controls-01.png) · [Enrollment on, dispatch off](evidence/release-controls-10.png) · [Both on](evidence/release-controls-11.png)

[Signed-in control and stale-review test](../../../e2e/automations-local/release-controls.mjs) · [Session and migration cutover, rollback](../../../e2e/automations-local/release-cutover.mjs) · [Legacy evaluator isolation](../../../supabase/tests/automation_legacy_dispatch.sql) · [New lead eligibility test](../../../supabase/tests/automation_intake_eligibility.sql) · [Previous branch verification](context-snapshot.md)

The full-schema gate requires a matching, privately reviewed schema-only production source or an authorized read-only libpq service that can export it. The management connector supplied independent catalog digests. Those digests and repository migration history cannot restore the source objects. Keep any schema archive and configuration manifests out of Git. [Complete-schema rehearsal instructions](schema-only-rehearsal.md) · [Production receipt](production-schema-fingerprint.json) · [Synthetic browser and database tests](../../../e2e/automations-local/README.md)
