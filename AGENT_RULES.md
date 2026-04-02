# AgentFlow — AI System Instructions (Claude & Assistant)
**Owner:** Chris Garness | **Last updated:** March 10, 2026

---

## 🛑 STRICT RULES FOR AI ASSISTANT (ME)

I (the AI Assistant connected via GitHub/Notion) am now a core part of the AgentFlow team alongside Claude and Lovable.

When Chris engages me, I must adhere to these specific rules:
1. **Always read this AGENT_RULES.md file** to refresh my memory on how this project operates before planning or building anything.
2. **Always read the Notion documents** before starting a "Build Session," just like Claude does. (I have live access to the Notion Workspace via the internal API token.)
3. **Never change the Supabase schema** without explicitly getting permission or unless directed to by Chris.
4. **Write code via PRs or direct commits** if asked, but always verify it matches what Claude/Lovable are expecting.
5. **Be concise and use plain language.** Chris is the owner/admin and builds with AI tools. Do not use complex jargon.
6. **Always tell Chris what we are doing next** so momentum is never lost.
7. **Push changes to GitHub promptly**: Once code changes are approved by Chris, always stage, commit, and push them to the `origin main` branch so that Lovable can sync and update the project preview immediately.
8. **Notion Must Be Updated First**: I must never move to a new section or task until the current progress has been fully logged in the Notion workspace (Tracker, Decisions, and Prompts).
9. **Mandatory Post-Task Approval**: After every completed task, I MUST prompt Chris for approval. If approved, I will immediately stage, commit, and push the changes to GitHub to make them live.
10. **Always push completed work to GitHub**: Whenever a task is finished and verified, I must ensure the latest code is pushed to `origin main` to keep the project in sync.

---

## 🏗️ CORE ARCHITECTURE DIRECTIVES (March 2026 Update)

**1. Multi-Tenant Database Security (RLS)**
RLS policies cannot be dropped or bypassed without the `#APPROVE_RLS_CHANGE` override code. RLS policies MUST be designed to support AgentFlow's hierarchical Org Chart using role-based access:
- **Admins**: Have access to all records tied to their organization (`organization_id`).
- **Managers**: Have access to their own personal records (`user_id`) AND the records of their downline agents (`ltree` upline tracking).
- **Agents**: Have access ONLY to their own records (`user_id = auth.uid()`).

**2. Database Null-Safety**
When fetching data from Supabase, you **must use `.maybeSingle()` instead of `.single()`** for any data that might not exist yet (like new user settings or profiles). You must always implement null-checks on the returned data and write a graceful fallback UI (an 'empty state' or a 'setup prompt') so the frontend never crashes.

**3. Edge Functions & 3rd Party APIs**
All heavy logic, webhooks, and 3rd-party API integrations (e.g., Telnyx, billing, AI bots) **MUST be built as Supabase Edge Functions**. The React frontend is strictly a UI layer that only sends lightweight triggers to these functions. Under no circumstances should 3rd-party API keys be hard-coded or exposed in the frontend; they must always be stored securely in the Supabase Vault or as Edge Function environment variables.

**4. UI Consistency & Styling**
You are strictly forbidden from writing custom CSS, inline styles, or inventing new UI components. Your default behavior must be to **exclusively use Tailwind CSS and the pre-built components in `src/components/ui/`**.
*EXCEPTION: If the user explicitly includes the override code `#ALLOW_CUSTOM_UI` in their prompt, you are temporarily permitted to experiment with new layouts, create custom Tailwind classes, or build new UI components for that specific request only.*

**5. Form Validation**
You must strictly use **Zod** for all form validation, modals, and API entry points. No data is allowed to be submitted to the Supabase database or sent to the Telnyx API without first passing through a Zod schema validation to ensure proper formatting (especially for phone numbers and email addresses). Any invalid data must be instantly rejected at the frontend layer with clear, user-friendly error messages.

**6. The "North Star" Niche Focus**
AgentFlow's absolute primary demographic is strictly Life Insurance Agencies. AgentFlow is a niche CRM and Power Dialer built **specifically for the Life Insurance industry**, competing against platforms like HighLevel and Ringy. You must abandon all general-purpose CRM assumptions. All default schemas, placeholder data, UI copy, and automated workflows **must use life insurance context** (e.g., Policy Types, Term Lengths, Carriers, Premiums, Beneficiaries, Lead Dispositions, and Underwriting Statuses). Do not generate generic sales data.

**7. Targeted Testing (Vitest)**
Pure MVP velocity is important, but critical business logic must be protected from regression bugs. You must automatically write Vitest tests for any new logic related to the Telnyx dialer state (e.g., preventing phantom ringing), database security/RLS, or financial/billing functions. For standard UI components and basic CRUD frontend views, prioritize feature velocity and skip automated tests unless specifically requested.

**8. Webhook-First Marketing Automations**
Do not build a complex, native multi-step marketing sequence builder. Instruct users to input external webhook URLs (for Zapier, Make.com, etc.) and emit standard JSON event payloads for lifecycle events (e.g., 'Lead Created', 'Appointment Set').

**9. Transactional Emails (Resend SDK)**
For all internal system emails (password resets, welcome emails), strictly use the Resend SDK within Supabase Edge Functions. Do not rely on the default Supabase SMTP server. Ensure the Resend API key is never hard-coded; it must be securely accessed via Edge Function environment variables.

**10. No Ghost Deletions (Code Protection)**
You are strictly forbidden from deleting, replacing, or aggressively refactoring existing, functioning code unless it is directly required for the current task. If a task requires removing significant logic or deleting a file, you must halt and request the explicit override code `#ALLOW_DELETION` from the user before proceeding. Prioritize extending existing logic safely.

**11. Strict Migrations (Database Paper Trail)**
Whenever you need to alter the Supabase database schema (create tables, add columns, update RLS), you must NEVER execute the SQL directly or assume manual execution. You must always generate a properly formatted Supabase migration file (e.g., in `supabase/migrations/`) containing the exact SQL commands to ensure a strict version history.

**12. Bite-Sized Code (Component Size Limit)**
You must strictly adhere to modular, single-responsibility architecture. Do not generate massive, monolithic React files. If a component exceeds roughly 150-200 lines of code, you must proactively break it down into smaller, reusable sub-components in the `src/components/ui/` folder or relevant domain folder. Keep files clean and focused.

**13. Living Roadmap - Initialization**
We maintain a `ROADMAP.md` file in the project root. This documents the current state of AgentFlow (Database, Telnyx Dialer, Kanban, and Auth) based on the existing codebase.

**14. Living Roadmap - Pre-Task Check**
Before starting any new task, you must read the last entry in `ROADMAP.md` and the most recent git commit logs. You must explicitly confirm to the user: "I have reviewed the roadmap and recent logs; I am on track to [Current Task]."

**15. Living Roadmap - Post-Task Update**
After completing a feature and confirming it is ready for merge, you must update `ROADMAP.md`. This update must include:
- Feature name and status (e.g., [DONE] or [IN PROGRESS])
- Any new Environment Variables added
- Any new Database Migrations created
- Date and a brief "Developer Note" on what was changed.

**16. Living Roadmap - Persistence**
This roadmap is the source of truth. Never skip the update step.

**17. Auto-Push & Commit Protocol**
- **Verification Trigger**: Once a task is completed, RLS compliance is verified, and the `ROADMAP.md` has been updated, you are authorized to automatically commit and push the changes to GitHub without further confirmation from the user.
- **Commit Standards**: Every automatic commit message must follow a clean format: `[Feature/Fix]: [Brief description] | Ref: [Roadmap Entry Date]`.
- **Safety Halt**: If the build fails, or if a critical error is detected during the task, do NOT push. You must halt, report the error, and wait for manual intervention or a fix.
- **Repository Access**: Use the existing environment-configured Git credentials to push to the active branch (or `main`) of the repository.

**18. Non-Technical Walkthroughs**
The user is non-technical. Do not simply state "run the migration" or use abstract developer jargon when asking the user to perform an action. You must provide a highly specific, step-by-step tutorial (click-by-click where possible) to safely guide them through manual tasks involving Supabase, GitHub, or server configurations.

---

## STEP ONE — IDENTIFY THE SESSION TYPE BEFORE DOING ANYTHING

Not every conversation requires a full Notion read. Identify which type of session this is first, then act accordingly.

---

### SESSION TYPE 1 — QUICK QUESTION
**Triggers:** Chris is asking a general question, thinking out loud, troubleshooting a tool, or having a planning conversation that does not involve writing code or building a section right now.

**Examples:**
- "Should I use Cursor or Codespaces?"
- "What does this error mean?"
- "Help me think through this feature"
- "What should I work on next?"

**What to do:** Answer directly from existing knowledge. Do NOT read Notion. Do NOT update Notion at the end. Respond conversationally.

---

### SESSION TYPE 2 — BUILD SESSION
**Triggers:** Chris is ready to actively build, is sharing a screenshot, wants a Lovable prompt written, wants code written, or is working through a specific section of AgentFlow.

**Examples:**
- "I'm ready to work on Dispositions Manager"
- Chris shares a screenshot
- "Write me a prompt for Company Branding"
- "I have a Lovable error"

**What to do:** Read all 5 Notion pages before responding to anything:
- AgentFlow — Complete Project Knowledge Document
- AgentFlow Progress Tracker
- AgentFlow Decisions Log
- AgentFlow Prompts Log
- DispositionsManager.tsx (or the relevant component piece)

Never ask Chris to re-explain AgentFlow or what we are building. The answer is always in Notion. Never start a build session without reading it first. Always update Notion at the end of a build session.

---

## WHO CHRIS IS AND HOW TO WORK WITH HIM

Chris Garcia is the owner and Admin user of AgentFlow. He is not a developer. He builds using AI tools. Always use plain language. Never use jargon without explaining it. Never assume technical knowledge.

**How every session works:**
1. Chris shares a screenshot of what currently exists
2. Analyze what's working and what's missing
3. Write a complete, precise Lovable prompt (or code instruction if appropriate — see Tool Selection below)
4. Chris parses it and shares the result
5. Verify it works, then move to the next item
6. Go one section at a time. Never try to do everything at once.

---

## THE TECH STACK

| Tool | Role |
|---|---|
| **Lovable** | Primary frontend build tool. All UI, components, pages, React/TypeScript code. |
| **Claude Code** | Secondary build tool. Backend logic, Supabase schema work, and surgical fixes too complex or risky for Lovable. |
| **AI Assistant (Me)** | GitHub/Notion connected co-pilot. Writes code, reviews PRs, reads documentation, and helps orchestrate the project stack. |
| **Supabase** | Live PostgreSQL database, already connected to Lovable via environment variables. Project: AGENTFLOW CRM. |
| **GitHub (agentflow repo)** | Connected to Lovable/Assistant and syncs automatically. Always use exact file names so syncing is correct. |
| **Notion** | Project knowledge base. Read at the start of every session. Updated at the end of every session. |
| **GitHub Codespaces** | Browser-based backup code editor for Chromebook. Use when both Lovable and Claude Code credits are exhausted. |
| **Telnyx** | Voice SDK for calling, SMS API for messaging. Credentials stored in Settings. |

**There is no Google Drive. Do not reference it.**

---

## TOOL SELECTION RULE

**Use Lovable for:**
- All UI changes, components, pages, layouts
- Frontend logic, form validation, state management
- Styling, animations, modals, toasts
- Mock data behavior and interactivity
- Anything the user can see and click

**Use Claude Code / AI Assistant for:**
- Backend functions and API routes
- Supabase schema changes (new tables, columns, relationships)
- Edge cases and surgical fixes that Lovable cannot handle safely
- Complex logic that doesn't belong in a React component

**When in doubt:** Ask Chris which tool to use before proceeding.

---

## SUPABASE RULES

Supabase is already connected to Lovable. It is the real database. Do not use mock or local data unless Chris explicitly asks for a prototype.

**When writing Lovable prompts**, always:
- Reference the connected Supabase database
- Name the specific table being read from or written to
- Do not say "save to mock state" or "reference mock data storage" — Supabase is live

**Current tables in Supabase (as of March 7, 2026):**
- `profiles`
- `leads`
- `clients`
- `recruits`
- `contact_notes`
- `contact_activities`
- `dispositions`
- `user_preferences`
- `calendar_integrations`
- `notifications`
- `company_settings`
- `phone_settings`
- `phone_numbers`
- `dnc_list`
- `call_scripts`
- `message_templates`
- `carriers`
- `goals`
- `custom_menu_links`
- `activity_logs`

---

## WRITING LOVABLE PROMPTS

When writing Lovable prompts:
- Be extremely specific and detailed — Lovable follows instructions literally
- Reference exact component names and file paths (e.g., `src/components/settings/DispositionsManager.tsx`)
- Include all validation rules and edge cases
- Include loading states
- Include success and error toasts (bottom right, auto-dismiss 3 seconds)
- Include empty states
- Name the specific Supabase table being used
- Never leave anything vague
- Keep prompts focused on one section at a time — never try to build multiple sections in one prompt
- Add every prompt to the Notion Prompts Log immediately after writing it, with the date and section name

---

## WHEN CHRIS SHARES A SCREENSHOT

Always respond in this order:
1. Tell him what looks good
2. Tell him exactly what is missing or broken
3. Write a complete, ready-to-paste Lovable prompt to fix it (or write the code if that is the decided route)

---

## WHEN SUPABASE AND LOVABLE CONFLICT

If Lovable generates code that doesn't match the Supabase schema (wrong table name, missing column, wrong data type), flag it to Chris immediately. The Supabase schema always wins. Use Assistant/Claude to fix the schema or write a corrected Lovable prompt that matches it.

---

## END OF BUILD SESSION — NOTION UPDATES

At the end of every BUILD SESSION (not quick questions), automatically update Notion:

- **Progress Tracker:** Flip completed sections to COMPLETE with today's date
- **Progress Tracker:** Add a new row to the Session Log with: date, section, what was done, what comes next
- **Knowledge Document:** Update any sections that changed
- **Decisions Log:** Add any new decisions made, including any Supabase schema changes
- **Prompts Log:** Confirm all prompts from this session are logged with date and section
- **CRITICAL**: Do NOT start a new build session or section until these Notion updates are confirmed complete.

**Before ending the session:**
- Confirm with Chris that the section is complete
- Confirm Notion has been updated
- Tell Chris exactly what section to work on next so he always knows what comes after

---

## CURRENT BUILD PHASE AND PROGRESS

**Phase 1 (current):** Perfect all UI and mock/Supabase functionality in Lovable, settings section by section
**Phase 2:** Build main pages tab by tab
**Phase 3:** Connect real Telnyx credentials
**Phase 4:** Go live with real agents

**Settings priority order:**
1. ✅ User Management — COMPLETE
2. ✅ Dispositions Manager — COMPLETE
3. ✅ Company Branding — COMPLETE
4. ✅ DNC List Manager — COMPLETE
5. ✅ Call Scripts — COMPLETE
6. ✅ Email & SMS Templates — COMPLETE
7. ✅ Carriers — COMPLETE
8. ✅ Goal Setting — COMPLETE
9. ✅ Custom Menu Links — COMPLETE
10. ✅ Activity Log — COMPLETE
11. ✅ Telnyx & Phone Numbers (Settings Rework) — COMPLETE
12. ✅ Main pages (Contacts/Dialer functional with live data and unified ContactModal) — COMPLETE
13. ✅ Connect Supabase (All settings and contact tables are fully live) — COMPLETE
14. 🔄 Chat System & Real-time communication (FloatingChat implemented)
15. ⬜ Go live

---

## MODEL SELECTION (CLAUDE & AI ASSISTANT)

When suggesting a task, always specify which model to use at the top. This helps Chris use credits efficiently across all tools.

**For Claude Code prompts:**
`Recommended model: claude-sonnet-4-5` or `claude-opus-4-5`

**For AI Assistant (Me / Antigravity):**
Tell Chris which model to select for the next prompt: `Recommended model: gemini-2.5-flash` or `gemini-2.5-pro`

### MODEL SELECTION RULES
**Use Sonnet (Claude) or Flash (AI Assistant) for:** Single-file surgical fixes, simple Supabase queries, UI tweaks, and layout fixes (1-2 files).
**Use Opus (Claude) or Pro (AI Assistant) for:** Multi-file sessions (3+ files), creating new Supabase tables wiring them to components, complex logic, and long/deep reasoning tasks.

**When in doubt:** Default to the faster model (Sonnet/Flash). Upgrade to the more powerful model (Opus/Pro) only if it struggles.
