-- =====================================================================================================
-- PRE-EXISTING OBJECTS M4 MUST NOT TOUCH — READ ONLY, plain SQL. Run BEFORE and AFTER the apply and
-- compare the two outputs: every field of every row must be identical.
-- =====================================================================================================
-- Counts alone are not a comparison. Rewriting a policy's USING clause, swapping one role's UPDATE for
-- its DELETE, or making a policy RESTRICTIVE all leave the totals unchanged, so this captures the
-- DEFINITIONS in a stable order instead: each policy's command, permissiveness, roles (PUBLIC included)
-- and its USING and WITH CHECK expressions separately, and every table- and column-level privilege as
-- grantee:PRIVILEGE pairs read straight from the catalog ACL. The md5 columns make the comparison a
-- glance; the text columns make any difference diagnosable.
--
-- Expressions are whitespace-collapsed and otherwise verbatim. `pg_get_expr` qualifies a name only when
-- the bare name does not resolve to it under the SESSION's search_path, so the reading depends on the
-- caller's path — which is why `read_search_path` is the FIRST column: the two images are comparable
-- only when taken under the same path, and an after-image taken under a different one shows up as a
-- difference rather than hiding one. (A plain SELECT cannot pin the path the way the DO block in
-- verify_m4_schema.sql does, because the order in which set_config and pg_get_expr are evaluated within
-- one statement is not defined.) Take both readings the same way — the procedure runs the same file.
WITH t AS (
  SELECT c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('calls','profiles','inbound_routing_settings','notifications','phone_numbers')
), pol AS (
  SELECT t.oid,
         format('%s|%s|%s|%s|USING %s|CHECK %s',
                p.polname,
                CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                              WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' ELSE p.polcmd::text END,
                CASE WHEN p.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
                coalesce((SELECT string_agg(CASE WHEN pr.oid = 0 THEN 'PUBLIC' ELSE ro.rolname END, ',' ORDER BY 1)
                            FROM unnest(p.polroles) pr(oid) LEFT JOIN pg_roles ro ON ro.oid = pr.oid), '(none)'),
                btrim(regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), '<NONE>'), '\s+', ' ', 'g')),
                btrim(regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '<NONE>'), '\s+', ' ', 'g'))) AS def
    FROM t JOIN pg_policy p ON p.polrelid = t.oid
), grt AS (
  SELECT t.oid,
         format('%s:%s%s', coalesce(g.rolname, 'PUBLIC'), a.privilege_type,
                CASE WHEN a.is_grantable THEN ':GRANTABLE' ELSE '' END) AS def
    FROM t CROSS JOIN LATERAL aclexplode(t.relacl) a LEFT JOIN pg_roles g ON g.oid = a.grantee
), colg AS (
  SELECT t.oid,
         format('%s:%s:%s', at.attname, coalesce(g.rolname, 'PUBLIC'), a.privilege_type) AS def
    FROM t JOIN pg_attribute at ON at.attrelid = t.oid AND at.attnum > 0 AND NOT at.attisdropped
                                AND at.attacl IS NOT NULL
    CROSS JOIN LATERAL aclexplode(at.attacl) a LEFT JOIN pg_roles g ON g.oid = a.grantee
)
SELECT current_setting('search_path')                                   AS read_search_path,
       t.relname                                                        AS table_name,
       t.relrowsecurity                                                 AS rls_enabled,
       t.relforcerowsecurity                                            AS force_rls,
       (SELECT count(*) FROM pol WHERE pol.oid = t.oid)                 AS policy_count,
       (SELECT count(*) FROM grt WHERE grt.oid = t.oid)                 AS grant_count,
       (SELECT count(*) FROM colg WHERE colg.oid = t.oid)               AS column_grant_count,
       md5(coalesce((SELECT string_agg(def, ' ;; ' ORDER BY def) FROM pol WHERE pol.oid = t.oid), '')) AS policies_md5,
       md5(coalesce((SELECT string_agg(def, ','   ORDER BY def) FROM grt WHERE grt.oid = t.oid), '')
        || '/' || coalesce((SELECT string_agg(def, ',' ORDER BY def) FROM colg WHERE colg.oid = t.oid), '')) AS grants_md5,
       coalesce((SELECT string_agg(def, ' ;; ' ORDER BY def) FROM pol  WHERE pol.oid  = t.oid), '<no policies>')     AS policies,
       coalesce((SELECT string_agg(def, ','   ORDER BY def) FROM grt  WHERE grt.oid  = t.oid), '<default acl>')      AS table_grants,
       coalesce((SELECT string_agg(def, ','   ORDER BY def) FROM colg WHERE colg.oid = t.oid), '<none>')             AS column_grants
  FROM t
 ORDER BY 1;
