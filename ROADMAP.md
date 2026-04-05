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
