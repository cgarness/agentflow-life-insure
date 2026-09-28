# Reports & Analytics — Morning Handoff (2026-09-28)

Branch `claude/reports-analytics-overnight-c69826` (base `main` @ `5d37e5f`). Plan:
`docs/plans/2026-09-28-reports-analytics/implementation_plan.md` (rev 2, approved for branch implementation and testing
only). **Nothing was merged, applied, deployed or configured in production.** Production access during this work was
read-only catalog/aggregate SELECTs (listed in plan §1).

<!-- STATUS-SECTIONS -->

## 9. Exact production migration / deployment sequence (requires Chris's separate approval)

Preconditions:
- The PR is reviewed.
- The `Reports backend verification` CI check is green.
- Local gates (§6) are re-run on the final head.
- There is no active dialing concern: this change touches no telephony. The migration only creates functions and revokes
  EXECUTE, and it takes a 5 s `lock_timeout`.

1. **Merge the PR to `main`.** Vercel builds production from `main` automatically.
   - Until step 4, the new frontend shows "Reports are temporarily unavailable" with Retry, because the new RPCs do not
     exist yet. It never shows zeros.
   - No other page changes behaviour.
   - Wait for the deployment to be READY.
2. **Read-only preflight** (Supabase MCP `execute_sql`, SELECT only):
   ```sql
   SELECT p.oid::regprocedure, md5(p.prosrc), p.proacl::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'rpc_report%' ORDER BY 1;
   -- expect md5 eb741e0d…, 7d17e968…, 521abcbc…, 9dc9273f… and ACL {postgres,anon,authenticated,service_role}
   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname='public' AND p.proname LIKE 'get\_report\_%') OR (n.nspname='private' AND p.proname LIKE 'report\_%');
   -- expect 0
   SELECT to_regprocedure('private.campaign_actor()'), to_regprocedure('private.resolve_downline_ids(uuid,uuid)');
   -- expect both non-null
   ```
   (The migration's own preflight repeats these checks and aborts atomically on any drift or replay.)
3. **Apply the migration** with `apply_migration`, name `reports_secure_scoped_rpcs`. The query is the exact bytes of
   `supabase/migrations/20260928120000_reports_secure_scoped_rpcs.sql`, verified by SHA-256 against the file
   (<!-- MIGRATION-SHA -->).
4. **Reconcile the repository filename** to the version `apply_migration` records, in a record-only commit. Do not edit
   the SQL bytes. Update `scripts/run_reports_rpc_tests.sh`, `src/lib/__tests__/reportsContracts.test.ts` and
   `.github/workflows/reports-backend.yml` if they reference the filename.
5. **Read-back** (SELECT only):
   - Six `public.get_report_*` functions exist with `prosecdef = true`, `provolatile = 's'`,
     `proconfig = {search_path=pg_catalog, pg_temp}`, and ACL `{postgres, authenticated, service_role}`.
   - Eight `private.report_*` functions exist with ACL `{postgres}`.
   - The legacy `rpc_report_*` ACL is `{postgres, service_role}`.
   - `has_function_privilege('anon', 'public.get_report_scope()', 'EXECUTE') = false`.
6. **Bounded authenticated-role reads** in a READ ONLY transaction: `SET LOCAL ROLE authenticated` plus
   `request.jwt.claims` for Chris's own profile. Run `get_report_scope()` and `get_report_call_summary(<this month>)`.
   - Record the timings.
   - Compare calls made, talk time and policies against an independent SQL count at the same UTC bounds.
7. **Signed-in smoke tests** (§11).

## 10. Exact rollback / re-disable procedure (fail-closed — plan §R2.3)

**No procedure below re-grants EXECUTE on the legacy `rpc_report_*` functions.** They stay sealed in every state.

- **(a) Re-disable — preferred, reversible.**
  - Apply `supabase/ops/reports_disable.sql` as a new migration named `reports_disable`.
  - It revokes the six `get_report_*` from authenticated, PUBLIC and anon, and re-asserts the legacy seal.
  - The page then shows "Reports are temporarily unavailable". No data is touched.
  - Re-enable later with `supabase/ops/reports_enable.sql`. It grants only the new RPCs, and refuses if their security
    metadata drifted.
- **(b) Remove the new functions.**
  - Apply `supabase/migrations/rollback/20260928120000_reports_secure_scoped_rpcs.rollback.sql` as a new migration.
  - It drops the six public and eight private report functions, re-asserts the legacy seal, and aborts if any legacy
    function remains client-executable.
  - Reports stays unavailable.
- **(c) Frontend rollback.**
  - Promote the previous Vercel deployment, only together with (a) or (b).
  - The old frontend calls the sealed legacy RPCs and would render zeros through its old error-swallowing.
  - Prefer fixing forward.
- **Verification after any of these:**
  - `has_function_privilege('anon'|'authenticated', 'public.rpc_report_call_summary(uuid,timestamptz,timestamptz,uuid)', 'EXECUTE')`
    is false.
  - After (a): `has_function_privilege('authenticated', 'public.get_report_scope()', 'EXECUTE')` is false.

All three SQL paths are exercised by `scripts/run_reports_rpc_tests.sh`, including when a legacy grant has been
re-added by hand.

## 11. Recommended smoke tests after release

1. **Admin, "This Month".**
   - The toolbar shows "Organization · America/Los_Angeles", or the labelled default zone for orgs without settings.
   - Calls made / talk time / policies equal an independent SQL count at the same agency-zone bounds.
   - The Leaderboard month matches only when your browser zone equals the agency zone. The Leaderboard stays
     browser-local.
2. **Admin, agent filter.** Pick one agent: every panel narrows to that agent, and the CSV header says
   "Agent filter: <name>".
3. **Agent (own scope, production org permissions: page on, View Own on).**
   - There is no agent selector.
   - No other agent's name appears anywhere, CSVs included.
   - The Export button is absent, because the org's Agent "Export Reports" is off.
4. **Team Leader.**
   - The selector lists self and downline only.
   - Calling `get_report_call_summary` by hand with a non-downline agent id returns HTTP 403 / 42501.
5. **Anonymous.**
   - `POST /rest/v1/rpc/get_report_scope` with only the anon key is denied.
   - `POST /rest/v1/rpc/rpc_report_call_summary` with any org id is denied.
6. **Previously broken panels.** Campaign Performance and Lead Source Performance render real rows (they were
   permanently empty before). Lead-source Converted reads "Not available".
7. **Permission change takes effect.** Turn the org's Agent "Reports" page permission off. On the next load the Agent
   sees the permission-denied state, and the server returns 42501. Turn it back on.
8. **Failure is not zero.** Take the network offline, then reload the Reports tab. Panels show "Couldn't load … This is
   not a zero" with Retry, and Export is disabled.
9. **Load.** In the API logs, each report RPC for This Month should come in under about 1 s at current volume, with no
   periodic Reports traffic (there is no polling).
