# AgentFlow Settings Layout & Configuration Map

This document provides a comprehensive, field-level map of the AgentFlow Settings architecture. It serves as the authoritative reference for developers and AI agents when modifying or extending the settings system.

---

## 🏗️ Architecture Overview

The Settings page is built as a single-page application (SPA) wrapper that dynamically renders components based on URL search parameters.

- **Main Wrapper**: `src/pages/SettingsPage.tsx`
- **Routing Logic**: `src/components/settings/SettingsRenderer.tsx`
- **Menu Configuration**: `src/config/settingsConfig.ts`
- **Navigation State**: Uses the `?section=[slug]` query parameter.

---

## 📁 Settings Categories

### 1. Agency & Team
*Focuses on user identity, organizational structure, and branding.*

#### [My Profile](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/MyProfile.tsx) (`my-profile`)
- **Personal Info**: First Name, Last Name, Email (Read Only), Bio.
- **Security**: Current Password, New Password, Confirm Password.
- **Preferences**: Theme (Light/Dark/System), Dashboard Layout.
- **My Goals** (all roles): Daily calls, monthly policies, weekly appointments, monthly talk time (stored on `profiles` via `updateProfile`).

#### [User Management](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/UserManagement.tsx) (`user-management`)
- **User List**: Table of all organization members with name, email, role, and current status.
- **Invite System**: Modal to invite new users via email with predefined roles.
- **Actions**: Edit user roles, toggle active/inactive status, delete user (triggers `TransferLeadsModal.tsx`).

#### [Permissions](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/Permissions.tsx) (`permissions`)
- **Role-Based Access Control (RBAC)**:
  - **Module Access**: Toggle visibility of Dashboard, Leads, Calendar, Campaigns, etc.
  - **Feature Guards**: Toggle specific actions (e.g., "Can Delete Leads", "Can Export Data").
  - **Data Scopes**: Personal, Team, or Organization-wide data visibility.

#### [Company Branding](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/CompanyBranding.tsx) (`company-branding`)
- **Identity**: Agency Name, Primary Logo (Upload), Favicon (Upload).
- **Aesthetics**: Primary Branding Color (Picker), Border Radius.
- **Localization**: Agency Timezone, Date Format, Time Format.

#### [Custom Menu Links](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/CustomMenuLinks.tsx) (`menu-links`)
- **External Links**: Add/Edit links that appear at the bottom of the sidebar.
- **Fields**: Label, URL, Icon (Lucide selection), Sort Order.

---

### 2. Telephony Stack
*Manages the Telnyx integration, number inventory, and call logistics.*

#### [Phone System](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/PhoneSettings.tsx) (`phone-system`)
- **Telnyx API**: API Key, Public Key, Connection ID.
- **Number Management**: Inventory of purchased numbers with SIP details.
- **Features**: 
  - **Local Presence**: Toggle to dynamically match outbound caller ID to lead area code.
  - **Answering Machine Detection (AMD)**: Toggle and sensitivity settings.

#### [Inbound Routing](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/InboundCallRouting.tsx) (`inbound-routing`)
- **Business Hours**: Day-by-day active hours for the main agency line.
- **Routing Mode**: Round Robin, Assigned Agent First, or Simultaneous Ring.
- **Lead Intake**: Toggle "Auto-create Leads from unknown callers."
- **After-Hours**: Automated SMS response and routing to voicemail.

#### [Recording Settings](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/call-recording) (`call-recording`)
- **Policy**: Toggle "Record All Calls", "Record Inbound Only", or "Record Outbound Only."
- **Transcription**: Toggle automated AI transcription via Deepgram/Telnyx.
- **Retention**: Storage duration policies (e.g., 30 days, 90 days, Forever).

#### [Recording Library](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/CallRecordingLibrary.tsx) (`recordings`)
- **Search & Filter**: Filter by date, agent, contact, or duration.
- **Playback**: Embedded audio player with waveform and transcription sync.
- **Coaching**: Add "Flags" or notes to specific timestamps for review.

#### [Call Monitoring](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/CallMonitoring.tsx) (`monitoring`)
- **Live Feed**: Real-time view of active calls within the organization.
- **Executive Actions**: Listen (Silent), Whisper (Agent only), Barge (All parties).

#### [Number Reputation](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/NumberReputation.tsx) (`number-reputation`)
- **Caller ID health**: Twilio Voice Insights reputation, per-carrier signals, and spam-likelihood indicators per number.
- **Checks**: On-demand reputation refresh (rate-limited) with row detail for attestation and carrier JSON.

---

### 3. Sales Strategy
*Configures the logic for lead progression and agent performance.*

#### [Call Scripts](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/CallScripts.tsx) (`call-scripts`)
- **Script Editor**: Rich text editor for creating agent talk tracks.
- **Metadata**: Product Type (Life, Health, Final Expense), Script Category (Intro, Rebuttal, Close).
- **Merge Fields**: Tooltips for using `{{first_name}}`, `{{policy_type}}`, etc.

#### [Dispositions](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/DispositionsManager.tsx) (`dispositions`)
- **Outcome Management**: Configure "Hot Lead", "Not Interested", "Disconnected", etc.
- **Automation Triggers**: Map dispositions to status changes (e.g., "Sold" -> Move to Client).
- **UI Elements**: Custom colors and icons for easy identification in logs.

#### [Contact Flow](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/ContactManagement.tsx) (`contact-management`)
- **Pipelines**: Define stages for Leads, Recruits, and Clients separately.
- **Custom Fields**: Creation of organization-specific fields (e.g., "Policy Anniversary").
- **Lead Sources**: Tracking for social media, direct mail, or third-party lead buys.

#### [DNC List](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/DNCSettings.tsx) (`dnc`)
- **Suppression Management**: Global Do-Not-Call list for the organization.
- **Actions**: Manual entry, CSV bulk import, and expiration logic.

#### [Goal Setting](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/GoalSetting.tsx) (`goals`)
- **Performance Targets**: Set organization-wide or team-specific goals.
- **Metrics**: Dial volume, average talk time, and conversion percentage.

#### [Calendar](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/CalendarSettings.tsx) (`calendar-settings`)
- **Scheduling Defaults**: Default appointment duration, buffer time between meetings.
- **Appointment Types**: Customizable meeting types (e.g., "Initial Interview", "Closing Call").
- **Integrations**: Google Calendar sync (OAuth) and sync mode (1-way vs 2-way).

---

### 4. Automation & API
*Extensibility and automated communication.*

#### [Email & SMS Templates](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/EmailSMSTemplates.tsx) (`templates`)
- **Communication Library**: Templates for manual and automated reach-out.
- **Features**: Merge field support, subject line editor, and type-specific (SMS vs Email) previews.

#### AI Settings (`ai`)
- **Model Config**: Selection of AI providers (Anthropic/OpenAI) and specific models for transcription and summaries.
- **Tone & Persona**: Instructions for AI-generated notes.

#### Automation (`automation`) / Webhooks (`webhooks`)
- **Integration Points**: Placeholders for Zapier, Make.com, and custom incoming/outgoing webhook endpoints.

---

### 5. System
*Audit trails, low-level data access, and infrastructure.*

#### [Carriers](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/Carriers.tsx) (`carriers`)
- **Managed Carriers**: List of insurance carriers supported by the agency.
- **Fields**: Name, Appointed Status, Portal URL.

#### [Activity Log](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/ActivityLog.tsx) (`activity-log`)
- **Audit Trail**: Detailed log of every sensitive action taken in the system.
- **Fields**: User, Action, Timestamp, IP Address.

#### [Master Admin](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/MasterAdmin.tsx) (`master-admin`)
- **Infrastructure Tools**: Low-level database table browser for quick manual corrections or debugging.
- **Migration Tracking**: Indicators for tables still migrating from mock to Supabase.

#### [Agency Hierarchy](file:///Users/CHRIS/AgentFlow/agentflow-life-insure/src/components/settings/HierarchyTree.tsx) (Operational)
- **Visual Chart**: Tree view of managers and agents.
- **Permission Painting**: Feature to bulk-apply settings or permissions to an entire branch of the hierarchy.

---

> [!NOTE]
> All settings are primarily persisted to Supabase using standard `upsert` patterns. Organization-wide settings often use a `SINGLETON_ID` (`00000000-0000-0000-0000-000000000000`) for storage.
