# AgentFlow | Living Roadmap 🚀

**Owner:** Chris Garness | **Last Updated:** April 5, 2026
**Niche Focus:** Life Insurance Agencies (High-Velocity CRM & Power Dialer)

---

## 1. System Status & Module Health

### 🔐 Authentication & Tenant Isolation `[STABLE]`
- **State**: Supabase Auth triggers `profiles` mirroring. Multi-tenant isolation is enforced via custom JWT claims (`organization_id`, `role`) and hierarchical `ltree` logic for downline management.
- **Recent Update**: Standardized `leads.user_id` and implemented `standardize_leads_user_id.sql` to ensure perfect ownership tracking.
- **Next Up**: Finalize invitation logic for Managers to invite downline Agents with auto-assigned `upline_path`.

### 🏗️ Database Infrastructure `[AUDITED — REWORKING]`
- **State**: The core table audit (Step 2) identified critical missing root objects.
- **Gaps**: Missing physical `organizations` table, `tasks` (follow-ups), and `dial_sessions` (metrics blocks).
- **Next Up**: Execute **SaaS Core Migration Block** to create `organizations` (multi-tenancy root), `tasks`, and `dial_sessions`.

### 📞 Power Dialer & Telephony `[PRODUCTION-READY]`
- **State**: 1-Line WebRTC Dialer (Telnyx) with Auto-Dial support. State management is decentralized via Supabase Edge functions and real-time triggers.
- **Features**: Smart Caller ID (Local Presence), Answering Machine Detection (AMD), Ring Timeout, and mandatory dispositions.
- **Next Up**: Optimize campaign refresh logic and integrate `dial_sessions` to track agent efficiency in real-time.

### 💼 SaaS & Infrastructure `[PLANNED — CRITICAL]`
- **State**: Entirely missing billing and SaaS partitioning layer.
- **Features Required**: Stripe integration, subscription tiers (Starter, Pro, Agency), and plan-based limiting (User caps, Dialing limits).
- **Next Up**: Initialize Stripe SDK and construct the `billing` Edge Function for subscription lifecycle management.

---

## 2. Recent Database Migration History (April 2026)

| Migration ID | Topic | Outcome |
| :--- | :--- | :--- |
| `20260404000000` | `standardize_leads_user_id.sql` | Aligned all lead ownership to unified `user_id` field for RLS performance. |
| `20260404000001` | `fix_leads_user_id_drift.sql` | Repaired historical lead data drift where ownership mapping was disconnected. |
| `20260404100000` | `dialer_rls_audit.sql` | Hardened Row-Level Security for campaigns and dialer state components. |
| `20260405000000` | `sync_leads_user_id_trigger.sql` | Added real-time trigger to sync master lead ownership with campaign states. |

---

## 3. Work Log (Recent History)

- **2026-04-05 | [DONE] Smart Queue Lock System**
  *Migration:* `20260405100000_smart_queue_lock_system.sql`
  *Files Created:* `src/hooks/useLeadLock.ts`
  *Developer Note:* Implemented atomic fetch-and-lock queue system for Team and Open Pool campaigns. Created `dialer_lead_locks` table with a unique partial index on `(lead_id) WHERE expires_at > now()` to enforce single active lock per lead. Three RPCs: `get_next_queue_lead` (SECURITY DEFINER, SELECT FOR UPDATE SKIP LOCKED — zero dead air), `renew_lead_lock` (30s heartbeat), `release_lead_lock` (called on skip/disposition/unload). Personal campaigns bypass the lock entirely via a direct `campaign_leads` query. Schema note: "contacts" in the task spec maps to `campaign_leads` in this codebase. Team pool scoped via `campaigns.assigned_agent_ids` (no `team_members` table exists). Filters (`status`, `state`, `lead_source`, `max_attempts`, `min_score`, `max_score`) designed as a flat key-value JSONB payload to support future plan-based filter limits.

- **2026-04-05 | [DONE] Permanent Dark Sidebar (Command Center)**  
  *Developer Note:* Enforced a constant dark theme for the Sidebar (Slate-900) to maintain a premium "Command Center" aesthetic across all global themes. Decoupled navigation elements from Light Mode styles to ensure 100% mission-critical visibility and consistency.
  
- **2026-04-04 | [DONE] Lead Ownership Standardization**  
  *Developer Note:* Massive schema refactor to ensure every lead record across all states (Master, Campaign, Dialer) is pinned to a correct, RLS-checked `user_id`. Optimized hierarchical reporting for agency managers.

- **2026-04-04 | [DONE] Agent Rule & Documentation Generalization**  
  *Developer Note:* Decoupled codebase from Lovable/Notion. Established **VISION.md** and **ROADMAP.md** as repository-native sources of truth. Updated **AGENT_RULES.md (v2.3.0)** to focus on the Antigravity (AI Orchestrator) workflow.

- **2026-04-02 | [DONE] Production Readiness Audit**  
  *Developer Note:* Verified security boundaries. Confirmed absolute RLS isolation for Leads, Clients, and Appointments. Verified Telnyx WebRTC stability for agent "Power Hours."

---

## 4. Phase 4 Deployment Strategy (Q2 2026)
1.  **SaaS Infrastructure**: Deploy `organizations` table and Stripe billing loops.
2.  **Follow-up Engine**: Deploy `tasks` and unified `notifications` for agent follow-ups.
3.  **Real-Time Metrics**: Connect `dial_sessions` to custom agent leaderboards based on live telnyx connects.
4.  **GO-LIVE**: Final production rollout for agency trial users.

---

## 5. Context Snapshot — Smart Queue Lock System (2026-04-05)

### What Was Built
A zero-race-condition queue system for Team and Open Pool campaigns. Two agents can never be served the same lead simultaneously because fetching and locking happens in a single Postgres transaction using `SELECT … FOR UPDATE SKIP LOCKED`.

**Database layer:**
- `public.dialer_lead_locks` — lock registry with 5-minute TTL per lock
  - Unique partial index `(lead_id) WHERE expires_at > now()` → one active lock per lead, enforced at the DB constraint level
  - RLS: org-scoped; agents see/modify only their own locks; Admins/TLs see all org locks
- `public.get_next_queue_lead(p_campaign_id, p_filters)` — SECURITY DEFINER RPC
  - Deletes stale locks → reads campaign type → filters eligible pool → `SELECT … FOR UPDATE OF cl SKIP LOCKED` → inserts lock → returns `campaign_leads` row
- `public.renew_lead_lock(p_lead_id)` — heartbeat extension, returns boolean
- `public.release_lead_lock(p_lead_id)` — immediate lock release

**Frontend layer (`src/hooks/useLeadLock.ts`):**
- `getNextLead(campaignId, campaignType, filters)` — branches on campaign type; Personal = direct query, Team/Open Pool = RPC
- `releaseLock(leadId)` — call on skip, disposition save, session end, beforeunload
- `startHeartbeat(leadId, onLockLost?)` — setInterval at 30s, warns if lock is lost
- `stopHeartbeat()` — clears interval

### Schema Decisions Made
| Decision | Rationale |
|---|---|
| `lead_id` references `campaign_leads(id)` | No `contacts` table exists; `campaign_leads` is the dialer's queue entity |
| Team pool via `campaigns.assigned_agent_ids` | No `team_members` table; agent membership stored as JSONB array on the campaign |
| `SECURITY DEFINER` on `get_next_queue_lead` | Required to read the full campaign pool across all agents (RLS would block cross-agent reads) |
| Filters as flat JSONB object | Enables future plan-based count limiting (e.g. "Starter = 2 filters max") without changing the function signature |
| `FOR UPDATE OF cl SKIP LOCKED` with JOIN | Locks only the `campaign_leads` row; leaves `leads` row unlocked (not needed) |

### What Prompts 2 and 3 Depend On
- **Prompt 2 (Dialer Integration)**: Call `useLeadLock.getNextLead()` on campaign start and after each disposition. Wire `startHeartbeat` / `stopHeartbeat` around the active lead. Add `beforeunload` listener calling `releaseLock` on `DialerPage`.
- **Prompt 3 (Campaign Settings — Queue Filters UI)**: Managers need a filter editor on the Campaign Settings modal that saves `queue_filters` JSONB onto the `campaigns` table. The hook reads this from the campaign record and passes it to `getNextLead`. Fields: `status`, `state`, `lead_source`, `max_attempts`, `min_score`, `max_score`. Plan-tier enforcement hooks here (count active filter keys before calling RPC).
