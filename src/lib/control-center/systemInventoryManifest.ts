export interface SystemInventoryFeature {
  feature_key: string;
  name: string;
  category:
    | 'Core CRM'
    | 'Dialer / Telephony'
    | 'Campaigns'
    | 'Messaging'
    | 'Automation'
    | 'Agency Operations'
    | 'Platform'
    | 'Deferred / Known Limited';
  description: string;
  expected_status:
    | 'not_started'
    | 'planned'
    | 'in_progress'
    | 'needs_review'
    | 'testing'
    | 'live'
    | 'live_with_issues'
    | 'broken'
    | 'blocked'
    | 'deprecated';
  priority: 'critical' | 'high' | 'medium' | 'low' | 'parking_lot';
  is_customer_visible: boolean;
  is_internal_only: boolean;
  expected_tables: string[];
  expected_edge_functions: string[];
  expected_routes: string[];
  expected_notes?: string;
}

export const systemInventoryManifest: SystemInventoryFeature[] = [
  // --- Core CRM ---
  {
    feature_key: 'dashboard',
    name: 'Dashboard',
    category: 'Core CRM',
    description: 'Main overview dashboard showing platform statistics and performance cards.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['profiles'],
    expected_edge_functions: [],
    expected_routes: ['/dashboard'],
    expected_notes: 'Operational dashboards.'
  },
  {
    feature_key: 'leads',
    name: 'Leads Management',
    category: 'Core CRM',
    description: 'CRUD list and import pipelines for prospective client leads.',
    expected_status: 'live',
    priority: 'critical',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['leads'],
    expected_edge_functions: [],
    expected_routes: ['/contacts'],
    expected_notes: 'Standard leads tables and RLS isolation.'
  },
  {
    feature_key: 'clients',
    name: 'Clients Management',
    category: 'Core CRM',
    description: 'Registry and database of actual insurance policy clients.',
    expected_status: 'live',
    priority: 'critical',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['clients'],
    expected_edge_functions: [],
    expected_routes: ['/contacts'],
    expected_notes: 'Client profiles and ownership records.'
  },
  {
    feature_key: 'recruits',
    name: 'Recruits Management',
    category: 'Core CRM',
    description: 'Tracking list for prospective agency insurance agents.',
    expected_status: 'live',
    priority: 'medium',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['recruits'],
    expected_edge_functions: [],
    expected_routes: ['/contacts'],
    expected_notes: 'Recruit status tracking.'
  },
  {
    feature_key: 'contacts',
    name: 'Unified Contacts Directory',
    category: 'Core CRM',
    description: 'Unified Contacts view aggregating leads, clients, recruits, and custom fields.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['leads', 'clients', 'recruits', 'custom_fields'],
    expected_edge_functions: [],
    expected_routes: ['/contacts'],
    expected_notes: 'Dynamic columns and field editor.'
  },
  {
    feature_key: 'pipeline',
    name: 'Sales Pipeline',
    category: 'Core CRM',
    description: 'Kanban view of pipeline stages for conversion tracking.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['leads'],
    expected_edge_functions: [],
    expected_routes: ['/contacts'],
    expected_notes: 'Waterfall pipeline mapping.'
  },
  {
    feature_key: 'tasks',
    name: 'Task Manager',
    category: 'Core CRM',
    description: 'Creation and tracking of agent tasks and reminders.',
    expected_status: 'live',
    priority: 'medium',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['tasks'],
    expected_edge_functions: [],
    expected_routes: ['/contacts'],
    expected_notes: 'Unified tasks component.'
  },
  {
    feature_key: 'calendar',
    name: 'Calendar & Appointments',
    category: 'Core CRM',
    description: 'Unified calendar scheduling with local appointments and sync adapters.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['appointments', 'calendar_integrations'],
    expected_edge_functions: ['google-calendar-inbound-sync'],
    expected_routes: ['/calendar'],
    expected_notes: 'Google calendar OAuth integrations.'
  },

  // --- Dialer / Telephony ---
  {
    feature_key: 'power_dialer',
    name: 'Power Dialer Engine',
    category: 'Dialer / Telephony',
    description: 'Sequential calling queues, campaign pools, and hard claims.',
    expected_status: 'live',
    priority: 'critical',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['calls', 'dialer_daily_stats', 'dialer_lead_locks'],
    expected_edge_functions: [],
    expected_routes: ['/dialer'],
    expected_notes: 'High velocity single-leg dialer.'
  },
  {
    feature_key: 'twilio_voice',
    name: 'Twilio WebRTC Client',
    category: 'Dialer / Telephony',
    description: 'Single-leg WebRTC audio registration and outbound TwiML gateway.',
    expected_status: 'live',
    priority: 'critical',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: [],
    expected_edge_functions: ['twilio-token'],
    expected_routes: ['/dialer'],
    expected_notes: 'Twilio Voice.js SDK runtime.'
  },
  {
    feature_key: 'inbound_calling',
    name: 'Inbound Call Gateway',
    category: 'Dialer / Telephony',
    description: 'Inbound call matching, notifications, and client routing.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['phone_numbers'],
    expected_edge_functions: ['twilio-voice-inbound'],
    expected_routes: ['/dialer'],
    expected_notes: 'Twilio webhook receiving and FloatingDialer UI.'
  },
  {
    feature_key: 'call_monitoring',
    name: 'Live Call Monitoring',
    category: 'Dialer / Telephony',
    description: 'Realtime view of ongoing calls for supervisory visibility.',
    expected_status: 'live',
    priority: 'medium',
    is_customer_visible: false,
    is_internal_only: true,
    expected_tables: ['calls'],
    expected_edge_functions: ['get-active-calls'],
    expected_routes: ['/settings'],
    expected_notes: 'Realtime active call subscriber.'
  },
  {
    feature_key: 'call_recording',
    name: 'Call Recording & Storage',
    category: 'Dialer / Telephony',
    description: 'Recording retention policies, batch cleanups, and S3 secure playbacks.',
    expected_status: 'live',
    priority: 'medium',
    is_customer_visible: false,
    is_internal_only: true,
    expected_tables: ['call_recordings_retention_rules'],
    expected_edge_functions: ['recording-retention-purge'],
    expected_routes: ['/settings'],
    expected_notes: 'Supabase storage call-recordings bucket.'
  },
  {
    feature_key: 'phone_numbers',
    name: 'Phone Numbers Inventory',
    category: 'Dialer / Telephony',
    description: 'Management of purchased Twilio numbers, routing overrides, and statuses.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['phone_numbers', 'phone_settings'],
    expected_edge_functions: [],
    expected_routes: ['/settings'],
    expected_notes: 'Direct lines and custom settings.'
  },
  {
    feature_key: 'number_groups',
    name: 'Campaign Number Groups',
    category: 'Dialer / Telephony',
    description: 'Grouping of outbound lines for campaigns to isolate Dialers.',
    expected_status: 'live',
    priority: 'medium',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['number_groups', 'number_group_members'],
    expected_edge_functions: [],
    expected_routes: ['/settings'],
    expected_notes: 'Number pool filtering.'
  },
  {
    feature_key: 'local_presence',
    name: 'Smart Local Presence',
    category: 'Dialer / Telephony',
    description: 'Matching outbound Caller ID area codes to destination codes.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['area_code_mapping'],
    expected_edge_functions: [],
    expected_routes: ['/settings'],
    expected_notes: 'Area code lookup DB matching.'
  },
  {
    feature_key: 'inbound_routing',
    name: 'Waterfall Routing Settings',
    category: 'Dialer / Telephony',
    description: 'Configuration of call routing policies, VM greetings, and fallbacks.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['inbound_routing_settings'],
    expected_edge_functions: ['twilio-voice-inbound'],
    expected_routes: ['/settings'],
    expected_notes: 'Stateful fallback chains.'
  },
  {
    feature_key: 'state_licenses',
    name: 'Agent State Licenses',
    category: 'Dialer / Telephony',
    description: 'Agent licensing mapping to permit dialing and routing to state-level agents.',
    expected_status: 'live',
    priority: 'medium',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['agent_state_licenses'],
    expected_edge_functions: [],
    expected_routes: ['/settings'],
    expected_notes: 'State license warning flags.'
  },

  // --- Campaigns ---
  {
    feature_key: 'campaigns',
    name: 'Campaign Planner',
    category: 'Campaigns',
    description: 'Creating personal, team, or open Dialer campaigns.',
    expected_status: 'live',
    priority: 'critical',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['campaigns'],
    expected_edge_functions: [],
    expected_routes: ['/campaigns'],
    expected_notes: 'Live metrics aggregation.'
  },
  {
    feature_key: 'campaign_leads',
    name: 'Waterfall Campaign Queues',
    category: 'Campaigns',
    description: 'Waterfall distribution queues mapping leads to active campaign sessions.',
    expected_status: 'live',
    priority: 'critical',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['campaign_leads'],
    expected_edge_functions: [],
    expected_routes: ['/campaigns'],
    expected_notes: 'Waterfall RPC algorithms.'
  },
  {
    feature_key: 'queue_locks',
    name: 'Atomic Queue Locks',
    category: 'Campaigns',
    description: 'Skip locked database query claim concurrency guards.',
    expected_status: 'live',
    priority: 'critical',
    is_customer_visible: false,
    is_internal_only: true,
    expected_tables: ['dialer_lead_locks'],
    expected_edge_functions: [],
    expected_routes: [],
    expected_notes: 'Guards against duplicate dialing.'
  },
  {
    feature_key: 'dispositions',
    name: 'Call Dispositions',
    category: 'Campaigns',
    description: 'Categorization and updates of lead states post-dial.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['dispositions'],
    expected_edge_functions: [],
    expected_routes: ['/settings'],
    expected_notes: 'Saves outcome data.'
  },

  // --- Messaging ---
  {
    feature_key: 'sms',
    name: 'Two-Way SMS Gateway',
    category: 'Messaging',
    description: 'Inbound receiving and outbound texting via Twilio SMS webhook API.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['messages'],
    expected_edge_functions: ['twilio-sms', 'twilio-sms-webhook'],
    expected_routes: ['/conversations'],
    expected_notes: 'Thread updates.'
  },
  {
    feature_key: 'gmail_email',
    name: 'Gmail Two-Way Sync',
    category: 'Messaging',
    description: 'Syncing inbox messages and composing threads from contact history.',
    expected_status: 'live',
    priority: 'medium',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['contact_emails', 'email_inbox_connections'],
    expected_edge_functions: ['email-connect-start', 'email-connect-callback', 'email-sync-incremental'],
    expected_routes: ['/conversations'],
    expected_notes: 'OAuth setup sync.'
  },
  {
    feature_key: 'conversations',
    name: 'Unified Conversations Panel',
    category: 'Messaging',
    description: 'Combined interface for text and email history.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['messages', 'contact_emails'],
    expected_edge_functions: [],
    expected_routes: ['/conversations'],
    expected_notes: 'Live chat console.'
  },

  // --- Automation ---
  {
    feature_key: 'workflow_builder',
    name: 'Visual Workflow Builder',
    category: 'Automation',
    description: 'Visual builder to assemble automated rules triggered by events.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['workflow_rules', 'workflow_triggers', 'workflow_actions', 'workflow_folders'],
    expected_edge_functions: [],
    expected_routes: ['/settings'],
    expected_notes: 'Draggable canvas compiler.'
  },
  {
    feature_key: 'workflow_executor',
    name: 'Workflow Execution Daemon',
    category: 'Automation',
    description: 'Trigger listener and step executor resolving conditions and actions.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: false,
    is_internal_only: true,
    expected_tables: ['workflow_runs', 'workflow_run_steps'],
    expected_edge_functions: ['workflow-executor'],
    expected_routes: [],
    expected_notes: 'Supabase trigger hook engine.'
  },
  {
    feature_key: 'workflow_time_triggers',
    name: 'Time-Based Trigger Crons',
    category: 'Automation',
    description: 'Cron evaluation scheduler resolving time-offsets (stale leads, birthdays).',
    expected_status: 'in_progress',
    priority: 'medium',
    is_customer_visible: false,
    is_internal_only: true,
    expected_tables: ['workflow_time_triggers'],
    expected_edge_functions: ['workflow-trigger-evaluator'],
    expected_routes: [],
    expected_notes: 'Uses pg_cron trigger evaluator.'
  },

  // --- Agency Operations ---
  {
    feature_key: 'organizations',
    name: 'Agencies / Organizations',
    category: 'Agency Operations',
    description: 'Multi-tenant boundaries isolating configuration, billing, and leads.',
    expected_status: 'live',
    priority: 'critical',
    is_customer_visible: false,
    is_internal_only: true,
    expected_tables: ['organizations', 'company_settings'],
    expected_edge_functions: ['create-organization'],
    expected_routes: ['/super-admin'],
    expected_notes: 'Hard RLS org_id constraints.'
  },
  {
    feature_key: 'users_profiles',
    name: 'Users & Platform Profiles',
    category: 'Agency Operations',
    description: 'Authentication identities linked to metadata profiles with role permissions.',
    expected_status: 'live',
    priority: 'critical',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['profiles'],
    expected_edge_functions: ['create-user'],
    expected_routes: ['/settings', '/super-admin'],
    expected_notes: 'User profiles and status metadata.'
  },
  {
    feature_key: 'invitations',
    name: 'Invites & Onboarding',
    category: 'Agency Operations',
    description: 'Tokenized signup validation links and onboarding state machines.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['invitations'],
    expected_edge_functions: ['invite-user'],
    expected_routes: ['/settings', '/accept-invite'],
    expected_notes: 'Signup invite forms.'
  },
  {
    feature_key: 'hierarchy',
    name: 'Reporting Line Hierarchy',
    category: 'Agency Operations',
    description: 'Ltree reporting hierarchies mapping upline/downline managers.',
    expected_status: 'live',
    priority: 'medium',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['profiles'],
    expected_edge_functions: [],
    expected_routes: ['/settings'],
    expected_notes: 'Hierarchical reporting structures.'
  },
  {
    feature_key: 'permissions',
    name: 'Role Permissions Matrix',
    category: 'Agency Operations',
    description: 'Permission enforcement mappings separating roles (Super Admin, Admin, TL, Agent).',
    expected_status: 'live',
    priority: 'critical',
    is_customer_visible: false,
    is_internal_only: true,
    expected_tables: ['role_permissions'],
    expected_edge_functions: [],
    expected_routes: [],
    expected_notes: 'JWT roles checking.'
  },
  {
    feature_key: 'agency_groups',
    name: 'Peer Agency Groups',
    category: 'Agency Operations',
    description: 'Collaborative settings sharing leaderboard metrics between distinct organizations.',
    expected_status: 'live',
    priority: 'medium',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['agency_groups', 'agency_group_members'],
    expected_edge_functions: ['invite-to-agency-group'],
    expected_routes: ['/settings'],
    expected_notes: 'Peer-to-peer leaderboard authorization.'
  },
  {
    feature_key: 'leaderboard',
    name: 'Leaderboard & Spotlight',
    category: 'Agency Operations',
    description: 'Realtime leaderboard scorecards, spotlights, and TV Mode visualizations.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['calls', 'appointments'],
    expected_edge_functions: [],
    expected_routes: ['/leaderboard'],
    expected_notes: 'TV visualizer dashboards.'
  },
  {
    feature_key: 'reporting',
    name: 'Agency Performance Analytics',
    category: 'Agency Operations',
    description: 'Summary charts of dial counts, outcomes, and agent metrics.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['calls', 'leads', 'appointments'],
    expected_edge_functions: [],
    expected_routes: ['/reports'],
    expected_notes: 'Aggregated analytics tables.'
  },

  // --- Platform ---
  {
    feature_key: 'control_center',
    name: 'Control Center Suite',
    category: 'Platform',
    description: 'System health checks, database advisor logs, and sync analysis platform console.',
    expected_status: 'live',
    priority: 'critical',
    is_customer_visible: false,
    is_internal_only: true,
    expected_tables: [
      'control_center_features',
      'control_center_issues',
      'control_center_health_checks',
      'control_center_health_check_runs'
    ],
    expected_edge_functions: [],
    expected_routes: ['/control-center'],
    expected_notes: 'Platform dashboard monitoring.'
  },
  {
    feature_key: 'system_status',
    name: 'System Status Page',
    category: 'Platform',
    description: 'Public facing service health indicator ledger.',
    expected_status: 'live',
    priority: 'high',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['system_status'],
    expected_edge_functions: [],
    expected_routes: ['/super-admin'],
    expected_notes: 'Core service health grid.'
  },
  {
    feature_key: 'security_advisors',
    name: 'Supabase Security Advisor',
    category: 'Platform',
    description: 'Security auditing checker evaluating RLS, Definer functions, and credentials.',
    expected_status: 'live',
    priority: 'critical',
    is_customer_visible: false,
    is_internal_only: true,
    expected_tables: [],
    expected_edge_functions: [],
    expected_routes: ['/control-center'],
    expected_notes: 'Database-level inspection RPC.'
  },
  {
    feature_key: 'edge_functions',
    name: 'Deno Edge Functions Gateway',
    category: 'Platform',
    description: 'API gateway serving serverless Deno functions on Supabase.',
    expected_status: 'live',
    priority: 'critical',
    is_customer_visible: false,
    is_internal_only: true,
    expected_tables: [],
    expected_edge_functions: [],
    expected_routes: [],
    expected_notes: 'Serverless orchestration.'
  },
  {
    feature_key: 'vercel_deployments',
    name: 'Vercel Frontend CDN',
    category: 'Platform',
    description: 'Hosting engine and environment manager serving the Vite client.',
    expected_status: 'live',
    priority: 'critical',
    is_customer_visible: false,
    is_internal_only: true,
    expected_tables: [],
    expected_edge_functions: [],
    expected_routes: [],
    expected_notes: 'Vite React production hosting.'
  },
  {
    feature_key: 'supabase_database',
    name: 'PostgreSQL Database Engine',
    category: 'Platform',
    description: 'Relational storage engine running PostgreSQL 15+ and real-time triggers.',
    expected_status: 'live',
    priority: 'critical',
    is_customer_visible: false,
    is_internal_only: true,
    expected_tables: [],
    expected_edge_functions: [],
    expected_routes: [],
    expected_notes: 'Postgres engine core.'
  },

  // --- Deferred / Known Limited ---
  {
    feature_key: 'billing',
    name: 'Subscription Billing',
    category: 'Deferred / Known Limited',
    description: 'Subscription billing system settings and invoice controllers.',
    expected_status: 'planned',
    priority: 'low',
    is_customer_visible: false,
    is_internal_only: true,
    expected_tables: [],
    expected_edge_functions: [],
    expected_routes: [],
    expected_notes: 'Deferred Stripe integrations.'
  },
  {
    feature_key: 'ai_agents',
    name: 'AI Agent Call Assisting',
    category: 'Deferred / Known Limited',
    description: 'Marketing pages and mock dials simulating AI agent automation.',
    expected_status: 'planned',
    priority: 'low',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: ['ai_test_sessions'],
    expected_edge_functions: [],
    expected_routes: ['/ai-agents'],
    expected_notes: 'Visual mockup interfaces.'
  },
  {
    feature_key: 'listen_whisper_barge',
    name: 'Listen, Whisper & Barge-in',
    category: 'Deferred / Known Limited',
    description: 'Realtime supervisor voice intrusion tools (toast alerts only).',
    expected_status: 'planned',
    priority: 'low',
    is_customer_visible: false,
    is_internal_only: true,
    expected_tables: [],
    expected_edge_functions: [],
    expected_routes: [],
    expected_notes: 'UI prompts only; core VoIP not implemented.'
  },
  {
    feature_key: 'multi_line_dialer',
    name: 'Multi-Line Auto Dialer',
    category: 'Deferred / Known Limited',
    description: 'Simultaneous dialer dialing 2-3 lines per agent.',
    expected_status: 'planned',
    priority: 'low',
    is_customer_visible: true,
    is_internal_only: false,
    expected_tables: [],
    expected_edge_functions: [],
    expected_routes: [],
    expected_notes: 'Deferred. Single-leg dialer remains target.'
  }
];
