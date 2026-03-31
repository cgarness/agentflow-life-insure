# AgentFlow Multi-Tenant Diagnostic Report
**Date:** March 31, 2026  
**Auditor:** Agentic Audit System  
**Subject:** Multi-tenant Data Structure & Security Audit

---

## SECTION 1 — CURRENT STATE SUMMARY

### Profiles Table Structure
The `public.profiles` table is the central hub for user data and organizational mapping. 

**Columns found at `src/integrations/supabase/types.ts` (Lines 1498-1540):**
- `id` (UUID, Primary Key, references `auth.users`)
- `first_name`, `last_name`, `email`, `role` (Text)
- `organization_id` (UUID, references `public.organizations`)
- `team_id` (UUID, references `public.teams`)
- `upline_id` (UUID, references `public.profiles`)
- `is_super_admin` (Boolean)
- `status` (Text: Active, Inactive, Pending)
- Various preference/goal fields: `theme_preference`, `monthly_call_goal`, etc.

### Organization & Team Storage
- **`organization_id`**: Stored as a UUID on the `profiles` table. It is used in RLS policies across settings tables (`custom_fields`, `lead_sources`, etc.) to isolate data.
- **`team_id`**: Stored on `profiles` but currently underutilized in RLS. Its primary use appears to be for frontend filtering in `UserManagement.tsx`.
- **`upline_id`**: Represents a direct-report relationship (Agent -> Team Leader). It is used in `profiles` RLS to allow Team Leaders to view and update their agents' data. 
  - *Limitation:* It only supports a flat, one-level relationship. Recursive hierarchies (TL reporting to another TL) are not natively enforced by RLS.

### Roles implementation
The system uses four roles: `Super Admin`, `Admin`, `Team Leader`, and `Agent`.
- **Storage**: Roles are stored as **Plain Text strings** in the `role` column of the `profiles` table (verified in `20260303233510_5927fb1c...sql`).
- **Permissions**: A `role_permissions` table exists (`20260315184000_role_permissions.sql`) with JSONB permissions for Agent and Team Leader roles.

### RLS Policies on `profiles`
The policies in `20260323014000_fix_profiles_rls.sql` use **inline subqueries**:
- **Admin**: `EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND LOWER(role) = 'admin')`
- **Team Leader**: `upline_id = auth.uid() OR id = auth.uid()`
- **Agent**: Restricted to `auth.uid() = id`.

### Missing `organization_id`
Several core tables appear to be missing `organization_id` or consistent RLS enforcement:
- `dialer_sessions`: Missing `organization_id` (referenced by `agent_id` only).
- `activity_logs`: Has the column but insert policies are generic.

---

## SECTION 2 — MULTI-TENANT READINESS ASSESSMENT

1. **Can two different agencies (orgs) exist in the database without their data ever leaking to each other?**
   - **PARTIAL**. While RLS exists for settings, many tables rely on `organization_id IS NULL` checks which could unintentionally expose baseline data. The `profiles` table lacks a strict `organization_id` check for non-admins, relying instead on `upline_id`.

2. **Is `organization_id` enforced at the RLS level on every data table?**
   - **NO**. Settings tables are covered, but transactional tables like `calls` and `appointments` often rely on `user_id` or `agent_id` mappings. If an agent is moved between orgs, their historical data could technically lead to leaks if not re-scoped.

3. **Is there a proper `organizations` table? What columns does it have?**
   - **YES** (Found in `types.ts`). Columns: `id`, `name`, `slug`, `logo_url`, `created_at`, `updated_at`. 
   - *Note:* The `CREATE TABLE` migration was not found in the `supabase/migrations` folder, indicating manual creation or sync outside the migration flow.

4. **Is there a proper `teams` table? What columns does it have?**
   - **YES** (Found in `types.ts`). Columns: `id`, `name`, `organization_id`, `parent_team_id`.

5. **When a new user is created, is `organization_id` automatically assigned?**
   - **PARTIAL**. The `handle_new_user` trigger in `20260325021000...sql` attempts to extract it from metadata. However, it falls back to a hardcoded default UUID `a0600000-0000-0000-0000-000000000001` in the frontend `AuthContext.tsx` (Line 146) if not provided.

6. **When a new record (lead, call, etc.) is inserted, is `organization_id` automatically included?**
   - **NO**. The application must manually include the `organization_id` in every insert. There are no database triggers to auto-assign it based on the `auth.uid()`'s organization.

7. **Is there a Super Admin role that can see across all orgs?**
   - **PARTIAL**. The role exists in logic and policies (e.g., `is_super_admin = true` check in `fix_settings_rls.sql`), but it is not yet a formal value in the `role_permissions` seed.

---

## SECTION 3 — HIERARCHY AND ROLE GAPS

- **Team Leader Visibility**: A Team Leader can only see agents where `upline_id = auth.uid()`. They cannot see the "whole org" unless they are also an Admin.
- **Nested Agents**: The system does **NOT** support sub-agents of sub-agents. The `upline_id` logic is strictly 1:1. A management chain (Agent -> Manager -> Regional VP) would fail to roll up data correctly.
- **Agent Data Access**: Agents are prevented from reading each other's data by `profiles` RLS (which checks `auth.uid() = id`).
- **Enforcement Location**: Roles are enforced **partially in the database** via RLS, but significant logic (like which menu items show) is handled in the frontend UI (`UserManagement.tsx`).
- **Direct API Bypass**: If someone calls the Supabase API directly:
  - They can see all `lead_sources` or `custom_fields` where `organization_id IS NULL`.
  - They can potentially see other users in their own organization since `profiles` RLS for non-admins is very restrictive (only self + reports).

---

## SECTION 4 — RISK FLAGS

| Flag Name | Severity | Location | Risk | Fix |
| :--- | :--- | :--- | :--- | :--- |
| **Hardcoded Org ID** | **CRITICAL** | `AuthContext.tsx:146` | All new signups without an invite default to one shared "org", leaking data between independent users. | Force valid `org_id` on all signups. |
| **RLS Performance** | **HIGH** | `settings_rls.sql` | Subqueries in `USING` clauses (`SELECT 1 FROM profiles...`) will cause drastic slowdowns as the `profiles` table grows. | Migrate to JWT claims for `org_id` and `role`. |
| **Global NULL Scope** | **HIGH** | `fix_settings_rls.sql` | `organization_id IS NULL` in `SELECT` policies allows anyone to see records intended to be "system defaults" that might be modified. | Explicitly flag system defaults with `is_system = true`. |
| **Missing Recursive RLS** | **MEDIUM** | `fix_profiles_rls.sql` | Management cannot see "grandchild" data, breaking reporting for larger agencies. | Implement recursive CTEs or a `path` Ltree for hierarchy. |
| **Role Inconsistency** | **LOW** | `fix_profiles_rls.sql` | Policies use `LOWER(role) = 'admin'` while table uses `DEFAULT 'Agent'`. | Move to a Postgres ENUM for the `role` column. |

---

## SECTION 5 — WHAT A PROPERLY STRUCTURED MULTI-TENANT CRM NEEDS

### Ideal Schema

#### `public.organizations`
```sql
CREATE TABLE public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    subscription_status TEXT NOT NULL DEFAULT 'trial',
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

#### `public.profiles`
```sql
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    organization_id UUID NOT NULL REFERENCES public.organizations(id),
    team_id UUID REFERENCES public.teams(id),
    upline_id UUID REFERENCES public.profiles(id),
    role user_role_enum NOT NULL DEFAULT 'Agent',
    full_name TEXT,
    -- ... other fields
);
```

### Ideal RLS & Enforcement
1. **JWT Claims**: Use a `service_role` trigger to add `org_id` and `role` to the user's JWT metadata.
2. **Helper Function**:
```sql
CREATE FUNCTION get_org_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'org_id', '')::UUID;
$$ LANGUAGE sql STABLE;
```
3. **Optimized Policy**:
```sql
CREATE POLICY "Multi-tenant isolation" ON public.leads
FOR ALL TO authenticated
USING (organization_id = get_org_id());
```

### Auto-Assignment Trigger
```sql
CREATE TRIGGER ensure_org_id_on_insert
BEFORE INSERT ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.set_organization_from_session();
```

---

## SECTION 6 — RECOMMENDED NEXT STEPS

1. **Implement JWT Custom Claims**
   - **Fixes:** RLS performance and subquery complexity.
   - **Tool:** Supabase (SQL/Triggers).
   - **Effort:** Medium.
   - **Files:** `auth.users` triggers, all RLS policies.

2. **Harden Signup Workflow**
   - **Fixes:** Critical risk of data leakage via default Org ID.
   - **Tool:** Claude Code / Lovable.
   - **Effort:** Small.
   - **Files:** `src/contexts/AuthContext.tsx`.

3. **Standardize Hierarchy with `path`**
   - **Fixes:** Broken reporting for deep hierarchies.
   - **Tool:** Supabase migration.
   - **Effort:** Large.
   - **Files:** `profiles` table (add `hierarchy_path` column).

4. **Audit Transactional RLS (Calls/Leads)**
   - **Fixes:** Direct API access data leaks.
   - **Tool:** Claude Code.
   - **Effort:** Medium.
   - **Files:** `calls`, `appointments`, `leads` tables.

5. **Formalize Custom Enum for Roles**
   - **Fixes:** Logic errors due to string typos (`admin` vs `Admin`).
   - **Tool:** Supabase migration.
   - **Effort:** Small.
   - **Files:** `profiles` table.
