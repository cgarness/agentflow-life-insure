-- Commissions insights, Gate 2: READ-ONLY catalog fingerprint. Run before and after the apply, from the same tool.
-- For each category: every object (n_all), the objects that are NOT created by 20261021180000 (n_existing) and a digest
-- of their full descriptions (owner, ACL, definition, flags). Before and after, n_existing and digest_existing must be
-- equal in every category: no existing object, permission or definition changed. n_all - n_existing is what the
-- migration added (expected after the apply: schemas 1, relations 2, columns 6, constraints 4, indexes 1, functions 12,
-- policies 1, types 2; everything else 0). Internal (foreign-key) triggers are covered by the constraints category.
WITH x AS (
  SELECT to_regnamespace('policy_commission_insights') AS ns, to_regclass('public.policy_commission_goals') AS rel,
         to_regclass('public.policy_commission_goals_pkey') AS idx),
fx AS (
  SELECT p.oid FROM pg_proc p, x
   WHERE p.pronamespace = x.ns
      OR (p.pronamespace = 'public'::regnamespace AND p.proname IN ('get_my_commission_breakdown', 'get_my_commission_policy_list',
          'get_my_commission_receipt_list', 'get_my_commission_goal', 'set_my_commission_goal', 'clear_my_commission_goal'))),
live_ns AS (
  SELECT oid, nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\_temp\_%' AND nspname NOT LIKE 'pg\_toast\_temp\_%'),
o(category, descr, is_new) AS (
  SELECT 'schemas', n.nspname || '|' || pg_get_userbyid(n.nspowner) || '|' || coalesce(n.nspacl::text, '-'), n.oid = x.ns
    FROM pg_namespace n JOIN live_ns l ON l.oid = n.oid, x
  UNION ALL
  SELECT 'relations', l.nspname || '.' || c.relname || '|' || c.relkind::text || '|' || pg_get_userbyid(c.relowner) || '|'
           || coalesce(c.relacl::text, '-') || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity || '|' || coalesce(c.reloptions::text, '-'),
         c.oid IN (x.rel, x.idx)
    FROM pg_class c JOIN live_ns l ON l.oid = c.relnamespace, x
  UNION ALL
  SELECT 'columns', l.nspname || '.' || c.relname || '.' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|'
           || a.attnotnull || '|' || coalesce(a.attacl::text, '-') || '|' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), '-'),
         c.oid = x.rel
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN live_ns l ON l.oid = c.relnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum, x
   WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'v', 'm', 'f', 'p', 'c')
  UNION ALL
  SELECT 'constraints', l.nspname || '|' || coalesce(cr.relname, '-') || '|' || coalesce(t.typname, '-') || '|' || k.conname || '|'
           || pg_get_constraintdef(k.oid), k.conrelid = x.rel
    FROM pg_constraint k JOIN live_ns l ON l.oid = k.connamespace
    LEFT JOIN pg_class cr ON cr.oid = k.conrelid LEFT JOIN pg_type t ON t.oid = k.contypid, x
  UNION ALL
  SELECT 'indexes', pg_get_indexdef(i.indexrelid) || '|' || i.indisvalid || '|' || i.indisready, i.indexrelid = x.idx
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN live_ns l ON l.oid = c.relnamespace, x
  UNION ALL
  SELECT 'functions', l.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || p.prokind::text || '|'
           || pg_get_userbyid(p.proowner) || '|' || p.prosecdef || '|' || p.provolatile::text || '|' || coalesce(p.proconfig::text, '-') || '|'
           || coalesce(p.proacl::text, '-') || '|' || CASE WHEN p.prokind = 'a' THEN md5(p.prosrc) ELSE md5(pg_get_functiondef(p.oid)) END,
         p.oid IN (SELECT oid FROM fx)
    FROM pg_proc p JOIN live_ns l ON l.oid = p.pronamespace
  UNION ALL
  SELECT 'policies', pol.schemaname || '.' || pol.tablename || '|' || pol.policyname || '|' || pol.permissive || '|' || pol.roles::text
           || '|' || pol.cmd || '|' || coalesce(pol.qual, '-') || '|' || coalesce(pol.with_check, '-'),
         pol.schemaname = 'public' AND pol.tablename = 'policy_commission_goals'
    FROM pg_policies pol
  UNION ALL
  SELECT 'triggers', l.nspname || '.' || c.relname || '|' || t.tgname || '|' || t.tgenabled::text || '|' || pg_get_triggerdef(t.oid), false
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN live_ns l ON l.oid = c.relnamespace
   WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'event_triggers', e.evtname || '|' || e.evtevent || '|' || pg_get_userbyid(e.evtowner) || '|' || e.evtfoid::regproc::text || '|'
           || e.evtenabled::text || '|' || coalesce(e.evttags::text, '-'), false
    FROM pg_event_trigger e
  UNION ALL
  SELECT 'types', l.nspname || '.' || t.typname || '|' || t.typtype::text || '|' || pg_get_userbyid(t.typowner) || '|' || coalesce(t.typacl::text, '-'),
         t.typnamespace = x.ns OR t.typrelid = x.rel
         OR t.typelem IN (SELECT r.oid FROM pg_type r WHERE r.typrelid = x.rel)
    FROM pg_type t JOIN live_ns l ON l.oid = t.typnamespace, x
  UNION ALL
  SELECT 'roles', r.rolname || '|' || r.rolsuper || r.rolinherit || r.rolcreaterole || r.rolcreatedb || r.rolcanlogin || r.rolreplication
           || r.rolbypassrls || '|' || r.rolconnlimit || '|' || coalesce(r.rolconfig::text, '-'), false
    FROM pg_roles r
  UNION ALL
  SELECT 'memberships', pg_get_userbyid(m.roleid) || '|' || pg_get_userbyid(m.member) || '|' || pg_get_userbyid(m.grantor) || '|' || m.admin_option, false
    FROM pg_auth_members m
  UNION ALL
  SELECT 'default_acls', pg_get_userbyid(d.defaclrole) || '|' || coalesce(n.nspname, '(all)') || '|' || d.defaclobjtype::text || '|' || d.defaclacl::text, false
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  UNION ALL
  SELECT 'publications', p.pubname || '|' || p.puballtables || p.pubinsert || p.pubupdate || p.pubdelete || p.pubtruncate, false
    FROM pg_publication p
  UNION ALL
  SELECT 'publication_tables', pt.pubname || '|' || pt.schemaname || '.' || pt.tablename,
         pt.schemaname = 'public' AND pt.tablename = 'policy_commission_goals'
    FROM pg_publication_tables pt
  UNION ALL
  SELECT 'extensions', e.extname || '|' || e.extversion || '|' || n.nspname, false
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace)
-- is_new is NULL (not new) before the apply, when the new objects do not exist yet.
SELECT category, count(*) AS n_all, count(*) FILTER (WHERE NOT coalesce(is_new, false)) AS n_existing,
       md5(coalesce(string_agg(descr, E'\n' ORDER BY descr COLLATE "C") FILTER (WHERE NOT coalesce(is_new, false)), '')) AS digest_existing
  FROM o GROUP BY category ORDER BY category;
