# 🏗️ AgentFlow: Campaigns & Dialer Technical Architecture

## 1. Database Schema & Entity Relationships
The dialer relies on a strict separation of the Master CRM record and the Campaign Execution record.

*   **`public.leads` (Master Table):**
    *   **Role:** The central source of truth for contact information.
    *   **Core Fields:** `id`, `first_name`, `last_name`, `phone`, `state`, `lead_score`, `lead_source`, `assigned_agent_id` (Standardized April 4, 2026), `organization_id`.
    *   **Security:** Secured by hierarchical Row-Level Security (RLS) ensuring agents only see their assigned leads while managers see their downline.

*   **`public.campaigns` (Rules Engine):**
    *   **Core:** `id`, `organization_id`, `name`, `type` (`POOL`, `TEAM`, `PERSONAL`), `status` (`Active`, `Paused`, `Draft`).
    *   **Settings:** 
        *   `max_attempts`: Integer (or `NULL` for Unlimited). When set, eligibility is compared to **lifetime** `campaign_leads.call_attempts` for that contact in the campaign (not “attempts only after you change the setting”). Lowering the cap or switching from unlimited to a number can immediately stop further dials for contacts already at or over the cap.
        *   `calling_hours_start`/`end`: `TIME` (e.g., `08:00:00`).
        *   `retry_interval_hours`: Integer (hours to wait before a lead re-enters the queue; `0` bypasses the wait).
        *   `queue_filters`: `JSONB` blob containing manager-set filters (`status`, `state`, `min_score`, etc.).
    *   **Dialer Config:** `auto_dial_enabled` (boolean), `local_presence_enabled` (boolean).
    *   **Permissions:** `created_by` (uuid), `assigned_agent_ids` (uuid[]).

*   **`public.campaign_leads` (The Bridge):**
    *   **Links:** `campaign_id` (refs `campaigns`) -> `lead_id` (refs `leads`).
    *   **Execution State:** 
        *   `status`: (e.g., `'Queued'`, `'No Answer'`, `'Called'`, `'Interested'`).
        *   `call_attempts`: Incremented on each save/disposition.
        *   `last_called_at`: `TIMESTAMPTZ` updated on call completion.
        *   `scheduled_callback_at`: `TIMESTAMPTZ` for prioritizing future calls.

*   **`public.phone_settings` (Global Org Config):**
    *   Stores `ring_timeout` and `amd_enabled` (Answering Machine Detection) at the `organization_id` level.
    *   Independent of individual campaigns but merged at runtime by the dialer.

---

## 2. RBAC & Hierarchical Security (The 4 Tiers)
Security is enforced at the Postgres level using `organization_id`, Materialized Paths (`ltree`), and Supabase RLS.

*   **Super Admin:** Bypasses all RLS via custom JWT claims. Can view/edit all tenants across the platform.
*   **Admin (Agency Owner):** Bound to `organization_id`. Can view, create, and reassign all campaigns and leads within their agency.
*   **Team Leader (Upline):** Bound to `organization_id`. Uses `ltree` hierarchy to view campaigns and leads assigned to themselves OR any agent beneath them in the `upline_path`.
*   **Agent (Downline):** Bound to `organization_id`.
    *   **Campaign Visibility:** Agents only see campaigns where:
        1.  `type` contains `'POOL'`.
        2.  `created_by` equals their `auth.uid()`.
        3.  Their `auth.uid()` is present in the `assigned_agent_ids` array.
    *   **Lead Visibility:** Enforced by `campaign_leads_select` policy which branches based on campaign type (Agents see all leads in `POOL`/`TEAM`/`OPEN` campaigns for dialing, but only their own in `PERSONAL` campaigns).

---

## 3. Campaign Selection Phase (`CampaignSelection.tsx`)
The gateway to the dialer, handling pre-dial analytics and configuration.

*   **Data Fetching:** Queries the `campaigns` table where `organization_id` matches and status is in `['Active', 'Paused', 'Draft']`.
*   **Frontend RBAC Filter:** Enforces Agent visibility rules locally before rendering campaign cards to ensure a clean UI.
*   **Geographical Analytics (`campaignStateStats`):** 
    *   A custom `useQuery` aggregates `campaign_leads` joined with `leads(state)`.
    *   States are normalized via `normalizeState()`.
    *   Displays real-time counts of "Ready" leads per US State on the campaign card to help agents choose high-volume areas.
*   **Inline Toggles:** Allows toggling `local_presence_enabled` directly from the card. This triggers an optimistic UI update and a Supabase `update` to the `campaigns` table.

---

## 4. Campaign Settings Phase (`CampaignSettingsModal.tsx`)
The modal that controls behavioral constraints for a specific campaign.

*   **Data Hydration:** Merges data from two sources upon opening:
    1.  `campaigns`: Fetches `max_attempts` (handles "Unlimited" checkbox if `NULL`), `calling_hours_start/end`, `retry_interval_hours`, `auto_dial_enabled`, and `local_presence_enabled`.
    2.  `phone_settings`: Fetches `ring_timeout` and `amd_enabled`.
*   **Save Operation:** Executes parallel updates to both the `campaigns` table (for campaign-specific list rules) and the `phone_settings` table (for global telephony rules).
*   **Zero-Hour Retry:** Explicitly supports `0` for `retry_interval_hours`, allowing immediate redialing of leads without waiting for a cooling period.

---

## 5. The Enterprise Queue Waterfall (Database Layer)
Lead fetching is isolated to the `get_enterprise_queue_leads` Postgres RPC to ensure high-performance pagination and legal compliance.

### The SQL Filter Waterfall:
1.  **Terminal Status Exclusion:** `COALESCE(cl.status, 'Queued') NOT IN ('Closed Won', 'DNC', 'Completed', 'Removed')`.
2.  **Max Attempts Compliance:** `COALESCE(cl.call_attempts, 0) < COALESCE(v_max_att, 9999)`.
3.  **Timezone Compliance:** 
    *   Maps the lead's US `state` to an IANA timezone (defaulting to `America/New_York` if `NULL`).
    *   Calculates local time using `NOW() AT TIME ZONE l.tz`.
    *   Drops leads where local time is outside the campaign's `calling_hours_start` and `calling_hours_end`.
4.  **Retry Interval Compliance:** Drops leads if `NOW() < cl.last_called_at + (v_retry_hrs * interval '1 hour')`.
    *   **Bypass:** Always passes if `v_retry_hrs = 0` (Immediate Retry).
    *   **Bypass:** Always passes if `cl.last_called_at IS NULL` (Fresh Lead).
5.  **Priority Sorting (The Waterfall):**
    *   **Tier 1 (Callbacks):** `scheduled_callback_at <= NOW()` (Highest priority).
    *   **Tier 2 (Fresh Leads):** `call_attempts = 0`.
    *   **Tier 3 (Retry Eligible):** `call_attempts > 0`, sorted by the oldest `last_called_at`.

---

## 6. Dialer Execution & State Machine (`DialerPage.tsx`)

*   **Queue Management:** `leadQueue` holds batches of 50 leads. `currentLeadIndex` tracks the active lead. `fetchLeadsBatch` handles pagination by fetching the next 50 based on offset.
*   **Frontend Queue Filters:** Agents can locally filter the `displayQueue` by `status`, `state`, `source`, `min/max score`, and `attempts`. This creates a filtered view for the agent without altering the underlying `leadQueue` array order or the server-side waterfall.
*   **Auto-Dial Reactive Trigger:** A `useEffect` watches `[currentLead?.id, autoDialEnabled, telnyxStatus, telnyxCallState, showWrapUp]`. 
    *   It fires `makeCall` ONLY if `telnyxStatus === "idle"`, the dialer is ready, and the wrap-up modal is closed (`showWrapUp === false`).
    *   Includes a safety guard `hasDialedOnce` to prevent auto-dialing immediately upon campaign entry before the first manual action.
*   **State Sync:** 
    *   Clicking **"Save & Next"** updates the database with the new disposition.
    *   Locally increments `call_attempts` and injects the new status for instant UI feedback.
    *   Closes the wrap-up modal.
    *   Explicitly calls `autoDialer.resumeAutoDialer()` to signal the next lead is ready.
    *   Advances `currentLeadIndex` or fetches the next locked lead (in Team/Open mode), which triggers the `useEffect` to spark the next dial.

---
*Created on April 6, 2026, as the Definitive Diagnostic Source of Truth for AgentFlow campaigns and dialer systems.*
