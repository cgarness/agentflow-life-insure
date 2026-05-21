import { PLATFORM_ONLY_SETTINGS_SLUGS } from "@/config/permissionDefaults";
import { SETTINGS_CONFIG } from "@/config/settingsConfig";
import { STAT_DEFINITIONS } from "@/lib/stat-computations";
import { ACTION_METAS } from "@/lib/workflow-types";
import type { UiInventoryNode } from "@/lib/project-status/treeUtils";

/** Hierarchical UI inventory — one branch per main app nav tab. */
export function buildProjectStatusTree(): UiInventoryNode[] {
  const settingsChildren: UiInventoryNode[] = SETTINGS_CONFIG.flatMap((cat) =>
    cat.sections.map((s) => ({
      id: `settings.${s.slug}`,
      label: s.label,
      description: `${cat.label} · slug: ${s.slug}`,
      inferredStatus: (PLATFORM_ONLY_SETTINGS_SLUGS as readonly string[]).includes(s.slug)
        ? "PLACEHOLDER"
        : "LIVE",
      code: {
        files: ["src/pages/SettingsPage.tsx", "src/components/settings/SettingsRenderer.tsx"],
      },
    }))
  );

  const reportStatChildren: UiInventoryNode[] = STAT_DEFINITIONS.map((s) => ({
    id: `reports.stats.${s.id}`,
    label: s.label,
    description: `Category: ${s.category}`,
    inferredStatus: s.comingSoon ? "PLACEHOLDER" : "LIVE",
    code: {
      files: ["src/lib/stat-computations.ts", "src/components/reports/StatCard.tsx"],
      functions: ["computeAllStats"],
    },
  }));

  return [
    {
      id: "dashboard",
      label: "Dashboard",
      description: "Route /dashboard",
      code: {
        files: ["src/pages/Dashboard.tsx"],
        hooks: ["useDashboardStats", "useAuth", "usePermissions"],
      },
      children: [
        {
          id: "dashboard.banner",
          label: "Agency Group invite banner",
          inferredStatus: "LIVE",
          code: {
            files: ["src/components/dashboard/AgencyGroupInviteBanner.tsx"],
            tables: ["agency_group_members", "agency_groups"],
          },
        },
        {
          id: "dashboard.controls",
          label: "Global controls",
          children: [
            {
              id: "dashboard.controls.time-range",
              label: "Time range toggle",
              description: "day · week · month · year",
              inferredStatus: "LIVE",
            },
            {
              id: "dashboard.controls.perspective",
              label: "Personal / Team stats pill toggle",
              description: "Admin & Team Leader — team vs my stats",
              inferredStatus: "LIVE",
              code: { hooks: ["useDashboardStats"] },
            },
            {
              id: "dashboard.controls.layout",
              label: "Customize layout (edit mode)",
              description: "Drag widget order, hide widgets, save to user_preferences",
              inferredStatus: "LIVE",
              tables: ["user_preferences"],
            },
          ],
        },
        {
          id: "dashboard.stat-cards",
          label: "Stat cards row",
          code: { files: ["src/components/dashboard/StatCards.tsx"], hooks: ["useDashboardStats"] },
          children: [
            { id: "dashboard.stat-cards.calls", label: "Calls made", inferredStatus: "LIVE" },
            { id: "dashboard.stat-cards.policies", label: "Policies sold", inferredStatus: "LIVE", tables: ["clients"] },
            { id: "dashboard.stat-cards.appointments", label: "Appointments", inferredStatus: "LIVE", tables: ["appointments"] },
            { id: "dashboard.stat-cards.premium", label: "Annual premium sold", inferredStatus: "LIVE", tables: ["clients", "wins"] },
          ],
        },
        {
          id: "dashboard.widgets",
          label: "Dashboard cards (widgets)",
          description: "Reorderable 2-column grid",
          children: [
            {
              id: "dashboard.widgets.callbacks",
              label: "Callbacks",
              inferredStatus: "LIVE",
              code: {
                files: ["src/components/dashboard/widgets/CallbacksWidget.tsx"],
                tables: ["appointments", "leads"],
              },
            },
            {
              id: "dashboard.widgets.appointments",
              label: "Appointments",
              inferredStatus: "LIVE",
              code: { files: ["src/components/dashboard/widgets/AppointmentsWidget.tsx"] },
            },
            {
              id: "dashboard.widgets.goal-progress",
              label: "Goal progress",
              inferredStatus: "LIVE",
              code: { files: ["src/components/dashboard/widgets/GoalProgressWidget.tsx"], tables: ["profiles", "calls", "clients"] },
            },
            {
              id: "dashboard.widgets.leaderboard",
              label: "Leaderboard preview",
              inferredStatus: "LIVE",
              code: {
                files: ["src/components/dashboard/widgets/LeaderboardWidget.tsx"],
                hooks: ["useAgencyGroup"],
                rpcs: ["get_agency_group_leaderboard"],
              },
            },
            {
              id: "dashboard.widgets.missed-calls",
              label: "Missed calls",
              inferredStatus: "LIVE",
              code: { files: ["src/components/dashboard/widgets/MissedCallsWidget.tsx"], tables: ["calls"] },
            },
            {
              id: "dashboard.widgets.anniversaries",
              label: "Anniversaries",
              inferredStatus: "LIVE",
              code: { files: ["src/components/dashboard/widgets/AnniversariesWidget.tsx"], tables: ["clients"] },
            },
          ],
        },
        {
          id: "dashboard.detail-modal",
          label: "Detail modal (stat + widget drill-down)",
          inferredStatus: "LIVE",
          code: {
            files: ["src/components/dashboard/DashboardDetailModal.tsx"],
            hooks: ["useTwilio"],
          },
        },
      ],
    },
    {
      id: "dialer",
      label: "Dialer",
      description: "Route /dialer — single-leg WebRTC",
      inferredStatus: "LIVE",
      code: {
        files: ["src/pages/DialerPage.tsx", "src/contexts/TwilioContext.tsx"],
        hooks: ["useDialerSession", "useTwilio", "useHardClaim"],
        edgeFunctions: ["twilio-token", "twilio-voice-webhook", "twilio-voice-status"],
        rpcs: ["get_next_queue_lead", "fetch_and_lock_next_lead", "claim_lead"],
      },
      children: [
        {
          id: "dialer.campaign-select",
          label: "Campaign selection",
          code: { files: ["src/components/dialer/CampaignSelection.tsx"] },
          inferredStatus: "LIVE",
        },
        {
          id: "dialer.queue",
          label: "Queue panel",
          children: [
            { id: "dialer.queue.lead-card", label: "Lead card", code: { files: ["src/components/dialer/LeadCard.tsx"] }, inferredStatus: "LIVE" },
            { id: "dialer.queue.locked", label: "Locked queue state", code: { files: ["src/components/dialer/QueuePanelLocked.tsx"] }, inferredStatus: "LIVE" },
            { id: "dialer.queue.lock-timer", label: "Lock timer arc", code: { files: ["src/components/dialer/LockTimerArc.tsx"] }, inferredStatus: "LIVE" },
          ],
        },
        {
          id: "dialer.actions",
          label: "Dialer actions",
          description: "Call, skip, hang up, DNC",
          code: { files: ["src/components/dialer/DialerActions.tsx"], functions: ["makeCall"] },
          inferredStatus: "LIVE",
        },
        {
          id: "dialer.disposition",
          label: "Disposition flow",
          description: "Mandatory disposition after call",
          tables: ["dispositions", "calls", "campaign_leads"],
          inferredStatus: "LIVE",
        },
        {
          id: "dialer.script",
          label: "Call script popup",
          code: { files: ["src/components/dialer/DraggableScriptPopup.tsx"] },
          inferredStatus: "LIVE",
        },
        {
          id: "dialer.inbound",
          label: "Incoming call modal",
          code: { files: ["src/components/dialer/IncomingCallModal.tsx", "src/components/FloatingDialer.tsx"] },
          edgeFunctions: ["twilio-voice-inbound", "inbound-call-claim"],
          inferredStatus: "LIVE",
        },
        {
          id: "dialer.caller-id",
          label: "Smart caller ID / local presence",
          code: { files: ["src/contexts/TwilioContext.tsx", "src/lib/callerIdSelection.ts"] },
          tables: ["phone_numbers", "number_groups", "area_code_mapping"],
          inferredStatus: "LIVE",
        },
        {
          id: "dialer.hard-claim",
          label: "Hard claim (Team/Open ≥30s)",
          code: { hooks: ["useHardClaim"] },
          rpcs: ["claim_lead"],
          inferredStatus: "LIVE",
        },
        {
          id: "dialer.refactor-debt",
          label: "DialerPage monolith",
          description: "AGENT_RULES tech debt — ~3800 lines, split scheduled",
          inferredStatus: "NEEDS_WORK",
          code: { files: ["src/pages/DialerPage.tsx"] },
        },
      ],
    },
    {
      id: "contacts",
      label: "Contacts",
      description: "Route /contacts",
      code: { files: ["src/pages/Contacts.tsx"], hooks: ["usePermissions", "useOrganization"] },
      children: [
        {
          id: "contacts.tabs",
          label: "Contact tabs",
          children: [
            {
              id: "contacts.tabs.leads",
              label: "Leads",
              inferredStatus: "LIVE",
              code: { files: ["src/lib/supabase-contacts.ts"], tables: ["leads"] },
              children: [
                {
                  id: "contacts.tabs.leads.table",
                  label: "Contact table",
                  children: [
                    { id: "contacts.tabs.leads.table.columns", label: "Columns", description: "Name, Phone, Email, State, Status, Source, Agent + optional DOB, etc.", inferredStatus: "LIVE" },
                    { id: "contacts.tabs.leads.table.sort", label: "Sort & resize", inferredStatus: "LIVE" },
                    { id: "contacts.tabs.leads.table.pagination", label: "Pagination (50/page)", inferredStatus: "LIVE" },
                  ],
                },
                {
                  id: "contacts.tabs.leads.filters",
                  label: "Filters",
                  code: { files: ["src/components/contacts/ContactsFilterModal.tsx"] },
                  children: [
                    { id: "contacts.tabs.leads.filters.status", label: "Pipeline status", inferredStatus: "LIVE" },
                    { id: "contacts.tabs.leads.filters.source", label: "Lead source", inferredStatus: "LIVE" },
                    { id: "contacts.tabs.leads.filters.state", label: "State", inferredStatus: "LIVE" },
                    { id: "contacts.tabs.leads.filters.timezone", label: "Timezone groups", inferredStatus: "LIVE" },
                    { id: "contacts.tabs.leads.filters.callable", label: "Callable now (TCPA)", inferredStatus: "LIVE" },
                    { id: "contacts.tabs.leads.filters.disposition", label: "Last disposition", inferredStatus: "LIVE" },
                  ],
                },
                {
                  id: "contacts.tabs.leads.kanban",
                  label: "Kanban view",
                  code: { files: ["src/components/contacts/ContactKanbanBoard.tsx", "src/components/contacts/KanbanCard.tsx"] },
                  inferredStatus: "LIVE",
                },
                {
                  id: "contacts.tabs.leads.bulk",
                  label: "Bulk actions",
                  description: "Assign, status, delete, add to campaign",
                  inferredStatus: "LIVE",
                },
                {
                  id: "contacts.tabs.leads.add-modal",
                  label: "Add / edit lead modal",
                  code: { files: ["src/components/contacts/AddLeadModal.tsx"], hooks: ["useAddLeadModalForm"] },
                  inferredStatus: "LIVE",
                },
              ],
            },
            {
              id: "contacts.tabs.clients",
              label: "Clients",
              inferredStatus: "LIVE",
              code: { files: ["src/lib/supabase-clients.ts"], tables: ["clients"] },
              children: [
                {
                  id: "contacts.tabs.clients.table",
                  label: "Contact table",
                  children: [
                    { id: "contacts.tabs.clients.table.columns", label: "Columns", description: "Policy, carrier, premium, face amount, issue date", inferredStatus: "LIVE" },
                    { id: "contacts.tabs.clients.table.filters", label: "Filters", description: "State, policy type, downline", inferredStatus: "LIVE" },
                  ],
                },
                { id: "contacts.tabs.clients.add-modal", label: "Add / edit client modal", code: { files: ["src/components/contacts/AddClientModal.tsx"] }, inferredStatus: "LIVE" },
              ],
            },
            {
              id: "contacts.tabs.recruits",
              label: "Recruits",
              inferredStatus: "LIVE",
              code: { files: ["src/lib/supabase-recruits.ts"], tables: ["recruits"] },
              children: [
                { id: "contacts.tabs.recruits.table", label: "Contact table + columns", inferredStatus: "LIVE" },
                { id: "contacts.tabs.recruits.kanban", label: "Kanban view", inferredStatus: "LIVE" },
                { id: "contacts.tabs.recruits.add-modal", label: "Add / edit recruit modal", code: { files: ["src/components/contacts/AddRecruitModal.tsx"] }, inferredStatus: "LIVE" },
              ],
            },
            {
              id: "contacts.tabs.agents",
              label: "Agents",
              inferredStatus: "LIVE",
              code: { files: ["src/lib/supabase-users.ts"], tables: ["profiles"] },
              children: [
                { id: "contacts.tabs.agents.table", label: "Agent table", description: "Role, status, licensed states, commission", inferredStatus: "LIVE" },
                { id: "contacts.tabs.agents.modal", label: "Agent detail modal", code: { files: ["src/components/contacts/AgentModal.tsx"] }, inferredStatus: "LIVE" },
              ],
            },
            {
              id: "contacts.tabs.import-history",
              label: "Import history",
              code: { files: ["src/components/contacts/ImportLeadsModal.tsx", "src/pages/ImportLeadsPage.tsx"] },
              edgeFunctions: ["import-contacts"],
              inferredStatus: "LIVE",
            },
          ],
        },
        {
          id: "contacts.detail",
          label: "Full-screen contact view",
          code: { files: ["src/components/contacts/FullScreenContactView.tsx"] },
          children: [
            { id: "contacts.detail.convert", label: "Convert lead → client", code: { files: ["src/components/contacts/ConvertLeadModal.tsx"] }, inferredStatus: "LIVE" },
            { id: "contacts.detail.tasks", label: "Tasks panel", code: { files: ["src/components/contacts/TasksPanel.tsx"] }, inferredStatus: "LIVE" },
            { id: "contacts.detail.campaign", label: "Add to campaign", code: { files: ["src/components/contacts/AddToCampaignModal.tsx"] }, inferredStatus: "LIVE" },
            { id: "contacts.detail.email-sms", label: "Message templates", inferredStatus: "LIVE" },
          ],
        },
        {
          id: "contacts.search",
          label: "Global search (toolbar)",
          inferredStatus: "LIVE",
          rpcs: ["global_search"],
        },
      ],
    },
    {
      id: "conversations",
      label: "Conversations",
      description: "Route /conversations — SMS + email threads",
      inferredStatus: "LIVE",
      code: { files: ["src/pages/Conversations.tsx"] },
      children: [
        { id: "conversations.sidebar", label: "Thread list sidebar", code: { files: ["src/components/conversations/ConversationsSidebar.tsx"] }, inferredStatus: "LIVE" },
        { id: "conversations.thread", label: "Message thread", code: { files: ["src/components/conversations/ConversationThread.tsx"] }, tables: ["messages"], inferredStatus: "LIVE" },
        { id: "conversations.brief", label: "Contact brief panel", code: { files: ["src/components/conversations/ContactBriefView.tsx"] }, inferredStatus: "LIVE" },
        { id: "conversations.sms", label: "Outbound SMS", edgeFunctions: ["twilio-sms"], inferredStatus: "LIVE" },
        { id: "conversations.email", label: "Outbound email", edgeFunctions: ["email-send-contact-message"], tables: ["contact_emails"], inferredStatus: "LIVE" },
      ],
    },
    {
      id: "calendar",
      label: "Calendar",
      description: "Route /calendar",
      inferredStatus: "LIVE",
      code: { files: ["src/pages/CalendarPage.tsx"], tables: ["appointments"] },
      children: [
        { id: "calendar.views", label: "Calendar views (month/week/day)", inferredStatus: "LIVE" },
        { id: "calendar.appointment-modal", label: "Appointment modal", inferredStatus: "LIVE" },
        { id: "calendar.google-sync", label: "Google Calendar sync", edgeFunctions: ["google-calendar-sync-appointment", "google-calendar-inbound-sync"], inferredStatus: "LIVE" },
      ],
    },
    {
      id: "campaigns",
      label: "Campaigns",
      description: "Route /campaigns, /campaigns/:id",
      code: { files: ["src/pages/Campaigns.tsx", "src/pages/CampaignDetail.tsx"] },
      children: [
        { id: "campaigns.list", label: "Campaign cards grid", description: "Total / Called / Contacted / Converted stats", inferredStatus: "LIVE" },
        { id: "campaigns.create", label: "Create campaign modal", code: { files: ["src/components/campaigns/CreateCampaignModal.tsx"] }, inferredStatus: "LIVE" },
        {
          id: "campaigns.detail",
          label: "Campaign detail",
          children: [
            { id: "campaigns.detail.leads-table", label: "Campaign leads table", tables: ["campaign_leads"], inferredStatus: "LIVE" },
            { id: "campaigns.detail.lead-reorder", label: "Drag reorder queue priority", inferredStatus: "LIVE" },
            { id: "campaigns.detail.heatmap", label: "Campaign heatmap", code: { files: ["src/components/campaigns/CampaignHeatmap.tsx"] }, inferredStatus: "LIVE" },
            { id: "campaigns.detail.import", label: "Import leads", inferredStatus: "LIVE" },
            { id: "campaigns.detail.number-group", label: "Number group assignment", inferredStatus: "LIVE", tables: ["number_groups"] },
          ],
        },
      ],
    },
    {
      id: "leaderboard",
      label: "Leaderboard",
      code: { files: ["src/pages/Leaderboard.tsx"], rpcs: ["get_agency_group_leaderboard"] },
      children: [
        { id: "leaderboard.period", label: "Period selector", inferredStatus: "LIVE" },
        { id: "leaderboard.agency-group", label: "Agency group scope", inferredStatus: "LIVE" },
        { id: "leaderboard.tv-banner", label: "TV banner ticker", tables: ["company_settings"], inferredStatus: "LIVE" },
      ],
    },
    {
      id: "reports",
      label: "Reports",
      code: { files: ["src/pages/Reports.tsx", "src/lib/stat-computations.ts"] },
      children: [
        { id: "reports.layout", label: "Customizable sections layout", inferredStatus: "LIVE" },
        { id: "reports.stats-grid", label: "Stat cards grid", children: reportStatChildren },
        { id: "reports.export", label: "Export reports", inferredStatus: "NEEDS_WORK" },
      ],
    },
    {
      id: "ai-agents",
      label: "AI Agents",
      description: "Route /ai-agents",
      inferredStatus: "PLACEHOLDER",
      code: { files: ["src/pages/AIAgentsPage.tsx", "src/pages/AIAgentCreate.tsx"] },
      children: [
        { id: "ai-agents.dashboard", label: "Mock agents dashboard", description: "MOCK_AGENTS — not production AI", inferredStatus: "PLACEHOLDER" },
        { id: "ai-agents.create", label: "Create agent flow", inferredStatus: "PLACEHOLDER" },
        { id: "ai-agents.workflow-node", label: "Workflow assign_ai_agent node", inferredStatus: "PLACEHOLDER", code: { files: ["src/lib/workflow-types.ts"] } },
      ],
    },
    {
      id: "training",
      label: "Training",
      code: { files: ["src/pages/Training.tsx"] },
      inferredStatus: "LIVE",
    },
    {
      id: "resources",
      label: "Resources",
      code: { files: ["src/pages/Resources.tsx"] },
      inferredStatus: "LIVE",
    },
    {
      id: "settings",
      label: "Settings",
      description: "Route /settings?section=",
      code: { files: ["src/pages/SettingsPage.tsx", "src/config/settingsConfig.ts"] },
      children: settingsChildren,
    },
    {
      id: "platform",
      label: "Platform (Super Admin)",
      description: "Not in agent MAIN_MENU",
      children: [
        { id: "platform.agencies", label: "Agencies console", code: { files: ["src/pages/SuperAdminDashboard.tsx"] }, rpcs: ["super_admin_dashboard_snapshot"], inferredStatus: "LIVE" },
        { id: "platform.ai-testing", label: "AI Testing", code: { files: ["src/pages/AITestingPage.tsx"] }, inferredStatus: "LIVE" },
        { id: "platform.project-status", label: "Project Status (this page)", inferredStatus: "LIVE" },
      ],
    },
  ];
}

/** Workflow coming-soon actions as flat gap nodes under reports/workflow reference */
export function getWorkflowGapNodes(): UiInventoryNode[] {
  return ACTION_METAS.filter((a) => a.comingSoon).map((a) => ({
    id: `workflow.gap.${a.type}`,
    label: a.label,
    description: "Workflow builder — coming soon",
    inferredStatus: "PLACEHOLDER" as const,
    code: { files: ["src/lib/workflow-types.ts", "src/components/workflows/NodePickerPopover.tsx"] },
  }));
}
