# Hierarchy Stabilization — Gate 1 verification (2026-10-23)

**Update (rev 8): Gate 2c complete.** M3 ran once, through the SQL Editor, at 2026-10-24 04:58:12 UTC. The protected
runner recorded it history-only as `20261024045812` in run `40115718668`. The repository file now carries that version
with its bytes unchanged. The release record, forensic snapshot, procedure and record evidence are in §13 (§13.5 for
the record).

**Rev 7 update (superseded):** Gate 2c executed; the history record was then still pending.

**Rev 6 update: Gates 2a, 3 and 2b are released.**
- M1 is live as `20261023210027` (§9).
- The frontend is live from PR #485's merge `89e452c` (§11).
- M2 is live as `20261023232435` (§11).
- M3 was not yet applied at rev 6. Gate 2c readiness is in §12.

§§1–8 below are the Gate 1 record as written.

Gate 1 (approved by Chris 2026-10-23 with D1–D15 defaults and corrections R1/R2) authorizes development and testing
only. **Nothing was applied, merged or deployed. Production was only read** (`SELECT` against `jncvvsvckxhqgqvkppmj`;
8-character id prefixes; no names, emails or phones). Branch `claude/intelligent-lamport-r6hnx7` from `main`
`f03af3b`. Plan: `implementation_plan.md` (rev 4) beside this file.

## 1. Production facts read on 2026-10-23 (read-only)

| Fact | Value |
|---|---|
| Profiles / orgs with profiles / organizations | 16 / 4 / 6 |
| Upline edges / not recognised by `is_ancestor_of` | 11 / 4 |
| Expected ancestor pairs / missing / extra | 15 / 6 / 0 |
| Stale stored paths | 4: `4ef505e0`, `5f952f0d`, `89f2e994`, `e5c4ee04` |
| Reviewed id fingerprint `md5(string_agg(id::text, ',' ORDER BY id))` | `ddc1f53f3823c6e367310a748ea0ac85` |
| Target fingerprint — M3's expression `md5(string_agg(p.id::text || '=' || canon.path::text, ',' ORDER BY p.id))` (canon = canonical paths; re-run read-only by the completeness critic) | `7daae418571600b43b7cf5d5155be0d4` |
| Cross-org edges / missing parents / self-parents / cycles / longest chain | 0 / 0 / 0 / 0 / 3 |
| Migration head | `20261022062539` (343 rows) |
| PostgreSQL / ltree / default isolation | 17.6 / 1.3 in `public` / read committed (no overrides) |
| Policies depending on `is_ancestor_of` | 9 (13 `pg_depend` rows); none RESTRICTIVE on leads/clients/recruits/calls |
| Repo vs live drift of every hierarchy object | none (digests, owners, definer flags, `proconfig`, ACLs, triggers, policy expressions) |
| M1/M2 guard prerequisites | all satisfied (verified by the build and the apply-safety review) |

## 2. Hierarchy harness — final run (this session, fresh cluster)

`CI=true POSTGREST_BIN=<PostgREST 12.2.3> PGURL=postgresql://postgres@127.0.0.1:55740 bash scripts/run_hierarchy_stabilization_tests.sh`
→ **exit 0, "ALL HIERARCHY STABILIZATION PROOFS PASSED on PostgreSQL 16.15: 2747 PASS lines"**; 70 test databases
created and dropped; no roles left.

| Suite | S0 | S1 | S2 | S3 | S1R | S2R | S3R |
|---|---|---|---|---|---|---|---|
| core (`hierarchy_stabilization.sql`) | 64 | 64 | 114 | 114 | 64 | 64 | 64 |
| RLS (`hierarchy_stabilization_rls.sql`) | 149 | 149 | 149 | 149 | 149 | 149 | 149 |
| RPC (`hierarchy_stabilization_rpcs.sql`) | 81 | 81 | 81 | 81 | 81 | 81 | 81 |

- States: S0 = verbatim production preimage + synthetic stale data reproducing production's 16/11/15 shape with 4
  stale paths and 6 missing pairs; S1 = +M1; S2 = +M2; S3 = +M3; S1R/S2R/S3R = rollback states. Every count equals
  the pinned expectation; a suite that exits early, skips a stage or is missing in CI fails the run.
- **PostgREST forged / stale-token stage:** 336 passed, 0 failed (48 cases × 7 states).
- **R2 frontend ↔ database compatibility:** 27 cases × 7 states (190 tests) all passed — the real frontend data-layer modules (supabase-users,
  uplineCandidates, hierarchyTreeData, profileSavePayload + updateProfile, User Management / Team tab loaders,
  CampaignDetail scope, assignee resolver) via supabase-js against PostgREST on every state. Every call succeeds or
  fails exactly as designed, so the order **M1 → frontend → M2 → M3** is confirmed and the activation-guard fallback
  was not needed. The interval between Gate 2a and Gate 3 runs `main`'s frontend against S1: M1 is narrowing only,
  case W02 replays the legacy always-send-`upline_id` save on S1 (it heals stale paths — the documented D14 interim),
  and the RLS and PostgREST stages cover every direct client write a `main` client can make.
- **Migrations:** replays refused; M2 without M1 and M3 without M1/M2 refused; 22 drift cases refused with nothing
  changed (policy expressions, ACLs, trigger order, preceding clients triggers, re-grants, extra triggers, CREATE on
  public, cross-org data, unreviewed stale sets); rollbacks restore the exact preimage digests; re-apply after
  rollback accepted; `NOTIFY pgrst` only on success; static checks reject `BEGIN`/`COMMIT` and top-level `\q`.
- **M3:** the unmodified file refuses the synthetic set (fingerprint ≠ production's); right ids but production's
  target fingerprint → refused; repairs exactly 4 rows (path + `updated_at`, one NOTICE each, path and lock triggers
  re-derive the same value, cascade silent, 8 `set_claim` writes, no UV/notification side effects); second run and
  repaired data → no-ops; an Admin re-parenting a stale row before M3 → refused (id fingerprint unchanged, target
  fingerprint changed).
- **Concurrency (two real sessions):** concurrent X→Y / Y→X under READ COMMITTED — second mover waits on the
  advisory lock, then is rejected as a cycle; insert under a moving node waits, then stores the moved chain;
  REPEATABLE READ / SERIALIZABLE hierarchy writes refused with 0A000; the INT-2 race is closed; ancestor login-sync
  waits ~1.9 s for the mover and succeeds; the deadlock pattern aborts exactly one side; all paths canonical.

### CI on PostgreSQL 17.6 (production's major version)

GitHub Actions run 39988839376, job "PostgreSQL 17.6 + PostgREST 12.2.3 (states S0–S3R, synthetic data)": **success** on
PR #485 head `58e8a59` (the merge of `main` `80921d1`). The run reported **"ALL HIERARCHY STABILIZATION PROOFS PASSED on
PostgreSQL 17.6 (Debian 17.6-2.pgdg13+1): 2747 PASS lines"**:
- Every count matched its pin: core 64/64/114/114/64/64/64; RLS 1043; RPC 567; PostgREST forged 336; compatibility
  190. The last four are totals over the seven states.
- The 70 databases the run created were all dropped.
- The run proves the preimage guards and the new post-image digests on production's major version.
- The same run's "Hierarchy frontend tests" job also passed.

The workflow re-runs on every push to the PR. Gate 2a preflight item 1 (§8) requires it to be green at the head being
applied.

### Brief section E coverage

| Requirement | Where |
|---|---|
| Reproduce the four stale paths | core "reproduce" (S0) + compat W-cases |
| Inserts, reassignment, multi-level cascades | core derivation (insert with upline, A→B, TL1→TL2, remove, TL with grandchildren, depth 5/25, multi-row moves) |
| Expected ancestry = actual ancestry | `private.hierarchy_consistency()` after every step + full ordered-pair truth table |
| Cycles, deleted intermediates, invalid parent orgs | core integrity + RLS D2 cross-org ancestry case |
| TL read/write permissions, all affected modules | RLS suite (leads, clients, recruits, calls, contact_emails, tasks, contact history, profiles) before/after M1 and M3 |
| R1: promotion, demotion, deactivation, forged direct API writes | RLS suite (SQL claims) + PostgREST stage (minted tokens disagreeing with the database) |
| Forged RPC requests, cross-org access | PostgREST stage (anon/auth oracles, caller binding, cross-org tokens, tenancy escapes) |
| Existing sales, commission and reporting behaviour | RPC suite (all 17 direct callers incl. sale writers, handoff, commission access toggle on/off, `get_report_scope_v2` unchanged) + the 18 existing suites (§3) |
| R2: frontend ↔ DB on every release state | compatibility stage, 190/190 |

## 3. Existing SQL suites (regression, PostgreSQL 16.15, this session)

18 runners, all **passed** (run at the build checkpoint before the security remediation; none of the files these
runners load changed afterwards): policy-sale-recording, policy-commission (with PostgREST), lead-conversion-preservation,
reports-rpc, reporting-integrity, reports-integrity, contact-history, commission-grids, group-leaderboard,
dialer-dnc, profile-rpc, seal-list-unrestricted-users, rls-phase1, custom-field-guard, platform-admin-notification,
onboarding-email, google-sheets, inbound-sql. Note: commission-grids fails only on a cluster where another runner has
left roles (`authenticator`, `gl_public_probe`); it passes on a fresh cluster on both `main` and this branch (no
commission-grid file differs). These suites hand-roll their own `is_ancestor_of`, so they prove non-regression of
their own modules; compatibility with M1/M2 is proven by the hierarchy harness.

## 4. Frontend and build (this session)

| Check | Branch | `main` `f03af3b` |
|---|---|---|
| `npx vitest run` (full) | 1 failed, 6531 passed, 37 skipped (423 files) | 1 failed, 6241 passed, 36 skipped (410 files) |
| The single failure | `recordingRetentionVoicemail` "byte-identical to deployed v29" — identical on `main`, unrelated | same |
| `tsc --noEmit` | exit 0 | exit 0 |
| `tsc -p tsconfig.app.json` | 80 errors, none new (3 fixed, 1 more by the follow-ups) | 84 |
| ESLint on the 58 touched source files | 0 errors; 5 warnings after removing two unused directives (7 in the final log), all pre-existing `exhaustive-deps` lines in `Contacts.tsx` (`main` had 36 warnings on these files) | — |
| `npm run build` | success | — |
| `git diff --check` | clean | — |

Vitest ran with `VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=placeholder` (the container has no
Supabase env); without them 9 files fail at import on both branches.

**CI gate correction (`uv-profile-sync.yml`).** The step "Reject additional app typecheck errors against exact base"
failed on this PR (run 39988838948) although no diagnostic is new. It required the `tsc -p tsconfig.app.json` output to
be byte-identical, and this branch's output differs in two ways:
- **Four errors are fixed:** `HierarchyTree.tsx` ×2, `profile-org-view.ts` and `profileScopeAndOrgTree.test.ts`.
- **One pre-existing error moved:** in `supabase-users.ts`, from line 619 to 774.

The step now runs `scripts/verify-a2p-types.mjs`, the exact-base comparison the A2P and Google Sheets workflows
already use. It counts diagnostics by file, code and message with coordinates normalized, and fails on any added
diagnostic. `reports-frontend.yml` applies the same rule.

Local proof against `80921d1`:
- unchanged branch: `base=84, candidate=80, new=0` (exit 0);
- with one injected type error: `new=1` (exit 1).

## 5. Independent security review (21 confirmed: 18 fixed and re-verified, 3 documented)

Five fresh reviewers (none wrote the code) attacked the implementation on disposable clusters — authorization bypass,
hierarchy integrity, apply safety, frontend, mutation testing — and an adversarial verifier re-checked each lens.
After remediation a separate verifier re-ran the original exploits and mutants against the new code.

| Finding | Severity (verified) | Disposition |
|---|---|---|
| AUTHZ-1 TL reassign + org change made downline contacts vanish or move tenants | major | **Fixed** — contact tenancy guard in M1; exploits refused; tests added |
| C-1 CI database job could never pass (bridge address vs loopback proof) | major | **Fixed** — host-network PG 17.6, digest-pinned |
| AUTHZ-3 anon upline-chain oracle open until M2 | minor | **Fixed** — revokes moved to M1 |
| AUTHZ-4 calls guard accepted client `updated_at` | nit | **Fixed** — stamped `now()` |
| INT-1 M3 fingerprint bound rows, not targets | minor | **Fixed** — reviewed id fingerprint kept + target fingerprint required |
| INT-2 RR/SERIALIZABLE race could leave a fail-open path | minor | **Fixed** — READ COMMITTED only (0A000) |
| TESTS-01..06 (stage could silently drop, no pinned counts, untested D2 / per-table toggles / inactive TL, over-claiming text) | minor/nit | **Fixed** — mutants m04, m24, m27, m28 and the `\q` truncation now fail the run |
| FE-01 stale Add Agent load; FE-02 apostrophe search; FE-03 component size | minor/nit | **Fixed** |
| C-3 / C-4 / AUTHZ-5 (image digest, harness comment, leftover-role check) | nit | **Fixed** |
| AUTHZ-2 import-undo toggles not enforced | minor | **Documented** (pre-existing; plan §4 corrected, §12) |
| INT-3 invitation guard creation-time only; INT-4 multi-row order sensitivity | nit | **Documented** |
| C-2 CI path coverage | — | refuted by the verifier; new hook added to the workflow anyway |

Verified strengths include: every single-statement cycle form rejected (CASE, UPDATE…FROM, MERGE, ON CONFLICT);
system path forgeries overwritten; 1,500-statement fuzz with consistency 0 after every step; no new data exposure in
the frontend (TL User Management narrowed from the whole org to the downline; no new `select('*')`; every new
profiles query org-filtered); fail-closed scope errors; View As unaffected; `is_ancestor_of` RLS cost ~40–47 µs vs
~35 µs per call (no material regression).

## 6. Not verified / residual risk

- **PostgreSQL 17.6** (production and CI) was not run locally (no Docker daemon). The new post-image digests
  (e.g. calls guard `454ee627…`, contact guard `dc72173f…`, lock function `559344d1…`) are proven by the PR's CI run
  (§2, "CI on PostgreSQL 17.6"). **Gate 2a still requires that run green at the head being applied (§8).**
- The original full-stack suites `p0_profile_authorization.sql` and `import_campaign_attachment.sql` need a local
  Supabase stack and were **NOT EXECUTED**; only comment/label text changed in them, and their TL/trigger cases are
  ported into the harness.
- Not harnessed: the Phase 2A commission engine path that needs the cluster-global writer role (the capture decision
  is exercised verbatim); `get_performance_summary`/`details` wrappers (only `performance_scope`); production
  side-effect triggers on leads/clients/campaign_leads/tasks.
- No authenticated browser walkthrough by role (no test-user sign-in in this session).
- Residuals recorded in plan §12, notably: stale **Admin** tokens keep token-based Admin branches until refresh;
  `super_admin_own_org` trusts the claim; import-undo toggles unenforced; contact INSERT into a foreign/NULL
  organization; the global hierarchy advisory lock can be taken by any authenticated zero-row PATCH listing
  `upline_id` (one statement).

## 7. Security advisors baseline (read-only, 2026-10-23, before any change)

`get_advisors(security)`: anon-executable SECURITY DEFINER 57, authenticated-executable 138, mutable search_path 22,
`extension_in_public` 3 (incl. `ltree`, intentionally kept), RLS-enabled-no-policy 33, RLS-disabled-in-public 2, leaked
password protection off. Hierarchy entries present today: anon-executable `compute_hierarchy_path`, `is_ancestor_of`,
`update_hierarchy_path`, `cascade_hierarchy_update`, `on_profile_update`; authenticated-executable the same five;
mutable search_path `on_profile_update`. Expected after M1: the four anon entries for the path functions and
`is_ancestor_of` and the three authenticated entries for the path functions clear (authenticated keeps
`is_ancestor_of` by design). Expected after M2: both `on_profile_update` executable entries and its search_path entry
clear. The new `profile_authz` helpers live outside the exposed schema.

## 8. Gate 2a preflight checklist (read-only, immediately before applying M1) — used for Gate 2a; release record in §9

1. CI `hierarchy-stabilization.yml` green on PostgreSQL 17.6 at the PR head.
2. `list_migrations` head; version for M1 sorts after it.
3. M1 guard prerequisites re-checked (preimage digests, ACLs, the 9 policy expressions, trigger digests incl. the two
   clients triggers that fire before the new organization guard, no existing objects with the new names).
4. §1 baseline unchanged (4 stale, both fingerprints, `f809493e` 0 recognised descendants).
5. Apply at a quiet time (CREATE POLICY / triggers take brief table locks; `lock_timeout` 1 s fails fast).
6. Read back bodies, ACLs, policies, triggers, `pg_depend` (10 policies), advisors; reconcile the file name to the
   stamped version and re-pin pending M2/M3.

## 9. Gate 2a release record (M1 live; re-read read-only from this session on 2026-10-23)

Chris had M1 applied and verified in production through a separate (ChatGPT) session; this session did not apply it.
This session then re-read production independently, read-only:

| Fact | Value |
|---|---|
| Recorded migration | `20261023210027 / hierarchy_authorization_boundaries` (authored as `20261023210000`; `apply_migration` stamps its own version) |
| Recorded statements | 1, SHA-256 `5d99c92328a507451968133603c8f53cd13a782a9749637dfc32d449e137d5df`, 37 906 characters: byte-identical to the repository file |
| Migration head / rows | `20261023210027` / 344 (was `20261022062539` / 343); no M2 or M3 row |
| M2 prerequisite digests | `is_ancestor_of` `c6d121db…`, `actor_is_team_leader` `bbc07ccb…`, `actor_is_org_admin` `c64ef188…`, commission trigger `a85d3c1e…`, calls trigger `ae888acb…`: all equal M2's guard constants |
| Guard functions | calls guard `454ee627…` and contact guard `dc72173f…` (SECURITY INVOKER); commission guard `cc306236…` (SECURITY DEFINER); each pins `search_path = pg_catalog, public, pg_temp`; EXECUTE by `postgres` only |
| Policies | 4 RESTRICTIVE DELETE policies (the leads, clients and recruits Contacts-toggle policies and `calls_delete_own_rows_or_org_admin`); `tasks_select_team_leader` TO `authenticated` through `is_ancestor_of`; 10 policies depend on `is_ancestor_of` |
| Guard triggers | 5, all enabled: commission (`profiles`), calls, and the contact organization guard on `leads`, `clients`, `recruits` |
| ACLs | `is_ancestor_of`: `postgres`, `authenticated`, `service_role` (anon/PUBLIC revoked); `compute_hierarchy_path`, `update_hierarchy_path`, `cascade_hierarchy_update`: `postgres`, `service_role`; the two helpers: `postgres`, `authenticated` |
| Path functions | preimage bodies unchanged (`b9aaa16d…`, `d9ff2d22…`, `8392e93e…`), which is the state M2 accepts |
| M2 / M3 objects | absent (builder, lock function, consistency function, `idx_profiles_upline_id`) |
| Data | 16 profiles, 11 upline edges; 4 stale paths (`4ef505e0`, `5f952f0d`, `89f2e994`, `e5c4ee04`); id fingerprint `ddc1f53f…` and target fingerprint `7daae418…` unchanged |
| Security advisors (observed 21:11 UTC) | anon-executable SECURITY DEFINER 57 → **53**; authenticated-executable 138 → **135**; mutable search_path 22, unchanged (`on_profile_update` clears at M2); every other category unchanged. This is exactly what §7 predicted. |
| Performance advisors | `auth_rls_initplan` lists `calls_delete_own_rows_or_org_admin`, new in M1 and DELETE-only (follow-up: wrap `auth.uid()` as `(select auth.uid())`), and `tasks_select_team_leader`; `profiles_upline_id_fkey` is an unindexed foreign key, which M2's `idx_profiles_upline_id` addresses. No performance baseline was taken before M1. |

**Full inventory comparison.** One query was run against production and against the local S1 state built from the
same file (`scratchpad` `gate3/inventory.sql`). It covers:
- function digests, security flags, configured search_path, owners and ACLs;
- policy mode, command, roles and expressions;
- trigger definitions and enabled state;
- the dependent-policy count.

The result is in §10.

**Repository reconciliation (Gate 3 preparation).**
- Both M1 files were renamed to `20261023210027_…` with `git mv`. The forward bytes are unchanged; its line-60 comment
  still names the authored rollback path, because applied bytes are immutable.
- The references were updated: the state helper, the runner expectation and M2's refusal message (only its text
  changed).
- The runner now pins M1's applied version and SHA-256, and fails if M2 or M3 appears outside `pending/`.


## 10. Gate 3 readiness (frontend release on the live M1-only database)

**Production equals S1.** The §9 inventory query returned 42 lines from production. The same query on a local
database built as S1 from the renamed M1 file (`scripts/hierarchy_test_state.sh S1`) returned 42 lines, and the two are
**identical**. They cover:
- every M1 function (digest, SECURITY DEFINER flag, configured search_path, owner, ACL);
- the path functions, `on_profile_update`, `can_update_profile` and `has_contacts_permission`;
- the 10 policies that depend on `is_ancestor_of`, the 4 RESTRICTIVE policies and `tasks_select_team_leader` (mode,
  command, roles, both expressions);
- all `profiles` triggers, the calls and contact guards, and the two clients triggers that fire before the
  organization guard.

The same query on S0 differs from S1 by exactly M1's intended changes. So the S1 results below describe production.

**Local verification at `9962c63` (PostgreSQL 16.15, CI mode, PostgREST 12.2.3).**

| Check | Result |
|---|---|
| `scripts/run_hierarchy_stabilization_tests.sh` | exit 0. "ALL HIERARCHY STABILIZATION PROOFS PASSED": **2749 PASS lines** (2747 plus the 2 new static checks). Core 64/64/114/114/64/64/64, RLS 1043, RPC 567, forged 336, compatibility 190 (27 cases × 7 states, S1 included), every count at its pin. All 70 databases dropped. |
| New static checks | M1 is pinned to version `20261023210027` and SHA-256 `5d99c923…`; no top-level M2/M3. Mutation-tested (a changed byte, an extra copy under the old name, the old name only, M2 or M3 at the top level): all five fail, and the unmodified tree passes. |
| `npx tsc --noEmit` | exit 0 |
| App typecheck against `main` `80921d1` (`scripts/verify-a2p-types.mjs`) | `base=84, candidate=80, new=0` |
| Focused hierarchy / User Management / Contacts / CampaignDetail Vitest (the CI list) | 44 files, 634 passed, 2 skipped |

**What the frontend does on S1 (compatibility suite).** On S1, the real data-layer modules behave exactly as on the
other states, with M1's narrowing applied:
- A Team Leader's downline account-control writes, profile saves and `commission_level` changes are refused
  (W07–W09, W12). On S1 the reason is that RLS filters the row: the stale paths give the Team Leader no recognised
  descendants until M3. The UI's read-back therefore reports "Update failed: user profile not found or permission
  denied". M1's explicit 42501 guard messages appear only once a branch is active (S3).
- Team Leader user deletes are refused before any write (W10), and a demoted Admin's stale token is refused (W11).
- The legacy always-send-`upline_id` save (W02) still heals stale paths on S1. That is the documented D14 interim
  risk. The new frontend no longer does it (F1).

**Release preconditions still open (Chris).**
1. Explicit Gate 3 approval.
2. Supabase "Deploy to production" confirmed **OFF** in the dashboard (invariant #30). If it were ON, a merge could
   replay legacy migrations whose versions do not match production.
3. CI green at the PR head.
4. Immediately before the merge, re-read production read-only:
   - head `20261023210027`, M1 statement SHA-256 `5d99c923…`;
   - the §9 inventory still identical to S1;
   - 4 stale paths with both fingerprints;
   - no M2/M3 row or object;
   - both Vercel projects' current production deployment ids, recorded as rollback targets. At preparation time
     (main `80921d1`) they are `agentflow` `dpl_ApSgSsRRXpzDRJpFDWUtBPJg4tqW` and `agentflow-life-insure`
     `dpl_Ho62Md54pbAJYXAocLtYhxBqEGsV`, both READY and rollback candidates.

**After the merge (Gate 3 completion checks).**
- Both Git-linked Vercel production projects are READY at the exact merge SHA and serve new hashed assets on their
  production URLs.
- Production's migration head is still `20261023210027`, with no M2/M3 row. "Both projects on the Gate 3 SHA" is a
  Gate 2b precondition.
- The rollback is plan §10 "Frontend (Gate 3)": promote the previous deployments, never `git revert` the PR.

**CI at `a1a83fe`.** All 13 GitHub Actions checks pass; Supabase Preview is skipped. In run 40026346591,
`hierarchy-stabilization.yml` on PostgreSQL 17.6 (Debian 17.6-2.pgdg13+1) with PostgREST 12.2.3 reports "ALL
HIERARCHY STABILIZATION PROOFS PASSED": **2749 PASS lines**, every count at its pin (compatibility 190, forged 336).
UV profile sync, Reports frontend, commission/sales/contact, consent, native, postgres, browser and paired-native also
pass.

**Final independent security review (Gate 3, at `9962c63`).** Four lenses: live-M1 frontend behaviour,
release/deployment safety, frontend security and tenancy, and reconciliation and docs accuracy. Each finding was
checked by two adversarial verifiers, and a completeness critic followed (17 agents).
- **No release blocker.** Release safety and frontend security found nothing new: org scoping, no service-role use or
  secrets, and no automated path that applies M2/M3.
- **Fixed in this preparation (docs only):**
  - plan §G3 overstated why the merge is migration-free (it is because "Deploy to production" is OFF, invariant #30);
  - wrong cross-references and the rollback-header description in §G3;
  - the AGENT_RULES plan revision, and its read-back statement (now names exactly which writes read back);
  - the Gate 3 rollback said "Revert the PR", which would delete applied M1's only repository copy and bring back the
    old ordinary-save hazard. It now says to promote the previous deployments;
  - Gate 3 verified only one Vercel project; it now checks both.
- **Pre-existing, recorded as plan §12 follow-ups (no code change without approval):**
  - a Team Leader's Goals/Onboarding refusals show `updateProfile`'s older "apply the latest database migrations"
    message (nit);
  - deactivate, reactivate and billing-type writes have no read-back (minor; already listed);
  - the onboarding toggles persist nothing (minor; a disputed verdict: one verifier judged it unreachable in
    production).

## 11. Gate 3 completion and Gate 2b release record (2026-10-23)

**Gate 3 (frontend), verified read-only by this session at 23:05–23:11 UTC.**

| Fact | Value |
|---|---|
| Merge | PR #485 squash-merged as `89e452cdf446b08f2a3addffec8ee8b1db53834f`; tree identical to the reviewed head `97ef36d` |
| `agentflow` | `dpl_HLo8CYs8uaxrBvGUveaeJMkD7dPP` READY at `89e452c`; aliases `www.fflagent.com`, `fflagent.com` |
| `agentflow-life-insure` | `dpl_GHgG7xHmFBiX5hYcTKdh4bdyrxCS` READY at `89e452c`; alias `agentflow-life-insure.vercel.app` |
| Database after the merge | head `20261023210027`, 344 rows, no M2/M3 row or object; `is_ancestor_of` `c6d121db…`; 16 profiles; 4 stale paths; both fingerprints unchanged. This is consistent with "Deploy to production" being OFF. |
| Rollback targets | `dpl_ApSgSsRRXpzDRJpFDWUtBPJg4tqW` / `dpl_Ho62Md54pbAJYXAocLtYhxBqEGsV` (promote; never `git revert` #485) |
| Not verified | Served assets: this container's proxy refuses the production hosts (HTTP 403 on CONNECT). The alias assignment is the evidence. |

**Gate 2b (M2), applied and verified by Chris through a separate session.**

| Fact | Value | Source |
|---|---|---|
| Recorded migration | `20261023232435 / hierarchy_integrity` (authored as `pending/20261023210100_hierarchy_integrity.sql`) | Chris's report |
| SHA-256 | `7f2c61dbdfdd39938d424bc26e024c81c823a5a41692c5a0607a8bff87377aa3` | Chris's report; this session confirmed it equals the repository bytes on `main` `89e452c` (32 520 bytes) |
| M1 | still `20261023210027` | Chris's report |
| M3 | not applied | Chris's report |
| Independent re-read | **not performed this round.** Chris asked for no backend commands; the Gate 2c preflight (§12, P1–P3) re-checks M2's post-image | — |

The bytes are identical to the Gate 1-reviewed M2 except for the refusal-message re-pin made at Gate 3 preparation
(`M1 (20261023210000 …)` → `M1 (20261023210027 …)`). M3 (`2da22c6f…`) is byte-identical to its Gate 1-reviewed
version at every commit since.

**Repository reconciliation (Gate 2b release-record PR, plan §G2b).**
- M2 and its rollback were renamed from `pending/20261023210100_…` / `rollback/20261023210100_…` to
  `20261023232435_…` with `git mv`. The forward bytes are unchanged; its line-58 comment still names the authored
  rollback path, because applied bytes are immutable. The rollback changed in its first header comment only.
- References were updated in the state helper, one `p0_profile_authorization.sql` comment and one
  `hierarchy-stabilization.yml` comment.
- **Runner static checks (CI version and checksum assertions):** for each applied hierarchy migration,
  - exactly one top-level file, named after the recorded version;
  - its SHA-256 equals the recorded statement's;
  - no copy left in `pending/`.

  M1 is pinned to `20261023210027` / `5d99c923…` and M2 to `20261023232435` / `7f2c61db…`. M3 must stay in `pending/`,
  with no top-level copy.
- **Mutation-tested:** a changed byte in M1, a changed byte in M2, M2 left in `pending/`, M2 under its old name, an
  extra top-level M2 copy, M3 copied to the top level, and M3 moved out. All seven fail, and the unmodified tree
  passes all four checks.

**Local verification (PostgreSQL 16.15, CI mode, PostgREST 12.2.3).**
- `scripts/run_hierarchy_stabilization_tests.sh` exited 0: "ALL HIERARCHY STABILIZATION PROOFS PASSED", **2750 PASS
  lines** (one more than before: the M2 pin). Every count matched its pin:
  - core 64/64/114/114/64/64/64;
  - RLS 1043 and RPC 567;
  - PostgREST forged requests 336;
  - frontend compatibility 190.
- The M3 stage passed:
  - the unmodified file refuses the synthetic set;
  - the right ids with production's target fingerprint are refused;
  - a substituted copy repairs exactly 4 rows (one NOTICE each, path and `updated_at` only, 8 `set_claim` writes, no
    UV/notification effect);
  - the second run is a no-op;
  - a re-parented stale set is refused.
- `npx tsc --noEmit`: exit 0. No `src/` file changed.

## 12. Gate 2c readiness — M3, the fingerprint-bound four-row repair (EXECUTED 2026-10-24 04:58:12 UTC through the SQL Editor, not `apply_migration`; release record in §13)

**What M3 does.** `supabase/migrations/pending/20261023210200_hierarchy_path_repair.sql`, SHA-256
`2da22c6f45163174c26b7edff75e73bb5a286ec9c87f12bfcabf3a0dc57a4c6b`, unchanged since the Gate 1 review:
- It refuses unless M1's and M2's post-images are live (checked by digest, not version), and the data has no
  self-parent, cross-organization edge or unreachable row.
- With nothing stale it is a no-op. Otherwise it refuses unless the stale set is exactly the reviewed four rows (id
  fingerprint `ddc1f53f3823c6e367310a748ea0ac85`) **and** their target paths are the reviewed ones (target
  fingerprint `7daae418571600b43b7cf5d5155be0d4`).
- It rewrites `hierarchy_path` on those four rows only: `4ef505e0`, `5f952f0d`, `89f2e994`, `e5c4ee04`. Triggers stamp
  `updated_at`, and there is one NOTICE per row.
- Postconditions (checked by M3 itself): 0 stale, 0 NULL, 0 missing and 0 extra pairs, and `path_pairs =
  expected_pairs` (15/15 with today's 16 profiles). A second run is a no-op.
- **Effect (plan §4):** it adds exactly 6 ancestor pairs and removes none.
  - `f809493e→{4ef505e0, e5c4ee04, 89f2e994}`, `ecf2bb91→{89f2e994, 5f952f0d}` and `86ca95f2→5f952f0d`. `86ca95f2` is
    Deleted and banned, and inert under M1.
  - **Team Leader `f809493e` gains downline authority:**
    - their leads and clients: SELECT, INSERT and UPDATE. Direct DELETE only with the Contacts delete toggle (default
      off);
    - their calls: SELECT, plus UPDATE of `flagged_for_coaching` and `notes` only, with no DELETE;
    - their contact history;
    - their profile rows, but not `commission_level` or account-control fields.

  No access is withdrawn from anyone.

**Invariant #28 elements Gate 2c needs.**
1. **Separate exact approval:** `#APPROVE_RLS_CHANGE`, plus explicit approval of the four target rows and both
   fingerprints.
2. **Read-only preflight**, run immediately before the apply (below), with every result matching the expected
   values.
3. **Bounded targets:** 4 `public.profiles` rows, the `hierarchy_path` column only (`updated_at` by trigger).
   - **Side writes:** `on_profile_update` makes 8 `set_claim` UPDATEs of `auth.users.raw_app_meta_data`, on the same
     4 users. The values are unchanged, except that banned `5f952f0d` gains the missing `organization_id` and `role`
     keys (plan §6.3).
   - There is no `auth.users.updated_at` bump and no session, realtime, UV or notification effect.
   - P5b records the keys' presence beforehand.
4. **Recovery plan (plan §10):** operational revocation. An Admin reassigns the affected agents' upline (M2's triggers
   re-derive paths immediately) or changes the Team Leader's role. Rolling back functions never removes granted
   authority. There is no data inverse; a byte-exact restore would need an invariant #29 artifact, M2 rolled back
   (while M2 is live, any path write is re-derived canonically) and its own approval.
5. **Forensic snapshot** (`id8`, stored and target depth, `upline8`, status, `updated_at` of the four rows; P5 below),
   recorded in this file before the apply.

**Read-only preflight (SELECT-only; one session).** It was tested on the local S2 state. P2–P7 (with P2b and P5b) run
there; P2b on S1 correctly reports the 6 functions and 3 triggers M2 had not yet created; P1 needs
Supabase's history schema.

```sql
-- Gate 2c read-only preflight (hierarchy M3). SELECT-only; run immediately before applying M3, in one session.
SET search_path TO "$user", public, extensions;
-- P1 history of the three hierarchy migrations and the head
SELECT 'P1' AS step, version, name, array_length(statements, 1) AS n_statements,
       encode(sha256(convert_to(array_to_string(statements, ''), 'UTF8')), 'hex') AS sha256
  FROM supabase_migrations.schema_migrations
 WHERE name IN ('hierarchy_authorization_boundaries', 'hierarchy_integrity', 'hierarchy_path_repair')
 ORDER BY version;
SELECT 'P1h' AS step, max(version) AS head, count(*) AS migration_rows FROM supabase_migrations.schema_migrations;
-- P2 the M1 + M2 post-image inventory as one hash (lines sorted with the C collation)
SELECT 'P2' AS step, count(*) AS lines, md5(string_agg(line, E'\n' ORDER BY line COLLATE "C")) AS inventory_md5
  FROM (
WITH fns AS (
  SELECT 'fn' AS kind, p.oid::regprocedure::text AS name,
         md5(pg_get_functiondef(p.oid)) || '|secdef=' || p.prosecdef::text || '|vol=' || p.provolatile::text ||
         '|cfg=' || coalesce(array_to_string(p.proconfig, ','), '') ||
         '|owner=' || pg_get_userbyid(p.proowner) || '|acl=' || coalesce(array_to_string(p.proacl, ' '), 'NULL') AS v
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE (n.nspname, p.proname) IN (('public','is_ancestor_of'), ('profile_authz','actor_is_team_leader'),
         ('profile_authz','actor_is_org_admin'), ('private','guard_profile_commission_level'),
         ('private','guard_team_leader_downline_call_update'), ('private','guard_contact_organization_change'),
         ('public','compute_hierarchy_path'), ('public','update_hierarchy_path'), ('public','cascade_hierarchy_update'),
         ('public','on_profile_update'), ('profile_authz','can_update_profile'), ('public','has_contacts_permission'),
         ('private','build_hierarchy_path'), ('private','lock_profile_hierarchy'),
         ('private','validate_invitation_upline'), ('private','hierarchy_consistency'))
), pols AS (
  SELECT 'policy' AS kind, c.relname || '.' || pol.polname AS name,
         'permissive=' || pol.polpermissive::text || '|cmd=' || pol.polcmd::text || '|roles=' ||
         coalesce(array_to_string(ARRAY(SELECT CASE WHEN r = 0 THEN 'public' ELSE r::regrole::text END
                                          FROM unnest(pol.polroles) r ORDER BY 1), ','), '') ||
         '|qual=' || md5(coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')) ||
         '|check=' || md5(coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) AS v
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
   WHERE pol.polname IN ('leads_tl_delete_requires_contacts_permission', 'clients_tl_delete_requires_contacts_permission',
                         'recruits_tl_delete_requires_contacts_permission', 'calls_delete_own_rows_or_org_admin',
                         'tasks_select_team_leader')
      OR pol.oid IN (SELECT objid FROM pg_depend WHERE classid = 'pg_policy'::regclass
                        AND refobjid = 'public.is_ancestor_of(uuid,uuid)'::regprocedure)
), trgs AS (
  SELECT 'trigger' AS kind, c.relname || '.' || t.tgname AS name,
         md5(pg_get_triggerdef(t.oid)) || '|enabled=' || t.tgenabled::text AS v
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
     AND (c.relname = 'profiles' OR t.tgname IN ('trg_validate_invitation_upline', 'calls_00_guard_team_leader_downline_update',
                                                'contacts_00_guard_organization_change',
                                                'clients_lead_conversion_guard', 'clients_policy_identity'))
), idx AS (
  SELECT 'index' AS kind, indexrelid::regclass::text AS name, md5(pg_get_indexdef(indexrelid)) AS v
    FROM pg_index WHERE indexrelid = to_regclass('public.idx_profiles_upline_id')
), dep AS (
  SELECT 'meta' AS kind, 'is_ancestor_of_dependent_policies' AS name,
         (SELECT count(DISTINCT objid) FROM pg_depend WHERE classid = 'pg_policy'::regclass
             AND refobjid = 'public.is_ancestor_of(uuid,uuid)'::regprocedure)::text AS v
)
SELECT kind || ' ' || name || ' ' || v AS line
  FROM (SELECT * FROM fns UNION ALL SELECT * FROM pols UNION ALL SELECT * FROM trgs UNION ALL SELECT * FROM idx
        UNION ALL SELECT * FROM dep) x
 ORDER BY 1
  ) inv;
-- P2b M3's own preconditions, run read-only (the same digests, triggers and policy set M3 checks before it writes)
WITH fns(fn, digest) AS (VALUES
      ('public.is_ancestor_of(uuid,uuid)', 'c6d121db50b7ea2e37ce4a620cc855af'),
      ('profile_authz.actor_is_team_leader()', 'bbc07ccb69be5c0eed098e17bd9d191d'),
      ('profile_authz.actor_is_org_admin(uuid)', 'c64ef188736fae1b90dc7e6a8d29e04f'),
      ('private.guard_profile_commission_level()', 'cc306236935837d49ff89540bb8dff89'),
      ('private.guard_team_leader_downline_call_update()', '454ee627b8df12d5e7f9acc6d526288e'),
      ('private.guard_contact_organization_change()', 'dc72173fb9d9c786a63af8ed193f5ef6'),
      ('private.build_hierarchy_path(uuid,uuid,uuid,boolean)', 'fecfc2995febeb119f0bc5b862e16500'),
      ('public.compute_hierarchy_path(uuid)', '058bb6b37b152aec062c87f8ac929425'),
      ('private.lock_profile_hierarchy()', '559344d1b35aafaa3567405269b34989'),
      ('public.update_hierarchy_path()', 'f892eb620cdf4d146a112e5b66783d6b'),
      ('public.cascade_hierarchy_update()', 'e26ddd18e96bffec29d440280176ca2a'),
      ('private.hierarchy_consistency()', 'e1984a07ba5c76004d5f9290d49f2834'),
      ('public.enforce_profile_field_authorization()', 'b9b4c345b470c94923cddace49cd1d5b')),
trg(tbl, name, digest) AS (VALUES
      ('public.profiles', 'trg_01_guard_profile_commission_level', 'a85d3c1edb2ce795b391b780de7bc413'),
      ('public.calls', 'calls_00_guard_team_leader_downline_update', 'ae888acb2d2139410e346827ec999c65'),
      ('public.profiles', 'trg_update_hierarchy_path', '41c39a180f8715ab543c6a02af00eaf3'),
      ('public.profiles', 'trg_cascade_hierarchy_update', '9540c1a57f6878f9e1b625840c261085'),
      ('public.profiles', 'trg_update_hierarchy_path_lock', '69081184456094326ffbd0b34942e7c1'),
      ('public.profiles', 'trg_00_enforce_profile_field_authorization', 'fc02958ebc6986a60bda53127323bb7c'),
      ('public.leads', 'contacts_00_guard_organization_change', 'e04378078c3e0f31b889a559acfc4519'),
      ('public.clients', 'contacts_00_guard_organization_change', '4566b07550a98655bd381f9626738767'),
      ('public.recruits', 'contacts_00_guard_organization_change', '387528f7702e1a276a0bbee1e64e62ab')),
fn_bad AS (SELECT fn FROM fns
            WHERE to_regprocedure(fn) IS NULL OR md5(pg_get_functiondef(to_regprocedure(fn))) <> digest),
trg_bad AS (SELECT trg.name || ' on ' || trg.tbl AS t FROM trg
             WHERE NOT EXISTS (SELECT 1 FROM pg_trigger x
                                WHERE x.tgrelid = trg.tbl::regclass AND x.tgname = trg.name AND x.tgenabled = 'O'
                                  AND md5(pg_get_triggerdef(x.oid)) = trg.digest)),
pol AS (SELECT string_agg(p.polname, ',' ORDER BY p.polname COLLATE "C") AS v FROM pg_policy p
         WHERE NOT p.polpermissive AND p.polcmd = 'd' AND p.polroles = ARRAY['authenticated'::regrole::oid]
           AND p.polrelid IN ('public.leads'::regclass, 'public.clients'::regclass,
                              'public.recruits'::regclass, 'public.calls'::regclass))
SELECT 'P2b' AS step,
       (SELECT count(*) FROM fn_bad) AS functions_not_reviewed, (SELECT string_agg(fn, ', ') FROM fn_bad) AS bad_functions,
       (SELECT count(*) FROM trg_bad) AS triggers_not_reviewed, (SELECT string_agg(t, ', ') FROM trg_bad) AS bad_triggers,
       (SELECT v FROM pol) = 'calls_delete_own_rows_or_org_admin,clients_tl_delete_requires_contacts_permission,'
                             'leads_tl_delete_requires_contacts_permission,recruits_tl_delete_requires_contacts_permission'
         AS restrictive_delete_policies_ok;
-- P3 consistency report
SELECT 'P3' AS step, * FROM private.hierarchy_consistency();
-- P4 the stale set and both fingerprints M3 requires
WITH RECURSIVE canon(id, path, visited) AS (
    SELECT p.id, public.text2ltree(replace(p.id::text, '-', '_')), ARRAY[p.id] FROM public.profiles p WHERE p.upline_id IS NULL
    UNION ALL
    SELECT c.id, k.path || public.text2ltree(replace(c.id::text, '-', '_')), k.visited || c.id
      FROM canon k JOIN public.profiles c ON c.upline_id = k.id WHERE c.id <> ALL (k.visited))
SELECT 'P4' AS step, count(*) AS stale, md5(string_agg(p.id::text, ',' ORDER BY p.id)) AS id_fingerprint,
       md5(string_agg(p.id::text || '=' || c.path::text, ',' ORDER BY p.id)) AS target_fingerprint
  FROM public.profiles p JOIN canon c ON c.id = p.id WHERE p.hierarchy_path IS DISTINCT FROM c.path;
-- P5 forensic snapshot of the four rows (8-character prefixes only), recorded in verification.md before applying
WITH RECURSIVE canon(id, path, visited) AS (
    SELECT p.id, public.text2ltree(replace(p.id::text, '-', '_')), ARRAY[p.id] FROM public.profiles p WHERE p.upline_id IS NULL
    UNION ALL
    SELECT c.id, k.path || public.text2ltree(replace(c.id::text, '-', '_')), k.visited || c.id
      FROM canon k JOIN public.profiles c ON c.upline_id = k.id WHERE c.id <> ALL (k.visited))
SELECT 'P5' AS step, left(p.id::text, 8) AS id8, public.nlevel(p.hierarchy_path) AS stored_depth,
       public.nlevel(c.path) AS target_depth, left(p.upline_id::text, 8) AS upline8, p.status, p.updated_at
  FROM public.profiles p JOIN canon c ON c.id = p.id WHERE p.hierarchy_path IS DISTINCT FROM c.path ORDER BY 2;
-- P5b the claim keys M3's on_profile_update side writes touch (booleans only), part of the forensic snapshot
SELECT 'P5b' AS step, left(u.id::text, 8) AS id8, u.raw_app_meta_data ? 'organization_id' AS has_org_key,
       u.raw_app_meta_data ? 'role' AS has_role_key
  FROM auth.users u WHERE left(u.id::text, 8) IN ('4ef505e0', '5f952f0d', '89f2e994', 'e5c4ee04') ORDER BY 2;
-- P6 Team Leader f809493e: descendants recognised today vs by the upline walk
WITH RECURSIVE tl AS (SELECT id FROM public.profiles WHERE id::text LIKE 'f809493e%'),
walk(id, visited) AS (
    SELECT p.id, ARRAY[p.id] FROM public.profiles p JOIN tl ON p.upline_id = tl.id
    UNION ALL
    SELECT c.id, w.visited || c.id FROM walk w JOIN public.profiles c ON c.upline_id = w.id WHERE c.id <> ALL (w.visited))
SELECT 'P6' AS step,
       (SELECT count(*) FROM public.profiles d, tl WHERE d.id <> tl.id AND public.is_ancestor_of(tl.id, d.id)) AS recognised_now,
       (SELECT count(*) FROM walk) AS upline_walk_descendants,
       (SELECT string_agg(left(id::text, 8), ',' ORDER BY id::text) FROM walk) AS walk_ids8;
-- P7 re-measure plan §4: rows owned by f809493e's upline-walk descendants (they become reachable after M3)
WITH RECURSIVE tl AS (SELECT id, organization_id FROM public.profiles WHERE id::text LIKE 'f809493e%'),
walk(id, visited) AS (
    SELECT p.id, ARRAY[p.id] FROM public.profiles p JOIN tl ON p.upline_id = tl.id
    UNION ALL
    SELECT c.id, w.visited || c.id FROM walk w JOIN public.profiles c ON c.upline_id = w.id WHERE c.id <> ALL (w.visited)),
l AS (SELECT x.id FROM public.leads x, tl WHERE x.organization_id = tl.organization_id AND x.user_id IN (SELECT id FROM walk)),
c AS (SELECT x.id FROM public.clients x, tl WHERE x.organization_id = tl.organization_id AND x.assigned_agent_id IN (SELECT id FROM walk))
SELECT 'P7' AS step,
       (SELECT count(*) FROM l) AS leads_by_user_id,
       (SELECT count(*) FROM c) AS clients_by_assigned_agent,
       (SELECT count(*) FROM public.calls x, tl WHERE x.organization_id = tl.organization_id AND x.agent_id IN (SELECT id FROM walk)) AS calls_by_agent,
       (SELECT count(*) FROM public.contact_history_events e WHERE e.contact_id IN (SELECT id FROM l UNION ALL SELECT id FROM c)) AS history_events_on_those_contacts;
```

**Expected results.**

| Step | Expected | Stop if |
|---|---|---|
| P1 | `20261023210027 hierarchy_authorization_boundaries` with SHA-256 `5d99c923…`, and `20261023232435 hierarchy_integrity` with SHA-256 `7f2c61db…`, one statement each; no `hierarchy_path_repair` row; head `20261023232435` and 345 rows, unless another separately approved migration has landed since | any hierarchy row differs or M3 is recorded |
| P2 | `49` lines, `inventory_md5 = f01ab3483fb26104607f571d80ec4ff3`: the M1 and M2 post-image, identical to the local S2 built from the applied files (lines below) | different hash. Compare line by line with the list below; any difference is reviewed before going on |
| P2b | `functions_not_reviewed 0`, `triggers_not_reviewed 0`, `restrictive_delete_policies_ok true`. These are exactly M3's own preconditions, so a difference here means M3 would refuse | any non-zero count or `false`. The named object differs from the reviewed post-image |
| P3 | **Invariants, all strict:** `missing_pairs 6, extra_pairs 0, stale_paths 4, null_paths 0, self_parents 0, cross_org_edges 0, unreachable 0`, and `expected_pairs − path_pairs = 6`. **Sizes on 2026-10-23:** profiles 16, edges 11, expected_pairs 15, path_pairs 9. Larger sizes are acceptable only when explained by new members outside `f809493e`'s branch: M2 derives their paths correctly, and P6 pins that branch. Record the actual sizes | any invariant differs, or growth that new members outside the branch do not explain |
| P4 | `stale 4`, `id_fingerprint ddc1f53f3823c6e367310a748ea0ac85`, `target_fingerprint 7daae418571600b43b7cf5d5155be0d4` | different values: M3 would refuse; the stale set must be re-reviewed |
| P5 | four rows, `4ef505e0`, `5f952f0d`, `89f2e994`, `e5c4ee04`; record them here as the forensic snapshot | a different set |
| P5b | four rows. Plan §6.3 says `5f952f0d` lacks the `organization_id` / `role` keys (M3's side write adds them) and the other three have them. Record the actual booleans | a row missing |
| P6 | `recognised_now 0`, `upline_walk_descendants 3`, `walk_ids8 4ef505e0,89f2e994,e5c4ee04` | `recognised_now > 0`, which means authority was activated outside the reviewed repair |
| P7 | re-measures plan §4. On 2026-10-23 that was +132 leads, +10 clients, +4,590 calls, +86 history events. Growth from normal work is expected. P7 counts history events by contact ownership, so a small definitional difference from §4's +86 is explained, not blocking | a decrease in leads, clients or calls, or new owners: review before applying |

Also run `get_advisors(security)`. Expected after M2: anon-executable SECURITY DEFINER 52, authenticated-executable
134, mutable search_path 21. The `on_profile_update` entries clear at M2; no new hierarchy entry appears.

<details><summary>Expected P2 inventory lines (local S2 = M1 + M2 applied from the repository files; C-collated)</summary>

```
fn cascade_hierarchy_update() e26ddd18e96bffec29d440280176ca2a|secdef=true|vol=v|cfg=search_path=pg_catalog, public, pg_temp|owner=postgres|acl=postgres=X/postgres service_role=X/postgres
fn compute_hierarchy_path(uuid) 058bb6b37b152aec062c87f8ac929425|secdef=true|vol=v|cfg=search_path=pg_catalog, public, pg_temp|owner=postgres|acl=postgres=X/postgres service_role=X/postgres
fn has_contacts_permission(text) b656907ca141c08a9ba9f5c867c42b6a|secdef=true|vol=s|cfg=search_path=public, pg_temp|owner=postgres|acl=postgres=X/postgres authenticated=X/postgres service_role=X/postgres
fn is_ancestor_of(uuid,uuid) c6d121db50b7ea2e37ce4a620cc855af|secdef=true|vol=s|cfg=search_path=pg_catalog, public, pg_temp|owner=postgres|acl=postgres=X/postgres authenticated=X/postgres service_role=X/postgres
fn on_profile_update() 0afa0358aca12d396b9ae50c292bca6f|secdef=true|vol=v|cfg=search_path=public, pg_temp|owner=postgres|acl=postgres=X/postgres service_role=X/postgres
fn private.build_hierarchy_path(uuid,uuid,uuid,boolean) fecfc2995febeb119f0bc5b862e16500|secdef=true|vol=v|cfg=search_path=pg_catalog, public, pg_temp|owner=postgres|acl=postgres=X/postgres
fn private.guard_contact_organization_change() dc72173fb9d9c786a63af8ed193f5ef6|secdef=false|vol=v|cfg=search_path=pg_catalog, public, pg_temp|owner=postgres|acl=postgres=X/postgres
fn private.guard_profile_commission_level() cc306236935837d49ff89540bb8dff89|secdef=true|vol=v|cfg=search_path=pg_catalog, public, pg_temp|owner=postgres|acl=postgres=X/postgres
fn private.guard_team_leader_downline_call_update() 454ee627b8df12d5e7f9acc6d526288e|secdef=false|vol=v|cfg=search_path=pg_catalog, public, pg_temp|owner=postgres|acl=postgres=X/postgres
fn private.hierarchy_consistency() e1984a07ba5c76004d5f9290d49f2834|secdef=true|vol=s|cfg=search_path=pg_catalog, public, pg_temp|owner=postgres|acl=postgres=X/postgres
fn private.lock_profile_hierarchy() 559344d1b35aafaa3567405269b34989|secdef=true|vol=v|cfg=search_path=pg_catalog, public, pg_temp|owner=postgres|acl=postgres=X/postgres
fn private.validate_invitation_upline() 76f71d54f2ff396080616581f442c87c|secdef=true|vol=v|cfg=search_path=pg_catalog, public, pg_temp|owner=postgres|acl=postgres=X/postgres
fn profile_authz.actor_is_org_admin(uuid) c64ef188736fae1b90dc7e6a8d29e04f|secdef=true|vol=s|cfg=search_path=pg_catalog, public, pg_temp|owner=postgres|acl=postgres=X/postgres authenticated=X/postgres
fn profile_authz.actor_is_team_leader() bbc07ccb69be5c0eed098e17bd9d191d|secdef=true|vol=s|cfg=search_path=pg_catalog, public, pg_temp|owner=postgres|acl=postgres=X/postgres authenticated=X/postgres
fn profile_authz.can_update_profile(uuid) c9761a65a963c45cb7aa6dc178bfde36|secdef=true|vol=s|cfg=search_path=public, pg_temp|owner=postgres|acl=postgres=X/postgres authenticated=X/postgres
fn update_hierarchy_path() f892eb620cdf4d146a112e5b66783d6b|secdef=true|vol=v|cfg=search_path=pg_catalog, public, pg_temp|owner=postgres|acl=postgres=X/postgres service_role=X/postgres
index idx_profiles_upline_id 6200ef769341b8b0667f0716e6101081
meta is_ancestor_of_dependent_policies 10
policy calls.Calls Hierarchical Delete permissive=true|cmd=d|roles=authenticated|qual=37497d04aa864ed0d6b80d2ab0a01810|check=d41d8cd98f00b204e9800998ecf8427e
policy calls.Calls Hierarchical Insert permissive=true|cmd=a|roles=authenticated|qual=d41d8cd98f00b204e9800998ecf8427e|check=983d0bbf7a63d66586402747d60138d0
policy calls.Calls Hierarchical Select permissive=true|cmd=r|roles=authenticated|qual=11a30ab26c1dc348d1125863fd71a6fd|check=d41d8cd98f00b204e9800998ecf8427e
policy calls.Calls Hierarchical Update permissive=true|cmd=w|roles=authenticated|qual=37497d04aa864ed0d6b80d2ab0a01810|check=983d0bbf7a63d66586402747d60138d0
policy calls.calls_delete_own_rows_or_org_admin permissive=false|cmd=d|roles=authenticated|qual=ae4bdbb08b4dfebc1f72c6759f84785f|check=d41d8cd98f00b204e9800998ecf8427e
policy clients.Clients Hierarchical Access permissive=true|cmd=*|roles=authenticated|qual=6bc2d03ca69f509d66711ec272b223e8|check=6bc2d03ca69f509d66711ec272b223e8
policy clients.clients_tl_delete_requires_contacts_permission permissive=false|cmd=d|roles=authenticated|qual=b9b6c708202d5db1a3aa345621b108cc|check=d41d8cd98f00b204e9800998ecf8427e
policy contact_emails.contact_emails_select permissive=true|cmd=r|roles=authenticated|qual=795bda19a5048190ff71471b375c4a0f|check=d41d8cd98f00b204e9800998ecf8427e
policy leads.Leads Hierarchical Access permissive=true|cmd=*|roles=authenticated|qual=4db40edfe28246948621a7c90b7b4309|check=4db40edfe28246948621a7c90b7b4309
policy leads.leads_tl_delete_requires_contacts_permission permissive=false|cmd=d|roles=authenticated|qual=3fc00bba927c58f93d681265c8dc7124|check=d41d8cd98f00b204e9800998ecf8427e
policy profiles.profiles_select_hierarchical permissive=true|cmd=r|roles=authenticated|qual=5234dd30570f6c000db0ed918c53621f|check=d41d8cd98f00b204e9800998ecf8427e
policy recruits.Recruits Hierarchical Access permissive=true|cmd=*|roles=authenticated|qual=6bc2d03ca69f509d66711ec272b223e8|check=6bc2d03ca69f509d66711ec272b223e8
policy recruits.recruits_tl_delete_requires_contacts_permission permissive=false|cmd=d|roles=authenticated|qual=bd825cc1e1e085499e5d22318254567e|check=d41d8cd98f00b204e9800998ecf8427e
policy tasks.tasks_select_team_leader permissive=true|cmd=r|roles=authenticated|qual=99b43cc5f9de132a3fa76f5ab0188f3e|check=d41d8cd98f00b204e9800998ecf8427e
trigger calls.calls_00_guard_team_leader_downline_update ae888acb2d2139410e346827ec999c65|enabled=O
trigger clients.clients_lead_conversion_guard a240a08cc6d1cb8521c761f1f680e739|enabled=O
trigger clients.clients_policy_identity a240538599f6feeff661a86d401c005f|enabled=O
trigger clients.contacts_00_guard_organization_change 4566b07550a98655bd381f9626738767|enabled=O
trigger invitations.trg_validate_invitation_upline c393c409a3d428287db81f720c0a0065|enabled=O
trigger leads.contacts_00_guard_organization_change e04378078c3e0f31b889a559acfc4519|enabled=O
trigger profiles.on_profile_update_trigger 3a263cfd07d006faf8ee054842f785a7|enabled=O
trigger profiles.profiles_updated_at 8dc89bf1e11c8e19fc11aaaa220640a1|enabled=O
trigger profiles.trg_00_enforce_profile_field_authorization fc02958ebc6986a60bda53127323bb7c|enabled=O
trigger profiles.trg_01_guard_profile_commission_level a85d3c1edb2ce795b391b780de7bc413|enabled=O
trigger profiles.trg_cascade_hierarchy_update 9540c1a57f6878f9e1b625840c261085|enabled=O
trigger profiles.trg_update_hierarchy_path 41c39a180f8715ab543c6a02af00eaf3|enabled=O
trigger profiles.trg_update_hierarchy_path_lock 69081184456094326ffbd0b34942e7c1|enabled=O
trigger profiles.trg_zz_platform_admin_notify_user_registered b0225cf3906ab258d4fad48728565b30|enabled=O
trigger profiles.uv_profile_deleted 16cb310e99ab92eb2aee766ff3fd1c95|enabled=O
trigger profiles.uv_profile_saved 1019dbecc18f15bc55524d6f41b6fab6|enabled=O
trigger recruits.contacts_00_guard_organization_change 387528f7702e1a276a0bbee1e64e62ab|enabled=O
```

</details>

**Apply and verify (only after approval).**
1. `apply_migration` with the exact bytes of the pending file (SHA-256 `2da22c6f…`), and no error.
   - If the tool shows NOTICEs, expect 4 per-row NOTICEs plus one summary NOTICE ("4 row(s) repaired; N of N
     expected ancestor pairs present").
   - The read-back below is authoritative.
   - A lock timeout is retryable.
2. Read back:
   - `private.hierarchy_consistency()` gives `stale_paths 0, null_paths 0, missing_pairs 0, extra_pairs 0` and
     `path_pairs = expected_pairs` (15 with today's 16 profiles);
   - P6 gives `recognised_now 3`;
   - P4 gives `stale 0`;
   - the history row holds one statement with SHA-256 `2da22c6f…`;
   - the advisors are unchanged.
3. Release-record PR: move M3 to its recorded version with `git mv`, bytes unchanged. Change the runner's M3 check to
   `pin_applied M3 …`, and fail if any hierarchy migration remains in `pending/`.
4. Monitor `f809493e`'s first sessions. Delete actions stay toggle-gated, and call edits are limited to coaching flag
   and notes (M1).

**Until Gate 2c (D14).**
- Make no real reassignments in `f809493e`'s branch, and no moves of `ecf2bb91` / `86ca95f2`.
- Send **no invitations, by anyone, whose upline is `f809493e` or a member of its branch**.

With M2 live these derive correct paths, so they would activate authority before review.
- Moving one of the 4 stale rows or one of their ancestors changes the fingerprints, so M3 refuses.
- An invitation, or a move into `f809493e`'s branch, leaves both fingerprints unchanged. It is caught only by the
  preflight (P6 `recognised_now > 0` or a larger walk, and P3), and Gate 2c must then be re-reviewed.

## 13. Gate 2c release record — M3 executed once; history-only record prepared (2026-10-24)

### 13.1 Execution (Chris's report)

- **Approval.** Chris approved Gate 2c, M3 only: `#APPROVE_RLS_CHANGE`, the four rows, both fingerprints and the
  operational recovery plan (§12, plan §10).
- **Preflight.**
  - The ChatGPT session ran the §12 read-only preflight.
  - This Claude session ran P5b; the earlier Supabase connector had blocked it. The results are below.
- **Execution.** M3 ran exactly once, through the Supabase SQL Editor, at **2026-10-24 04:58:12 UTC**.
  - It used the reviewed bytes, SHA-256 `2da22c6f45163174c26b7edff75e73bb5a286ec9c87f12bfcabf3a0dc57a4c6b`.
  - It did not go through `apply_migration`, so **no `supabase_migrations.schema_migrations` row exists**.
  - **M3 must never run again.** The history is recorded separately (§13.4).
- **Chris's independent read-back.**
  - 16 profiles and 11 upline links.
  - 0 stale paths, and 15/15 expected ancestor relationships with 0 missing or extra.
  - 0 invalid or cross-organization relationships.
  - The four reviewed paths are repaired, and Team Leader `f809493e` recognises 3 descendants.
  - The four restrictive policies and the ten ancestry-dependent policies are preserved.
  - No new security advisor findings. Both Vercel production projects are READY.

### 13.2 Forensic snapshot, before the apply (actual records)

**P5** (stale set). Depths and the original `updated_at` values are from Chris's pre-apply record. `upline8` and
`status` were read after the apply; M3 changes neither column.

| id8 | Stored → target depth | Original `updated_at` (UTC) | upline8 | status |
|---|---|---|---|---|
| `4ef505e0` | 2 → 3 | 2026-10-20 17:31:43.447612 | `f809493e` | Active |
| `5f952f0d` | 1 → 3 | 2026-08-01 18:53:16.375467 | `86ca95f2` | Deleted |
| `89f2e994` | 1 → 3 | 2026-10-17 20:13:34.689057 | `f809493e` | Deleted |
| `e5c4ee04` | 2 → 3 | 2026-10-09 20:55:07.167573 | `f809493e` | Active |

These depths agree with the Gate 1 pair sets (§1: 6 missing, 0 extra). `4ef505e0` and `e5c4ee04` kept
`ecf2bb91.<self>`. `89f2e994` and `5f952f0d` held only themselves.

**P5b** (claim keys, booleans only). This session ran it before the apply, and it matches Chris's original record.

| id8 | has `organization_id` | has `role` |
|---|---|---|
| `4ef505e0` | true | true |
| `5f952f0d` | false | false |
| `89f2e994` | true | true |
| `e5c4ee04` | true | true |

### 13.3 After the apply (this session, read-only)

Reads ran 2026-10-24 05:02–05:16 UTC. The stored-path fingerprint and the advisors were read at about 16:05–16:12
UTC, and the history and consistency rows were re-read at 16:15:51 UTC.

| Check | Result |
|---|---|
| P3 `hierarchy_consistency()` | profiles 16, edges 11, expected_pairs 15, path_pairs 15; missing 0, extra 0, stale 0, NULL 0, self-parents 0, cross-org 0, unreachable 0 |
| P4 | 0 stale. The four rows' id fingerprint is `ddc1f53f…`. `md5(id=hierarchy_path)` over their **stored** paths is `7daae418…`, the reviewed target fingerprint |
| P5 after | Each of the four is at depth 3 and equals its canonical path. All have `updated_at = 2026-10-24 04:58:12.87362+00` |
| Single transaction | Exactly 4 profiles carry that timestamp. None was updated after it: the newest `updated_at` is still that timestamp at 16:15:51 UTC |
| P5b after | All four users have both keys, and their values equal the profile's `organization_id` and `role`. `5f952f0d` gained them, as plan §6.3 predicted |
| P6 | `recognised_now 3` = `upline_walk_descendants 3` (`4ef505e0,89f2e994,e5c4ee04`) |
| P2 (M1+M2 post-image) | 49 lines, `f01ab3483fb26104607f571d80ec4ff3`, unchanged |
| Security advisors | anon SECURITY DEFINER 52, authenticated 134, mutable `search_path` 21, as expected after M2. The only hierarchy entry is `is_ancestor_of` executable by `authenticated`. That is by design (10 policies use it) and already counted in the 134 |
| History | 345 rows, head `20261023232435`, version-list md5 `0508849bbc699c2e9e23f26d7d69d8d2`. No row at `20261024045812`, none dated `20261024…`, none named `hierarchy_path_repair`. The same at 16:15:51 UTC, with P3 unchanged |
| Postgres logs 04:50–05:05 | Only cron and checkpoint lines. The SQL Editor's DO block and NOTICEs are not logged (`log_statement = ddl`) |

### 13.4 The history-only record (as prepared; performed 2026-10-24, §13.5)

**Version `20261024045812`.**
- It is the execution second.
- It is unique and sorts after M2 and after the head.
- It follows the M1/M2 rule: the repository file takes the production-recorded version (moved in PR 2, after the
  record).

**Mechanism.** Supabase's official `supabase migration repair 20261024045812 --status applied`, run with CLI
**2.121.0** (release checksum `4b481189…`). This is the CLI and session-pooler `--db-url` path of the proven Google
Sheets `record-history` stage (run `39811684469`).

**Rehearsal.**
- Setup: a loopback PostgreSQL 16.15 copy of the history table, with production's columns and constraints, the same
  345 versions and names, M1/M2 with their real bytes, and `log_statement = all`.
- **CLI statements:**
  1. `SELECT 1`
  2. a check that the history table has its three columns
  3. `BEGIN`
  4. one parameterized `INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES($1,$2,$3)
     ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name, statements = EXCLUDED.statements`
  5. `COMMIT`

  M3's SQL is a text parameter only; it is never executed.
- **The recorded row:** `20261024045812 / hierarchy_path_repair`, with **4 statements**.
  - The CLI splits the file on the client. The SHA-256 of `array_to_string(statements, '')` is
    `80b363c573d9d2028aedc2dd8def58b0c8b50f99db3ff1872138b5ffa29c0af0`, **not** the file's `2da22c6f…`.
  - `created_by`, `idempotency_key` and `rollback` stay NULL. The Sheets row shows the same split (81 statements,
    digest ≠ file SHA).
  - **This is how a CLI-repaired migration's integrity is checked:** by name, version, statement count and split
    digest, never by the file SHA against the row, and never by re-running it.
- **History after the record:** 346 rows, head `20261024045812`, version-list md5
  `835868a68477b6f87a12797a1f2e0869`. The other 345 rows are byte-identical (full-row md5 `61d1fd6a…` before and
  after).
- **Determinism:** a second recording, and a minimal temporary workdir holding only a byte copy of M3, give the same
  row.
- **Inverse:** `--status reverted` sends only `DELETE … WHERE version = ANY('{20261024045812}')`, and the exact
  before-image returns.

**Runner (PR 1).**
- **Workflow:** `.github/workflows/hierarchy-m3-history.yml`. It is dispatch-only and main-only, with stages `check`
  (read-only) and `record-history`, and a typed confirmation.
  - Job 1 is secret-free: `guard-environment` reads `google-sheets-production` with the run's own token. It fails
    closed unless the required reviewer is exactly `cgarness`, deployments come from `main` only, and
    `can_admins_bypass` is false.
  - Job 2 runs in that environment and uses only `SUPABASE_DB_PASSWORD` and `SUPABASE_POOLER_HOST`.
- **Runner:** `scripts/hierarchy_m3_history_record.py`. Its gates, all read-only (`default_transaction_read_only`):
  - M3 bytes `2da22c6f…` and no top-level M3 file;
  - CLI 2.121.0 and its flags;
  - the session pooler `postgres.jncvvsvckxhqgqvkppmj` over TLS;
  - history 345 / head `20261023232435` with no M3 row by version or name;
  - M1 and M2 rows as reviewed;
  - the P3 invariants;
  - the four rows' stored paths equal the reviewed targets.
- **The one write.** The runner byte-copies M3 into a temporary workdir as
  `supabase/migrations/20261024045812_hierarchy_path_repair.sql`, so `main` never carries an unrecorded top-level M3.
  It then runs `supabase migration repair 20261024045812 --status applied --db-url <protected URL>`.
- **Read-back in the same run:**
  - 346 rows and head `20261024045812`;
  - the row's name, 4 statements and `80b363c5…`, with NULL `created_by`, `idempotency_key` and `rollback`;
  - every other history row byte-identical;
  - a digest of `profiles(id, upline_id, hierarchy_path, updated_at, organization_id, role, status)` unchanged;
  - M1/M2 and the invariants unchanged.
- **Failure handling.** No automatic retry, no secret or command output in the log, and a stop on any mismatch.
- **Never run:** `db push`, `migration up`, `psql -f`, or any statement of M3.

**Verification (local: loopback PostgreSQL 16.15, real CLI 2.121.0; CI: PostgreSQL 17.6).** The test is
`scripts/tests/hierarchy_m3_history_record_test.py`; locally it reported ALL PASSED, 18 checks.
- **Workflow and runner text:** structure, pinned SHAs and versions, the two secrets only, no forbidden commands.
- **Environment guard:** 11 weakened configurations fail closed (reviewer, admin bypass absent or on, branch
  policy).
- **Entry and connection gates:** they refuse before any connection, and the password is masked three ways.
- **Drifted states:** 8 are refused by both stages without invoking the CLI (moved head; M3 under another version or
  name; M1 row changed; stale; missing pair; a reviewed row off target; a fifth matching row).
- **The real record:** done by a role limited to the history table, so executing M3 was impossible. It produced
  exactly the row above, every other row unchanged and profiles unchanged.
- **Re-runs and inverse:** a second record is refused, `check` on the recorded state passes, and the inverse restores
  the before-image.
- **Read-back:** 6 wrong writes are caught, including the `apply_migration` one-statement shape, an extra row, a
  profile write and another row changed.
- **Mutation testing:** 10 of 10 runner mutants are caught (hierarchy gate skipped, re-record allowed, wrong digest or
  count, profile digest dropped, top-level check dropped, admin bypass unchecked, main-only dropped, pooler loosened,
  `db push` injected).
- The test found and fixed a real defect: `concat_ws` renders booleans as `t`. The runner now compares `(…)::text`.

**Approvals still needed, in order:**
1. merge PR 1;
2. **"Approve M3 history record `20261024045812`"**, then the protected environment's review;
3. merge PR 2 (move M3 to `supabase/migrations/20261024045812_hierarchy_path_repair.sql` with its bytes unchanged,
   rename the rollback stub, re-pin the static checks).

**Stop condition:** any migration recorded in production before the record changes the pinned count and head
(345 / `20261023232435`). The runner then refuses, and it must be re-pinned and re-reviewed before any dispatch.

Supabase "Deploy to production" must be confirmed OFF before each merge.
- Corroborated: the integration's `main` branch row has `git_branch: ""`, unchanged since 2026-08-25.
- Direct confirmation needs the signed-in dashboard.

### 13.5 The history-only record — performed (2026-10-24) and the release record (PR 2)

**Approval and dispatch.**
- Chris approved "Execute M3 history recording only", recording `20261024045812` as already applied.
- This session dispatched `Hierarchy M3 history record` from `main` @ `0f3b00f` at 17:21:05 UTC. It used the GitHub
  connector's workflow dispatch, the equivalent of `gh workflow run hierarchy-m3-history.yml --ref main -f
  stage=record-history -f confirm=record-history`.
- **Run [`40115718668`](https://github.com/cgarness/agentflow-life-insure/actions/runs/40115718668)**, run 1,
  attempt 1. It is the only run of this workflow. There was no retry.

**Preconditions (this session, read-only, 17:20:50 UTC, re-read unchanged at 17:28:17 UTC).** This is the
before-image:
- history 345 rows, head `20261023232435`;
- no row at `20261024045812`, none named `hierarchy_path_repair` or at `20261023210200`, none dated `20261024…`;
- version-list md5 `0508849bbc699c2e9e23f26d7d69d8d2`;
- full-row md5 of the 345 rows: `7b2aa6650d9884ed7adb178c9545c03e`;
- M1 and M2 rows: 1 statement each, `5d99c923…` / `7f2c61db…`;
- `hierarchy_consistency()` all zero, with `path_pairs = expected_pairs`;
- the four rows `ddc1f53f…` / `7daae418…`;
- the profiles digest over `(id, upline_id, hierarchy_path, updated_at, organization_id, role, status)`:
  `16|5ec1e0675599238a9d8b8322ebcdd4d4`;
- the newest `updated_at` is still `2026-10-24 04:58:12.87362+00`.

**Job 1, environment guard** (17:21:09–17:21:16 UTC, success). The required reviewer is exactly `cgarness`,
administrator bypass is disabled, and the deployment branch policy is custom, `main` only.

**Job 2, `record-history`.** It waited for the `google-sheets-production` review. Chris approved it, and the job ran
18:31:40–18:32:10 UTC. In log order:
- **Entry and file gates:** known subcommand, main dispatch only, explicit stage confirmation, M3 source bytes
  `2da22c6f…`, no top-level M3 file;
- **CLI and connection:** pinned CLI 2.121.0 and its flags, approved session pooler, credential present, connection
  identity, TLS, postgres role and database;
- **State:** `STATE: before`, with M1/M2 as reviewed, the hierarchy consistent and the four rows at their reviewed
  targets;
- **Before the write:** the snapshot covers every history row, the staged copy is byte-identical, and the workdir holds
  only the M3 copy;
- **The write:** `PASS: supabase migration repair 20261024045812 --status applied completed` at 18:32:04 UTC;
- **Read-back:** history holds exactly one more row (M3). The recorded row is `hierarchy_path_repair`, 4 CLI statements,
  digest `80b363c5…`. M1/M2, the hierarchy invariants and the four rows are unchanged. Every other history row is
  byte-identical. Profiles are unchanged: no application data was written;
- `STOP HERE: independent read-only verification next; no further stage.`

**Chris's independent verification** (reported):
- 346 migration-history rows, with M3 recorded as `20261024045812`;
- the expected four statements and digest;
- all 15 hierarchy relationships correct and 0 stale paths;
- per the GitHub log, every other history record and the profiles unchanged.

**Post-record read-only verification (this session, approved SELECT-only and advisors, 19:43:20–19:43:38 UTC).**
Each query ran in `BEGIN READ ONLY … ROLLBACK`.

| Check | Result |
|---|---|
| P1h | **346 rows, head `20261024045812`**. Exactly one row at that version, one by name or authored version, one dated `20261024…` |
| P1 | `20261023210027 hierarchy_authorization_boundaries` 1 statement `5d99c923…`; `20261023232435 hierarchy_integrity` 1 statement `7f2c61db…`; **`20261024045812 hierarchy_path_repair` 4 statements, digest `80b363c573d9d2028aedc2dd8def58b0c8b50f99db3ff1872138b5ffa29c0af0`**, with `created_by`, `idempotency_key` and `rollback` NULL |
| M3 statements | SHA-256 per statement `5375ec1f…`, `af8c7704…`, `8b4f4fd5…`, `10f01964…`. These are identical to CLI 2.121.0's split of the moved repository file, re-recorded on a loopback database (synthetic table only) |
| Other rows | Full-row md5 of the 345 rows other than `20261024045812`: **`7b2aa6650d9884ed7adb178c9545c03e`, identical to the before-image** |
| Version list | md5 `835868a68477b6f87a12797a1f2e0869`, the value the rehearsal predicted (§13.4) |
| P3 | profiles 16, edges 11, expected_pairs 15, path_pairs 15; missing 0, extra 0, **stale 0**, NULL 0, self-parents 0, cross-org 0, unreachable 0 |
| P4 | stale 0. The four rows' id fingerprint is `ddc1f53f…` and their stored-path fingerprint `7daae418…` |
| P6 | `recognised_now 3` = `upline_walk_descendants 3` (`4ef505e0,89f2e994,e5c4ee04`) |
| P2 | 49 lines, `f01ab3483fb26104607f571d80ec4ff3`, unchanged |
| Profiles | 16 rows, digest `5ec1e0675599238a9d8b8322ebcdd4d4`, identical to the before-image. The newest `updated_at` is still `2026-10-24 04:58:12.87362+00` |
| Security advisors | anon SECURITY DEFINER 52, authenticated 134, mutable `search_path` 21: unchanged. The only hierarchy entry is `is_ancestor_of` executable by `authenticated`, which is by design. The other categories equal the §7 baseline (RLS enabled with no policy 33, RLS disabled in public 2, `extension_in_public` 3, leaked-password protection 1); they are pre-existing and out of scope |

**Two different checksums, both correct.**
- The **file** is SHA-256 `2da22c6f45163174c26b7edff75e73bb5a286ec9c87f12bfcabf3a0dc57a4c6b`. These are the bytes
  reviewed, executed once in the SQL Editor, and kept in the repository.
- The **history row** holds the CLI's client-side split of those bytes: **4 statements**, and the SHA-256 of their
  concatenation is **`80b363c5…`**.
- Check the row by version, name, statement count and split digest. Never compare it with the file SHA, and never
  re-run the migration.

**Release record (PR 2, after the record).**
- **M3 renamed:** `supabase/migrations/pending/20261023210200_hierarchy_path_repair.sql` →
  `supabase/migrations/20261024045812_hierarchy_path_repair.sql` with `git mv`. The bytes are unchanged
  (`2da22c6f…`). The file's own "Rollback:" comment still names the authored stub path, because its bytes are
  immutable.
- **Rollback stub renamed:** `rollback/20261023210200_…` → `rollback/20261024045812_hierarchy_path_repair.rollback.sql`.
  Only the header comment changed; the refusal body is unchanged.
- **Static pins** (`scripts/run_hierarchy_stabilization_tests.sh`): `pin_applied M3 hierarchy_path_repair
  20261024045812 2da22c6f…`, with exactly one top-level file and no copy in `pending/`. Two further checks: no
  `*_hierarchy_*.sql` may be in `pending/`, and the history runner's recorded-shape constants must equal 4 statements /
  `80b363c5…`.
- **The history runner** reads M3 from its recorded path and requires exactly one top-level M3 file and none in
  `pending/`. Its production constants, stages and write path are unchanged. In the recorded state `record-history`
  refuses and `check` verifies read-only.
- **Unchanged:** the protected workflow `hierarchy-m3-history.yml`. CI keeps the live `environment-guard` job and the
  `pending/` path filters.
- **Verification (local; loopback PostgreSQL 16.15, PostgREST 12.2.3, CLI 2.121.0):**
  - `npx tsc --noEmit`: exit 0.
  - Full hierarchy runner, `CI=true`: exit 0, **2751 PASS lines**. That is 2750 − 2 retired "M3 stays in `pending/`"
    checks + 3 new pins. Every count is at its pin: core 64/114, RLS 1043, RPC 567, forged 336, compatibility 190.
  - Runner test: ALL PASSED, 18 checks. The real CLI recorded 4 statements / `80b363c5…` from the moved file.
  - Focused hierarchy Vitest (the CI list): 44 files, 641 passed, 2 skipped.
  - **Mutation checks: 12 of 12 caught.**
    - Static stage (9): one changed M3 byte; a copy left in `pending/`; M3 at the authored version, file only and with
      the state helper; a second top-level copy; the rollback stub missing; another hierarchy migration in `pending/`;
      the runner's digest drifted; its count drifted.
    - Runner test (3): the top-level and `pending/` gates dropped, and the source path reverted to `pending/`.
  - `git diff --check`: clean.

**Not claimed.**
- No reconciliation of the older history discrepancies.
- No change to application data.
- No authenticated browser acceptance: the Agent / Team Leader / Admin checks in the root plan's §H stay OUTSTANDING.

Supabase "Deploy to production" must be confirmed OFF before PR 2 merges. Merging puts M3 at the top level, but that
version is now recorded, so a push would skip it. The 12 older top-level files with no history row (§A of the root
plan) remain a risk.
