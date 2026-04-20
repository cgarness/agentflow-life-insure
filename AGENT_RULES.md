# AgentFlow | AI System Instructions & Protocols (v3.0.0)
**Owner:** Chris Garness | **Last Updated:** April 9, 2026

---

## 🛑 THE GOLDEN RULES FOR AI AGENTS
I am a core software engineer at AgentFlow. I must adhere to these absolute rules:

1.  **Read Before Building**: Always read `AGENT_RULES.md`, `VISION.md`, and `ROADMAP.md` at the start of every session.
2.  **Audit Compliance**: New additions must align with the **April 2026 Software Audit (Step 1 & 2)**. Specifically:
    *   Treat `organizations` as the mandatory multi-tenancy root.
    *   Enforce `user_id` as the primary lead ownership field (Standardized April 4, 2026).
3.  **No Ghost Plans**: I am strictly forbidden from creating `implementation_plan` artifacts unless the user explicitly asks for one. I must prioritize concise **Audit Reports** via regular artifacts first.
4.  **Supabase First**: Never use mock data. Use live tables. Never execute SQL directly; always generate a `supabase/migrations/` file.
5.  **Concise Orchestration**: Chris is non-technical. Use plain language. Focus on results, not technical jargon.
6.  **GitHub Synchronicity**: Approval of a task implies immediate authorization to stage, commit, and push to `origin main`.

---

## 🏗️ CORE ARCHITECTURE DIRECTIVES

### 1. Multi-Tenant Mastery (RLS)
Security is enforced at the database layer. No data bleed. 
*   **Admins**: Access all records in their `organization_id`.
*   **Managers**: Access internal records + downline via `ltree` hierarchy.
*   **Agents**: Access only `user_id = auth.uid()`.

### 2. SaaS & Billing Readiness
Every architectural decision must support SaaS graduation:
*   **Billing**: Integration via Stripe SDK (Edge Functions only).
*   **Limits**: Plan-based enforcement (Starter/Pro/Agency) for User, Contact, and Lead caps.
*   **Organizations**: Centralized management of agency metadata and subscription status.

### 3. Database Null-Safety & Standards
*   **Selects**: Always use `.maybeSingle()` for singular lookups. Implement fallback UIs.
*   **Ownership**: Leads must always have a valid `user_id` and `organization_id`.
*   **Standardization**: Follow the `20260404000000_standardize_leads_user_id.sql` pattern for all future contact-based tables.

### 4. Telephony Security (Twilio Voice.js / WebRTC)
*   **Dialer model**: **Single-leg WebRTC** only—outbound calls are initiated from the browser via the Twilio Voice.js SDK (`device.connect`). Do not reintroduce **two-legged** flows (server REST dial to the customer + SIP bridge/transfer back to the agent) unless Chris explicitly requests it.
*   **Zero-Exposure**: API Keys, Secret Keys, and App-IDs must reside in **Supabase Vault** or Edge Secrets.
*   **WebRTC Guard**: Telephony initialization must be gated behind a valid Supabase Auth session.
*   **Audit Behavior**: Current system is a 1-line sequential dialer; do not attempt multi-line logic without specific instructions.

---

## 🛠️ THE TECH STACK & TOOLS

| Tool | Role |
| :--- | :--- |
| **Primary Engineering Agent** | UI/UX, Component Refactoring, Frontend Logic (Tailwind + Shadcn). |
| **Advanced Architectural Agent** | Supabase Migrations, Edge Functions, Core Telephony, and RLS lockdown. |
| **Orchestrator** | Documentation, Audit Reports, Roadmap tracking, and PR reviews. |

---

## 📦 COMPONENT STANDARDS
*   **Size Limit**: React components must be **<200 lines**. Proactively refactor massive files into single-responsibility sub-components in `src/components/ui/` or domain folders.
*   **Validation**: Use **Zod** for all form/modal entry points. Reject invalid numeric or phone formats at the frontend layer.
*   **Styling**: Strictly use Tailwind CSS. Custom inline styles or foreign CSS frameworks are forbidden.

---

## 📝 LIVING DOCUMENTATION PROTOCOL
1.  **Check-In**: Read `ROADMAP.md` and most recent Git logs.
2.  **The Work**: Execute tasks using surgical code edits.
3.  **Check-Out**: Update `ROADMAP.md` with:
    *   Date & Status ([DONE]/[IN PROGRESS]).
    *   New Environment Variables or Migrations created.
    *   Developer Note on architectural impact.

---

## 🚀 THE NORTH STAR
> "Life insurance agents deserve enterprise velocity without the complexity of legacy tools. We build for 300+ dials a day and 100% telemetry accuracy."
