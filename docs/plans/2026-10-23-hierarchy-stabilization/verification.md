# Hierarchy Stabilization — Gate 1 verification (2026-10-23)

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
  (e.g. calls guard `454ee627…`, contact guard `dc72173f…`, lock function `559344d1…`) are proven only when the
  `hierarchy-stabilization.yml` run on the draft PR passes. **Gate 2a must not proceed before it does.**
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

## 8. Gate 2a preflight checklist (read-only, immediately before applying M1)

1. CI `hierarchy-stabilization.yml` green on PostgreSQL 17.6 at the PR head.
2. `list_migrations` head; version for M1 sorts after it.
3. M1 guard prerequisites re-checked (preimage digests, ACLs, the 9 policy expressions, trigger digests incl. the two
   clients triggers that fire before the new organization guard, no existing objects with the new names).
4. §1 baseline unchanged (4 stale, both fingerprints, `f809493e` 0 recognised descendants).
5. Apply at a quiet time (CREATE POLICY / triggers take brief table locks; `lock_timeout` 1 s fails fast).
6. Read back bodies, ACLs, policies, triggers, `pg_depend` (10 policies), advisors; reconcile the file name to the
   stamped version and re-pin pending M2/M3.
