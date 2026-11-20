# Sticky Contact Numbers — production installation attempt and managed-role amendment

November 19, 2026 Pacific. Primary `agentflow` / `fflagent.com` only.

## Result of the approved attempt

Chris approved the November 19 five-migration installer, five full Edge packages and frontend `f49e55b770b97155fac46f3e5eeae949ad9f3047`, with all sticky modes off and no main merge, secondary project work, seeding, activation, provider changes or real communications.

Fresh preflight passed: main `2129fa8`, PR #531 `51c3098`, the primary production/domain mapping, all six guarded DB preimages, all six complete live Edge preimages, 381 migration records, no prior sticky objects. There were no recent calls, unresolved dispatches, active worker leases or waiting database locks. Six old `ringing` records last created October 1 were observed and left untouched. Existing security/performance/health advisors were captured.

The exact approved installer (`8fc2e2f9822829e55496570d0c1ade708a969e3937e4de73f153ad0bbcf35bfc`) was attempted once. PostgreSQL refused the first migration at the restricted helper ownership transfer: SQLSTATE42501, `must be able to SET ROLE "agentflow_affinity_scope"`. Readback confirmed complete transaction rollback: 381 records, head `20261113152433`, no sticky versions, no new role or relations. No Edge or frontend deployment occurred.

## Cause and bounded correction

The original isolated installation used superuser `postgres`; managed production uses non-superuser `postgres` with CREATEROLE, BYPASSRLS and INHERIT. A new role's creator-admin grant does not automatically allow SET/INHERIT. PostgreSQL also requires the new function owner to have CREATE in the target schema. A superuser rehearsal bypassed both checks.

Amend only the never-applied foundation migration, following the already shipped commission operator/writer pattern:

```sql
-- Immediately after CREATE ROLE agentflow_affinity_scope:
GRANT agentflow_affinity_scope TO postgres;

-- Around the existing helper ownership transfer:
GRANT CREATE ON SCHEMA private TO agentflow_affinity_scope;
ALTER FUNCTION private.affinity_contact_scope(uuid,uuid,text,text)
  OWNER TO agentflow_affinity_scope;
REVOKE CREATE ON SCHEMA private FROM agentflow_affinity_scope;
```

The existing ALTER statement is unchanged; exactly three executable statements are added. Role membership runs from the restricted scope role to the existing database administrator, never the reverse. It preserves the helper's restricted execution identity and permits postgres-owned wrappers and later migrations to call/manage the sealed helper. No application role gains membership or direct helper execution; no schema CREATE privilege remains. NOLOGIN, NOBYPASSRLS and existing authenticated RLS inheritance remain intact.

Four later migration files and every Edge/frontend runtime byte remain unchanged. The approved frontend pin remains `f49e55b770b97155fac46f3e5eeae949ad9f3047`. The original release artifact remains preserved; never retry its failing installer.

## Revised frozen SQL identities

| Item | Bytes | SHA-256 |
|---|---:|---|
| Foundation migration | 18474 | `3730a454e79acd793324ba1cc08e3a8a0d05f270b5b0af399f9842675937ed4c` |
| Five-migration installer | 191807 | `1d2d1a4d0a7872f6bc1e5c37e940fd37e8f4758c1ced56cda8df24017a9175b9` |
| Function/table/role postimages (unchanged) | 19717 | `663c58170e02358f2dd82c8bd39460b2fc88674aad11961703e567528f504814` |

The installer changes exactly two foundation blocks: execution and the exact source stored in migration history. All other installer bytes remain unchanged. A new local-only managed-role test helper makes this environment requirement reproducible and explicitly verifies role membership direction/options and final privileges in addition to the existing postimages.

## Verification under managed privileges

PostgreSQL17.11, current_user=session_user=postgres, SUPERUSER=false, CREATEROLE/CREATEDB/INHERIT/BYPASSRLS=true. Literal loopback test connections only, synthetic data, no production credentials or provider traffic.

- Original approved installer reproduces the exact production42501 and rolls back role/schema/history.
- Corrected full installer succeeds; all five exact source hashes and history identities match.
- Exact postimages:55 functions,11 tables,1 scope role; function owners/ACLs/security/search paths unchanged.
- All66 actual-role database groups pass.
- All7 atomic rollback/history/replay cases pass.
- postgres SET/INHERIT and nested helper execution succeed. anon/authenticated/service_role cannot become the scope role or directly execute its helper, and have no private-schema CREATE.
- Scope CREATE is revoked; no ineffective-REVOKE warnings occurred.
- Zero initial settings, enforcement, assignment or event rows; all modes remain off.

Existing hosted frontend/Edge verification on `51c3098` remains recorded; this correction changes no frontend/Edge runtime. Existing application TypeScript, repository test, advisor and mobile limitations remain disclosed in verification.md.

## Required narrow approval

The previous approval was for a frozen installer. Its exact package failed and rolled back. The revised role membership and installer hash require explicit amendment approval before another production attempt. Prior approval of the five unchanged Edge packages and primary frontend persists; do not request those again.

> Approve the managed-role amendment: the three added statements in the never-applied foundation migration and revised five-migration installer SHA-256 `1d2d1a4d0a7872f6bc1e5c37e940fd37e8f4758c1ced56cda8df24017a9175b9`. Resume the previously approved primary-only installation after fresh drift/activity checks. Keep all sticky modes off and retain the original exclusions.

No revised production execution, main merge, secondary-project work, seeding, activation, provider/number change or real communication is authorized by this document itself.
