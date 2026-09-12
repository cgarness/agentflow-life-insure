-- Pre-existing objects M4 must not touch — READ ONLY, plain SQL. Run BEFORE and AFTER the apply and
-- compare the two outputs: every row must be identical. (The absolute numbers differ between
-- environments, which is why they are compared rather than hard-coded.)
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
       (SELECT count(*) FROM information_schema.role_table_grants g
         WHERE g.table_schema = 'public' AND g.table_name = c.relname
           AND g.grantee IN ('anon','authenticated','service_role')) AS role_grants
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('calls','profiles','inbound_routing_settings','notifications','phone_numbers')
 ORDER BY 1;
