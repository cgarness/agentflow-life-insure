-- =====================================================================================================
-- M8 post-apply verification — CATALOG READS ONLY. Never invokes an application RPC as a health check.
-- =====================================================================================================
-- Expected constants were derived by applying the APPROVED file
-- (supabase/migrations/20260918000614_voicemail_cleanup_actionable_selection.sql,
--  sha256 4324c67981b20b4e3c33fd20ccb3618a6c70ba16fbb0ad796f0956858dfeb186) to a disposable local
-- PostgreSQL 16.13 carrying M1-M7, BEFORE anything was submitted to a hosted project. The M7 digest
-- 5c5cbbf4151bc8fbc1e8d65fb1902481 reproduced locally and matches the approval independently.
--
-- Statement 1 lists every check with expected/actual. Statement 2 is a hard gate: it raises
-- division_by_zero if ANY check failed, so a mismatch cannot be read as success.
-- Pinned so catalog RENDERING (pg_get_indexdef / pg_get_function_result) is deterministic and
-- fully schema-qualifies public objects. Send this SET and the query together in ONE session.
SET search_path = pg_catalog, pg_temp;

WITH expected(k, v) AS (VALUES
  ('act_src_md5',     '975a070b6ba080b8f601b7585a17f723'),
  ('blk_src_md5',     'f052496ccf5842dfff10cd310973fc66'),
  ('act_idx_md5',     '8f5c7454ca1cf4ad0d48c0b3962862c3'),
  ('blk_idx_md5',     'fda1c08ac66ea78177af3529e264ce9f'),
  ('act_comment_md5', '82bc997eba57425fa156eedd90381521'),
  ('blk_comment_md5', '967bf392e70f119f2d5b7949979567c4'),
  ('m7_batch_md5',    '5c5cbbf4151bc8fbc1e8d65fb1902481')
),
fn AS (
  SELECT p.oid, p.proname,
         pg_catalog.pg_get_function_identity_arguments(p.oid) AS ident_args,
         pg_catalog.pg_get_function_arguments(p.oid)          AS args_with_default,
         pg_catalog.pg_get_function_result(p.oid)             AS result_cols,
         p.provolatile, p.prosecdef,
         pg_catalog.array_to_string(p.proconfig, ',')         AS cfg,
         pg_catalog.md5(p.prosrc)                             AS src_md5,
         p.proacl, p.proowner
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('voicemails_cleanup_actionable_batch','voicemails_cleanup_blocked_summary','voicemails_cleanup_batch')
),
idx AS (
  SELECT c.relname, t.relname AS tbl, i.indisvalid, i.indisready, i.indislive,
         pg_catalog.md5(pg_catalog.pg_get_indexdef(i.indexrelid)) AS def_md5
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('idx_voicemails_cleanup_actionable','idx_voicemails_cleanup_blocked')
),
cmt AS (
  SELECT f.proname, pg_catalog.md5(d.description) AS md5
    FROM fn f LEFT JOIN pg_catalog.pg_description d ON d.objoid = f.oid AND d.classoid = 'pg_proc'::pg_catalog.regclass
),
checks(seq, name, expected, actual) AS (
  -- ── the two NEW functions: identity, signature, result columns, body, volatility, security, search_path
  SELECT  1, 'actionable: exactly one function, no overload', '1',
          (SELECT count(*)::text FROM fn WHERE proname='voicemails_cleanup_actionable_batch')
  UNION ALL SELECT  2, 'actionable: identity args', 'p_limit integer',
          (SELECT string_agg((ident_args)::text, ' | ' ORDER BY (ident_args)::text) FROM fn WHERE proname='voicemails_cleanup_actionable_batch')
  UNION ALL SELECT  3, 'actionable: default', 'p_limit integer DEFAULT 100',
          (SELECT string_agg((args_with_default)::text, ' | ' ORDER BY (args_with_default)::text) FROM fn WHERE proname='voicemails_cleanup_actionable_batch')
  UNION ALL SELECT  4, 'actionable: result columns',
          'TABLE(id uuid, organization_id uuid, recording_sid text, source_cleanup_attempts integer, provider_account_sid text)',
          (SELECT string_agg((result_cols)::text, ' | ' ORDER BY (result_cols)::text) FROM fn WHERE proname='voicemails_cleanup_actionable_batch')
  UNION ALL SELECT  5, 'actionable: STABLE', 's',
          (SELECT string_agg((provolatile::text)::text, ' | ' ORDER BY (provolatile::text)::text) FROM fn WHERE proname='voicemails_cleanup_actionable_batch')
  UNION ALL SELECT  6, 'actionable: SECURITY DEFINER', 'true',
          (SELECT string_agg((prosecdef::text)::text, ' | ' ORDER BY (prosecdef::text)::text) FROM fn WHERE proname='voicemails_cleanup_actionable_batch')
  UNION ALL SELECT  7, 'actionable: pinned search_path', 'search_path=pg_catalog, pg_temp',
          (SELECT string_agg((cfg)::text, ' | ' ORDER BY (cfg)::text) FROM fn WHERE proname='voicemails_cleanup_actionable_batch')
  UNION ALL SELECT  8, 'actionable: body digest', (SELECT v FROM expected WHERE k='act_src_md5'),
          (SELECT string_agg((src_md5)::text, ' | ' ORDER BY (src_md5)::text) FROM fn WHERE proname='voicemails_cleanup_actionable_batch')
  UNION ALL SELECT  9, 'blocked: exactly one function, no overload', '1',
          (SELECT count(*)::text FROM fn WHERE proname='voicemails_cleanup_blocked_summary')
  UNION ALL SELECT 10, 'blocked: identity args', 'p_scan_limit integer',
          (SELECT string_agg((ident_args)::text, ' | ' ORDER BY (ident_args)::text) FROM fn WHERE proname='voicemails_cleanup_blocked_summary')
  UNION ALL SELECT 11, 'blocked: default', 'p_scan_limit integer DEFAULT 5000',
          (SELECT string_agg((args_with_default)::text, ' | ' ORDER BY (args_with_default)::text) FROM fn WHERE proname='voicemails_cleanup_blocked_summary')
  UNION ALL SELECT 12, 'blocked: result columns',
          'TABLE(blocked_due integer, blocked_total integer, blocked_orgs integer, oldest_blocked_at timestamp with time zone, scan_capped boolean)',
          (SELECT string_agg((result_cols)::text, ' | ' ORDER BY (result_cols)::text) FROM fn WHERE proname='voicemails_cleanup_blocked_summary')
  UNION ALL SELECT 13, 'blocked: STABLE', 's',
          (SELECT string_agg((provolatile::text)::text, ' | ' ORDER BY (provolatile::text)::text) FROM fn WHERE proname='voicemails_cleanup_blocked_summary')
  UNION ALL SELECT 14, 'blocked: SECURITY DEFINER', 'true',
          (SELECT string_agg((prosecdef::text)::text, ' | ' ORDER BY (prosecdef::text)::text) FROM fn WHERE proname='voicemails_cleanup_blocked_summary')
  UNION ALL SELECT 15, 'blocked: pinned search_path', 'search_path=pg_catalog, pg_temp',
          (SELECT string_agg((cfg)::text, ' | ' ORDER BY (cfg)::text) FROM fn WHERE proname='voicemails_cleanup_blocked_summary')
  UNION ALL SELECT 16, 'blocked: body digest', (SELECT v FROM expected WHERE k='blk_src_md5'),
          (SELECT string_agg((src_md5)::text, ' | ' ORDER BY (src_md5)::text) FROM fn WHERE proname='voicemails_cleanup_blocked_summary')
  -- ── privileges: service_role only. proacl NOT NULL matters: a null ACL is the default, which is PUBLIC EXECUTE.
  UNION ALL SELECT 17, 'actionable: ACL is explicit (not default PUBLIC EXECUTE)', 'true',
          (SELECT string_agg(((proacl IS NOT NULL)::text)::text, ' | ' ORDER BY ((proacl IS NOT NULL)::text)::text) FROM fn WHERE proname='voicemails_cleanup_actionable_batch')
  UNION ALL SELECT 18, 'blocked: ACL is explicit (not default PUBLIC EXECUTE)', 'true',
          (SELECT string_agg(((proacl IS NOT NULL)::text)::text, ' | ' ORDER BY ((proacl IS NOT NULL)::text)::text) FROM fn WHERE proname='voicemails_cleanup_blocked_summary')
  UNION ALL SELECT 19, 'actionable: service_role has EXECUTE', 'true',
          (SELECT string_agg((pg_catalog.has_function_privilege('service_role', oid, 'EXECUTE')::text)::text, ' | ' ORDER BY (pg_catalog.has_function_privilege('service_role', oid, 'EXECUTE')::text)::text) FROM fn WHERE proname='voicemails_cleanup_actionable_batch')
  UNION ALL SELECT 20, 'blocked: service_role has EXECUTE', 'true',
          (SELECT string_agg((pg_catalog.has_function_privilege('service_role', oid, 'EXECUTE')::text)::text, ' | ' ORDER BY (pg_catalog.has_function_privilege('service_role', oid, 'EXECUTE')::text)::text) FROM fn WHERE proname='voicemails_cleanup_blocked_summary')
  UNION ALL SELECT 21, 'actionable: anon DENIED', 'false',
          (SELECT string_agg((pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')::text)::text, ' | ' ORDER BY (pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')::text)::text) FROM fn WHERE proname='voicemails_cleanup_actionable_batch')
  UNION ALL SELECT 22, 'blocked: anon DENIED', 'false',
          (SELECT string_agg((pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')::text)::text, ' | ' ORDER BY (pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')::text)::text) FROM fn WHERE proname='voicemails_cleanup_blocked_summary')
  UNION ALL SELECT 23, 'actionable: authenticated DENIED', 'false',
          (SELECT string_agg((pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')::text)::text, ' | ' ORDER BY (pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')::text)::text) FROM fn WHERE proname='voicemails_cleanup_actionable_batch')
  UNION ALL SELECT 24, 'blocked: authenticated DENIED', 'false',
          (SELECT string_agg((pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')::text)::text, ' | ' ORDER BY (pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')::text)::text) FROM fn WHERE proname='voicemails_cleanup_blocked_summary')
  UNION ALL SELECT 25, 'both: PUBLIC holds no EXECUTE', '0',
          (SELECT count(*)::text FROM fn f, pg_catalog.aclexplode(f.proacl) a
            WHERE f.proname <> 'voicemails_cleanup_batch' AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
  UNION ALL SELECT 26, 'both: no grantee outside {owner, service_role}', '0',
          (SELECT count(*)::text FROM fn f, pg_catalog.aclexplode(f.proacl) a
            WHERE f.proname <> 'voicemails_cleanup_batch'
              AND a.grantee <> 0
              AND pg_catalog.pg_get_userbyid(a.grantee) NOT IN ('service_role', pg_catalog.pg_get_userbyid(f.proowner)))
  -- ── the two partial indexes: table, key, predicate, validity, readiness
  UNION ALL SELECT 27, 'actionable index: present exactly once', '1',
          (SELECT count(*)::text FROM idx WHERE relname='idx_voicemails_cleanup_actionable')
  UNION ALL SELECT 28, 'actionable index: on public.voicemails', 'voicemails',
          (SELECT tbl FROM idx WHERE relname='idx_voicemails_cleanup_actionable')
  UNION ALL SELECT 29, 'actionable index: definition digest (key + predicate)', (SELECT v FROM expected WHERE k='act_idx_md5'),
          (SELECT def_md5 FROM idx WHERE relname='idx_voicemails_cleanup_actionable')
  UNION ALL SELECT 30, 'actionable index: valid/ready/live', 'truetruetrue',
          (SELECT indisvalid::text||indisready::text||indislive::text FROM idx WHERE relname='idx_voicemails_cleanup_actionable')
  UNION ALL SELECT 31, 'blocked index: present exactly once', '1',
          (SELECT count(*)::text FROM idx WHERE relname='idx_voicemails_cleanup_blocked')
  UNION ALL SELECT 32, 'blocked index: on public.voicemails', 'voicemails',
          (SELECT tbl FROM idx WHERE relname='idx_voicemails_cleanup_blocked')
  UNION ALL SELECT 33, 'blocked index: definition digest (key + predicate)', (SELECT v FROM expected WHERE k='blk_idx_md5'),
          (SELECT def_md5 FROM idx WHERE relname='idx_voicemails_cleanup_blocked')
  UNION ALL SELECT 34, 'blocked index: valid/ready/live', 'truetruetrue',
          (SELECT indisvalid::text||indisready::text||indislive::text FROM idx WHERE relname='idx_voicemails_cleanup_blocked')
  -- ── comments (the approval covers them)
  UNION ALL SELECT 35, 'actionable: comment digest', (SELECT v FROM expected WHERE k='act_comment_md5'),
          (SELECT string_agg((md5)::text, ' | ' ORDER BY (md5)::text) FROM cmt WHERE proname='voicemails_cleanup_actionable_batch')
  UNION ALL SELECT 36, 'blocked: comment digest', (SELECT v FROM expected WHERE k='blk_comment_md5'),
          (SELECT string_agg((md5)::text, ' | ' ORDER BY (md5)::text) FROM cmt WHERE proname='voicemails_cleanup_blocked_summary')
  -- ── M7's ORIGINAL selector must be untouched, and still the only one of its name
  UNION ALL SELECT 37, 'M7 voicemails_cleanup_batch: body digest UNCHANGED', (SELECT v FROM expected WHERE k='m7_batch_md5'),
          (SELECT string_agg((src_md5)::text, ' | ' ORDER BY (src_md5)::text) FROM fn WHERE proname='voicemails_cleanup_batch')
  UNION ALL SELECT 38, 'M7 voicemails_cleanup_batch: exactly one, no overload', '1',
          (SELECT count(*)::text FROM fn WHERE proname='voicemails_cleanup_batch')
  -- ── M9 must still be absent
  UNION ALL SELECT 39, 'M9 trigger function ABSENT', '0',
          (SELECT count(*)::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname='voicemails_enforce_first_listen')
  UNION ALL SELECT 40, 'M9 trigger ABSENT', '0',
          (SELECT count(*)::text FROM pg_catalog.pg_trigger WHERE tgname='voicemails_first_listen_guard' AND NOT tgisinternal)
  -- ── no application data was seeded or modified
  UNION ALL SELECT 41, 'voicemails table still holds zero rows', '0',
          (SELECT count(*)::text FROM public.voicemails)
)
SELECT seq, name, expected, coalesce(actual,'<NULL>') AS actual,
       CASE WHEN actual IS NOT DISTINCT FROM expected THEN 'PASS' ELSE '*** FAIL ***' END AS result
  FROM checks ORDER BY seq;
