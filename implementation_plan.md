## 2026-10-19 — APPROVED FOR LOCAL BUILD AND TESTING ONLY: Phase 2A saved policy commissions, expected payments and manual receipts

**Status:** Chris approved the local implementation of the companion-function architecture on 2026-10-19. Branch
`claude/friendly-ptolemy-pvpmfj` from `main` `84ba4f6`; feature-branch commits and pushes are approved. No production
migration, RLS or grant change, production test write, merge or deployment is approved; reminders, cron, calendar
integration and commission dashboards stay out of scope. The Gate 3 release method is chosen when the tested
migration package exists.

**Current contract and exact file list:** `docs/plans/2026-10-19-policy-commission-phase-2a/implementation_plan.md`.
It supersedes the Phase 1 §8 deferred snapshot design below and every earlier staged-capture/session design.

**Summary:** four companion save functions delegate to the unchanged sale writers (D7 adds a receipt-bearing
first-policy-edit companion) and, in the same transaction, record server-proven operation evidence and the immutable
commission capture inside an error boundary with a bounded work budget, so a commission failure never invalidates a
legitimate sale. A restricted NOLOGIN/NOBYPASSRLS writer owns the tracking functions; six RLS tables hold evidence,
captures, estimates, four installments, manual receipts and audit events. Own/Others permissions are enforced on the
server; sellers own their records; no Agency Group peer access. Frozen submissions replay byte-identically until
authoritative reconciliation.

---

## 2026-10-18 — DOCS / SECURITY, APPROVED: D0 repository closeout (filename reconciliation and durable release record; repository only)

**Status:** Chris approved the repository-only D0 closeout on 2026-10-18.
- Branch `claude/d0-repository-closeout` from `origin/main` `f3d9b0ccf08d692cef6bd39a11cb32fb4e20443f`.
- Commit, push and a draft PR are approved; the merge needs Chris's separate final approval. Never push directly to `main`.
- **No further production mutation is authorized:** no `apply_migration`, rollback execution, SQL or history repair,
  permission re-grant, account change or setting change. Supabase "Deploy to production" stays OFF.
- This rename does not resolve the other migration-version discrepancies (invariant #30).
- None of D6, C1/C2, the contact guard, F8, P5, D16, D17, the hierarchy repair or any dialer work is included.

**What is being recorded:** D0 was applied once to production on 2026-10-18 under its own separate approval, through
`apply_migration`. It was recorded as **`20261018060615 / seal_list_unrestricted_users`** (authored as
`20261018023911`). The durable release record is `docs/security/2026-10-18-d0-release.md`.

**Change:**
1. **Rename both files, byte-for-byte** (`git mv`, R100; no copy left under the old name):
   - `supabase/migrations/20261018023911_seal_list_unrestricted_users.sql` → `supabase/migrations/20261018060615_seal_list_unrestricted_users.sql`.
     3606 bytes, sha256 `b5e89fd8fee33edae2f078fa13a185a8b66b1c2010719e2295d8882a9730c9f3`.
   - `supabase/migrations/rollback/20261018023911_seal_list_unrestricted_users.rollback.sql` → `supabase/migrations/rollback/20261018060615_seal_list_unrestricted_users.rollback.sql`.
     3409 bytes, sha256 `051c79eaa76acc7b44e7d62c26b33c29c0c07bc31890000d36d25d15b867707a`.
2. **References:**
   - the runner's `MIG`/`ROLLBACK` paths and its status header;
   - the workflow's header comment.

   Test behaviour, permission guards and workflow triggers are unchanged; the path globs already match the new names.
   The runner keeps mode 100755. `supabase/tests/seal_list_unrestricted_users.sql` has no filename or status reference
   and stays unchanged.
3. **Status:**
   - the AGENT_RULES #20 note says applied, keeping the never-re-grant rule;
   - the earlier D0 entries here and in `WORK_LOG.md` keep their text and gain a superseded pointer;
   - a newest-first `WORK_LOG.md` closeout entry is added.
4. **Durable record:** `docs/security/2026-10-18-d0-release.md` (new).

**Files (exactly eight paths):**
1. `supabase/migrations/20261018023911_seal_list_unrestricted_users.sql` → `supabase/migrations/20261018060615_seal_list_unrestricted_users.sql` (rename)
2. `supabase/migrations/rollback/20261018023911_seal_list_unrestricted_users.rollback.sql` → `supabase/migrations/rollback/20261018060615_seal_list_unrestricted_users.rollback.sql` (rename)
3. `scripts/run_seal_list_unrestricted_users_tests.sh`
4. `.github/workflows/seal-list-unrestricted-users.yml`
5. `implementation_plan.md` (this entry)
6. `WORK_LOG.md`
7. `AGENT_RULES.md`
8. `docs/security/2026-10-18-d0-release.md` (new)

**Verification:**
- Run the D0 suite against the renamed files on a throwaway loopback PostgreSQL with synthetic data only.
- Run `npx tsc --noEmit` and `npx tsc -p tsconfig.app.json --noEmit`, compared with base `f3d9b0c`.
- Check both SQL files are byte-identical before and after.
- Check no active test or workflow reference names the old files.
- Draft-PR CI: the four path-filtered checks that passed at `5744ee0`:
  - Seal list_unrestricted_users verification (`postgres:17.6`);
  - Dialer DNC integrity;
  - Reporting integrity;
  - SMS consent integration.

  Normal Vercel previews run.
- **Supabase preview.** This PR changes `supabase/migrations/`, so the Supabase GitHub integration will attempt an
  automatic preview.
  - Chris's closeout approval allows preview usage only within the existing one-D0-preview authorization (one
    automatically created D0 preview branch). That authorization is unused: the PR #457 preview was cancelled before
    any branch was created.
  - At 06:53:56 UTC, `list_branches` showed the 3-branch limit still full (main, #294, #378), so the attempt is expected to
    be cancelled.
  - No Supabase branch, limit or setting is created, reset, deleted or changed to influence it.
  - Its outcome is reported exactly as observed. A pass would not convert the PR #457 accepted exception
    (NOT PASSED) without Chris's decision.

**Evidence handoff:**
- A sanitized evidence export and a checksum manifest are attached to the handoff, not committed. The scratchpad
  originals stay unchanged.
- No raw session log, credential, token, profile data or unrelated security detail is committed.
- A checksum computed now is not proof of what was recorded at apply time; the record says which values were captured
  when.

---

## 2026-10-18 — SECURITY, APPROVED FOR ISOLATED LOCAL BUILD AND TEST ONLY: seal `public.list_unrestricted_users()` (D0)

> **Superseded status (2026-10-18 closeout):** this entry records the local build stage and is kept as written. D0 was
> later committed, merged (PR #457, merge `f3d9b0c`) and applied to production once, recorded as
> `20261018060615 / seal_list_unrestricted_users`. The files were then renamed from `20261018023911`. See the closeout
> entry above and `docs/security/2026-10-18-d0-release.md`.

**Status:** Chris approved D0's isolated local build and test on 2026-10-18. Local branch `claude/seal-list-unrestricted-users` from `origin/main` `e2ddef261e0288a058f8bf1eaa6f9c1ace8d7881`. **Not committed, not pushed, no PR, no merge, no Supabase branch, NOT applied to production.** Each of those is a separate decision. No `#APPROVE_RLS_CHANGE` is granted or needed for this item, and none of D6, C1/C2, the contact guard, F8, P5, D16, D17 or the hierarchy repair is part of it.

**Problem (read-only evidence, 2026-10-17/18):** `public.list_unrestricted_users()` is `SECURITY DEFINER`, owned by `postgres` (BYPASSRLS), body `SELECT * FROM public.profiles;`, and executable by `PUBLIC`, `anon` and `authenticated`. Anyone holding the public anon key can read every agency's profiles through `/rest/v1/rpc/list_unrestricted_users`. It has no callers:
- The repository holds only its generated type entry (`src/integrations/supabase/types.ts`), its baseline definition and two historical prose mentions. There is no `.rpc(...)` call.
- Production has zero `pg_depend` dependents and no policy, view or function reference to it, and logged no request to it in the 24 hours inspected.

**Preimage (production, under `search_path = "$user", public, extensions`):** `md5(pg_get_functiondef) = 41b9e7d550c0d013c9306db9dd2b7b27`; owner `postgres`; `prosecdef = true`; ACL `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`. The fixture reproduces this exactly (the same md5 on PostgreSQL 16.15). It is never changed to make a test pass.

**Change (one migration, one top-level `DO`):**
- Guard: refuse unless the function exists with the exact md5 (computed under the pinned search_path), owner, `SECURITY DEFINER` and preimage ACL. Also refuse if any catalog-tracked object depends on it (`pg_depend`; invariant #37). `lock_timeout` is 1 s.
- `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`. `postgres` (owner) and `service_role` keep EXECUTE, as intended.
- Postconditions: ACL exactly `{postgres=X/postgres,service_role=X/postgres}`, no effective EXECUTE for `anon` or `authenticated` (inherited grants included), EXECUTE for `service_role`, definition unchanged.
- Then restore the caller's `search_path` and `lock_timeout`, and `NOTIFY pgrst, 'reload schema'`, which is delivered only on commit.
- Nothing is dropped, and no data is read or written.

**Rollback:** **"Re-assert only. Not an inverse. Never re-grants EXECUTE."**
- It never grants EXECUTE to `PUBLIC`, `anon` or `authenticated`, and never revokes from `postgres` or `service_role`.
- It refuses, changing nothing, if `postgres` or `service_role` would be left without EXECUTE, or if its REVOKE would change the ACL while dependents exist.
- No inverse is provided. After the rollback runs, re-applying the forward migration is refused by its preimage guard, as intended.

**Tests:** these are database-role verification on a throwaway local cluster. They are not proof of PostgREST, browser or PostgreSQL 17.6 behaviour. Each scenario starts from a fresh clone of the template; S5 and the S7 re-apply deliberately reuse the database they just sealed.
- S0 reproduction: before the seal, `anon` and `authenticated` read both synthetic agencies.
- S1 `anon`, and S2 the `authenticated` role, get `42501 permission denied for function list_unrestricted_users`. Claims are set for realism only; the function reads none.
- S3 `service_role` and `postgres` still read everything.
- S4 exact ACL, definition and data, checked from a fresh connection.
- S5 replay refused. S6 definition drift and ACL drift refused, leaving the drifted state untouched.
- S7 covers the rollback:
  - its header is verbatim, and it keeps the seal;
  - re-applying the forward migration afterwards is refused;
  - on an unsealed database it seals;
  - with a dependent present it refuses.
- S8: a test-only `ddl_command_end` event trigger raises at the REVOKE, in autocommit and `--single-transaction`, and a fresh connection still sees the preimage. On its own S8 cannot tell a single `DO` from a split file; S9 and S11 cover that.
- S9 checks the shape of the migration file:
  - exactly one top-level `DO` (procedural `BEGIN`/`END` allowed), with only comments and whitespace outside it;
  - no other statement or psql metacommand, and no transaction control (or `CALL`) inside, scanning the raw body;
  - complete command-tag output exactly `DO`.
  
  It rejects split, internal-`COMMIT`, hidden-`COMMIT`, `CALL`, upper-case-tag, trailing-statement and metacommand variants, each for its asserted reason. The split variant is also caught by the tag check; the `COMMIT` variant only by the static check.
- S10 dependency refusal: a real catalog-tracked dependent (a view) in a fresh database makes the real migration fail with its specific error. A fresh connection still sees the original ACL and definition. This does not replace the separate caller/reference inventory.
- S11: a re-grant injected right after the REVOKE makes the migration's own postcondition, and separately the rollback's, refuse. A fresh connection then sees the prior state.
- S12: the migration still seals under a hostile session `search_path` (`pg_catalog`).
- S13: a concurrent uncommitted catalog lock makes the migration fail within about 1 s (lock timeout), leaving the preimage.
- S14: `NOTIFY pgrst` is delivered after the migration and after the rollback, and not after a refused replay.
- N1: revoking from `anon` and `authenticated` but not `PUBLIC` must fail S1 and S2.
- N2: a standalone `REVOKE` run with `psql -X -v ON_ERROR_STOP=1 -f` in autocommit finishes and commits, and a later separate top-level statement fails. A fresh connection sees the committed ACL, and statement 3 never runs. This is why the migration must be one statement.

**Files (exactly eight):**
1. `supabase/migrations/20261018023911_seal_list_unrestricted_users.sql`
2. `supabase/migrations/rollback/20261018023911_seal_list_unrestricted_users.rollback.sql`
3. `supabase/tests/seal_list_unrestricted_users.sql` (fixture and assertion library)
4. `scripts/run_seal_list_unrestricted_users_tests.sh` (accepts only `postgres(ql)://postgres[:password]@127.0.0.1|localhost:<port>`; refuses `PGHOSTADDR`/`PGSERVICE`; proves a loopback server, superuser and synthetic scope before every destructive step, fixture clone and cleanup; never prints the URL)
5. `.github/workflows/seal-list-unrestricted-users.yml` (existing path-filtered `pull_request` trigger plus `workflow_dispatch`, no push trigger)
   - It runs `postgres:17.6` through the repository's host-network `docker run` pattern (as in `dialer-dnc-backend.yml`), listening on 127.0.0.1 only. A published-port service container would present its bridge address to the runner's loopback proof.
   - It is authored only and unverified until a PR runs it.
6. `implementation_plan.md` (this entry)
7. `WORK_LOG.md` (newest-first entry with the actual results)
8. `AGENT_RULES.md` (one scoped invariant #20 note, added after local testing: authored and tested locally, NOT applied to production)

**Local operations:**
- The throwaway PostgreSQL 16 cluster runs as the `postgres` OS user on 127.0.0.1:55448, and only this run's cluster is removed afterwards.
- Expected failures are captured explicitly.
- Also run `npx tsc --noEmit` and `npx tsc -p tsconfig.app.json --noEmit`, compared with the unchanged base.

**Later and separately gated (not approved):**
- **Commit and push.** Before any remote publication, verify what automatic preview branching would do and what it would cost. A preview database is built from the baseline replay, not production history, so D0's exact ACL and md5 guard may refuse there if its ACL differs in any element or order (unverified).
- **PR.**
- **Merge.** First confirm that automatic production deployment is still OFF.
- **Production apply** through `apply_migration`, after re-capturing the preimage.
- **Rename** the migration and rollback files to the recorded version with identical bytes, and update the runner, suite and workflow references together (invariants #25 and #35 pattern).
- **`list_migrations`.**
- **Targeted security advisors:** 0028 and 0029 should clear for this function and 0011 stays. Unrelated changes are reported separately.
- **Context snapshot.**

---

## 2026-10-17 — IMPLEMENTED (amended scope approved by Chris at `cc8a2b4`; draft PR, not merged or deployed): Phase 1 policy commission preview (ConvertLeadModal, AddClientModal, RecordPolicyModal)

**Status:** implemented on branch `claude/commission-policy-preview` (from `main` `95009d1`) and opened as draft PR #455; not merged or deployed. Chris decided P1–P4 on 2026-10-17 (below). No migration, RPC, RLS, Edge Function or production data has been changed; production access was read-only catalog and count inspection. Chris approved this amended scope on 2026-10-17 — frontend-only and preview-only, with no migrations, backend changes or production deployment — and it is implemented on the same branch exactly within §6 (see **As built** below). The text from §1 onward is the approved plan, kept as approved. This document is public and carries no compensation data (commission invariant D1): no rates, carrier or product names, or examples from the private grid.

**Decisions (Chris, 2026-10-17)**

| | Decision |
|---|---|
| **P1** | **Direct lookup.** The credited agent's level comes from a direct, permission-gated, organization-scoped profile read. No new RPC or migration. "View Own Commission Percentage" governs the signed-in user's own estimate and "View Others' Commission Percentage" governs another agent's; the two are evaluated independently. Existing contact authorization and downline restrictions stay in force, and the permission grants no broader client or profile access. Any unresolved authorization, owner, organization or permission fails closed. This is the existing screen-level model, not database secrecy. Profile permissions and self-edit behavior are not changed. |
| **P2** | **Final Expense.** Candidates are only the matched carrier's whole-life products, and the agent must select the exact actual product. Never auto-select, substitute, fuzzy-match another carrier, or assume all whole-life products are Final Expense. If there is no exact supported product, show a compact unavailable state; the ordinary save still works. |
| **P3** | **Preview only.** §8 is **DEFERRED and NOT approved**: no snapshot table, RPC, migration, sale-payload change or post-save write. Previews are never presented as saved, earned, booked or paid commission. |
| **P4** | **Where it shows.** Creating a client, converting a lead, recording a policy, and the existing first-policy-entry path of client edit. Not ordinary edits of an existing policy. The preview never creates a sale event. |

### As built (2026-10-17)
**Files:** exactly §6 — 5 new application files, 4 new test files, 3 modals (+16 lines in total), the harness-only mock in the 3 existing modal tests, and the 3 docs. No migration, RPC, RLS, Edge Function, dialer file, sale module or calculator-engine change.

**Refinements within the approved scope (for review):**
1. Validation reuses the calculator's Zod `validateCalculatorForm` (age, premium, term membership) instead of a second, separately named schema; product membership is structural, since only grid candidates can be selected.
2. `usePreviewSelection` / `PreviewSelection` live in `usePolicyCommissionPreview.ts` rather than `PolicyCommissionInputs.tsx`, so the component file exports only a component (ESLint `react-refresh/only-export-components`).
3. Preview controls use explicit `htmlFor`/`id` labels. The real-browser check found that wrapping labels gave each select an accessible name containing its option text.
4. Age prefill is stricter than §5's wording: a real date of birth that cannot give a valid age on the Sold Date (later than the Sold Date, over 100, or no valid Sold Date) leaves the age blank instead of falling back to a stored age.
5. The panel stays hidden until a carrier is entered, so "No matching product" never appears before there is a carrier to match.
6. For another agent, the engine's "Not available at your contract level." reads "Not available at this agent's contract level."
7. D1: names in the new tests do not appear in the private grid, and the new tests' expected amounts use only synthetic fixture values that do not appear in it (read-only, value-free check). No production values were copied.
8. Post-PR correction (Chris's owner-cache check): the credited owner is never served from cache. It is re-read on every mount, with an owner cached by an earlier open ignored. It is re-checked on window focus and every 15 seconds while open, and a failed re-check hides the figures. While a modal stays open, a reassignment made elsewhere shows within about 15 seconds; a server push would be needed to remove that window entirely.

**Verification:** see the newest `WORK_LOG.md` entry and draft PR #455.

**High-priority follow-up (separate task, not part of this feature):** the Team Leader hierarchy predicate (`is_ancestor_of` / `hierarchy_path`) is unreliable in production. It is recorded in `AGENT_RULES.md` › Known Tech Debt. No hierarchy data or permission was changed here.

### 1. Goal
Show a compact emerald estimate directly below each policy's details while the agent enters it:

> Estimated first-year commission: $X
> Estimated advance (75%): $Y

It recalculates on every input change, reusing the Commission Calculator's grid context, matching rules and exact arithmetic unchanged. It never blocks or alters a save. In multi-policy conversion every policy gets its own estimate, and they are never summed.

### 2. Findings that shape the design (read-only)
| Area | Finding | Consequence |
|---|---|---|
| Engine | `calculateEstimate(context, level, {productId, age, term, monthlyPremium})` returns `estimate`, `unavailable` or `configuration_error`. `estimateCommission` computes monthly × 12 × rate / 100, then the advance as `ADVANCE_PERCENT` (75) of that, in exact BigInt rationals. A stored 0 rate is a real $0; a missing rate is unavailable; ambiguous variants are a configuration error. | Reused unchanged; no parallel engine. |
| Money | `formatUsd(value: Rational)` rounds half-up to cents itself (`money.ts:48`). | Use `formatUsd(estimate.firstYearCommission)` and `formatUsd(estimate.advance)` directly. Never `formatUsd(toCents(...))`. |
| Grid context | `get_commission_calculator_context()` returns the selected active grid (id, revision, levels), active products, variants and rates as exact text, plus **the caller's own** level only. `useCommissionCalculatorContext(enabled)` caches it under `commissionCalculatorKeys.context(userId, orgId)` with a 60 s staleTime, disabled under View As. | Reuse the hook, so the preview and the calculator page share one cache. |
| Categories | The DB CHECK and `CompCategory` allow only `term`, `whole_life`, `iul`. The CRM's `PolicyType` adds "Final Expense". | P2 mapping (§5). |
| Credited agent (server) | Conversion credits the **stored** `leads.assigned_agent_id` (live `convert_lead_to_client_atomic` inserts it from the row locked `FOR UPDATE`). Manual create credits the owner `Contacts.handleAddClient` passes, which is the effective viewer. First-policy edit and record policy credit the stored `clients.assigned_agent_id`, which `insert_policy_sale` writes into `wins.agent_id`. **The Dialer maps the modal's `lead.assignedAgentId` from `claimed_by` first** (`DialerPage.tsx:238`), so that prop can differ from the agent the server credits. | Read the stored owner (§3). Never trust the prop. |
| Team Leader scope | The sale writers' Team Leader predicate is `is_ancestor_of`. Contacts' Team scope uses the same predicate through `get_contact_scope_agents`. In production, `is_ancestor_of` holds for only 3 of 11 upline links (the `hierarchy_path` defect documented in `supabase-users.ts`). The `upline_id` resolver `getAgentScopeIds` is broader. | Use the narrower, server-matching `get_contact_scope_agents` (§4). |
| Others' level displays | Existing `CommissionGate metric="View Others' Commission Percentage"` sites (AgentModal, UserProfileTab, the Contacts agents table) read through `usersApi`/`rowToUser`, which maps a missing level to `"0%"`. | Read the raw `commission_level` column so a missing level stays missing (§4). |
| Age | `calculateAge` measures to *today* and clamps a future DOB to 0. `parseDOB` is an import normalizer that accepts Excel serials and 2-digit years. `clients` has no DOB or age column. | Strict prefill helper (§5); manual age in AddClient and RecordPolicy. |
| Controls | All three modals use native `<select>`; the calculator uses Radix Select. | Native selects styled like the host fields. |
| Sale payloads | `p_client` / `p_policy` are hashed into `private.policy_sale_receipts`; unknown keys are refused. | Preview fields never enter any payload. |
| Existing tests | `recordPolicyModal.test.tsx`, `addClientSale.test.tsx` and `convertLeadModalPolicyFields.test.tsx` mount the real modals open without a `QueryClientProvider`. Every other suite that renders these modals either mocks them or leaves them closed. | A harness-only change to those three (§6). |
| Open PRs | #398 touches only `src/underwriting/ui/commission.ts`. #442, #444 and #451 don't touch the planned files. | No conflict beyond newest-first doc entries. |

### 3. Credited agent
| Surface | Credited agent | How it is resolved |
|---|---|---|
| ConvertLeadModal (Contacts, FullScreenContactView, DialerPage, FloatingDialer) | Stored lead owner | `leads.select('assigned_agent_id').eq('id', lead.id).eq('organization_id', org).maybeSingle()`. The query key includes the lead id and the prop's `assignedAgentId`, so a claim while the modal is open refetches. NULL → "No assigned agent". |
| AddClientModal, new client | The signed-in user. Contacts passes the effective viewer as owner; outside View As that is the signed-in user, and under View As the preview is hidden. | No read. |
| AddClientModal, first-policy edit | Stored client owner | `clients.select('assigned_agent_id').eq('id', client.id).eq('organization_id', org).maybeSingle()` |
| RecordPolicyModal | Stored client owner | The same read by `clientId`. The modal's props are unchanged. |

A missing row, read error, NULL owner or organization mismatch means no estimate.

### 4. Authorization and contract level (P1)
The operator is the signed-in, non-impersonating viewer (`useEffectiveViewer`). Organization-wide access is decided only by `isOrganizationWideViewer`, never by `useOrganization().isSuperAdmin` (invariant #31).

| Credited agent | Required |
|---|---|
| The operator | "View Own Commission Percentage" (Admin and Super Admin have full access) |
| Another agent; operator is Admin or Super Admin (`isOrganizationWideViewer`) | "View Others' Commission Percentage" (full access), and the agent's profile in the operator's organization |
| Another agent; operator is Team Leader | "View Others' Commission Percentage", and the agent in the operator's existing Contacts Team scope (`get_contact_scope_agents`: self plus `is_ancestor_of`, the sale writers' predicate) |
| Another agent; operator is Agent | Never. An Agent's hierarchical profile scope is self only. |

- **Independent checks.** The other-agent path never consults "View Own…", and the own path never consults "View Others'…".
- **Profile read.** It runs only after the permission and scope checks pass: `profiles.select('id, first_name, last_name, email, commission_level').eq('id', agentId).eq('organization_id', org).maybeSingle()`. It keeps the raw value; `rowToUser` is not used.
- **Strict level.** Then comes the existing strict `parseContractLevel` plus grid membership. Missing, malformed or off-grid produces no estimate and is never defaulted, nearest-matched or replaced. For another agent the message is phrased about that agent.
- **Fail closed.** No figures while permissions are loading or errored, while the viewer is unresolved, or while the owner, team scope or profile is loading, errored or missing. An organization mismatch also blocks figures.
- **Operator's own level.** The context RPC still returns it. When only the others' path applies, it is never read or shown.
- **Unchanged.** Profile RLS, grants and permissions, and the open self-edit follow-up (calculator plan §11).
- **Known limit, not fixed here.** The `hierarchy_path` defect can hide estimates for part of a Team Leader's downline. This matches what the server's own predicate allows.

### 5. Inputs, matching (P2), state and loading
**Inputs (per policy, inside the panel).** None is required to save, none is persisted, and none enters a payload.
- **Product:** a native select.
- **Term length:** only when the chosen product's variants are termed (`supportedTermLengths`).
- **Insured age:** a whole number from 0 to 100.
- **Premium:** the policy's existing Monthly Premium field.

**Matching.**
- **Categories:** Term → `term`; Whole Life → `whole_life`; IUL → `iul`; Final Expense → `whole_life` (candidates only). A blank or unknown type has no candidates.
- **Carrier:** an exact match of the policy's carrier text to `comp_products.carrier`, after trimming and ignoring case. No fuzzy or cross-carrier matching.
- **Candidates:** the selected grid's active products in the mapped categories for that carrier, sorted by product name. Nothing is ever auto-selected, even when there is only one candidate. For Final Expense this lists the carrier's whole-life products without claiming they are Final Expense; the agent's choice names the actual product.
- **Estimate:** the unchanged `calculateEstimate` then applies variant matching, the exact level, the missing-rate and stored-zero rules, and ambiguous → configuration error.

**Age prefill (ConvertLeadModal only).**
- Prefer the age on the row's Sold Date, from a strict ISO `YYYY-MM-DD` `lead.dateOfBirth` that is a real calendar date, not after the Sold Date, giving an age of 0–100.
- Otherwise use `lead.age` if it is a whole number from 0 to 100; otherwise leave it blank.
- While untouched, the age follows the row's Sold Date. Once edited, the agent's value stays. The other modals start blank.

**Validation.** A Zod `policyPreviewInputSchema` covers age, a product drawn from the candidates, and a term drawn from the supported terms. It reuses the existing `validateCalculatorForm` premium rule (positive, at most 2 decimals). Incomplete input shows a short hint, never a form error.

**Reset rules.** These are derived on the same render the change happens, not in a later effect.
- A session (user), organization or grid change resets product, term and age.
- A grid revision, policy type or carrier change keeps product and term only while still valid, otherwise clears them.
- A credited-agent change keeps a valid product and term, but withholds figures until that agent's level has loaded.
- A lost permission clears the selection.
- Figures are recomputed from the current inputs on every render and never stored.

**Caching and stale responses.**
- **Grid context:** the shared calculator query.
- **Owner, team-scope and profile reads:** keyed `["commission-preview", kind, userId, orgId, id]`, with a 60 s staleTime, `retry: false` and no placeholder data.
- **No per-keystroke requests:** typing a premium, age, product or term makes no request.
- **Stale results:** a profile result is used only if its `id` equals the current credited agent.

**View As.** The hook returns `hidden` before anything else. Every query is disabled, and no query data, cached or fresh, is read or rendered.

**Isolation.**
- The panel never touches the Save button, validation, payloads, request IDs or callbacks.
- It sits inside a small local error boundary that renders nothing on error. The app's `ErrorBoundary` is a full-page fallback and isn't suitable. A preview failure therefore cannot unmount a modal or block a save.

### 6. Exact file list
**New — application**
1. `src/lib/commission/policyPreview.ts`: pure. Category map, carrier match, candidates, strict age prefill, preview Zod schema, access decision, credited-level resolution (wraps `parseContractLevel`), `previewEstimate` (calls `calculateEstimate`).
2. `src/lib/commission/previewApi.ts`: the three org-scoped reads (`fetchCreditedOwner`, `fetchCreditedAgentProfile`, `fetchTeamScopeAgentIds`, which uses the existing `get_contact_scope_agents`). Zod-parsed rows, with `.maybeSingle()` wherever zero rows are possible.
3. `src/hooks/usePolicyCommissionPreview.ts`: combines viewer, permissions, View As, the shared context query and those reads into one state.
4. `src/components/commission/preview/PolicyCommissionEstimate.tsx`: the panel, its states and the local error boundary. Under 200 lines.
5. `src/components/commission/preview/PolicyCommissionInputs.tsx`: the product, term and age controls. Under 200 lines.

**New — tests**
6. `src/lib/commission/__tests__/policyPreview.test.ts`
7. `src/hooks/__tests__/usePolicyCommissionPreview.test.tsx`
8. `src/components/commission/preview/__tests__/PolicyCommissionEstimate.test.tsx`
9. `src/components/contacts/__tests__/policyCommissionPreviewModals.test.tsx`

**Modified — application (surgical)**

10. `src/components/contacts/ConvertLeadModal.tsx`: an import plus one panel per policy row after its Dates block (about +12 lines). `PolicyRow`, the schemas, payload building and callbacks are untouched. The file is already 479 lines; it gets no refactor.
11. `src/components/contacts/AddClientModal.tsx`: an import plus one panel below the policy fields. It shows when `hasClientPolicyEvidence(form) && (!initial || !hasClientPolicyEvidence(initial))`, the same condition the save uses for a new sale (about +8 lines, roughly 202). `handleSubmit` is untouched.
12. `src/components/contacts/RecordPolicyModal.tsx`: an import plus one panel after Sold Date (about +5 lines).

**Modified — existing tests (harness only, no assertion changes)**

13. `src/components/contacts/__tests__/recordPolicyModal.test.tsx`
14. `src/components/contacts/__tests__/addClientSale.test.tsx`
15. `src/components/contacts/__tests__/convertLeadModalPolicyFields.test.tsx`

Each gains one `vi.mock` of the panel module rendering `null`, because these harnesses mount no `QueryClientProvider`. The real panel inside each real modal is covered by file 9. If the full suite reveals any other existing test that needs a change, I stop and return for approval rather than edit an unlisted file.

**Docs:**
16. `implementation_plan.md`: as-built record.
17. `WORK_LOG.md`: a newest-first entry.
18. `AGENT_RULES.md`: one paragraph under the Commission grids invariant recording the preview contract.

**Not committed:** a throwaway browser harness in the session scratchpad.

**Unchanged (explicit):** `DialerPage.tsx`, `FloatingDialer.tsx`, `TwilioContext.tsx`, `Contacts.tsx`, `FullScreenContactView.tsx`, `supabase-conversion.ts`, `supabase-clients.ts`, `policySaleRecording.ts`, `clientSaleForm.ts`, `policyIdentity.ts`, `src/lib/commission/{api,calculator,estimate,matching,money,contractLevel,schemas,types}.ts`, `src/hooks/useCommissionCalculator.ts`, `src/hooks/usePermissions.ts`, `src/components/commission/calculator/**`, the synthetic grid fixture (reused as is), and all of `supabase/**`.

**Integration contracts preserved:**
- **Modals:** no change to any modal's props, callbacks, request IDs, `inFlight` or `loading` guards, or close behavior.
- **ConvertLeadModal:** still calls `onSuccess(clientId)` then `onClose()`. DialerPage sets `conversionSucceededRef` synchronously before awaiting `proceedSaveAndNext` or `proceedSaveOnly`. Cancel and `onOpenChange` still go to `onClose`, which is blocked while loading.
- **FloatingDialer:**
  - Its ConvertLeadModal `open`/`lead` gating stays (`lead` is null when the call scope no longer matches), as do its `conversionCallRef` close guard and the `onSuccess` re-checks.
  - Its RecordPolicyModal remount key, `open` gating and `onSaved` re-checks are untouched.
  - When `open` is false or `lead` is null, the panel isn't mounted and requests nothing.
- **No new writes:** the panel writes no calls, queue, lock, disposition, claim or telemetry data, and adds no `await` to any save path.

### 7. Display
- **Figures:** exactly the two lines in §1, from `formatUsd(estimate.firstYearCommission)` and `formatUsd(estimate.advance)` on the engine's exact Rationals. The "75" comes from `ADVANCE_PERCENT`.
- **Another agent:** one compact line above, "For {First Last}" (the email if there is no name). With neither a name nor an email, there is no estimate.
- **Styling:** `rounded-md border border-emerald-500/30 bg-emerald-500/10`, figures in `text-emerald-700 dark:text-emerald-300 tabular-nums`, one column at 390 px.
- **Hidden (nothing rendered):**
  - when not eligible under P4, or under View As;
  - while permissions, viewer, owner or profile are still loading;
  - when not permitted for this credited agent, or the agent is outside the Team scope;
  - when the agency has no calculator grid or no access.
- **Muted single line (never green, never a figure):**
  - a read error ("Commission estimate unavailable");
  - "No assigned agent";
  - a level problem;
  - "No matching product on your agency's comp grid";
  - hints ("Choose a product", "Enter age");
  - the engine's existing unavailable messages, with a configuration error reported as unavailable.
- **Real zero:** a stored zero rate shows $0.00.
- **Copy:** no explanatory paragraphs, footnotes or dashboard.

### 8. Persisted estimate snapshot — DEFERRED, NOT APPROVED FOR IMPLEMENTATION (P3)
**Superseded (2026-10-19):** not a current design. The current saved-commission contract is `docs/plans/2026-10-19-policy-commission-phase-2a/implementation_plan.md`.

Nothing in this section is built in Phase 1: no table, RPC, migration, payload change or post-save write. The first draft's design is kept below for a future, separately approved phase. If it is revived, it also needs an explicit Agency Group peer-read decision: VISION requires one for new tables, and peers can read `wins`.

```sql
-- DEFERRED REFERENCE DESIGN — NOT APPROVED, NOT TO BE AUTHORED IN PHASE 1
CREATE TABLE public.policy_commission_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  policy_id uuid NOT NULL REFERENCES private.policy_identities(policy_id),
  win_id uuid NOT NULL REFERENCES public.wins(id),
  credited_agent_id uuid NOT NULL REFERENCES public.profiles(id),
  grid_id uuid NOT NULL, grid_revision bigint NOT NULL, grid_name text NOT NULL, grid_effective_date date NOT NULL,
  product_id uuid NOT NULL, variant_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('term','whole_life','iul')),
  carrier text NOT NULL, product_name text NOT NULL,
  insured_age integer NOT NULL CHECK (insured_age BETWEEN 0 AND 100), term_years integer CHECK (term_years > 0),
  contract_level integer NOT NULL CHECK (contract_level BETWEEN 1 AND 999),
  rate_percent numeric NOT NULL CHECK (rate_percent BETWEEN 0 AND 300 AND rate_percent = round(rate_percent, 2)),
  monthly_premium numeric NOT NULL CHECK (monthly_premium > 0 AND monthly_premium = round(monthly_premium, 2)),
  annual_premium numeric NOT NULL, first_year_commission numeric NOT NULL,
  advance_percent numeric NOT NULL DEFAULT 75 CHECK (advance_percent = 75), advance_amount numeric NOT NULL,
  calculation_version text NOT NULL DEFAULT 'policy-preview-v1',
  calculated_by uuid NOT NULL DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, win_id),
  CHECK (annual_premium = monthly_premium * 12),
  CHECK (first_year_commission = annual_premium * rate_percent / 100),
  CHECK (advance_amount = first_year_commission * advance_percent / 100)
);
```
The reference writer would be a post-commit, idempotent, server-recomputing RPC keyed on `win_id`, with no client-supplied rate, level, premium or amount. Its reads would be limited to the credited agent, Admin and upline. That remains deferred design text only.

### 9. Rules re-read for conflicts (AGENT_RULES.md, VISION.md, newest WORK_LOG.md)
No conflict. These rules shape the design:
- **Commission grids invariant:** estimate only, a screen-level permission (D3), no query under View As, strict and never-defaulted contract levels, exact values rounded only for display.
- **§3 downline scoping:** query-enforced and fail-closed (§4).
- **#31 effective viewer** (§4).
- **#11 conversion gating and the Dialer callback order** (§6 contracts).
- **#34, #35, #40 and the Oct 3 sale-recording note:** no change to writers or payloads.
- **#36:** guarded async results (§5).
- **#28:** production stays read-only.
- **#6 feature-before-permissions:** satisfied, since this ships with its gates.
- **VISION:** the dark command-center look; the peer-read rule (§8).
- **Chris's minimal-copy rule** (§7).
- **WORK_LOG:** the newest entry is the live Sold Date release (#453); no newer work touches these files.

### 10. Verification
**Fresh baseline on `95009d1` first (no historical count assumed):**
- the strict app typecheck (`npx tsc -p tsconfig.app.json --noEmit`) diagnostics, saved to the scratchpad;
- full Vitest per-file results with CI's inert Supabase environment;
- ESLint on the files to be touched.

Candidate results are compared against that baseline, with pre-existing failures reported separately from new ones.

**Pure:**
- the category map, including Final Expense: whole-life products of the matched carrier only, never another carrier, never auto-selected;
- exact carrier matching (case and spaces);
- termed and non-termed products, and inclusive age edges;
- an ambiguous grid, a missing rate, a stored zero ($0.00), and a missing or zero premium (no figure);
- missing, malformed and off-grid levels, for self and for another agent;
- strict age prefill: invalid or future DOB, leap day, age 101;
- **parity:** for the same inputs across the synthetic grid, the preview's amounts equal `calculateEstimate`'s and render byte-identically through `formatUsd`.

**Access (hook):**
- own and others evaluated independently: an other-agent estimate shows while "View Own" is off, and an own estimate shows while "View Others'" is off;
- each role: Admin, Super Admin, Team Leader inside and outside the Team scope, a team-scope error, and Agent;
- operator ≠ credited agent never uses the operator's level;
- a missing profile row, or one in another organization;
- permissions loading or errored;
- View As with a pre-seeded cache: nothing renders and nothing is fetched;
- a stale response (agent A's level arriving after a switch to agent B) is ignored;
- an organization or session switch resets the panel.

**Panel:**
- recalculation on every premium, age, product and term change, with fetch counters proving no extra requests;
- the reset rules;
- the error boundary keeps the modal alive.

**Modals:**
- **P4 visibility:** the panel shows on create, convert, record and first-policy edit, and not on an ordinary edit.
- **Multiple policies:** independent estimates with different products and premiums, and no total.
- **Payloads:** deep-equal arguments to `convert_lead_to_client_with_sales`, `create_client_with_sale`, `record_client_policy` and `update_client_with_policy_sale`, with and without preview interaction, so receipt hashes are unchanged.
- **One RPC call per save, so no duplicate wins.**
- **Save failure:** the form and preview are kept, and a retry reuses the same request ID.
- **Preview loading or error:** never disables Save.
- **ConvertLeadModal callbacks:**
  - `onSuccess(clientId)` runs once, before `onClose()`;
  - Cancel calls only `onClose`;
  - closing is blocked while loading.

**Dialer regression (unchanged files, existing suites):** CI's selection `npx vitest run dialer twilio teamOpen teamCampaign dncCheck`. It covers:
- DialerPage conversion: Save Only and Save & Next, cancel, and callback ordering via `conversionSucceededRef`;
- Team/Open queue and lock;
- FloatingDialer conversion and disposition.

Also run the contacts and conversion suites, the commission suites (`src/lib/commission src/components/commission src/components/settings/commission-grids`) and the full suite.

**Browser:** a throwaway local harness with the synthetic grid and mocked Supabase, never production, in Chromium at 1440×900 and 390×844. It covers:
- real native-select interaction for product and term;
- typing premium and age;
- multi-policy rows;
- the other-agent line;
- the unavailable states;
- no horizontal overflow.

Screenshots are inspected, not committed.

**Static:** `npx tsc --noEmit`, the strict app typecheck against the fresh base, ESLint on touched files, `npm run build`, `git diff --check`.

**D1:** before committing, the added fixture and test values are compared against the private grid through a read-only, value-free production count (zero matching product names or level-rate pairs). No production values are copied.

**No backend change**, so no SQL suites, migrations or Supabase mutations.

### 11. Out of scope
- snapshots, payout ledgers and reporting;
- booked, earned or paid commission;
- profile permission, RLS or self-edit changes;
- a `hierarchy_path` repair;
- new client columns or required fields;
- carrier or product catalogs;
- a configurable advance percent;
- any dialer change;
- merge, deploy, or production writes and test writes.

---

## 2026-10-17 — Sold Date production release COMPLETE (PR #453)

**Owner approval and release:** Chris approved both backend migrations and the separately controlled frontend production merge/deployment. Reviewed feature head `4bde52a727ca47cc5c772e986a03f72e777fc050` passed all six CI workflows. PR #453 merged to `main` as `12901e5c18922239022afc1c9436df8b2df20c15`. The applied SQL bytes are unchanged by the migration filename reconciliation.

**Production:** Supabase AGENTFLOW CRM recorded `20261017043142_performance_sold_date_basis` and `20261017043757_performance_wins_sold_date_index`. The new index is valid/ready. Existing three-argument Dialer RPC hash `c6cddd40cb7e85a1fab4ac565f9ab59f` remains intact; new v2 hash `8d15902bc5577dbb7c3c1e91296e5740` is installed, with authenticated EXECUTE and no anonymous EXECUTE. No sale, RLS, Twilio, or queue mutation was made.

**Vercel:** Both Git-connected projects `agentflow` (deployment `dpl_5vRNhKc3p72a8HCwevHDASq3gVwD`, canonical `www.fflagent.com`) and `agentflow-life-insure` (deployment `dpl_4x7FnJkBmBZ93mbUSmHDk84RcdvL`) reached READY on exact merge `12901e5c`. Both production URLs served HTTP 200 with new hashed Vite assets. No error/fatal runtime logs appeared in the 30-minute deployment-scoped scans; as a client-side SPA, this is not equivalent to authenticated browser verification.

**Live readback:** Exactly 16 production wins / 16 distinct policy identities; no undated wins or changes to Teo's records. Scoped production RPC simulation confirms Teo Oct 16: 0, Oct 15: 3, current week: 5, and October total: 6 (Sold Date basis). Details and Recent Wins return the basis and separate Sold/Entered fields. Call/contacted/talk/session totals match between legacy and v2 Dialer reader for the tested campaign and day. Supabase advisors reviewed; known pre-existing security items remain separate. No authenticated browser walkthrough or real-agent UX/session refresh was performed; agents should refresh when their current call ends.

**Recovery:** Previous Vercel deployment first, then separately approved guarded database rollback if required. The historical writer, current-owner Reports basis, and production dialer calling path remain unchanged. No follow-up migration or another deploy is authorized by this closeout.

---

## 2026-10-17 — Sold Date production release reconciliation (PR #453; frontend approved, awaiting exact-head gate)

**Authority:** Chris separately approved the core backend migration, the performance index, and then the frontend production merge/deployment, conditioned on reconciliation and green CI. PR #453 base `f20b30b3`; reviewed implementation head `4bd60f3` before this documentation/filename-only reconciliation. No unrelated changes authorized.

**Backend already applied and read back in Supabase AGENTFLOW CRM (`jncvvsvckxhqgqvkppmj`):** `20261017043142_performance_sold_date_basis` and `20261017043757_performance_wins_sold_date_index`. The source SQL bytes are EXACTLY the reviewed authored files `20261017024606_…` and `20261017024610_…`; this commit renames the repository migration filenames to the recorded production versions without changing their blob SHA/content. The matching guarded rollback is renamed, not executed. Live function hashes and privileges were verified; the legacy Dialer function hash stayed `c6cddd40cb7e85a1fab4ac565a3c7949`. The new index is valid and ready.

**Production reconciliation before frontend merge:** 16 wins / 16 distinct policy identities; no undated wins. Teo's six late-entered Oct 16 sales belong to Sold Dates Oct 15 ×3, Oct 14 ×2, Oct 8 ×1. Date-based reporting verified Teo today 0, yesterday 3, week 5 and October 6; no live sale data was edited. No recent unended calls or live Dialer session heartbeats were observed during the approved backend release.

**Release gates:** (1) Re-run CI on the exact reconciled PR head; verify the merged `main` base and every enabled check (Supabase Preview may be skipped due to branch limits; native PostgreSQL CI must PASS). (2) Merge PR #453 to `main` only with clean status and exact-head guard. (3) Verify both Git-linked Vercel production targets (`agentflow`, `agentflow-life-insure`) are READY at the *merged commit SHA*, on their production URLs. (4) Perform post-deploy database/telemetry readback, Teo Sold Date reconciliation and request agents refresh after current calls. No unrelated migration, dialer, secrets, RLS or data mutation. (5) Record any unverified authenticated walkthrough as a limitation, not a PASS.

**Recovery:** prior frontend deployment first, then separately authorized guarded SQL rollback only if needed. Do not run the rollback automatically and do not remove v2 without a release decision. `WORK_LOG.md` contains the release-preparation checkpoint; backend SQL is already live even if UI deployment cannot complete.

---

## 2026-10-17 — BUGFIX, APPROVED FOR DEVELOPMENT AND TESTING ONLY: sales count on the actual Sold Date

**Status:** Chris approved implementation on October 17, 2026 for development and testing on branch `claude/agentflow-sold-date-reporting-2g35mk` (base main `91eabff`), followed by a draft PR. His decisions are recorded in §7. D2 changed from the original proposal: a versioned Dialer RPC sits alongside the unchanged legacy one. **Not approved:** applying production migrations, deploying, or merging into main. Each needs his separate explicit approval. Production sales, including Teo's rows, are never modified. The production Dialer and Twilio call path stay untouched.

**Plain summary:** the Leaderboard, TV, Dashboard, Goals, user performance and the Dialer currently count a sale on the day it was *typed in*. They should count it on its **Sold Date**. The fix moves every sales-period calculation to `wins.sold_date`. It keeps who gets credit, the one-policy-one-sale rules, entry timestamps and all permissions. Calls, talk time and appointments are unchanged. Reports already uses Sold Dates and stays untouched. No sale rows are edited.

### 1. Evidence (read-only, production `jncvvsvckxhqgqvkppmj`, 2026-10-17 02:14 UTC = Oct 16 19:14 PDT)

- **Data:** 16 wins, all in the home agency (America/Los_Angeles). Every row has a `sold_date`, a distinct `policy_id` and an agent. The other three organizations have no `company_settings` zone, so the shared readers already return the 55000 configuration state for them. There are no agency groups. PostgreSQL 17.6.
- **Teo:** six sales were entered Oct 16 between 12:48 and 13:03 PDT, through the normal new-sale path (`event_time_source='event'`). Their Sold Dates are Oct 15 ×3 (conversion, manual, Record Policy), Oct 14 ×2 and Oct 8 ×1. A second agent entered one sale on Oct 16 with Sold Date Oct 15. Overall, 11 of the 16 wins carry a `created_at` 1 to 12 agency days after their Sold Date.
- **Root cause:**
  - `private.performance_rows` buckets wins by `created_at`, including the rolling `recent_wins_7d`.
  - `get_performance_details` filters and orders policy rows by `created_at`.
  - `get_trusted_today_dialer_stats` counts wins by `created_at`.
  - Recent Wins shows only `created_at`.
  - All 14 live performance function bodies are byte-identical (prosrc MD5) to repository source. Live migration history ends at `20261016035626`, and nothing touches performance after `20261005161639`.
- **Expected change at the evidence instant (same rows, no data change):**
  - Today (Oct 16): Teo 6 → 0, other agent 1 → 0.
  - This Week (Oct 12–16): Teo 6 → 5, because the Oct 8 sale moves to Oct 5–11.
  - October totals (Teo 6, other agent 2) and 2026 totals: unchanged.
  - The release recomputes these with the reconciliation query below.
- **Unaffected:**
  - Reports (`get_report_*`: normalized stored policies, `clients.sold_date`/`soldDate`, current assignment).
  - Profile book stats, which are already by Sold Date.
  - Campaign card stats, which are all-time.
  - Dead or unmounted `created_at` readers (`triggerWin`, the `leaderboardPremium` fetchers, `AgentScorecardModal`) stay untouched.
- **Writers:** new sales already require a valid Sold Date. ConvertLeadModal defaults it to the browser-local date, not UTC. There is no future-date guard (see D3).
- **Historical entry mode (shipped Oct 5):** writes `created_at` as the agency midnight of the Sold Date (`event_time_source='sold_date_proxy'`) and keeps the true entry time in `recorded_at`. No such rows exist in production. This conflicts with "never backdate" (see D1).
- **Indexes:** wins has `created_at` indexes (org, org+agent, global) and none on `sold_date`. At 16 rows a Sold Date query is a one-buffer seq scan (0.12 ms).
- **Concurrent work:**
  - Open PRs #451/#442 (Google Sheets) and #444 (ClearPath) touch only their own files plus the newest-first `WORK_LOG.md`/`implementation_plan.md`/`AGENT_RULES.md` headers.
  - #442 carries its own unapplied migration `20261013120000`. There is no functional overlap.

### 2. Contract after the fix

| Area | Rule |
| --- | --- |
| Sales periods | Policies Sold, annual premium, unknown-premium count, standings, `excluded.policies_sold` and policy drill-down lists use `wins.sold_date`. Original seller (`wins.agent_id`), frozen premium snapshots, `policy_id`, receipts and provenance are unchanged. |
| Shared calendar | Agency IANA zone (`private.report_agency_time_zone`; 55000 when missing, as today). Pure calendar-date arithmetic from the frozen as-of: `today = (asof AT TIME ZONE zone)::date`, period start = `date_trunc(unit, today)` (weeks start Monday). Windows are half-open date ranges. A DATE is never converted through UTC midnight, so DST cannot shift it. Group windows use the viewing agency's calendar, as they do today. |
| Current periods | Sold Date from period start through agency **today**. Future-dated sales never count early. Previous-period comparisons use the full previous period. `recent_wins_7d` covers sales dated in the last 7 agency days, today included. |
| Unknown Sold Date | Never counted in any period and never inferred from `created_at`/`recorded_at`. Readers return a scope-wide, all-time `undated_policies` count. The UI shows a short note only when it is above zero (zero in production). |
| Calls / talk time / appointments | Unchanged (`calls.created_at` outbound, setter `COALESCE(created_by,user_id)` on `appointments.created_at`). |
| Dialer header | Calls, talk time and sessions keep the agent-local-day, selected-campaign window. Policies Sold = own campaign wins with `sold_date` = the agent-local date, read only from the new versioned `get_trusted_today_dialer_stats_v2`. The browser sends that date from the same Intl computation as the window. The server validates it against the window (no UTC inference) and echoes `policy_date_basis = 'sold_date'` and `policy_sale_date`. The browser refuses any response without that exact basis and date, so a legacy entry-date total can never appear as a Sold Date total. |
| Legacy Dialer RPC | `get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)` stays byte-identical, with the same ACL and entry-date semantics. It serves only browser tabs opened before the release, so active dialing and those headers keep working until agents refresh, which the coordinated release requires. A COMMENT marks it as legacy compatibility. New code never calls it and never shares its cache. Dropping it is a separately approved follow-up once logs show no callers. |
| Recent Wins | Same latest-20 ordering (`created_at DESC, id`). Each item adds `sold_date` and `entered_at = coalesce(recorded_at, created_at)`, the true entry time, including historical/repair rows. Minimal row copy: "Sold 10/15/2026 · Entered 10/16/2026" when the dates differ, and "Sold 10/16/2026 · Entered 12:48 PM" on the same day. The time is always labelled "Entered" and never sits beside the Sold Date as if it were the time of sale. A row without a Sold Date says "Sold date unknown". |
| Reports | No source, attribution or security change. Regression tests prove it already counts by Sold Date and by current assignment. |
| Security | No RLS or table-policy change. Every public function keeps owner `postgres`, SECURITY DEFINER/STABLE, `search_path`, `statement_timeout` and exactly `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`. New private helpers are `{postgres=X/postgres}` only. Actor and organization stay database-derived, with no caller-supplied organization or zone. There is no raw peer fan-out. |

### 3. Exact database objects (one guarded forward migration; index separate and conditional)

Authored with the CLI timestamp and applied through MCP `apply_migration`. The repository filename is then renamed to the recorded version with SQL bytes unchanged (established practice). Settings are `lock_timeout 1s` and `statement_timeout 15s`. The migration refuses to run on any preimage MD5, owner, ACL or config drift. It verifies postimage metadata before commit.

| Object | Action | Live preimage `md5(pg_get_functiondef)` |
| --- | --- | --- |
| `private.performance_rows(uuid[],timestamptz,timestamptz,uuid[])` | DROP and recreate as `(p_orgs, p_start, p_end, p_sold_from date, p_sold_until date, p_agents DEFAULT NULL)`, with the same result columns. Wins come by Sold Date. A one-time filter raises 22023 on a NULL, reversed or over-366-day window, so a stale caller can never return silent zeros. | `a8fcaed391c64ea3ad96bb7a748d177c` |
| `private.performance_summary(uuid,uuid[],timestamptz,timestamptz,timestamptz)` | DROP and recreate with `(+ p_sold_from, p_sold_until)`; the body is otherwise identical. | `c6da6384fe749c5b5e18fb5b0d68284e` |
| `public.get_leaderboard_snapshot(text,uuid)` | Body only: add the sale window plus `policy_date_basis`, `sold_date_from`, `sold_date_through` and `undated_policies`. Advisory locks, PT429, roster and `excluded` are unchanged. | `6895ef2eacd8762fc2ec012f654775d6` |
| `public.get_leaderboard_recent_wins(uuid)` | Body only: add `sold_date` and `entered_at`. Order, filter and premium are unchanged. | `d912b5768301e8bb00b4233ecaa60fbb` |
| `public.get_performance_summary(text,text,uuid)` | Body only: current and previous sale windows, the basis/date fields and a scoped `undated_policies`. | `72ad61ca0fb903cc59667e70cd336f30` |
| `public.get_performance_details(text,text,text,uuid,timestamptz,integer)` | Body only: policy rows filtered by Sold Date in the frozen window. They return `sold_date` and `entered_at`, ordered `sold_date DESC, created_at DESC, id DESC`. Call and workload branches are unchanged. | `f33f867a40b1241f4191bbfb6a73577c` |
| `public.get_org_leaderboard_stats(timestamptz,timestamptz)` (legacy; no current caller) | Body only: delegate with agency-zone dates from its instant window, clamped to today. Signature, ACL, guard and the 35-day limit stay. | `c71440b40abbac0b5953aaaaa786f508` |
| `public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)` (legacy) | **Unchanged body and ACL** (preimage asserted before and after). Only a `COMMENT ON FUNCTION` marking it as legacy entry-date compatibility for pre-release tabs. | `c6cddd40cb7e85a1fab4ac565a3c7949` |
| `public.get_trusted_today_dialer_stats_v2(uuid,timestamptz,timestamptz,date)` | NEW, distinct name (no default-argument overload). Same calls/contacted/talk/session logic as legacy. Policies use `sold_date = p_sale_date`. It returns the legacy columns plus `policy_date_basis` and `policy_sale_date`. The validated date must lie within the window's possible local dates (UTC−12 to +14), the window must be 22 to 26 h long, and the date must not be later than the latest possible local date now. ACL is exactly owner/authenticated/service_role. | — |
| `private.performance_sale_window(text,text,timestamptz)` | NEW: `(sold_from, sold_until, previous_sold_from, previous_sold_until)` from zone, period (`today`/`day`/`week`/`month`/`year`) and as-of. | — |
| `private.performance_require_sale_window(date,date)`, `private.dialer_sale_day_check(timestamptz,timestamptz,date)` | NEW validators (22023). | — |
| `performance_wins_org_sold_date ON public.wins(organization_id, sold_date)` | NEW, in a **separate** migration, only if the native volume proof (§5) shows the planner uses it. Existing `created_at` indexes stay (the feed needs them). | — |

Unchanged dependencies are asserted by MD5 as well:

- `get_agency_group_leaderboard` `0c5d586f1e3932e4a6b3523fe59ec441` (it delegates to the snapshot).
- `performance_bounds` `d52cfede6da1bd2f99a9a598d803cad6`.
- `performance_scope` `b923259556a920ba02434ac5dc6ccd45`.
- `performance_sale_monthly` `51e06b46a13c3a8eec4d672bec158376`.
- `report_agency_time_zone` `4e94e389294d20c4f342948ca149d58c`.
- `insert_policy_sale` `3f600b757802c0fa8cc1e17fa5c25575` (the writer is not modified).

### 4. Intended repository files (final list, recorded before any code edit)

**Database and ops (new unless marked):**

- `supabase/migrations/<cli-timestamp>_performance_sold_date_basis.sql`: the forward migration (§3).
- `supabase/migrations/<cli-timestamp>_performance_wins_sold_date_index.sql`: kept only if the native plan proof uses it (D6).
- `supabase/migrations/rollback/<version>_performance_sold_date_basis.rollback.sql`: guarded. It restores the exact preimages, drops the v2 Dialer RPC, helpers and index, and removes the legacy COMMENT. It refuses unless the live postimage matches.
- `supabase/ops/reporting-accuracy/reconcile.sql` (modified): the new `performance_rows` call plus a `sold_date_basis` section.
- `supabase/ops/reporting-accuracy/reconcile_sold_date.sql`: standalone and read-only. It uses only objects that already exist, so it runs before and after release.

**Frontend (modified, surgical):**

- `src/lib/performanceQueries.ts`: snapshot and feed schemas require the Sold Date basis. They cross-check `sold_date_from`/`sold_date_through` against the agency-local dates of `start_at`/`end_at`. An old or mismatched payload fails closed.
- `src/components/leaderboard/leaderboardTypes.ts`: `Win.sold_date`, `Win.entered_at`.
- `src/components/leaderboard/RecentWinsPanel.tsx`: the D4 date line, plus the full entry timestamp in the title and accessible label.
- `src/lib/leaderboardExport.ts`: CSV columns appended at the end ("Sold Date From", "Sold Date Through", "Policies Without Sold Date (All Time)") and one caption note only when undated > 0.
- `src/lib/performanceSummary.ts`: summary and details schemas require the basis and dates, cross-checked against the agency zone.
- `src/components/dashboard/DashboardDetailModal.tsx`: policy and premium drill-down rows add "Sold MM/DD/YYYY".
- `src/lib/supabase-dialer-stats.ts`: `userLocalDayBounds` also returns `localDate`. The trusted helper calls only `get_trusted_today_dialer_stats_v2` with `p_sale_date` and requires the echoed basis and date.
- `src/pages/DialerPage.tsx`, three small edits:
  - The header cache prefix goes `v1` → `v2`.
  - The optimistic trusted "Policies Sold +1" after a converting save is removed.
  - An immediate server reconcile is added; the existing 3-second reconcile stays.
  - No call, queue, disposition or Twilio code changes.
- `src/lib/win-trigger.ts`: the stale comment on `soldDate` only (dead path).

**Tests and harness:**

- New `supabase/tests/performance_sold_date_baseline.sql`: reproduces the bug on the old body.
- New `supabase/tests/performance_sold_date.sql`: the post-migration suite.
- New `supabase/tests/reports_sold_date_regression.sql`: Reports Sold Date and current-assignment regression.
- `scripts/reporting_fixture.py` (modified): the new steps, in order.
- `scripts/reports_integrity_fixture.py` (modified): appends the Reports regression.
- `scripts/tests/reporting-concurrency.mjs` (modified): the 50,000-win plan proof with and without the index, timings, and a v2 Dialer smoke test.
- `src/test/fixtures/performance.ts` (modified): basis fields.
- Extended frontend suites:
  - `src/lib/__tests__/performanceContract.test.ts`
  - `src/lib/__tests__/userLocalDayBounds.test.ts`
  - `src/hooks/__tests__/useLeaderboardData.test.tsx`
  - `src/components/dashboard/__tests__/dashboardPremiumLabels.test.tsx`
  - `src/pages/__tests__/dialerAppointmentSave.test.tsx`: v2 mock, no optimistic +1, `p_sale_date`.
- New frontend suites:
  - `src/components/leaderboard/__tests__/recentWinsSoldDate.test.tsx`
  - `src/lib/__tests__/trustedDialerStatsV2.test.ts`
- `scripts/tests/leaderboard-visual/entry.tsx` (modified): snapshot fields and sample wins, including a late entry, so TV Recent Wins rows are geometry-checked.
- Added during implementation, before editing:
  - `scripts/tests/leaderboard-visual/stubs.ts` (modified): the branding stub formats dates like `BrandingContext` (`MM/dd/yyyy`, `h:mm a`) instead of `String`, so the sample rows render as they do in the app.
  - `scripts/tests/leaderboard-visual/verify.mjs` (modified): asserts the Sold Date wording of the sample rows on TV and in the normal view at 390 and 1440 px.
  - `src/lib/__tests__/performanceSummarySoldDate.test.ts` (new): the summary and details readers fail closed on a missing basis or a non-agency window.
- `.github/workflows/reporting-integrity.yml` (modified): the new date tests in the LA/NY/UTC loop, with the inert Supabase env the Dialer helper needs.

**Docs:**

- `implementation_plan.md`.
- `WORK_LOG.md`, newest-first.
- `AGENT_RULES.md`: a proposed invariant marked branch-only and not applied, with pointer notes on #14, #23, #38, #40 and the Oct 3 sale-recording line. It becomes active only with the approved release.

Any file outside this list gets added here, with its reason, before it is edited.

### 5. Verification (synthetic data only; native PostgreSQL 17.6 in CI is authoritative; local PostgreSQL here is 16, a smoke check only)

| Mandatory test | Planned evidence |
| --- | --- |
| 1. Teo fixture | Exact instants: six policies entered Oct 16 PDT with Sold Dates Oct 15 ×3, Oct 14 ×2 and Oct 8 ×1. They are inserted as postgres with real policy identities, plus a writer-path copy with Sold Dates relative to today. Expected: Oct 16 day 0. Oct 15/14/8 days 3/2/1. Week Oct 12–16 is 5, previous week +1. October 6. The pre-migration step proves the old result of 6 on Oct 16. |
| 2. One policy = one sale | A multi-policy client (primary plus additional), same-request retry, additional-array reorder and reassignment all through the real writers. Counts stay +0 except new policies. Seller credit stays with the original seller after reassignment. |
| 3. Periods, DST, zones, future | `performance_sale_window` with fixed as-ofs covers LA fall-back (Nov 1, a 25 h day) and spring-forward (Mar 8), Kiritimati +14, Pago Pago −11, Havana, New York, Monday weeks, month and year rollover, and previous periods. A future-dated sale is excluded until its date. |
| 4. Readers and display | Snapshot, Group (viewer zone), legacy endpoint, summary current/previous, details filter/order, Recent Wins order plus `sold_date`/`entered_at`. Dialer v2: agent-local date, validation 22023, echoed basis and date, and legacy RPC byte-identical with entry-date semantics. Frontend: schema fail-closed, LA/NY/UTC date cross-checks, Recent Wins "Sold" rendering with no UTC shift, drill-down Sold date, CSV columns/note, widget/TV/goals/user-performance suites with updated fixtures. |
| 5. Seller vs current owner | The performance suite keeps seller credit after reassignment. The Reports regression shows the same scenario moving to the current assignee by Sold Date. |
| 6. Access | Agent own; Team Leader self plus downline; Admin agency; Super Admin home organization only; Group member allowed, removed member 42501; forged JWT organization ignored; cross-tenant rows never appear; anon denied on every changed function; exact ACL arrays; no RLS change. |
| 7. Late entry refresh | SQL: a late sale changes only its Sold Date's periods, and repeated reads are stable. Frontend: a wins INSERT triggers one gated feed read and a standings refresh with server totals (no optimistic change). The Dialer shows no +1 after a converting save, reconciles from v2, ignores v1 cache entries, and never accepts a legacy-shaped response. |
| 8. Suites and baseline | Existing reporting/Reports/policy/DNC/Group SQL suites and the native contention script; the new suites; `npm run build`; `npx tsc --noEmit`; `npx tsc -p tsconfig.app.json --noEmit`; lint on touched files; the exact-head frontend comparison workflow. |

**Baseline recorded at `91eabff` (this session):**

- Root `tsc` exits 0.
- The strict app config has 84 diagnostics, none in files planned for change.
- Focused suites: 18 files / 345 tests pass. `userLocalDayBounds.test.ts` needs CI's inert `VITE_SUPABASE_*` values, as `dialer-dnc-backend.yml` sets them.
- `npm run build` passes with the existing chunk-size warning.

Browser: the leaderboard visual gate at 390/1440/TV widths includes the new Recent Wins rows. There is no authenticated production walkthrough unless one is separately observed.

### 6. Release (each production step separately approved; no data mutation; Teo's rows are never altered)

1. Exact-head CI must be green. Publish a reviewable draft PR.
2. **Read-only preflight:**
   - Preimage MD5s, owners and ACLs unchanged.
   - Latest migrations listed.
   - Supabase Git auto-deploy still disabled.
   - Active-dialing check. The legacy Dialer RPC stays, so dialing need not stop. The window still avoids peak dialing, because agents must refresh.
   - Frozen as-of run of `reconcile_sold_date.sql`.
3. **Backend:** apply the forward migration, then read back postimage MD5s, ACLs and configs. Then run read-only authenticated database-role reads for Admin/Agent/Team Leader and compare them to the reconciliation. Apply the index migration only if it was justified.
4. **Frontend:** rename the migration file to the recorded version, merge, and verify both Vercel production targets and their served assets. **Agents must refresh** after their current call; this is part of the coordinated release. Until a tab refreshes, it keeps its old behavior, including entry-day Dialer policy counts from the unchanged legacy RPC. New code never reads, caches or labels those legacy totals. A separately approved follow-up drops the legacy RPC once read-only API logs show no callers.
5. **Observe:** run the established ten-minute leaderboard observation (latency, PT429/5xx; stop on two standings responses over 2 s). Then the post-release reconciliation, WORK_LOG, and AGENT_RULES.

**Rollback:**

- Frontend first: Vercel previous deployment or a revert.
- Then the guarded rollback migration, which restores the exact preimages above.
- A new frontend on an old backend fails closed, showing error states rather than wrong numbers; v2 is missing there, so the Dialer header reads "Stats unavailable". The order is therefore backend before frontend on the way in, and frontend before backend on the way out. The old frontend works on the new backend, because the legacy RPC and the payload keys it reads are unchanged.
- No data rollback is needed.

**Read-only production reconciliation** (`reconcile_sold_date.sql`, `$1` org, `$2` frozen as-of, run in a read-only transaction):

- Per period (day/week/month/year and previous) and per agent: event-time versus Sold Date counts and annual premium.
- Undated, future-dated and late-entry counts with the entry-lag distribution.
- `policy_id`/receipt integrity.
- Expected Teo values.

### 7. Decisions (approved by Chris on October 17, 2026)

- **D1 — Historical-entry backdating:** approved as proposed. The writer is unchanged in this bugfix. Readers stop depending on `created_at`. The feed shows the true entry time (`recorded_at`). Stopping backdating for future historical entries would be a separate follow-up.
- **D2 — Dialer transition:** modified. A versioned, backward-compatible `get_trusted_today_dialer_stats_v2` sits alongside the unchanged legacy RPC. Active dialing and pre-release tabs keep working. Agents must refresh as part of the coordinated release. New code never presents legacy entry-date totals as Sold Date totals: it requires the echoed basis and date, and the legacy cache is never read.
- **D3 — Future Sold Dates at entry:** approved. No writer change here; future-date entry validation is a separate follow-up.
- **D4 — Recent Wins copy:** approved, with minimal wording. The Sold Date is shown distinctly from the entry timestamp, and the time is always labelled "Entered", so it never reads as the time of sale.
- **D5 — Undated sales:** approved. They are excluded everywhere and disclosed only when the count is above zero.
- **D6 — Index:** approved. It is added only if the native 50,000-row plan uses it, and the result is reported either way.

### 8. As built (branch `claude/agentflow-sold-date-reporting-2g35mk`; development and testing only)

- Implemented as specified in §2–§4. Files added during implementation are listed in §4, recorded before they were edited.
- **D6:** the index is kept. In the native 50,000-win proof the planner uses it for a month window, reading far fewer buffers than without it (evidence in WORK_LOG).
- **D4 layout:** the Sold Date part never truncates. On narrow panels (TV at 1366–1920 px, phones at 390 px) the secondary "Entered …" part truncates, and the row's title holds the full entry date and time. Checked in Chromium screenshots.
- **Verification:** all green on synthetic data; details in WORK_LOG (2026-10-17). PGlite (PG 17): reporting 38/38, booking 8/8 and Reports 46/46 steps, including replay refusal, exact-preimage rollback, re-apply and the frozen Teo reconciliation. Native PostgreSQL 16.15: reporting, Reports, Dialer/DNC and policy-sale suites pass; index proof 123 vs 1,740 buffers. Full Vitest: 5,739 tests with no new failures against base (one shared existing failure). LA/NY/UTC date suites pass. Root `tsc` exits 0, strict app 84 = base, lint has no errors, the build passes, and the Chromium TV/normal visual gate passes. Exact-head CI on PostgreSQL 17.6 is still required.
- **Change made during verification:** the summary reader now checks the previous Sold Date window by pure date arithmetic (the day before `sold_date_from`), not one millisecond before `previous_end`. In zones whose local midnight occurs twice (America/Havana, Atlantic/Azores on their fall-back day), the old check would have failed closed all day. A Havana test covers it.
- **Still separately gated:** the production migration, deploy and production reconciliation run; the authenticated production walkthrough; dropping the legacy Dialer RPC; the D1 and D3 follow-ups.

---

## 2026-10-16 — Approved client multi-policy display fix

Chris approved the display-only fix on October 16 at 16:09 PDT: policy count in Clients and expandable details for each policy. Base: `9a905523`. Reviewed AGENT_RULES.md, VISION.md and newest WORK_LOG entries; no AGENTS.md exists. Concurrent Sheets and commission work stays outside this change.

1. Reuse `normalizeClientPolicies` through a pure Client-to-row adapter. Preserve canonical policy counting, legacy additional issueDate fallback, raw currency parsing and malformed-data signals. Do not change reporting normalization or stored data.
2. Add a compact count next to the client name for multiple policies, and a review indicator for malformed policy data. Keep existing columns/sorting/pagination.
3. Add a read-only, independently expandable Policies section in the existing contact details column when additional policies exist (including additional-only clients) or data is malformed. Each policy shows carrier/type, monthly premium, number, coverage and dates. Single-primary contacts retain the existing layout. Keep generic reserved-field exclusion and all editing/save paths unchanged.
4. Verify with synthetic component tests, the existing custom-field preservation suite, TypeScript, lint, production build and desktop/narrow browser checks where available. No real client data enters tests or repository.
5. Update WORK_LOG and open a PR. Production merge/release remains separately gated.

Files intended: `src/lib/client-policy-display.ts`, `src/components/contacts/ClientPolicies.tsx`, `src/pages/Contacts.tsx`, `src/components/contacts/FullScreenContactView.tsx`, focused tests in `src/components/contacts/__tests__/clientPolicies.test.tsx` and the existing `fullScreenContactViewAdditionalPolicies.test.tsx`, `implementation_plan.md`, `WORK_LOG.md`. A short AGENT_RULES amendment will close the already-tracked read-only panel follow-up.

No migration, backend command, RLS, Edge Function, dialer, policy writer, sales event, reporting calculation or production data change.

**Implementation verification:** 97 focused tests pass; root TypeScript passes; strict-app diagnostics are unchanged (84); lint has no errors; production build passes. Synthetic Chromium checks passed at 1440px and 390px, including keyboard expansion and unclipped detail values. GitHub PR/CI and separately approved production release are next.

---

## 2026-10-16 — IMPLEMENTED: Commission UI pre-PR corrections (approved by Chris; branch `refactor/commission-ui-polish`, draft PR)

**Findings (measured on the synthetic harness, with a production-sized synthetic grid of 44 products and 59 variants):**
1. **Save-bar clearance.** At page end the last matrix row sits above the bar at every size checked (390×844, 375×667, 1366×640, 1280×600). Tabbing into a row behind the stuck bar scrolls it into view in Chromium. **Failure:** on a 375×667 phone with a validation message showing, the matrix's own scroll box (`min(32rem,70vh)`) is taller than the space above the bar. Scrolling inside the matrix can then leave its last rows behind the bar until the page scrolls (container bottom 547px vs bar top 538px).
2. **Collapsed-group validation.** Product and variant messages are shown only inside their carrier group; the save bar lists only grid-wide and rate messages. A collapsed group therefore signalled problems with a color-only dot while Save was disabled. Collapsing also unmounted the group's fields, which dropped per-variant UI state such as an open notes panel. No draft data was affected.

**Corrections:**
- `RateMatrix.tsx`: optional `scrollClassName` for the matrix scroll box. `GridEditor.tsx` passes `max-h-[max(16rem,min(32rem,calc(100dvh-15rem)))]`, so the whole matrix box fits above the tallest save bar. The viewer keeps its default.
- `ProductsSection.tsx`:
  - A collapsed group keeps its fields mounted with `hidden`, and the toggle gets `aria-controls` pointing at them.
  - The color-only dot becomes a visible text label: "1 problem" / "N problems", counting that group's product and variant messages.
- New test file `src/components/settings/commission-grids/__tests__/carrierGroups.test.tsx` covers collapse/expand, keyboard semantics (a focusable native button with `aria-expanded` and `aria-controls`), unsaved draft preservation across collapse and expand (including the save payload), and validation feedback while collapsed. Real Enter/Space activation is checked in the browser harness, because `@testing-library/user-event` is not installed and no dependency is added.
- No change to hooks, `src/lib/commission/**`, calculations, permissions or save behaviour.
- During implementation the problem pill became a solid `destructive` pill, because the tinted version was hard to read in dark mode. Results are in WORK_LOG.

**Files:** `RateMatrix.tsx`, `GridEditor.tsx`, `ProductsSection.tsx` (all previously approved), the new test file (requested), `implementation_plan.md`, `WORK_LOG.md`.

## 2026-10-16 — IMPLEMENTED on `refactor/commission-ui-polish` (approved; awaiting visual review, not merged, not deployed): Commission Calculator + Commission Grids visual refresh (UI only)

**Implementation status (2026-10-16):** Chris approved the plan with extra direction: premium SaaS/fintech look, the estimate as the centerpiece, compact with no added explanatory text or duplicated legends, the editor as a workspace, 390px plus light and dark validation, and synthetic data only. Implemented as planned, with these deviations, all UI-only:
- There is no grid-name chip in the calculator header, because the disclaimer already names the grid and its date.
- There is no separate matrix legend, because the existing helper sentence already is one and the `—` placeholder marks blank cells.
- Carrier groups in the editor can be collapsed (open by default, view state only; a red dot marks a collapsed group with problems).
- The status pills are "Live"/"Off" on the calculator card and "Calculator"/"Enabled"/"Inactive" on rows.
- `EditorHeader` is shared by the editor and the viewer, and `RateMatrix` gained an optional `framed` prop.
- The list-row class lives in `CommissionSurface.tsx`, so `gridFormat.ts` stays untouched.

Verification and evidence are in the WORK_LOG entry of the same date.

**Original planning status:** Discovery done, nothing edited except this plan. Base `main` `1ad0226` (PR #447 merged). No conflicting work in the newest WORK_LOG entries: all are the commission backend/release records, and none touch these components. UI only. No change to commission math, RLS, RPCs, hooks, `src/lib/commission/**`, query keys, routes, permissions, release flow or schema. No migrations and no deploys.

### 1. Visual diagnosis (current `main`)
- **Calculator page:** one plain bordered box in `max-w-3xl`. The contract level is a single muted sentence, and the inputs are an undifferentiated 2-column grid with no grouping (product vs client). The result is a bordered `dl` list in which the headline number (first-year total) is only slightly larger than the other rows. The disclaimer is loose 12px text. Desktop leaves wide empty gutters, and the result sits below the fold under the inputs. Loading is a lone spinner.
- **Settings › Commission Grids:** three identical `rounded-lg border p-4` boxes nested inside the Settings page's own bordered card, giving border-on-border. Headers are 14px with a grey icon. There is no visual difference between the calculator selection (the most consequential control) and the lists. Rows have no hover and wrap awkwardly, and badges are default shadcn. Empty states are a single sentence.
- **Editor:** reads as a long form, not a workspace. There is no title or status at the top (only a ghost back button and "last edited"). Sections are bare `h3`s, carrier groups are boxed inside more boxes (three border levels), and the save bar is a flat strip. The conflict banner uses raw `amber-*` instead of the theme `warning` token.
- **Rate matrix:** every editable cell is a full bordered input, so the grid becomes a wall of boxes. Blank (unavailable) cells look like empty inputs, and in read-only mode a blank "—" has the same weight as a real rate. Product heading rows are faint, there is no row hover/focus cue for scanning, and the sticky row header has no edge, so scrolled content runs under it.
- **States:** loading is spinner + text everywhere (no skeletons), error banners are visually loud red boxes, and the viewer's load error is plain red text.

### 2. Design direction: "modern tech CRM"
- **Theme tokens only** (`card`, `muted`, `border/60`, `primary`, `success`, `warning`, `destructive`), so light and dark both work. No raw hex, no new library, no gradients, no glass, no new animation beyond existing `transition-colors`.
- **Fewer, softer borders:** sections use `border-border/60` with a header row (icon tile `h-8 w-8 rounded-lg bg-primary/10 text-primary`, `text-sm font-semibold tracking-tight` title, one-line muted description, right-aligned actions). The same pattern as `ProfileSection` (agent profile) and `ProfileSettingsSection` (settings dividers).
- **Typography hierarchy:** page `h1` `text-2xl font-semibold tracking-tight` (as on AI Agents and AI Testing). Small uppercase `tracking-wider` eyebrow labels for groups, and `tabular-nums` everywhere numbers live.
- **Restrained accent:** primary is used only for the calculator selection, the headline estimate and focus. Status pills use a dot plus text (success = in use/saved, warning = unsaved/conflict, muted = inactive).
- **States:** compact skeletons for loading (keeping the existing `role="status"` text for screen readers). Empty/no-access/error use a shared `StatePanel` (tinted icon tile, title, body, optional action). Error banners are softer (`destructive/5`) and keep `role="alert"`.
- **No copy changes:** every existing user-facing string, aria-label and role stays exactly as is, because the tests and the save/permission flows depend on them. New text is limited to labels drawn from existing data (grid name, effective date, counts) and short structural headings ("Product", "Client", "Details", "Rates").

### 3. Exact files
**New (presentational only):**
- `src/components/commission/ui/CommissionSurface.tsx`: `SurfaceSection` (section shell + header), `StatePanel` (empty/no-access/error), `StatusPill`, `SkeletonLines`. Shared by calculator and settings.
- `src/components/settings/commission-grids/EditorHeader.tsx`: workspace header (back, grid title, status pills, last edited). Extracted from `GridEditor` to keep it under 200 lines.
- `src/components/settings/commission-grids/EditorSaveBar.tsx`: sticky save bar. Extracted from `GridEditor`, with identical props/logic passed in.

**Modified (markup/classes only; logic lines untouched):**
- Calculator: `src/pages/CommissionCalculatorPage.tsx`, `src/components/commission/calculator/{CalculatorWorkspace,CalculatorInputs,CalculatorResults,CalculatorNotice}.tsx`
- Settings: `src/components/settings/commission-grids/{CommissionGridsSettings,CalculatorGridCard,SharedGridsCard,PrivateGridsCard,LoadErrorNotice,GridViewer,GridEditor,GridDetailsSection,ContractLevelsSection,ProductsSection,ProductCard,VariantFields,RateMatrix,CreateGridDialog}.tsx`
- Docs: `WORK_LOG.md` (newest-first entry), this plan (status update).

**Not touched:** `useCalculatorInputs.ts`, `src/hooks/**`, `src/lib/commission/**`, `matrixRows.ts`, `gridFormat.ts`, `editorTypes.ts`, `ConfirmActionDialog.tsx`, `UnsavedChangesDialog.tsx` (wording deliberately matches Settings), Settings page/renderer/nav, all tests (they must pass unmodified), migrations and SQL.

### 4. Planned changes by surface
- **Calculator page:** widen to `max-w-5xl`. Header: title, plus a grid chip showing the selected grid's name and effective date (existing data). A contract-level tile keeps the exact `Your contract level: <value>` node. On `lg` it becomes a two-column workspace: inputs on the left in two labelled groups, Product (policy type → carrier → product) and Client (age, premium, term), and on the right a results card that is `lg:sticky`. The results card shows "Rate used" as a chip row, then the first-year total as the hero figure (`text-3xl`, primary accent), then Advance and Months 10–12 as a 2×2 breakdown. The same `dl aria-label="Estimate"` has its `dd` order unchanged. The empty result becomes a dashed panel with the calculator icon; the unavailable/config message keeps its single `role="status"`. The disclaimer becomes a muted footnote panel with an Info icon. Notices use `StatePanel`, and loading becomes a skeleton of the workspace.
- **Settings overview:** a one-line intro with an "Estimates only" muted pill (existing sentence kept). **Calculator grid** becomes a featured panel: primary-tinted border when on, a `StatusPill` ("In use" / "Off", built from existing data), the selector right-aligned on desktop and full-width on mobile. **AgentFlow grids** and **Your agency's grids** use `SurfaceSection` with count badges. Rows get hover backgrounds, name + pills on line 1, dot-separated meta on line 2, and actions grouped right; Delete is ghost with destructive hover. Empty states use `StatePanel` with the existing sentences.
- **Grid viewer:** the same header pattern as the editor (title, meta, Duplicate), a "Managed by AgentFlow" info strip, the matrix in a framed panel, and source notes as a tidy definition list. Its plain red load-error text becomes a `StatePanel` with the same message and `role="alert"`. No Retry is added, so its fetch behaviour stays as it is.
- **Grid editor:** `EditorHeader` (title = draft name, Calculator/Active/Inactive pills, last edited). Sections Details / Contract levels / Carriers and products / Rates as `SurfaceSection`s. Carrier groups get a cleaner header bar with a product count, and product/variant cards drop one border level (`bg-muted/30` inset rather than border-in-border). Level chips get clearer remove affordance and focus rings. The conflict banner moves to `warning` tokens (same text, same `role="alert"`).
- **Save bar:** sticky, `bg-card/95` with `backdrop-blur-sm` and a top border + soft upward shadow. A status dot (warning when "Unsaved changes", success when "All changes saved"; text unchanged), a validation summary as a compact list with an issue count, and Discard/Save right-aligned and full-width on mobile. Same buttons, same disabled rules.
- **Rate matrix (behaviour identical, memo comparator unchanged):**
  - Header: sticky, solid `bg-muted`, a "Level" eyebrow, `tabular-nums` level numbers.
  - Sticky first column: `bg-card` with a right-edge divider so scrolled cells never bleed under it.
  - Product heading rows: a `primary` left accent bar with semibold text, sticky-left so they stay readable when scrolled sideways.
  - Rows: hover tint plus `focus-within` tint, so the row being edited is obvious.
  - Editable cells: borderless `bg-muted/40` fields that gain a border on hover and a ring on focus, plus a `—` placeholder that visibly marks blank = unavailable.
  - Invalid cells: keep `border-destructive` and gain `bg-destructive/10 text-destructive`.
  - Read-only: blank `—` drawn at `text-muted-foreground/50` so real rates (including `0`) stand out.
  - A small legend (blank / 0 / invalid) built from the existing helper sentence.
  - Mobile: `max-h` uses `min(32rem,70vh)`.

### 5. Risks and mitigations
- **Test selectors:** the tests depend on exact strings, roles and counts (`Your contract level:` own text node, a single `role="status"` in results, `dl[aria-label=Estimate]` `dd` order, a single `role="alert"` during conflict, a cell `className` containing `border-destructive`, button names such as `Delete`, `Disable`, `Remove level`, `Save changes`). Mitigation: no copy or role changes, no added `role="status"`/`role="alert"`, and all tests run unmodified.
- **Draft preservation invariant:** the editor must stay at the same element position in `CommissionGridsSettings` across background errors. Mitigation: that file's branch structure is left unchanged (wrapper classes only).
- **Sticky stacking:** the save bar is `z-30` and the matrix header `z-20/30` inside its own scroll container. The save bar's `-mx-6` relies on the Settings card's `p-6`, which is unchanged.
- **The 200-line rule:** `GridEditor` is at 161 lines, so the header and save bar are extracted.
- **Private data (D1):** before/after screenshots may use **synthetic test fixtures only**, never the FFL grid or production data.
- **Matrix performance:** class changes only. No extra per-cell state, effects or context.

### 6. Stages
1. Branch `refactor/commission-ui-polish` from `main`; `npm ci`.
2. Shared primitives (`CommissionSurface.tsx`).
3. Calculator page + components.
4. Settings overview (calculator card, shared/private lists, intro, error notice, create dialog option cards).
5. Editor shell (header, sections, carriers/products/variants, conflict banner, save bar) + viewer.
6. Rate matrix.
7. Verify: `npx tsc --noEmit`, `npx vitest run src/components/commission src/components/settings/commission-grids src/lib/commission`, `npx eslint` on touched files, `npm run build`. Optional synthetic-fixture screenshots (light + dark, desktop + mobile) via a throwaway harness in the scratchpad (not committed).
8. `WORK_LOG.md` entry + plan status, then commit and push the branch. **No PR unless Chris asks.**

## 2026-10-15 — Commission backend release complete; frontend PR #447 pending merge

**Production:** Three byte-verified migrations are installed in AGENTFLOW CRM (`20261015211858` schema,
`20261016035150` operations and `20261016035626` reference-import infrastructure). The exact approved
private FFL artifact was imported through Supabase MCP outside migration history. Ledger, source/artifact hashes,
stored-row fingerprint and counts (41 products, 57 variants, 11 carriers, 963 rate cells, 57 references) match
the source-backed verification, and the original CSV was not modified. Availability, enablement and calculator
selection each have **one** row, all for **Family First Life - Chris Garness**; all other agencies have zero
availability/access and no selection. No frontend merge or production deployment has occurred yet.

**Security:** The six agency-write RPCs are SECURITY DEFINER owned by NOLOGIN/NOBYPASSRLS
`agentflow_comp_operator`. Direct authenticated and service-role writes to commission tables are denied;
all nine commission tables have RLS. Supabase's managed CREATEROLE flow produced two
`pg_auth_members` grants to the **same sole member** `postgres` (one grantor `supabase_admin`, one
`postgres`), not two distinct member roles. The A10f test now verifies distinct grantees and rejects any
non-`postgres` membership. The database role/grant state is otherwise as reviewed.

**Remaining:** The six migration/rollback filenames have been reconciled to actual production versions without
altering SQL bytes. Final exact-head CI, PR #447 merge and canonical Vercel `agentflow` / `www.fflagent.com`
deployment verification remain. No further migration or import is authorized by this record.

## 2026-10-15 — Commission release compatibility closeout (PR #447, pending production authorization)

**Status:** Draft PR #447 head `bf6d76384184c310aada39227a19b49919f66ac7` passed all seven GitHub workflows, including the complete PostgreSQL 17.6 commission runner (restricted-SET and non-super-role probes, permission/availability negative controls, 59 concurrency assertions, rollback/reapply). No frontend changes in this closeout. Production has only schema migration `20261015211858`; migration 2 failed on the original custom-GUC approach and remains unapplied. No rates, availability, activation, merge or deployment has occurred.

**Changes:** The still-unapplied operations migration now uses a NOLOGIN/NOBYPASSRLS `agentflow_comp_operator` role and an audit-only actor-UID helper rather than a custom GUC. All three private postgres-only ops scripts use psql client approval variables rather than unsupported managed-Postgres SET parameters, with refusal checked by CI. Public synthetic tests and branch docs were updated; private source and import artifact remain byte-identical to their reviewed SHA-256 values and have not entered Git.

**Exact current hashes:** operations migration `0883a44277edb21d294f30a4f51a164ca12a1f445c331cb16b805965e06f3dd9`; operations rollback `4498a5dd41d0284e99905754c30393977c5829d65fd977704fc64203879b469a`; import ops `5015c3077abd5957a12a5950294f830d8fcf3a98f74aec5e88bbc363991f7e1f`; availability ops `a6cf926fdcf9dc58d740d19fa9178071b4fca6dcd14f395f3e4ba9fbe4d5baa3`; activation ops `bec9167c7d0247af1c0d9e0c8df50f89bdec2d47f5beb6485dd83abc44512d7d`. Schema migration `1f8e14fb2119eec01da44d3aff6ba34417c300451495f2028de501e7eb66da70` is already applied; reference infrastructure migration `3cbe4d6947f725d5e4d9e52087ace0fba33a55827d92b7cec9d01d900e55bff0` is pending. Source/artifact SHA-256 and content fingerprint match the private verified manifest.

**Release boundary:** No additional production mutation is authorized by this documentation update. Recheck the exact branch head and production migration state, obtain Chris's explicit approval of the revised production operation and import/availability/activation route, apply each step with read-back verification, then reconcile migration filenames, rerun CI, merge and verify canonical `agentflow` production. Separate follow-up: the existing `profiles.commission_level` self-edit permission issue.

## 2026-10-15 — Commission production authority correction after migration-2 SET failure

**Status:** Production release paused safely after schema migration **20261015211858** applied byte-identically. The
next operations migration failed atomically with `42501 permission denied to set parameter "agentflow.comp_operation"`.
No operations functions, reference import, FFL data, availability, activation, merge or deploy followed the failure.

**Correction on draft PR #447:** the still-unapplied operations migration now forward-corrects the applied schema to
a dedicated `agentflow_comp_operator` role: NOLOGIN, NOSUPERUSER, NOBYPASSRLS, no client/server-key membership.
Only trusted `postgres` is a member so migration/rollback can administer the six owned write RPCs. Authenticated
loses all commission base-table write grants. Those six public write RPCs are SECURITY DEFINER owned by the narrow
role; the role remains subject to RLS, and both policies and the first trigger re-resolve the real JWT/profile actor
through the canonical helpers. The legacy custom-GUC authority is not used by migration 2.

**Verified correction:** exact code head `215ab05c673b171b36b107d68c5f3fb7f9cedc35` is green on all GitHub workflows. PostgreSQL 17.6 passed schema/access/operations/import/reconciliation, restricted-SET reproduction, non-super CREATEROLE ownership transfer, widened-grant/BYPASSRLS/membership negative controls, 59 concurrency assertions, rollback and reapply. Corrected operations SHA-256: `dc0c524b36abc4b97db83dfdd10ed9f62ab14fc4c9f8957ed0a56273a60c1c25`; operations rollback: `593abb853cbe30fe423924b9d0e2dcbf874c92dc66ffb3860f6b86a1f299cc01`.

**Production boundary:** migration 1 remains production history exactly as version `20261015211858`. Production contains zero comp grid/import/availability/access/settings rows, no operation role and no commission write RPCs. The revised migration 2 and every later release step require a fresh exact production approval.

## 2026-10-15 — Commission Calculator + agency commission grids: DRAFT PR #447 (not merged; schema migration applied only; release paused)

**Status:** Chris approved local implementation of the complete calculator and agency grid editor on one branch (`feature/commission-calculator-agency-grids`, base `origin/main` `dacd921`), intended for one PR, with decisions D1–D4 and corrections 1–6. **Implemented locally** in commits `9b615f5` (plan), `fea545d` (database layer), `44d550a` (frontend), closeout records `fb27512`, and the pre-publication `service_role` correction `14d9fa4` (read-only on the comp tables) with its records; verified on synthetic data only (`docs/plans/2026-10-15-commission-calculator/verification.md`). **Published 2026-10-15 as draft PR #447** (Chris approved draft publication only): first head `3971fd0` (after merging `main` twice, #445 and #446, to resolve `WORK_LOG.md` conflicts), then the approved CI correction `2db6de2` (A10f collation-independent ordering, one path-scoped `.gitattributes` rule for the CRLF synthetic fixture, one plan whitespace fix) and its status records, then the approved runner correction setting `NO_COLOR=1` on the editor save-contract Vitest call (on `10e1a73` the 17.6 job passed that test 2 of 2, but the runner's plain-text summary check missed Vitest's colored CI output) with its records. No merge, deploy, Supabase migration, import, activation or hosted-database mutation is authorized or was done; Supabase Preview did not run (concurrent preview-branch limit); production stays read-only (advisor reads included). **Real-data validation passed locally (2026-10-15):** Chris supplied the CSV, and the private import, reconciliation and source-backed acceptance passed on disposable local databases (value-free results in `verification.md`). **Shared-grid availability (D5, 2026-10-15):** a shared grid now reaches only the agencies AgentFlow makes it available to; at launch the FFL Compensation Grid is available to *Family First Life - Chris Garness* only (below). **Not yet released:** a durable private location must be named (D1), and the release needs Chris's separate, exact approval of the release package (plan §12). **Full plan:** `docs/plans/2026-10-15-commission-calculator/implementation_plan.md`.

**Independent-review correction (Chris approved 2026-10-15; planned here before any edit; details in plan §10).** Two findings on head `c354895`, fixed on the same draft PR:
1. **A background read error could destroy an unsaved draft.** Settings › Commission Grids replaced the page when a background overview or catalog refresh failed, unmounting an open editor and its draft. The editor's own snapshot-error branch hid its controls and its Stay/Leave dialog while the navigation guard stayed active. **Fix:** only a failed *initial* load replaces a view. A failed background refresh keeps the last good data, the open editor, its draft, its dirty registration and its dialogs, and shows a compact error with Retry. A save followed by a failed refresh reads as saved, with Retry, not as unsaved or permanently disabled. Logout, permission loss and a user or agency change still remove access and reset the open editor, so no draft carries across. Drafts stay in memory only.
2. **A NULL revision bypassed delete conflict protection.** `comp_delete_private_grid` will refuse a missing grid id or a missing, zero or negative revision (22023) before the admin operation starts. The locked revision comparison stays as it is.

The operations migration is unapplied on every hosted database: production's migration history and catalog were checked read-only, and no preview branch has it. It is therefore corrected in place (rule #25), and its checksum is updated in the release records. **Intended files:**
- `supabase/migrations/20261016035150_commission_grids_operations.sql`
- `supabase/tests/commission_grids_operations.sql`
- `src/components/settings/commission-grids/CommissionGridsSettings.tsx` and `GridEditor.tsx`
- `src/hooks/useGridEditorDraft.ts`
- a new `src/components/settings/commission-grids/LoadErrorNotice.tsx`
- a new QueryClient-backed test, `src/components/settings/commission-grids/__tests__/draftPreservation.test.tsx`
- records: this file, the detailed plan (§8.1, §10, §12), `verification.md`, `WORK_LOG.md`, and one line in the `AGENT_RULES.md` commission invariant

`useCommissionGridsAdmin.ts` was reviewed and is not expected to change.

**Implemented and verified locally** (plan §10):
- **Regression tests:** before the fix, the new tests reproduced both findings; after it, they pass.
- **Other checks:** the full database runner, the frontend job's tests, scoped ESLint, both type-checks (the same 84 app diagnostics as before) and the build all pass.
- **Checksums:** the operations migration's checksum is now `7e3caad6…` (it was `d7c20e17…`). The other migrations, the ops scripts and the fixture are unchanged.
- **CI:** results for the new revision go in the PR description.

**Final private FFL validation and release preparation (Chris requested 2026-10-15; planned here before any record edit).** Chris supplied the source CSV (expected SHA-256 `998307b4…`, matched) and confirmed one source cell as authoritative; that decision is recorded privately with the values, never here. Scope:
- **Private, outside Git:** exact validation (importer and an independent check), the deterministic artifact, import into disposable loopback databases only, bidirectional reconciliation and source-backed acceptance. Results enter public records only as SHA-256 values, aggregate counts and PASS/FAIL.
- **Public, value-free:** merge `origin/main` (`b5976e0`, #448) to clear the `WORK_LOG.md` conflict; the `AGENT_RULES.md` commission-invariant heading (it still says "branch only: nothing pushed"); the manifest's null fields; the runbook status; the detailed plan's status, §10 and §12 release package; `verification.md`; this file; one `WORK_LOG.md` entry. No code, test, migration, ops-script, fixture or workflow change.
- **Not authorized:** any production migration, import or activation; merge; deploy; RLS or migration-history change; any hosted-database mutation. The phase ends with the release package for Chris's approval.

**Done and verified (release preparation; plan §10 and `verification.md`):**
- **Private checks, all PASS.** Source checksum matched. Importer validation: 0 anomalies, 41/57/11. Independent source check: 49 PASS, 0 FAIL. Artifact `cf83d992…`: deterministic, verified, and equal to the CSV. Disposable import: `imported`, then `already_imported`. Reconciliation: 0 differences in both directions on C and `en_US.UTF-8`, and 7 negative controls fail as required. Activation rehearsal: 21 PASS. Source-backed acceptance: 49 of 49.
- **Public changes.** The merge commit `9cfaf16` (`main` #448; `WORK_LOG.md` resolved additively) and the value-free records listed above. Nothing private is in Git.
- **Release package.** Plan §12 now reflects the actual partial release: schema migration `20261015211858` is applied and empty; every later action remains paused.

**Shared-grid availability correction (Chris requested 2026-10-15; planned here before any edit; detailed plan §2 D5 and §10).**

*Decision.* An agency can see, enable, read or copy an AgentFlow shared grid only after AgentFlow makes that grid **available** to it. Being an Agency Admin is not availability. At launch, the FFL Compensation Grid is available only to *Family First Life - Chris Garness*. This supersedes C6's "other Agency Admins may self-enable after release". Platform roles and Control Center permissions are not used.

*Design (smallest database-authoritative mechanism):*
- **New table `public.organization_comp_grid_availability`.**
  - Columns: `organization_id` (required), shared `grid_id`, `created_at` and `created_by`; primary key `(organization_id, grid_id)`.
  - It can only name a shared grid (the same nil-scope foreign key as the access rows).
  - It is server-only: RLS on, no client policy, no anon or authenticated privilege; `service_role` has SELECT only.
  - Postgres-only functions write it. There is no Agency Group peer read and no platform or Super Admin bypass.
- **Enabled access depends on availability.** `organization_comp_grids` gets a foreign key to availability, `ON DELETE CASCADE`.
  - An access row cannot exist without availability.
  - Removing availability removes the access row. The existing access-revoked trigger then clears that agency's calculator selection if it pointed at the grid.
  - Private copies are separate grids and are untouched.
- **Enable checks availability.** The access trigger `private.comp_access_rules` runs for every writer. It also requires availability for that agency and grid, locked `FOR SHARE`, and otherwise refuses PT404.
  - So an enable, by any id, refuses a grid that is not available.
  - Snapshot, content reads, selection and copy already require the access row, so they inherit the rule.
- **Catalog filter.** `comp_list_shared_grid_catalog()` returns only active shared grids available to the caller's agency.
- **New postgres-only functions:**
  - `private.comp_make_reference_grid_available(agency name, grid)`: exact unique name; a verified import is required; retry-safe.
  - `private.comp_remove_reference_grid_availability(agency name, grid)`: locks the agency's settings row first, then removes availability; the access row and the selection are cleaned up as above. It reports what it cleared.
- **Unchanged behaviour:** disabling keeps availability. The lock order becomes settings → grid → availability → access → product → children.
- **Release.** A new ops script, `commission_grids_make_available_home_agency.sql`, creates availability for the exact unique name only. The existing activation script (initial enable and select-if-empty) then runs for that agency, and it now needs availability first.

*Migration handling.* The three commission migrations are unapplied everywhere:
- production's migration history and catalog were re-checked read-only;
- the only Supabase branches are the PR #294 and #378 previews, which predate this feature.

They are therefore corrected in place (rule #25), and their new checksums replace the old ones in the release records. No new migration, and no change to migration history.

*Files to touch:*
- **Migrations:**
  - `supabase/migrations/20261015211858_commission_grids_schema.sql`: the table, the access foreign key, the trigger check, RLS and grants;
  - `supabase/migrations/20261016035150_commission_grids_operations.sql`: the catalog filter;
  - `supabase/migrations/20261016035626_commission_grids_reference_import.sql`: the two functions;
  - the schema and reference-import rollback files.
- **Ops scripts:** the new `supabase/ops/commission_grids_make_available_home_agency.sql`; and `supabase/ops/commission_grids_activate_home_agency.sql`, whose header changes only.
- **Tests and runner:**
  - `supabase/tests/commission_grids_harness.sql`, `…_schema.sql`, `…_access.sql` and `…_import.sql`;
  - `scripts/commission_grids_concurrency.mjs`;
  - `scripts/run_commission_grids_tests.sh`.
- **Records:** this file, the detailed plan, `AGENT_RULES.md` (the named exception and the commission invariant), `verification.md`, the runbook and `WORK_LOG.md`.
- **Frontend:** no change expected. The settings card already describes the catalog as grids "available to this agency", and copy sources come from enabled catalog entries.

*Tests to add (negative):*
- The home agency's Admin sees and enables the grid once it is available.
- Another agency's Admin cannot see it in the catalog, cannot enable it by id, and cannot snapshot, read or copy it.
- Removing availability leaves no unauthorized selection.
- Private copies stay independent.
- Agents and Team Leaders cannot manage availability or enable shared grids.

**Implemented and verified locally (availability correction; plan §10 and `verification.md`):**
- **As built.** As designed above, plus one refinement found while writing the tests: withdrawing availability that does not exist returns `removed: false` and writes nothing.
- **Tests.**
  - Access A4 changed and A11 added. The refused callers include another agency's Admin, its Super Admin holding the `platform_admin` platform role, an agency-less platform admin, A's Agency Group peer, Agents, Team Leaders and `service_role`.
  - Import I1 and I6 changed and I8 added. Schema S1o–S1s and S6k–S6n.
  - Concurrency scenario 9: withdrawal against enable, select and copy, in both orders.
  - Ops-script checks, and two negative controls: no availability gate fails A4m; an unfiltered catalog fails A4l.
- **Checks.** The full runner passes on C and `en_US.UTF-8` (66 checks each; CI runs PostgreSQL 17.6). The CI frontend command, root `tsc`, the app type-check (the same 84 diagnostics), ESLint on the 64 branch code files and the build all pass.
- **Private re-run with the real artifact** (disposable loopback databases only). The fingerprint is unchanged and reconciliation passes. Activation is refused before availability. The availability and activation scripts then pass, followed by 4 + 28 + 7 rehearsal checks, and the MCP route passes too. Acceptance passes 49 of 49. No rate changed.
- **Checksums.**
  - Changed: schema `1f8e14fb…` (was `84637cf3…`), operations `dc0c524b…` (was `7e3caad6…`), reference import `3cbe4d69…` (was `b8b2836b…`), activation ops `46c41c89…` (was `47f91f70…`, header only).
  - New: the availability ops script `c484c040…`.
  - Unchanged: the import ops script `d2825d41…` and the fixture `9bad2737…`.

**Release-package Vercel correction (Chris, 2026-10-15; records only).** Chris accepted the availability implementation and CI on head `885004e` for the final release preflight. Plan §12 now treats `agentflow` (`www.fflagent.com`, `fflagent.com`) as the canonical production project, with rollback candidate `dpl_6LM8RRL2guFmeMzxjA7bhEVDv44B`. `agentflow-life-insure` (Vercel-hosted domains only) is recorded for completeness and never gates release success. No Vercel setting changes. Still open before the final read-only preflight: P1 (durable private storage of the exact CSV and artifact) and P4 (Supabase "Deploy to production" confirmed off).

**Decisions:**
- **D1:** the real FFL source stays private (never in Git, public CI, PR text, screenshots or public docs, including the carrier-specific acceptance expectations). Reference data loads through a documented private-import workflow; all DDL stays in committed migrations.
- **D2:** `#APPROVE_RLS_CHANGE` for authoring and local testing of the new compensation tables' policies only, documented as the **Shared compensation grid exception**.
- **D3:** the calculator's navigation and route gate respect "View Own Commission Percentage".
- **D4:** the CSV is still required; the private import, reconciliation and source-backed acceptance are BLOCKED, and the feature is not release-ready. **Update 2026-10-15:** the CSV was supplied, and those checks passed locally.

**Design proof first (C1):** authorization and locking proven in a disposable loopback PostgreSQL 16 database with real non-bypass roles before building on them (plan §4.5).

---

## 2026-10-11 — Part A + D14 and Part B implemented on draft PR #440 (not merged, not released): UI copy cleanup takeover (V2 simple metric labels)

**Final targeted polish (2026-10-12):** Chris approved two presentation fixes on top of `d4b7257`: the Contact Flow Required Fields note, and the duplicate Permissions and coming-soon Settings headings. The exact files and lines are in the detailed plan §17.13. Implemented in `9010612`, with its tests, and verified against `e11c8bea`. No backend change. Owner acceptance on the protected preview follows. The PR stays in draft.

**Part B status (2026-10-12):** Chris approved the Part B plan with overrides (PB-10, PB-13, PB-15, PB-33, PB-1, PB-19/22, PB-21 and PB-26), recorded in the detailed plan §17.11 before any edit.
- **Implemented** on the same branch and draft PR #440, in commits `208be52` to `022e7d1` (detailed plan §17.12).
- **Records.** `reconciliation.md` names the implementing commit for each item.
- **Verified** against base `e11c8bea`; one independent final review and a fixture-based visual review were done (WORK_LOG 2026-10-12).
- **Not done:** signed-in acceptance, any backend change, and any production merge or deploy.
- **Awaiting:** Chris's review of draft PR #440 and its protected preview, signed-in acceptance, and separate approval for merging and the production release.

*The Part A entry below is kept as written on 2026-10-11.*

**Status:** Chris approved the isolated Part A with D1–D14 on 2026-10-11. It is implemented and verified on local branch `claude/ui-copy-cleanup-v2-20261011` (base `origin/main` `e11c8bea`), in commits `5587d3a` (Reports labels), `9fd72ef` (CRM labels), `cb14cfa` (rule and Data basis wording), `74219dc` (D14), `f23a987` (D14 follow-up, Settings Goals), `0c62756` (D14 tests) and `cba9e94` (whitespace). It is published as draft PR #440 with its normal protected preview (CI green). Nothing is merged, and there is no production deploy or backend change. The onboarding series stays INACTIVE. **Full plan:** `docs/plans/2026-10-11-ui-copy-cleanup-v2/implementation_plan.md` (§16 and §16.1 for Part A; §17 and `reconciliation.md` for Part B). **Evidence:** the newest WORK_LOG entry.

**Summary:**
- **Labels.** Simple metric labels across Reports, Dashboard, Leaderboard/TV, settings and CampaignDetail. CSV headers, CSV Note constants, ids, payloads and calculations are unchanged.
- **D14.** Display-only: a premium amount whose every policy has an unknown premium shows "Unavailable" or "—", never $0.00. Sorting, payloads and CSV are untouched.
- **Part B.** A fresh, targeted plan against current code (§17): 410 items across seven areas, each mapped and adversarially verified. 187 are still needed, 188 retained, 28 already satisfied and 7 superseded. No Part B app or test edit has been made. Nothing was recovered from the sandbox or reconstructed from old files.

**Awaiting:**
- Chris's approval of the Part B plan (§17.5 decisions PB-1 to PB-35) before any app or test edit;
- separate approval for merging and the production release.

---

## 2026-10-10 — BUILT, INACTIVE, final review done (draft PR; not merged, not deployed, not applied): role-based onboarding email series

**Final review (2026-10-10):** PR #438 was verified against production and merged with Chris's approval (`02ad8380`). The onboarding branch is rebased onto it, and only onboarding files change. The security review passed. One correction was approved and made: `sanitizeError` now redacts email addresses, unsubscribe tokens, `Bearer` values, Resend keys and JWTs from every logged or stored error. No merge or deploy mechanism activates the series while Supabase "Deploy to production" stays OFF. All local gates pass. Merge needs Chris's explicit approval; D12 still blocks activation. Details: detailed plan §16.

**As built (2026-10-10):** the full series is implemented on `claude/onboarding-email-series-20261010` and switched off by four independent locks. All local SQL, Deno and frontend gates pass, with zero new TypeScript diagnostics. Evidence is in the detailed plan §15 and WORK_LOG. Merge, migration apply, deploys, secrets, scheduling and activation each need Chris's separate approval (detailed plan §11). D12, a confirmed mailing address, blocks activation.

**Approval (2026-10-10):** Chris approved the D1–D11 defaults and Corrections A–C. D12 means no invented address; one must be confirmed before activation. Correction B is done first, as draft PR #438. Decisions, corrections and the exact file list are in the detailed plan, §14. Activation stays separately gated.

**Status:** plan only, on branch `claude/onboarding-email-series-20261010` (base `main` `e21728e`). No application file has been edited and no migration has been written or applied. No Edge Function, secret, cron job or trigger has been created, and no email has been sent. Production was only read.

**Full plan:** `docs/plans/2026-10-10-onboarding-emails/implementation_plan.md`. **Copy:** `docs/plans/2026-10-10-onboarding-emails/email-copy.md`. **Previews:** https://claude.ai/artifact/X18LPg9HJF4NVdaHGNxqWp.

**Summary:**
- **Mechanism.** A sweep enrolls users, a queue holds the steps and an Edge worker sends them. It follows the live platform-admin and `sms-consent-worker` pattern. No trigger is added to `auth.users` or `profiles`.
- **Schedules** (10:00 agency time):
  - Agent series: Day 1/3/5/8/14, for Agents and Team Leaders.
  - Admin series: Day 2/4/7/12.
  - Day 0 stays the existing welcome email, unchanged.
- **Four locks keep it off:**
  - a DB flag, default false, that also gates the enrollment and claim RPCs;
  - an Edge env kill switch;
  - no cron job;
  - an unapplied migration under `supabase/migrations/pending/`.
- **Historical accounts are never enrolled.** Only welcome emails sent after an activation timestamp count, and that timestamp is NULL today.
- **Opt-out.** A signed one-click unsubscribe, plus a Settings switch shown only when the program is enabled. It covers onboarding tips only.
- **Untouched:** `create-user`, `send-welcome-email`, the invitation emails, `send-email-previews`, the admin-notification system, `_shared/systemEmail.ts` and `_shared/systemEmailTemplates.ts`.

**Conflict noted (resolved 2026-10-10 by PR #438, merge `02ad8380`):** the platform-admin registration emails are live in production (migration `20261010172702`, `platform-admin-notify` v1, cron active), but `main` had no record of that release. See the detailed plan, §1 and D11.

**Awaiting:** Chris's approval of the plan and the exact file list (detailed plan §7), plus decisions D1–D12 (§10).

---

## 2026-10-10 — RELEASED (record reconciled 2026-10-10): Super Admin registration emails (new user / new agency)

**Release record (2026-10-10, reconciliation PR):** production carries migration `20261010172702` (authored `20261010200000`, identical bytes), Edge `platform-admin-notify` v1 (bundle byte-identical to `3a6fce2`) and the active cron job. The repository file was renamed to the recorded version. Evidence and limits: `docs/plans/2026-10-10-super-admin-registration-emails/deployment.md` §8. The status lines below are the pre-release history, kept as written.

**Release-prep status (latest):** the read-only preflight passed. Chris approved the two §A10 corrections (code, docs and local testing only), and both are implemented and verified (§A11). No production change has been made. Awaiting approval for production step 1 in `deployment.md`.

**Current status:** Chris approved Phase 3 on 2026-10-10. It is implemented and verified locally on `claude/super-admin-registration-emails-20261010` (rebased onto `main` `e21728e`). Nothing is merged, deployed, applied or pushed, and no production write was made. The exact production sequence is in `docs/plans/2026-10-10-super-admin-registration-emails/deployment.md`. §A9 (As built) records what was built; the text from §A1 to §A8 is the plan as approved, kept as written.

**Chris's decisions (2026-10-10):**
- D1: Option A, DB enqueue + Edge worker.
- D2: notify on successful account creation.
- D3: a **server-side configurable recipient secret** `PLATFORM_ADMIN_NOTIFY_RECIPIENT`, default `chris@fflagent.com`. This differs from my recommendation.
- D4: private Edge secrets + Vault authentication.
- D5: implement the test plan, but create no live production user without a separate approval.
- D6: document the live `create-user` v56 mismatch now and reconcile it in a separate PR.

Additional requirements: preserve the self-service restriction; never redeploy `create-user`; keep every failure non-blocking; keep the queue server-only; distinguish active, pending and suspended agencies; keep the shared renderer; change no customer-facing email; track the `create-organization` / `accept-invite` concerns separately.

**Original status line (plan stage):** Phases 1–2 only. The only repository change is this section of `implementation_plan.md`, on local branch `claude/super-admin-registration-emails-20261010` (base `main` `462fa12`). No application file edited, no migration applied, no Edge Function deployed, no secret created, nothing pushed. Production was only read (Edge Function list/source, catalog and count queries).

**Goal.** Email `chris@fflagent.com` once per real event:
- `[AGENTFLOW ADMIN] New User Registered`
- `[AGENTFLOW ADMIN] New Agency Created`

### A1. What was reviewed

- `AGENT_RULES.md` (all sections; relevant: §3, invariants #2, #4, #5, #10, #20, #21, #25, #28, #30, §8–§10), `VISION.md`, and `WORK_LOG.md`, the newest entries in full (2026-10-10 Reports PR-A/PR-B back to 2026-10-06) and every signup, system-email and welcome-email entry.
- **Work Log conflicts: none.** The open work (Reports PR-A/PR-B) touches no auth, email or organization code. Production's newest migration, `20261010043517`, matches the repository head.
- Code: `create-user`, `create-organization`, `accept-invite`, `invite-user`, `send-welcome-email`, `_shared/systemEmail.ts`, `_shared/systemEmailTemplates.ts`, `_shared/a2p/notifications.ts` (existing Resend outbox), `sms-consent-worker` (existing pg_cron + Vault worker auth), `AuthContext.signup`, `SignupPage`, `AcceptInvitePage`, `SuperAdminDashboard`, `supabase/config.toml`.
- Production (read-only): triggers on `auth.users` / `profiles` / `organizations`, `handle_new_user`, `provision_organization`, the FKs on `profiles`, `cron.job` (secrets masked), migration history, organization/profile counts.

### A2. Findings

**Registration and agency creation paths (traced):**

| Path | Creates | Called by the frontend? | Live state |
|---|---|---|---|
| `create-user`, invite mode | auth user → `handle_new_user` inserts `profiles` | Yes (`AuthContext.signup`) | v56, `verify_jwt=true`, live |
| `create-user`, self-serve mode | auth user + profile, then `provision_organization` (org + dispositions + founder attach in one transaction); compensating `deleteUser` on failure | Yes | **Disabled in production** (see drift below) |
| `accept-invite` `action:"accept"` | auth user + profile | No (legacy) | v45, deployed and callable with the anon key |
| `create-organization` | `organizations` row (direct insert) | No | v55, `verify_jwt=false`, **no auth check**; deferred item per invariant #20 |
| SQL / dashboard | either | n/a | possible |

**Authoritative success events.** Every user registration, whatever the path, ends in exactly one `INSERT INTO public.profiles` (PK = `auth.users.id`; `handle_new_user` trigger). Every agency creation ends in exactly one `INSERT INTO public.organizations`. Logins (`sync_last_login_at`), profile edits and onboarding-wizard saves are UPDATEs and never INSERT a second row. A row-level `AFTER INSERT` on those two tables is therefore the single authoritative, duplicate-free signal, and it covers paths the Edge layer cannot see.

**Rollback behaviour.**
- `provision_organization` is transactional, so a failed self-serve org rolls back the `organizations` INSERT and anything its trigger enqueued.
- A failed self-serve signup deletes the auth user, and `profiles_id_fkey` is `ON DELETE CASCADE`. The profile disappears, but a profile-level enqueue would already be committed, so the sender must re-check that the subject still exists after a settle delay.

**Live/repo drift (important).** Live `create-user` v56 (deployed 2026-10-02 22:55 UTC) returns `403 "Self-service signup is temporarily disabled…"` for non-invite signups. The repository copy does not have this guard, and no Work Log entry records it. **Redeploying `create-user` from the repo would silently re-enable self-serve signup.** This is a strong reason not to touch `create-user` in this feature.

**Production shape:** 4 organizations (3 self-serve agencies, all `suspended`), 16 profiles, last profile 2026-10-01. No existing admin-notification mechanism.

**Reusable infrastructure:**
- `_shared/systemEmail.ts` `renderSystemEmail` + `SYSTEM_EMAIL_FROM = "AgentFlow <team@fflagent.com>"` (verified sender). Invariant #21 requires every AgentFlow-owned email to use this renderer.
- `a2p_email_outbox` + `deliverEmails()`: an outbox table with `unique(user_id,event_key)`, an attempts counter, `last_error`, a Resend `Idempotency-Key` and a 23-hour stop.
- `sms-consent-worker`: pg_cron every minute → `net.http_post` with a **dedicated** Vault token (never the service-role key) → constant-time Bearer check in Deno.

### A3. Proposed design (Option A, recommended)

**Database enqueues, Edge sends.** No signup or onboarding code changes.

1. **Outbox table `public.platform_admin_notifications`**, platform-global like the Control Center tables.
   - RLS enabled; all privileges revoked from `PUBLIC`/`anon`/`authenticated`; `service_role` only. It is never readable by any tenant.
   - Columns: `id`, `event_type` (`user_registered` | `agency_created`), `subject_id`, `organization_id` (informational, nullable), `status` (`pending` | `sending` | `sent` | `skipped` | `failed`), `attempts`, `available_at`, `locked_until`, `last_attempt_at`, `sent_at`, `provider_message_id`, `last_error` (sanitized, ≤ 500 chars), `created_at`.
   - **`UNIQUE (event_type, subject_id)`.**
   - It stores ids only, never a PII snapshot. Details are read at send time.
2. **Two `AFTER INSERT` row triggers**, functions in `private`, `SECURITY DEFINER`, `search_path = pg_catalog, public, pg_temp`:
   - on `public.profiles`, which enqueues `user_registered`;
   - on `public.organizations`, which enqueues `agency_created`.
   - Each runs `INSERT … ON CONFLICT DO NOTHING` wrapped in `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING`, so an enqueue failure **can never abort a signup or an org creation** (invariant #10 pattern). There is no network I/O in the trigger.
   - **No backfill:** existing rows never notify.
3. **Claim RPC `public.claim_platform_admin_notifications(p_limit int)`**, `service_role` EXECUTE only. It is an atomic `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` that claims due rows:
   - `pending`, past the **60 s settle delay**, `available_at <= now()`; or
   - `sending` with an expired lease.

   Each claim sets `status='sending'`, a 5-minute lease and `attempts+1`. Overlapping cron runs can never both send.
4. **New Edge Function `platform-admin-notify`** (`verify_jwt=false`, invariant #2). Authorization is enforced in code: a constant-time `Bearer` comparison against the new secret `PLATFORM_ADMIN_NOTIFY_TOKEN` (≥ 32 chars). It accepts no body input (no recipient, no HTML, no ids). For each claimed row it:
   - re-reads the subject. If it is gone (for example a compensated self-serve failure), it marks the row `skipped`, `subject_deleted`, and sends nothing;
   - renders through the shared renderer;
   - POSTs to Resend with `Idempotency-Key: platform-admin-<row id>`;
   - on success marks the row `sent` and stores the Resend message id;
   - on failure returns the row to `pending` with backoff (1, 2, 5, 15, 30 min). After 6 attempts, or 23 h (Resend's idempotency window), it marks the row `failed`.
   - Every attempt is `console.log`/`console.error`'d with row id, event type and outcome, never the email body or secrets.
5. **pg_cron job `platform-admin-notify-every-minute`**: `net.http_post` to the function with `Bearer <vault 'platform_admin_notify_token'>`, filtered `WHERE length(decrypted_secret) >= 32`, the same shape as `sms-consent-recovery-every-minute`. It is a **no-op until the Vault secret exists**, so the migration is inert until secrets are provisioned. A notification normally arrives about 1–2 minutes after the event.
6. **Templates** in `_shared/systemEmailTemplates.ts`: `renderAdminUserRegisteredEmail`, `renderAdminAgencyCreatedEmail`.
   - **ADMIN ONLY** identifier: badge `ADMIN ONLY · INTERNAL NOTIFICATION`, plus an opening line "This notification is sent only to the AgentFlow platform administrator."
   - One additive helper `detailTable(rows)` in `_shared/systemEmail.ts`: table-based, inline CSS, every value `escapeHtml`'d.
   - Subjects are fixed strings, as specified.
   - CTA: `${siteUrl}/super-admin/organizations/<org id>`, or `/super-admin` when there is no org.
   - A plain-text part is included.
7. **Recipient:** a server constant `PLATFORM_ADMIN_NOTIFICATION_RECIPIENT = "chris@fflagent.com"` in the shared module. It is never taken from a request or a row.

**Email contents (no secrets, no auth data):**
- **New User:** full name, email, role, organization name + id (or "No organization yet"), signup source (`invite` / `self_serve` / `other`, from `user_metadata.signup_source`), invited by (inviter name, when an Accepted invitation matches), profile status, email confirmed (Yes / Pending), registered at (UTC and America/Los_Angeles), user id. **Never** passwords, tokens, invitation tokens, confirmation links, JWT/app_metadata or phone numbers.
- **New Agency:** agency name, slug, organization id, platform status, Twilio provisioning status, founder (name, email, role) when attached, member count, created at (UTC + PT).

**Duplicate prevention (five layers):**
1. INSERT-only trigger, one per primary key.
2. `UNIQUE(event_type, subject_id)` + `ON CONFLICT DO NOTHING`.
3. `SKIP LOCKED` claim with a lease.
4. A Resend idempotency key per row, which covers a crash after the send but before the update.
5. A terminal `sent` / `skipped` / `failed` status.

**Failure isolation:** the trigger swallows its own errors. Delivery is asynchronous in a separate function. No signup or onboarding request waits on it or can observe it.

**Tenant isolation:** the outbox is service-role only. Templates read one subject by id with the service role. Nothing is exposed to any tenant session, and no RLS policy on any existing table changes.

**Invariant #21 note:** the welcome-email rule forbids *DB-triggered delivery* and service-role keys in DB settings. Here the database only enqueues. Delivery stays in an Edge Function, authenticated by a dedicated Vault token, the approved `sms-consent-worker` pattern. I will amend invariant #21 to record this.

**Option B (not recommended):** send inline from `create-user` after success. It would need `create-user` rebuilt from the **live v56** source (drift risk above). It misses `accept-invite`, `create-organization` and SQL paths, and it adds latency and a failure surface to signup.

### A4. Files

**New:**
1. `supabase/migrations/<ts>_platform_admin_registration_notifications.sql`: table, grants/RLS, two trigger functions + triggers, claim RPC, guarded cron job.
2. `supabase/migrations/rollback/<ts>_platform_admin_registration_notifications.rollback.sql`: unschedule the cron job, drop the triggers, functions and table.
3. `supabase/functions/platform-admin-notify/index.ts`: thin handler (auth + loop).
4. `supabase/functions/_shared/platformAdminNotifications.ts`: recipient constant, detail loaders, send/backoff logic (injectable fetch for tests).
5. `supabase/functions/_shared/platformAdminNotifications.test.ts`: Deno tests.
6. `supabase/tests/platform_admin_notifications.sql` + `scripts/run_platform_admin_notification_tests.sh`: native PostgreSQL runner, localhost-proved (invariant #28).

**Edited (surgical):**

7. `supabase/functions/_shared/systemEmailTemplates.ts`: two render functions, plus tests in `systemEmailTemplates.test.ts`.
8. `supabase/functions/_shared/systemEmail.ts`: additive `detailTable()` (+ test).
9. `supabase/config.toml`: `[functions.platform-admin-notify] verify_jwt = false`.
10. `AGENT_RULES.md` (invariant #21 amendment), `WORK_LOG.md` (newest-first entry), this plan (as-built).

**Not touched:** `create-user`, `create-organization`, `accept-invite`, `invite-user`, `send-*-email`, Gmail OAuth / `email-*` functions, `workflow-executor`, Auth templates, every frontend file, every existing RLS policy. No migration edits.

### A5. Deployment (each step separately approval-gated; GitHub "Deploy to production" stays disabled per invariant #30, so changes go through MCP)

1. `apply_migration` with the exact reviewed bytes, then `list_migrations` and a catalog read-back (triggers, ACLs, cron job present and inert).
2. Secrets: Edge secret `PLATFORM_ADMIN_NOTIFY_TOKEN` and the identical Vault secret `platform_admin_notify_token`. See D4.
3. `get_edge_function` (expect not found) → `deploy_edge_function platform-admin-notify` → read back source + `verify_jwt=false`.
4. Smoke checks: an unauthenticated POST → 403; an authenticated POST with an empty queue → `{processed:0}`.

### A6. Verification plan

- **Local PostgreSQL 16 (isolated, synthetic data, localhost proved):**
  - a profile INSERT enqueues exactly once; an UPDATE (login, profile edit, wizard) enqueues nothing;
  - an org INSERT enqueues once; a rolled-back `provision_organization` leaves no row;
  - duplicate INSERT attempts → one row;
  - a trigger forced to fail still lets the profile/org commit (warning only);
  - concurrent claims never return the same row;
  - the settle delay and lease expiry behave as specified;
  - `anon`/`authenticated` cannot select the table or execute the RPC.
- **Deno tests (mocked Resend):**
  - correct recipient, `from`, subjects and badge;
  - all values escaped; no token/password/link fields present;
  - a deleted subject → `skipped`, no send;
  - Resend 500 / timeout / missing key → `pending` with backoff, then `failed` after 6 attempts; the idempotency key is stable per row;
  - an unauthenticated request → 403;
  - the handler never throws back to the caller.
- `npx tsc --noEmit`, `npx vitest run` (no new failures against the known baseline), ESLint, plus `deno check` / `deno test` on the new files.
- **Production (live data, invariant #28):** production self-serve signup is disabled, and creating a test user or agency is a production write. An end-to-end live test therefore needs your separate approval (D5); otherwise I mark it **BLOCKED**, not passed.

### A7. Decisions for Chris (recommendation first)

- **D1 Architecture:** **Option A, DB enqueue + Edge worker** (recommended), or Option B, inline in `create-user`.
- **D2 Meaning of "registered":** **the account is created (profile row exists), and the email shows whether the address is confirmed yet** (recommended), or only after email confirmation (this needs an `auth.users` UPDATE trigger and adds complexity).
- **D3 Recipient:** **hardcoded server constant** (recommended), or an Edge secret so it can change without a deploy.
- **D4 Secret provisioning:** **you set the two matching secrets yourself in the dashboard** (Edge secret + Vault, ≥ 32 random chars, value never in git or chat; recommended), or you approve me to generate and set them through MCP. The value would then appear in this session's tool calls.
- **D5 Live test:** you approve one real invite signup to an address you control (it creates one real user in an org you choose), or live verification is recorded as BLOCKED.
- **D6 Drift:** **record the live `create-user` v56 self-serve disable in WORK_LOG/AGENT_RULES only, and sync the repo file in a separate small PR** (recommended), or sync it inside this PR.

### A8. Risks and rollback

- **Risk: a bug in the trigger on the signup path.** Mitigation: exception-swallowing, no network, and tested failure injection. Rollback: run the rollback migration (drop the triggers); signup behaviour is then byte-identical to today.
- **Risk: duplicate or missing email.** Mitigated by the five layers above. A stuck row is visible in the outbox with `last_error`.
- **Risk: cron cost.** One HTTP call per minute, which returns immediately when the queue is empty, the same cost as the two existing per-minute workers. Option: a 2-minute schedule.
- **Observation (out of scope, not changed):** `create-organization` is publicly callable without authentication, and `accept-invite` still creates users. Once this feature ships, any use of either produces an admin email, which is useful detection. Their hardening remains the deferred item.

### A10. Release preparation review (2026-10-10) — APPROVED by Chris (code, docs, local tests only); implemented in §A11

**Read-only preflight (production `jncvvsvckxhqgqvkppmj`):** all checks PASS.
- The newest recorded migration is `20261010043517`, and the notification migration is not recorded.
- `platform-admin-notify` is not deployed.
- None of the feature's objects exist: no queue, cron job, triggers, functions or Vault secret `platform_admin_notify_token`.
- `create-user` is **v56**, `verify_jwt=true`, ezbr `2dc286da…`, and still returns 403 for self-service signup. This matches the documented production behaviour, so there is no stop condition.
- `pg_cron` 1.6.4, `pg_net` 0.19.5 and `supabase_vault` 0.3.1 are present.
- Existing `profiles` / `organizations` triggers and the 11 cron jobs do not collide with the new names.
- Resend is evidenced as live: `a2p_email_outbox` shows 5/5 sent with no error, and the last welcome email went out 2026-10-01.
- Branch `f549bd4` equals the pushed head, `main` is unchanged at `e21728e`, and all six artifact sha256 values match `deployment.md`.

**Security advisor baseline (read-only, 2026-10-10):** 223 findings in 7 lints:
- `authenticated_security_definer_function_executable` 113;
- `anon_security_definer_function_executable` 58;
- `rls_enabled_no_policy` 24;
- `function_search_path_mutable` 22;
- `extension_in_public` 3;
- `rls_disabled_in_public` 2;
- `auth_leaked_password_protection` 1.

The expected post-release delta is exactly **+1 `rls_enabled_no_policy` (INFO)** on `platform_admin_notifications`. It is intentional: the queue is server-only, the same pattern as `a2p_email_outbox`. The trigger functions are not client-executable, and the RPCs are SECURITY INVOKER and service_role-only, so any other new finding stops the release.

**Required adjustment: the recipient must fail closed.**
- Today `resolvePlatformAdminRecipient` (`_shared/platformAdminNotifications.ts:35-45`) **silently falls back** to `chris@fflagent.com` when `PLATFORM_ADMIN_NOTIFY_RECIPIENT` is set but malformed, and also treats a set-but-blank value as unset.
- Proposed:
  1. **Unset** (`Deno.env.get` returns `undefined`) → default `chris@fflagent.com`.
  2. **Set** to any value, including blank or whitespace-only → it must be exactly one valid address (the existing pattern, ≤ 254 chars). Otherwise the resolver returns a configuration error. The address is never echoed: the log says only `PLATFORM_ADMIN_NOTIFY_RECIPIENT is set but invalid` and the value's length.
  3. The handler checks the recipient **before claiming**, next to the existing `RESEND_API_KEY` gate: `console.error` with the sanitized message, then `503 {"error":"Recipient configuration invalid"}`. No row is claimed, no attempt is spent, and nothing is sent to any address.

**Related fix needed for "preserve queued notifications for retry after the configuration is corrected".**
- Today the 23-hour stop is measured from `created_at`. A misconfiguration (bad recipient, missing Resend key) lasting more than 23 hours would close never-attempted rows as `failed`, and they would be lost.
- The 23 h limit exists only because Resend's idempotency key lasts 24 h, a risk that starts at the **first send attempt**.
- Proposed migration change (the migration is unapplied in production, so editing it is allowed):
  - add a nullable column `first_attempted_at`, set once by the claim with `coalesce(first_attempted_at, now())`;
  - the 23 h checks in `claim_platform_admin_notifications` and `complete_platform_admin_notification` use `first_attempted_at` instead of `created_at`.
- Never-attempted rows then wait safely until delivery is possible. The email already shows the original registration/creation time.

**Files to modify (surgical):**
1. `supabase/functions/_shared/platformAdminNotifications.ts`: the resolver returns `{ ok, recipient } | { ok: false, error }`.
2. `supabase/functions/platform-admin-notify/index.ts`: the recipient gate before claiming.
3. `supabase/functions/_shared/platformAdminNotifications.test.ts` and `supabase/functions/platform-admin-notify/index.test.ts`: tests for unset → default, set-valid → used, set-malformed or set-blank → fail closed with no claim, no echo of the value, and a 503.
4. `supabase/migrations/20261010200000_platform_admin_registration_notifications.sql`: `first_attempted_at`, plus the two 23 h predicates.
5. `supabase/tests/platform_admin_notifications.sql`: T12 rewritten (an old **never-attempted** row is still claimable; an attempted row whose `first_attempted_at` is older than 23 h fails), plus an assertion that the claim stamps `first_attempted_at` once.
6. The rollback is unaffected: it drops the table.
7. `docs/plans/2026-10-10-super-admin-registration-emails/deployment.md`: refreshed hashes; WORK_LOG; AGENT_RULES #21 wording (fail-closed recipient, the window starts at the first attempt); this plan.

**Verification after editing:**
- the local PG16 runner (suite, negative control, concurrency, rollback);
- Deno check/test over `_shared/` + `platform-admin-notify/`;
- `npx tsc --noEmit`;
- vitest compared against `main`;
- ESLint on the changed files.

**Other review findings (no change proposed):**
- Duplicate prevention, worker auth, server-only queue, non-blocking triggers, delivery logging, tenant isolation, rendering and rollback all hold as built.
- A trigger function in `private` runs for a direct `service_role` insert without schema USAGE. This was proven locally, and production already has 10 `public` tables with `private` trigger functions.
- *Optional least-privilege nit:* `service_role` holds DELETE on the queue, which the worker never uses. It can stay for operator cleanup or be dropped; the default is to leave it.

### A11. §A10 corrections as built (2026-10-10) — NOT merged, NOT deployed

**Pre-edit checks:** the branch was clean at `49371bb0` (equal to the pushed head), `main` was unchanged at `e21728e`, and no PR had been updated since the preflight, so there was no conflict.

**Correction 1, fail-closed recipient:**
- `resolvePlatformAdminRecipient(configured)` now takes the raw env value explicitly and returns `{ok:true, recipient, source}` or `{ok:false, error}`:
  - unset → `chris@fflagent.com`;
  - set to one valid address (trimmed, ≤ 254 chars, no whitespace / `,` / `;` / `<>` / quotes / parentheses) → that address;
  - set to anything else, including blank or whitespace-only → an error. The error carries only the value's **length**; no address fragment, no `@`, and never the default.
- `platform-admin-notify` checks it after auth and after the `RESEND_API_KEY` gate, **before creating a client or claiming**: `console.error("…set but invalid (length N)…; queue left untouched")` → `503 {"error":"Recipient configuration invalid"}`.
- Rows keep `attempts = 0` and their eligibility.

**Correction 2, delivery window (migration edited; it is unapplied in production):**
- New nullable `first_attempted_at`, set only by the claim, as `coalesce(first_attempted_at, now())`, so it is never overwritten.
- New `CHECK ((attempts = 0) = (first_attempted_at IS NULL))`.
- The claim sweep and `complete_platform_admin_notification(retry)` measure 23 h from `first_attempted_at` instead of `created_at`. A never-attempted row (NULL) therefore never matches and never expires.
- Unchanged: retry/backoff (1/2/5/15/30 min), the 6-attempt cap, lease reclaim, the per-row Resend idempotency key, and the terminal `failed` outcome for non-retryable provider errors.

**Files modified (this pass):**
- `supabase/functions/_shared/platformAdminNotifications.ts`
- `supabase/functions/platform-admin-notify/index.ts`
- `supabase/functions/_shared/platformAdminNotifications.test.ts`
- `supabase/functions/platform-admin-notify/index.test.ts`
- `supabase/migrations/20261010200000_platform_admin_registration_notifications.sql`
- `supabase/tests/platform_admin_notifications.sql`
- `scripts/run_platform_admin_notification_tests.sh` (a second negative control)
- `docs/plans/2026-10-10-super-admin-registration-emails/deployment.md` (hashes, recipient note, column read-back)
- `AGENT_RULES.md` (#21 wording), `WORK_LOG.md`, this plan

**Unchanged:** the rollback file (it drops the table, so it covers the new column), templates, renderer, triggers, grants/RLS, `create-user` and all signup code.

**Verification:**
- **Local PG16:** 20 behaviour tests PASS. New:
  - T12: a row queued 48 h but never attempted is still claimed, stamped, and retries normally.
  - T12a: `first_attempted_at` is immutable across claims.
  - T12d: an attempted row whose first attempt is more than 23 h old fails, both via retry and via the claim sweep.
  - T12e: the CHECK.
- Replay guard, two-session SKIP LOCKED (3 + 3, overlap 0), the original negative control (T1), **new negative control 2** (the migration rebuilt with the old `created_at` window makes T12 fail), and the rollback proof all PASS.
- **Deno:** 161 passed / 0 failed. The recipient tests cover unset, valid, and 11 invalid shapes with no echo. The handler tests prove 503 before any claim, one sanitized log line, and that an unset recipient passes the gate.
- **`npx tsc --noEmit`:** exit 0. **ESLint:** changed files clean. **Vitest:** see WORK_LOG.

### A9. As built (2026-10-10) — NOT merged, NOT deployed

**Pre-edit checks:**
- Re-read AGENT_RULES/VISION and the WORK_LOG head. `main` had moved to `e21728e`, adding Reports release docs only, and the branch was rebased onto it.
- The 8 open PRs (#429, #425, #398, #383, #382, #381, #378, #294) touch no auth, email, organization or `_shared/systemEmail*` file, so there is no conflict.

**Files (exact):**
- **New:**
  - `supabase/migrations/20261010200000_platform_admin_registration_notifications.sql`
  - `supabase/migrations/rollback/20261010200000_platform_admin_registration_notifications.rollback.sql`
  - `supabase/functions/platform-admin-notify/index.ts` + `index.test.ts`
  - `supabase/functions/_shared/platformAdminNotifications.ts` + `.test.ts`
  - `supabase/tests/platform_admin_notifications_harness.sql`, `supabase/tests/platform_admin_notifications.sql`
  - `scripts/run_platform_admin_notification_tests.sh`
  - `docs/plans/2026-10-10-super-admin-registration-emails/deployment.md`
- **Edited:**
  - `supabase/functions/_shared/systemEmail.ts`: additive `detailTable()`, `noticeBox()`, `DetailTone`, `DetailRow`; the existing renderer is unchanged.
  - `supabase/functions/_shared/systemEmailTemplates.ts`: the two admin templates + `deriveAgencyStatus`; the existing templates are unchanged.
  - `supabase/functions/_shared/systemEmail.test.ts`: 2 tests.
  - `supabase/config.toml`: `[functions.platform-admin-notify] verify_jwt = false`.
  - `AGENT_RULES.md` (#20 drift + tracked items, #21 notification rules), `WORK_LOG.md`, this plan.
- **Not touched:** `create-user`, `create-organization`, `accept-invite`, `invite-user`, every `send-*` function, Gmail/`email-*`, `workflow-executor`, Auth templates, the frontend, existing RLS policies, applied migrations.

**Deviations from §A3, each tightening the design:**
1. `complete_platform_admin_notification` gained a terminal `failed` outcome. A Resend `409 invalid_idempotent_request` cannot succeed on retry, and a previous attempt may already have been delivered, so the row closes for review instead of burning six attempts.
2. The cron command also requires that a due row exists, so the function is not invoked at all while the queue is idle.
3. A missing `RESEND_API_KEY` returns 503 **before** claiming, so a misconfiguration spends no attempts.
4. The agency lifecycle (D-additional) is `deriveAgencyStatus`:
   - `suspended` → Suspended, `archived` → Archived;
   - `active` (or NULL = column default) with `twilio_subaccount_status='active'` → Active;
   - otherwise Pending, with the reason ("Phone system provisioning is pending", and so on).

   The user email shows the same lifecycle for the user's agency.
5. Invited-by is resolved from an Accepted invitation by exact normalized email equality in code (never `ilike`). Invitation tokens are never selected.

**Verification:** see the WORK_LOG entry for exact counts. In short:
- local PG16 SQL suite: 17 behaviour tests (T0–T15 + T12b) + replay guard + two-session SKIP LOCKED proof + negative control + rollback proof, all PASS;
- Deno: 159 passed / 0 failed across `_shared/` + `platform-admin-notify/`;
- `npx tsc --noEmit` clean;
- vitest: no new failures against `main`.

---

## 2026-10-09 — RELEASED (PR #433, merge `d88982d`): Campaigns page table redesign, Phase 1

**Current status:** Released 2026-10-09. PR #433 was squash-merged as `d88982d`, whose tree is identical to the verified head `67d638a`, and Vercel deployed it to production on both projects. Authenticated hosted checks remain NOT VERIFIED; see §15 Release. §14 records what was built; the text below §14's heading is the approved plan, kept as written.

**Status when submitted for approval:** Phase 0 is complete. No application file has been edited, no backend command has been run, and nothing has been pushed. The only repository change is this section of `implementation_plan.md`.

**Base and branch:** base is `main` at `8d53531`. The proposed branch is `feature/campaigns-table-phase1-20261009`. Push, PR, merge and deploy each need separate approval.

**Revision history:**
- Rev 1 was drafted after the review.
- Rev 2 addresses an independent three-reviewer pass (requirements, safety/invariants, feasibility). That pass found no blockers. Its corrections are folded in below; the main ones are D1, the result caps, the harness widths, compare-and-set detection, placeholder states, sticky-column mechanics and query options.
- A separate verifier then re-checked rev 2 against the installed packages and the repository. It confirmed the new mechanisms and found five minor corrections, all applied here:
  - the unreachable View All case was removed from D1;
  - Open Pool assignee ids are now collected;
  - `role_permissions` was added to the harness stubs;
  - a desktop test pass was added;
  - the expanded row is now sized with container query units.

### 1. What was reviewed

**Documents.** I read `AGENT_RULES.md` (all 620 lines) and `VISION.md`, and all 13,017 lines of `WORK_LOG.md` in eight chunks reviewed in parallel.

**Code.**
- `Campaigns.tsx`, `CampaignDetail.tsx`, `CreateCampaignModal.tsx`, `CampaignHeatmap.tsx`
- `campaign-card-stats.ts`, `campaign-assignee-scope.ts`, `campaign-settings-permissions.ts`
- The Dialer `CampaignSelection*` table family
- `usePermissions`, `PermissionGate`, `PageGuard`, `useOrganization`, `AuthContext`, View As surfaces
- Every `user_preferences` writer, plus `report_layouts`
- The shadcn primitives
- The test and visual-harness infrastructure

**SQL**, read from the repository migrations only (no database was queried):
- `get_campaign_card_stats`, `get_queue_metrics`, `get_campaign_last_dialed`, `get_dialer_campaign_presence`
- `campaigns` and its RLS policies
- `user_preferences` and its policies and trigger

**Open PRs checked for overlap:** #429, #425, #398, #383, #382, #381, #378, #294. None touches campaign files, `src/components/ui/*`, permissions or `user_preferences`. #378 touches `src/App.tsx`, which this plan does not edit.

**Baselines on `8d53531`.**
- `npx tsc --noEmit` exits 0 but checks zero files.
- `npx tsc -p tsconfig.app.json --noEmit` reports **85 errors**, none of them in campaign files.
- Installed versions: `@tanstack/react-query` 5.83.0, `supabase-js`/`postgrest-js` 2.98.0, Playwright 1.56.1 (global, under `/opt/node22/lib/node_modules`), Chromium at `/opt/pw-browsers`.

### 2. Current page defects (confirmed in code)

1. **Fabricated zeros.**
   - While stats load, after a stats error, or when the RPC omits a campaign, Contacted and Converted show 0 (`Campaigns.tsx:347`).
   - `getCampaignCardStats` swallows errors and returns `{}`.
   - On the same fallback path, Total and Called come from `campaigns.total_leads`/`leads_called`. Those columns are trigger-maintained and **accurate** (invariant #17), so those two values are true today.
2. **The RPC and the list disagree on visibility.**
   - `get_campaign_card_stats` returns Personal campaigns to their owner only. Its `view_all` (JWT Admin, Team Leader or Team Lead, or `is_super_admin()`) widens Team only (baseline `:2211-2236`).
   - The list shows agents' Personal campaigns to Admins and Super Admins, so the RPC omits exactly those rows.
   - No other row is omitted. `campaigns_select` RLS uses the same JWT role list as the RPC's `view_all` (baseline `:11687`). A non-leadership role granted View All Campaigns therefore never receives unassigned Team rows in the first place.
3. **A failed list load looks empty.** It renders "No campaigns yet" with a Create button. There is no error state at all.
4. **No request safety.** There is no abort and no stale-response guard. Every refetch flashes the skeleton.
5. **Hidden row cap.** The list uses `select("*")` with no paging, so PostgREST `max_rows` (default 1000) would silently truncate it.
6. **Incomplete agency lock.** The suspended/archived lock covers only the header Create button. The empty-state Create button and Duplicate bypass it. It fails open if the status read errors; that part is left as is.
7. **Duplicate is not a real dialog.** It is a custom overlay with no focus trap, no Escape handling and no dialog role.
8. **Rule violations.** The page is 435 lines and uses inline `style` widths, against the 200-line and Tailwind-only rules.

### 3. Scope

**This build is frontend only.**
- No migration, RLS, RPC or Edge change.
- No edit to `TwilioContext`, Voice.js, queue RPCs, call telemetry, dispositions, `DialerPage` or any Dialer component.
- No change to `CampaignDetail.tsx`, `CreateCampaignModal.tsx`, `campaign-assignee-scope.ts` or `App.tsx`.
- I run no production reads or writes. Live checks happen only on a preview, after approval, and Chris performs them.

**Runtime reads and writes the shipped page will make.** Each one goes through the signed-in user's RLS.

| Kind | What |
|---|---|
| Read | `campaigns` (org rows) |
| Read | `get_campaign_card_stats` |
| Read | `get_campaign_last_dialed`, only if D3 is approved |
| Read | `profiles` (leadership assignee identities; the Create-modal agent list, as today) |
| Read | `organizations.status`, as today |
| Read | `user_preferences` (own row) |
| Write | `user_preferences`, own row only, on an explicit Save or Reset |
| Write | `campaigns` insert from Duplicate (unchanged payload) and from the existing Create modal |

**Visibility is unchanged.** The page reads org-scoped rows (RLS still applies) and then runs the existing `filterCampaignsForManagement(rows, user.id, { isAdmin, isSuperAdmin, viewAll })` with today's inputs. Management access never grants Dialer access, and no dialing action is added.

### 4. UX design

**Visual direction.** The target is AgentFlow's dark command-center look, built only from theme tokens so the light theme is correct as well. The app defaults to light; dark is the `.dark` class. Approval screenshots lead with dark and include light. **No mockup of the approved direction exists in the repository. Chris, please share the reference if there is one** (question Q1).

**Header**
- Title "Campaigns" with a muted count.
- **New Campaign** primary button:
  - gated by `PermissionGate "Create Campaigns"`, as today;
  - disabled while the agency is locked, with the existing toast;
  - opens the existing `CreateCampaignModal`, unchanged.
- No subtitle or descriptive copy.

**Toolbar** (one row on desktop, wrapping on narrow screens)
- Name search.
- **Type** select: All / Personal / Team / Open Pool. Legacy `OPEN` counts as Open Pool.
- **Status** select: All / Draft / Active / Paused / Completed / Archived.
- **Sort** select. Sortable header buttons drive the same sort state, and sorted headers carry `aria-sort`.
- **Reset**, shown only when something differs from the defaults.
- **Columns** popover, on the desktop table only.
- Radix/shadcn primitives throughout.

**Desktop table** (`xl` and up: a viewport of at least 1280px gives about 990px of content next to the 240px sidebar)
- Shell: `rounded-xl border border-border/60 bg-card`.
- The header band and rows use **opaque** layering, so the sticky column stays clean. Each cell sits on `bg-card`, with the muted tint and hover drawn as an overlay (`group` / `group-hover:`).
- Rows are about 48px tall, with thin dividers drawn on the cells (`border-separate border-spacing-0`).
- Numbers are right-aligned and use `tabular-nums`.
- The table uses `min-w-max`/explicit column minimums, so it scrolls inside its wrapper instead of squeezing columns.
- The Actions column is `sticky right-0 z-10 bg-card` with a left divider shadow.
- Expanded-row content is `sticky left-0`, sized to the visible width without measuring or inline styles. The table sits in a wrapper with `[container-type:inline-size]`, and the content uses `w-[100cqw]` (Tailwind 3.4.17 arbitrary values).

| Column | Default | Rule | Content |
|---|---|---|---|
| Expand chevron | yes | fixed first | A `<button>` with `aria-expanded`/`aria-controls`. It expands inline and never navigates. |
| Campaign | yes | locked | The name links to `/campaigns/:id`, with a compact Personal / Team / Open Pool badge (existing `campaignTypeBadgeClass`). |
| Status | yes | | Restrained pill with a dot: Active → success, Paused → warning, Draft → muted, Completed → primary, Archived → faded muted. |
| Lead progress | yes | | `called / total` plus a 4px bar (the existing shadcn `Progress` with `h-1`; its internal transform is the accepted primitive exception, so there is no page inline style). The tooltip says "Called at least once". The words "Untouched" and "Completed" are never used. |
| Agents | yes | | Personal → owner. Team → avatar stack with `+N`. Open Pool → "Open to agency" (D9). Identities follow D5. |
| Converted | yes | | Distinct converted campaign leads (RPC `converted_leads`). Never policies sold. |
| Actions | yes | locked, last, sticky | **Open** plus an overflow menu. |
| Contacted | optional | | RPC `contacted_leads`. |
| Created | optional | | Branding `formatDate(created_at)`. |
| Tags | optional | | Up to two chips, then `+N`. |
| Last dialed | optional (D3) | | Relative time, with a tooltip and `sr-only` exact time. |

There is **no Ready Now column** (D2).

**Metric states.** These apply to the RPC values Total, Called, Contacted and Converted. Each state renders differently and has a test.

| State | Rendering |
|---|---|
| Loading, including a placeholder map that lacks this id | Skeleton |
| Request failed, with no usable data | "—", plus one compact "Metrics unavailable · Retry" notice |
| Settled response from the current key with no row for this campaign | Depends on D1 |
| Loaded | The value. A genuine 0 renders as 0. |

**Last dialed states** (if D3 is approved): loading shows a skeleton; an error shows "—" with Retry; a loaded response with no row shows **"Never"**. The RPC is organization-wide, so a missing row means never dialed.

**Expanded row** (desktop and mobile)
- One row open at a time, matching the Dialer table's single-open accordion.
- A compact definition grid:
  - Total, Called, Contacted, Converted, using the states above;
  - Created;
  - Retry interval, Max attempts, Calling window and Ring timeout, from the existing `campaignSelectionModel.ts` helpers;
  - Last dialed (D3);
  - Owner or assigned agents (D5/D9).
- Description and tags appear only when they have a value.
- No charts, nested cards, presence or activity feed. There is no reliable feed source; Last dialed is the only candidate (D3).

**Actions**
- **Open** navigates to the existing detail route.
- The overflow menu holds **Duplicate**. Its eligibility is copied unchanged from today's role logic:
  - Agent: no item.
  - `role` "Admin" (case-insensitive): allowed.
  - Team Leader: allowed only if they created the campaign or are assigned to it.
  - Any other role string: disabled, with "Only the campaign owner can duplicate".
- With D4, Duplicate is also disabled while the agency is locked.
- When a viewer has no items, the overflow trigger is not rendered at all.
- The menu uses `DropdownMenu modal={false}`. The dialog state lives at page level and opens from `onSelect`.

**Duplicate dialog**
- Built on Radix `AlertDialog`. Confirm is a plain `Button` and the dialog closes only on success. Escape and outside-close are blocked while saving.
- The payload is validated with Zod.
- It inserts **exactly today's payload**: `"<name> (Copy)"`, the type, description, `assigned_agent_ids` and tags, status Draft, zeroed counters, `created_by`, `organization_id`.
- It never copies leads.
- The toast and activity-log entry are the same as today. Afterwards the list refreshes in the background.

**Below `xl`: stacked rows** (tablet and mobile)
- One bordered list, one row per campaign:
  - line 1: name and type badge, with the status pill on the right;
  - line 2: lead progress bar and `x / y called`;
  - line 3: **Open**, the overflow menu and the chevron, each a touch target of at least 40px.
- Expanding shows the same detail grid, which covers every optional column.
- No horizontal scrolling is needed for any essential action.
- Desktop and stacked are chosen by a `useMinWidth(1280)` hook based on `matchMedia`/`useSyncExternalStore`. Only one tree is mounted, so ids are not duplicated and the DOM is not doubled. Column preferences apply to the desktop table only.

**Page states**
- Skeleton table while loading.
- A **load-error panel** with Retry, shown only when there is an error and no data. A failed background refresh keeps the rows and shows "Couldn't refresh · Retry".
- "No campaigns yet" plus New Campaign (gated and lock-aware).
- "No campaigns match" plus Reset filters.

**Scale.** Filters and sorting always run on the full authorized set. Rows render 100 at a time, with a visible "Showing N of M · Show more". This is not a hidden cap, because the total is always shown.

### 5. Data layer

TanStack Query, with stable identity-scoped keys and explicit per-query options.

**Shared options** (`CAMPAIGNS_TABLE_QUERY_OPTIONS`, pinned by a source-contract test; `App.tsx` stays untouched):
- `staleTime: 30_000`
- `refetchOnWindowFocus: false`
- `retry`: at most once, and never for the list-too-large error

| Key | Query |
|---|---|
| `["campaignsTable","list",orgId,userId]` | **Raw org rows**. The management filter runs at render in a `useMemo` with the current role inputs, so a role change can never paint a wider cached set. Columns are explicit, not `*`: id, name, type, status, description, assigned_agent_ids, tags, user_id, created_by, created_at, organization_id, retry_interval_minutes, retry_interval_hours, max_attempts, calling_hours_start, calling_hours_end, ring_timeout_seconds, plus total_leads and leads_called only if D1-B is chosen. `.eq("organization_id")`, ordered `created_at desc nullsFirst:false` then `id`. **Paging:** the first page requests `count: "exact"`; later pages use the raw rows received as the offset; rows are deduplicated by id; paging stops at the count or on an empty page; filtering happens after paging. This avoids the 1000-row cap and does not depend on `max_rows`. Above 10,000 rows it raises a visible error. `leads_contacted`/`leads_converted` are never read. |
| `["campaignsTable","stats",orgId,userId,idsHash]` | `get_campaign_card_stats` on the **post-filter** visible ids, sent in chunks of 200 and merged. Any failed chunk fails the whole query, so partial maps are never shown. `campaign-card-stats.ts` will throw a typed error and accept a signal. `idsHash` is the length plus a fast hash of the sorted ids, so the key stays small; the full ids are passed to the function through a closure. The placeholder map is reused only if the previous key has the same org and user. While `isPlaceholderData` is true, a missing id renders as Loading. |
| `["campaignsTable","lastDialed",orgId,userId]` | D3 only. `get_campaign_last_dialed()` paged with `.order("campaign_id").range()` and a count, then filtered to visible ids on the client. |
| `["campaignsTable","assignees",orgId,userId,idsHash]` | Leadership viewers only (D5). The ids come from a new leadership-only collector in `model.ts`: Personal owners, Team participants and, for D9, Open Pool `assigned_agent_ids`. The existing `collectAssigneeIds` skips Open Pool, so it is not reused here. `profiles id, first_name, last_name, avatar_url`, explicit `.eq("organization_id")`, `.in("id", ≤100-id chunks)`, with a signal. Rendering is also gated on the **current** viewer being leadership, so cached names are never shown to an Agent after an identity switch. Loading shows avatar skeletons; an error shows count-only. |
| `["campaignsTable","createAgents",orgId,userId]` | Fetched only when the viewer has Create Campaigns. Today's Active-profiles list for the unchanged modal, with an explicit `organization_id` filter and a signal. |
| `["campaignsTable","orgStatus",orgId]` | `organizations.status` via `.abortSignal(signal).maybeSingle()`. It fails open to active, as today. |
| `["campaignsTable","prefs",orgId,userId]` | See §6. |

**Rules for every query:**
- each passes `signal` through `.abortSignal()`, placed before `.maybeSingle()`;
- none runs before organization, user and permissions are known (PageGuard already enforces this; the check is kept as defense in depth);
- after a create or duplicate, rows stay on screen while the background refetch runs.

`Campaigns.tsx` is an identity shell that renders `<CampaignsPageContent key={`${userId}:${orgId}`}>`. Filters, the expanded row, the column draft and pending saves therefore reset during render when the identity changes. There is no realtime subscription, the same as today.

**Sorting and filtering** apply to the full loaded set.
- Sorts:
  - Newest (default, today's order)
  - Oldest
  - Name A–Z / Z–A
  - Status
  - Type
  - Lead progress (percent called)
  - Total leads
  - Converted
  - Contacted
  - Last dialed (D3)
- Unknown values sort last in either direction.
- Ties fall back to `created_at desc`, then `id`.
- While stats are loading, metric sorts keep that fallback order.
- Search and both filters combine.
- **Reset** restores the defaults.

### 6. Column preferences

There is no schema change.

**Storage**
- Path: `user_preferences.settings.campaigns_table = { v: 1, orgs: { [orgId]: { order: string[], hidden: string[] } } }`.
- `user_preferences` holds one row per user (`UNIQUE(user_id)`, RLS `auth.uid() = user_id`) and has no organization column. The organization namespace is therefore enforced by the app inside the JSON.
- RLS makes it impossible to write another user's row.

**Owner and View As**
- The owner is the real `user.id` plus the current `organizationId`.
- Under View As nothing is read or written; the route does not mount under View As anyway.
- Every async completion re-checks the owner/epoch, and an impersonation ref, before it commits.

**Parsing.** A Zod schema parses `campaigns_table`. A pure normalizer then:
- drops unknown and duplicate ids;
- appends newly added columns at their default positions;
- pins locked columns.

**Load**
- Read `settings, updated_at` with `.maybeSingle()`.
- **Never write on load.**
- The Columns editor and Save stay disabled until the read has settled successfully for the current owner.
- If the read fails, the table uses the defaults and the editor shows "Couldn't load saved columns · Retry".

**Editing.** The Columns popover edits a draft that previews live:
- checkboxes show or hide optional columns;
- up/down buttons reorder the reorderable columns;
- Campaign, Actions and the chevron cannot be hidden.

**Save**
1. Re-read the row with `.maybeSingle()`. Abort if the read fails.
2. Merge only `campaigns_table.orgs[orgId]` into the freshly read settings.
3. Run `update({ settings }).eq("user_id", uid)` with `.eq("updated_at", observedString)`, or `.is("updated_at", null)` when it was null, followed by `.select("updated_at")`. The observed timestamp string is passed back exactly as read, never through `Date`.
4. **An empty result means a conflict.** Re-read, re-merge and try once more.
5. If no row exists, `insert`. On a 23505 error, re-read and take the same merge plus compare-and-set path. Never write a merge built on an empty base over an existing row.
6. Check the Supabase error. Close the popover only after success. On failure, keep the draft and show a concise error.

**Reset** removes only this organization's entry, using the same path. **Cancel** discards the draft.

**Limitation (documented, not fixed).** Compare-and-set protects only this page's own saves. Five existing writers do unguarded read-merge-write on the same blob: Contacts, `useContactScope`, ContactManagement, and CalendarSettings (×2). Contacts also writes automatically about 2 seconds after loading a saved sort. If one of their reads fails, or races with another write, the `campaigns_table` key can be erased, and the page falls back to the default columns. Compare-and-set relies on the `set_updated_at` trigger. That trigger is in the baseline, but **live presence is unverified** (preflight R1). Without it the save behaves like the existing writers: still own-row and key-scoped, with no conflict detection. No cross-tab compare-and-set guarantee is claimed.

### 7. Files

**Modified**

| File | Change |
|---|---|
| `src/pages/Campaigns.tsx` | Rewritten as the identity shell, under 200 lines |
| `src/lib/campaign-card-stats.ts` | Throws a typed error, accepts a signal, chunks ids, updated comment. Its only importer is `Campaigns.tsx`. |
| `implementation_plan.md` | This section |
| `WORK_LOG.md` | Completion entry |
| `AGENT_RULES.md` | Invariant #17 only: a one-paragraph amendment on the list's states and D1 rule |

**New components** (`src/components/campaigns/`, each under 200 lines, exporting only components)
- `CampaignsPageContent.tsx`
- `CampaignsHeader.tsx`
- `CampaignsToolbar.tsx`
- `CampaignsTable.tsx`
- `CampaignSortHeader.tsx`
- `CampaignTableRow.tsx`
- `CampaignRowDetails.tsx`
- `CampaignStackedList.tsx`
- `CampaignStackedRow.tsx`
- `CampaignRowActions.tsx`
- `CampaignColumnsMenu.tsx`
- `CampaignBadges.tsx`
- `CampaignLeadProgress.tsx`
- `CampaignMetricValue.tsx`
- `CampaignAgentsCell.tsx`
- `CampaignsListStates.tsx` (skeleton, error, empty, filtered-empty)
- `DuplicateCampaignDialog.tsx`

**New logic.** All non-component exports live in `.ts` files, to satisfy `react-refresh/only-export-components` under `--max-warnings 0`.
- `src/lib/campaigns-table/model.ts`: types, filters, search, sorts, metric-state resolver, duplicate eligibility, leadership predicate.
- `src/lib/campaigns-table/columns.ts`: the column registry.
- `src/lib/campaigns-table/prefs.ts`: Zod schema, normalizer, read/merge/compare-and-set.
- `src/lib/campaigns-table/queries.ts`: paged list, chunked stats wrapper, last dialed, assignee profiles, create-modal agents, org status, query options.
- `src/hooks/useCampaignsTableData.ts`
- `src/hooks/useCampaignsTablePrefs.ts`
- `src/hooks/useCampaignsTableState.ts`
- `src/hooks/useMinWidth.ts`

**New tests.** Radix tests copy the shim block from `notificationsDrawer.test.tsx`.
- `src/lib/__tests__/campaignsTableModel.test.ts`
- `src/lib/__tests__/campaignsTablePrefs.test.ts`
- `src/lib/__tests__/campaignsTableQueries.test.ts`
- `src/lib/__tests__/campaignCardStats.test.ts`
- `src/components/campaigns/__tests__/campaignsTable.test.tsx`
- `src/components/campaigns/__tests__/campaignStackedList.test.tsx`
- `src/components/campaigns/__tests__/campaignColumnsMenu.test.tsx`
- `src/components/campaigns/__tests__/duplicateCampaignDialog.test.tsx`
- `src/pages/__tests__/campaignsPage.test.tsx`, which covers:
  - `renderToString` smoke tests for the seeded, empty and error states, with the QueryClient seeded through `setQueryData`. Server rendering always takes the stacked layout, so a second `renderToString` renders `CampaignsTable` directly with seeded rows.
  - The page-level role, state and identity-switch tests, run twice: once with the default `matchMedia` stub (stacked) and once with `matchMedia` overridden to `matches: true` (desktop table, sort headers and Columns menu).

**Visual harness (D8):** `scripts/tests/campaigns-visual/{README.md,index.html,vite.config.ts,entry.tsx,stubs.ts,verify.mjs}`.
- `stubs.ts` is a recording fake query builder that allows only the tables and RPCs above, plus `role_permissions` (`usePermissions` queries it even for Admin), and serves synthetic fixtures for each persona.
- AuthContext and Branding are stubbed.
- `entry.tsx` wraps the page in QueryClientProvider (retry off) and TooltipProvider, inside a **shell that reproduces the app's 240px sidebar offset and `p-4 lg:p-6` padding**. A collapsed 64px variant is also run.

**Imported unchanged:**
- the helpers in `campaignSelectionModel.ts` (a pure `.ts` module, with no cycle and no react-refresh issue);
- `CampaignAvatarStack`, `filterCampaignsForManagement`, `CreateCampaignModal`, `PermissionGate`;
- the shadcn primitives.

**Not touched:** Dialer, telephony, queue, disposition, RPC, migration, RLS, Edge, `App.tsx`, `Sidebar`, `CampaignDetail`, `CreateCampaignModal`, and `useDialerCampaignPresence` (deliberately not reused).

### 8. Dependencies

- **No new npm packages.**
- The harness uses the environment's global Playwright 1.56.1 via `PLAYWRIGHT_MODULE` and the Chromium already in `/opt/pw-browsers`, following the `reports-visual` pattern. Nothing is downloaded and TLS is never bypassed.
- Tests need dummy `VITE_SUPABASE_*` variables in the shell only, never committed. The timezone is recorded.

### 9. Verification after approval

1. **Type checks.** Run `npx tsc --noEmit` (reported, but it checks nothing) and `npx tsc -p tsconfig.app.json --noEmit`. Compare the second against the 85-error baseline as a line-insensitive multiset. **No new diagnostic is allowed.**
2. **Lint and build.** `npx eslint` on every touched file with `--max-warnings 0`, then `npm run build` and `git diff --check`.
3. **Unit and component tests.**
   - The new suites.
   - The existing suites: `campaignAccessScope`, `campaignSelection*`, `viewAsSurfaces`, `viewAsRouteAllowlist`, `viewAsSidebarNav`, `campaignDetailImportRetry`.
   - Then a full-suite comparison of candidate against base.
4. **Role matrix.**
   - Roles:
     - Agent;
     - Agent with View All Campaigns granted (asserts that visibility matches RLS — assigned Team, Open Pool and own Personal campaigns only — and that the RPC omits no rows);
     - Team Leader with View All on, and with it off;
     - Admin;
     - Super Admin with role "Admin" and `is_super_admin`.
   - For each role, check:
     - visibility;
     - New Campaign gating;
     - Duplicate eligibility (today's rule);
     - lock behavior;
     - the D1 rendering for rows the RPC omits;
     - D5 identity gating, including the switch from a leadership user to an Agent;
     - D9 Open Pool assignees: names for leadership in the expanded row, a count for Agents.
   - The role string "Super Admin" is checked **through PageGuard as the documented pre-existing spinner** (it never mounts today), and its Duplicate eligibility as a pure function only.
5. **States.**
   - Loading shows no zeros.
   - A placeholder map renders new rows as Loading, never as "not available".
   - A stats error shows Retry.
   - A list error never renders as empty; a refetch error keeps the rows.
   - Genuinely empty, and filtered-empty with Reset.
   - Last dialed: Never versus error.
6. **Behavior.**
   - Filters, search and sort combine across the full set, with unknown values last.
   - Incremental rendering shows "Showing N of M".
   - Expansion is one row at a time, has the right ARIA, and never navigates.
   - Open navigates.
   - Create and Duplicate trigger the background refresh; the Duplicate payload is exactly today's.
   - The lock (D4).
7. **Preferences.**
   - No write on load.
   - Editing is disabled until the read settles.
   - Save merges only its key and leaves other keys and other orgs alone.
   - A compare-and-set result of zero rows triggers re-read and retry, and is never treated as success.
   - 23505 goes through re-read, merge and compare-and-set.
   - A failed read blocks the write.
   - Reset and Cancel.
   - Nothing happens under View As.
8. **Identity switches (org and user).** Previous rows, stats, assignees, preferences, drafts and pending saves are never committed or painted. This is asserted by capturing the DOM from a layout effect.
9. **Query safety.**
   - Paging: the count is honored, rows are deduplicated, and the cap error is visible.
   - Stats are chunked and fail as a whole.
   - Profile lookups are chunked.
   - Every query uses the signal.
   - The source-contract test pins the shared query options.
10. **Browser harness**, synthetic data only, no auth bypass, no production.
    - Viewports 1440, 1280, 1024, 768 and 390, inside the real shell offset, with the sidebar expanded and collapsed, in dark and light.
    - Checks: the table container width matches the real content width, no page overflow, the sticky Actions column renders cleanly, no console errors.
    - Screenshots: default table, wide optional columns, expanded row, Columns popover, stacked list, stacked expanded, and the empty, error and loading states. They are sent to Chris.
11. **Scope audit.** The diff touches no telephony, queue, disposition, Dialer, SQL or Edge path, and no new code reads `leads_contacted`/`leads_converted`.
12. **Live authenticated checks** happen on a Vercel preview, after push approval. Chris runs the sign-in smoke test; this environment has no authenticated session.

**R1: read-only backend preflight.** Requested separately; optional but recommended.
- Run `list_migrations`.
- Compare the live definitions of `get_campaign_card_stats` and `get_campaign_last_dialed` with the baseline.
- Confirm the live `user_preferences.set_updated_at` trigger.
- Read the PostgREST `max_rows` setting, if it is exposed.

### 10. Decisions for Chris (recommendation first)

**D1: rows that `get_campaign_card_stats` leaves out**
- Which rows: other agents' Personal campaigns seen by an Admin or Super Admin. This is the only reachable case, because RLS and the RPC read the same JWT role list.
- **The trade-off.** The spec says both "Phase 1 = existing trusted information" and "use the RPC for Total, Called, Contacted, Converted". For these rows, the RPC returns nothing, while the stored `total_leads`/`leads_called` (trigger-maintained and accurate) are what Admins see today.
- **Recommended: D1-B.** For these rows only, once the RPC has settled, Lead progress and Total use the stored `total_leads`/`leads_called`, and Contacted and Converted show "—" ("Not available for this campaign"). This keeps the true numbers Admins have today and never shows invented zeros. It departs from "RPC only" for Total and Called on these rows.
- **Alternative: D1-A.** Show "—" for all four values on these rows. This follows "RPC only" literally, but it is a **regression**: Admins lose accurate Total/Called and Lead progress on every agent-owned Personal campaign.
- Fixing these rows properly needs an approved RPC change in Phase 2.

**D2: Ready Now**
- **Recommended:** defer it to Phase 2, with no column and no placeholder.
- `get_queue_metrics` would need one call per campaign, each O(leads).
- It enforces Dialer scope (`can_dial_campaign`), so it would return 42501 for rows that are visible only through management scope.
- It does not use the Personal-queue definition, and it can overstate (invalid phones).
- A trustworthy column needs a new, approved batched RPC.

**D3: Last dialed**
- **Recommended:** include it as an optional column (off by default) and in the expanded row.
- Source: the existing `get_campaign_last_dialed`, which is already used by the Dialer selection screen. It returns the same org-wide `MAX(calls.created_at)` for every role, and it is labeled "Last dialed", not "activity".
- **Alternative:** omit it.

**D4: agency lock coverage**
- **Recommended:** apply the existing suspended/archived lock to the empty-state New Campaign button and to Duplicate as well. This is frontend-only and only tightens behavior.
- **Alternative:** keep today's header-only coverage.

**D5: Agents identities**
- **Recommended:** follow the Dialer's established ruling.
  - Leadership sees names and initials/avatars. Leadership means role 'Team Leader', 'Admin' or 'Super Admin', or `is_super_admin`; legacy 'Team Lead' is excluded.
  - The Agent role sees an assigned-agent count only.
- The Create modal's Active-profiles list is still fetched, as today, for viewers who have Create Campaigns. That includes an Agent who was granted it.
- **Alternative:** show identities to every role.

**D6: preference storage**
- **Recommended:** the org-namespaced `user_preferences` key with explicit Save (§6). It works across devices; the limitation is documented in §6.
- **Alternative:** localStorage keyed `af:campaigns:table:v1:<org>:<user>`, with try/catch. Nothing can clobber it, but it stays on one device.

**D7: reordering**
- **Recommended:** up/down buttons. This is accessible and matches Reports Phase 2.
- **Alternative:** drag and drop with dnd-kit.

**D8: visual harness**
- **Recommended:** commit `scripts/tests/campaigns-visual/` with no CI workflow.
- **Alternative:** scratchpad only.

**D9: Open Pool assignees**
- Open Pool campaigns store at least one `assigned_agent_ids` at creation, but anyone in the agency can dial them.
- **Recommended:** the Agents cell shows "Open to agency", which matches the Dialer and is accurate about dialing access. For leadership, the expanded row also lists them under "Assigned agents".
- **Alternative:** an avatar stack in the cell as well.

**Q1:** please share the approved visual reference, if there is one.

### 11. Risks and rollback

**Risks**
- With D1-A, Admins lose Total/Called on agents' Personal rows. With D1-B, those rows mix two documented-accurate sources.
- Other writers can erase the saved column key (§6). The page then falls back to the default columns.
- The sticky column and opaque layering need visual checks in both themes. These are covered by the shell-accurate harness.
- Switching the desktop/stacked layout by JavaScript means one tree is mounted. In server rendering and jsdom it falls back to stacked, which the tests account for.

**Rollback**
- Revert the single feature merge commit.
- No schema or data is involved.
- The orphaned `campaigns_table` preference key is ignored by older code.

### 12. Completion deliverables

1. A newest-first `WORK_LOG.md` entry with date and status, changes, the exact files, tests and results, migrations/deploys (none), and blockers.
2. The exact list of files touched, and the verification results, including the multiset type-check comparison.
3. Screenshots sent to Chris for approval.
4. No push, PR, merge or deploy without explicit approval.
5. A closing context snapshot: changes, decisions, migrations/deploys, blockers, next steps.

### 13. Pre-existing findings outside Phase 1 (each needs its own approval)

1. When an Admin duplicates an agent's Personal campaign, the copy is stamped `user_id = Admin` while `assigned_agent_ids` still lists the agent.
2. Duplicate's ownership check uses `created_by` and assignees instead of `user_id`. It excludes the role string "Super Admin" and copies no dialer settings.
3. The detail route has no management check, so a Team Leader can open agents' Personal campaigns by URL. Its status buttons are ungated and can report false success. Delete ignores errors. It reads unmaintained counters.
4. The agency lock has no server enforcement. The detail page, Dialer, inline create and import paths ignore it.
5. `AddToCampaignModal`'s scope filter reads camelCase fields, so its filtering is broken.
6. Profiles whose role string is "Super Admin" never pass `PageGuard` (`DB_ROLE_TO_KEY` has no entry, so permissions never load).
7. `get_campaign_card_stats` and `get_campaign_last_dialed` grant `anon` EXECUTE in the baseline. Hardening was deferred by Chris.
8. The recent-call-guard bullet of `AGENT_RULES` #15 says the queue metrics RPC "has not yet been adjusted", but `20261003043122` now mirrors it.

### 14. As built (2026-10-09)

**Preflight (read-only, production).** The live bodies of `get_campaign_card_stats` and `get_campaign_last_dialed` match the baseline. The `user_preferences` `set_updated_at` trigger exists. `authenticator` preloads `safeupdate`, and every update here filters on `user_id`. No custom `max_rows` is set. Nothing was written.

**Differences from §7, kept lean per approval condition 3:**
- Small single-use components were folded in:
  - `CampaignsHeader` → `CampaignsPageContent`;
  - `CampaignSortHeader` → `CampaignsTable`;
  - `CampaignStackedRow` → `CampaignStackedList`;
  - `CampaignBadges`, `CampaignLeadProgress`, `CampaignMetricValue` and `CampaignAgentsCell` → `CampaignCells.tsx`.
- `useCampaignsTableState` was not needed; filter, sort and expansion state live in `CampaignsPageContent`.
- `CampaignAvatarStack` crushed the initials at this row height, so `CampaignCells` has its own avatar stack.
- `get_campaign_card_stats` is called through the typed client; no `any` cast.
- The harness aliases `usePermissions` instead of stubbing `role_permissions`.
- Added `src/hooks/__tests__/useCampaignsTablePrefs.test.tsx`.

**Fixes from the adversarial review, each covered by a regression test or browser check:**
- Revisits refetch the list (`refetchOnMount: "always"`) and paint the owner's last confirmed column layout from the query cache.
- Last dialed failures show a Retry notice.
- An unsaved Columns draft is discarded below 1280px.
- The Campaign column truncates, so the default columns fit at 1280px without hiding Converted under the sticky Actions column. Optional columns scroll inside the table.
- Stacked progress text wraps instead of running under Open.
- Focus returns after Duplicate, Columns Retry and keyboard reordering.
- The no-org state never sends an unscoped read.

**Visual reference.** The previously approved dark table mockup was not found in the repository, docs or artifacts. The build follows the closest approved precedent, the dark Dialer campaign table. Chris should confirm the result against the mockup he has.

**AGENT_RULES.** Planned as a #17 amendment only. It also gained a short "Campaigns table invariant — October 9, 2026" section, because the `campaigns_table` preference key and its write rules are a new invariant (§9 of AGENT_RULES).

**Verification.** Results are in the newest WORK_LOG entry.

### 15. Branch synchronization with main (2026-10-09)

**Approval.** Chris approved merging the latest `origin/main` into this feature branch, resolving the `WORK_LOG.md` conflict with both branches' entries kept, narrow status and verification updates to this file and `WORK_LOG.md`, local verification, pushing the branch, updating draft PR #433, and the normal non-production Vercel previews and checks. This does not approve merging PR #433 into `main`, promotion, rebasing or force-pushing, application-code changes, or any production, schema, RLS, Edge Function, credential, deployment-setting or workflow change.

**Starting point.**
- Feature head `a593b7dc22673832bb70dd16da000ba29c13e7a2`, as published on PR #433.
- `origin/main` `be2690d8d9621eb047844a4662bb3416427cf4f1`: PR #432 (Google OAuth privacy and terms pages), merged 2026-10-09 20:01 UTC.
- Merge base `8d53531d0edc509cc97fdc49a06c4873438ca67d`.

**Expected manual edits.** Only `WORK_LOG.md`, where both sides prepend entries at the top. `implementation_plan.md` also changed on both sides, but it merges automatically: #432 appends at the end and this branch prepends at the top. No application file changed on both sides. If the merge conflicts anywhere else, stop and report before resolving it.

**Resolution rule.** Use a normal merge commit with no rebase or force-push. Keep every entry from both sides, newest first by the commit time of each entry:
1. Google, publication approved (20:00 UTC).
2. Google, preview checks completed (19:56 UTC).
3. Campaigns, published as draft PR #433 (19:53 UTC).
4. Google, verification website preparation (19:44, extended 19:46 UTC).
5. Campaigns, built and verified locally (16:15 UTC).

Remove only conflict markers and accidental duplicates. Leave entry text untouched, and take every non-conflicting change from `main` exactly as it is, including the Google OAuth implementation.

**Verification on the merged tree.** Updated `main` `be2690d` is the baseline, with identical dependencies, environment and timezone on both sides. Diagnostics and failures are compared by identity, not count. The checks are:
- Root and app TypeScript.
- The ten Campaigns suites.
- The full suite on base and branch under the same placeholder environment and timezone.
- The Reports frontend CI comparison run locally against a `be2690d` worktree.
- ESLint on the changed TS/TSX files.
- `npm run build`.
- `git diff --check`.
- The Campaigns visual verifier.

The diff against updated `main` must still contain only the approved Campaigns redesign. Any new regression blocks publication and goes to Chris before any application-code fix.

**Publication.**
- Push without force and keep PR #433 a draft.
- Report CI only for the exact published head. If workflows don't trigger, report the run evidence; use a permitted dispatch only when it tests that head, otherwise mark exact-head CI BLOCKED.
- For the previews, check READY, preview target and no production domain.
- Treat previews as production-connected until isolation is proven; no authenticated or write checks without a safe, authorized scope.

**Separate.** The `WORKFLOW_INTERNAL_SECRET` exposure in `WORK_LOG.md` history gets read-only triage and its own remediation plan for separate approval. It is not part of this branch.

**Result (2026-10-09).** Merge commit `7fae879` (parents `d76b6ed`, `be2690d`).
- **Conflict:** only `WORK_LOG.md` conflicted, and it was resolved exactly as described above. Removing the Campaigns entries reproduces `main`'s file byte for byte; removing the Google entries reproduces the branch's file.
- **Google OAuth files:** all 12 are identical to `main`. The branch's diff against `be2690d` is the same 39 files and patches as before.
- **Verification on `7fae879`:** every check above passed against a `be2690d` worktree. The 85 app diagnostics and the single failing test (`recordingRetentionVoicemail` v29) are identical by identity on both sides. Details are in the newest WORK_LOG entry; CI and preview evidence for the published head is on PR #433.

**Release (2026-10-09).**
- **CI on head `67d638a`:**
  - Reports frontend verification passed.
  - Dialer DNC integrity passed on attempt 4: PostgreSQL suites, plus 39 files / 498 tests. Attempts 1–3 never ran their tests because the database image couldn't be downloaded from Docker Hub.
  - Reporting integrity passed on attempt 3, run on GitHub's PR merge ref, whose tree is identical to `67d638a`.
  - Vercel passed; Supabase Preview was skipped (no `supabase/` changes).
- **Merge:** PR #433 was squash-merged as `d88982d` on top of `be2690d`. Its tree equals `67d638a`.
- **Production:**
  - `agentflow` `dpl_CqwX4UyW9q7NesqYu2bua3i9EWN1` is READY, aliased to `www.fflagent.com`, `fflagent.com` and `agentflow-eta.vercel.app`.
  - `agentflow-life-insure` `dpl_FqK77YQTfLbGXrqYASaREnLeFXfy` is READY, aliased to `agentflow-life-insure.vercel.app`.
  - Neither has an alias error.
- **No** migrations, data, Edge, permission, telephony or credential changes.
- **Not verified:**
  - Served-asset fetches of the production domains: this environment's egress policy denies them, and the only alternative tool creates an authentication-bypass link.
  - All authenticated hosted checks.

---

## 2026-10-08 UTC — SHIPPED: Super Admin live master Twilio balance

Chris approved the production release sequence. PR #426 merged to `main` as `158601c90e748d901197a103f4b570c367b454cd` after all five fresh-head gates passed: Twilio account balance, Dialer DNC integrity, Reporting integrity, A2P registration, and Reports frontend exact candidate-vs-base verification.

**Backend production:** `twilio-account-balance` Edge Function v1 is ACTIVE on `jncvvsvckxhqgqvkppmj`, `verify_jwt=false`, bundle SHA-256 `1d690adccb1715f8378f65e4e76737098c5b8386ba4f57b513230be45ff68c28`. Deployment readback matched the reviewed `index.ts` and `logic.ts` byte-for-byte. No migration, RLS, schema, production data, subaccount, Dialer/Voice, queue, disposition or telemetry mutation.

**Frontend production:** canonical Vercel project `agentflow` deployment `dpl_8VqL5hF7xWbx3ENh7djDBitBHDtP` is READY at the exact merge SHA and owns `www.fflagent.com` / `fflagent.com`. Secondary project deployment `dpl_FrbskHNduyuezuU85MBvLfWKUFRA` is also READY at the same merge. Vercel runtime-error scan found no errors in the selected post-release window.

**Verification boundary:** management-plane Edge deployment/readback, CI auth/provider/zero/error tests, built-frontend secret scan and Vercel production state are verified. This tool session does not expose a reusable authenticated AgentFlow Super Admin JWT, so it does not claim a live user-authenticated provider-balance response or browser rendering without evidence. No production auth/session credentials were extracted or manufactured to force that check. A real Super Admin opening the Agencies page will naturally invoke the deployed function; subsequent logs/network can confirm the live request.

No new AgentFlow invariant was introduced beyond the existing master-Twilio, Edge JWT, View-As and secret-handling rules.

---

## 2026-10-08 UTC — PRODUCTION EDGE DEPLOYED; frontend release gate in progress

Chris explicitly approved the production release sequence on October 7 PDT / October 8 UTC. Before deployment, production project `jncvvsvckxhqgqvkppmj` was ACTIVE_HEALTHY and had no existing `twilio-account-balance` function. Supabase public deployment/configuration guidance was rechecked; AgentFlow's reviewed `verify_jwt=false` + in-function ES256 bearer validation pattern remains intentional.

**Edge deployment:** deployed the complete reviewed `twilio-account-balance` bundle to production as **v1**, ACTIVE, `verify_jwt=false`, `ezbr_sha256=1d690adccb1715f8378f65e4e76737098c5b8386ba4f57b513230be45ff68c28`. Immediate readback confirms deployed `index.ts` and `logic.ts` are byte-for-byte identical to the review branch. No migration, RLS, database row, Twilio subaccount, Dialer/Voice, or Vercel production change occurred in the Edge deployment.

**Live verification boundary:** management-plane deployment/readback is verified. The current tool session does not expose a reusable authenticated AgentFlow user JWT, so it cannot truthfully claim a live Agent/Admin/Super-Admin invocation or actual provider balance yet without creating/mutating production auth state, which is outside the approved scope. The function's 401/403/master-endpoint/zero/error behavior remains covered by the green dedicated CI. Frontend release should expose the tile to the real Super Admin session, after which production function logs/network can confirm the real call without manufacturing credentials.

**Release gate:** current PR runtime is mergeable, feature/DNC/reporting checks are green. Two repository-wide workflows on the documentation-closeout head reported pre-job failures with zero jobs instantiated; no application test step ran or failed in those two executions. A fresh documentation/deployment record commit intentionally retriggers the PR workflows before merge so the release decision uses current evidence.

---

## 2026-10-07 — APPROVED BUILD: Super Admin live master Twilio balance

Chris approved repository implementation on October 7, 2026. Base/main at start: `1a877532068bf254aace53bdcacde606a4a693a5`; isolated branch: `feature/twilio-account-balance-20261007`. Full `AGENT_RULES.md`, `VISION.md`, and the complete 12,907-line `WORK_LOG.md` were read before runtime edits. Current open-work overlap was checked: PR #419 also changes `supabase/config.toml`; PR #378 and other historical open PRs touch shared documentation. Preserve current branch bytes and make only additive/surgical changes.

**Scope:** add a compact read-only master Twilio balance metric to the existing Super Admin Dashboard. No navigation page, billing management, per-agency allocation, usage graph, low-balance alerts, schema/RLS changes, subaccount changes, or Dialer/Voice behavior.

**Backend:** new `twilio-account-balance` Edge Function using only exact `TWILIO_MASTER_ACCOUNT_SID` + `TWILIO_MASTER_AUTH_TOKEN`. Call `GET https://api.twilio.com/2010-04-01/Accounts/{MASTER_ACCOUNT_SID}/Balance.json` with server-side Basic Auth. Do not use the fallback behavior in `_shared/twilioOutboundCreds.ts`. Validate Bearer JWT with anon-client `auth.getUser(jwt)`, then require BOTH JWT `is_super_admin === true` and server-side `profiles.is_super_admin === true` via `.maybeSingle()`. Return only `balance`, `currency`, `updated_at`; strip `account_sid`, raw Twilio payload, and secret-bearing diagnostics. Genuine zero is valid; malformed/upstream/config failure is unavailable, never fabricated zero. Add `[functions.twilio-account-balance] verify_jwt = false` to config.

**Frontend:** new `TwilioBalanceTile` mounted in `SuperAdminDashboard`, matching existing health tiles. TanStack Query with explicit modest stale time, no polling, no window-focus refresh and minimal/no automatic retry; manual accessible Refresh. Skeleton while loading, prominent amount + subtle currency on success, neutral `Unavailable` on failure. The query/render is disabled while `isImpersonating`; preserve the existing View-As allow-list that already blocks `/super-admin`.

**Files before runtime edits:**
- `implementation_plan.md`
- NEW `supabase/functions/twilio-account-balance/index.ts`
- NEW `supabase/functions/twilio-account-balance/logic.ts` — dependency-injected read-only handler logic so auth/provider behavior is testable without starting an Edge server
- NEW `supabase/functions/twilio-account-balance/logic.test.ts` — focused auth/master-account/zero/error regressions
- `supabase/config.toml`
- NEW `src/components/super-admin/TwilioBalanceTile.tsx`
- NEW `src/components/super-admin/__tests__/TwilioBalanceTile.test.tsx`
- NEW `.github/workflows/twilio-account-balance.yml` — narrow PR verification for the new Deno handler and UI tile
- `src/pages/SuperAdminDashboard.tsx`
- `WORK_LOG.md` after implementation/verification

**Verification:** focused auth/provider/zero/error Edge tests; UI loading/success/zero/unavailable/manual-refresh/View-As tests; Super Admin integration/regressions; `npx tsc --noEmit`; actual app TypeScript baseline comparison if root tsc is vacuous; scoped lint; production build; `git diff --check`; secret-response/frontend-bundle review. No production Edge deploy, Supabase mutation, migration, Vercel production release, merge, or push to `main` is authorized in this build.

**Build verification checkpoint (runtime head `10237284ebaf850e7adc4c815edf39a58f8c3b0f`):** dedicated Twilio balance CI PASSED — 12/12 Deno handler tests, Edge bundle type-check, 7/7 tile tests, scoped lint, root `npx tsc --noEmit`, `git diff --check`, production Vite build, and frontend bundle scan for `TWILIO_MASTER_*` / `SUPABASE_SERVICE_ROLE_KEY`. Existing Dialer/DNC, Reporting integrity, and A2P gates also passed. A2P exact-base app TypeScript comparison reports base=87, candidate=87, new=0. The broader Reports frontend exact-candidate/base workflow remains in progress at this checkpoint; do not misstate it as passed. No production deployment or Supabase mutation occurred.

---

## 2026-10-05 — Reports integrity published for verification; production release pending

Publication is approved and draft PR #418 is open. The reviewed candidate's files/evidence remain intact. The continuation adds a real-browser synthetic Reports gate and corrects premium clipping found in screenshots. See `docs/plans/2026-10-05-reports-integrity/{verification,release_packet}.md` for results and remaining native CI/hosted release gates. Production remains unchanged; Phase 2 and historical repairs remain excluded.

# Reports Phase 1 integrity — approved implementation

Chris approved the six-group audit plan on October 5, 2026. Base: b90e12d3bdcfb188ca0fbc6f25e971aaf77ddbf1. Isolated branch: codex/reports-integrity-phase1-20261005.

Full VISION.md, AGENT_RULES.md and WORK_LOG.md were read before application changes. Current main and open PR overlap checked. No production writes, migration application, historical repair, deployment, merge or main push are authorized. Phase 2 tabs/redesign are deferred.

See [the exact approved implementation plan](docs/plans/2026-10-05-reports-integrity/implementation_plan.md).

---

## 2026-10-05 — Reporting and leaderboard release completed

Chris confirmed the coordinated write window at 09:10 PDT under the October 4 release/permission approvals. PR #416 shipped as `51308ce16fb570ab668b87ab36df2a2b9abda995` after all five exact-head CI gates passed. Eight schema migrations, voice-status v45 and Google inbound sync v492 are applied and byte-verified. Both production frontend deployments are READY with served assets verified.

The approved six identity links and two missing sales are applied and receipt-verified: **eight policies/eight original sale events, $9,373.92 annualized premium**. September now contains four events/$3,205.32; October remains zero. Client details, calls, appointments and original sale facts match their pre-repair hashes; identity gaps and unlinked events are zero. No historical call/booking exclusions were invented. The 277 call and 12 booking candidates remain evidence-dependent; Reports remains a separate build.

Release bookkeeping only: align the eight migration filenames to recorded production versions without changing any SQL; update AGENT_RULES, WORK_LOG, this plan, task plan/progress/release/verification/Reports handoff and inventory; add the production release record and structured evidence. Fixtures resolve migrations by suffix and must still find exactly one file. Verify unchanged bytes, fixture generation, root/app TypeScript and whitespace before publication. No new runtime behavior or production data operation is part of this bookkeeping.

See [production-release.md](docs/plans/2026-10-04-leaderboard-accuracy/production-release.md) for exact versions, deployments, checks and recovery. Authenticated database-role readbacks passed. Secure hosted sign-in failed to fetch, so no authenticated production browser walkthrough or HTTP-origin latency claim is made. Agents were told to refresh and resume after final repair verification. Earlier statuses below are historical checkpoints.

## 2026-10-05 — Reporting release gate follow-up

PR #416 is published at `3edb2817`; native PostgreSQL 17.6 concurrency/security/index/reconciliation, DNC and A2P gates passed. Full frontend and real-browser checks exposed a missing permission fixture and TV table clipping. Correct the fixture, allow genuinely resolved baseline failures while rejecting all new failure identities/multiplicities, and size TV rows from actual header/content height. Keep geometry and data assertions. Thirty focused tests and root TypeScript/scoped lint pass; rerun all exact-head remote gates and inspect browser artifacts. The detailed results are in the task verification record. Production remains unchanged; the approved release still requires fresh drift/active-call checks and coordinated client refresh. Do not guess historical call/booking corrections.

## 2026-10-04 05:46 PDT — Reporting release and exact permission amendment approved

Chris approved the reporting release packet at 05:35 PDT, then explicitly approved the trusted Dialer permission correction at 05:46 PDT after the live ACL mismatch was disclosed. Migration 8 now verifies the exact actual ACL and revokes only anonymous/public execution; authenticated/service/owner grants remain. The fixture starts with the real baseline, and all 29 embedded policy/performance/repair steps pass, including anonymous denial and authenticated/Admin self-scope. No production mutation yet. Continue through native/browser/full-CI gates and recheck active calls immediately before any approved backend work. Reports-owned source remains outside this build.

Release verification additionally updates `scripts/verify_reports_frontend.py` to compare TypeScript file/code/message multiplicities without line-number churn and to allow resolved diagnostics; new diagnostics and new test/runtime failures remain prohibited. The existing AppointmentModal prefer-const lint error is corrected with no behavior change. Publication/release approval supersedes earlier isolated-only holds below; historical call/booking candidates remain unresolved.

## Reporting and leaderboard integrity — implemented in isolation, October 4, 2026

Chris approved the full correction plan at 22:41 PDT October 3 and asked to continue. Branch `codex/leaderboard-accuracy-audit-20261004`, base `436d9d840732bca1262559597c17e5ef09893fbf`. The task plan and exact release boundaries are in [the reporting release packet](docs/plans/2026-10-04-leaderboard-accuracy/release_packet.md); [verification](docs/plans/2026-10-04-leaderboard-accuracy/verification.md) records executed checks and limits.

Implemented one original sale per new primary/additional policy, stable identities/receipts, first/additional/historical entry, secured shared performance readers, agency timezone/as-of metadata, correct cents/seconds/ratio/CSV, atomic booking+disposition replay, stable call attempts and provider duration provenance. Preserved canonical DNC/conversion bodies and existing public-table RLS. Google provider event races are guarded. Reports application/RPC source is reserved for the other build.

Eight CLI-generated forward migrations are **unapplied**. Six historical identity links and the exact two-sale repair/reversal are quarantined outside automatic migrations. Disposable repair result: **8 events and $9,373.92 annual premium**, with no October increase. The immutable call/booking anomaly manifest remains unresolved pending provider/intent evidence; no historical mapping or duration correction is invented.

**Verified:** 521 passing frontend tests in 27 changed/new files (2 existing skips), both embedded database suites, read-only reconciliation query, production and isolated visual-fixture builds. App TypeScript has 87 baseline diagnostics versus 88 on main, no additions; scoped lint has no new errors. **Remaining gates:** independent-session PostgreSQL (local account-switch denied), real browser (Chromium certificate download error), full exact-head remote CI and production release checks. Neither browser nor production accuracy is claimed from component tests.

No public push/PR/merge, production mutation, Edge/frontend deployment, provider request or customer communication. Separate concrete release authorization is still required; the packet documents mixed-client rollout constraints and compatible recovery. Existing task histories below are preserved.

---

## Contact history soft pill with info — selected October 3, 2026

Chris selected option 2 of the final soft-pill previews at 20:32 PDT. Implement the whole communication row as one content-width soft pill, with inbound left/outbound right, plain inline outcome, compact time and an info button. All call metadata, historical agent attribution, duration, campaign, notes and existing recording/voicemail controls remain in a floating popover; email keeps full subject/body/endpoints/delivery details there. SMS and Activity retain their current presentation. The existing three-column Contact layout, readers, pagination, persisted refresh, conversion lineage and multi-tenant/View-As gates remain unchanged.

**Base / scope:** current main `f1a86fc9`, including the shipped Contact field and leaderboard work; no open overlapping history PR. Exact files announced before edits: `CallHistoryItem.tsx`, `EmailHistoryItem.tsx`, new `CommunicationHistoryPill.tsx` under `src/components/contacts/conversation-history/`; existing `fullScreenContactViewConversation.test.tsx`, `conversationDispositionColors.test.tsx` and new `communicationHistoryPill.test.tsx` under `src/components/contacts/__tests__/`; this plan and WORK_LOG.md. Eight files total. All are presentation/tests/documentation only; none changes production data or telephony. No migration, backfill, new dependency, source query or writer is needed.

**Implementation:** reuse the installed Radix popover with collision handling, a viewport-bounded scrollable content area, labeled trigger/content, explicit close, Escape/outside dismissal and focus restoration. Mount media only while open and unmount immediately on dismissal/contact switch. Default row keeps the exact stored meaningful outcome (including missed/forwarded labels); long values use ellipsis with full text in accessible/title details. Keep agency-configured disposition text colors using the existing dynamic color treatment, with Tailwind removing the old nested badge fill. The pill's displayed clock respects the existing time preference; full date/time remains on its timestamp tooltip and in details. Date, duration and agent are never invented. Email's persisted subject/body stay in the popover, and its status is shown in the pill.

**Validation:** focused history integration/data/pagination/refresh and Contact-entrypoint regressions; new real-Radix tests for trigger/Escape/outside close, focus return, full hidden data and media cleanup; `npx tsc --noEmit`, actual-app diagnostic comparison against exact main, scoped lint and Vite build; full frontend/DNC CI on the review head. Review the shared component for local-only state, stable keys, no new fetches and keyboard/touch affordances. Verify hosted appearance where authenticated browser access allows; never claim a signed-in check or audio playback without evidence.

**Local verification complete:** 116 passing focused tests across the completed selection (3 existing skipped); seven real-Radix lifecycle/content tests pass. Root tsc, scoped lint and Vite build pass. The application typecheck exactly matches main's 88 existing diagnostics. Full frontend/DNC CI and deployment checks remain release gates. Browser is signed out; no authenticated hosted or audio verification is claimed. Final commit/check/deployment evidence will be recorded on the PR.

**Release approved:** Chris explicitly approved public publication to `cgarness/agentflow-life-insure` and production deployment on October 3 PDT / October 4 UTC. This resolves the prior automatic-review publication block. Complete exact-head CI, PR merge and production verification; no backend change is required or authorized by this UI-only task.

**Boundaries / rollback:** continue the selected design through tested PR merge and production deployment under this explicit approval. Do not replay already-applied history migrations. Rollback is a frontend-only revert preserving subsequent main work. Out of scope: Contact redesign, Activity/SMS changes, data repair, callbacks/tasks/campaign writers, RLS, telephony/duration/locks/routing/dispositions/DNC/reminders and production business mutations.

---

> Current approved leaderboard data/TV work: [task plan](docs/plans/2026-10-03-leaderboard-data-tv/implementation_plan.md). Isolated implementation approved; production actions held. Existing plans below are preserved.

## Compact Contact history refinement — SHIPPED October 3 PDT / October 4 UTC, 2026 (PR #409)

**Release completed:** Chris explicitly requested “Complete the task to live production,” superseding the historical review-only holds below. PR #409 merged as `9112c8f1404f50289a53ce5806324ca50a9acfe5` from tested head `58993c487b7258329a0aeffd1f86b2652d3aa870`; both trees are `6b7ec06f1a995ce5e101f69585fce494f627f866`. Current main's #410/#411 field projection is preserved. The exact 11-file feature manifest below is unchanged; this closeout edits only implementation_plan.md and WORK_LOG.md, with no application or production-data behavior change.

**Checks:** 129 focused tests in 11 suites pass. Frontend CI `37164268636` passes against exact base `3ccbfb0b`: 4,091 passing tests on both sides, identical existing failure set (one failed assertion, 11 failed files including setup-dependent suites), 88 unchanged app diagnostics, zero unhandled errors. Root tsc, scoped lint, Reports tests, build and whitespace checks pass. DNC CI `37164268631` passes. Both previews READY before merge; no check was weakened.

**Live deployment evidence:** primary `dpl_FwUE1A36pXbQ4QcdZrheUCU7zJHj` and secondary `dpl_F1kU1MUDnm22GDBSN6GguyJCN84T` READY at `9112c8f1`, production target, no alias errors. www.fflagent.com / fflagent.com route to primary; agentflow-life-insure.vercel.app to secondary. Both public HTML/assets return 200; primary `index-DhW4Hs2r.js`, secondary `index-DpgyAOXk.js` contain the final compact disclosures, outbound layout, attribution wrapping and voicemail expansion. Both projects' one-hour Vercel runtime scans report no errors; static hosting logs do not certify client-side runtime health.

**Verification limits:** the production browser is signed out. Earlier authenticated preview checked call direction and complete call/voicemail/Activity expansion. Final responsive wrapping and email direction pass automated tests but have no final authenticated hosted visual walkthrough. No live audio, customer call/message or production-record mutation was used as a test. Auto-review rejected an optional protected-preview asset fetch because it creates a temporary authentication-bypass link; no bypass was performed or retried. Ordinary public production HTTP checks succeeded without bypass.

**Release boundary / recovery:** no new migration, backfill, query/writer, RLS, Edge, telephony/DNC/routing/locking/ownership/duration/reminder change. Do not replay either applied #407 history migration. Revert only the #409 frontend changes if needed, preserving subsequent main work; no database rollback is required. Existing tabs should refresh after active calls finish. The remaining text records the original design and approval checkpoints, not an outstanding production hold.

**17:06 PDT continuation:** refresh PR #409 with main `3ccbfb0b` after the separately approved Contact field release (#410/#411). Preserve that field projection unchanged. Only this plan and WORK_LOG.md receive new authored notes; the original 11-file feature delta remains unchanged. Previous head `2ce88024` passed final frontend/DNC gates. Re-run current-base verification and complete hosted visual review; record final evidence on PR #409. “Continue” does not authorize merging this refinement or releasing it to production.

Chris requested a simpler, space-saving history: one “Show details” expansion for everything, outbound icons on the right and inbound icons on the left, including email. This is a presentation-only refinement of shipped PR #407, based on main `c8b3a682`. Preserve the three-column Contact page, tabs, all stored data, existing reader/pagination/refresh behavior and SMS bubble direction.

### Design and exact file manifest

The manifest was presented before editing. No file below changes production data, telephony, ownership, RLS, schema, source writers or conversion behavior. No new files or migrations; no backfill.

| File | Reason and behavior change |
|---|---|
| `src/components/contacts/conversation-history/CallHistoryItem.tsx` | Compact summary retaining direction, agent, date, duration and outcome/disposition; wraps to a third line in narrow columns to preserve readable attribution. Icon follows direction. One disclosure reveals every existing metadata row, recording and voicemail; playback contracts unchanged. |
| `src/components/contacts/conversation-history/EmailHistoryItem.tsx` | Compact direction/date/subject summary and directional icon. One disclosure reveals full subject, complete body and all endpoint/delivery metadata. |
| `src/components/contacts/conversation-history/CommunicationDetails.tsx` | Explicit Show/Hide details labels and narrow-column wrapping, preserving keyboard/ARIA controls. |
| `src/components/contacts/conversation-history/ConversationTimeline.tsx` | Reduce inter-card spacing only. |
| `src/components/contacts/activity/ContactActivityItem.tsx` | Keep event, actor and time visible; expand complete change/assignee details with one disclosure. |
| `src/components/contacts/activity/ContactActivityTimeline.tsx` | Reduce padding and event spacing; preserve completeness/error/legacy disclosures and controls. |
| `src/components/contacts/__tests__/fullScreenContactViewConversation.test.tsx` | Update existing integration coverage for unified email/call expansion and playback lifecycle. |
| `src/components/contacts/__tests__/conversationDispositionColors.test.tsx` | Preserve agency colors, neutral cards and recording assertions under unified expansion. |
| `src/components/contacts/__tests__/contactActivityTimeline.test.tsx` | Verify collapsed actor and expanded assignee/change content, keeping legacy/retry/pagination coverage. |
| `implementation_plan.md` | Record authorized refinement, validation and release boundary. |
| `WORK_LOG.md` | Newest-first implementation evidence and remaining release status. |

### Verification and tradeoffs

Run focused Contact conversation/Activity and history attribution/refresh/pagination regression tests, root `npx tsc --noEmit`, app-type baseline comparison, scoped lint and Vite build. Review responsive hosted UI where browser access allows. Full call outcome and agent strings remain in Details; long summaries use ellipsis/title to keep cards compact. Media mounts only when Details opens, and collapses stop/unmount playback. Email retains quoted-line dimming and an internally scrollable full-body region. No extra data request or event is introduced by the new disclosure state.

Rollback is a frontend-only revert of this refinement; the already-applied Contact history migrations remain installed. Out of scope: source data changes, backfill, Contact field/layout cleanup, communications sending, dialing, DNC, routing, status processing, locks, ownership, reminders, automation, schema/RLS and production release. Build/review preparation is authorized; this revision needs Chris's exact merge/production-release approval. Validation results follow in the Work Log. Hosted inspection at a 1364-pixel viewport exposed cramped agent names; metadata now wraps as a group in narrow columns, keeping the agent readable without changing the page layout. PR #409 is review-only; final preview/CI evidence is recorded in its description.

---

## Contact history release — SHIPPED October 3, 2026 (PR #407)

Chris approved implementation with “Start the build,” then review publication with “Continue” / “finish the task,” and the staged production release at 12:26 PDT. [PR #407](https://github.com/cgarness/agentflow-life-insure/pull/407) is merged as `6c1f3174a15258c2f77c375204f687f15d20db34`, preserving prior main `84829dfe`. Migrations `20261003192857` and `20261003192907` are applied and catalog-verified with unchanged reviewed SQL. Both Vercel production targets are READY; production HTML/assets return 200 and contain the history readers. Final-head PostgreSQL, DNC and frontend comparison gates pass. Authenticated preview checks passed for stored attribution/details, Activity baselines, loading earlier records and refresh. Browser-service timeouts prevented the final voicemail visual check; no live media, customer communication or conversion mutation was tested. The dedicated specification, file list, deployment evidence, remaining verification limits and rollback are in [the Contact history plan](docs/plans/2026-10-03-contact-history/implementation_plan.md). No backfill or synthetic production business data was created.

Full-suite correction: the deep-link regression fixture now asserts persisted-history refresh instead of the retired browser activity insert. Final scope: 43 files; no runtime or CI-gate change in that correction. See PR #407 for final check results.

---

> Current Dialer/DNC task: [approved permanent disposition and DNC integrity plan](docs/plans/2026-10-02-dialer-dnc-integrity/implementation_plan.md). Branch implementation and testing approved; production actions and historical repair held. The unrelated leaderboard plan below is preserved.

# Implementation Plan — Leaderboard recovery: frontend request discipline + truthful maintenance/stale states (rev 1.3 — rev 1.1 APPROVED 2026-09-25; rev 1.2 = Chris's corrections, §13; rev 1.3 = two approved corrections, §14)

> **REV 1.3 (2026-09-26, APPROVED by Chris):** two frontend corrections, recorded in **§14** with the exact files before any
> edit. Chris explicitly approves a **narrow exception to edit `src/lib/dashboard-callbacks.ts` for request-lifetime handling
> only**. Its data sources, ownership rules, ordering, pagination, exact totals and contact-resolution behaviour are preserved.
> No further approval is needed for these two corrections. Still frontend only: no merge, push to `main`, deploy, backend
> change, lifting of the production pause, or change to PRs #382/#383.
>
> **REV 1.2 (2026-09-25, Chris, within the approved recovery scope):** three corrections — coordinated, non-overlapping
> Dashboard refresh; visibility/connectivity re-checked before every dispatch (including post-standings Recent Wins and
> queued work, and an offline mount); same-selection data kept on a failed refresh with a clear section-level
> failure/stale indication. Recorded in **§13** with the exact files, before any edit. Still frontend only.

> **APPROVAL (2026-09-25, in session):** Chris approved rev 1 **as written**, with D-12 = stay on Group with a truthful
> error, D-2 = remove the `calls` + `appointments` bindings, and **D-7 changed to "Every Dashboard widget"** (§4.9 and
> §5 updated below as rev 1.1). Every other decision follows its §6 recommendation. Scope remains frontend only.
>
> **STATUS (rev 1, 2026-09-25): PLAN ONLY at the time of approval. No application file had been edited and no backend command had run.**
> - Scope is **frontend only**: standings + Recent Wins request discipline, truthful maintenance/stale states on the
>   Leaderboard page, TV mode and the Dashboard widget, and replacing the Dashboard's automatic refresh with one bounded
>   manual Refresh control.
> - **The production leaderboard pause stays active.** Migration `20260923224254 emergency_pause_org_leaderboard_20260923`
>   is not replayed, rolled back or edited. No migration, RPC, RLS, grant, Edge Function, Supabase MCP call, production
>   read or write, Vercel action, merge or push to `main` is part of this plan.
> - **Needs Chris's explicit approval** of this plan (and of decisions D-1 … D-12 in §6) before any `src/` edit.
> - The draft design was reviewed before approval by four independent reviewers (concurrency, React lifecycle, truthful
>   UX, scope/safety); every confirmed finding is folded in below (§11).
>
> **Repository:** `cgarness/agentflow-life-insure` · branch `claude/agentflow-leaderboard-recovery-uney6j`
> · base `main` @ **`62684da`** (2026-09-24 20:56 PT). The previous plan (Team / Open Pool lead details, rev 1–7 and §11)
> is preserved in git history at **`62684da`**; the one before it (Dashboard Leaderboard widget) at `f78140d`.

---

## §0. TL;DR

The organization leaderboard was paused in production on 2026-09-23 (live-only migration `20260923224254`) because
leaderboard traffic was slowing the whole app. The pause makes `get_org_leaderboard_stats` fail fast with a marked
`PT503` error ("Standings temporarily paused"). The browser code that caused the amplification is still on `main`:

- the Leaderboard page / TV mode polls the standings RPC **and** the Recent Wins feed **every 4 seconds**;
- every `calls` / `appointments` / `wins` realtime INSERT triggers another standings refresh ~0.5–1 s later, **even in
  hidden tabs**;
- nothing stops overlapping requests, so slow responses pile up; nothing backs off after errors, so the `PT503` is
  requested every 4 s by every open tab;
- the Dashboard re-runs its 9 stat-card queries every 2 minutes in every tab, visible or not.

The UI also misreports the outage: the page says "Check your connection", a failed or still-loading Recent Wins read
shows "No wins yet", TV mode shows zero totals and an empty podium under "LIVE", and the Dashboard widget says only
"Couldn't load standings".

This plan adds one small, tested request gate and routes every standings and Recent Wins read through it:
**one request in flight at a time, identical requests shared, a 30-second poll that only runs in a visible, online tab,
spacing that stretches when the database is slow, exponential backoff, and a 5-minute hold on `PT503`.** Each surface
then says exactly what is true — paused for maintenance, busy, failed, loading, or "showing results from 3:42 PM" —
and never shows another period's, view's or viewer's numbers under the current selection. The Dashboard loses its
automatic refresh and gains one Refresh button that cannot be spammed.

Canonical metrics, ranking, period bounds, tenant isolation and network-free metric switching are unchanged.

---

## §1. Inputs, conflicting work, and what was NOT received

### 1.1 Read before planning
- `AGENT_RULES.md` (v5.0.0) — §3 multi-tenancy, invariant **#23** (leaderboard RPC contract and frontend contract),
  #25 (applied migrations immutable), #28 (production read-only by default), §7 component standards (< 200 lines,
  Zod, Tailwind only), §8 workflow protocol, §9 doc update rule, §10 forbidden patterns.
- `VISION.md` — Agency Groups share leaderboard-visible metrics only; Telemetry / Speed / UI-quality principles.
- `WORK_LOG.md` — newest entries (2026-09-24 Team/Open lead details; 2026-09-23 Dashboard widget D-6 and
  simplification). The root log has **no entry** for the leaderboard containment; it lives only on unmerged branches.

### 1.2 Conflicting / related work (checked 2026-09-25 against `origin`)
| Item | State | Relation to this plan |
|---|---|---|
| PR **#382** `hotfix/leaderboard-emergency-containment-20260923` (`0057ad6`) | **open draft** | Records the applied pause migration, its guarded rollback and the incident note. **Not touched**; its migration file is not added here. |
| PR **#383** `fix/leaderboard-resilience-20260923` (`6fac3e5`, 13 commits, CI green) | **open draft** | Includes #382 plus a frontend request gate, changes to `useLeaderboardData.ts` / `LeaderboardWidget.tsx` / their tests, a CI workflow, and **backend** guard/re-pause SQL (`supabase/ops/*`). **Overlaps this plan's frontend files; both cannot merge.** This branch starts fresh from `main` as instructed and supersedes #383's *frontend* only (D-10). #383's backend SQL is out of scope. **No change is made to #383.** |
| PR **#381** `claude/docs-leaderboard-merge-closeout` | open, docs only | WORK_LOG closeout; no application conflict (ordinary `WORK_LOG.md` merge). |
| `bugfix/leaderboard-metric-switch-rerank` (`99b2a0f`) | stale (Aug 5) | Superseded by `main`'s current `changeMetric`. |

Facts taken from #382/#383 (read-only; not re-verified against production — no production access is planned):
- The pause inserts, after the existing `auth.uid()` null check:
  `RAISE SQLSTATE 'PT503' USING MESSAGE = 'Standings temporarily paused', HINT = 'Leaderboard maintenance is in progress. Avoid repeated retries.'`
  PostgREST turns `PTxyz` into HTTP `xyz`, so supabase-js returns
  `{ data: null, error: { code: "PT503", message: "Standings temporarily paused", hint: "…", details: null }, status: 503 }`.
  `@supabase/postgrest-js` 2.98 (this lockfile) does **not** auto-retry and reports an abort as `code: ""` (checked in
  `node_modules`).
- Only `get_org_leaderboard_stats` is paused. `get_agency_group_leaderboard` and the direct `wins` / `clients` reads are not.
- A future server guard (PR #383, not approved, not applied) would answer `PT429` "Standings are busy".
- #383 recorded a bounded read-only production EXPLAIN of the month aggregate at **48 ms** on the existing
  `idx_calls_org_created_at` — the aggregate is cheap when it is not stampeded.

### 1.3 "The attached plan"
The request referred to an attached plan. **No attachment reached this session.** This plan was built from the
request text, the repository and the #382/#383 incident documents. If the attached plan differs, send it and this
plan will be revised before any code is written.

---

## §2. Current behaviour on `main` (evidence)

| # | Where | What happens | Why it matters |
|---|---|---|---|
| E1 | `src/hooks/useLeaderboardData.ts:553-554` | `setInterval(pollRefresh, Number(VITE_LEADERBOARD_POLL_MS \|\| 4000))` — standings RPC **and** wins feed every 4 s per visible tab. | ~15 standings + ~15 wins/clients reads per minute per tab. |
| E2 | `useLeaderboardData.ts:492-501, 531-546` | Realtime INSERTs on `calls`, `appointments`, `wins` schedule a standings refresh after 550–1050 ms, with no visibility check. | An Admin tab (sees every org call) refreshes on nearly every call, **hidden tabs included**. `appointments` is not in the realtime publication (#23), so that subscription never fires. |
| E3 | `useLeaderboardData.ts:419-428` | Every trigger starts a new RPC; `fetchGenerationRef` only discards stale *results*. | Slow responses overlap and pile up (incident: 20 s mean / 44 s max leaderboard latency). |
| E4 | `useLeaderboardData.ts:395-403` | Failure sets `loadError`; polling continues at 4 s. | `PT503` re-requested every 4 s by every tab. |
| E5 | `useLeaderboardData.ts:434-467` | Wins feed: no error handling (`data` null ⇒ `[]`), no generation/scope guard, fetched in parallel at mount. | A failed or still-pending read shows **"No wins yet. Get dialing…"**; a late org response can land under "Group Recent Wins". |
| E6 | `useLeaderboardData.ts:73-117, 376-417`; `LeaderboardWidget.tsx:98-112` | A period / view switch keeps the old rows; only the error string changes on failure. | A failed switch shows Today's rows under "This Week" (CSV and TV totals included); the widget shows Group rows under "My Agency". |
| E7 | `useLeaderboardData.ts:315-319`; `LeaderboardWidget.tsx:98-103` | Any group failure silently switches to the org view. | During the pause the group RPC is the only working source; the fallback sends users to the paused one. |
| E8 | `leaderboardPremium.ts:14-24, 52-64`; `useLeaderboardData.ts:353-367` | Group premium / 7-day-wins sub-reads ignore their errors (`data \|\| []`). | Renders "$0" / "0" as live values. |
| E9 | `LeaderboardErrorBanner.tsx:36-41` | "Standings are unavailable right now. Check your connection and try again." Retry unbounded. | Wrong during maintenance. |
| E10 | `TVMode.tsx:110-123, 366-372, 473-477, 649-652, 752-758` | TV gets no status. With nothing loaded: empty podium, **zero** agency totals, "Live Feed", "Live Ranking", "LIVE NEWS FEED · No wins yet — get dialing!". | Presents an outage as a live zero board. |
| E11 | `LeaderboardWidget.tsx:31-152, 173-185` | Generic "Couldn't load standings"; Retry unbounded; skeleton replaces the snapshot on every run. | No maintenance message; Retry spam reaches the RPC. |
| E12 | `useDashboardStats.ts:146-198` | `setInterval(fetchStats, 120000)`; per-query `error`s ignored (`count ?? 0`); no stale-response guard. | The Dashboard's only automatic refresh; a failed refresh writes zeros. |

Unchanged-and-correct today (preserved): canonical RPC-only org standings (#23); `changeMetric` re-ranks cached rows
with **zero** network; newest-only commits; last snapshot behind a stale banner; deterministic tie-break; CSV / podium
/ TV entry; Dashboard widget D-1…D-6 presentation.

---

## §3. Scope

**In scope (the five requested items):**
1. Serialize and coalesce standings and Recent Wins requests.
2. Controlled polling, hidden-tab (and offline) suppression, error backoff, maintenance handling.
3. Preserve scope isolation, stale-response protection and network-free metric switching.
4. Truthful maintenance/stale states on the Leaderboard page, the Dashboard widget and TV mode (plus Recent Wins).
5. Remove the Dashboard's automatic refresh; add one bounded manual Refresh control.

**Out of scope:** any backend change (#383 guard SQL, index work, un-pausing); `get_agency_group_leaderboard`'s known
metric differences (#23 follow-up); `AgentScorecardModal` (not mounted anywhere); other Dashboard widgets' data logic;
the stat cards' pre-existing zeros on a *first-load* failure; telephony/dialer; dependency or config changes; merging;
deploying.

---

## §4. Design

### 4.1 `src/lib/leaderboardRequestGate.ts` (new, pure TypeScript, no React)

**Failure classification:** `PT503` → `maintenance`; `PT429` → `busy`; the gate's own 25 s timer → `timeout`;
anything else (network `status 0`, `42501`, 4xx/5xx, empty response, a thrown sub-read) → `error`. Raw database
messages are never shown.

**Backoff (D-3):** `maintenance` fixed **5 min** ± 10 % (the server hint says "Avoid repeated retries"); `busy` 15 s
doubling to 2 min; `error` / `timeout` 30 s doubling to 5 min; ± 20 % jitter so many tabs don't retry together.

**Poll interval (D-1):** default **30 s**; `VITE_LEADERBOARD_POLL_MS` accepted only within 30 s – 5 min; the legacy 4 s
value or anything invalid falls back to 30 s.

**The gate** — one per viewer `${authUserId}:${organizationId}` (D-5), from a small module registry
(`getLeaderboardRequestGate(identity)`). It stores **only scheduling metadata** (in-flight request, queue, per-endpoint
failures / cooldown / last start / last response time) — **never standings or wins rows** — so nothing can cross users
or organizations. Only idle gates are evicted (at most 4 kept); `resetLeaderboardRequestGates()` aborts and settles
everything (tests).

`gate.run({ endpoint, channel, key, mode, owner, notBefore?, load })`:
- `endpoint`: `org_standings` | `group_standings` | `wins` — cooldowns are per endpoint, so the unpaused Group RPC and
  the wins feed are never blocked by the org pause;
- `channel`: `standings` | `wins`;
- `key`: **consumer + endpoint + view + group id + period + period START** — never the moving `p_end = now`, so
  identical work really coalesces, and the page and the Dashboard widget never share a result;
- `mode`: `initial` (mount / filter change) · `auto` (poll, realtime, visible/online again, retry timer) · `manual`
  (Retry, Dashboard Refresh);
- `owner`: the calling hook/component; `gate.release(owner)` on unmount or identity change drops that owner's
  not-yet-started work **with no network call**;
- `notBefore`: the realtime win path never joins a wins read that started before the INSERT arrived;
- `load(signal)`: performs the reads with `.abortSignal(signal)` and returns rows or an error.

Rules:
1. **Serialize:** at most **one request in flight per gate**, across all endpoints. A filter change therefore waits for
   the in-flight request (typically ~50 ms; never more than the 25 s timeout) under the existing refresh spinner,
   instead of stacking a second aggregate on a slow database.
2. **Coalesce:** a request whose key matches the in-flight or the queued request joins it; a queued entry takes the
   strongest mode of its joiners (manual > initial > auto).
3. **Bounded queue:** at most one queued request per channel; a newer one replaces the older, which resolves
   `superseded` without touching the network. Order: standings before wins.
4. **Cooldown, checked twice:** after a failure the endpoint is blocked until `now + delay`. `initial` / `auto` runs are
   refused during a cooldown **when requested and again right before a queued run starts** — an in-flight `PT503`
   plus a queued period switch is exactly one RPC. A success clears the failure count.
5. **Automatic spacing:** an `auto` run starts no sooner than 15 s after the endpoint's last start of **any** mode and
   no sooner than `max(15 s, 2 × last response time)` after the last response — a 20 s response pushes the next
   automatic request to 40 s after it returned.
6. **Manual (D-4):** accepted no sooner than 30 s after the endpoint's last request started **and** 15 s after it
   returned (so a click can never overlap a timed-out query that may still be running on the server). It may bypass an
   `error` / `timeout` backoff (a person asked), but **never a `maintenance` or `busy` hold** — the server's hints say
   "Avoid repeated retries" / "Retry after the client cooldown"; during those holds the UI shows the next automatic
   check instead of an active Retry.
7. **Timeout:** the gate races `load()` against its own 25 s timer and aborts; the lane is freed at 25 s even if a
   sub-read never settles, and the result is classified from the gate's flag, not the error shape.
8. **Results:** `ok` · `failed {kind, retryAt}` · `blocked {reason: "cooldown", kind, retryAt}` ·
   `blocked {reason: "throttled", availableAt}` · `superseded`.

(A prototype of this module and 12 unit tests already pass in the session scratchpad; it is not in the repository.)

### 4.2 Result → state rules (hook and widget)

| Result | Loading flags | Status / `loadError` | Snapshot on screen |
|---|---|---|---|
| `ok` (newest generation, current scope) | settled | `ok`, `lastUpdatedAt = now`; retry timer cancelled | replaced, **tagged with its scope** |
| `failed` | settled | kind + next check; `loadError` set | kept **only if its scope tag equals the current scope**; otherwise cleared → no-snapshot panel |
| `blocked: cooldown` | settled | same as `failed` (e.g. remount during the pause → maintenance panel, **0 requests**) | same as `failed` |
| `blocked: throttled` | settled | unchanged; the Retry control shows when it re-enables | unchanged |
| `superseded` | settled only if still the newest generation | unchanged | unchanged |

"No agents on the board" / "No sales data yet" / "No wins yet" appear **only** after a successful read for the current
scope returned nothing.

**Group view (D-12):** a group failure no longer silently switches to "My Agency" (which during the pause is the
paused endpoint). The view stays on Group and shows the group's truthful error/stale state with Retry; the user can
switch to My Agency themselves. Group sub-reads (premium, 7-day wins) that fail now fail the group load instead of
rendering "$0" / "0".

### 4.3 `useLeaderboardData` (Leaderboard page and TV mode share one instance)

- **Identity & isolation:** `identityKey = ${user.id}:${profile.organization_id}` — the real auth user (what the RPC
  checks as `auth.uid()`) plus the effective organization. View As keeps the real `user` and is forced into the same
  organization, so it does not reset. On an identity change (in a layout effect, before paint) the hook synchronously
  clears `agentsRef` and resets agents, wins, `loadError`, both statuses, `initialLoading = true`,
  `filterRefreshing`, `hasLoadedOnceRef`, `latestWinIdRef`, the rank-snapshot refs, dirty flags and every scheduler
  timer, bumps both generations and releases its queued work. The realtime channel stays keyed and filtered by
  `organization_id`, but **binds only `wins` INSERTs** (D-2): the `calls` binding is removed (it shares the org-wide
  `calls` stream the dialer relies on, costs one authorization check per open leaderboard tab per call, and an Agent
  only receives their own calls anyway) and the `appointments` binding is removed (the table is not in the realtime
  publication, so it never fired). Standings changes arrive through the 30 s poll.
- **Scope-tagged snapshots:** standings are tagged `identity | view | group | period`; wins `identity | view | group`
  (wins are not period-scoped). The stale strip appears only when the tag matches the selection; a failed or blocked
  switch clears the rows (so CSV export and TV totals can never pair old numbers with a new label).
- **Stale-response protection:** `fetchGenerationRef` (newest only) plus the scope check; the wins feed gets the same
  (`winsGenerationRef` + scope check). The group load (RPC → premium → 7-day wins) is one gated unit.
- **Metric switching:** `changeMetric` untouched — zero requests (RPC or table), synchronous re-rank.
- **No double mount fetch:** fetches depend on the *selected group id* instead of the `agencyGroup` object, so group
  info arriving after mount no longer re-sends the org request.
- **Effects split** so tab switches never touch realtime: (a) realtime channel effect keyed on organization/identity,
  calling refs; (b) one scheduler effect owning the poll interval (only while visible; idempotent start), trailing and
  retry timers, and `visibilitychange` / `online` / `offline` listeners; (c) scheduler timers in their own refs,
  outside `clearAllSequenceTimers`, so a metric or period switch never cancels a scheduled re-check. All cleared on
  unmount and identity change.
- **One automatic trigger path** `requestAutoRefresh()`: only when visible and online; inside a cooldown it arms one
  retry timer at `retryAt` instead; otherwise the gate's spacing decides and one trailing timer fires at
  `autoAvailableAt`. Sources: the 30 s poll, a `wins` INSERT, becoming visible / online again (only if something
  changed or the data is older than one poll), and the retry timer. A tab that mounts hidden defers its first load
  until shown.
- **Recent Wins (D-6):** fetched through the same gate **after** the standings commit for the current scope (so a group
  query never uses the org roster), then on the automatic cadence **whenever standings are on screen** (even if a
  standings refresh failed), and on a `wins` INSERT with `notBefore = event time`. The win flash/spotlight runs only if
  the new win is in the committed list and the viewer is unchanged. Nothing is fetched for Recent Wins while no
  standings are displayed. A failed read keeps the previous list (same scope only).
- **Return value:** existing fields kept; `standingsStatus { kind: "ok"|"maintenance"|"busy"|"error", lastUpdatedAt,
  nextCheckAt, manualAvailableAt, offline }`, `winsStatus { kind: "loading"|"ok"|"error", lastUpdatedAt }`;
  `loadError` kept (non-empty whenever standings are not ok) for #23 compatibility; `retry()` is the bounded manual
  run; `fetchData()` keeps working for tests as an unthrottled `initial` run.

### 4.4 Status copy (one pure table: `src/lib/leaderboardStatusCopy.ts`)

| State | Page / TV (full) | Page / TV (strip over a snapshot) | Dashboard widget |
|---|---|---|---|
| maintenance | **"Standings are paused for maintenance."** "We'll check again automatically at 3:47 PM." (no active Retry during the hold) | "Standings are paused for maintenance — showing results from 3:42 PM." | "Standings are paused for maintenance. You can check again at 3:47 PM." / "…showing results from 3:42 PM." |
| busy | "Standings are busy right now." "Retrying at 3:43 PM." | "Standings are busy — showing results from 3:42 PM." | same, without a retry time |
| error | "Couldn't load the leaderboard." "We'll try again automatically at 3:43 PM." | "Couldn't refresh standings — showing results from 3:42 PM." | "Couldn't load standings" / "Refresh failed — showing results from 3:42 PM." |
| offline | "You're offline — standings will refresh when you reconnect." | same idea | — |
| loading | skeleton (page) / "Loading standings…" (TV) | — | skeleton only when nothing is on screen |

- A "next check" time is shown **only while a timer is actually armed and in the future**; the Dashboard never promises
  an automatic check (it has none).
- Zero-activity copy is qualified when stale: "No activity as of 3:42 PM" (page), "No sales recorded as of 3:42 PM"
  (widget); it is suppressed on the full error panels.
- Times: page and widget use the viewer's browser clock with the agency's 12/24 h preference where available; TV uses
  the same agency timezone as its clock.
- **Accessibility:** status copy sits in `role="status"` / `aria-live="polite"`; a Retry that is not yet allowed uses
  `aria-disabled="true"`, stays focusable, does nothing on click, and is described by visible text "Retry available at
  3:43 PM" (`aria-describedby`); Tailwind `aria-disabled:` styles. One one-shot timer re-enables it (no ticking).

### 4.5 Leaderboard page (`Leaderboard.tsx`) and `LeaderboardErrorBanner`

`LeaderboardErrorBanner` renders the full panel and the strip from `standingsStatus` + the table above (headline stays
the hook's `loadError`, so existing callers and tests keep their text). The page passes `standingsStatus`, `winsStatus`,
`initialLoading` and `retry` through; its own growth is a few lines of props.

### 4.6 TV mode (`TVMode.tsx` + new `TVStandingsNotice.tsx`) — D-8

New optional props `standingsStatus`, `winsStatus`, `loading`, `onRetry`:
- **Nothing loaded + not ok (or still loading):** toolbar kept (clock, settings, exit). The podium, table, deep-rank
  panel, totals and Recent Wins are replaced by `TVStandingsNotice` — large TV-styled copy from §4.4 **plus the three
  period buttons**, so a TV user can switch period without leaving TV. No zero totals.
- **Snapshot + not ok:** a compact notice strip at the top of `<main>`.
- **"Live" wording only when live:** the Activity icon + "Live Feed", "Live Ranking: {metric}" (→ "Ranking: {metric}")
  and the footer "LIVE NEWS FEED" (→ "NEWS FEED") follow `standingsStatus`.
- **Ticker:** "No wins yet — get dialing!" only after a successful empty wins read; when wins aren't loaded or failed,
  the custom banner if set, otherwise neutral status copy ("Standings paused — last update 3:42 PM" / "Recent wins
  unavailable").
- TV's Recent Wins panel receives `winsStatus`. Auto-rotation still only re-ranks cached rows. TVMode is already 774
  lines (pre-existing exception to §7); new UI goes into `TVStandingsNotice.tsx` and the copy table, keeping TVMode's
  growth to prop wiring and a few conditionals. No inline styles in new UI.

### 4.7 Recent Wins (`RecentWinsPanel.tsx`)

New optional `status` (`loading` | `ok` | `error`) and `lastUpdatedAt`: `loading` → skeleton rows (default and TV
variants); `error` with no list → "Recent wins are unavailable right now."; `error` over a list → the list plus
"Couldn't refresh — showing wins as of 3:42 PM."; "No wins yet" only for `ok` + empty. Without the prop it behaves as
today.

### 4.8 Dashboard widget (`LeaderboardWidget.tsx` + new `useLeaderboardWidgetStandings.ts`)

- Data/gate logic moves into `useLeaderboardWidgetStandings` (the widget file shrinks below 200 lines; presentation
  D-1…D-6 unchanged). Identity `${userId}:${organizationId}` with a new `organizationId` prop from the Dashboard.
  Endpoints `org_standings` / `group_standings`; snapshot tagged with view + group. Like the hook, it depends on the
  selected group id rather than the `agencyGroup` object, so group info arriving after mount no longer sends a second
  org request.
- **No polling and no automatic retry timer.** Mount / view toggle → `initial`; Retry and the Dashboard Refresh
  (`refreshSignal` prop) → `manual`. The mount-time `refreshSignal` is remembered, so a remount (edit-mode toggle,
  hide/restore) never counts as a click.
- The snapshot stays on screen during a manual refresh (no skeleton flash). If a manual run is throttled, the widget
  says "Standings can refresh again at 3:43 PM".
- An identity change clears the snapshot; a view switch whose load fails shows that view's error, never the other
  view's rows (Group rows never appear under "My Agency").

### 4.9 Dashboard refresh (`Dashboard.tsx`, `useDashboardStats.ts`, new `DashboardRefreshButton.tsx`) — D-7

- `useDashboardStats`: remove the 120 s `setInterval`. Data still loads on mount and on period / perspective change. A
  request-id guard covers `setData`, `setLoading` and errors, so an older response can neither overwrite a newer
  selection nor clear its loading state. If **any** stat query returns an error, the previous values are kept (never
  replaced with zeros). `refresh()` returns a promise that settles with the newest request.
- **One control** in the Dashboard controls row: "Refresh" (accessible name "Refresh dashboard"). One click refreshes
  the stat cards and sends one `refreshSignal` increment to **every Dashboard widget** (D-7 as approved): Callbacks,
  Schedule, Goal Progress, Leaderboard (one bounded manual run through the gate), Missed Calls and Anniversaries.
  Disabled (`aria-disabled`, focusable) while the stat refresh runs, for 30 s after the Dashboard mounts, and for 30 s
  after each refresh settles; its timer is cleared on unmount. It shows "Refreshing…" while running and does not claim
  "Updated" (the Dashboard cannot confirm every widget succeeded).
- Each of the five other widgets gains an optional `refreshSignal` prop in its existing load effect (a remount still
  loads once, exactly as today), a cancellation guard so an older load can never commit after a newer one, and — where
  the widget has no error state of its own — a failed **refresh** keeps the rows already on screen instead of replacing
  them with an empty list or zeros (on first load nothing was on screen, so first-load behaviour is unchanged).
  Missed Calls and Anniversaries also clear their list when a refresh returns nothing (today they would keep stale rows).
  Callbacks keeps its existing explicit error state.

### 4.10 Resulting request bounds (per browser tab)

| Situation | `main` today | After |
|---|---|---|
| Leaderboard/TV visible, healthy | ~15 standings + ~15 wins reads/min, plus up to ~1/s realtime-triggered refreshes (Admins); unbounded overlap | ≤ 4 standings requests/min (30 s poll, ≥ 15 s spacing, stretched when slow); wins on the same cadence; **≤ 1 request in flight** |
| Leaderboard/TV **hidden** | realtime-triggered refreshes continue | **0** (only the `wins` subscription stays open) |
| Pause active (`PT503`) | 15 standings + 15 wins reads/min, indefinitely | **1 standings request per ~5 min per viewer** (manual checks cannot shorten the hold); **0** wins reads while nothing is displayed |
| Dashboard open | 9 stat queries every 2 min (visible or hidden) + widget on mount | widget + stats on mount only; manual Refresh ≤ 1 per 30 s |

---

## §5. Exact files to touch

**New**
1. `src/lib/leaderboardRequestGate.ts` — classification, backoff, poll interval, gate, viewer registry.
2. `src/lib/leaderboardStatusCopy.ts` — pure status/ticker copy and time formatting.
3. `src/lib/__tests__/leaderboardRequestGate.test.ts` — gate + copy unit tests.
4. `src/hooks/useLeaderboardWidgetStandings.ts` — the Dashboard widget's data/gate logic (extracted).
5. `src/components/leaderboard/TVStandingsNotice.tsx` — TV notice/strip with period buttons.
6. `src/components/dashboard/DashboardRefreshButton.tsx` — the bounded Refresh control.
7. `src/components/leaderboard/__tests__/leaderboardStatusSurfaces.test.tsx` — banner, TV and Recent Wins states.
8. `src/components/dashboard/__tests__/dashboardRefresh.test.tsx` — Refresh bounds and `useDashboardStats`.

**Edited**
9. `src/hooks/useLeaderboardData.ts`
10. `src/hooks/__tests__/useLeaderboardData.test.tsx`
11. `src/pages/Leaderboard.tsx`
12. `src/pages/__tests__/leaderboardPage.test.tsx`
13. `src/components/leaderboard/LeaderboardErrorBanner.tsx`
14. `src/components/leaderboard/RecentWinsPanel.tsx`
15. `src/components/leaderboard/TVMode.tsx` (props, notice/strip placement, live labels, ticker text)
16. `src/components/leaderboard/leaderboardPremium.ts` (optional `signal`; surface read errors instead of `data || []`)
17. `src/components/dashboard/widgets/LeaderboardWidget.tsx`
18. `src/components/dashboard/__tests__/leaderboardWidget.test.tsx`
19. `src/pages/Dashboard.tsx` (Refresh control, `refreshSignal` / `organizationId` props only)
19a. `src/components/dashboard/widgets/CallbacksWidget.tsx`, `AppointmentsWidget.tsx`, `GoalProgressWidget.tsx`,
     `MissedCallsWidget.tsx`, `AnniversariesWidget.tsx` — `refreshSignal` prop + guard only (D-7 as approved)
20. `src/hooks/useDashboardStats.ts` (remove interval; request-id guard; keep values on error)
21. `AGENT_RULES.md` — amend invariant #23's frontend contract (D-9; Doc Update Rule §9)
22. `implementation_plan.md` (this file) and `WORK_LOG.md` (newest-first entry)

**Not touched:** every `supabase/**` file, `src/integrations/supabase/types.ts`, `package.json` / lockfile, CI, Vercel
config, `TwilioContext`, dialer files, PR #381/#382/#383 branches.

---

## §6. Decisions for Chris (recommendation first)

| ID | Decision | Recommendation | Alternative |
|---|---|---|---|
| **D-1** | Poll cadence | **30 s** default; env override clamped to 30 s – 5 min; legacy 4 s rejected | 60 s default |
| **D-2** | Realtime `calls` / `appointments` triggers | **Remove both bindings; keep the `wins` binding (celebrations); rely on the 30 s visible-only poll** | Keep them behind the ≥ 15 s throttle |
| **D-3** | Backoff numbers | **Maintenance 5 min ±10 %; busy 15 s→2 min; error/timeout 30 s→5 min ±20 %; 25 s timeout** | Tune |
| **D-4** | Manual Retry / Refresh | **Accepted ≥ 30 s after the last request started and ≥ 15 s after it returned; may bypass an error/timeout backoff but never a `maintenance` or `busy` hold (the UI shows the next automatic check instead)** | Let manual runs bypass every hold |
| **D-5** | Where backoff state lives | **Shared per-viewer gate (metadata only) so maintenance/backoff survive Dashboard ↔ Leaderboard ↔ TV navigation.** No data cache, so each remount (navigation, Dashboard edit-mode toggle) outside a hold still sends one request — accepted as human-paced | Per component; or add a ≤ 10 s per-viewer success cache (#383 had one) |
| **D-6** | Recent Wins | **After standings, same gate and cadence while standings are on screen; own truthful loading/error state** | Keep the parallel fetch at mount |
| **D-7** | Dashboard Refresh scope | ~~Stat cards + Leaderboard widget~~ → **APPROVED: every Dashboard widget** (touches 5 more widget files) | Stat cards + Leaderboard widget only |
| **D-8** | TV with nothing loaded | **Full notice with period buttons replacing podium/table/totals/wins; "live" wording only when live** | Strip only |
| **D-9** | AGENT_RULES #23 amendment (**required** by the Doc Update Rule §9) | **Wording as in §4 (frontend facts only):** single-flight per viewer, 30 s visible-only poll, only `wins` realtime, `PT503` = maintenance hold (PostgREST maps `PTxyz` → HTTP xyz; postgrest-js 2.98 has no auto-retry and reports aborts as `code: ""`), scope-tagged truthful states, no Dashboard auto-refresh | Different wording |
| **D-10** | PR #383 | **This branch supersedes #383's frontend (commit `6ee612ad` and its gate `src/lib/leaderboard-request-gate.ts`); #383 stays open and untouched; if the backend guard is wanted later it is re-cut on a backend-only branch for its own approval, so a second gate never lands** | Build on #383 instead |
| **D-11** | Backoff across full page reloads / new tabs | **Memory only** (a reload during the pause sends one request — human/kiosk-paced) | Persist `{blockedUntil, kind}` per viewer in `sessionStorage` |
| **D-12** | Group failure behaviour | **Stay on Group with a truthful error/stale state (no silent switch to the paused org view); failing group sub-reads fail the load instead of showing $0/0** | Keep today's silent fallback to My Agency |

---

## §7. Verification plan

**Baseline on clean `main` @ `62684da`, captured before any edit (scratch, not committed):**
`npx tsc --noEmit` exit 0 (vacuous: `"files": []`, AGENT_RULES #35); `npx tsc -p tsconfig.app.json --noEmit` exit 2
with **91 errors**; targeted ESLint of the 11 existing files to edit: clean; `npm run build`: OK; full `npx vitest run`
(no `.env`): **3264 tests — 3251 passed / 1 failed / 12 skipped; 13 failed suites in 12 files** (11 fail to load with
"supabaseUrl is required", plus `recordingRetentionVoicemail.test.ts` "…byte-identical to deployed v29"). This matches
the 2026-09-24 WORK_LOG record.

**After implementation:**
1. Focused suites (gate, hook, page, widget, status surfaces, Dashboard refresh), each run several times.
2. Required coverage: coalescing (20 simultaneous refreshes → one request, ported from #383's gate scenarios);
   one-in-flight; bounded queue / `superseded`; per-endpoint cooldown checked at request
   and at start (in-flight `PT503` + queued switch = one RPC); `PT503` hold with **no network** while blocked;
   automatic spacing incl. slow responses; manual bounds (a manual run during a `PT503` or `PT429` hold calls `load()`
   zero times); a superseded queued context makes zero network calls; 25 s timeout frees the lane even if `load()` never settles;
   poll cadence + env clamp; hidden/offline suppression of poll, realtime and retry timers and resume on return;
   identity change clears data before paint and never shows another viewer's rows; scope-tagged snapshots (period /
   view switch during a hold never shows the old rows); newest-only commits for standings **and** wins; metric switch
   = zero requests; `agencyGroup` null → object = one org RPC; realtime `subscribe` count stays 1 across visibility
   changes, failures and metric switches, and the channel binds only `wins`; unmount with queued wins = no request, no timers; truthful copy for every
   state in §4.4 (never zeros, never "No wins yet" / "No agents on the board" on failure or while loading, never
   "check your connection" for maintenance, "live" wording only when live); TV notice keeps period buttons; accessible
   disabled Retry; Dashboard has no interval, Refresh is bounded, remount never counts as a click, stat errors keep
   previous values.
3. Existing pinned behaviour kept. Harness changes: mocks gain `.abortSignal()` on RPC and table builders;
   `resetLeaderboardRequestGates()` in every leaderboard suite's `beforeEach`; the clock is controlled with
   `vi.useFakeTimers({ toFake: ["Date"] })` / `vi.setSystemTime` (RTL `waitFor` keeps working); the widget suite's strict
   console-error filter stays. Tests **restated with the same intent**:

   | Existing test | Why it changes | Restated assertion |
   |---|---|---|
   | hook: "discards an older in-flight response that resolves after a newer one" | requests no longer overlap | two queued runs: the older is `superseded`/discarded; only the newest commits |
   | hook: "a silent poll that supersedes the visible INITIAL fetch settles initialLoading…" | same key now **joins** the in-flight request | the joined silent run settles `initialLoading`/`filterRefreshing`; one RPC; nothing can resurrect loading |
   | hook: "a silent poll that supersedes a visible FILTER refresh settles filterRefreshing" | serialization | the newest run settles `filterRefreshing`; the superseded run cannot touch it |
   | hook: "a period switch mid-flight discards the old period's late response" | the switch waits for the in-flight request | the week request starts only after today's settles; today's data never commits under This Week |
   | hook: "a superseded stale response can never restore the previous metric's ordering" | overlap mechanics | same guarantee via serialized runs |
   | hook: "retry() clears the error and reloads standings" | 30 s manual spacing | retry before 30 s sends nothing; after 30 s it reloads and clears the error |
   | widget: "Retry recovers", "keeps the last ranked snapshot behind the stale note", "keeps the stale note (with a working Retry)…" | 30 s spacing; a `userId` change is now an identity reset | re-fetch via `refreshSignal`/Retry after advancing 30 s; the snapshot survives a failed **same-viewer** refresh; zero-sales copy reads "as of h:mm" when stale |
   | widget: three "stale-response protection" tests (two pending at once) | serialization + identity reset | queued/superseded runs never commit; an identity change clears the snapshot |
   | widget: "falls back to org standings when the group RPC fails, and resets the toggle…" | D-12 | Group stays selected and shows its truthful error; no org RPC is sent on its behalf; Retry after 30 s requests the group again |
   | widget: "hides group org names when a kept group snapshot is shown under My Agency…" | that is the mismatched-scope case | My Agency with a failing org load shows the org error state, never Group rows |
   | page: `baseHookState` | new hook fields | adds `standingsStatus` / `winsStatus` defaults |

4. `npx tsc --noEmit` and **`npx tsc -p tsconfig.app.json --noEmit`** (the real check) — error set identical to the
   baseline; zero new errors.
5. Targeted ESLint on every touched file (`--max-warnings 0` for new files).
6. `npm run build`.
7. Full `npx vitest run`, compared file-by-file with the `main` baseline.
8. Independent adversarial review of the diff before commit.

No browser/preview smoke test against a hosted backend is planned or claimed (a preview may point at production).

---

## §8. Explicit non-actions

No Supabase MCP call (read or write), no `apply_migration`, no replay/rollback/edit of `20260923224254`, no un-pause,
no RLS/grant/RPC/Edge Function change, no production data access, no Vercel action, no merge, no push to `main`, no
change to PR #381/#382/#383. Pushing this branch may trigger Vercel's automatic **preview** build; that is not a
production deployment.

---

## §9. Risks and rollback

- **Staler standings:** updates within ~30 s instead of ~4 s (win celebrations still fire from the `wins` INSERT).
  Accepted trade-off for load safety.
- **Filter switches can wait** behind an in-flight request (normally ~50 ms; ≤ 25 s when the database is slow).
- **Shared gate state:** metadata only, keyed by viewer, bounded, never evicted while busy.
- **Group behaviour change (D-12)** and **test churn** as listed in §7.3.
- **Known limitation:** aborting a request frees the browser but cannot cancel the database query; the serialize rule
  and backoff bound the server cost instead.
- **Rollback:** revert this branch's commits; no data or schema is involved.

---

## §10. Plan history

- This file on `main` @ `62684da` held the Team / Open Pool lead-details plan (rev 1–7 and §11); @ `f78140d` the
  Dashboard Leaderboard widget plan. Both remain in git history.
- The incident's own records (containment note, approved emergency scope, #383 recovery plan) live on the unmerged
  branches of PR #382 / #383 under `docs/incidents/2026-09-23-*` and are not copied here.

---

## §11. Pre-approval design review (2026-09-25)

Four independent read-only reviewers critiqued the first draft against the code. Findings adopted above:
- **Concurrency:** coalescing key must exclude `p_end`; cooldown re-checked when a queued run starts; spacing measured
  from any start and stretched by response time; typed `blocked` reasons; timeout owned by the gate; owner release;
  never evict a busy gate.
- **React lifecycle:** result → state table; identity reset list and before-paint reset; scope-tagged snapshots; split
  effects so visibility/failures never re-subscribe realtime; scheduler timers outside `clearAllSequenceTimers`; the
  realtime win handler re-checks viewer and only celebrates committed wins; `agencyGroup` double fetch; test harness
  and the explicit list of restated tests.
- **Truthful UX:** mismatched-scope snapshots; TV ticker / "LIVE" labels / period buttons; Recent Wins loading state and
  scope; group fallback to the paused endpoint and $0 sub-reads (D-12); Dashboard Refresh naming, throttled first
  click and error-to-zero stats; accessible disabled Retry; only-armed "next check" times; stale zero-activity copy;
  component-size extractions.
- **Scope/safety:** manual runs must not bypass `maintenance` / `busy` holds (D-4 changed); remove the `calls` /
  `appointments` realtime bindings (D-2 changed); `leaderboardPremium.ts` added to the file list with error
  propagation; the #23 amendment is required, not optional; record #383's frontend as superseded; the widget's own
  `agencyGroup` double fetch; TV footer/ticker. No backend, secret, service-role, RLS or telephony exposure was found
  in the plan.
- The adversarial verification pass run on the findings confirmed every finding it checked (none refuted).

---

## §12. As built (2026-09-25, rev 1.1 approved scope) — NOT merged, NOT deployed

Implemented on `claude/agentflow-leaderboard-recovery-uney6j` exactly as §4 describes, frontend only. Deviations from
the §5 file list, all small and in scope:
- **`src/hooks/useTimeReached.ts` (new, 15 lines):** the one-shot "has this time passed" hook used by the Retry and
  Refresh controls. Kept out of `LeaderboardErrorBanner.tsx` so that file exports only components (fast refresh).
- **`src/pages/__tests__/dashboardRefreshWiring.test.tsx` (new):** proves one accepted Refresh click signals every
  widget; it stubs the widget modules, so it cannot share a file with the real-widget tests.
- `LeaderboardRetryButton` is a named export of `LeaderboardErrorBanner.tsx` (reused by TV and the widget). Retry and
  Refresh check the clock at click time as well as through their re-enable timer.
- **Mounted guards** in both hooks: after unmount nothing commits and nothing new is requested (found while writing
  the unmount test).
- The Dashboard Refresh button's accessible name is "Refresh dashboard"; it never claims "Updated".
- One **pre-existing** type error (`Win` → `WinPremiumRow` in the wins premium mapping) disappeared because that code
  moved into `loadRecentWins`; the app typecheck went from 91 to 90 errors with no new error.

Sizes: `TVMode.tsx` 774 → 834 lines, `RecentWinsPanel.tsx` 245 → 269, `Leaderboard.tsx` 252 → 281 (all already over
the §7 guideline before this work); `LeaderboardWidget.tsx` 235 → 143 (its logic moved into
`useLeaderboardWidgetStandings`). New components are all under 200 lines and Tailwind-only.

### §12.1 Post-implementation adversarial review (2026-09-25) — all confirmed findings fixed

Four independent reviewers (gate/scheduling, React state, truthful UI, regressions/scope) read the implemented diff;
a skeptic verified each finding against the code. Confirmed findings and their fixes (each now pinned by a test that
fails without the fix — see the WORK_LOG mutation table):
1. **A Retry joining a queued period switch** made the queued job "manual", so the spacing rule refused it and the old
   period's rows stayed under the new label. The gate now keeps every joiner's mode and runs the job if any of them is
   allowed; a deferred load of a new selection stays in the loading state (never "showing results from" old rows).
2. **A tab opened in the background during a hold** stayed on the skeleton for the whole hold. The first shown/online
   check now settles into the hold's state (no request).
3. **The widget showed the other view's rows while a view switch loaded.** It now shows the skeleton; a manual
   refresh of the same view still keeps its snapshot.
4. **Offline tabs kept "Live" wording.** Offline is now "not live" on the page and TV, with "Standings are not
   updating … You're offline — standings will refresh when you reconnect." and no Retry that cannot succeed.
5. **Realtime wins skipped the spacing rule** (20 INSERTs → 20 reads). They are now automatic runs with one trailing
   read for a burst; the celebration fires when ANY committed list contains the win (it was dropped when two reads
   joined).
6. **Recent Wins stopped during a standings hold** even with standings on screen. They keep their own spaced cadence;
   a standings run that sent nothing (a refused manual Retry) no longer triggers a wins read.
7. **The widget ran on a second gate while the organization id was unknown.** It now waits for both ids.
8. **The promised "next check" could be earlier than the real one** after a slow or timed-out answer. It is now the
   time the gate will really accept the automatic run.
9. **The TV ticker could say "Loading recent wins…" forever** (standings failed, or an empty roster). The ticker shows
   neutral status copy, and an empty roster still loads its org wins.
10. **A TV period switch kept "Live" on the previous period's rows.** TV now shows "Loading standings for this period…"
    and drops the live wording until the new period commits.
11. **Accessibility:** the Recent Wins skeleton is a `role="status"` region with screen-reader text; the Refresh
    button's accessible name follows its visible state ("Refresh dashboard" / "Refreshing… dashboard", `aria-busy`).
12. **Stats:** my first version zeroed every card on a first-load failure of any query (including two queries no card
    displays). A first load or a switch now behaves exactly as on `main`; only a failed Refresh of the same selection
    keeps the values on screen, and only the displayed queries count.

### §12.2 Second adversarial review round (2026-09-25, on the code after §12.1)

Four reviewers ran again on the updated diff, with finders repeating until two rounds found nothing new; a skeptic
checked each finding against the current tree. Seven findings: six are fixed, and one is recorded as a known
limitation. Each fix has a test that fails without it.
1. **(major) Switching Today → Week → Today while Today was in flight** left the abandoned Week request queued. It
   still ran after Today settled, which is one extra aggregate RPC. If it failed, its hold never reached the status,
   so the page and TV said "Live" during a maintenance hold for up to 5 minutes. Fixes:
   - A request that joins the in-flight job now drops the queued job on the same channel when only this viewer
     wants it and its key differs (`dropQueued`). Jobs another consumer also wants are kept.
   - A poll tick that meets a hold always settles the status into that hold.
2. **(minor) A realtime win queued behind a slow Recent Wins read** was refused as too soon and then dropped. The
   win showed up only at the next poll. The event is now kept and read again as soon as the gate allows it
   (`onThrottled`).
3. **(minor) A Recent Wins timer set while the tab was visible** could send a read after the tab was hidden. Hiding
   the tab now clears that timer. When the tab is shown again, the catch-up refresh reads the feed.
4. **(minor) Group view:** a delayed realtime read after the standings were cleared recorded an empty "ok" wins
   list, so TV could say "No wins yet". A Recent Wins read without an explicit roster now runs only while the
   current selection's standings are on screen.
5. **(minor) The snapshot tag had no period start.** After midnight, or a week or month boundary, a failed refresh
   kept yesterday's "Today" rows, labelled only with a time. The tag now includes the period start.
6. **(minor) A deferred load of a new selection** could leave the spinner on and show old times after an early
   manual Retry. It now settles, and the times are correct.
7. **(minor) Known limitation, not changed:** the Dashboard Refresh button's 30 s window starts when the button
   mounts, not when the Leaderboard widget's gate last ran. The widget shares that gate with the Leaderboard page, so
   the gate can refuse the first accepted click, for example right after a visit to the Leaderboard page.
   - When it refuses, the widget says "Standings can refresh again at h:mm", in its empty-roster state as well.
   - The stat cards and the other five widgets still refresh, and nothing extra is sent.
   - Tying the button to the gate would couple the whole Dashboard to the leaderboard gate for one widget, so it
     is left for Chris to decide.

**After the final mutation run:** the separate "nothing has loaded yet" branch of the hold handling had become
equivalent to the general branch, and its mutation survived for that reason. It was removed: a poll tick that meets
a hold now settles every tab the same way, with no request. Its mutation now targets the general branch and is
caught. One test was also found to pass because of the gate's spacing rather than the rule it names; its clock now
moves past the spacing, and it is caught.

**Mutation proof (final tree):** 42 mutations, each re-breaking one guard on an isolated copy. The repo was never
mutated, and files were restored with a sha256 check.
- 39 are caught.
- The 3 that survive are each one of two layered guards: unmount (M10), parallel Recent Wins at mount (M11) and
  realtime spacing (M22). Removing both guards of each pair (M10b, M11b, M22b) is caught.

---

## §13. Rev 1.2 corrections (2026-09-25, requested by Chris within the approved recovery scope)

Recorded before any edit. Frontend only: no migration, RPC, RLS, grant, Edge Function, Supabase MCP call, production
read or write, Vercel action, merge, push to `main`, or change to PRs #382/#383. **The production pause
(`20260923224254`) stays active.** Metric definitions, query shapes, `organization_id`/RLS boundaries and
`.maybeSingle()` usage are unchanged; no form or modal is added (so no new Zod schema); Tailwind theme tokens only.

### 13.1 What is wrong today (verified in the code at `68810757`)

1. **Dashboard refresh is not coordinated.** `refreshDashboard` awaits only `refreshStats()`. Each widget reloads from
   its own `refreshSignal` effect, and nothing waits for it. The Refresh button therefore re-enables before the widget
   work ends, and nothing stops overlap:
   - A signal that arrives while a widget's load is still running starts a second load for the same data (the
     `cancelled` flag drops the old result but not its request).
   - A perspective or period switch during a load does the same.
   - The edit-mode toggle remounts every widget, and each remount starts its own load.
2. **Some dispatch paths skip the visibility and connectivity check.**
   - `fetchData` chains the post-standings Recent Wins read even when the tab was hidden (or went offline) while
     standings were in flight.
   - The gate starts a queued job without re-checking the tab.
   - The page and TV defer only a *hidden* mount: an *offline* mount sends its request, and the widget and every
     Dashboard section load at mount whether hidden or offline.
3. **Failure feedback is missing or misleading.**
   - `useDashboardStats` keeps same-selection numbers on a failed Refresh but shows no indication.
   - A first-load failure shows the valid-empty message in four widgets:
     - Schedule: "Your schedule is clear for today";
     - Goal Progress: "No goals configured";
     - Missed Calls: "All caught up!";
     - Anniversaries: "No policy anniversaries soon".
   - The same four keep rows on a failed Refresh, but silently.
   - Callbacks re-enters the skeleton on every Refresh, and a failed Refresh clears its rows.
   - Stat cards show "0" / "$0" when nothing is loaded.

### 13.2 Design

**A. Page activity (`src/lib/pageActivity.ts`, new).** `isPageActive()` = the tab is visible AND online.
`onPageActivityChange(listener)` subscribes to `visibilitychange`, `online` and `offline`.
`canAutoRefreshLeaderboard()` keeps its name and delegates to it.

**B. Dashboard sections (`src/lib/dashboardRefresh.ts`, new; pure TypeScript).**
- *Section lanes.* One lane per viewer and section (`${userId}|${section}`), in a module registry like the gate: it
  holds scheduling metadata and one promise, never rows beyond the promise.
  - **One load in flight per section.** A request for the same scope joins it, so a Refresh, a remount or a
    duplicate signal never starts a second load.
  - A different scope (perspective or period switch) replaces the one queued job. It aborts the in-flight load only
    when no other owner still wants it, and starts after that load settles, so the same section never has two
    requests on the wire.
  - **Activity is re-checked right before every dispatch, queued jobs included.** A hidden or offline page resolves
    `inactive` and sends nothing.
  - Each dispatched load gets an `AbortSignal` that fires at **25 s** (`DASHBOARD_SECTION_TIMEOUT_MS`, same as the
    leaderboard gate). The lane is freed only when the load really settles: a load that ignores the signal keeps its
    lane, and later requests join it rather than overlap it.
  - An owner that unmounts is released: its queued work is dropped unsent, and an in-flight load it alone wanted runs
    to its bound, so an immediate remount joins it.
- *Refresh tracker* (`DashboardRefreshTracker`, one per Dashboard mount). Every section reports, for each Refresh
  signal, a promise of its outcome:
  - `ok` / `failed`: work actually started, or joined work already running;
  - `deferred`: nothing sent (the leaderboard's gate spacing or hold);
  - `inactive`: nothing sent (offline);
  - `superseded` / `skipped`.

  `wait(signal, expectedSections, 20 s)` resolves when every expected section has reported and its work has settled,
  or at the bound (`DASHBOARD_REFRESH_WAIT_MS`), whichever comes first. The expected sections are the stat cards plus
  every visible widget at click time. **Leaderboard deferral resolves immediately**, so it never blocks the other
  sections.

**C. `useDashboardSection` (`src/hooks/useDashboardSection.ts`, new).** The React binding every non-leaderboard
section uses:
- a scope-tagged snapshot: data for another user, perspective or period is never exposed;
- `loading` (nothing for this scope yet), `refreshing` (a same-scope load running over data on screen), `failed` (the
  last attempt for this scope failed), `offline` (a load is waiting for connectivity), `updatedAt`, `complete`, and
  `reload()`;
- a Refresh signal (never the mount value, so a remount is not a click) runs one load through the lane and reports it
  to the tracker;
- when the page becomes visible and online again, a load that was deferred for this scope runs once.
- A load **throws** on a returned query error. It may attach a `fallback` value, used only when nothing for the scope is
  on screen. This keeps the stat cards' first-load behaviour (values as on `main`) while still flagging the failure.

**D. Section-level feedback (`src/components/dashboard/DashboardSectionNotice.tsx`, new; one copy table).**

| Data on screen | State | What the section shows |
|---|---|---|
| Yes | Failed | "Couldn't refresh — showing \<section> from h:mm." |
| Yes (stats fallback) | Failed | "Some stats couldn't be loaded — numbers shown may be incomplete." |
| Yes | Offline | "You're offline — showing \<section> from h:mm." |
| Yes | Refreshing | "Refreshing…" |
| No | Failed | A panel: "Couldn't load \<section>." and "Use Refresh to try again." It never shows the valid-empty message. |
| No | Offline | A panel: "You're offline. \<Section> will load when you reconnect." |

All states are `role="status"`; each widget keeps its existing empty-state copy for a successful empty read.
- **Callbacks** keeps its own first-load failure panel and its "Try again" button, now routed through the lane.
- **Stat cards** show the notice above the grid, and "—" instead of "0" / "$0" when nothing is loaded.

**E. Wiring.**
- **`useDashboardStats`:**
  - loads through `useDashboardSection` (section `stats`), with the same nine queries, the same bounds and `.abortSignal()`;
  - a displayed-query failure throws, with the `main`-equivalent values as fallback;
  - an undisplayed failure (leads, talk time) is still success;
  - it returns `{ data, loading, section }` and no `refresh`.
- **`Dashboard.tsx`:**
  - one tracker;
  - `refreshDashboard` bumps the signal and awaits `tracker.wait(signal, ["stats", ...visibleWidgets], 20 s)`;
  - passes `refreshTracker` to the stats hook and every widget.
- **The five widgets** (Callbacks, Schedule, Goal Progress, Missed Calls, Anniversaries):
  - their existing query bodies move, unchanged, into a `load(signal)` function (plus `.abortSignal()` where the query
    is local);
  - `dashboard-callbacks.ts`, the shared callback contract (#22), is **not** edited, so Callbacks loads are not
    abortable; its lane still prevents overlap;
  - the render code keeps its markup.
- **`DashboardRefreshButton`:** unchanged behaviour (30 s after opening and after each settle). `onRefresh` now resolves
  when the reported work settles or at the 20 s bound.

**F. Leaderboard (page, TV, gate, widget).**
- **Gate:**
  - new refusal `{ status: "blocked", reason: "inactive" }` when the page is hidden or offline;
  - it is checked when a run is requested AND again right before a queued job starts (all modes);
  - joining an in-flight request sends nothing and is unaffected.
- **`useLeaderboardData`:**
  - An offline mount defers, as a hidden mount already does, and loads when visible and online.
  - `fetchWins` re-checks activity before every dispatch; the post-standings read, realtime reads and catch-up reads all
    go through it. An inactive page marks the hook dirty, so the catch-up refresh on return reads the feed.
  - An `inactive` standings result for a **new** selection clears the other selection's rows and stays in its loading
    state. For the **same** selection it settles with nothing changed.
- **Page:**
  - offline with nothing loaded shows the offline banner ("Standings are not updating. You're offline — standings will
    load when you reconnect.") instead of an endless skeleton;
  - a switch still loading with no rows shows a board skeleton, never "No agents on the board".
- **TV:** the same. The notice shows the offline copy (no spinner) when offline, and a pending switch with no rows is a
  loading notice, not an empty podium.
- **Widget (`useLeaderboardWidgetStandings`):**
  - reports each Refresh to the tracker: gate spacing or a hold is `deferred`, resolved immediately;
  - an `inactive` refusal keeps the load pending and re-runs it once when the page is visible and online;
  - offline with nothing loaded shows the offline copy with no Retry; offline over a snapshot shows the stale strip with
    the time.

### 13.3 Exact files

**New**
1. `src/lib/pageActivity.ts`
2. `src/lib/dashboardRefresh.ts`
3. `src/hooks/useDashboardSection.ts`
4. `src/components/dashboard/DashboardSectionNotice.tsx`
5. `src/lib/__tests__/dashboardRefresh.test.ts` (lanes + tracker)
6. `src/components/dashboard/__tests__/dashboardSections.test.tsx` (widgets, stats and coordination regressions)

**Edited: application**
7. `src/lib/leaderboardRequestGate.ts`
8. `src/lib/leaderboardStatusCopy.ts`
9. `src/hooks/useLeaderboardData.ts`
10. `src/pages/Leaderboard.tsx`
11. `src/components/leaderboard/TVMode.tsx`
12. `src/hooks/useLeaderboardWidgetStandings.ts`
13. `src/components/dashboard/widgets/LeaderboardWidget.tsx`
14. `src/hooks/useDashboardStats.ts`
15. `src/components/dashboard/StatCards.tsx`
16. `src/pages/Dashboard.tsx`
17. `src/components/dashboard/DashboardRefreshButton.tsx` (contract comment)
18. `src/components/dashboard/widgets/AppointmentsWidget.tsx`
19. `src/components/dashboard/widgets/CallbacksWidget.tsx`
20. `src/components/dashboard/widgets/GoalProgressWidget.tsx`
21. `src/components/dashboard/widgets/MissedCallsWidget.tsx`
22. `src/components/dashboard/widgets/AnniversariesWidget.tsx`
22a. `src/components/leaderboard/leaderboardPremium.ts` — added by the §13.6 review (re-check before its follow-on reads)

**Edited: tests**
23. `src/lib/__tests__/leaderboardRequestGate.test.ts`
24. `src/hooks/__tests__/useLeaderboardData.test.tsx`
25. `src/pages/__tests__/leaderboardPage.test.tsx`
26. `src/components/dashboard/__tests__/leaderboardWidget.test.tsx`
27. `src/components/dashboard/__tests__/dashboardRefresh.test.tsx`
28. `src/pages/__tests__/dashboardRefreshWiring.test.tsx`
29. `src/components/leaderboard/__tests__/leaderboardStatusSurfaces.test.tsx` (if the TV notice copy changes)

**Edited: docs**
30. `AGENT_RULES.md`: #23 amendment (the corrections) and a one-line note in #22 (a failed same-scope Refresh keeps the
    complete previous page and total, with a stale note).
31. `implementation_plan.md`
32. `WORK_LOG.md`

**Not touched:**
- `src/lib/dashboard-callbacks.ts`, `DashboardDetailModal`
- every `supabase/**` file and the generated types
- `package.json` / lockfile, CI, Vercel config
- telephony and dialer files, and PRs #381/#382/#383

### 13.4 Regressions required by Chris (plus the ones the design needs)

1. **Standings resolving after the tab becomes hidden:**
   - no Recent Wins read is sent;
   - on return, the catch-up reads standings and then wins, once.
2. **Mounting offline:**
   - page/TV hook: no standings RPC and no wins read; the page shows the offline banner and TV the offline notice;
     `online` then loads once;
   - Dashboard sections and the Leaderboard widget: nothing sent, offline panels shown, one load each on reconnect.
3. **A widget still pending when another Refresh becomes eligible:**
   - the second Refresh starts no second load for it, and the Refresh wait stays bounded;
   - the other sections refresh, and the pending widget's result still lands.
   - The same guarantee applies to a switch, and to a remount (edit-mode toggle).
4. **A failed Refresh keeps data and shows feedback:** Schedule, stat cards, Callbacks, Goal Progress, Missed Calls,
   Anniversaries and the Leaderboard widget keep same-selection data and show the section-level note.
   - A first-load failure never shows the valid-empty message.
   - The leaderboard cooldown is a deferred section that does not block the others.

Verification follows §7: affected suites, the real app typecheck (`tsconfig.app.json`), targeted ESLint with warnings
treated as errors, build, and the full suite compared with `main` @ `62684da` and with this branch @ `68810757`.

### 13.5 As built (2026-09-25): design changes from the pre-implementation review

Four read-only reviewers critiqued §13 against the code, finders repeating until two rounds found nothing new, and a skeptic verified each finding. Of 22 findings, 13 were confirmed; all 13 are built in, and so are several of the refuted ones. What changed from §13.2 as written:

- **B (lanes):**
  - **Bound, with no stuck section.** At 25 s the lane reports the load `failed` to every waiter, even when the load ignores the abort (Callbacks' shared reads take no signal). That load keeps the lane until it really settles, and its late answer is discarded. Any request meanwhile gets `busy`: nothing is sent, and the section shows the failed note. Work queued behind it is refused the same way.
  - **Switches.** A load aborted because every owner left is *abandoned*. It ends `superseded`, never `failed`, and it is never joined: a request for its scope queues a fresh job behind it. An owner that returns to the in-flight scope drops its own queued detour unsent.
- **B/E (tracker).** The Refresh waits for the sections *registered* (mounted) when it is pressed, not for the layout's widget list. A section that unmounts meanwhile counts as `skipped`. The Leaderboard widget with no organization reports `skipped`.
- **C (hook).**
  - A per-run generation guard: only the newest run for the current scope changes state.
  - **Scopes include the period start:** local day for Schedule, month for Goal Progress, the selected period's start for stats. The load's bounds come from that same value, so after midnight a failed Refresh shows "Couldn't load …" rather than yesterday's rows.
- **C/D (stat cards).** No invented numbers:
  - A displayed value whose query failed is `null` and shows "—" with no trend arrow; the values that did load still show.
  - If all six displayed queries fail, there is no fallback: "Couldn't load stats. Use Refresh to try again."
  - A partial fallback says "Some stats couldn't be loaded — what's shown may be incomplete." and never "from h:mm".
- **D (section notice).**
  - One always-mounted `role="status"` region per section; "Refreshing…" is visual only, so six sections do not announce at once.
  - Callbacks' failure panel gains `role="status"`.
  - Every widget's valid-empty branch carries the notice, so a failed Refresh over an empty list says so.
- **Missed Calls:** a failed contact lookup is a failure (the #22 rule), never rows claiming "no linked contact record".
- **F (leaderboard).**
  - **Selection changes go through the gate.** The mount and selection effect never short-circuits: fetchData, through the gate's `inactive` refusal, is the only deferral, for mount and switch alike, whether hidden or offline.
  - **A deferred new selection:** on `inactive` it clears the other selection's rows, headline and times; a maintenance or busy hold on the endpoint stays shown. It enters its loading state explicitly, a silent run included. A standings commit that succeeds cancels a pending catch-up.
  - **Offline copy makes no promise:** "can't load / refresh until you reconnect". The TV ticker has its own offline line. While offline, a Recent Wins status still at loading is reported as unavailable.
  - **The widget:**
    - with nothing loaded for the view, a Refresh or a resume is a first load (`initial`);
    - offline is tracked live, so a background mount shown while offline says so;
    - an `inactive` new view resets the other view's headline.

Refuted and not built: a per-Dashboard snapshot store to survive edit-mode remounts. The skeptic judged it out of scope (D-5 accepts one load per remount; remounts during a load already join it). Also refuted and not built: separate "wins-only" catch-ups. The catch-up on return reading standings and then wins is intended, and the gate spaces it.

### 13.6 Post-implementation review (2026-09-25): all confirmed findings fixed

Four reviewers read the implemented diff (lanes/hook, Dashboard wiring, leaderboard, test quality); a skeptic
verified each finding, with throwaway probes when feasible. Of 12 findings, 9 were confirmed; with duplicates merged,
there were 4 defects. Each fix has a test that fails without it.

1. **Follow-on reads skipped the activity check.** A read sent after an earlier read of the same load returned went
   out even if the tab had hidden or gone offline meanwhile. Affected: Missed Calls' contact lookups; the leaderboard's
   Recent Wins premium lookup; the group standings' premium and 7-day wins reads. Fixes:
   - `assertPageActive()` / `PageInactiveError` in `pageActivity.ts` are called before each follow-on read. They were
     added in `MissedCallsWidget.tsx`, `useLeaderboardData.ts` and **`leaderboardPremium.ts`** (the one file added to
     §13.3; it is used only by the leaderboard hook).
   - The lane maps the error to `inactive` (deferred, resumed once), and the gate maps it to `blocked` / `inactive`,
     with no failure and no backoff.
   - `dashboard-callbacks.ts` stays untouched, as #22 requires. Its internal contact lookups therefore remain the one
     known place where a load already on the wire can still finish its chained reads after the tab hides. They are
     bounded by the lane, which sends nothing new.
2. **An offline switch left the owner's earlier queued selection in the gate**, and it was sent on reconnect. The
   `inactive` refusal now drops that owner's queued detour, as joining the in-flight job already did.
3. **The page's "Refreshing" spinner** stayed on beside the offline banner with nothing in flight. It is now hidden
   while offline, and TV's strip does the same.
4. **Tests that could not fail:**
   - The lane's "same scope joins" test was not counting after settle.
   - The "release … remount joins" test never joined. It is now split into "release drops queued work unsent" and "a
     remount joins the load on the wire (one request, never aborted)".
   - The sections' no-leak assertion checked a word no fixture contains; it now checks the injected error text.

**Refuted:**
- Work queued behind a stalled load is refused as `busy` at the bound. That is intended (§13.5): it keeps the wait
  bounded, the state shown is true, and Refresh or Try again loads it once the stall ends.
- The Callbacks scope has no day in it. Its list is the pending callbacks, not a day's list.
- The saved-layout read on an offline mount is not a Dashboard section and is out of scope.

**Mutation proof (isolated copy; files restored with a sha256 check):** 43 mutations, 42 caught. They cover the lanes,
tracker, section hook, gate, page/widget hooks, page, TV, stats, Schedule, Missed Calls, the notice and the four
review fixes. The one survivor, the `fetchWins` pre-dispatch re-check, is layered behind the gate's own `inactive`
refusal; removing both is caught.

---

## §14. Rev 1.3 corrections (2026-09-26, approved by Chris; recorded before any edit)

**Base:** the branch at `4e4a99f5`, with current `main` (`8532dc89`, #385 campaign retry guard) merged in as `9ba24928`.
That merge was a clean union, and #385's migration, plan doc, AGENT_RULES #15 note and WORK_LOG entry are unchanged.
**Approval:** Chris approves both corrections, including the narrow exception above for `src/lib/dashboard-callbacks.ts`.

### 14.1 Callback requests still overlap after a partial failure (verified by Chris at `4e4a99f5`)

**What happens.** A campaign callback row query fails immediately while the other row and count queries are still out.
`fetchCallbackPage` checks each branch inside its own `.then`, so that branch's failure rejects the outer `Promise.all`.
`loadCallbacks`' `Promise.all([page, total])` then rejects too. The section lane sees the load as settled and frees
itself, and a Refresh 31 s later sends six new reads while the earlier ones are still pending.

**Fan-out boundaries:**
- `fetchCallbackPage`, the three branch row queries: **rejects early** (the per-branch error check throws).
- `loadCallbacks`, the page + count pair: **rejects early** (either half can reject first).
- `fetchCallbackTotal`, the three count queries: they are bare builders that resolve even on an error, so `Promise.all`
  waits for all three and checks them afterwards. It is made explicit anyway, and it now cancels the siblings on the
  first failure.
- `resolveContactDetailsByIds` (`dashboard-contact-identity.ts`): it awaits bare builders the same way, so it waits for
  all its lookups. It runs only after every branch has succeeded. **This file is not edited** (outside the exception).
  Its lookups cannot be cancelled, but the lane now waits for them.

**Design:**
- New `src/lib/requestLifetime.ts`:
  - `settleAll(promises, onFirstFailure)` never settles before every promise has settled, then rethrows the
    *chronologically first* failure;
  - `linkedAbort(signal?)` gives one controller per load, aborted on the first failure or when the caller's signal
    aborts, and disposed afterwards.
- `dashboard-callbacks.ts`: `CallbackQueryOptions` gains an optional `signal`.
  - `fetchCallbackTotal` and `fetchCallbackPage` build every query first (an invalid user id still throws before any
    request), attach `.abortSignal()`, and wait with `settleAll`. The first failure cancels the siblings, and the call
    rejects only when all of them have settled, as success or confirmed cancellation.
  - `fetchCallbackPage` does not start its contact lookup once the caller has cancelled.
  - Filters, columns, ownership (`applyOwnership` / `ownershipOrExpression`), branch exclusivity, `offset + pageSize`
    pagination, global ordering, exact totals, `assertNoQueryError` contexts and `resolveContactDetailsByIds` are
    unchanged. `DashboardDetailModal`'s calls (no signal) behave as before.
- `CallbacksWidget.loadCallbacks(userId, isFiltered, signal)`: page and total run under one linked controller, with
  `settleAll` and cancel-on-first-failure. The lane's 25 s bound still reports failure on time and still refuses later
  requests with `busy` while anything is outstanding. When the outstanding work settles, the lane is free again. No
  partial page or total is ever returned.

### 14.2 The Leaderboard widget keeps the previous month's podium (verified by Chris)

**What happens.** September standings load successfully, the browser-local date moves into October, and a Refresh
fails. September's podium stays under "Top agents this month", because the snapshot scope is viewer | view with no
month.

**Design:**
- In `useLeaderboardWidgetStandings`, the snapshot tag becomes viewer | view | **month start**, computed from the
  browser-local date when each load runs.
- Every keep-or-commit decision compares against that tag: clearing at the start of a load, commit on ok, the failure
  and hold branches, the `inactive` branch, and choosing the Refresh or resume mode.
- A load for a new month clears the old rows first and shows its loading state. A failed, held, spaced or deferred
  new-month load never shows the previous month's rankings.
- No timer and no automatic polling: nothing reloads just because the date changes; the check happens when a load
  runs, for example on Refresh.

### 14.3 Exact files

**New:**
1. `src/lib/requestLifetime.ts`
2. `src/components/dashboard/__tests__/callbacksRequestLifetime.test.tsx`: regressions using the real callback helpers,
   with the Supabase transport mocked; `fetchCallbackPage` / `fetchCallbackTotal` are not replaced.

**Edited:**
3. `src/lib/dashboard-callbacks.ts` (the approved exception; request lifetime only)
4. `src/components/dashboard/widgets/CallbacksWidget.tsx`
5. `src/hooks/useLeaderboardWidgetStandings.ts`
6. `src/components/dashboard/__tests__/dashboardCallbacks.test.ts`: its transport mock gains `abortSignal()`, as real
   PostgREST builders have it; no assertion changes.
7. `src/components/dashboard/__tests__/leaderboardWidget.test.tsx`: month-rollover regressions.
8. `AGENT_RULES.md`: the #22 request-lifetime note; #23 the widget's month identity.
9. `implementation_plan.md` (this section) and `WORK_LOG.md`.

**Not touched:**
- `src/lib/dashboard-contact-identity.ts`, `DashboardDetailModal`, every `supabase/**` file, generated types,
  dependencies, CI and telephony;
- #385's files (as merged), and PRs #382/#383.

### 14.4 Regressions required

1. **Callbacks, with the real helpers and a mocked transport:**
   - a partial failure (one branch fails at once while the rest are pending) rejects only after every started read has
     settled (siblings cancelled), and never returns partial data;
   - outstanding work that ignores the abort holds the lane beyond the 25 s bound, with failure shown at the bound and
     a later Refresh refused as busy (no new reads);
   - recovery: once that work settles, the next Refresh sends one fresh set of reads and shows the rows;
   - the page/count pair behaves the same way;
   - a failed Refresh over earlier data keeps the complete earlier page and total, never the partial new one.
2. **Widget:**
   - September loaded, the clock in October, and a failed Refresh: no September podium, a truthful failure state;
   - the same for a deferred or held new-month load;
   - no request is sent when only the clock advances.

Verification: the new regressions, affected suites, `npx tsc -p tsconfig.app.json --noEmit`, targeted ESLint
(`--max-warnings 0`), build, and the repository gates. Results are compared with the pre-change tree, and pre-existing
failures are reported separately.


### 14.5 As built, review and verification (2026-09-26)

**As built.** §14.1 and §14.2 are built as written. One addition came from the review below:

- **Widget, month checked again when a load settles.** A Refresh sent at 23:59:40 on 30 September can settle after local
  midnight, up to the gate's 25 s bound. `load()` therefore recomputes the tag from the clock when the load settles.
  - If the month rolled while the request was queued or on the wire, the previous month's rows are cleared before any
    branch runs: ok, failed, held, spaced or `inactive`.
  - An ok answer loaded for the previous month is never committed as this month's. The widget shows
    "Couldn't load standings" and reports `failed`, and the next Refresh loads the new month as a first load
    (`initial`, not spaced).
  - Still no timer and no polling. A snapshot committed before midnight stays on screen until the next load runs,
    which is the accepted §14.2 boundary.
  - The failure branch's own clear became redundant and was removed; the one settle-time clear covers it.

**Callback boundaries as built:**

| Boundary | Before | After |
|---|---|---|
| `fetchCallbackPage` branch reads | `Promise.all`, with the assert inside `.then`, so it rejected early | `settleAll` + `.abortSignal()`; first failure cancels the siblings; no contact lookup once the caller cancelled |
| `fetchCallbackTotal` counts | `Promise.all` over builders that resolve on error, so it waited for all | the same, plus sibling cancel |
| `loadCallbacks` page + total | `Promise.all`, rejected early | `settleAll` under one `linkedAbort` tied to the lane's signal |
| `resolveContactDetailsByIds` | awaits all three lookups | unchanged (outside the exception); the lane waits for it |

**Post-implementation review.** An adversarial diff review ran two lenses, each finding verified by a skeptic.
- **Callbacks lens:** no findings.
- **Widget lens:** one finding, the midnight straddle above.
  - The skeptic reproduced it. It rated the finding as the accepted no-timer boundary and offered the settle-time check
    as optional hardening.
  - The hardening was built, because the correction requires the month in "the comparisons that govern retaining or
    committing results". It comes with two regressions: a failed answer after midnight, and an ok answer after
    midnight followed by recovery.

**Mutation proof.** Run on an isolated copy, with each file restored and its sha256 checked. All 14 mutations are
caught:

| Group | Mutations |
|---|---|
| Callbacks | C1–C3 early-rejecting `Promise.all` at each boundary; C4 `settleAll` settling on the first failure; C5/C6 no sibling cancel (page / total); C7 contact lookup after cancel; C8 widget ignoring the lane's signal; C9 rethrowing the last failure |
| Widget | L1 tag without the month; L2 no clear at load start; L3 settle-time tag equal to the start tag; L4 no settle-time clear; L5 committing last month's ok answer |

**Verification (final tree):**
- New regressions: `callbacksRequestLifetime` 10/10; widget rev 1.3 block 7/7.
- Affected suites: **314/314** across 12 files.
- Full suite: **3,411 passed / 1 failed / 12 skipped of 3,424**.
  - Zero status changes and no removals vs the pre-review rev 1.3 run; 2 tests added.
  - The failing-file set is identical to `main`.
- `npx tsc -p tsconfig.app.json --noEmit`: 90 errors, **zero new**, none in a changed file.
- `npx tsc --noEmit`: exit 0.
- ESLint `--max-warnings 0` on all 38 changed `src` TS/TSX files: clean.
- `npm run build`: OK (pre-existing chunk-size warning only).
- `npm run verify:s1-plan`: all 23 checks passed. `verify:s1-plan:selftest`: passed (5/5).

**Pre-existing failures (not caused by this work; identical on `main`):**
- 11 files fail at import with "supabaseUrl is required." (no `.env` in the sandbox):
  `addLeadAssignmentGate`, `dialerCampaignPresenceHook`, `clientMapping`, `contactName`, `contactScope`,
  `leadDisposition`, `userLocalDayBounds`, `caller-id-selection`, `runtimeEventLogger`, `custom-fields-settings`,
  `dialer-api-attempt-cap`.
- `recordingRetentionVoicemail`: "handler wiring … byte-identical to deployed v29".
- `sql-tests.yml` is manual-only and needs Docker/Supabase, so it was not run.


## §15. Backend reopening preparation (2026-09-25 PT / 2026-09-26 UTC)

Chris authorized beginning the backend review, isolated implementation and testing after PR #386 was merged and deployed at `b3c0839`. The exact scope, files, verification and later production approval boundary are in [the backend plan](docs/incidents/2026-09-26-leaderboard-backend/implementation_plan.md). The production pause remains active. This section supersedes the earlier frontend-only restriction only for this separately authorized preparation stage; it does not authorize a production migration or alter PRs #382/#383.


### §15.1 Approved production release

Chris approved PR #387 merge, the exact tested forward SQL, bounded live checks and ten-minute observation, including the tested re-pause if stop criteria occur. PR #387 merged at `545398cf`; Supabase recorded migration `20260926060304_leaderboard_request_guard`, with SQL byte-for-byte equal to the tested source. The [production execution record](docs/incidents/2026-09-26-leaderboard-backend/verification.md#production-execution-2026-09-25-pt--2026-09-26-utc) records the database passes, observation limits and pending signed-in UI checks. The migration filename is reconciled without editing its contents. Production-only approval does not extend to Group semantics, RLS/grants, customer data, telephony or PRs #382/#383.

### §15.2 Signed-in checks completed; authorized latency re-pause

On September 26, signed-in Dashboard refresh, all three Leaderboard periods, metric switching and TV Month/Week totals passed functional checks on production main `7126ce1f`. The final API log window contained 20 successful standings POSTs, but three took 2,734 / 3,574 / 4,481 ms. The approved two-slow-read stop rule therefore required re-pause; successful data was not treated as a performance pass.

The exact tested re-pause was applied at 16:32:24 UTC as `20260926163224_leaderboard_repause_latency_gate`. SQL bytes match the existing ops source; guarded-and-paused hash `75eec092f7039c2c8cb0cca93e93d1ae`, security metadata, authenticated PT503 and the browser maintenance panel are verified. The new migration plus this plan, the backend plan/verification record, AGENT_RULES and WORK_LOG are the complete follow-up file scope. No new frontend, test, workflow or recovery SQL is introduced. See the [final evidence and diagnostic next step](docs/incidents/2026-09-26-leaderboard-backend/verification.md#signed-in-verification-and-authorized-latency-rollback-september-26-utc). Production standings remain paused pending a measured latency diagnosis and a separately approved next reopening.

### §15.3 Capacity diagnosis and resize preparation (historical; execution in §15.4)

Read-only investigation found a persistent large Swap allocation on the 0.5 GB Nano instance and 5,961,926 bytes of inline avatar text in the seven-agent organization roster. Neither observation alone attributes the slow HTTP maintenance path. The [capacity plan](docs/incidents/2026-09-26-leaderboard-backend/capacity_plan.md) prepares an exact Nano → Small (2 GB) change, estimated +$5.15/month before tax in the dashboard, with its project-specific longer-downtime warning, call-free preflight, read-only verification and recovery boundaries. The final confirmation has not been submitted. AGENT_RULES #28 requires separate exact production-configuration approval. Standings stay paused during this proposed capacity test. This proposal changes only the capacity plan, this root plan, incident verification and the additive work log; it changes no code, SQL, customer data or infrastructure.

Chris approved the exact resize at 10:09:12 PT on September 26. The fresh preflight found Alexa's recent 10:07 PT outbound call still marked ringing with no end time, confirmed again at 10:11:17 PT. Execution is deferred under the approved call-free condition; approval remains valid. The project is still Nano and the final confirmation is untouched. Resume after the call-free window is established and a fresh activity check passes; see the capacity plan's approval/preflight record.

### §15.4 Approved Small resize executed; standings remain paused

Chris confirmed the call-free window and requested another activity check. The final 21:07:03.673 UTC preflight found zero current nonterminal calls and zero fresh dialer-session heartbeats, with the pause/security metadata unchanged. The exact approved Nano → Small (2 GB) change was confirmed once at 21:07:20.458 UTC, at the same estimated +$5.15/month before tax. By 21:10:24 UTC, the provider was healthy, Infrastructure showed t4g.small, the database was reachable, and the pause/security contract and PostgreSQL 17.6 were unchanged.

The 21:10:24.926–21:20:24.926 UTC comparison contained 1,033 non-leaderboard REST requests, all 2xx (150 OPTIONS), with GET p95 212.25 / 345 ms in its two five-minute halves versus 1,703.15 ms in the earlier five-minute baseline. Three expected maintenance responses still took 1,825 / 1,914 / 1,934 ms. The Dashboard and its bounded Refresh worked; the widget and full Leaderboard retained the maintenance state. Zero lock waiters were observed. Authentication delayed the midpoint SQL/browser check; exact log windows and restart errors are explicitly recorded in [verification.md](docs/incidents/2026-09-26-leaderboard-backend/verification.md#approved-small-resize-executed-september-26-utc).

The resize passes basic recovery verification, **not** full leaderboard capacity verification. Standings were never reopened. The near-two-second maintenance path and unchanged inline avatar payload require follow-up; a new exact production reopening is still separately gated. No customer data, SQL, grants/RLS, application deployment, disk or manual pool settings were changed. The four-file documentation scope in §15.3 is unchanged; this section supersedes its earlier unexecuted status without erasing the approval/deferral history.

### §15.5 Maintenance-path diagnosis and proposed payload repair

Chris authorized beginning the read-only investigation and preparing the exact repair plan. The [payload repair plan](docs/incidents/2026-09-26-leaderboard-backend/latency_repair_plan.md) lists the proposed code/SQL files, cache behavior, synthetic regressions, deployment sequence and tested recovery requirements. Implementation approval is pending; production remains paused at `75eec092f7039c2c8cb0cca93e93d1ae`, freshly checked at 22:22:36.937 UTC on September 26.

The three post-resize maintenance HTTP requests correlate with 18 PostgreSQL PT503 executions in three six-attempt groups. Their error spans account for most of the outer response duration. This supports retries below the browser boundary, without identifying a specific hosted component or explaining earlier slow successful reads. HTTP 503/PT503 and the five-minute maintenance hold remain unchanged. No support message, gateway setting, SDK upgrade or further resize is proposed.

The proposed repair removes the existing 5,961,926 bytes of inline photo text from recurring organization standings: retain the RPC signature but return a null avatar field, explicitly project names/numbers in both clients, and load photos separately under existing profile RLS through a bounded shared memory cache and the same request gate. Photos, metric definitions, Group behavior, RLS/grants and uploads are preserved. New SQL templates must accept exact preimages and independently prepare while paused, reopen, re-pause and restore the original paused body. Their final hashes/digests are implementation deliverables before any separate production release approval.

This preparation changes only this root plan, the new payload plan, incident verification and an additive WORK_LOG entry. No application, SQL, customer data, dialing or infrastructure changes are part of this turn. The original production latency/error/lock stop rules still govern a later approved reopening.

**Implementation approval, 22:38:26 UTC:** Chris's “Continue” authorizes building and testing the listed repair on the isolated `codex/leaderboard-photo-payload-20260926` branch. The CLI generated `supabase/migrations/20260926223934_leaderboard_payload_prepare.sql`; its exact filename is recorded before its body is written. Plan-only PR #390 stays separate. This approval does not apply the migration, merge/deploy code or reopen production. Later implementation results supersede the preparation-only status above.

**Implementation complete:** [PR #391](https://github.com/cgarness/agentflow-life-insure/pull/391), stacked on documentation PR #390, contains tested executable-source commit `da4b0b1be179416b33fa0655580aad852d9fa34b`. The exact 24-file scope, review fixes, baseline comparison, SQL digests and release decision are in [payload plan §8](docs/incidents/2026-09-26-leaderboard-backend/latency_repair_plan.md#8-final-implementation-and-exact-release-packet). All 181 affected frontend tests pass; the full suite adds 24 passing tests with no common-test status changes and the same 12 baseline failing files. App typecheck remains the same 90 diagnostics; changed-source lint and build pass. PostgreSQL 17.6 CI passed 32 tests plus four caught SQL mutations; ten frontend mutations were caught. This does not establish repaired production latency.

**Release remains pending:** the 23:13:36 UTC read still confirms the original guarded-and-paused definition and unchanged security. The preparation migration and four transition templates have not been applied. Merge/deploy, prepare/reopen and the bounded production observation require the exact release approval in payload §8.4, with Chris's fresh no-active-dialing condition immediately before execution. No production data, photo, policy, telephony, dependency, compute or deployment change occurred during this implementation.

**Exact release approved, 23:26:58 UTC:** Chris approved §8.4, including both merges, paused deployment, exact prepare/reopen, ten-minute verification and conditional recovery. Three fresh dialing checks passed. Main `775005cf` and Vercel production now contain the tested frontend while the original database pause remains in force. Payload plan §9 records authority, file scope and execution checkpoints before SQL apply.

### §15.6 Payload release completed and standings live

Chris approved the exact staged release at 23:26:58 UTC. Fresh dialing checks passed; #390 merged at `4af2e588` and #391 at `775005cf`, with the tested tree preserved. Vercel production `dpl_HPuZtNbMjSsSrHqZZuGp2ZbBxKhM` is READY. Preparation `20260926233422_leaderboard_payload_prepare` and reopening `20260926233524_leaderboard_payload_reopen` are applied with their exact approved bytes. Active hash `c8b1f9d0c7cf5f8dfb7e437577029278`, security and Group verified; source migration filenames were reconciled to actual provider versions.

The signed-in Today/Week/Month, Calls Made, photos, TV totals and Dashboard Refresh checks pass. Exact 23:36–23:46 UTC observation: 22 standings requests all 200, 34–151 ms API origin latency, p95 65 ms; 234 other REST requests all 200, ordinary non-OPTIONS p95 153 ms. Two separate photo GETs (198/187 ms) demonstrate cold load and five-minute reuse. No stop rule fired; no re-pause or restoration was required. Final metadata/Group matched with zero lock waiters. Production standings remain live. Detailed limits, one-minute counts and recovery references are in payload plan §9 and incident verification. This is a bounded release check, not sustained busy-period capacity certification.

---

## §16. Reports & Analytics overnight build (2026-09-28) — plan awaiting approval

The Reports security/accuracy/reliability plan lives in its own file so the leaderboard record above stays intact:
**`docs/plans/2026-09-28-reports-analytics/implementation_plan.md`**.

- **Why:** the four live `public.rpc_report_*` functions are `SECURITY DEFINER`, trust a caller-supplied `p_org_id` and are
  executable by `anon` (read-only production catalog check, 2026-09-28): a cross-tenant aggregate exposure. Reports metrics
  also deviate from the documented canon (Contacted, Calls Made window, Policies Sold), one RPC reads a nonexistent column, and
  every failure renders as zero.
- **Proposed:** one new migration with a secured `public.get_report_*` family (scope from `auth.uid()` + profile, existing
  Reports permissions enforced server-side, agent id may only narrow) that revokes legacy EXECUTE; a keyed, generation-guarded
  frontend with truthful loading/empty/error/denied states and gated, sanitized exports; SQL + vitest coverage.
- **Boundaries:** no leaderboard, Dashboard, Dialer, telephony, RLS or `report-utils.ts` change. No production action until
  Chris's separate approval (plan §9).
- **Status update (2026-09-28, appended; the heading above is historical):**
  - Rev 2 was approved for branch implementation and testing only.
  - It is implemented and locally tested on `claude/reports-analytics-overnight-c69826`.
  - The migration is **not applied**, and nothing is merged or deployed.
  - The release packet, test results, metric decisions and rollback are in
    `docs/plans/2026-09-28-reports-analytics/MORNING_HANDOFF.md`.
- **Status update (2026-09-29, appended):**
  - Chris's three final corrections are implemented on the branch: contact-first Converted identity, a fail-closed
    agency time zone with no default, and the "Call contact rate" label. They are recorded in the Reports plan §R3.
  - A PR against `main` is opened so the Reports backend CI runs. It is not merged, and the migration is not applied.

---

## §17. Contact Follow-ups card + appointment ownership/reminders BUGFIX (2026-09-28) — plan awaiting approval

The full plan lives in its own file so the records above, including the Reports §16 pointer when it lands, stay
intact: **`docs/plans/2026-09-28-contact-followups/implementation_plan.md`**.

- **Why:** an explicitly chosen appointment assignee is overwritten on three live save paths (`CalendarPage.handleSave`,
  `CalendarContext.addAppointment`, `FullScreenContactView`'s Schedule). A CalendarPage edit also reassigns the row
  and rewrites `created_by`.
- **Reminders:** they also fire for Cancelled, Completed and No Show appointments. An assignee never learns of an
  appointment booked for them until a reload, because `appointments` is not in the realtime publication.
- **Proposed:**
  - one tested ownership rule: `user_id` = the responsible person, who is the reminder recipient; `created_by` = the
    scheduler, never rewritten;
  - a pure reminder-eligibility rule, a bounded visible-tab refresh and a Google create-sync guard;
  - a compact read-only Follow-ups card on the existing contact view, merging appointments, campaign callbacks and
    tasks for one contact. It reuses the `dashboard-callbacks.ts` constants without editing that file.
- **Boundaries:**
  - frontend only: no migration, RLS, RPC, Edge Function or deploy;
  - no Reports/Analytics, Dialer/telephony or canonical callback-writer change;
  - no production action. The only production access was read-only catalog and aggregate queries.
  - Decisions D-1…D-23 await Chris.
- **Status (2026-09-29):** approved 2026-09-28 with redlines (plan §16). Implemented and verified locally on
  `claude/contact-followups-appointment-fix-rruo7i` (plan §17); not pushed, merged or deployed.
- **Pre-merge gate (2026-09-29):** do not merge to `main` until appointment attribution is reconciled with the
  Reports work — "Appointments Set" credits `created_by` (scheduler), workload/reminders credit `user_id`
  (assignee). See plan §18. Branch push approved by Chris; no merge or deploy.
- **Final reconciliation (2026-09-29, after Reports):** rebased onto `main` @ `d05f4754`; the §18 gate is reconciled in plan
  §19 — Reports and the org leaderboard verified unchanged; GoalProgress and `getPerformance` now credit the setter; the
  Group leaderboard migration `20260929160000` is PREPARED, NOT APPLIED. Pre-existing Group 42702 defect documented (§19).
  Awaiting Chris: (A) the Group migration, (B) the push (a `--force-with-lease` after the rebase), (C) merge/release.
- **Revision (2026-09-29):** the Group migration is now the complete repair
  `20260929170000_group_leaderboard_repair_membership_setter_credit.sql` (42702 fix + setter credit + setter index),
  superseding `20260929160000`; PREPARED, NOT APPLIED. Evidence and suite in plan §20.
- **Revision (2026-09-29):** the same unapplied repair migration now also hardens EXECUTE (PUBLIC and anon revoked;
  authenticated and service_role kept; final ACL `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`);
  the rollback restores the exact production ACL. Plan §21.

## §18. Group leaderboard production record reconciliation (2026-09-29) — RECORD-ONLY; awaiting Chris's approval

(Root-plan §18. It is not the contact-followups plan's §18 pre-merge gate that §17 cites.)

- **Authority / scope:** Chris's brief "GROUP LEADERBOARD PRODUCTION RECORD RECONCILIATION" (label DOCS). Base `main`
  @ `196ea9a1` (0 behind). Filename/history reconciliation and release records ONLY: no application behaviour, no new
  migration SQL, and no production action of any kind (no apply, rollback, Supabase/RLS/data change or Vercel trigger).
- **Facts to record (all verified 2026-09-29, production `jncvvsvckxhqgqvkppmj`):**
  - **Application:** PR #395, tested head `d719845e45ea4e798a6dae74d13d28ff8492a0a3`, squash
    `196ea9a1d6435a271d67b6916844a09a04f8c0d4` (identical tree).
  - **CI on the tested head:** `Group leaderboard backend verification` (PG17.6) and `Leaderboard backend verification`
    both passed.
  - **Frontend:** Vercel production `dpl_4Lu4ibn82JTKvzFbTPQwuDwqsEq2` READY 21:04:59 UTC, serving
    `www.fflagent.com` and `fflagent.com`.
  - **Migration record:** `apply_migration` recorded version `20260929215047`, name
    `group_leaderboard_repair_membership_setter_credit`, as one statement. `md5(array_to_string(statements, E'\n'))` =
    `fe1c3033e7ce8b947b2b987eaea42dd7` = md5 of the merged forward file.
  - **Forward file:** sha256 `ee4a6d4973ab12c55b6775f741fc0fa3c541a7d67a64bf36514aff462636773d`, blob `34d4c66e`.
  - **Rollback file:** sha256 `d192f97115d7d9efca090867dfd749b778804fa1363a58b4854009c3cffcd5e9`, blob `3091e86c`;
    never applied.
  - **Function:** `pg_get_functiondef` md5 `e1283b5b05d295c1d25888485cc08346` → `8bd49ee01e0b92abd3e66548569f36bb`.
  - **ACL:** `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`.
  - **Index:** `appointments_setter_created_at_idx` =
    `CREATE INDEX appointments_setter_created_at_idx ON public.appointments USING btree (COALESCE(created_by, user_id), created_at)`.
  - **Live probes:** anon / PUBLIC-only (authenticator) → 42501; authenticated / service_role → membership denial
    P0001, not 42702.
  - **Unchanged:** org leaderboard `get_org_leaderboard_stats` definition md5 `c8b1f9d0c7cf5f8dfb7e437577029278`;
    Reports `get_report_call_summary` prosrc md5 `f221e1d470fc70ec92937be66be56e69`; every other function, index,
    policy, column, grant and trigger fingerprint; the data.
  - **Advisors:** security findings 194 → 193 — the only change is the removed
    `anon_security_definer_function_executable` finding for this RPC. Performance findings: an identical set of 410. The
    new index is not flagged `unused_index` because live traffic had scanned it (21:51:20 UTC) before the advisor
    run (21:51:37 UTC).
- **Occurrences of `20260929170000` on `main` (13, plus the two filenames), classified:**

  | Location | Class | Action |
  |---|---|---|
  | `supabase/migrations/20260929170000_group_leaderboard_repair_membership_setter_credit.sql` | current path | `git mv` → `supabase/migrations/20260929215047_group_leaderboard_repair_membership_setter_credit.sql`; content byte-identical |
  | `supabase/migrations/rollback/20260929170000_group_leaderboard_repair_membership_setter_credit.rollback.sql` | current path | `git mv` → `supabase/migrations/rollback/20260929215047_group_leaderboard_repair_membership_setter_credit.rollback.sql`; content byte-identical |
  | `scripts/run_group_leaderboard_tests.sh:9,58,59` | runner paths (live) | update |
  | `.github/workflows/group-leaderboard-backend.yml:3` | header naming the file under test | update; path globs already match |
  | `supabase/tests/group_leaderboard_rpc.sql:4` | SQL suite header (the AGENT_RULES #35-block bullet) | update |
  | `AGENT_RULES.md:205` | current-status rule | update: the header (drop "PREPARED, NOT APPLIED" and "production needs Chris's separate exact approval"), the tail "(… resolved by this migration once applied)", plus one verified-post-state sentence |
  | rollback file line 1 (`-- ROLLBACK for 20260929170000_…`) | comment inside the rollback | RETAIN: the brief requires byte-identical rollback content (#394 also left its header). The release records state that this name now means `20260929215047_…` |
  | `WORK_LOG.md` (the two 2026-09-29 Group entries) | historical entries | RETAIN (never rewritten; matched by content, since line numbers shift) |
  | `implementation_plan.md` §17 dated revision bullet | historical | RETAIN; new status goes in this §18 |
  | contact-followups plan §20/§21 (`:1503,1505,1562`) | historical, dated | RETAIN |

- **Reviewed, no version string, RETAIN:** these are present-tense test comments that describe the pre-repair
  production state the harness rebuilds on purpose:
  - `supabase/tests/group_leaderboard_index_proof.sql:86`;
  - `supabase/tests/group_leaderboard_harness.sql:14-16`;
  - `scripts/run_group_leaderboard_tests.sh:63,78,94` (`PROD_ACL`).
- **Files to touch (after approval):**
  1. The forward migration: rename only, as in the table.
  2. The rollback: rename only, as in the table.
  3. `scripts/run_group_leaderboard_tests.sh` (lines 9, 58, 59).
  4. `.github/workflows/group-leaderboard-backend.yml` (line 3).
  5. `supabase/tests/group_leaderboard_rpc.sql` (line 4).
  6. `AGENT_RULES.md`: line 205, and line 204 per D-2.
  7. `WORK_LOG.md`: one new entry at the top; no historical entry edited.
  8. `docs/plans/2026-09-28-contact-followups/PRODUCTION_RELEASE_2026-09-29.md` (new).
  9. `implementation_plan.md`: this §18 plus its as-built result.
- **Not touched:** `src/`; every other migration; the SQL content of both files; all other tests; the
  contact-followups plan (including its §18–§21); historical WORK_LOG entries; root §17's dated bullets;
  `RELEASE_READINESS.md`.
- **Verification before any push:**
  - sha256 and `git hash-object` of both files before and after (values above), and `git diff -M` showing two
    100%-similarity renames.
  - A content-based grep for `20260929170000`. It may remain only in the RETAIN rows above and in the new release
    records that cite the authored name: this §18, the new WORK_LOG entry, `PRODUCTION_RELEASE_2026-09-29.md`, and
    `AGENT_RULES.md` if it says "authored … renamed", as #34 does.
  - The Group runner on a disposable local PostgreSQL. This container has no Docker, so local = PG 16.13; the PG17.6
    proof is the PR's CI.
  - `npx tsc --noEmit`.
  - `git diff --stat`: no `src/` change and no new or changed migration content.
  - WORK_LOG updated last.
- **PR:**
  - Report the local results first; push and open the PR only on approval.
  - CI is expected to run two backend checks: `Group leaderboard backend verification`, and `Leaderboard backend
    verification`, whose `*leaderboard*.sql` filter matches the rename.
  - No merge without Chris.
- **Decisions for Chris:**
  - **D-1 branch.** Locally, the session's designated branch `claude/contact-followups-appointment-fix-rruo7i` has
    already been restarted at `main` and carries only this plan commit; its upstream tracking is cleared. The remote
    branch is still at the merged PR #395 head `d719845e`, with a tree identical to `main`. Publishing there needs an
    explicitly pinned lease:
    `git push --force-with-lease=claude/contact-followups-appointment-fix-rruo7i:d719845e45ea4e798a6dae74d13d28ff8492a0a3 -u origin HEAD:claude/contact-followups-appointment-fix-rruo7i`.
    Alternative: push the same commits to a new branch `claude/group-leaderboard-production-record`, with no force.
  - **D-2 `AGENT_RULES.md:204` (recommended: edit).** That current-state follow-up bullet still lists the Group
    RPC's "`appointments.user_id`-only … PUBLIC/anon EXECUTE" as open, and both are now fixed. Minimal wording:
    "(clients-based policies_sold, no direction filter; its `appointments.user_id`-only attribution and PUBLIC/anon
    EXECUTE were fixed by the Group repair applied 2026-09-29, next bullet)".
  - **D-3 rollback header (recommended: retain).** The AGENT_RULES #35-block bullet permits correcting a rollback
    header but does not require it. This brief requires byte-identical rollback content.

### §18 result (2026-09-29) — reconciled and verified locally; NOT pushed

- **Chris's decisions:**
  - D-1: a NEW branch `claude/group-leaderboard-production-record` from `main` @ `196ea9a1`. The merged PR #395
    branch stays historical at `d719845e` and is not reused or force-pushed.
  - D-2: approved; the `AGENT_RULES.md:204` parenthetical was updated.
  - D-3: approved; the rollback header was kept.
- **Renamed (100% similarity), with sha256 and blob identical before and after:**
  - forward → `supabase/migrations/20260929215047_group_leaderboard_repair_membership_setter_credit.sql` (sha256
    `ee4a6d4973ab12c55b6775f741fc0fa3c541a7d67a64bf36514aff462636773d`, blob `34d4c66e`, 5,434 bytes);
  - rollback → `supabase/migrations/rollback/20260929215047_group_leaderboard_repair_membership_setter_credit.rollback.sql`
    (sha256 `d192f97115d7d9efca090867dfd749b778804fa1363a58b4854009c3cffcd5e9`, blob `3091e86c`, 4,784 bytes).
- **Production match:** the stored `statements` of version `20260929215047` have md5
  `fe1c3033e7ce8b947b2b987eaea42dd7` and 5,434 bytes, equal to the renamed forward file. This was one read-only
  SELECT at 22:52 UTC; production still has 289 migrations, the latest being `20260929215047`.
- **Updated:**
  - runner `MIG` / `ROLLBACK` paths and its header;
  - the CI workflow header;
  - the SQL suite header (one comment line);
  - `AGENT_RULES.md` lines 204 and 205;
  - the new top `WORK_LOG.md` entry;
  - the new `PRODUCTION_RELEASE_2026-09-29.md`.
- **Remaining `20260929170000`, all intentional:**
  - WORK_LOG's two earlier Group entries;
  - root §17's dated revision bullet;
  - contact-followups plan §20/§21;
  - the rollback's first-line comment;
  - the new records that name the authored file (`AGENT_RULES.md:205` "authored as", this §18, the new WORK_LOG
    entry, `PRODUCTION_RELEASE_2026-09-29.md`).

  No filename carries it.
- **Checks:**
  - The Group runner on local PostgreSQL 16.13 passed steps 0–7: preimage, suite, three negative controls, drift and
    replay refusal, exact-ACL rollback and re-apply, the 13-scenario access differential, and the index proof, where
    auto_explain showed 7/7 index use.
  - Root `npx tsc --noEmit`: 0 errors. App tsconfig: 90, the same as `main`, since no TS file changed.
  - No `src/`, TS/JS or migration-content change.
  - No production write, apply, rollback, Vercel action or advisor fix.

## §19. Dialer appointment timezone + `created_by` writer fix (2026-09-30) — BUGFIX; implemented and verified locally (as-built below); not pushed

(Root-plan §19. It is not the contact-followups plan's §19 cited in §17 above.)

- **Authority / scope:** Chris's brief "DIALER APPOINTMENT TIMEZONE + CREATED_BY WRITER FIX" (label BUGFIX).
  - Base: `main` @ `d675a4b1`.
  - Local branch `claude/dialer-appointment-timezone-created-by` from `main` `d675a4b1`; this plan is committed
    locally only. Nothing is pushed.
  - Frontend-only writer fix. No schema, RLS, RPC, migration or production change.
  - Telephony, queue, canonical callback writer and Reports are untouched.
- **Verified root cause (code read + a throwaway probe that drove the real `saveCallData`; nothing committed):**
  1. **Timezone.** `dialer-api.saveAppointment` builds `start_time`/`end_time` as `${date}T${convertTo24h(time)}`, with
     no offset. `appointments.start_time` is `timestamptz`, so Postgres reads that wall-clock as UTC.
     - The probe ran under `TZ=America/Los_Angeles` for a 2:30 PM 2026-10-15 callback. The shadow insert sent
       `start_time: '2026-10-15T14:30:00'`, while `advance_campaign_lead` got
       `p_callback_due_at: '2026-10-15T21:30:00.000Z'`. The shadow is 7 h early.
     - The canonical DialerPage computation `new Date(y, m, d, h, min).toISOString()` is correct and is not changed.
  2. **`created_by` omitted.** The insert writes `contact_id, user_id, title, start_time, end_time, notes, status,
     organization_id` but no `created_by`.
  3. **Invalid second writer.** After `saveAppointment`, the appointmentScheduler path calls
     `CalendarContext.addAppointment({title,type,status,contactName,contactId,date,startTime,endTime,agent,notes})`.
     - The call is not awaited, inside a synchronous try/catch.
     - `addAppointment` inserts `{...a, ...ownership}` unmapped. PostgREST rejects the unknown camelCase columns, so
       today no second row lands, but there is a second INSERT attempt, an unhandled rejection and a `console.error`.
     - With the real CalendarProvider mounted, the probe recorded **2** `appointments` inserts per save.
- **Path audit (DialerPage):**
  - LIVE: `saveCallData` appointmentScheduler (`:3601`, plus `addAppointment` at `:3619`) and callbackScheduler
    (`:3664`). Both are reached from Save (`proceedSaveOnly`) and Save & Next (`proceedSaveAndNext`).
  - UNREACHABLE: `handleSaveCallback` (`:4256`; the Callback dialog's `setShowCallbackModal(true)` is never called)
    and the `AppointmentModal` `onSave` (`:4908`; `setShowAppointmentModal(true)` is never called).
- **Reader audit:**
  - Every reader parses `start_time` as an absolute instant; none compensates for the naive value.
  - The Main-Dialer shadow is never identified by time or `created_by`:
    - ContactFollowUps (`isMainDialerCallbackShadow`) matches title "Callback" plus a non-callback `type`;
    - appointmentFilters (`isDialerCallbackAppointment`, CalendarPage's List view) matches the title ("Callback" or
      a "Callback:" prefix) or the dialer notes marker, and deliberately never reads `type`;
    - dashboard-callbacks excludes it by `type` (it reads only callback types).
  - So the shadow must keep NO explicit `type` (DB default `Sales Call`): ContactFollowUps and dashboard-callbacks
    depend on it.
  - Reminders fire from `start_time`; today Dialer reminders fire 7 h early in PDT (8 h in PST).
- **Proposed implementation (surgical):**
  1. **NEW pure helper `src/lib/calendar/localDateTime.ts`:**
     - `parseWallClockTime(time)` accepts `h:mm AM/PM` (TimeSelect) and `HH:mm`, is anchored and range-checked, and
       returns null otherwise.
     - `localDateTimeToIso(dateYmd, time)` validates `yyyy-MM-dd` strictly (reusing `taskDates.parseLocalDateInput`,
       which rejects rollovers). It then returns `new Date(y, m-1, d, h, min, 0, 0).toISOString()`, the same
       construction as the canonical `callbackDueAtISO`, or null.
     - It never uses `new Date("yyyy-MM-dd")`, never appends `Z`, and has no fixed offsets. DST follows JS
       local-time rules, identically to the canonical value.
  2. **`dialer-api.saveAppointment`:**
     - `start_time` = helper(date, time). `end_time` = helper(date, end_time) when non-empty, else null.
     - If the date, the start or a non-empty end is invalid, it throws a clear Error BEFORE any write. Both live
       callers already catch and toast, so the call save continues.
     - Adds `created_by: data.agent_id`. `user_id` stays `data.agent_id`, the dialing agent, which equals
       `auth.uid()`, and RLS `appointments_insert` passes.
     - Every other column, the absence of `type`, and the `contact_activities` insert are unchanged. The now-unused
       `convertTo24h` is removed, and TimeSelect's doc comment is updated to name the helper (comment only).
  3. **`DialerPage.tsx`:**
     - `const { fetchAppointments } = useCalendar()` replaces `addAppointment`.
     - appointmentScheduler path: remove the `addAppointment` block. After a SUCCESSFUL `saveAppointment`, call
       `void fetchAppointments({ silent: true })`.
     - callbackScheduler path: the same silent refresh after success.
     - Dead `AppointmentModal` `onSave`: remove `addAppointment(data)` and refresh on success; not otherwise
       changed and not wired to anything.
     - `handleSaveCallback` stays unchanged; it is dead and inherits the fixed writer.
     - Unchanged: the canonical `callbackDueAtISO` (both copies), the `advanceCampaignLead` arguments, `saveCall`,
       `saveNote`, `updateLeadStatus`, queue, locks, Twilio, and the defense-in-depth try/catch (a shadow failure
       never blocks the call save or advancement).
- **Decisions for Chris:**
  - **D-1 CalendarPage (recommended: leave untouched).** Its `timeStringToDate` has different fallback semantics
    (unanchored regex; returns the base date on a parse failure). The new helper documents and tests the same
    contract without redesigning CalendarPage.
  - **D-2 appointment date prefill (recommended: include, one line).** `DialerPage.tsx:3458` defaults `aptDate` to
    the UTC date (`new Date().toISOString().split('T')[0]`), which is tomorrow after about 5 PM PDT. This is
    pre-existing and independent of the writer, but it is the same form's local-time contract. The fix is
    `todayLocalDateInput()` from `taskDates.ts`.
  - **D-3 branch name:** as above, or another name you prefer.
- **Tests (fail-first: each is run against the current code first and shown failing, then passing):**
  1. **`src/lib/calendar/__tests__/localDateTime.test.ts`:**
     - equality with `new Date(y,m,d,h,min).toISOString()` in any zone;
     - ISO `Z` format;
     - 12 AM / 12 PM, 24h input, malformed input and rollover dates rejected.
     - LA-only literals:
       - 2026-09-30 2:30 PM → `2026-09-30T21:30:00.000Z`
       - winter 2026-12-15 2:30 PM → `2026-12-15T22:30:00.000Z`
       - 2026-10-31 11:30 PM → `2026-11-01T06:30:00.000Z`
       - 2026-11-02 9:00 AM → `2026-11-02T17:00:00.000Z`
     - UTC-only: 2:30 PM → `14:30:00.000Z`.
  2. **`src/lib/__tests__/saveAppointmentPayload.test.ts`:**
     - start (with offset) and end instants, or null;
     - `user_id = created_by = agent_id`; `organization_id`, `status` Scheduled and `contact_id`/title/notes
       unchanged; no `type`; the activity row unchanged;
     - invalid time throws with ZERO inserts; an insert error throws.
  3. **`src/pages/__tests__/dialerAppointmentSave.test.tsx`:** real DialerPage save path, for Save and Save & Next.
     - Callback: exactly 1 `saveAppointment`, 1 `appointments` insert and 0 `addAppointment`.
     - **The shadow `start_time` equals the `advance_campaign_lead` `p_callback_due_at`,** with an offset guard,
       because an offset-less string would also parse locally in JS.
     - `created_by = user_id = USER`, and a silent refresh after the insert.
     - Appointment: the same checks, plus the expected start/end instants.
     - Failure: an appointments insert error → `toast.error`; the call save and advancement still happen; the
       success toast fires; no refresh.
  4. **Source contract:** DialerPage contains no `addAppointment(` call.
- **Verification:**
  - `npx tsc --noEmit`, plus the app `tsconfig.app.json` count vs the `main` baseline (90).
  - Under `TZ=UTC` and `TZ=America/Los_Angeles`:
    - the new tests;
    - dialerRenderStability, dialerTeamOpenWiring, dialerCallGate;
    - calendarAddAppointmentOwnership, reminderPopupRecipient, reminderEligibility;
    - contactFollowUps(+Queries), dashboardCallbacks, appointmentFilters, calendarPageListFilter;
    - fullScreenContactViewSchedule, taskDates;
    - the full suite vs the `main` baseline.
- **Docs after verification:**
  - AGENT_RULES #22: the ownership bullet's "Out-of-scope writers" clause becomes the fixed state. Legacy rows stay
    shifted until an approved repair.
  - A newest-first WORK_LOG entry.
  - This §19 as-built result.
- **Production:** none. After verification, a fresh read-only recount of the shadow candidates and a SEPARATE
  ID-bounded, fail-closed repair proposal. Any production mutation needs Chris's separate approval.
- **Known, not in scope (report only):**
  - existing rows stay shifted until repaired;
  - a silent refresh is skipped while another fetch is in flight, so the row then appears on the next 5-minute tick;
  - DialerActions shows `callbackDate` via `toISOString()`, which is off by a day beyond ±11 h zones;
  - FloatingDialer's writer is already correct;
  - google inbound all-day events are stored at UTC midnight;
  - the Dialer writes no `contact_name`.

### §19 review revisions (2026-09-30; independent read-only plan review — supersede the matching items above)

- **Writer scope confirmed:**
  - `saveCallData` `:3601`/`:3664` are the only live shadow writers. They are reached from Save, Save & Next
    (Personal and Team/Open) and both conversion paths, where `contact_id` is the new client id.
  - `autoSaveNoAnswer` / `handleAutoDispose` write no shadow. A callback-scheduler disposition named "no answer"
    auto-saves on selection and books no callback; this is unchanged and consistent with the canonical write.
  - FloatingDialer (native `type="time"`) is already correct.
- **Parity proven:**
  - The helper equals the canonical split-based parser for all 96 TimeSelect labels. This was checked on DST gap and
    overlap dates in LA, UTC, Santiago, Auckland, Chatham and Kolkata.
  - LA gap 2027-03-14 2:30 AM → `10:30:00.000Z`; LA overlap 2026-11-01 1:30 AM → `08:30:00.000Z`, the first
    instant.
  - The only divergence is years 0000–0099, where the canonical gives 19xx and the helper rejects. That needs a
    date caught mid-typing and is documented, not handled.
- **Refresh placement (replaces the per-path refresh):**
  - ONE `fetchAppointments({ silent: true })` after BOTH shadow blocks, only when at least one shadow save succeeded.
  - It sits outside the inner try/catch and is guarded as `?.(...)` with `.catch(() => {})`. `fetchAppointments`
    has no catch, and a missing function must never raise a false "may not have saved" toast.
  - Cost: one extra org-scoped ±180-day `select` per save that booked a shadow, and none for other saves.
- **Visible consequences of correct instants (a direct result of the fix; report, not scope creep):**
  - **Reminders.** A callback or appointment set within the reminder lead time (default 10 min) now pops the
    existing modal ReminderPopup soon after Save. Today in PDT these shadows are hours in the past and never
    remind. The immediate refresh only moves that moment from "within 5 min" to "now".
  - **Scorecard.** `AgentScorecardModal:58` counts `created_by` only, so new Dialer rows would count. It is
    currently not imported anywhere, so nothing is visible. Reports, org/Group leaderboards, GoalProgress and
    `getPerformance` use `COALESCE(created_by, user_id)` / `appointmentSetterOrExpression` and are unchanged.
  - **End at or before start.** This is possible today, e.g. a start of 11:45 PM, or a start changed after picking
    an end. It is not thrown on; noted as a known pre-existing issue.
- **Decisions (updated):**
  - **D-1 CalendarPage:** unchanged (leave untouched).
  - **D-2 appointment date prefill: recommendation changed to DEFER.** A local-today default in the evening lets an
    agent who picks "10:00 AM" without touching the date book a past appointment silently: no reminder, and it
    leaves the Follow-ups card at once. Today's accidental UTC-tomorrow default hides that. Fixing it properly
    needs a past-time warning (UI), which belongs in its own change. Alternative: include it with a non-blocking
    past-time warning toast.
  - **D-4 (new) immediate refresh: recommendation KEEP** the single silent refresh, accepting that a near-term
    callback reminds promptly. Alternative: drop it and rely on the existing 5-minute freshness.
- **Test additions:**
  - **Helper test:**
    - a table test of all 96 labels against a verbatim, commented copy of the canonical parser, on the DST gap and
      overlap dates;
    - LA literals for the gap, the overlap, 12:00 AM and 12:45 PM.
    - Its fail-first is only "module missing"; the real fail-first proof is the payload test and the page test.
  - **Source contract:** pins the two canonical `callbackDueAtISO` parse blocks (`saveCallData` and
    `proceedSaveAndNext`) unchanged, and requires no `addAppointment(` in DialerPage.
  - **Page test:**
    - exact string equality of `start_time` and `p_callback_due_at` (never `Date.parse`);
    - an offset guard on both `start_time` and `end_time`;
    - a spied `fetchAppointments` called exactly once;
    - cases: Personal Save and Save & Next, Team/Open Save & Next, a conversion (`contact_id` = client id), both
      schedulers (one refresh, two inserts), and the failure path.
  - **TZ commands:** `TZ=UTC npx vitest run …` and `TZ=America/Los_Angeles npx vitest run …`, recorded in the
    WORK_LOG, because LA-only cases skip in this UTC container and no CI runs vitest.
- **Docs additions (after verification):**
  - AGENT_RULES #22: name `dialer-api.saveAppointment` as also stamping `created_by`, and replace the
    "Out-of-scope writers" clause.
  - AGENT_RULES #23: note AgentScorecardModal's `created_by`-only count.
  - Fix the stale comment in `calendarAddAppointmentOwnership.test.tsx:325`.
  - Historical WORK_LOG lines are never rewritten.
- **Repair proposal note (for later):**
  - Identify shifted rows by `created_by IS NULL` plus the Main-Dialer shadow signature and a match to
    `campaign_leads`, not by a `created_at` cutoff; browser tabs running old code can keep writing after deploy.
  - Callback shadows take their exact instant from `campaign_leads.callback_due_at`. Dialer appointment rows have
    no canonical twin, so they need a separate decision.


### §19 as-built (2026-09-30; approved with D-1 leave CalendarPage, D-2 DEFER, D-3 this branch, D-4 keep the single silent refresh)

- **Branch:** `claude/dialer-appointment-timezone-created-by` from `main` `d675a4b1`. Committed locally only; not
  pushed, merged or deployed.
- **Decisions as applied:**
  - D-1: CalendarPage is untouched.
  - D-2: DEFERRED. The `aptDate` UTC-date prefill (`DialerPage.tsx`) is unchanged. Follow-up: "local-date
    appointment prefill" plus "explicit past-time validation/warning", as one change.
  - D-3: this branch.
  - D-4: ONE silent `fetchAppointments({ silent: true })` in `saveCallData`, only when at least one scheduler write
    succeeded. It is fire-and-forget: wrapped in `Promise.resolve(...).catch(() => {})` inside a try/catch, so a
    missing, throwing or rejecting refresh never turns a successful save into a failure, never shows the "may not
    have saved" toast, and never delays the call save, disposition or canonical advancement.
- **Files (application):**
  - NEW `src/lib/calendar/localDateTime.ts`: `parseWallClockTime`, `localDateTimeToDate`, `localDateTimeToIso`.
  - `src/lib/dialer-api.ts`: `saveAppointment` builds `start_time`/`end_time` with `localDateTimeToIso`, throws
    `"Invalid appointment date or time — nothing was saved"` BEFORE any write on malformed input, and adds
    `created_by: data.agent_id` (`user_id` stays `data.agent_id`). No `type`. The `contact_activities` row is
    unchanged. `convertTo24h` is removed.
  - `src/pages/DialerPage.tsx`: `const { fetchAppointments } = useCalendar();` replaces `addAppointment`. The
    `addAppointment` block after the appointmentScheduler write is removed. `schedulerWriteSucceeded` is set after
    each awaited `saveAppointment`, and the guarded refresh runs after the callback block. The dead
    `AppointmentModal` `onSave` no longer calls `addAppointment`; it refreshes after a successful save.
    `handleSaveCallback` (dead), the `aptDate` prefill and both canonical `callbackDueAt(ISO)` blocks are unchanged.
  - Comment only: `src/components/dialer/TimeSelect.tsx` and
    `src/contexts/__tests__/calendarAddAppointmentOwnership.test.tsx` (stale comment).
- **Files (tests):**
  - NEW `src/lib/calendar/__tests__/localDateTime.test.ts`: all 96 TimeSelect labels against a verbatim copy of the
    canonical parser on 10 dates, including the DST gap and overlap; edge and reject cases; LA-only and UTC-only
    literals.
  - NEW `src/lib/__tests__/saveAppointmentPayload.test.ts` (10): exact payload keys, `created_by = user_id =`
    agent, no `type`, activity row unchanged, malformed input throws with 0 inserts, insert error throws.
  - NEW `src/lib/__tests__/dialerAppointmentForcedLA.test.ts` (3): pins `TZ=America/Los_Angeles` in its own forked
    process (with a precondition test), so real Pacific/DST instants are checked even in a UTC run. It is the only
    guard against a helper that treats the wall-clock as UTC (e.g. appends "Z"), which UTC cannot distinguish; a
    naive offset-less value is also caught in any zone by the payload and page tests. Proven with a temporary
    naive-Z helper (then restored byte-identically).
  - NEW `src/pages/__tests__/dialerAppointmentSaveContract.test.ts` (8): no `addAppointment` outside whole-line
    comments; exactly two `saveAppointment(` and one refresh in `saveCallData`; refresh guarded by the flag, which
    is set only after each awaited write; both canonical parse blocks pinned verbatim;
    `callbackDueAt: callbackDueAtISO`; the writer uses the helper and stamps `created_by`/`user_id` with no `type`.
  - NEW `src/pages/__tests__/dialerAppointmentSave.test.tsx` (13): real DialerPage mount.
    - Personal Save and Save & Next (callback and appointment).
    - Both schedulers: 2 inserts, 1 refresh.
    - A failed shadow write does not block the save.
    - Conversion: `contact_id` is the client id.
    - Team/Open Save & Next: lock released.
    - Refresh reject, throw or missing: success toast, no false failure toast, no unhandled rejection.
    - Appointment-only failure: no refresh. Mixed failure: 1 refresh.
    - Time coverage (string comparisons, never `Date.parse`):
      - The 9 cases that write a callback shadow (Personal callback Save and Save & Next, both schedulers,
        conversion, Team/Open, the 3 refresh-isolation cases, mixed failure) assert the shadow `start_time` is
        string-equal to `p_callback_due_at`. Four of them (the two Personal callback cases, both schedulers,
        Team/Open) also apply the explicit offset guard; elsewhere equality with a `toISOString()` value already
        implies the "Z".
      - The two appointment cases assert exact `start_time`/`end_time` instants with the offset guard.
      - The failed-shadow case asserts the canonical `p_callback_due_at` instant only; the appointment-only failure
        case asserts no refresh, the call save and advancement, and no instant.
  - `src/pages/__tests__/dialerRenderStability.test.tsx`: the `useCalendar` mock now supplies `fetchAppointments`.
- **Before → after (LA, callback 2026-10-15 2:30 PM):** shadow `start_time` `'2026-10-15T14:30:00'` (naive; Postgres
  stores 14:30Z = 7:30 AM PDT, 7 h early) → `'2026-10-15T21:30:00.000Z'`, string-equal to `p_callback_due_at`. PST
  2026-12-15 2:30 PM → `22:30:00.000Z`; UTC 2:30 PM → `14:30:00.000Z`.
- **Results:**
  - Fail-first on `main` (the same 5 new/hardened files):
    - UTC: 23 failed, 6 passed, 2 skipped.
    - LA: 25 failed, 6 passed.
    - The helper and forced-LA files fail on import.
    - The 6 that pass are invariants that hold on both codebases.
  - Branch, the 7-file set (the new files plus dialerRenderStability and calendarAddAppointmentOwnership):
    - UTC: 71 passed, 9 skipped.
    - LA: 79 passed, 1 skipped.
  - Focused 65-file set:
    - Branch: UTC 940 passed / 29 skipped; LA 968 passed / 1 skipped; 0 failed in both.
    - `main`: UTC 908 passed / 20 skipped; LA 928 passed.
  - Full suite:
    - `main`: 249 files, 12 failed; 3842 tests, 1 failed; 1 unhandled error.
    - Branch: 254 files, 12 failed; 3892 tests, 1 failed; 1 unhandled error.
    - Both zones; the failed-file set is identical to `main`.
    - The 12 files are pre-existing Supabase-env import failures plus the `recordingRetentionVoicemail` "byte-identical
      to deployed v29" test.
    - The unhandled error is the pre-existing Twilio mock `findTwilioRemoteAudioElement` rejection, identical on `main`.
  - Typecheck: root `npx tsc --noEmit` 0 = 0; app `tsconfig.app.json` 90 = 90, with an identical error set.
- **Production (read-only, 2026-09-30 02:35 UTC):**
  - 71 appointments; 30 with `created_by` NULL.
  - 17 Main-Dialer shadows, all `created_by` NULL.
  - 4 shadows match a campaign callback, each exactly +07:00:00. 3 of them are future:
    - `2f5f498a-feb2-41de-afa2-2a2912e65c11`: 2026-10-12 10:30Z, due 17:30Z.
    - `47edce25-38d7-43ac-9772-472096d6fe01`: 2026-10-16 10:00Z, due 17:00Z.
    - `18858a30-72a4-4aea-98b4-2373664c012d`: 2026-10-27 15:00Z, due 22:00Z.
  - Past row `35cb701c-59dc-40bd-af57-b0f15784e9d1` (due 2026-09-21) is excluded.
  - All 4 belong to one agent and one org, with no external event.
  - No appointment was written or updated after 2026-09-29 22:49 UTC.
  - Repair: an ID-bounded, fail-closed DO block (re-verify 3 locked candidates → `start_time = callback_due_at`,
    `created_by = user_id` → row-count and postcondition checks). Status is untouched, so there is no workflow
    dispatch. It is PROPOSED ONLY and needs Chris's separate approval; nothing was mutated.

## §20. Reports Policies Sold source (2026-09-30) — BUGFIX; rev 2 APPROVED by Chris for branch implementation + isolated testing (§20.11 supersedes where they differ)

- **Authority / scope:** Chris's brief "BUGFIX — Reports Policies Sold uses the wrong source".
  - Base: `main` @ `5fc4649f` (re-checked 2026-09-30; includes #393 Reports, #395/#396 Group, #397 Dialer writer).
  - Branch `claude/reports-policies-sold-source-vqvh26`. **Only this plan is committed.** No implementation file edited,
    no migration created, no local or remote SQL executed beyond the read-only checks below.
  - Stop gate: no merge, no production migration, no deploy. Chris approves the production change separately.

### 20.1 Evidence (read-only, 2026-09-30; `BEGIN READ ONLY`, aggregates only, no PII, no writes)

- **Live function bodies (`md5(prosrc)`)** — these become the new migration's exact-preimage guard:
  - `public.get_report_call_summary(date,date,uuid)` `f221e1d470fc70ec92937be66be56e69` (equals the repo, per the
    2026-09-29 WORK_LOG record).
  - `public.get_report_call_volume(date,date,uuid)` `604abca3774fc10daa2c86faa9ff7524`.
  - `public.get_report_campaign_performance(date,date,uuid)` `9d151bf9ce31bd602af8317f2dd8e124`.
  - `public.get_profile_book_stats(text,text)` `38e98ae690b7dc781fadb5d1a858f11e` (read, never changed here).
  - `private.profile_parse_currency(text)` `dd42cd7b…`, `private.profile_parse_iso_date(text)` `be24ed08…`,
    `private.report_access(uuid)` `27116a40…`, `private.report_window(uuid,date,date)` `1107da18…`.
  - Before implementation, each repo body is loaded into a disposable local PG and its md5 compared with these; any
    mismatch STOPS the build and is reported (the repo must be the record of production).
- **Chris's organization (`a0000000-…0001`, agency zone `America/Los_Angeles`):**

  | Fact | Value |
  |---|---|
  | clients | 8 |
  | primary policies (evidence rule) | 8, 0 undated, 0 unassigned |
  | primary policies with `sold_date` 2026-09-01 … 2026-09-29 | **4** |
  | clients carrying `additional_policies` (any shape) | 0 (0 arrays, 0 elements, 0 malformed) |
  | wins created 2026-09-01 … 2026-09-29 (agency-local) | **2** |
  | September-sold primary policies whose client has NO win | 2 |
  | wins total / conversion-keyed / with `campaign_id` | 6 / 6 / 1 |
  | primary policies whose client has a campaign-bearing win | 1 of 8 (0 with >1 campaign) |

  Root cause confirmed: Reports counts `wins`; two September policies have no win.

### 20.2 The policy canon being mirrored (no new definition)

Source of truth: `src/lib/profile/normalized-policy.ts` + `public.get_profile_book_stats` (AGENT_RULES #34).

- **Primary** — a `clients` row in the org counts only with evidence: `nullif(btrim(carrier),'')` OR
  `nullif(btrim(policy_number),'')` OR `premium > 0` OR `face_amount > 0` OR `sold_date IS NOT NULL`. Sale date =
  `clients.sold_date` (a DATE; never converted through a time zone, never `created_at`).
- **Additional** — each element of `custom_fields->'additional_policies'` whose `jsonb_typeof = 'object'`, read through the
  empty-array-inside-LATERAL guard (#34: never a `WHERE` guard). Sale date =
  `private.profile_parse_iso_date(coalesce(entry->>'soldDate', entry->>'issueDate'))` — i.e. the legacy `issueDate` is used
  when `soldDate` is ABSENT, exactly as `get_profile_book_stats` does. The existing `private.profile_parse_*` helpers are
  REUSED, not copied.
- **Malformed** — container present and not an array (count 1 per client) + each non-object element; never a policy.
- **No usable sale date** → the policy is excluded from every dated Reports count and surfaced as `undated_policies`.
  Never bucketed by `created_at`, never guessed.
- **Window** — `sold_date BETWEEN v_win.start_date AND v_win.end_date` (the agency calendar dates `report_window`
  already validated). Date-only values stay calendar dates, so no DST/zone arithmetic applies.

**Two pre-existing TS↔SQL edge divergences found (decision D-1):** (a) a present-but-invalid or blank `soldDate` with a
valid `issueDate`: SQL does NOT fall back (coalesce picks the non-null string), TS does (`parse(soldDate) ?? parse(issueDate)`);
(b) `additional_policies: null` (JSON null): SQL counts it malformed, TS treats it as absent. Production has 0 rows of
either shape. **Recommendation:** Reports mirrors the SQL server canon (`get_profile_book_stats`) so the Agent Profile and
Reports can never disagree on the same row; both divergences get pinned by a SQL test and recorded as a follow-up
(align `normalized-policy.ts`), not changed in this bugfix.

### 20.3 Design

**New migration** `supabase/migrations/20260930120000_reports_policies_sold_normalized_source.sql` (authored version;
renamed to the production-stamped version after an approved apply, bytes unchanged — #35). The applied Reports
migration `20260929152553_…` is NOT edited.

1. **Preflight (refuse on drift or replay):** the three live md5s above, owner `postgres`, `prosecdef`, exact ACL
   `{postgres, authenticated, service_role}` for each; the two `profile_parse_*` helpers and `report_access` /
   `report_window` present with the md5s above; the new helpers must NOT already exist.
2. **`private.report_policy_facts(p_org uuid, p_agent_ids uuid[])`** — `STABLE`, `LANGUAGE sql`,
   `search_path = pg_catalog, pg_temp`, fully schema-qualified, REVOKEd from PUBLIC/anon/authenticated. One row per
   policy: `client_id, agent_id (= clients.assigned_agent_id), source ('primary'|'additional'), sold_date,
   campaign_id` (see 20.4). Rows are restricted to `clients.organization_id = p_org AND (p_agent_ids IS NULL OR
   assigned_agent_id = ANY (p_agent_ids))` — the SAME `agent_ids` `report_access` already resolved, so it cannot widen
   scope (NULL only for organization scope, exactly like calls/wins today).
3. **`private.report_policy_quality(p_org, p_agent_ids)`** — scope-wide (not windowed) `malformed_additional_policies`
   and `undated_policies`.
4. **`CREATE OR REPLACE` the three public RPCs** with identical signatures, `STABLE SECURITY DEFINER`, search path,
   grants. Each body is the applied body with only the `wins` CTE replaced:
   - `get_report_call_summary`: `w` ← policy facts dated in the window. `totals.policies_sold`,
     `by_agent[].policies_sold`, `unattributed.policies_sold` (policies whose client has no assignee — org scope only)
     and the roster union follow. New additive object `totals.policy_quality` `{undated_policies,
     malformed_additional_policies}` and `policy_source: 'normalized_policies'` in the payload.
     Dials-per-policy, Talk-minutes-per-policy and Top Performer are computed in the browser from these fields, so they
     follow automatically.
   - `get_report_call_volume`: `by_date[].policies_sold` = policies whose `sold_date` equals that local date.
     Same `policy_source` + `policy_quality`.
   - `get_report_campaign_performance`: see 20.4.
   - The disposition and lead-source RPCs have no policy field and are not touched.
5. **Postconditions** in the same transaction: new md5s recorded, ACLs exact, helpers unreachable by
   `authenticated`, legacy `rpc_report_*` still sealed (never re-granted).
6. **Rollback** `supabase/migrations/rollback/20260930120000_….rollback.sql`: guarded on the NEW md5s, restores the three
   preimage bodies verbatim from `20260929152553`, drops the two helpers, re-asserts ACLs and the legacy seal; verified
   to return exactly the preimage md5s. The existing `supabase/ops/reports_disable.sql` remains the emergency switch
   and still covers these functions.

### 20.4 Campaign Performance (decision D-2)

Current attribution evidence: `clients` has no `campaign_id`. The only lineage from a policy to a campaign is the
conversion win: `wins.idempotency_key = 'conversion:' || clients.lead_id` AND `wins.contact_id = clients.id` AND
`wins.campaign_id` is set (DialerPage path only; one per client by the unique key — unambiguous). Manually created,
imported, FloatingDialer and Contacts-page conversions have no campaign, and a failed celebration leaves no win at all.
In production only **1 of 8** policies has provable campaign lineage, so a campaign "Policies Sold" total cannot be
complete.

**Recommendation:** remove the `policies_sold` (COUNT(wins)) field from campaign rows and return instead
`attributed_policies` (normalized policies, dated in the window, whose client carries that conversion lineage — primary
and additional both count, because the one `additional_policies` writer is that same conversion) plus top-level
`policies_without_campaign` and `policy_attribution: 'conversion_lineage_only'`. UI column "Policies (campaign-attributed)"
with a note stating how many in-scope policies have no provable campaign. No campaign is ever inferred for a manual
client. Alternative (not recommended): show "unavailable" and no number at all.

### 20.5 Agent attribution limitation (documented, not fixed)

Policies are attributed to the client's CURRENT `assigned_agent_id` (the same column `get_profile_book_stats` and
`clients` RLS use). It is mutable: a client reassigned after sale moves its policies to the new agent for past
periods. `wins.agent_id` is sale-time but only exists for the subset of policies that have a win, so it cannot be the
source. Stated in AGENT_RULES #38 and the UI footnote ("credited to the client's current agent").

### 20.6 Frontend (labels, validation, tests — no computation change)

- `reports-schemas.ts`: accept `policy_source` (literal `'normalized_policies'`, required so a stale win-based payload is
  refused as `unavailable`, never shown under the new label), `policy_quality`, and the new campaign fields.
- `stat-computations.ts`: "Policies sold" subtitle `policies (wins)` → `stored policies`; Dials / Talk minutes per policy
  and Top Performer unchanged in formula.
- `PoliciesSoldChart.tsx`: footnote "Counted from stored client policies by sale date … credited to the client's current
  agent", plus a data-quality line when `undated_policies` / `malformed_additional_policies` > 0.
- `CampaignPerformance.tsx`: the attributed column and unattributed note; CSV header matches.
- `AgentPerformanceCards.tsx`: note text only (no longer "policies won").
- `Reports.tsx`: export label only if it says wins.

### 20.7 Tests

SQL (new `supabase/tests/reports_policy_facts.sql`, run by `scripts/run_reports_rpc_tests.sh` after the existing suite;
harness gains a production-shaped `clients` table — `policy_type NOT NULL DEFAULT 'Term'`, `premium/face_amount DEFAULT 0`,
`carrier/policy_number DEFAULT ''`, `sold_date date`, `custom_fields jsonb`, `lead_id`, `assigned_agent_id` — and the two
`profile_parse_*` helpers extracted verbatim from `20260919183544`):

- A converted client, 1 primary + 1 win → 1. B manual client, valid primary, no win → 1.
  C 1 primary + 2 valid additional + 1 win → 3. D no evidence (import defaults) → 0.
- E additional with only `issueDate` in range → counted on that date (and the D-1 divergences pinned).
- F string container / JSON null / non-object elements → 0 phantom policies, `malformed_additional_policies` exact.
- G primary sold outside the range → excluded. H additional sold outside → excluded; undated → `undated_policies`, not
  in any day.
- I own / team / organization and single-agent filters: counts never include another scope's clients; an out-of-scope
  `p_agent_id` still 42501; unassigned clients only in organization scope's `unattributed`.
- J September shape: 4 dated policies, 2 wins → totals 4, by_date sums 4, Top Performer from policies.
- Campaign: lineage-attributed policies counted per campaign; manual client never attributed; `policies_without_campaign`.
- Existing `reports_rpc.sql` policy assertions (T3/T4/T6/T8/T9/T11) re-seeded with clients so they assert policy
  counts; the wins fixtures stay to prove wins are ignored.
- **Mutation controls (runner):** 2g — the summary's policy CTE reverted to `COUNT(wins)` → must fail (A–C/J);
  2h — volume reverted → must fail; 2i — the additional-policies branch removed → must fail C;
  2j — the evidence rule dropped (every client counts) → must fail D. Plus drift, replay and rollback proofs for the
  new migration; PG16 locally, PG17.6 in CI (`reports-backend.yml`).

Vitest: fixtures + `reportStatComputations.test.ts` (Policies sold, Dials per policy sold, Talk minutes per policy,
Top Performer from policy counts), `reportsContracts.test.ts` (schema requires `policy_source`; a wins-shaped payload is
refused), `reportsPage.test.tsx` (chart totals, campaign column label/unattributed note, quality note).

Verification run: Reports SQL suite + new regressions; `scripts/run_profile_rpc_tests.sh`;
`normalizedPolicy.test.ts`; Reports Vitest; full Vitest vs `main`; `npx tsc --noEmit` AND
`npx tsc -p tsconfig.app.json --noEmit` vs `main`; ESLint on touched files; `npm run build`.

### 20.8 Files (exact; nothing else is touched)

- **New:** `supabase/migrations/20260930120000_reports_policies_sold_normalized_source.sql`;
  `supabase/migrations/rollback/20260930120000_reports_policies_sold_normalized_source.rollback.sql`;
  `supabase/tests/reports_policy_facts.sql`.
- **Modified (SQL/test infra):** `supabase/tests/reports_harness.sql`, `supabase/tests/reports_rpc.sql`,
  `scripts/run_reports_rpc_tests.sh`, `.github/workflows/reports-backend.yml` (only if its path filter needs the new files).
- **Modified (app):** `src/lib/reports-schemas.ts`, `src/lib/stat-computations.ts`,
  `src/components/reports/PoliciesSoldChart.tsx`, `src/components/reports/CampaignPerformance.tsx`,
  `src/components/reports/AgentPerformanceCards.tsx`, `src/pages/Reports.tsx` (label only, if needed).
- **Modified (tests):** `src/lib/__tests__/reportsFixtures.ts`, `src/lib/__tests__/reportStatComputations.test.ts`,
  `src/lib/__tests__/reportsContracts.test.ts`, `src/pages/__tests__/reportsPage.test.tsx`.
- **Docs:** `WORK_LOG.md` (newest first), `AGENT_RULES.md` (#38 metric canon: Policies Sold = normalized stored policies by
  sale date, never wins; #34 and #17 cross-references amended for Reports only; Leaderboard/Dialer keep wins), this plan.
- **Untouched:** Dialer, Twilio, queue/locks, dispositions, `ConvertLeadModal`, conversion, win celebration, Dashboard,
  Leaderboard, `get_profile_book_stats`, `normalized-policy.ts`, all RLS, all data. No win is backfilled.

### 20.9 Release (for later approval) and expected result

- Expected after release, Chris's org, 2026-09-01 … 2026-09-29, organization scope: `totals.policies_sold = 4`
  (4 primary + 0 additional), `by_date` sums to 4, `policy_quality` 0/0; Dials per policy sold = calls made ÷ 4.
- Sequence: CI green → merge → read-only preflight (md5s, 0 active dialer sessions) → `apply_migration` (Chris's
  exact approval) → verify md5s/ACLs and an authenticated September read = 4 → Vercel production deploy of the
  frontend. Between the migration and the deploy the old UI still renders summary/volume (now correct numbers) and the
  campaign panel shows its truthful error state (schema mismatch), never a wrong number.
- Rollback: apply the rollback as a NEW migration (restores the win-based bodies exactly); or the existing
  `reports_disable.sql` for "Reports unavailable, legacy sealed".

### 20.10 Decisions for Chris

- **D-1** Edge-case semantics: mirror the SQL server canon (`get_profile_book_stats`) — recommended — or the TS module.
- **D-2** Campaign Performance: campaign-attributed policies via conversion lineage + explicit unattributed count
  (recommended), or "unavailable".
- **D-3** Accept current-assignee attribution with the documented limitation (recommended; no schema change).
- **D-4** Frontend refuses payloads without `policy_source` (recommended) — makes the release order migration → frontend.

### 20.11 Rev 2 — Chris's approval with required adjustments (2026-09-30; supersedes 20.3–20.10 where they differ)

Approval covers branch implementation and isolated local testing only: no merge, production SQL, migration apply,
deploy, data or configuration change. Main re-checked: still `5fc4649f`; no concurrent branch touches Reports SQL.
Repo bodies built locally on PG16.13 hash to the live md5s in 20.1 (summary `f221e1d4…`, volume `604abca3…`, campaign
`9d151bf9…`, `report_access` `27116a40…`, `report_window` `1107da18…`).

1. **Source / sale date (D-1 = server canon).** Normalized stored policies exactly as `get_profile_book_stats`
   (20.2), reusing `private.profile_parse_iso_date`; `coalesce(soldDate, issueDate)` before parsing; JSON-null
   container counts malformed. Both SQL-vs-TS discrepancies are pinned by SQL tests; aligning
   `normalized-policy.ts` is a separate follow-up; Profile behaviour is untouched. Undated policies are never dated by
   `created_at` or a guess. Quality counts (`undated_policies`, `malformed_additional_policies`) are returned under
   `policy_quality` with `basis: 'scope_wide_all_time'` and labelled in the UI as "across this scope, all dates — not
   known to belong to this period". Dialer, Leaderboard and Dashboard keep event (wins) semantics.
2. **Campaign attribution (D-2).** Verified before coding: `mergeCustomFieldsOnConversion`
   (`src/lib/supabase-conversion.ts:28-44`, via `convert_lead_to_client_atomic`, which stamps `clients.lead_id`) is the
   only code that writes an `additional_policies` array; every other path carries the key by reference
   (`supabase-clients.ts`, `teamOpenLeadEdit.ts`, `FullScreenContactView.tsx`) and `import-contacts` never writes it.
   The assumption holds, so attribution proceeds. Per client (one lateral row, so no join can multiply policies):
   attributed to campaign X only when, among same-organization wins with `contact_id = client.id` and a non-null
   `campaign_id`, exactly one carries `idempotency_key = 'conversion:' || clients.lead_id`, all of them name the same
   campaign X, and X is a campaign of the same organization. Otherwise (no lineage, conflicting campaigns,
   foreign-organization campaign, manual/imported client with no `lead_id`) the client's policies are counted in
   `policies_without_campaign`. Campaign rows lose the `policies_sold` (COUNT(wins)) field; they carry
   `attributed_policies`; the payload carries `policies_in_period`, `policies_without_campaign` and
   `policy_attribution: 'conversion_lineage_only'`. UI: "Policies (campaign-attributed)" with the note "Conversion-lineage
   attribution only: not complete campaign sales attribution and not proof the campaign caused the sale." No ROI, no
   conversion rate.
3. **Current assignment is not seller credit (D-3).** Per-agent policy counts are "Policies (current assignment)" in
   Agent Performance, Agent Efficiency and every CSV (metadata `Note` rows state the basis). Top Performer becomes
   **"Most policies — current assignments"**. "Dials per policy sold" and "Talk minutes per policy sold" are shown ONLY
   for organization scope with no agent filter, described as "calls (or talk minutes) in the period ÷ dated stored
   policies in the period"; for own/team scope or an agent filter they are unavailable ("Not available: policies are
   credited to current assignment, not the original seller"). Reassignment regression added (SQL + Vitest). No seller
   ledger, ownership rewrite or win backfill.
4. **Fail-closed recovery (supersedes the 20.3.6 / 20.9 rollback).** Restoring the preimage bodies is NOT a production
   rollback: an old tab would accept win counts. Procedure, each step a NEW migration with Chris's approval:
   (a) `supabase/ops/reports_disable.sql` (unchanged) — revokes all six `get_report_*` from authenticated; old AND new
   tabs render "Reports are temporarily unavailable"; legacy stays sealed.
   (b) Optional, only while disabled: the preimage fixture
   `supabase/migrations/rollback/20260930120000_…rollback.sql` — refuses unless all six are client-disabled, restores the
   win-based bodies verbatim, drops the two helpers, and leaves everything disabled.
   (c) Re-enable only via `supabase/ops/reports_enable.sql`, now guarded: it refuses unless summary / volume / campaign
   carry the verified policy-based bodies (exact md5s). So the only path back is re-applying the forward migration
   (which preserves whatever ACL state it finds, i.e. stays disabled) and then enabling.
   Legacy `rpc_report_*` stay sealed at every step. Tested locally end to end; the fixture is never described as a
   standalone production rollback.
   Frontend: `policy_source: 'normalized_policies'` is required by the new schema (a win-based payload → `unavailable`);
   a disabled function (`permission denied for function`) → `unavailable` for old and new code alike.
5. **Release sequence (for separate approval; nothing changed or deployed now).** Facts: the Vercel production project
   deploys `main` automatically through its Git integration (every prior release, e.g. `dpl_4Lu4ibn8…`); the Supabase
   GitHub integration's "Deploy to production" is DISABLED (AGENT_RULES #30), so merging never applies a migration —
   migrations go only through the deliberate MCP `apply_migration`. Therefore "merge, then apply" is frontend-FIRST.
   Designed to be order-safe:
   - New frontend + old functions: the summary / volume / campaign panels show "unavailable" (no `policy_source`),
     never win counts under the new labels; other panels are unaffected.
   - Old tab + new functions: summary and volume parse (field names unchanged) and show the correct policy counts,
     but with the old labels ("policies (wins)", "Top performer", per-agent dials-per-policy); the campaign panel
     fails validation (no `policies_sold`) → unavailable. A reload is required; stated in the release note.
   - Controlled order: (1) CI green on the PR; (2) read-only preflight (live md5s = 20.1, 0 active dialer sessions);
     (3) merge → Vercel production READY (new UI, three policy panels "unavailable"); (4) `apply_migration` with the
     exact file; (5) verify md5s/ACLs + an authenticated September read = 4; (6) ask signed-in users to reload.
     Neither order depends on winning a deployment race. Integration settings are not changed.
6. **Verification** as listed in the approval; pre-existing failures reported separately.

**Revised exact file list (rev 2):**
- New: `supabase/migrations/20260930120000_reports_policies_sold_normalized_source.sql`;
  `supabase/migrations/rollback/20260930120000_reports_policies_sold_normalized_source.rollback.sql` (preimage fixture);
  `supabase/tests/reports_policy_facts.sql`.
- Modified SQL/ops/test infra: `supabase/ops/reports_enable.sql` (policy-body guard); `supabase/tests/reports_harness.sql`
  (production-shaped `clients`, win `idempotency_key`); `supabase/tests/reports_rpc.sql` (policy expectations);
  `scripts/run_reports_rpc_tests.sh` (policy migration, suite, mutations, drift/replay, recovery proof);
  `.github/workflows/reports-backend.yml` (path filter, if needed).
- Modified app: `src/lib/reports-schemas.ts`, `src/lib/stat-computations.ts`, `src/lib/reports-export.ts` (notes rows),
  `src/pages/Reports.tsx` (policy notes on exports, summary export labels), `src/components/reports/PoliciesSoldChart.tsx`,
  `src/components/reports/CampaignPerformance.tsx`, `src/components/reports/AgentPerformanceCards.tsx`,
  `src/components/reports/AgentEfficiency.tsx`.
- Modified tests: `src/lib/__tests__/reportsFixtures.ts`, `reportStatComputations.test.ts`, `reportsContracts.test.ts`,
  `reportsExportFormat.test.ts`, `reportsQueries.test.ts` (if needed), `src/pages/__tests__/reportsPage.test.tsx`.
- Docs: `AGENT_RULES.md` (#38, cross-refs in #17/#34), `WORK_LOG.md` (prepended), this plan.

### 20.12 As built (2026-09-30) — branch `claude/reports-policies-sold-source-vqvh26`; NOT merged, NOT applied, NOT deployed

- **Migration (NEW; the applied `20260929152553` is byte-identical to main, pinned by test):**
  `supabase/migrations/20260930120000_reports_policies_sold_normalized_source.sql`, SHA-256
  `b4cfc36c2b0eb370435a29456f08259ea0dfebc4ac18f6e80bb046477e1118a0` (42,160 bytes). Authored version; `apply_migration` will
  stamp its own version, and the filename (plus runner/test references) is reconciled afterwards with bytes unchanged (#35).
  - Preflight: live md5s of summary `f221e1d4…`, volume `604abca3…`, campaign `9d151bf9…`, `report_access` `27116a40…`,
    `report_window` `1107da18…`, `profile_parse_iso_date` `be24ed08…` (all equal to the repo build on PG16.13); owner/SECURITY
    DEFINER/STABLE/search_path; ACL exactly enabled or exactly disabled; clients/wins column shape; replay refusal.
  - Three private helpers; three `CREATE OR REPLACE` bodies generated from the applied bodies by exact single-occurrence
    replacements of the wins source only. Resulting body md5s: summary `826736e666a12d0d85ec3797b2556792`, volume
    `b4f7d891d7fb29962c86b668a1a2aee6`, campaign `ad2e005906f5d38dc1ee0308ad368f04` (embedded in the enable guard and the fixture).
  - Postconditions: metadata, ACL unchanged from preflight (never re-enables), no body reads `public.wins`, helpers
    client-unreachable, legacy sealed.
- **Recovery files:** preimage fixture `supabase/migrations/rollback/20260930120000_…rollback.sql` SHA-256
  `5bdb986618e42aac0d22833f618b3d8d49eab95d779d9723e5e2d76b22f1c771` (refuses unless all six `get_report_*` are
  client-disabled; restores the three preimage bodies verbatim; drops the helpers; stays disabled). `supabase/ops/reports_enable.sql`
  SHA-256 `16770f3da54a2fad1942f19732c27ea1ba64e831f5cf5b95350b11726d9f9885` gains the POLICY-SOURCE GUARD before any grant.
  `supabase/ops/reports_disable.sql` unchanged (`8cc967c4…`).
- **Additional-policy writer assumption re-verified before coding** (see 20.11.2) — holds.
- **Frontend:** schema requires `policy_source` / `policy_basis` / `policy_quality` (summary), `policy_source` / `policy_quality`
  (volume) and the campaign lineage fields; one wording module `src/lib/reports-policy-text.ts` (new — added to the 20.11 list)
  for on-screen notes and CSV `Note` rows; "Most policies — current assignments"; "Policies (current assignment)";
  "Policies (campaign-attributed)"; per-policy ratios organization-unfiltered only.
- **Expected production result (Chris's org, 2026-09-01 … 2026-09-29, organization scope, from the 20.1 read-only facts):**
  `totals.policies_sold = 4` (4 primary, 0 additional; wins would say 2); `by_date` sums to 4; `policy_quality` 0 / 0;
  Dials per policy sold = outbound calls made ÷ 4; Campaign Performance: at most 1 of those 4 can be campaign-attributed
  (only 1 of the org's 8 policies has a campaign-bearing conversion win) and the rest appear in `policies_without_campaign`.
  These are predictions from read-only aggregates; they are verified only after an approved apply.
- **Remaining limitations:** current-assignment attribution (no seller ledger); conversion-lineage-only campaign attribution;
  the TS/SQL edge divergences (follow-up: align `normalized-policy.ts`); Dialer header / Leaderboard / Group still count
  wins or clients by design; old tabs need a reload after release; `report_policy_quality` re-reads the facts (fine at
  current volume; revisit with an index plan if client counts grow by orders of magnitude).


### 20.13 ChatGPT takeover — final privacy and fixture corrections (2026-10-02)

Chris explicitly asked ChatGPT to implement and complete the two review corrections because Claude is unavailable.
Branch: `codex/reports-policy-final-fixes-20261002`, based on `037ec13e`. Production remains read-only; exact production
migration and merge approval remain separate under #28.

Intended files: the UNAPPLIED policy migration, its disabled-only rollback, reports_enable.sql, SQL runner,
reports_harness.sql, reports_rpc.sql, new reports_fixtures.sql, new reports_campaign_visibility.sql, new fixture
setup guard tests; Reports campaign/disposition schemas and labels, shared export notes, fixtures and page/contract
tests; isolated GitHub verification workflow; AGENT_RULES, WORK_LOG and this section. No applied SQL bytes change.

- One private visibility resolver mirrors the live campaigns_select policy and validates the actual actor. Both
  campaign performance and the disposition by-campaign breakdown use it, since inspection found the same name
  exposure in both. Policy counts and call counts remain scoped independently; hidden campaign metadata never
  leaves the server. Unavailable attribution combines absent, ambiguous and restricted links without identifying them.
- Fixture setup is separated from assertions and must succeed before any mutant is exercised. An injected broken
  fixture must stop the runner, never count as a killed mutant. Production preflight/postcondition guards are intact.
- Tests run against disposable localhost PostgreSQL with synthetic data and read-only repository credentials where
  possible. Temporary workspace/bootstrap tooling is removed from the final PR. No production tests or data writes.


### 20.14 Production release (2026-10-02) — supersedes earlier NOT APPLIED status

PR #399 is merged as e04eb16dc6fc70734f85868ab5235186d0ce4813. The production frontend is READY.
The exact reviewed policy migration is applied as version 20261002160849, with SQL SHA-256
15355717f39fe2cb6b33386334d785f672e167ea5774866322b262dcd9d551d5 (51,115 bytes).
Forward and rollback filenames are reconciled to that version without changing SQL contents.
Authenticated database-context reconciliation now confirms September 1–29 Policies Sold = 4,
daily chart = 4, and current-assignment agent counts 2 / 1 / 1. Private helpers and legacy seals
are verified; advisors were run. No customer rows or unrelated runtime behavior were changed.
Full release evidence, tested-head references and limitations are recorded in
docs/plans/2026-09-28-reports-analytics/POLICIES_RELEASE_2026-10-02.md.
Signed-in browser interaction is still unverified; old tabs should reload.


---

## §21. Team campaign lead visibility — display-only scope (October 2, 19:22 LA)

Chris clarified and approved: current Team leads show the existing full details grid without waiting for a call to connect; keep locking and ownership logic unchanged. The new manager review workflow and full-record access expansion are withdrawn from this release.

Implementation and release checks: `docs/plans/2026-09-29-team-campaign-visibility/implementation_plan.md`. Display-only changes retain canonical current-lock confirmation, stale-load masking, and existing Edit/Sold/Convert gates. No new RPC or Contacts read permission. Existing authorization may still limit master fields; retain the campaign-copy notice. The two earlier applied migrations remain recorded and are not rerun. Pending P2 and its frontend hook are removed. PR #401 is the narrowed review/release surface.


## §22. Floating dialer disposition agency scoping — APPROVED October 3, 2026

Chris explicitly approved the seven-file plan at 08:35 PDT for isolated implementation and verification. No publication, merge, deployment, or production mutation is authorized. Plan of record follows; approval supersedes its original awaiting-approval status.

# BUGFIX — Floating dialer disposition agency scoping

Date: October 3, 2026 (America/Los_Angeles)
Status: Proposed implementation; awaiting Chris's explicit approval
Repository: cgarness/agentflow-life-insure
Reviewed main: `40e0deaed008dafb3674235930bf7bb941546989`

## Outcome and authorization

The floating dialer will show the current agency's configured dispositions and conversion metadata. It will retain the existing layout, configured labels/colors/order, canonical disposition UUIDs, callback handling, conversion flow, and server-authoritative DNC persistence.

This document authorizes no implementation by itself. Chris requested the investigation and plan, and explicitly required approval before application edits or backend changes. This turn creates the review plan only. After approval, implement on an isolated branch and run local verification. Publication, merge, deployment, live customer calls, and production mutation remain outside this approval.

## Evidence and source review

- Reviewed repository rules, VISION.md, newest WORK_LOG.md entries, current FloatingDialer.tsx, disposition and pipeline services, disposition persistence, useOrganization, existing floating-dialer tests, and the current TwilioContext outbound path and guards.
- GitHub main still equals the reviewed local checkout. The source checkout was clean.
- `FloatingDialer.tsx` directly loads all RLS-visible dispositions and lead pipeline stages in two mount-only effects. Neither lookup has an organization filter; neither reports load failure.
- `dispositionsSupabaseApi.getAll(organizationId)` already requires an organization, filters explicitly, preserves configured order, and throws on query error. Its domain fields use camelCase.
- `pipelineSupabaseApi.getLeadStages(organizationId)` already scopes by organization and lead pipeline type and throws on query error. The new loader must require context itself because that service returns an empty array when organization is missing.
- Live read-only evidence collected in this conversation: Chris's home agency has six dispositions, with no duplicates. Other agencies have same-label rows. The live dispositions SELECT policy permits Super Admin cross-agency reads, so RLS cannot substitute for the missing UI query filter.
- The live `advance_campaign_lead` function resolves disposition UUID and actor organization together and raises "Disposition not found" on mismatch. Preserve this database protection.
- 1,669 home-agency calls with resolvable disposition IDs had zero foreign-agency references. This is a bounded reference audit, not proof of completeness or correctness of all historical outcomes.
- PR #402 shipped the DNC fix. WORK_LOG records migration 20261003043122, webhook v36, and frontend e5c15f7. The new plan does not revise those deployed database/telephony artifacts.

Source: https://github.com/cgarness/agentflow-life-insure/tree/40e0deaed008dafb3674235930bf7bb941546989

## Concurrent work

Open PRs checked: #398 underwriting, #383 leaderboard resilience, #382 containment records, #381 leaderboard work log, #378 Google OAuth, and #294 AI testing. Their retrieved changed-file lists do not overlap FloatingDialer or its disposition test. Several overlap shared documentation; #378 and #294 also touch root implementation_plan.md.

Preserve unrelated documentation byte content when adding this task. Recheck main, open changes, and the work log immediately before implementation and again before publication. This check does not establish the absence of unpublished work in other agents' workspaces.

## Implementation design

### 1. Load one complete, scoped configuration

Add `useFloatingDialerDispositions.ts`, kept under 200 lines where practical.

- Accept the resolved agency ID and authenticated user identity. No read occurs while either required context is absent.
- Reuse `dispositionsSupabaseApi.getAll` and `pipelineSupabaseApi.getLeadStages`. Do not modify those shared services.
- Adapt their returned objects to the existing floating-dialer field names and `isConvertedDisposition` shape. Preserve UUID, name, color, order, note requirements, callback flag, automation metadata, and pipeline-stage reference.
- Commit a configuration snapshot only when both reads succeed for the same current request and identity. A pipeline lookup error must never make Sold appear non-converting.
- Use an explicit request generation and scope identity. A superseded request, unmount, or A → B → A transition cannot publish an older result.
- Derive visible options synchronously from the current scope and snapshot identity. Waiting for an effect to clear old state is insufficient: there must be no render in which agency B sees agency A's options.
- Distinguish unresolved context, loading, valid empty configuration, error, and ready. Retry starts a new generation; repeated retry cannot let an older request overwrite it.
- No polling, storage persistence, new dependency, or global cache is required.

### 2. Integrate with the existing wrap-up

Replace the two unscoped effects in FloatingDialer with the hook.

- Keep the same two-column disposition grid.
- Show concise loading, empty, or failure text in the existing wrap-up area. Include a Retry action for failure/empty configuration.
- Derive selection validity from the active configuration identity, not just a matching label or UUID. Clear the previous selection when scope changes.
- Save & Close is enabled only for a ready, current configuration and a valid selected UUID, in addition to existing form requirements.
- Apply the same readiness/scope checks inside the save handler; a disabled button alone is insufficient.
- Bind pending wrap-up and conversion callbacks to the call's original user/agency context and call ID. A configuration switch must not retarget the old call to the new agency. Recheck context after asynchronous work before subsequent actions.
- Preserve wrap-up, notes, and the existing call ID after ordinary load/save failures in the same context. Do not expose an earlier user's draft after an account change. A changed identity blocks the pending save instead of reporting success.
- Keep canonical server persistence and PR #402's duplicate-save guard, idempotent call operation ID, conversion retry behavior, and success-only reset.
- Do not deduplicate by name or introduce hardcoded disposition lists.

No form fields are added. Existing validation behavior remains; if a form schema must change, use Zod. Use Tailwind for new UI. Preserve existing configured dynamic colors without a styling refactor.

## Exact proposed repository file list

| File | Proposed change |
| --- | --- |
| `src/components/layout/FloatingDialer.tsx` | Replace unscoped configuration effects, wire status/retry UI, and guard selection/save/conversion against stale scope. |
| `src/hooks/useFloatingDialerDispositions.ts` (new) | Scoped configuration loading, mapping, complete snapshot state, and request lifetime guards. |
| `src/hooks/__tests__/useFloatingDialerDispositions.test.tsx` (new) | Mixed-agency lookup and asynchronous scope/load/error regression coverage. |
| `src/components/layout/__tests__/floatingDialerDisposition.test.tsx` | Extend the existing real-component harness for scope, status, canonical-ID save, draft retention, callback, and conversion regressions. |
| `AGENT_RULES.md` | Add a short clarification under agency scoping: floating-dialer configuration must be explicitly scoped, including Super Admin, and stale configurations cannot save. |
| `implementation_plan.md` | Append this task and its approval/as-built record without replacing unrelated plans. |
| `WORK_LOG.md` | Add a newest-first implementation/verification entry after work is complete. |

Read/reuse only: `src/lib/supabase-dispositions.ts`, `src/lib/supabase-settings.ts`, `src/lib/dialer-api.ts`, `src/lib/dialer-disposition.ts`, `src/lib/report-utils.ts`, `src/hooks/useOrganization.ts`, and `src/contexts/TwilioContext.tsx`.

No migration, database function, RLS, Edge Function, package/lockfile, DialerPage, or TwilioContext edit is planned. Disclose any newly necessary file before editing it.

## Verification after approval

Use isolated synthetic fixtures with external boundaries mocked; never call customers or mutate production to verify this fix.

1. A Super Admin fixture exposes two agencies with identical names and different IDs/colors. Assert the actual service/query boundary applies organization filters to both configuration tables and that only the requested agency's rows reach the UI.
2. Cover missing organization, delayed resolution, user changes, A → B, A → B → A, out-of-order results, unmount, rapid retry, and stale errors after a successful newer result.
3. Test disposition failure, pipeline failure, valid empty results, retry recovery, and prevention of partial configuration use.
4. Verify configured IDs, labels, colors, order, note constraints, callback flags, and conversion references survive mapping. Do not test by name-only deduplication.
5. Verify both disabled-state and handler-level rejection of stale selection. No canonical RPC or conversion starts from unavailable or mismatched configuration.
6. Verify a successful selection submits its canonical disposition UUID and original call ID; save failure retains wrap-up and notes and retry creates no additional call.
7. Preserve and extend the existing Sold conversion-gate/retry test. Cover context changing while conversion is pending and stale conversion completion.
8. Cover the existing callback path, including responsible user/creator stamping, and retain DNC failure/replay tests. The appointment-scheduler feature gap below remains excluded.

Planned checks:
- Focused Vitest runs for the new hook and existing floating disposition suite.
- Existing `src/lib/dialer-disposition.test.ts`, `src/utils/dncCheck.test.ts`, and `src/lib/twilio-dnc-admission.test.ts`.
- `npx tsc --noEmit`.
- `npx tsc -p tsconfig.app.json --noEmit`; compare with the exact unchanged base because root tsc alone does not prove application typing.
- Targeted lint and `npm run build`.
- Review the diff to confirm no telephony, backend, dependency, or unrelated UI changes.

The latest work log reports 88 existing app TypeScript diagnostics versus an earlier baseline of 90. That is historical evidence, not this task's result; establish the actual same-base comparison after approval. Broaden testing only if these checks identify a concrete remaining risk.

## Preserved behavior and risks

- Browser Voice.js remains the outbound call initiator. TwilioContext continues to own call creation, re-entrancy, DNC admission, status handling, and lifecycle; Twilio webhooks own canonical duration.
- Database authorization remains authoritative. Frontend filtering is an additional correctness boundary, not replacement RLS.
- A failure to load either configuration source temporarily blocks disposition submission until Retry succeeds. This prevents an incomplete configuration from changing the interpretation of Sold.
- Existing pending-call protection must be preserved through asynchronous conversion and retries. Context changes may require returning to the original valid context; they must never silently move a draft or call between agencies.
- No disposition deletion, historical repair, name-based coalescing, or production cleanup is needed.

## Separate findings — not part of this approval

1. FloatingDialer loads and renders callback scheduling but omits `appointment_scheduler`; its Appointment Set button therefore lacks the main Dialer's scheduling parity. Fixing that adds workflow behavior and needs a separate task.
2. DialerPage's disposition list is scoped, but its separate `pipelineStagesConversion` query is unscoped and has an organization-independent query key. This is a related follow-up; this narrowly scoped plan does not edit the main Dialer.
3. The existing floating-dialer tests use mocks whose `.eq()` calls do not filter fixture rows. New tests must verify the actual scope behavior instead of allowing that mock to hide the defect.

## Context snapshot and approval

Changes made this turn: this review plan only.
Decisions: reuse scoped services; require complete current configuration; preserve layout and PR #402.
Migrations/deployments/production changes: none.
Verification: source and concurrency review completed; implementation checks not run because application edits await approval.
Blocker: explicit implementation approval required by Chris's FIRST step 4 and AGENT_RULES workflow §8.
Next: approve the seven-file implementation and isolated verification scope. Publication, merge, deployment, and any production mutation require their own explicit authorization.

### §22 as built — October 3, 2026

Chris approved implementation and isolated verification at 08:35 PDT. The seven-file implementation is complete on `codex/floating-dialer-agency-scope`, based on `40e0deaed008dafb3674235930bf7bb941546989`. No files beyond the approved list were changed in the candidate.

- New 85-line hook reuses both existing organization-scoped services, adapts their fields, waits for both results, and publishes only a complete current request snapshot. No dependency, shared-service, database or telephony change.
- Snapshot identity is checked during render and inside asynchronous continuations; account/agency/request changes immediately invalidate visible options and selection. Loading, valid empty, failure and Retry stay inside the existing wrap-up layout.
- Wrap-up is bound to the original call's user/agency. Foreign-context notes stay hidden. Pending conversion callbacks and subsequent save effects require the same current configuration and call. Ordinary persistence failures retain the call, draft and converted client for retry.
- Verification: all 54 focused tests pass across five files; no React act warnings/unhandled errors in the final run. The mixed-agency duplicate-button regression fails against the unchanged base and passes with the fix. Root tsc and build pass. App tsc retains exactly 88 base diagnostics after line/column normalization. Targeted lint has zero errors and the single pre-existing FloatingDialer dependency warning; build retains its existing large-chunk warning.
- Source and concurrency recheck: main is unchanged. Open PR code files do not overlap the floating-dialer changes; shared-doc merge conflicts remain possible. Preserve all unrelated work when eventually publishing.
- Scope review: PR #402's canonical persistence, DNC enforcement, Twilio re-entrancy/call creation/status/duration ownership and all backend files are unchanged. No production data/settings modifications, live calls, migration, Edge deploy, frontend deploy, or remote publication occurred.
- Appointment Set scheduling parity and DialerPage's separate conversion-stage query remain explicit follow-ups. No authenticated production-browser verification is claimed.
- Remaining authorization: publish branch/PR, then merge/release only after Chris's explicit approval. Implementation and local verification are complete; deployment is not complete.

### §22 release authorization — October 3, 2026, 09:00 PDT

Chris approved publishing the reviewed candidate, merging through its PR after checking results, and verifying the normal frontend production deployment. This supersedes the remaining-authorization statement above. The exact seven-file scope and all backend exclusions remain. Only this plan and WORK_LOG.md receive authorization/release evidence updates; no additional application files are planned. Record actual PR/check/deployment identities after observation, without claiming authenticated browser or live-call verification.

### §22 necessary verification correction — discovered in PR #404

The DNC CI runner stops before its assertions because `supabase/tests/dialer_dnc_upgrade.sql` still includes the authored migration filename `20261003022218`, removed when PR #403 reconciled the applied timestamp to `20261003043122`. Add exactly this eighth file to the implementation list before editing it: **supabase/tests/dialer_dnc_upgrade.sql**. Change only the include path to the existing shipped migration. This is a test-harness repair needed to execute the preserved DNC gate; no migration bytes, assertions, database schema, production state or application behavior change. The seven original files remain as listed above. Verify the complete DNC workflow on the new PR head; do not weaken its checks.

### §22 release closeout — October 3, 2026

PR #404 merged as `a6c01c2afa35bcfe4642d488df1ecee1bb5004bb` after all checks passed at `39d9c8e0c80d70ecf2f958f2f4de7cac2c121627`. Tested and merged trees match exactly (`cd3014dc28bddb82e1671a590b6fe00bb5e68d25`). DNC CI passed 486 tests plus real PostgreSQL transaction/concurrency/security/replay checks. The full frontend comparison passed with 4,002 passing candidate tests versus 3,981 on base, unchanged existing failures and 88 app type errors, zero unhandled errors; root tsc, Reports tests, lint and build passed. Both production Vercel projects are READY at the merge SHA. `www.fflagent.com` HTML and its served entry bundle returned 200 and contain the new configuration guards. Exact deployment IDs and limitations are in the newest WORK_LOG.md entry.

No migration, RLS/data change, Edge/telephony deployment or live call occurred. No authenticated production-browser verification is claimed. Scheduler parity and the main Dialer's separate stage reader remain out of scope. No release blockers; next step is refreshing existing tabs after calls end. Closeout changes only WORK_LOG.md and this implementation_plan.md, published through a documentation PR; all application and backend bytes remain at the verified release.

## §23. A2P registration — October 3, 2026

Chris approved implementation after the complete feature proposal. The isolated build, exact file list, provider prerequisites, verification, and production boundaries are recorded in `docs/plans/2026-10-03-a2p/implementation_plan.md`. No production registration, fee, migration, or deployment is authorized by this branch build.

### §23 production release authorization and backend verification

Chris approved applying the A2P migration, deploying the five backend functions, and merging PR #406 at 10:37 PDT on October 3. This supersedes the branch-only restriction above for those exact actions. Migration `20261003174429` and all five complete Edge bundles are deployed and verified; account configuration is empty and submissions remain disabled. Reconcile the migration filename/test reference without changing SQL bytes, append deployment evidence to the existing A2P docs/WORK_LOG/AGENT_RULES, rerun CI, and verify the frontend after merge. Twilio entitlement/mappings/fees, Event Streams and worker setup remain activation prerequisites; no paid registration or customer message is authorized.

## §24. Contact Details / Field Layout logical identity — October 3, 2026

Status: Chris explicitly authorized isolated branch implementation and verification in this task. No further proposal/approval pause for this build. Merge, deployment and production changes remain separately gated.

Base: main `84829dfe59e1da4d3ab5974bb1b763f5a886008c`, verified by fresh origin fetch. AGENT_RULES confirms production ref `jncvvsvckxhqgqvkppmj` (the alternate spelling in the request is incorrect); no production connection is needed. Open PR #407 (`codex/contact-history-20261003`, `dd6fd0dd`) changes this same Contact component's history/loading/save activity areas; retain main's implementation and verify local merge compatibility rather than pulling unrelated work into this branch. Other open PRs concern underwriting, leaderboard, OAuth and testing. Current source still has three overlapping custom render loops and physical-definition layout entries. Existing import normalization/representative selection, scoped getAll API, required validation, reserved metadata and save-policy helpers reviewed.

### Exact file list before application edits

- NEW `src/lib/contact-detail-fields.ts`: one deterministic, pure builder for standard/custom identity, placement, populated visibility and non-coercing editor metadata; reuse import-field-matching normalization and representatives. Keep each exact stored key separately, even case/space variants; exclude only exact reserved metadata. Active accessible definitions provide metadata/empty fields, never permission expansion. Preserve any required constraint across duplicate definitions.
- `src/components/contacts/FullScreenContactView.tsx`: render one list, exact-key custom reads/writes (including periods), populate-only viewing, complete permitted editing, preserve mismatched scalar/structured values and status/ownership positioning. Scope field configuration to current org/user/type at render time, reject late requests. Keep save/cancel/failure, columns, history, appointments and ownership controls.
- `src/components/settings/ContactManagement.tsx`: same builder for reorderable identities and standard-field registry; preserve physical-row custom administration and existing user/agency ownership; isolate Field Layout lifecycle across organization/user switches.
- NEW `src/lib/__tests__/contactDetailFields.test.ts`
- NEW `src/components/contacts/__tests__/fullScreenContactViewFieldVisibility.test.tsx`
- NEW `src/components/settings/__tests__/contactManagementFieldLayout.test.tsx`
- `implementation_plan.md` (append only), `AGENT_RULES.md` (document invariant), `WORK_LOG.md` (newest first).
- Necessary test-list adjustment: `src/lib/__tests__/clientCustomFieldsWriteGuard.test.ts` currently asserts FIVE literal guard calls and the three obsolete loops. Replace that structural assertion with a shared-builder wiring assertion plus behavioral reserved-key coverage; retain all write-boundary and policy-shape checks. No assertion will be removed merely to get a pass.

### Design and verification

Use synthetic ten-key fixtures with the audited duplication pattern, never personal/underwriting data. Saved order wins; repeated references collapse; supported standard fields and active custom fields append deterministically; stored values without a definition remain. Metadata disagreements use a non-destructive editor; no-op/unrelated edits preserve the entire bag and additional_policies. Definition-only grouping never renames JSONB keys. Preferences are never rewritten on open. Existing required standard checks remain; custom required constraints apply to the logical group without requiring duplicate aliases.

First add a mounted regression and run it against unchanged application code. Then cover one/three definitions, lead/client/recruit, populated/empty/0/false, unknown/inactive fields, repeated/stale layouts, variants, metadata conflicts, no-op/unrelated saves, cancel/failure/required guards, Admin/Agent and scope changes. Run existing import/layout/save/reserved suites and Contacts/deep-link entry tests. Run root tsc, actual app tsc against exact base, scoped lint and production build. Run desktop/narrow-screen browser with disposable synthetic fixture boundaries; no production network or synthetic production rows. Record pre-existing failures separately. Recheck main and PR #407 overlap before final commit. This plan preserves all unrelated existing bytes above.

### §24 verification adjustment and concurrent release integration

Before expanding tests: also edit `src/pages/__tests__/contactsFullScreenDuplicateParity.test.tsx` and `src/pages/__tests__/contactDeepLinkDuplicateParity.test.tsx`. The former currently replaces Contact Details with a recorder; retain those existing parent contract tests and add opt-in real-component fixture coverage for all three contact types. Add the equivalent field-preservation case to the latter's already-real page/component/API mount. This closes the composed entry-point verification gap without changing either application page.

PR #407 and its documentation closeout #408 merged during verification. Rebased this branch onto fresh main `c8b3a682f701a6421ba7439288f87b1e7d33b80f`; the field changes apply cleanly and the shipped history loaders, Activity refresh, appointment and contact-save paths remain intact. Re-run focused/history verification and app type comparison against this current base before committing.

Before the final test adjustment: also edit `src/components/contacts/__tests__/fullScreenContactViewScore.test.tsx`. Its existing read-mode test requires a DOB label although the fixture has no DOB. Update that single obsolete expectation to the approved populated-only viewing behavior, and positively assert the empty DOB editor remains available. Keep every Score-hiding and populated-field assertion intact. The initial expanded run found exactly this behavior-change failure (460 passed, 1 failed, 3 existing skipped); no production implementation is changed to satisfy an obsolete visibility expectation.

### §24 as built — branch implementation; browser gate outstanding

- Final base: `c8b3a682f701a6421ba7439288f87b1e7d33b80f` (includes shipped Contact history #407 and closeout #408). Branch: `codex/contact-detail-field-identity`. Exactly 13 planned/documented files: 3 application, 7 tests, 3 project documents. No dependency/config/backend/import/telephony file changes. Unrelated untracked A2P-wizard planning files are excluded.
- One shared projection replaces all three renderer paths and physical-row Field Layout construction. Exact JSONB keys (including dots and standard-field names), 0/false, unknown/inactive values, case/space conflicts, legacy amounts/dates/options, required group constraints and reserved metadata are retained. Legacy structured non-reserved values are displayed read-only. Order/visibility aliases resolve without writes on open. Role/ownership controls remain; current agency/user field snapshots replace stale ones.
- Mounted duplication regression fails against BOTH unchanged audit base `84829dfe` and unchanged current base `c8b3a682`: one definition produces two displays; three definitions produce four. Both pass with this branch. All fixtures are synthetic.
- Final focused run: **26 files pass, 461 tests pass, 3 existing timezone-conditional scheduling tests skip under UTC**. Separate `TZ=America/Los_Angeles` scheduling run: **18/18 pass**, including those three. Thus every one of the 464 distinct selected cases ran successfully in its supported timezone. New helper/renderer/settings coverage plus real Contacts-page/direct-link composition tests pass for leads, clients and recruits; existing import matching/create/import UI, field layout, save-integrity/refusal/duplicate/status, reserved-policy, schedule, Quick Call, score exclusion, Conversation/Activity/history suites pass. No failed test or unhandled error remains in these runs. The existing status-save suite emits React act warnings; no assertion was suppressed.
- Root `npx tsc --noEmit`: exit 0 (the existing root config is not an application check). Actual `npx tsc -p tsconfig.app.json --noEmit`: 88 diagnostics on current base and 88 on candidate, identical diagnostic multiset after removing line/column offsets. Earlier audit-base comparison likewise matched at 88. No new diagnostic; repository is not globally type-clean.
- Scoped ESLint: 0 errors, same 10 pre-existing warnings as base. `npm run build`: exit 0, production assets generated; existing Browserslist-age and large-chunk notices remain. `git diff --check`: pass.
- Test adjustments retain all contract assertions: obsolete five-loop structural checks now pin shared reserved-safe projection wiring plus behavioral coverage; the old blank-DOB visibility assertion now proves hidden in viewing and available in editing; composed entry-point tests extend existing parent save tests without replacing them.
- **Browser NOT verified.** An isolated Vite fixture was prepared outside the repo with synthetic data and service boundaries. Agent-browser cannot start its daemon; direct Chromium cannot create its local socket (`Operation not permitted`); browser tool navigation to localhost is blocked (`ERR_BLOCKED_BY_CLIENT`). The escalation request was automatically rejected because sandbox approvals are disabled. No desktop/narrow screenshot, authenticated walkthrough or production data verification is claimed. Do not mark ready for production approval until desktop and narrow-screen fixture checks (view/edit/save/cancel and layout reorder/save/reopen) can run in a permitted browser environment.
- No merge, push, deployment, production record/definition change, database connection, migration, RLS, Edge, telephony or import change occurred. Correct production project remains `jncvvsvckxhqgqvkppmj`; the request's alternate spelling was not used. Branch is reviewable; browser gate and separate production authorization remain.

### §24 release authorization and CI compatibility

Chris reviewed the hosted preview and approved release at 14:35 PDT on October 3. This supersedes the branch-only/no-release status above for this exact frontend fix. PR #410 targets current main c8b3a682; remote a41f4630 has exactly the tested local tree 534a0237c14c30617addea062def894cb44a6f6b. Preview dpl_FDi9S7bUWDwbrBM2zADup1d46jyS is READY. The preview loads in the hosted browser; Chris reported it looks good. No completed automated desktop/narrow walkthrough is claimed.

The existing CI compares raw TypeScript locations. Adding the builder import moved an existing MappableCustomField.active diagnostic from ContactManagement line 528 to 529; remove one extra blank line above it so the unchanged error retains its original location. This is whitespace only, not a weakened check or behavior change. Keep the 13-file scope; record release evidence in these existing documents. Merge only after the normal frontend/DNC/A2P gates pass. No database, definitions, RLS, Edge, import or telephony changes authorized.

### §24 production release closeout

Closeout scope: only AGENT_RULES.md, WORK_LOG.md and this plan; preserve all runtime/test/configuration bytes and all previous document bytes. Chris accepted the preview and approved the release. PR #410 merged as `fbce826377dc993e574934ef713d151eaa01d9c6` from green head `a08cc66c17c45a990ce7da00f2c270bc906f5cc7`; exact tested/merged tree `be2b99ec4019a95ee3aa047f891ff493d5d9279d`.

Full frontend run `37155866517` passes: 4,091 passing candidate tests vs 4,039 base; same one pre-existing failed test and 11 failed files (10 setup/configuration-dependent suites plus recording-retention failure); identical 88 raw app TypeScript diagnostics; zero unhandled errors; root tsc, Reports tests, scoped lint and build pass. DNC run `37155866523` and A2P run `37155866491` pass. Focused 464-case coverage and owner preview acceptance remain as recorded above; no automated desktop/narrow pass is claimed.

Production primary `dpl_FqDf3qezc99Agret25wgFCHutruW` and secondary `dpl_6msRSgs2i7uhYSTXaLq9JUCPDAsP` are READY at the merge SHA, production target. Primary serves www.fflagent.com / fflagent.com. Both domain HTML and entry assets returned HTTP 200; both contain the field-settings guard and preserved contact-history reader. Assets: primary `index-DaPV_ZqG.js` (SHA256 `2ef2b0c1a47c2c3412db14c01a4db8219d152afcffcfe44720fbe0314fc6dfa4`), secondary `index-DzC2gzDN.js` (`918d10f4edeaecbb6862d1189329fe262815290e54753e932cb817b141a0ed8a`).

Implemented, reviewed, merged and deployed. No production data/definitions, database connection, migration/RLS, Edge, telephony, import processing or customer call/message change occurred. No signed-in production walkthrough or automated narrow-screen visual acceptance is claimed. Existing loaded tabs need a refresh after active calls end.


## October 8 SMS activation authorization

Chris instructed getting SMS working after A2P approval. The prepared backend release and guarded mapping are now applied with sending/relay paused. Complete secret provisioning, authenticated recovery, five-number registration and controlled consenting-recipient verification before activation. Earlier pending-approval notes describe the previous phase.


## 2026-10-09 — Google OAuth verification preparation

Chris authorized starting the submission work, with verification prioritized over broader integration usability. The scoped plan is [Google verification preparation](docs/plans/2026-10-09-google-verification/implementation_plan.md). It covers public legal review pages, homepage links, the existing logo and an evidence-based submission packet. Final legal publication and any production backend release remain separate concrete gates.
