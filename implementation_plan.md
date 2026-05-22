# Control Center v2 Hardening & Security Plan

Perform a hardening and review pass on the Control Center v2 implementation to address security vulnerabilities, ensure manifest slug accuracy, resolve issue lifecycle bugs, and refactor orchestration logic.

## User Review Required

> [!IMPORTANT]
> **Chris must explicitly approve this plan and reply "apply migration"** before I execute any file modifications or database migrations.

### Key Hardening Tasks

1. **Security Patch (`analyze_system_db`)**:
   - Pin `search_path = public, pg_temp` on the `SECURITY DEFINER` function `public.analyze_system_db()`.
   - Explicitly revoke `EXECUTE` privileges on the function from `PUBLIC` and grant it only to `authenticated` users (logic check `public.is_platform_admin()` inside the function remains the primary defense).

2. **Edge Function Slug Mapping Corrections**:
   - Correct the mismatch in expected Edge Function names in `systemInventoryManifest.ts` and `analyzeSystem.ts`:
     - `twilio-voice-token` $\rightarrow$ `twilio-token` (matches actual directory `supabase/functions/twilio-token`)
     - `twilio-sms-inbound` $\rightarrow$ `twilio-sms-webhook` (matches actual directory `supabase/functions/twilio-sms-webhook`)
     - `gmail-auth` / `gmail-sync` $\rightarrow$ `email-connect-start` / `email-sync-incremental` / `email-connect-callback`
     - `agency-group-invite` $\rightarrow$ `invite-to-agency-group`
   - Rename health checks in `analyzeSystem.ts` from "Generator/Handler/Executor" to "Reachability" to make it clear they only verify registration/reachability via OPTIONS requests, not deep business logic.

3. **Issue Status Overwrite & `last_seen_at` Lifecycle Bug**:
   - Currently, running "Analyze System" overwrites existing issue statuses with `"open"`, resetting any manual `"resolved"` or `"ignored"` overrides. It also fails to set `last_seen_at` or preserve `first_seen_at`.
   - **Fix:** Fetch existing `control_center_issues` before upsert. Match on `issue_key` to:
     - Preserve status if it is currently `"resolved"` or `"ignored"`.
     - Preserve the original `first_seen_at`.
     - Set `last_seen_at` to the current timestamp.

4. **Code Refactoring for Maintainability**:
   - The ~140 lines of audit orchestration logic (fetching DB signals, pinging Edge Functions, mapping payloads, and executing upserts) is embedded directly in `ControlCenterOverviewPage.tsx`.
   - **Fix:** Extract this logic into a custom hook `useAnalyzeControlCenterSystem.ts` in `src/hooks/`.

5. **Super Admin Shortcut Gate**:
   - Update `SuperAdminDashboard.tsx` to use `realProfile?.platform_role` instead of `profile?.platform_role` to prevent shortcut visibility issues when a Super Admin is impersonating a non-admin account.

---

## Proposed Changes

### Database Migration

#### [NEW] [20260522170000_control_center_v2_hardening.sql](file:///Users/chrisgarness/Projects/agentflow-life-insure/supabase/migrations/20260522170000_control_center_v2_hardening.sql)

```sql
-- Migration: Control Center v2 Security Hardening
-- Purpose: Pin search_path on public.analyze_system_db() and restrict EXECUTE permissions.

-- 1. Re-create the function with pinned search_path
CREATE OR REPLACE FUNCTION public.analyze_system_db()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result jsonb;
  v_tables jsonb;
  v_rls_disabled jsonb;
  v_rls_no_policy jsonb;
  v_rls_always_true jsonb;
  v_sec_def_public jsonb;
  v_sec_def_authenticated jsonb;
  v_mutable_search_path jsonb;
  v_public_buckets jsonb;
  v_public_extensions jsonb;
  v_system_status jsonb;
BEGIN
  -- Check platform_admin
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied. Platform Admin only.';
  END IF;

  -- 1. List of public tables
  SELECT jsonb_agg(tablename) INTO v_tables
  FROM pg_tables WHERE schemaname = 'public';

  -- 2. RLS Disabled in Public
  SELECT jsonb_agg(tablename) INTO v_rls_disabled
  FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false;

  -- 3. RLS Enabled No Policy
  SELECT jsonb_agg(t.tablename) INTO v_rls_no_policy
  FROM pg_tables t
  WHERE t.schemaname = 'public'
    AND t.rowsecurity = true
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = t.tablename
    );

  -- 4. RLS Policy Always True (open to public or authenticated)
  SELECT jsonb_agg(jsonb_build_object('table', tablename, 'policy', policyname)) INTO v_rls_always_true
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (qual = 'true' OR with_check = 'true')
    AND roles && ARRAY['public'::name, 'authenticated'::name];

  -- 5. Public Can Execute SECURITY DEFINER Function
  SELECT jsonb_agg(p.proname) INTO v_sec_def_public
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND has_function_privilege('public', p.oid, 'execute');

  -- 6. Signed-In Users Can Execute SECURITY DEFINER Function
  SELECT jsonb_agg(p.proname) INTO v_sec_def_authenticated
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND has_function_privilege('authenticated', p.oid, 'execute');

  -- 7. Function Search Path Mutable
  SELECT jsonb_agg(p.proname) INTO v_mutable_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND (p.proconfig IS NULL OR NOT (p.proconfig::text LIKE '%search_path=%'));

  -- 8. Public Bucket Allows Listing (using public = true as proxy)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    EXECUTE 'SELECT jsonb_agg(name) FROM storage.buckets WHERE public = true' INTO v_public_buckets;
  ELSE
    v_public_buckets := '[]'::jsonb;
  END IF;

  -- 9. Extension in Public
  SELECT jsonb_agg(extname) INTO v_public_extensions
  FROM pg_extension e
  JOIN pg_namespace n ON e.extnamespace = n.oid
  WHERE n.nspname = 'public';

  -- 10. Existing public.system_status
  SELECT jsonb_agg(jsonb_build_object(
    'component_name', component_name,
    'status', status,
    'description', description,
    'notes', notes
  )) INTO v_system_status
  FROM public.system_status;

  -- Construct final JSON
  result := jsonb_build_object(
    'tables', COALESCE(v_tables, '[]'::jsonb),
    'rls_disabled', COALESCE(v_rls_disabled, '[]'::jsonb),
    'rls_no_policy', COALESCE(v_rls_no_policy, '[]'::jsonb),
    'rls_always_true', COALESCE(v_rls_always_true, '[]'::jsonb),
    'sec_def_public', COALESCE(v_sec_def_public, '[]'::jsonb),
    'sec_def_authenticated', COALESCE(v_sec_def_authenticated, '[]'::jsonb),
    'mutable_search_path', COALESCE(v_mutable_search_path, '[]'::jsonb),
    'public_buckets', COALESCE(v_public_buckets, '[]'::jsonb),
    'public_extensions', COALESCE(v_public_extensions, '[]'::jsonb),
    'system_status', COALESCE(v_system_status, '[]'::jsonb)
  );

  RETURN result;
END;
$$;

-- 2. Restrict execute permissions
REVOKE ALL ON FUNCTION public.analyze_system_db() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analyze_system_db() TO authenticated;

NOTIFY pgrst, 'reload schema';
```

---

### Codebase Changes

#### [MODIFY] [systemInventoryManifest.ts](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/lib/control-center/systemInventoryManifest.ts)
- Update expected Edge Function lists under:
  - `twilio_voice` $\rightarrow$ Change `"twilio-voice-token"` to `"twilio-token"`.
  - `sms` $\rightarrow$ Change `"twilio-sms-inbound"` to `"twilio-sms-webhook"`.
  - `gmail_email` $\rightarrow$ Change `"gmail-auth", "gmail-sync"` to `"email-connect-start", "email-connect-callback", "email-sync-incremental"`.
  - `agency_groups` $\rightarrow$ Change `"agency-group-invite"` to `"invite-to-agency-group"`.

#### [MODIFY] [analyzeSystem.ts](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/lib/control-center/analyzeSystem.ts)
- Update `twilio.token_function_registered` check block:
  - Change target from `"twilio-voice-token"` to `"twilio-token"`.
  - Update name to `"Twilio Voice JWT Endpoint Reachability"`.
  - Update description to `"Verifies that the Twilio Voice auth token generator endpoint is deployed and reachable."`
- Update other check names/descriptions to denote "Reachability" instead of implying full operational health.

#### [NEW] [useAnalyzeControlCenterSystem.ts](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/hooks/useAnalyzeControlCenterSystem.ts)
- Houses the `scanning` state and `runSystemAudit()` logic extracted from `ControlCenterOverviewPage.tsx`.
- Fetches `control_center_issues` from Supabase prior to compilation:
  - Maps through generated issues to preserve any existing `status` if set to `"resolved"` or `"ignored"`.
  - Retains the original `first_seen_at` and updates `last_seen_at = now`.
- Exposes `{ scanning, runSystemAudit }`.

#### [MODIFY] [ControlCenterOverviewPage.tsx](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/pages/control-center/ControlCenterOverviewPage.tsx)
- Remove `runSystemAudit` and `scanning` local definitions.
- Import and consume the custom hook: `const { scanning, runSystemAudit } = useAnalyzeControlCenterSystem();`.

#### [MODIFY] [SuperAdminDashboard.tsx](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/pages/SuperAdminDashboard.tsx)
- Destructure `realProfile` (instead of `profile`) from `useAuth()`.
- Update line 541 shortcut condition to gate on `realProfile?.platform_role === "platform_admin"`.

---

## Verification Plan

### Automated Tests
- Run TypeScript verification:
  ```bash
  npx tsc --noEmit
  ```

### Manual Verification
1. **Apply Migration:** Apply the security hardening SQL using Supabase CLI/Console.
2. **First Analysis Pass:** Click "Analyze System" on the overview page.
   - Verify that the checks (`twilio.token_function_registered`, etc.) now pass because the slugs match the actual deployment.
   - Verify that disabled RLS warnings (`app_config`, `webhook_debug_log`) appear as issues under Issue Tracker.
3. **Status Preservation Verification:**
   - In the Issue Tracker, mark one RLS warning issue as "ignored" or "resolved".
   - Run "Analyze System" again.
   - Verify that the issue remains in its manual "ignored" or "resolved" state and was not reset to "open".
   - Verify `last_seen_at` is updated to the current timestamp.
   - Verify that no duplicate issue rows are inserted.
4. **Super Admin Impersonation Verification:**
   - Verify that the Control Center button remains in the Super Admin dashboard even when impersonating a standard user, as it now validates the `realProfile` of the platform administrator.
