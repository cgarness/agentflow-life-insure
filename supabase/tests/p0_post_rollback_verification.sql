-- =====================================================================================================
-- P0 DRY RUN — POST-ROLLBACK VERIFICATION (read-only; run AFTER the dry-run script, as a separate call)
--
-- Proves the rolled-back transaction persisted nothing. Every row returned must show status = 'PASS'.
-- This script performs NO writes and opens no transaction of its own.
-- =====================================================================================================

-- 1-4. No fixture rows survive in any table the dry run touched.
SELECT 'no_fixture_profiles' AS check,
       count(*) AS found,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM public.profiles
WHERE email LIKE '%@p0test.invalid'
   OR id::text LIKE 'a1111111%' OR id::text LIKE 'b1111111%' OR id::text LIKE 'c1111111%'
UNION ALL
SELECT 'no_fixture_organizations', count(*),
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.organizations
WHERE slug LIKE 'p0-dryrun-%' OR name LIKE 'P0 %'
   OR id::text LIKE 'a0a0a0a0%' OR id::text LIKE 'b0b0b0b0%'
UNION ALL
SELECT 'no_fixture_invitations', count(*),
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.invitations
WHERE email LIKE '%@p0test.invalid'
UNION ALL
SELECT 'no_fixture_auth_users', count(*),
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM auth.users
WHERE email LIKE '%@p0test.invalid'
   OR id::text LIKE 'a1111111%' OR id::text LIKE 'b1111111%' OR id::text LIKE 'c1111111%'

-- 5. No fixture app-metadata change survives (the claim-sync trigger stayed active during the run).
UNION ALL
SELECT 'no_fixture_app_metadata', count(*),
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM auth.users
WHERE raw_app_meta_data::text ILIKE '%p0test.invalid%'
   OR raw_app_meta_data::text ILIKE '%a0a0a0a0-0000-4000-8000%'
   OR raw_app_meta_data::text ILIKE '%b0b0b0b0-0000-4000-8000%'

-- 6. No pg_net request was queued for any fixture.
UNION ALL
SELECT 'no_pgnet_queued_for_fixtures', count(*),
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM net.http_request_queue
WHERE url ILIKE '%p0test.invalid%'
   OR body::text ILIKE '%p0test.invalid%'
   OR body::text ILIKE '%p0-dryrun-%'

-- 7. No migration-history entry was written (the dry run never calls apply_migration).
UNION ALL
SELECT 'no_migration_history_row', count(*),
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM supabase_migrations.schema_migrations
WHERE version LIKE '202607302100%' OR name ILIKE '%p0_profile_authorization%'

-- 8a. Production POLICIES unchanged: the pre-existing set must still be present, and nothing the
--     migration would have created may exist.
UNION ALL
SELECT 'policies_unchanged_profiles', count(*),
       CASE WHEN count(*) = 4 THEN 'PASS' ELSE 'FAIL' END
FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid
WHERE c.relname = 'profiles'
  AND p.polname IN ('profiles_insert','profiles_update_own','profiles_update_admin','profiles_select_org')
UNION ALL
SELECT 'policies_unchanged_invitations', count(*),
       CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END
FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid
WHERE c.relname = 'invitations'
  AND p.polname IN ('invitations_update_status','invitations_org_admin_manage')
UNION ALL
SELECT 'no_new_policies_created', count(*),
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid
WHERE p.polname IN ('invitations_delete_org_admin','invitations_revoke_org_admin','invitations_select_team_leader')

-- 8b. Production FUNCTIONS/TRIGGERS unchanged: neither object the migration adds may exist.
UNION ALL
SELECT 'no_guard_function', count(*),
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname IN ('enforce_profile_field_authorization','provision_organization')
UNION ALL
SELECT 'no_guard_trigger', count(*),
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM pg_trigger
WHERE tgname = 'trg_00_enforce_profile_field_authorization'
UNION ALL
SELECT 'no_role_check_constraint', count(*),
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM pg_constraint
WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_role_check'

-- 8c. The two external-effect triggers are enabled ('O'), exactly as before the run.
UNION ALL
SELECT 'external_triggers_enabled', count(*),
       CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END
FROM pg_trigger
WHERE tgname IN ('on_organization_created_provision_twilio','on_profile_created_welcome_email')
  AND tgenabled = 'O'

-- 8d. Production GRANTS unchanged: anon and authenticated still hold the original full table
--     privileges on profiles (the migration would have revoked them), and no column-level ACL exists.
UNION ALL
SELECT 'grants_unchanged_profiles', count(*),
       CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND grantee IN ('anon','authenticated') AND privilege_type = 'UPDATE'
UNION ALL
SELECT 'no_column_level_acls', count(*),
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM pg_attribute a JOIN pg_class c ON a.attrelid = c.oid
WHERE c.relname IN ('profiles','invitations') AND a.attacl IS NOT NULL

-- 8e. get_invitation_by_token_rpc still has its original 14-column signature (no accepted_at, and not
--     the nulling variant the migration installs).
UNION ALL
SELECT 'invitation_rpc_unchanged', count(*),
       CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname = 'get_invitation_by_token_rpc'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%usable%'

ORDER BY 1;
