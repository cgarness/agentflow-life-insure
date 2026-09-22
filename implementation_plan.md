# Implementation Plan — CSV Import › Create Custom Field fails with "You don't have permission to modify this custom field." (rev 1 — AWAITING APPROVAL)

> **STATUS (rev 1, 2026-09-22): RESEARCH COMPLETE. NOTHING IMPLEMENTED.**
>
> **Repository:** `cgarness/agentflow-life-insure` · branch `claude/csv-import-custom-field-perms-27jye2`
> · base `main` @ **`03bae62`**. The previous plan (ContactDeepLinkPage save lifecycle, #377) is
> preserved in git history at `03bae62`.
>
> **Only this file has been written.** No source, test, migration or doc file changed. No backend
> command was executed. **Production contact was read-only:** 10 catalog/count `SELECT` statements (one
> rejected by the parser with a type error before it ran) and 8 log queries against
> `jncvvsvckxhqgqvkppmj` (§B). No INSERT, no rolled-back INSERT, no DDL,
> no RPC invocation, no Edge call, no deploy (invariant #28).
>
> **Two approvals are needed, deliberately separate:**
> 1. **This plan** (§F code + tests + docs, local-only proofs).
> 2. **The exact production change in §I**, which I will ask for again, by itself, after the local
>    SQL proof passes. Approving this plan does **not** approve §I.

---

## §0. TL;DR

**The organization-mismatch hypothesis is refuted for the observed failures, and the root cause is
proven.** Production has had **zero successful custom-field creations, by any user in any role, since
2026-09-19 05:29:41 UTC**. That is when migration `20260919052941_custom_field_logical_name_guard`
added a support index over `private.custom_field_norm(name)`, and that function is executable only by
`postgres`.

PostgreSQL evaluates an **index expression as the role doing the write** and checks EXECUTE on every
function in it. So every `authenticated` INSERT of an active organization custom field goes through
four steps:

1. It passes the guard trigger. A trigger function's EXECUTE is checked only at CREATE TRIGGER time,
   not when it fires.
2. It passes the RLS `WITH CHECK`. The organization and `created_by` are correct.
3. It writes the heap tuple.
4. It dies in index maintenance with `42501 permission denied for function custom_field_norm`.

`friendlyCustomFieldError` maps every 42501 to *"You don't have permission to modify this custom
field."* That message is wrong on both counts: this is a CREATE, and the failure is a platform
privilege defect, not the user's permission.

**Fix, in order of importance:**

1. **Database (the actual repair; §F1/§I).** A one-line forward migration:
   `GRANT EXECUTE ON FUNCTION private.custom_field_norm(text) TO authenticated, service_role;`
   - No USAGE on schema `private` is granted, so the function stays uncallable by name.
   - The guard stays postgres-only. `anon` stays at zero.
   - No RLS, policy, table, index or data change.
2. **Frontend hardening, as you requested (§F2).**
   - Error translation is per operation. An INSERT never says "modify", and a privilege defect never
     blames the user.
   - `create()` re-proves the page's organization against `public.get_org_id()` (the exact RLS
     resolver, over RPC) and fails closed, with no INSERT, on mismatch.
   - `ImportLeadsModal` refuses creation under "View As".
   - The create query uses `.maybeSingle()`.
3. **Regression coverage (§F3).**
   - A new SQL suite that writes as `authenticated` with the production RLS policies. The existing
     suite ran every statement as a superuser, which is why this shipped.
   - Vitest coverage for every case in your list.
   - A local reproduction of the exact production error as a negative control.
4. **Docs (§F4).** A new AGENT_RULES invariant #37 for this defect class, and an amendment to #33.

---

## §A. What was asked vs. what the evidence shows

| Your premise | Evidence | Verdict |
|---|---|---|
| This is a CREATE, not an update | The failing statement is PostgREST's `INSERT … RETURNING` with exactly `create()`'s column set (E5) | ✅ Confirmed |
| RLS allows a personal create when `organization_id = get_org_id()` and `created_by = auth.uid()` | Live policy text matches (E1) | ✅ Confirmed |
| CSV import creates a PERSONAL field (no `orgWide`) | `ImportLeadsModal.tsx:688-696` passes no options; `supabase-settings.ts:212` sets `created_by = uid` | ✅ Confirmed |
| Chris's profile org and `raw_app_meta_data` org both equal `a0000000-…0001` | Not re-queried (your statement accepted). The browser's own reads carried `organization_id=eq.a0000000-…0001` (E6) | ✅ Consistent |
| "Find the frontend/session condition that makes the CSV organizationId differ from what RLS resolves" | The failing INSERTs **passed RLS**. PostgreSQL evaluates `WITH CHECK` before index maintenance, and there were 0 RLS violations logged (E5). The org sent **equalled** `get_org_id()`. | ❌ **Not the cause of this incident.** A *latent* divergence path does exist (§D), and it is hardened in §F2 as you asked |
| "Not an intended role restriction" | It is not a role restriction at all. It is a missing EXECUTE grant that fails **every** role identically (§E) | ✅ Stronger than stated |

---

## §B. Evidence — read-only production inspection (2026-09-22)

All `SELECT` / catalog / log reads. Nothing written.

| # | What | Result |
|---|---|---|
| **E1** | `pg_policies` on `public.custom_fields` | 4 policies, **byte-identical in meaning to baseline** `20260806000000:12008-12020`. INSERT: `organization_id IS NOT NULL AND organization_id = get_org_id() AND (created_by = auth.uid() OR (created_by IS NULL AND (get_user_role()='Admin' OR is_super_admin())))`. |
| **E2** | `pg_get_functiondef` of the resolvers | `get_org_id()`: JWT `app_metadata.organization_id`, then `profiles.organization_id` for `auth.uid()`. `custom_access_token_hook`: injects top-level `org_id` / `user_role` / `is_super_admin` **from `profiles`** at mint time. `get_user_role()`: JWT `app_metadata.role` only. `is_super_admin()`: top-level JWT claim. |
| **E3** | Table grants, triggers, RLS flags | `authenticated`: SELECT/INSERT/UPDATE/DELETE. `anon`: nothing. RLS on, not forced, owner `postgres`. Triggers: `custom_fields_updated_at`, `trg_custom_fields_logical_name_guard`. |
| **E4** | Guard + normalizer + schema ACLs | `private.custom_field_norm(text)` ACL `{postgres=X/postgres}`, not SECURITY DEFINER. `private.custom_fields_logical_name_guard()` SECURITY DEFINER, `{postgres=X/postgres}`. Schema `private` `{postgres=UC/postgres}`. Index: `custom_fields_org_norm_active_idx ON public.custom_fields (organization_id, private.custom_field_norm(name)) WHERE organization_id IS NOT NULL AND active IS TRUE`. |
| **E5** | `postgres_logs` | **Exactly 2 errors**, `2026-09-22 19:14:10.464` and `19:16:49.471 UTC`, both `ERROR 42501 permission denied for function custom_field_norm`. `application_name=postgrest`. The statement is `WITH pgrst_source AS (INSERT INTO "public"."custom_fields"("active","applies_to","created_by","default_value","dropdown_options","name","organization_id","required","type") … RETURNING …)`, i.e. `customFieldsSupabaseApi.create()`. **0** RLS violations on `custom_fields` in today's window. |
| **E6** | `edge_logs` | Two `POST /rest/v1/custom_fields?select=*` → **403** (macOS Safari) at the same instants. The browser's preceding `GET`s were `…custom_fields?select=*&organization_id=eq.a0000000-0000-0000-0000-000000000001…`, so the page's `organizationId` was Chris's home org. |
| **E7** | Row cadence (counts only) | 111 rows total. **0 created and 0 updated since `2026-09-19 05:29:41 UTC`.** Last creation `2026-09-17 22:20:31 UTC`. 7 created since Sep 1. |
| **E8** | Log-coverage check | The 09-19→09-20 window holds 4,669 `postgres_logs` + 450 `edge_logs` lines, yet **0** `custom_field_norm` errors on 09-19, 09-20 and 09-21. Retention is not the reason for the zero: nobody attempted a create between the guard landing and today's two attempts. |
| **E9** | **Catalog sweep for the whole defect class**: every `pg_depend` edge from an index, constraint, default, policy or view to a function a client role cannot EXECUTE (triggers excluded) | The **only** application object is `custom_fields_org_norm_active_idx → private.custom_field_norm(text)` (authenticated ✗, service_role ✗). The other hits are out of scope: two Supabase-managed `vault` internals, and `profiles_update_authorized → profile_authz.can_update_profile` (service_role ✗, but `service_role` has BYPASSRLS so the policy never evaluates for it). |
| **E10** | Privilege matrix + versions | `custom_field_norm` EXECUTE: anon ✗, authenticated ✗, service_role ✗, postgres ✓. `private` USAGE: all client roles ✗. `public.get_org_id()` EXECUTE: anon/authenticated/service_role ✓ (makes the §F2 pre-check possible with no DB change). Role attributes: `service_role` `rolbypassrls=true`, `rolsuper=false`, so EXECUTE checks **do** apply to it; `postgres` `rolsuper=false` but owns the function. Server **PostgreSQL 17.6**. Recorded migrations include `20260919052941 / custom_field_logical_name_guard`. |

---

## §C. Root cause

### C.1 Mechanism (PostgreSQL executor order for one INSERT)

1. **BEFORE ROW trigger** `trg_custom_fields_logical_name_guard` fires. EXECUTE on a trigger function
   is checked only at `CREATE TRIGGER`, never at fire time. The guard is SECURITY DEFINER, so its own
   internal call to `private.custom_field_norm` runs as `postgres`. It finds no conflict and returns
   `NEW`. *(Had it found one, it would raise 23505 here. Duplicate detection is therefore still
   working.)*
2. **RLS `WITH CHECK`** (the INSERT policy plus the SELECT policy, because of `RETURNING`). **Passes.**
   The org equals `get_org_id()` and `created_by` equals `auth.uid()`.
3. Constraints pass, and the heap tuple is written.
4. **Index maintenance** (`ExecInsertIndexTuples` → `FormIndexDatum`). The row satisfies the partial
   predicate (`organization_id IS NOT NULL AND active IS TRUE`), so the expression
   `private.custom_field_norm(name)` is initialized. `ExecInitFunc` checks EXECUTE **for the current
   role, `authenticated`**, is denied, and raises `42501 permission denied for function
   custom_field_norm`. The transaction aborts.
5. PostgREST returns **403**. `friendlyCustomFieldError` (`supabase-settings.ts:164-166`) sees 42501
   and returns *"You don't have permission to modify this custom field."*

The error names `custom_field_norm`, not `custom_fields_logical_name_guard`. That is itself proof
that the trigger function was not permission-checked and the index expression was.

### C.2 Why it shipped

- `supabase/tests/custom_fields_harness.sql:11-13` says: *"Deliberately NOT replayed here: RLS
  policies."*
- `scripts/run_custom_field_guard_tests.sh:5` runs against a `postgres@127.0.0.1` superuser connection, and
  no scenario runs `SET ROLE authenticated`. Superusers skip ACL checks, so the suite **could not** observe this.
- S18 asserted that client roles *lack* privileges on the guard and on schema `private`. It never
  performed a client-role *write*.
- The 2026-09-19 production verification was catalog-only, correctly, since production writes are
  forbidden. A catalog check cannot see an executor-time privilege check.

### C.3 Why the message misled everyone

`friendlyCustomFieldError` collapses three different things into one sentence:

- an RLS refusal (an authorization decision about the user);
- a missing GRANT (a platform defect);
- and it does this for INSERT, UPDATE and DELETE alike.

A DELETE refused by RLS also says "modify".

---

## §D. Organization / session resolution audit (your items 8, 9, 13)

### D.1 Two resolvers, two different priority orders

| | Frontend `useOrganization()` (`src/hooks/useOrganization.ts:53-59, 67-96`) | Database `public.get_org_id()` (RLS authority, E2) |
|---|---|---|
| 1st | JWT top-level `org_id`: **hook, `profiles.organization_id` at token mint** | JWT `app_metadata.organization_id`: **`raw_app_meta_data` at token mint** |
| 2nd | JWT `app_metadata.organization_id` | live `profiles.organization_id` for `auth.uid()` |
| 3rd | JWT top-level `organization_id` | — |
| 4th | effective `profile.organization_id` | — |
| Under View As | **viewed profile's** `organization_id` and `role` (`:71-77`) | unchanged: the **real** JWT |

### D.2 Conditions under which the page's org can differ from RLS's org

| # | Condition | Can it happen? | Did it cause this incident? |
|---|---|---|---|
| **C1** | `profiles.organization_id ≠ raw_app_meta_data.organization_id` at mint time. Example: an org move whose app-metadata projection has not landed. The frontend sends the hook's `org_id` while RLS compares against `app_metadata`. | Yes. `AuthContext.tsx:510-549` blocks the app for about 10 refresh attempts while `session.user.app_metadata.organization_id ≠ profile.organization_id`, **then renders anyway** with only `console.warn("[Auth] Token refresh timed out. Role/Org RLS evaluation may be stale.")` (`:535`). | **No.** E5/E6: RLS passed. |
| **C2** | The JWT lacks `app_metadata.organization_id` and `profiles` changed after mint. The frontend uses the stale hook claim; RLS uses live `profiles`. | Rare; the same refresh loop covers it. | No |
| **C3** | The React `session` snapshot lags the client's live token (between a refresh and `TOKEN_REFRESHED` → `setSession`). | Transient; it matters only if the claims changed at that refresh. | No |
| **C4** | **View As.** `useOrganization` returns the viewed user's org (same org, validated at activation and restore) but `create()` writes `created_by = auth.uid()` = the **real operator**. The org matches, so no RLS error, but the field would belong to the operator, not the viewed user. | Only if the import page mounted under View As. Today it cannot: `/contacts/import` is outside the allow-list (`viewAsSurfaces.ts`, pinned by `viewAsSurfaces.test.ts:44` and `viewAsRouteAllowlist.test.tsx:90`). | No (the route is blocked) |

**Conclusion.** None of C1–C4 caused Chris's failure. C1–C3 can only ever end in an RLS refusal that
the user sees as a misleading "permission" message. C4 is a silent mis-attribution, currently
unreachable. §F2 closes all four at the write site:

- An **org pre-check against `get_org_id()`** (C1–C3), which fails closed with an accurate,
  actionable message and sends no INSERT.
- A **View-As refusal** (C4), as defense-in-depth behind the route block.

Re-ordering `useOrganization`'s claim priority to mirror `get_org_id()` would also narrow C1/C2
globally. It touches 74 consumers and is not implicated here, so it is offered as **D-6 (recommend:
defer)**.

---

## §E. Blast radius (since 2026-09-19 05:29:41 UTC; fixed entirely by the §F1 grant)

| Operation (any role: Admin, Super Admin, Team Leader, Agent) | Outcome today |
|---|---|
| Create a field — CSV import mapper | ❌ always fails (42501 → "modify" message) |
| Create a field — Settings › Contact Management (personal or agency-wide) | ❌ always fails |
| Rename a field (UPDATE changes an indexed column → new index entry) | ❌ fails |
| Re-activate an inactive field (row enters the partial index) | ❌ fails |
| Edit type / required / options of an active field | ⚠️ **may** fail: a non-HOT update (no room on the page) builds a new index entry and hits the same check |
| Deactivate, delete | ✅ works (no expression evaluation) |
| Duplicate detection (23505 from the BEFORE trigger) | ✅ works: it fires before index maintenance |
| Importing CSV **values** into existing fields (`leads.custom_fields` JSONB) | ✅ unaffected |
| Any future `service_role` write of an active field | ❌ would fail (no server-side writer exists today) |

---

## §F. Proposed changes

### F1. Database: forward migration (production apply needs SEPARATE approval, §I)

**New file** `supabase/migrations/20260922200000_custom_field_norm_execute_grant.sql`. The version is
reconciled to whatever `apply_migration` records, and the contents are frozen (WORK_LOG 2026-09-18/19
practice).

```sql
-- Restore custom-field writes: every role that WRITES public.custom_fields must be able to EXECUTE the
-- function its index expression calls. PostgreSQL checks that privilege as the WRITING role during
-- index maintenance (trigger functions are exempt — they are checked only at CREATE TRIGGER). Since
-- 20260919052941 built custom_fields_org_norm_active_idx on private.custom_field_norm(name) and revoked
-- the function from PUBLIC, every authenticated INSERT of an active organization field has failed with
-- 42501 "permission denied for function custom_field_norm" (production, 2026-09-22 19:14/19:16 UTC).
--
-- STAYS CLOSED: no USAGE on schema private (the function remains uncallable BY NAME — an index resolves
-- it by OID, which needs EXECUTE only); private.custom_fields_logical_name_guard() stays postgres-only;
-- anon gets nothing (it holds no custom_fields privilege and never reaches index maintenance).
-- UNCHANGED: every RLS policy, the table grants, the index, the guard, all data.
GRANT EXECUTE ON FUNCTION private.custom_field_norm(text) TO authenticated, service_role;
```

**New file** `supabase/migrations/rollback/20260922200000_custom_field_norm_execute_grant.rollback.sql`:
`REVOKE EXECUTE … FROM authenticated, service_role;`. The file will carry a loud header warning that
**rolling back re-breaks every custom-field create**. Use it only together with the `20260919052941`
rollback or with alternative B below.

**Why this is safe.** `custom_field_norm` is:

- `IMMUTABLE`, `LANGUAGE sql`, `SET search_path = pg_catalog, pg_temp`;
- **not** SECURITY DEFINER;
- `lower(btrim(regexp_replace(coalesce(p_name,''), '\s+', ' ', 'g')))`, with no table access.

EXECUTE confers nothing a client could not compute locally. Without USAGE on `private`, and with
`private` outside PostgREST's exposed schemas, no client can call it by name.

**The applied migration `20260919052941` is NOT edited** (invariant #25).

**Alternatives (D-1):**

| Option | Change | Pros | Cons |
|---|---|---|---|
| **A (recommended)** | The GRANT above | One ACL entry, reversible, keeps the approved index-backed guard design, no locks | Adds a (harmless) EXECUTE grant on a `private` helper |
| B | `DROP INDEX public.custom_fields_org_norm_active_idx;` | No grant at all; removes the dependency | Reverses an approved design decision. The guard lookup degrades to `custom_fields_org_idx` plus a filter (negligible at 111 rows, O(fields per org) forever). Brief ACCESS EXCLUSIVE lock. |
| C (not recommended) | Rebuild the index on inline builtins and replace the guard's lookup expression to match | No grant | Replaces a live SECURITY DEFINER function; the largest diff; highest risk |

### F2. Frontend hardening

**1. `src/lib/custom-field-errors.ts` (extend; `isOrganizationWideCustomFieldConflict` untouched)**

- `type CustomFieldOperation = "create" | "update" | "delete"`.
- `isRowLevelSecurityRefusal(err)`: 42501 whose message matches `row-level security`.
- `isPrivilegeDefect(err)`: a message matching `permission denied for (function|table|relation|schema|sequence|view|column)`.
- `translateCustomFieldError(err, op)`. Replaces the private `friendlyCustomFieldError`. Order:
  1. org-wide 23505 → **unchanged** text + marker;
  2. other 23505 → **unchanged** text;
  3. privilege defect → a system message for `op`, marked `privilegeDefect: true`;
  4. RLS or any other 42501 / "permission" → the denied message for `op`;
  5. anything else passes through unchanged.
- `CustomFieldContextError` with `reason: "org_mismatch" | "org_unverified"`, and `isCustomFieldContextError()`.
- `CUSTOM_FIELD_MESSAGES`: every user-facing string in one place, tests pin them. **Proposed wording
  (D-5):**

| Case | Message |
|---|---|
| create · RLS refusal | You don't have permission to create this custom field. If your role or organization changed recently, refresh the page and try again. |
| create · privilege defect | Custom fields can't be created right now because of a system configuration problem. This isn't caused by your account's permissions — please report it to AgentFlow support. |
| update · RLS refusal / 0 rows | You don't have permission to modify this custom field. *(unchanged)* |
| update · privilege defect | Custom fields can't be changed right now because of a system configuration problem. This isn't caused by your account's permissions — please report it to AgentFlow support. |
| delete · RLS refusal / 0 rows | You don't have permission to delete this custom field. *(the 0-row text is unchanged; an RLS **error** previously said "modify")* |
| delete · privilege defect | Custom fields can't be deleted right now because of a system configuration problem. This isn't caused by your account's permissions — please report it to AgentFlow support. |
| org mismatch (pre-check) | Your session is signed in to a different organization than this page, so the field was not created. Refresh the page and try again — if it keeps happening, sign out and sign back in. |
| org unverifiable (pre-check) | We couldn't confirm your organization, so the field was not created. Refresh the page and try again. |
| INSERT returned no row | The custom field was not created. Try again. |
| View As | Custom fields can't be created while you're viewing as another user. Exit View As to create fields under your own account. |
| 23505 (org-wide and per-owner) | *unchanged* |

**2. `src/lib/supabase-settings.ts`**

- `create()` (`:191-222`):
  1. `requireOrganizationId`, then `auth.getUser()` (unchanged).
  2. **Then** a private helper `assertCustomFieldOrganizationContext(orgId)` calls
     `supabase.rpc("get_org_id")`. It is already typed in `types.ts:6419`, and `authenticated` holds
     EXECUTE (E10). The helper compares case-insensitively with the page org and throws
     `CustomFieldContextError`:
     - `org_mismatch` on inequality;
     - `org_unverified` on an RPC error, a transport throw, or a null/empty result.

     **No INSERT is sent in either case.**
  3. The payload is **unchanged**: `organization_id = orgId`, `created_by = orgWide ? null : uid`, so
     CSV-created fields stay personal.
  4. `.single()` becomes `.maybeSingle()` (rule 16), and a null result throws the "not created"
     message.
  5. Errors go through `translateCustomFieldError(error, "create")`.

  This is an accuracy guard, **not** a security boundary. RLS stays the authority, and a token refresh
  between the RPC and the INSERT still ends in a correct RLS refusal.
- `update()`: `translateCustomFieldError(error, "update")`; the 0-row message is unchanged.
- `delete()`: `translateCustomFieldError(error, "delete")`; the 0-row message is unchanged.
- The private `friendlyCustomFieldError` is removed; `translateCustomFieldError` supersedes it.

**3. `src/components/contacts/ImportLeadsModal.tsx`**

- `const { isImpersonating } = useAuth();`. This follows the house pattern in `AgentModal.tsx:46` and
  `ProfileCallForwardingSection.tsx:48`.
- At the top of `handleCreateCustomField` (`:614`), after the empty-name guard and **before**
  classification or any network call: if impersonating, set the inline error, `toast.error`, and
  return.
  - `create` is never called.
  - The column's mapping is untouched (selecting "Create as new…" never changed it, `:596-603`).
  - Cancel still returns the column to Do Not Import.
- No other change. The reuse-before-create path, the 23505 refetch / fail-closed notice (D-6 of
  2026-09-19) and the generic catch (`:763-765`, which already shows `err.message` without mapping)
  are untouched.
- `useAuth()` with no provider returns `{}` (`AuthContext.tsx:77-78`), so the two other modal test
  files keep working. Both already mock `@/integrations/supabase/client`, the only import-time
  dependency AuthContext adds.

**Explicitly NOT changed:**

- `ImportLeadsPage.tsx`, `useOrganization.ts` (D-6), `AuthContext.tsx`, `ContactManagement.tsx`.
  Settings already toasts `e.message` (`:581, :593, :604, :616`), so it inherits accurate wording for
  free.
- `viewAsSurfaces.ts`, `types.ts`, every RLS policy, and the applied `20260919052941`.

No new form (the create panel already validates with the shared Zod `customFieldSchema`, `:634`).
No new styles.

### F3. Regression coverage

**SQL: local disposable PostgreSQL only (invariant #28).** PG 16.13 binaries are present at
`/usr/lib/postgresql/16/bin`. The cluster is created in the session scratchpad and bound to
`127.0.0.1`, and the runner's localhost refusal stays. Production is 17.6; the executor check is the
same in both, and E5 is the authoritative proof on 17.6.

- **New** `supabase/tests/custom_fields_rls_harness.sql`, loaded after the existing harness:
  - an `auth.uid()` stub mirroring Supabase (`request.jwt.claim.sub`, then `request.jwt.claims->>'sub'`);
  - `get_org_id` / `get_user_role` / `is_super_admin` / `super_admin_own_org` **verbatim from E2**;
  - the **four policies verbatim from E1**, and `ENABLE ROW LEVEL SECURITY`;
  - `USAGE` on `public`/`auth` and `SELECT` on `profiles` for `authenticated`;
  - `service_role BYPASSRLS` (as in Supabase);
  - Team Leader and Super Admin (home org A) fixtures.
- **New** `supabase/tests/custom_field_authenticated_writes.sql`. Every write runs under
  `SET LOCAL ROLE authenticated` with per-scenario JWT claims and `RETURNING` (as PostgREST does):

| # | Scenario | Expected |
|---|---|---|
| S20a | Admin: personal create | succeeds; `organization_id = A`, `created_by = admin` |
| S20b | Super Admin in home org (`role=Admin`, `is_super_admin=true`): personal create, **and** agency-wide create | both succeed; personal has `created_by` set, agency has `created_by` NULL |
| S20c | Agent: personal create | succeeds |
| S20d | Team Leader: personal create | succeeds |
| S21 | Team Leader creates `"  gender "` (collides with rows RLS hides from them) | **23505**, the guard's exact message (duplicate handling unchanged) |
| S22 | `authenticated` calls `SELECT private.custom_field_norm('x')` by name | **42501 permission denied for schema private** (the grant adds no callable surface) |
| S23 | Org/session mismatch: Agent JWT org A inserts `organization_id = B` | **42501 new row violates row-level security policy** (the DB still fails closed; this is the exact text the translator classifies as an RLS refusal) |
| S24 | Agent attempts an agency-wide field (`created_by` NULL) | **RLS refusal** (ownership invariant holds) |
| S25 | Agent renames own active field; re-activates own inactive field | both succeed (the UPDATE paths through the expression index) |
| S26 | `service_role` inserts an active field | succeeds |
| S27 | Privilege matrix after the grant | normalizer EXECUTE: authenticated ✓, service_role ✓, anon ✗. Guard EXECUTE: all ✗. `private` USAGE: all ✗. Table grants unchanged. |

- **`scripts/run_custom_field_guard_tests.sh`: additive stage only** (existing stages byte-for-byte
  unchanged). In a fresh database:
  1. harness + RLS harness + `20260919052941`;
  2. **REPRODUCTION.** One authenticated personal INSERT must fail with SQLSTATE `42501` and message
     `permission denied for function custom_field_norm`, the production error verbatim. The stage
     aborts if it does not;
  3. apply the new grant;
  4. run S20–S27;
  5. **GRANT-ROLLBACK PROOF.** Apply the new rollback; the reproduction must fail identically again,
     proving the grant is the operative change;
  6. a row fingerprint before/after the grant migration must be identical (no data touched).

**Vitest:**

| File | Cases |
|---|---|
| `src/lib/__tests__/customFieldErrors.test.ts` (extend; the 5 existing cases untouched) | Per-op wording for RLS and privilege defects. **No create message ever contains "modify".** A privilege defect never says "You don't have permission". Delete-RLS says "delete". 23505 org-wide and per-owner text and marker are unchanged for all ops. Unknown errors pass through. Context-error messages. |
| **new** `src/lib/__tests__/customFieldsCreate.test.ts` (mocks `@/integrations/supabase/client`, so no `.env` needed) | Personal create: `get_org_id` RPC called once; payload `organization_id = page org`, `created_by = uid`; `.maybeSingle()`; scope `personal`. Agency create: `created_by` null (unchanged). **Mismatch → `org_mismatch`, and the INSERT is never called.** RPC error / throw / null / "" → `org_unverified`, INSERT never called. Case-insensitive equality passes. INSERT 42501 function-privilege → system wording; INSERT 42501 RLS → create wording; null row → "not created"; 23505 guard → marker preserved. `update()` 0-row / `delete()` RLS wording. |
| `src/components/contacts/__tests__/importLeadsCustomFields.test.tsx` (extend; mock `@/contexts/AuthContext`; record `create` args additively so the existing `createCalls` assertions are untouched) | For **Admin**, **Super Admin** (`viewerIsSuperAdmin`), **Team Leader**, **Agent**: `create` is called once with `(data, "org-1")` and **no `orgWide`** (personal), and the column maps to `custom:<id>`. **View As** → `create` never called, column stays `Do Not Import`, View-As message inline and in a toast. **Org mismatch** rejection → column unmapped, mismatch message verbatim, **not** the org-wide notice. Create-RLS rejection → the shown message has no "modify". **All existing duplicate / 23505 / fail-closed tests unchanged and green.** |

**Your list (item 14) → coverage:**

| Requested | Covered by |
|---|---|
| Admin creating a personal custom field through CSV import | S20a + modal role case |
| Super Admin in home org | S20b + modal role case |
| Agent creating a personal custom field | S20c + modal role case |
| Team Leader creating a personal custom field | S20d + modal role case |
| Organization/session mismatch fails closed | `create()` pre-check tests (no INSERT) + modal mismatch case + S23 (DB layer) |
| View-As fails closed | modal View-As case (+ existing route pins `viewAsSurfaces.test.ts:44`, `viewAsRouteAllowlist.test.tsx:90`) |
| Actual RLS create failure has accurate wording | translator + `create()` cases, fed the **real** RLS text proven by S23/S24 |
| Existing duplicate handling unchanged | S21 + every existing 23505 test untouched and green |

**Negative controls:**

- SQL: the REPRODUCTION stage reproduces the production failure locally.
- Vitest: stash the three source files and re-run. The new tests must fail, then restore and go green
  (house practice).

### F4. Documentation

- **`WORK_LOG.md`**: a newest-first entry (root cause, evidence, what changed, gates, what was and was
  NOT done in production).
- **`AGENT_RULES.md`**, proposed text (D-7).

  **New invariant #37:**

  > **37. A function referenced by an index expression, index predicate, CHECK constraint, column
  > DEFAULT or generated column runs with the WRITING role's privileges — every role that writes the
  > table needs EXECUTE on it (Custom-Field Creation Outage, 2026-09-22; migration
  > `<version>_custom_field_norm_execute_grant`)** —
  > - PostgreSQL checks EXECUTE on each function in such an expression, **as the current role**, when
  >   a write evaluates it (every INSERT; any UPDATE that forms a new index entry). **Trigger functions
  >   are the exception** — checked only at `CREATE TRIGGER` — which is why a postgres-only SECURITY
  >   DEFINER guard keeps working while an index helper with the same ACL breaks every write.
  >   `20260919052941` did exactly this to `custom_fields`: from 2026-09-19 05:29 UTC every create —
  >   every role, both ingresses — passed RLS and the guard and then failed with `42501 permission
  >   denied for function custom_field_norm`.
  > - Grant EXECUTE on such a helper to **every role holding INSERT/UPDATE on the table**
  >   (`authenticated`, `service_role`) and do **not** grant USAGE on its schema: an already-resolved
  >   OID needs EXECUTE only, and withholding USAGE keeps the helper uncallable by name.
  > - **A migration touching a client-writable table is not verified until a write has run AS
  >   `authenticated` with the production RLS policies and JWT claims in place.** A superuser-only
  >   suite cannot see privilege defects, and an assertion that a role LACKS a privilege is not a write
  >   test. Re-run the `pg_depend` sweep (implementation plan §B E9) before and after such a migration.
  > - **SQLSTATE 42501 is two different things.** `new row violates row-level security policy` is an
  >   authorization decision about the user; `permission denied for function/table/schema` is a
  >   platform defect. Custom-field errors are translated **per operation** by
  >   `translateCustomFieldError`; a create never says "modify", and a privilege defect is never
  >   reported as the user's own lack of permission.
  > - **Custom-field creation re-proves its organization and refuses under "View As".**
  >   `customFieldsSupabaseApi.create` compares the page's organization with `public.get_org_id()` (the
  >   RLS resolver itself, same JWT) and sends no INSERT on a mismatch or when it cannot confirm;
  >   `ImportLeadsModal` refuses creation while impersonating because `created_by = auth.uid()` would
  >   attribute the field to the REAL operator (invariant #31). Both are accuracy guards; RLS remains
  >   the authority.

  **Invariant #33 amendment**, appended to the bullet that says the guard lives in `private` with no
  schema USAGE:

  > *(AMENDED 2026-09-22 by #37: the normalizer `private.custom_field_norm(text)` backs
  > `custom_fields_org_norm_active_idx`, so it MUST be EXECUTE-able by every writing role —
  > `authenticated`, `service_role`. The guard function itself stays postgres-only, and schema
  > `private` still grants no USAGE.)*

---

## §G. Files to touch (exhaustive)

| File | Change |
|---|---|
| `supabase/migrations/20260922200000_custom_field_norm_execute_grant.sql` | **new**: the one-line GRANT (§F1) |
| `supabase/migrations/rollback/20260922200000_custom_field_norm_execute_grant.rollback.sql` | **new**: the REVOKE with a re-break warning |
| `supabase/tests/custom_fields_rls_harness.sql` | **new**: auth stub, resolvers, the four production policies |
| `supabase/tests/custom_field_authenticated_writes.sql` | **new**: S20–S27 |
| `scripts/run_custom_field_guard_tests.sh` | additive stage: reproduction → grant → S20–S27 → grant-rollback proof → fingerprint |
| `src/lib/custom-field-errors.ts` | operation-aware translator, context error, messages |
| `src/lib/supabase-settings.ts` | `create()` org pre-check + `.maybeSingle()`; per-op translation in create/update/delete |
| `src/components/contacts/ImportLeadsModal.tsx` | View-As refusal in `handleCreateCustomField` |
| `src/lib/__tests__/customFieldErrors.test.ts` | extend |
| `src/lib/__tests__/customFieldsCreate.test.ts` | **new** |
| `src/components/contacts/__tests__/importLeadsCustomFields.test.tsx` | extend |
| `WORK_LOG.md` | new entry, newest first |
| `AGENT_RULES.md` | #37 added, #33 amended |
| `implementation_plan.md` | this file (rev 2 = as-built) |

**Not touched:** `ImportLeadsPage.tsx`, `useOrganization.ts`, `AuthContext.tsx`,
`ContactManagement.tsx`, `viewAsSurfaces.ts`, `types.ts`, `supabase/migrations/20260919052941_*`
(immutable), any RLS policy, `package.json`, `tsconfig*`, any Edge Function.

---

## §H. Verification gates (baseline first on the clean tree at `03bae62`, then re-run and diffed)

1. `npm ci` (node_modules is absent in this container).
2. `npx tsc --noEmit`: reported, never credited (vacuous per prior plans).
   `npx tsc -p tsconfig.app.json --noEmit`: the **error set must be byte-identical to baseline**.
3. `npm run lint`: problem count identical to baseline; zero new problems.
4. Targeted: the three custom-field suites, the two sibling `importLeadsModal*` suites,
   `viewAsSurfaces` + `viewAsRouteAllowlist`, and every file mocking `@/lib/supabase-settings`.
5. Full `npx vitest run`: before/after diff. Zero new failures; known pre-existing/environmental
   failures listed by name.
6. `npm run build`.
7. SQL runner: all existing stages plus the new stage pass, including the reproduction and the
   grant-rollback proof.
8. Vitest negative control (stash source → new tests fail → restore → green).

No gate result will be claimed that was not observed. **Browser verification cannot be performed
from this session and will not be claimed.**

---

## §I. Production change proposal (FOR SEPARATE APPROVAL, after §H passes locally)

**Target:** `jncvvsvckxhqgqvkppmj`. **Change:** apply §F1 via MCP `apply_migration` (name
`custom_field_norm_execute_grant`), then reconcile the repo filename to the recorded version with
contents frozen.

The Supabase GitHub integration's *Deploy to production* was disabled by Chris on 2026-08-25
(invariant #30; WORK_LOG `:1874`, `:1880`), and no later entry records re-enabling it. So merging a
PR should **not** apply the migration; only this deliberate MCP call should. **I will re-confirm that
setting with you before any merge.** If it has been turned back on, merging the migration file would
apply it to production outside this approval.

1. **Read-only preflight**, which must match E4/E10 exactly or I stop:
   - normalizer ACL `{postgres=X/postgres}`;
   - index definition as in E4;
   - `private` ACL `{postgres=UC/postgres}`;
   - guard ACL `{postgres=X/postgres}`;
   - 4 policies unchanged;
   - `custom_fields` row count (111 at inspection);
   - latest recorded migration.
2. **Apply** the single GRANT.
3. **Read-only post-verification:**
   - normalizer EXECUTE: authenticated ✓, service_role ✓, anon ✗;
   - guard EXECUTE: all client roles ✗;
   - `private` USAGE: all client roles ✗;
   - table grants unchanged; the 4 policies unchanged (text compare); row count unchanged;
   - `get_advisors` security run: no new finding.
4. **Functional verification: NOT by me.** Invariant #28 forbids a production write to verify. Chris
   (or any user) creates a field through CSV import in the normal UI. I then confirm, read-only:
   - one new row, with personal ownership (`organization_id` = home org, `created_by` set);
   - no new `custom_field_norm` errors in `postgres_logs`.
5. **Recovery.** Revert with the rollback file (`REVOKE`). This restores exactly the pre-change state,
   which is the broken one. Forward alternative: D-1 option B. No data can be affected; the change is
   a single ACL entry.

**Recommended order (D-3).** Apply the grant **first**, as a hotfix, as soon as the local proof
passes. The current frontend already sends a correct payload, so the grant alone restores creation
for every user immediately. The frontend hardening follows through review.

---

## §J. Decisions needed from Chris

| # | Decision | Recommendation |
|---|---|---|
| **D-1** | DB mechanism: A grant / B drop the support index / C rebuild | **A** |
| **D-2** | Grantees: `authenticated` + `service_role`, or `authenticated` only | **Both.** `service_role` holds INSERT/UPDATE on the table; no writer uses it today, but one would hit the same outage. |
| **D-3** | Rollout: DB grant first as a hotfix, then frontend; or ship together | **Grant first** |
| **D-4** | Org pre-check scope: `create()` only, or also `update()` / `delete()` | **`create()` only** (what was asked); update/delete get per-op wording only |
| **D-5** | The message table in §F2 | approve or edit |
| **D-6** | Re-order `useOrganization` to mirror `get_org_id()` (`app_metadata` first) | **Defer** as a follow-up: 74 consumers, not implicated |
| **D-7** | AGENT_RULES #37 + #33 amendment text in §F4 | approve or edit |
| **D-8** | After implementation: push the branch only, or push + open a PR against `main` (no merge) | your call; I won't open a PR unless you say so |

---

## §K. Out of scope / follow-ups (logged, not done)

- **D-6** `useOrganization` claim-order alignment, and making `AuthContext`'s refresh loop (`:510-549`)
  fail closed instead of rendering on a known org/role mismatch after 10 attempts.
- Other writes on the import page under View As (inline lead-source creation, campaign creation).
  They are unreachable today (route blocked); they need the same refusal if the allow-list ever grows.
- The **Custom Field Duplicate Consolidation** project (`docs/audits/2026-09-19/CUSTOM_FIELD_DUPLICATES.md`)
  must adopt the new as-`authenticated` SQL harness.
- The Supabase-managed `vault` hits in E9 are platform-owned and not actionable here.

## §L. Risks

| Risk | Mitigation |
|---|---|
| The extra `get_org_id` RPC adds one round-trip per field creation | Creation is rare and user-initiated; it replaces a misleading failure with an accurate one |
| A false mismatch from UUID casing or whitespace | Normalized comparison, pinned by a test |
| A TOCTOU token refresh between the pre-check and the INSERT | Harmless: RLS still decides, and the translator now words that refusal correctly |
| The modal's new `useAuth` import breaks sibling test collection | Both siblings already mock the only import-time dependency; verified in §H step 4 before anything is claimed |
| The grant widens the attack surface | No schema USAGE, not exposed via PostgREST, pure IMMUTABLE text function; S22/S27 pin it |
| *Deploy to production* was re-enabled since 2026-08-25, so a merge would auto-apply the migration | Re-confirm the integration setting with Chris before any merge (§I); never merge ahead of the §I approval |
