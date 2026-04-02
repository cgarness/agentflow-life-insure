# AgentFlow: Living Roadmap

**Last Updated:** April 2026
**Primary Demographic:** Life Insurance Agencies

This file serves as the definitive source of truth across all AI tools and sessions building AgentFlow. It establishes rigorous tracking over deployments, environment variables, core migrations, and the exact state of functional modules. 

All Edge logic, WebRTC code, Database Policies, and App States must be validated against this structure prior to generation.

---

## 1. System Status & Module Health

### Authentication & Tenant Structure `[STABLE]`
- **State**: The `auth.users` engine successfully triggers mirroring actions to `public.profiles`. RLS bounds are heavily scoped via JWT claims to ensure zero multi-tenant data bleed. Super Admin override exists via the `is_super_admin` role.
- **Next Up**: Finalize Resend-based transactional emailing from inside the invitation and password reset `.maybeSingle()` edge loops.

### Supabase Database Architecture `[HARDENED]`
- **State**: `organizations`, `profiles`, `calls`, `campaign_leads`, `telnyx_settings`.
- **Role Scoping**: 
  - Admin = Sees entire `<org_id>`
  - Manager = Sees personal elements `+` hierarchy agents via `ltree` structure.
  - Agent = Sees only strict `auth.uid()` bounds.

### Power Dialer & Telephony Stack `[ACTIVE, TWO-LEGGED]`
- **State**: Advanced Server-Side bridging in production via `telnyx-webhook`. The flow is fundamentally decentralized from the UI. 1. Agent asks for dial. 2. Edge Function dials the prospect (PSTN Leg 1). 3. Webhook parses Answer/Hangup (detects AMD natively). 4. Upon detecting humans it executes bridging to the React WebRTC SDK.
- **Constraints**: Telnyx Keys and App-IDs must *never* be handled on the frontend; they must always query from Supabase Vaults.
- **Next Up**: Optimize state boundaries replacing rigid `DialerPage.tsx` array loads with dynamic Realtime Injection.

### CRM & Kanban Visualization `[IN PROGRESS]`
- **State**: Contacts are structurally partitioned via rigid SQL definitions into `Leads` (Pipeline), `Clients` (Closed-Won), and `Recruits` (Agency).
- **Next Up**: Transitioning legacy flat-data data tables onto a `@dnd-kit` visual Drag-n-Drop Kanban dashboard inherently updating standard SQL lifecycles via RPCs natively. 

---

## 2. Environment Variables Log

| Variable Name | Required Location | Domain |
| :--- | :--- | :--- |
| `TELNYX_API_KEY` | Edge Secrets (`telnyx_settings` table proxy) | Dialer Integration |
| `SUPABASE_URL` | Edge Native / React Root | App Backbone |
| `SUPABASE_ANON_KEY` | React Root | Frontend Reads |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Secrets | Webhook writes & RLS Bypasses |
| `RESEND_API_KEY` | Edge Secrets | Transactional emails |

---

## 3. Database Migration History (Most Recent)

| Migration ID | File Name / Topic | Result |
| :--- | :--- | :--- |
| `20260401000300` | `harden_handle_new_user.sql` | Fixed silent profile creation crashes by enforcing complete Null-Safety. |
| `20260401000400` | `update_invitations_rls.sql` | Enforced strict organizational cross-tenant checks on newly invited agents. |
| `20260402000004` | `fix_invitations_leak.sql` | Hardened invitation RLS policies and added secure RPC for token verification. |

---

## 4. Work Log (Check-in/Check-out)

> *Format: Date | Task Completed | Notes*

- **2026-04-01 | [DONE] Arch Manual Baseline Built**  
  *Developer Note:* Established foundational `AGENT_RULES.md` rules and generated the complete architectural reports bounding the AI logic completely to the Life Insurance vertical. Solidified the "Webhook-First" and `Resend SDK` strategies.

- **2026-04-01 | [DONE] Codebase Hardening Sprint (Phase 1)**  
  *Developer Note:* Replaced dangerous `.single()` data fetching calls with `.maybeSingle()` across Dashboard and core configs. Added exact `Zod` form validation to `AddLeadModal` and `AddClientModal`. Installed automatic network drop reconnect logic into the `TelnyxContext` WebRTC hook.

- **2026-04-02 | [DONE] Automated Call Activity Logging**  
  *Developer Note:* Captured WebRTC states inside `TelnyxContext` via `activeLeadIdRef`. Non-blocking `insertCallLog` method implemented to persist metrics to new `call_logs` table (migration `20260402000000_create_call_logs.sql`).

- **2026-04-02 | [DONE] JWT Auth Claims & RLS Optimization**  
  *Developer Note:* Eradicated slow RLS subqueries. Pushed `organization_id` natively into `auth.users.raw_app_meta_data` via SQL trigger (`20260402000001_jwt_auth_claims.sql`). Re-wrote `leads`, `clients`, and `call_logs` policies relying strictly on `public.get_org_id()` (`20260402000002_lockdown_rls.sql`). Handled token issuance latency by blocking new agent dashboards with a polling loading spinner in `AuthContext.tsx`.

- **2026-04-01 | 7:37 PM PST | [DONE] Authentication & Onboarding QA Audit**  
  *Developer Note:* Surgically addressed 5 critical bugs. Fixed UI/UX parity for Signup and AcceptInvite pages. Implemented a dedicated Confirmation page and forced email verification by disabling automatic confirmation in the `create-user` Edge Function. Hardened invitation management with a "Revoke -> Delete" flow and secure RLS isolation. (Migration `20260402000004_fix_invitations_leak.sql`).

- **2026-04-02 | 8:41 AM PST | [DONE] Contacts QA Audit & Edge Routing**  
  *Developer Note:* Removed generic UI click-to-dials enforcing Telephony to single views. Engineered `import-contacts` Edge Function with Bouncer RLS queries ensuring `user_id` downline security. Constructed advanced UI states for Round-Robin/Specific deployments. Centralized the 'Holding Pen' Resolution Queue trapping imports side-by-side for manual Manager review if duplicates trigger.
