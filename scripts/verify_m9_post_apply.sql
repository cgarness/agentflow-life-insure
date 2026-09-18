-- =====================================================================================================
-- M9 post-apply verification — CATALOG READS ONLY. No voicemail is seeded and no application RPC is
-- invoked to "test" the trigger; behaviour is proven by the local SQL suite, identity by the catalog.
-- =====================================================================================================
-- SEPARATE FROM scripts/verify_m8_post_apply.sql BY DESIGN. That file asserts M9 is ABSENT (checks 39
-- and 40) because it verified an M8-only state. It is historical evidence and is deliberately left
-- unchanged and un-run after M9 rather than weakened. This file re-checks the M8 objects it covered,
-- so nothing is lost by not re-running it.
--
-- Expected constants were derived by applying the APPROVED file
-- (supabase/migrations/20260918002859_voicemail_first_listen_guard.sql,
--  sha256 0442669072c44a8ee8c3b3ceeadeff5fd25264a446e82baa9164aa2dca7f6583) to a disposable local
-- PostgreSQL 16.13 already carrying M1-M8, BEFORE anything was submitted to a hosted project.
-- Send the SET and the query together in ONE session: the pinned search_path makes pg_get_triggerdef
-- schema-qualify the bound function, which the expected digest assumes.
SET search_path = pg_catalog, pg_temp;

WITH expected(k, v) AS (VALUES
  ('m9_src_md5',        '18e17bd304a722cd176749a0a1e08b37'),
  ('m9_trigdef_md5',    'ce98ae4446da78332818ba360c5b201f'),
  ('m9_fn_comment_md5', 'b307b87216ed8024d1ec256ce59fd17f'),
  ('m9_col_comment_md5','a39ecf4215d8a7284eaf339e6c1f38a8'),
  ('m8_act_src_md5',    '975a070b6ba080b8f601b7585a17f723'),
  ('m8_blk_src_md5',    'f052496ccf5842dfff10cd310973fc66'),
  ('m8_act_idx_md5',    '8f5c7454ca1cf4ad0d48c0b3962862c3'),
  ('m8_blk_idx_md5',    'fda1c08ac66ea78177af3529e264ce9f'),
  ('m7_batch_md5',      '5c5cbbf4151bc8fbc1e8d65fb1902481')
),
g AS (  -- the M9 function
  SELECT p.oid, p.prosrc, p.prosecdef, p.proacl, p.proowner, p.proconfig,
         pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
         p.prorettype::pg_catalog.regtype::text AS rettype,
         l.lanname,
         pg_catalog.md5(p.prosrc) AS src_md5
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
   WHERE n.nspname = 'public' AND p.proname = 'voicemails_enforce_first_listen'
),
t AS (  -- every non-internal trigger on public.voicemails
  SELECT tg.oid, tg.tgname, tg.tgtype, tg.tgenabled, tg.tgattr, tg.tgfoid,
         pg_catalog.md5(pg_catalog.pg_get_triggerdef(tg.oid)) AS def_md5
    FROM pg_catalog.pg_trigger tg
   WHERE tg.tgrelid = 'public.voicemails'::pg_catalog.regclass AND NOT tg.tgisinternal
),
o AS (  -- objects that must be untouched
  SELECT p.proname, pg_catalog.md5(p.prosrc) AS src_md5
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('voicemails_cleanup_actionable_batch','voicemails_cleanup_blocked_summary',
                       'voicemails_cleanup_batch','voicemails_expired_batch')
),
ix AS (
  SELECT c.relname, pg_catalog.md5(pg_catalog.pg_get_indexdef(i.indexrelid)) AS def_md5
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN ('idx_voicemails_cleanup_actionable','idx_voicemails_cleanup_blocked')
),
checks(seq, name, expected, actual) AS (
  -- ── the M9 FUNCTION: exactly one, right shape, approved body, pinned search_path
  SELECT  1, 'M9 fn: exactly one in public, no overload', '1', (SELECT count(*)::text FROM g)
  UNION ALL SELECT  2, 'M9 fn: exists in NO other schema', '1',
          (SELECT count(*)::text FROM pg_catalog.pg_proc WHERE proname='voicemails_enforce_first_listen')
  UNION ALL SELECT  3, 'M9 fn: RETURNS trigger', 'trigger', (SELECT string_agg(rettype,' | ') FROM g)
  UNION ALL SELECT  4, 'M9 fn: language plpgsql', 'plpgsql', (SELECT string_agg(lanname,' | ') FROM g)
  UNION ALL SELECT  5, 'M9 fn: takes no arguments', '', (SELECT string_agg(args,' | ') FROM g)
  UNION ALL SELECT  6, 'M9 fn: SECURITY INVOKER (prosecdef false)', 'false', (SELECT string_agg(prosecdef::text,' | ') FROM g)
  UNION ALL SELECT  7, 'M9 fn: pinned search_path', 'search_path=pg_catalog, pg_temp',
          (SELECT string_agg(pg_catalog.array_to_string(proconfig,','),' | ') FROM g)
  UNION ALL SELECT  8, 'M9 fn: approved body digest', (SELECT v FROM expected WHERE k='m9_src_md5'),
          (SELECT string_agg(src_md5,' | ') FROM g)
  -- ── the exemption is the documented one: current_user membership, guarded, and NOT session_user
  UNION ALL SELECT  9, 'M9 fn: exemption tests current_user membership of service_role', 'true',
          (SELECT string_agg((prosrc LIKE '%pg_has_role(current_user, ''service_role'', ''MEMBER'')%')::text,' | ') FROM g)
  UNION ALL SELECT 10, 'M9 fn: exemption guarded by to_regrole (works where the role is absent)', 'true',
          (SELECT string_agg((prosrc LIKE '%to_regrole(''service_role'') IS NOT NULL%')::text,' | ') FROM g)
  UNION ALL SELECT 11, 'M9 fn: does NOT key on session_user', 'false',
          (SELECT string_agg((prosrc LIKE '%session_user%')::text,' | ') FROM g)
  -- ── EXECUTE revoked: a trigger function needs none, and a null ACL would mean PUBLIC EXECUTE
  UNION ALL SELECT 12, 'M9 fn: ACL explicit (not default PUBLIC EXECUTE)', 'true',
          (SELECT string_agg((proacl IS NOT NULL)::text,' | ') FROM g)
  UNION ALL SELECT 13, 'M9 fn: PUBLIC holds no EXECUTE', '0',
          (SELECT count(*)::text FROM g, pg_catalog.aclexplode(g.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
  UNION ALL SELECT 14, 'M9 fn: anon DENIED', 'false',
          (SELECT string_agg(pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')::text,' | ') FROM g)
  UNION ALL SELECT 15, 'M9 fn: authenticated DENIED', 'false',
          (SELECT string_agg(pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')::text,' | ') FROM g)
  -- CORRECTED AFTER THE PRODUCTION RUN. This check first read 'no grantee outside the OWNER' and it
  -- FAILED in production (1 unexpected grantee) while passing locally. The cause was my expectation, not
  -- the migration: the hosted project carries ALTER DEFAULT PRIVILEGES on functions in `public` granting
  -- EXECUTE to postgres, anon, authenticated AND service_role (two rules, owned by postgres and by
  -- supabase_admin). A new function is therefore BORN with all four. M9 revokes PUBLIC, anon and
  -- authenticated -- exactly the revocations the approval names -- and deliberately does not revoke
  -- service_role, so that entry survives. The disposable local stack has no such default privileges, so
  -- the function was born owner-only there and the wrong expectation went unnoticed.
  -- This is the same allowance M8's verifier already used, and it is NOT a weakening: the security
  -- property lives in checks 13/14/15 (PUBLIC/anon/authenticated hold no EXECUTE), which are unchanged
  -- and are proven to bite by the negative controls. Check 36 pins the grantee set to exactly two, so a
  -- third grantee appearing later still fails. service_role EXECUTE on a TRIGGER function is inert in any
  -- case: trigger functions are invoked by the trigger machinery, never through EXECUTE, and service_role
  -- is the role the guard deliberately exempts.
  UNION ALL SELECT 16, 'M9 fn: no grantee outside {owner, service_role}', '0',
          (SELECT count(*)::text FROM g, pg_catalog.aclexplode(g.proacl) a
            WHERE a.grantee <> 0 AND a.grantee <> g.proowner
              AND pg_catalog.pg_get_userbyid(a.grantee) <> 'service_role')
  -- ── the TRIGGER: exactly one on the table, enabled, BEFORE UPDATE OF listened_at, FOR EACH ROW
  UNION ALL SELECT 17, 'trigger: exactly one non-internal trigger on public.voicemails', '1', (SELECT count(*)::text FROM t)
  UNION ALL SELECT 18, 'trigger: name', 'voicemails_first_listen_guard', (SELECT string_agg(tgname,' | ') FROM t)
  UNION ALL SELECT 19, 'trigger: tgtype 19 = ROW(1) + BEFORE(2) + UPDATE(16)', '19', (SELECT string_agg(tgtype::text,' | ') FROM t)
  UNION ALL SELECT 20, 'trigger: ENABLED (tgenabled O = origin)', 'O', (SELECT string_agg(tgenabled::text,' | ') FROM t)
  UNION ALL SELECT 21, 'trigger: bound to public.voicemails_enforce_first_listen', 'voicemails_enforce_first_listen',
          (SELECT string_agg(p.proname,' | ') FROM t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid)
  UNION ALL SELECT 22, 'trigger: UPDATE OF exactly one column', '1', (SELECT string_agg(coalesce(array_length(tgattr,1),0)::text,' | ') FROM t)
  UNION ALL SELECT 23, 'trigger: that column is listened_at', 'listened_at',
          (SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM t, pg_catalog.pg_attribute a
            WHERE a.attrelid='public.voicemails'::pg_catalog.regclass AND a.attnum = ANY(t.tgattr))
  UNION ALL SELECT 24, 'trigger: full definition digest', (SELECT v FROM expected WHERE k='m9_trigdef_md5'),
          (SELECT string_agg(def_md5,' | ') FROM t)
  -- ── the approved comments (function comment, and the listened_at column comment M9 sets)
  UNION ALL SELECT 25, 'M9 fn comment digest', (SELECT v FROM expected WHERE k='m9_fn_comment_md5'),
          (SELECT string_agg(pg_catalog.md5(d.description),' | ') FROM g JOIN pg_catalog.pg_description d
             ON d.objoid=g.oid AND d.classoid='pg_proc'::pg_catalog.regclass)
  UNION ALL SELECT 26, 'voicemails.listened_at column comment digest', (SELECT v FROM expected WHERE k='m9_col_comment_md5'),
          pg_catalog.md5(pg_catalog.col_description('public.voicemails'::pg_catalog.regclass,
            (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid='public.voicemails'::pg_catalog.regclass AND attname='listened_at')))
  -- ── M8 and M7 objects must be untouched
  UNION ALL SELECT 27, 'M8 actionable selector body UNCHANGED', (SELECT v FROM expected WHERE k='m8_act_src_md5'),
          (SELECT string_agg(src_md5,' | ') FROM o WHERE proname='voicemails_cleanup_actionable_batch')
  UNION ALL SELECT 28, 'M8 blocked summary body UNCHANGED', (SELECT v FROM expected WHERE k='m8_blk_src_md5'),
          (SELECT string_agg(src_md5,' | ') FROM o WHERE proname='voicemails_cleanup_blocked_summary')
  UNION ALL SELECT 29, 'M8 actionable index UNCHANGED', (SELECT v FROM expected WHERE k='m8_act_idx_md5'),
          (SELECT string_agg(def_md5,' | ') FROM ix WHERE relname='idx_voicemails_cleanup_actionable')
  UNION ALL SELECT 30, 'M8 blocked index UNCHANGED', (SELECT v FROM expected WHERE k='m8_blk_idx_md5'),
          (SELECT string_agg(def_md5,' | ') FROM ix WHERE relname='idx_voicemails_cleanup_blocked')
  UNION ALL SELECT 31, 'M7 voicemails_cleanup_batch body UNCHANGED', (SELECT v FROM expected WHERE k='m7_batch_md5'),
          (SELECT string_agg(src_md5,' | ') FROM o WHERE proname='voicemails_cleanup_batch')
  UNION ALL SELECT 32, 'retention selector voicemails_expired_batch still present exactly once', '1',
          (SELECT count(*)::text FROM o WHERE proname='voicemails_expired_batch')
  -- ── the exemption cannot leak to client roles, and no data was touched
  UNION ALL SELECT 33, 'authenticated is NOT a member of service_role', 'false',
          pg_catalog.pg_has_role('authenticated','service_role','MEMBER')::text
  UNION ALL SELECT 34, 'anon is NOT a member of service_role', 'false',
          pg_catalog.pg_has_role('anon','service_role','MEMBER')::text
  UNION ALL SELECT 35, 'voicemails table still holds zero rows', '0', (SELECT count(*)::text FROM public.voicemails)
  -- Pins the grantee SET, so a third grantee cannot slip in behind the allowance added to check 16.
  UNION ALL SELECT 36, 'M9 fn: exactly two ACL grantees (owner + service_role)', '2',
          (SELECT count(*)::text FROM g, pg_catalog.aclexplode(g.proacl) a)
  UNION ALL SELECT 37, 'M9 fn: ACL grantee names, sorted', 'postgres,service_role',
          (SELECT string_agg(pg_catalog.pg_get_userbyid(a.grantee), ',' ORDER BY pg_catalog.pg_get_userbyid(a.grantee))
             FROM g, pg_catalog.aclexplode(g.proacl) a)
  UNION ALL SELECT 38, 'M9 fn: every ACL privilege is EXECUTE only', 'EXECUTE',
          (SELECT string_agg(DISTINCT a.privilege_type, ',') FROM g, pg_catalog.aclexplode(g.proacl) a)
)
SELECT seq, name, expected, coalesce(actual,'<NULL>') AS actual,
       CASE WHEN actual IS NOT DISTINCT FROM expected THEN 'PASS' ELSE '*** FAIL ***' END AS result
  FROM checks ORDER BY seq;
