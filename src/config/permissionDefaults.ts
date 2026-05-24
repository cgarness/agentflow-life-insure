/**
 * permissionDefaults.ts — Single source of truth for default permissions.
 *
 * Any new page, feature, data scope, settings section, or commission toggle must be added here first.
 * Permissions.tsx (admin UI) and usePermissions() (enforcement hook) both read from this file.
 *
 * role_permissions rows are scoped per organization_id — never shared across orgs.
 *
 * Icons are intentionally omitted — they are a UI concern owned by Permissions.tsx.
 */

import { ALL_SETTINGS_SECTIONS } from "@/config/settingsConfig";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DataScope = "own" | "team" | "all";

export interface PagePermission {
  name: string;
  agent: boolean;
  teamLeader: boolean;
}

export interface FeaturePermission {
  name: string;
  description: string;
  agent: boolean;
  teamLeader: boolean;
}

export interface FeatureCategory {
  category: string;
  features: FeaturePermission[];
}

export interface DataAccessPermission {
  label: string;
  description: string;
  agent: DataScope;
  teamLeader: DataScope;
}

export interface CommissionPermission {
  name: string;
  description: string;
  agent: boolean;
  teamLeader: boolean;
}

export interface SettingsSectionPermission {
  slug: string;
  label: string;
  agent: boolean;
  teamLeader: boolean;
}

/** Platform-only settings slugs — not stored in permissions JSONB; gated by isSuperAdmin. */
export const PLATFORM_ONLY_SETTINGS_SLUGS = ["twilio-connection"] as const;

/** The shape stored in role_permissions.permissions (JSONB), scoped per organization_id. */
export interface RolePermissions {
  p: PagePermission[];
  f: FeatureCategory[];
  d: DataAccessPermission[];
  c: CommissionPermission[];
  s: SettingsSectionPermission[];
}

export type RoleKey = "agent" | "teamLeader" | "admin";

// Role mapping: UI camelCase key ↔ DB Title Case string

export const ROLE_MAP: Record<"agent" | "teamLeader" | "admin", string> = {
  agent: "Agent",
  teamLeader: "Team Leader",
  admin: "Admin",
};

export const DB_ROLE_TO_KEY: Record<string, RoleKey> = {
  Agent: "agent",
  "Team Leader": "teamLeader",
  Admin: "admin",
};

// Default pages (12 — Settings is always available; section visibility uses `s`)

export const DEFAULT_PAGES: PagePermission[] = [
  { name: "Dashboard", agent: true, teamLeader: true },
  { name: "Dialer", agent: true, teamLeader: true },
  { name: "Contacts", agent: true, teamLeader: true },
  { name: "Conversations", agent: true, teamLeader: true },
  { name: "Calendar", agent: true, teamLeader: true },
  { name: "Campaigns", agent: true, teamLeader: true },
  { name: "Leaderboard", agent: true, teamLeader: true },
  { name: "Reports", agent: false, teamLeader: true },
  { name: "AI Agents", agent: false, teamLeader: true },
  { name: "Training", agent: true, teamLeader: true },
  { name: "Resources", agent: true, teamLeader: true },
];

// Default settings sections (all on — agency admin restricts per org via role_permissions.s)

export const DEFAULT_SETTINGS_SECTIONS: SettingsSectionPermission[] = ALL_SETTINGS_SECTIONS.filter(
  (section) => !(PLATFORM_ONLY_SETTINGS_SLUGS as readonly string[]).includes(section.slug)
).map((section) => ({
  slug: section.slug,
  label: section.label,
  agent: true,
  teamLeader: true,
}));

/** Merge saved org permissions with current defaults (new sections get default access). */
export function mergeSettingsSections(
  saved: SettingsSectionPermission[] | undefined
): SettingsSectionPermission[] {
  if (!Array.isArray(saved) || saved.length === 0) {
    return DEFAULT_SETTINGS_SECTIONS.map((d) => ({ ...d }));
  }
  const savedBySlug = new Map(saved.map((row) => [row.slug, row]));
  return DEFAULT_SETTINGS_SECTIONS.map((def) => {
    const existing = savedBySlug.get(def.slug);
    if (!existing) return { ...def };
    return {
      slug: def.slug,
      label: def.label,
      agent: typeof existing.agent === "boolean" ? existing.agent : def.agent,
      teamLeader: typeof existing.teamLeader === "boolean" ? existing.teamLeader : def.teamLeader,
    };
  });
}

// Default features (8 categories, 30 features)

export const DEFAULT_FEATURES: FeatureCategory[] = [
  {
    category: "Contacts",
    features: [
      { name: "Import Leads", description: "Upload CSV files to add leads in bulk", agent: false, teamLeader: true },
      { name: "Export Contacts", description: "Download contacts as CSV", agent: false, teamLeader: true },
      { name: "Delete Contacts", description: "Permanently delete lead, client, or recruit records", agent: false, teamLeader: false },
      { name: "Merge Contacts", description: "Merge duplicate contact records", agent: false, teamLeader: true },
      { name: "Bulk Actions", description: "Assign, status change, or delete multiple contacts at once", agent: true, teamLeader: true },
      { name: "Edit Any Contact", description: "Edit contacts assigned to other agents", agent: false, teamLeader: true },
      { name: "View Contact Owner", description: "See which agent a contact is assigned to", agent: true, teamLeader: true },
    ],
  },
  {
    category: "Campaigns",
    features: [
      { name: "Create Campaigns", description: "Build new dialer campaigns", agent: false, teamLeader: true },
      { name: "Edit Campaigns", description: "Modify existing campaigns", agent: false, teamLeader: true },
      { name: "Delete Campaigns", description: "Remove campaigns permanently", agent: false, teamLeader: false },
      { name: "Upload Campaign Leads", description: "Add leads to Open Pool campaigns", agent: false, teamLeader: true },
      { name: "View All Campaigns", description: "See campaigns created by other agents", agent: false, teamLeader: true },
      { name: "View Campaign Import History", description: "See the log of when and how leads were added to a campaign", agent: false, teamLeader: true },
    ],
  },
  {
    category: "Dialer",
    features: [
      { name: "Skip Leads", description: "Skip a lead in the dialer without calling", agent: true, teamLeader: true },
      { name: "Override DNC", description: "Call a number even if it is on the DNC list", agent: false, teamLeader: false },
      { name: "Manual Dial", description: "Type in a number and call outside of a campaign", agent: true, teamLeader: true },
      { name: "End Session Early", description: "End a dialer session before the campaign is complete", agent: true, teamLeader: true },
    ],
  },
  {
    category: "Reports",
    features: [
      { name: "View Own Reports", description: "See reports filtered to own activity only", agent: true, teamLeader: true },
      { name: "View Team Reports", description: "See reports across all team members", agent: false, teamLeader: true },
      { name: "Export Reports", description: "Download reports as CSV or PDF", agent: false, teamLeader: true },
    ],
  },
  {
    category: "Leaderboard",
    features: [
      { name: "View Leaderboard", description: "See the team leaderboard", agent: true, teamLeader: true },
      { name: "View Other Agent Stats", description: "See detailed stats of other agents on the leaderboard", agent: true, teamLeader: true },
    ],
  },
  {
    category: "Calendar",
    features: [
      { name: "Create Appointments", description: "Schedule new appointments", agent: true, teamLeader: true },
      { name: "Edit Any Appointment", description: "Modify appointments set by other agents", agent: false, teamLeader: true },
      { name: "Delete Appointments", description: "Remove appointments", agent: true, teamLeader: true },
    ],
  },
  {
    category: "AI Agents",
    features: [
      { name: "Create AI Agents", description: "Build and configure AI agents", agent: false, teamLeader: false },
      { name: "Run AI Agents", description: "Activate AI agents on campaigns", agent: false, teamLeader: true },
      { name: "View AI Conversations", description: "See AI agent conversation logs", agent: true, teamLeader: true },
    ],
  },
  {
    category: "Training",
    features: [
      { name: "Mark Complete", description: "Mark training resources as completed", agent: true, teamLeader: true },
      { name: "Add Resources", description: "Upload new training materials", agent: false, teamLeader: false },
    ],
  },
];

// Default data access (4 scopes)

export const DEFAULT_DATA_ACCESS: DataAccessPermission[] = [
  { label: "Leads & Contacts", description: "Which contact records can this role view and interact with?", agent: "own", teamLeader: "team" },
  { label: "Calls & Recordings", description: "Which call history and recordings can this role access?", agent: "own", teamLeader: "team" },
  { label: "Campaigns", description: "Which campaigns can this role view and work within?", agent: "own", teamLeader: "team" },
  { label: "Dashboard & Reports", description: "Which data appears on the dashboard and in reports?", agent: "own", teamLeader: "team" },
];

// Default commission visibility (6 toggles)

export const DEFAULT_COMMISSION: CommissionPermission[] = [
  { name: "View Own Commission Percentage", description: "See their own commission rate", agent: true, teamLeader: true },
  { name: "View Others' Commission Percentage", description: "See commission rates of other agents", agent: false, teamLeader: false },
  { name: "View Per-Policy Commission", description: "See earnings per individual policy", agent: true, teamLeader: true },
  { name: "View Monthly Commission Total", description: "See total commission earned this month", agent: true, teamLeader: true },
  { name: "View Team Commission Totals", description: "See combined commission across all team members", agent: false, teamLeader: true },
  { name: "View Commission in Reports", description: "See commission data in the Reports section", agent: false, teamLeader: true },
];

// Data scope key → label mapping (for getDataScope lookup)

export const DATA_SCOPE_KEY_MAP: Record<string, string> = {
  leads: "Leads & Contacts",
  calls: "Calls & Recordings",
  campaigns: "Campaigns",
  reports: "Dashboard & Reports",
};
