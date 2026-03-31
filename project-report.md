# 🛡️ AgentFlow Project Manual — Technical Reference

This document provides a comprehensive, high-fidelity technical overview of the AgentFlow platform. It details the architecture, data models, security posture, and integrated systems driving the project's mission-critical operations.

---

## 🏗️ SECTION 1: ARCHITECTURAL OVERVIEW

### 1.1 Two-Legged Server-Side Telephony
AgentFlow utilizes a sophisticated **Two-Legged** call control model, replacing the legacy client-side-only approach. This architecture ensures production-grade stability, deterministic state management, and reliable **Premium Answering Machine Detection (AMD)**.

*   **Mechanism**:
    1.  **Initiation**: The agent triggers `makeCall` in the frontend (`TelnyxContext.tsx`).
    2.  **Auth Guard**: The system verifies an active Supabase session before proceeding.
    3.  **Customer Leg**: The `dialer-start-call` Edge Function initiates an outbound leg to the Prospect using **Premium AMD**.
    4.  **Analysis**: The `telnyx-webhook` monitors the call. If a machine is detected, the call is automatically hung up and dispositioned "No Answer."
    5.  **Agent Bridge**: If a human is detected, the webhook executes a Telnyx `bridge` (transfer) to the agent's individual `sip_username` (e.g., `sip:agent_uuid@sip.telnyx.com`).
    6.  **Browser Answer**: The agent's browser (WebRTC) auto-answers the incoming bridge leg, establishing a live connection.

### 1.2 Multi-Tenant Data Isolation (RLS)
The platform is built on a shared-database, multi-tenant model. Data security is enforced at the database layer via **Row Level Security (RLS)**.

*   **Isolation Level**: Every database query is strictly filtered by `organization_id`.
*   **Security Posture**: Agents can only access data belonging to their specific organization. This applies to leads, calls, recordings, and organization-wide settings.
*   **Hardened Tables**: All core tables (`leads`, `calls`, `campaign_leads`, `phone_numbers`, `profiles`) have been hardened to prevent cross-tenant data leakage.

---

## 🗄️ SECTION 2: DATABASE SCHEMA & INTEGRITY

### 2.1 Core Telephony Tables
| Table Name | Primary Purpose | Key Relationships |
| :--- | :--- | :--- |
| `calls` | Transactional history of every voice interaction. | `agent_id`, `lead_id`, `campaign_id` |
| `telnyx_settings` | Infrastructure secrets: API Key, SIP Password, and **Call Control App ID**. | `organization_id` |
| `phone_numbers` | Inventory of active, purchased organization numbers. | `organization_id`, `assigned_to` |
| `campaign_leads` | Queue state for automated dialing cycles. | `campaign_id`, `lead_id` |

### 2.2 Data Integrity Strategy
*   **Safe Fetching**: High-risk `.single()` calls have been refactored to `.maybeSingle()` across all settings and profile handlers. This prevents UI crashes for new organizations/users who have not yet configured default records.
*   **Type Safety**: Strict UUID validation (regex) is enforced in `TelnyxContext.tsx` to prevent PostgreSQL type-errors when passing metadata to the `calls` table.

---

## 📞 SECTION 3: POWER DIALER & AMD FLOW

### 3.1 The "Brain" (telnyx-webhook)
The `telnyx-webhook` Edge Function acts as the central logic engine for call control.

*   **Premium AMD Logic**:
    -   **Human Detected**: Triggers a Telnyx `transfer` action to the agent's SIP URI.
    -   **Machine Detected**: 
        1.  Issues a REST `hangup` command.
        2.  Calculates duration and updates the `calls` record.
        3.  Increments `call_attempts` and sets the disposition to `No Answer` in `campaign_leads`.
        4.  Triggers an activity log for the lead.
*   **Identity Persistence**: Uses Base64-encoded `client_state` (the internal Supabase `call_id`) to link Telnyx events (Initiated, Answered, Hangup) back to the correct database record across disparate legs.

### 3.2 UI Performance & Snappiness
*   **UI Lag Reduction**: The post-call reset timeout in `TelnyxContext.tsx` is reduced to **200ms** (down from 2000ms), ensuring agents are immediately ready for the next dial or workflow action.
*   **Auto-Dialer Progression**: The system uses a reactive `CustomEvent` ("auto-dial-next-lead") to trigger the next call immediately after the previous one is finalized and disconnected.

---

## ⚙️ SECTION 4: INTEGRATION & SETTINGS

### 4.1 Decoupled Telnyx Configuration
To prevent registration issues, the SIP Connection and the Call Control Application are decoupled.
*   **`connection_id`**: Used for SIP/WebRTC registration and token provisioning.
*   **`call_control_app_id`**: Used specifically for the server-side "Two-Legged" dialer commands.

### 4.2 Edge Function Matrix
| Function | Endpoint | Impact |
| :--- | :--- | :--- |
| `dialer-start-call` | `/v1/dialer-start-call` | Initiates the outbound PSTN leg with AMD enabled. |
| `telnyx-webhook` | `/v1/telnyx-webhook` | Handles AMD results, bridging, hangup logging, and activity sync. |
| `telnyx-token` | `/v1/telnyx-token` | Provisions secure WebRTC tokens for the browser client. |
| `daily-briefing` | `/v1/daily-briefing` | AI-generated summary of yesterday's performance for the dashboard. |

---

## 🗺️ SECTION 5: DEVELOPMENT ROADMAP & PRIORITY

### 5.1 Completed Features (✅)
1.  **Two-Legged Architecture**: Full migration from client-side dialing to server-side control.
2.  **RLS Hardening**: Strict multi-tenant isolation across 100% of core business tables.
3.  **Premium AMD**: Integrated webhook handling for automated machine detection and hangup.
4.  **Query Stability**: Elimination of `.single()` related crashes for setting tables.
5.  **SIP Security**: Per-agent SIP usernames for granular call bridging.
6.  **UI Refresh**: Removed `TestDialerPage` and orphaned boilerplate to ensure repo hygiene.

### 5.2 Next Steps (Priority List)
1.  **Secure Sales Notifications**: Refactor `WinCelebration.tsx` to filter broadcasts by `organization_id`.
2.  **WhatsApp Integration**: Phase 1 scoping for bidirectional messaging via Telnyx/Supabase.
3.  **AI Agent Backend**: Connectivity for Voice AI bots to handle off-hour inbound leads.
4.  **Email Omni-channel**: Connect Resend/SendGrid to the Conversations module.
5.  **Analytics V2**: Deep-dive geographic heatmaps and campaign ROI trackers.

---

## 🚀 SECTION 6: DEPLOYMENT SPECIFICATION

### Essential Secrets (Supabase Edge)
The following secrets must be set for full operational capacity:
- `TELNYX_API_KEY`: Required for call control and token generation.
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`: Required for secure database updates from Edge Functions.
- `RESEND_API_KEY`: Required for transactional emails and invitations.

---
*Manual Generated On: 2026-03-31*
*Document Status: **PRODUCTION-READY***
*Architecture Version: **V4.2.0 (Two-Legged Server-Side)***
