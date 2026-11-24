-- One line per catalog object in the application schemas, for comparing installation states in the disposable cluster.
-- Function bodies appear only as digests. Ordering is fixed, so two databases with the same objects print the same text.
\pset format unaligned
\pset tuples_only on
SELECT line FROM (
  SELECT 'function|' || p.oid::regprocedure || '|' || md5(pg_get_functiondef(p.oid)) || '|' || pg_get_userbyid(p.proowner)
      || '|definer=' || p.prosecdef || '|' || coalesce(p.proconfig::text, '') || '|' || coalesce(p.proacl::text, '') AS line
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private') AND p.prokind IN ('f', 'p')
  UNION ALL
  SELECT 'trigger|' || c.oid::regclass || '|' || t.tgname || '|' || md5(pg_get_triggerdef(t.oid)) || '|enabled=' || t.tgenabled
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'private', 'auth')
  UNION ALL
  SELECT 'relation|' || c.oid::regclass || '|' || c.relkind || '|rls=' || c.relrowsecurity || '|force=' || c.relforcerowsecurity
      || '|' || pg_get_userbyid(c.relowner) || '|' || coalesce(c.relacl::text, '')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'private') AND c.relkind IN ('r', 'v', 'm', 'S', 'p')
  UNION ALL
  SELECT 'column|' || a.attrelid::regclass || '.' || a.attname || '|' || format_type(a.atttypid, a.atttypmod)
      || '|notnull=' || a.attnotnull || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || '|' || coalesce(a.attacl::text, '')
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname IN ('public', 'private') AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraint|' || conrelid::regclass || '|' || conname || '|' || md5(pg_get_constraintdef(oid))
    FROM pg_constraint WHERE connamespace IN ('public'::regnamespace, 'private'::regnamespace) AND conrelid <> 0
  UNION ALL
  SELECT 'index|' || schemaname || '.' || indexname || '|' || md5(indexdef) FROM pg_indexes WHERE schemaname IN ('public', 'private')
  UNION ALL
  SELECT 'policy|' || polrelid::regclass || '|' || polname || '|' || polcmd || '|' || polroles::regrole[]::text || '|'
      || md5(coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), ''))
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'private')
) catalog ORDER BY line COLLATE "C";
