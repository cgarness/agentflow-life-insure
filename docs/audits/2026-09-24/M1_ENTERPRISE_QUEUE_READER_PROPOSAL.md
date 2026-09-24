# M1 — Contain `public.get_enterprise_queue_leads` (PROPOSAL ONLY)

**Status:** proposal (rev 6, 2026-09-24).
- **No REVOKE, GRANT, function change or migration has been executed.** None is authorized by the rev 6
  approval.
- The function was **not invoked** to test it.
- Finding: `DIALER_AUTHORIZATION_FINDINGS.md` F2.

## 1. Current state (catalog reads only, production `jncvvsvckxhqgqvkppmj`)

**Signature and ownership:**
- Signature: `public.get_enterprise_queue_leads(p_campaign_id uuid, p_limit integer, p_offset integer, p_org_id uuid) RETURNS SETOF public.campaign_leads`.
- `LANGUAGE plpgsql SECURITY DEFINER`, `SET search_path TO 'public'`, owner `postgres`.

**Live ACL:**
```
{=X/postgres, postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
```
EXECUTE is held by PUBLIC, `anon`, `authenticated` and `service_role`. The repo baseline shows the same
grants: `20260806000000_baseline_production_schema.sql:13493-13495`, plus the default PUBLIC grant.

**Live body:** md5 `04bae0f0f116ad5b6a7f3b442bfdd432`. It matches the repo baseline at `:2484-2587` in
substance. That was checked by visual comparison, not by a byte-level diff.
- It reads `campaigns WHERE id = p_campaign_id` with **no organization or `auth.uid()` check**.
- It filters `campaign_leads` by org only when `p_org_id` is non-NULL, and the caller chooses that value.
- It returns whole `campaign_leads` rows: snapshot name, phone, email, state, age, status and callback data.

**Callers and dependencies:**

| Source | Result |
|---|---|
| `src/` and `supabase/functions/` | No caller. Only the generated type `src/integrations/supabase/types.ts` mentions it. |
| Database objects (other functions' source, views, `pg_depend`) | **None** (rev 6 catalog query). |
| API request logs (`edge_logs`) | **0 requests** to `rpc/get_enterprise_queue_leads` across nine 24-hour windows (2026-09-16 06:00Z → 2026-09-24 06:25Z contiguous, plus 2026-09-09). Each window had a positive `rpc/` control. |

## 2. Compatibility uncertainty (why "no observed calls" is not "unused")

- **Log coverage:** the log check covered nine days out of the retention history. Older or infrequent callers
  (monthly jobs, for example) would not appear.
- **Direct connections:** connections through Postgres or the pooler (BI tools, scripts, `psql`) do not
  appear in `edge_logs`.
- **External holders:**
  - An external service holding a `service_role` key is **unaffected** by M1, because `service_role` keeps
    EXECUTE.
  - A service that uses the **anon** key or a user JWT **would** be affected.
- **Unknown callers:** it cannot be proven that no browser build outside this repository (an old deployed
  bundle, a fork, a third-party integration) calls it. The current repo bundle does not.

## 3. Exact proposed change (NOT RUN)

Migration `YYYYMMDDHHMMSS_m1_contain_get_enterprise_queue_leads.sql`:

```sql
-- M1: contain the cross-tenant SECURITY DEFINER reader (F2). Body unchanged; nothing deleted.
-- Rollback policy: NEVER re-grant PUBLIC/anon/authenticated on this unchanged body (see §5).
BEGIN;
REVOKE EXECUTE ON FUNCTION public.get_enterprise_queue_leads(uuid, integer, integer, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_enterprise_queue_leads(uuid, integer, integer, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_enterprise_queue_leads(uuid, integer, integer, uuid) FROM authenticated;
-- service_role and the owner keep EXECUTE (server-side callers, if any, are unaffected).
COMMENT ON FUNCTION public.get_enterprise_queue_leads(uuid, integer, integer, uuid) IS
  'CONTAINED (M1): no org/caller check. Do not re-grant to client roles. Replace with an org-checked function if a client caller is needed.';
COMMIT;
```

**What the migration does not do:**
- It does not drop the function. Dropping is a later, separate decision, taken after an agreed observation
  period.
- It does not edit the body.
- It does not change any other function.
- The generated types are untouched, because the signature still exists.

## 4. Verification

**Pre-apply (read-only):**
1. Re-read the ACL and the body md5. **Stop if either differs from §1.**
2. Re-run the `edge_logs` count for the most recent 24-hour window, with a positive control.

**Local harness (before production):**
1. Apply the migration to a local Supabase stack.
2. As `anon`, call the function: it must fail with `42501` permission denied.
3. As `authenticated`: the same `42501`.
4. As `service_role`: it succeeds.
5. Run the app's dialer suites. There are no callers, so they are expected to be unchanged.

**Post-apply (read-only):**
1. The ACL equals `{postgres=X/postgres, service_role=X/postgres}`.
2. `has_function_privilege('anon', …, 'EXECUTE') = false`, and the same for `authenticated`.
3. The body md5 is unchanged.
4. Supabase security advisors show no regression.
5. For 7 days, watch `edge_logs` for `rpc/get_enterprise_queue_leads` responses with status 401/403/404.
   A non-zero count identifies a real client caller. **It is recovered through §5, never by a re-grant.**

## 5. Safe recovery plan (no re-grant of the unchanged reader)

**Not allowed as recovery:** `GRANT EXECUTE … TO authenticated` (or `anon`, or `PUBLIC`) on the unchanged
body. It would reopen cross-tenant reads for every signed-in user in every organization.

**If a legitimate client caller appears:**
1. Identify it from the request logs: its user agent, org and timing. Report it to Chris.
2. Ship a **new** function, for example `public.get_campaign_queue_preview(p_campaign_id uuid, p_limit int,
   p_offset int)`:
   - SECURITY DEFINER, `search_path = pg_catalog, pg_temp`, with schema-qualified references;
   - `v_org := public.get_org_id()`; the campaign must be in `v_org`;
   - campaign access checked through the existing `can_dial_campaign` / `private.campaign_actor` rules;
   - rows filtered to `organization_id = v_org`;
   - `p_limit` capped (for example 100);
   - no caller-supplied org parameter;
   - EXECUTE granted to `authenticated` only.
3. Point the caller at the new function. The contained function stays revoked.
4. The new function needs its own approval, harness tests (cross-org refusal, non-member refusal on Team
   campaigns, anon refusal) and advisors.

**If a server-side caller using `service_role` appears:** no action is needed, since it keeps working.
Record it in the WORK_LOG.

**Emergency rollback:** there is none that restores client EXECUTE. The only rollback is the forward fix
above. The migration header must say so.

## 6. Approval needed

M1 is independent of P1–P3 and SC-1. It needs Chris's exact approval for:
1. the pre-apply read-only checks;
2. the local harness run;
3. the production migration in §3;
4. the 7-day post-check reads.
