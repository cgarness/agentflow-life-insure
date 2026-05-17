# AgentFlow | Vision & Mission (draft — 2026-05-16)

**Owner:** Chris Garness | **Status:** Production V1 — Life Insurance CRM + Power Dialer

---

## 1. What AgentFlow Is

AgentFlow is a **CRM and power dialer built only for life insurance agencies** — not a generic sales CRM. It unifies leads, clients, recruits, campaigns, dialing, SMS, email, dispositions, reporting, and agency leadership tools in one system.

---

## 2. North Star

If a life insurance agent cannot make **300+ dials per day** while feeling energized by the software, we have failed. We optimize for **velocity without sacrificing the human connection**.

---

## 3. Three Never-Sacrificed Principles

1. **Telemetry** — Every dial, disposition, and stage change is captured for managers in real time.
2. **Speed** — UI and dial path must feel instant; no unnecessary bridge steps on outbound calls.
3. **UI Quality** — Enterprise-grade, dark command-center aesthetic; agents should *want* to work in the app.

---

## 4. Target Persona

- **Primary:** Life insurance agencies (captive and independent) with high-turnover **new agents** who need structure, scripts, and manager visibility.
- **We replace:** HighLevel (too broad), Ringy (heavy/laggy), and spreadsheet chaos.
- **Goal:** The **alpha tool** agencies switch to when they scale professionally.

---

## 5. Competitors We Replace

| Competitor | Why agents leave |
|------------|------------------|
| HighLevel | Generic; weak insurance-specific workflow |
| Ringy | Complex dialer UX, lag |
| Spreadsheets | No telemetry, no ownership, no compliance trail |

---

## 6. Tech Stack (current)

| Layer | Technology |
|-------|------------|
| Frontend | React, TypeScript, Vite, Tailwind, Radix/shadcn, TanStack Query, Zod |
| Backend | Supabase (Postgres + RLS + Realtime + Storage) |
| Telephony | **Twilio Voice.js** — single-leg WebRTC from the browser |
| Edge | Supabase Edge Functions (Deno) |
| Email | Gmail OAuth + Resend for system mail |
| AI | Anthropic API (available; product surfaces vary) |
| Hosting | Vercel (app) + Supabase (data/functions) |

**Telnyx is retired** in application code (April 2026 migration). Legacy Telnyx Edge Functions may still exist on the host until decommissioned.

---

## 7. Architecture Overview

- **Multi-tenant** by `organization_id` with RLS on every business table.
- **Roles:** Super Admin (platform) → Admin → Team Leader → Agent.
- **Hierarchy:** `ltree` for upline/downline where policies require it.
- **Agency Groups:** Optional peer orgs share **leaderboard-visible** metrics (`calls`, `wins`, `agent_scorecards`) — not full CRM data sharing.
- **Telephony:** Per-org Twilio **subaccounts** for numbers/CNAM; **master** TwiML App + Voice JWT for WebRTC registration.

---

## 8. Modules (current state)

### Auth & Tenant Isolation
Email auth via Supabase; JWT custom claims include `organization_id` and `is_super_admin`. Profiles gate onboarding and permissions. Super Admin dashboard for cross-org agency management.

### Power Dialer & Telephony
**Twilio single-leg WebRTC** outbound; inbound PSTN → TwiML → browser client. Campaign types (Personal / Team / Open), atomic queue locks, hard claim on meaningful Team/Open calls, mandatory dispositions, local presence caller ID, ring timeout, browser recording when enabled. Floating dialer for inbound answer/decline.

### Campaigns
Create/import leads, visibility by type, waterfall queue RPCs, realtime campaign card stats, disposition-driven queue lifecycle. `leads_contacted` / `leads_converted` on campaigns; **“Called” count awaits `leads_called` column**.

### Agency Groups
Schema, RLS, leaderboard RPC, Settings UI, invite/accept/leave/remove Edge Functions. **Live but no production groups yet** (May 2026).

### Two-Way Email
Gmail connect, incremental sync, compose from contact record, `contact_emails` thread storage. Built; usage depends on org connections.

### Inbound SMS
Twilio inbound webhook → `messages` with `direction = 'inbound'`. Outbound via `twilio-sms`. Super Admin tool `update-sms-urls` patches number webhooks.

### Conversations
Unified **SMS + email** thread UI per contact (`Conversations.tsx`) — **shipped** (no longer “coming soon”).

### AI Agents
Marketing and **mock dashboard** (`MOCK_AGENTS`) — **not production AI**. Workflow builder includes `assign_ai_agent` as “coming soon.”

### Billing
**Deferred.** `profiles.billing_type` (`agency_covered` / `self_pay`) exists for future Stripe; no Stripe integration in codebase.

---

## 9. Differentiators

- **Insurance-native** workflows (carriers, term life, beneficiaries, underwriting language).
- **Single-leg WebRTC** for minimum latency outbound dialing.
- **Hard claim + queue locks** for fair Team/Open pool dialing at scale.
- **Workflow automation** (SMS, email, stages, tags) with visual builder.
- **Agency Groups** for multi-org leaderboard competition without sharing books of business.

---

## Agency Groups: Peer Access Boundary

When two orgs share an active Agency Group, peer-read RLS allows SELECT on peer orgs’ **`calls`**, **`wins`**, and **`agent_scorecards`** — org-wide, not per-agent on the leaderboard. New tables need an explicit peer-read decision. Use `public.is_agency_group_peer_organization(uuid)`; only **`active`** membership counts.

---

## What We Do Not Build (by default)

- Generic non-insurance CRM features.
- Multi-line predictive dialer (unless explicitly commissioned).
- Telnyx or two-legged REST bridge dial paths.
