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

/** The shape stored in role_permissions.permissions (JSONB), scoped per organization_id. */
export interface RolePermissions {
  p: PagePermission[];
  f: FeatureCategory[];
  d: DataAccessPermission[];
  c: CommissionPermission[];
  s: SettingsSectionPermission[];
  /**
   * Contacts Build 5 (D-storage): normalized, stable-key → bool block for the
   * Contacts module, holding ONLY the booleans for this row's role. Supersedes the
   * legacy display-name-keyed `f` "Contacts" category for backend/enforcement logic.
   * Optional: when absent (or a key is missing) callers fall back to
   * resolveContactsPermissionDefault(role, key). Other modules keep using `f` until migrated.
   */
  contacts?: Record<string, boolean>;
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

export const DEFAULT_SETTINGS_SECTIONS: SettingsSectionPermission[] = ALL_SETTINGS_SECTIONS.map((section) => ({
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

// ---------------------------------------------------------------------------
// Contacts permission catalog (Contacts Build 5 — CP2)
//
// Stable, machine-addressable keys for the Contacts module. This catalog is the
// SINGLE source of truth for both the Settings → Permissions UI and (CP3) the
// backend `has_contacts_permission` default fallback. Stored per role as a flat
// `{ key: bool }` block in role_permissions.permissions.contacts (D-storage).
//
// Configurable roles: Agent + Team Leader only. Admin + Super Admin are LOCKED
// full-access (never stored, always resolve true at read time) — D-roles.
//
// NOTE: There is intentionally NO conversion key. Lead → Client conversion is a
// hardcoded, universal CRM action (not agency-configurable) and must never appear
// here or be gated by this catalog.
// ---------------------------------------------------------------------------

export type ContactsPermissionGroup = "Leads" | "Clients" | "Recruits" | "Engagement";

export interface ContactsPermissionDef {
  /** Stable machine key, e.g. "contacts.leads.delete". Never a display label. */
  key: string;
  /** Human label shown in Settings. */
  label: string;
  /** Help text shown under the label. */
  help: string;
  /** UI grouping within the Contacts module. */
  group: ContactsPermissionGroup;
  /** When true, the UI shows warning copy (destructive / high-impact). */
  danger?: boolean;
  /** Default for the Agent role. */
  agent: boolean;
  /** Default for the Team Leader role. */
  teamLeader: boolean;
}

export const CONTACTS_PERMISSIONS: ContactsPermissionDef[] = [
  // ---- Leads ----
  { key: "contacts.leads.view_assigned", label: "View assigned leads", help: "See leads assigned to them.", group: "Leads", agent: true, teamLeader: true },
  { key: "contacts.leads.view_unassigned", label: "View unassigned leads", help: "See unassigned leads in the organization pool.", group: "Leads", agent: false, teamLeader: true },
  { key: "contacts.leads.view_all", label: "View all leads", help: "See every lead in the organization, regardless of owner.", group: "Leads", agent: false, teamLeader: false },
  { key: "contacts.leads.create", label: "Create leads", help: "Add new leads manually.", group: "Leads", agent: true, teamLeader: true },
  { key: "contacts.leads.edit", label: "Edit leads", help: "Update lead details they can access.", group: "Leads", agent: true, teamLeader: true },
  { key: "contacts.leads.delete", label: "Delete leads", help: "Permanently delete lead records.", group: "Leads", danger: true, agent: false, teamLeader: false },
  { key: "contacts.leads.import", label: "Import leads", help: "Upload CSV files to add leads in bulk.", group: "Leads", danger: true, agent: false, teamLeader: true },
  { key: "contacts.leads.undo_own_import", label: "Undo own import", help: "Roll back an import they performed (within the allowed window).", group: "Leads", danger: true, agent: false, teamLeader: true },
  { key: "contacts.leads.undo_team_import", label: "Undo downline import", help: "Roll back an import performed by someone in their downline.", group: "Leads", danger: true, agent: false, teamLeader: true },
  { key: "contacts.leads.assign", label: "Assign / reassign leads", help: "Change which agent owns a lead.", group: "Leads", agent: false, teamLeader: true },
  { key: "contacts.leads.bulk_assign", label: "Bulk assign leads", help: "Reassign many leads at once.", group: "Leads", agent: false, teamLeader: true },
  { key: "contacts.leads.bulk_status", label: "Bulk status change", help: "Change the status of many leads at once.", group: "Leads", agent: true, teamLeader: true },
  { key: "contacts.leads.update_status", label: "Move leads in Kanban / update status", help: "Change a lead's pipeline status (Kanban drag or inline).", group: "Leads", agent: true, teamLeader: true },
  { key: "contacts.leads.add_to_campaign", label: "Add leads to campaigns", help: "Add leads into dialer campaigns.", group: "Leads", agent: false, teamLeader: true },
  // ---- Clients ----
  { key: "contacts.clients.view", label: "View clients", help: "See client records they can access.", group: "Clients", agent: true, teamLeader: true },
  { key: "contacts.clients.edit", label: "Edit clients", help: "Update client details and policy info.", group: "Clients", agent: true, teamLeader: true },
  { key: "contacts.clients.delete", label: "Delete clients", help: "Permanently delete client records.", group: "Clients", danger: true, agent: false, teamLeader: false },
  // ---- Recruits ----
  { key: "contacts.recruits.view", label: "View recruits", help: "See recruit records they can access.", group: "Recruits", agent: true, teamLeader: true },
  { key: "contacts.recruits.create", label: "Create recruits", help: "Add new recruit records.", group: "Recruits", agent: true, teamLeader: true },
  { key: "contacts.recruits.edit", label: "Edit recruits", help: "Update recruit details.", group: "Recruits", agent: true, teamLeader: true },
  { key: "contacts.recruits.delete", label: "Delete recruits", help: "Permanently delete recruit records.", group: "Recruits", danger: true, agent: false, teamLeader: false },
  // ---- Engagement (sub-records on a contact) ----
  { key: "contacts.notes.manage", label: "Manage contact notes", help: "Add and edit notes on contacts they can access.", group: "Engagement", agent: true, teamLeader: true },
  { key: "contacts.tasks.manage", label: "Manage contact tasks", help: "Create and update tasks on contacts.", group: "Engagement", agent: true, teamLeader: true },
  { key: "contacts.appointments.manage", label: "Manage appointments", help: "Schedule and edit appointments on contacts.", group: "Engagement", agent: true, teamLeader: true },
  { key: "contacts.messages.manage", label: "Manage messages / emails", help: "Send and manage SMS/email on contacts where available.", group: "Engagement", agent: true, teamLeader: true },
];

/** Ordered group labels for rendering the Contacts module in Settings. */
export const CONTACTS_PERMISSION_GROUPS: ContactsPermissionGroup[] = ["Leads", "Clients", "Recruits", "Engagement"];

/** All catalog keys (stable identifiers). */
export const CONTACTS_PERMISSION_KEYS: string[] = CONTACTS_PERMISSIONS.map((p) => p.key);

const CONTACTS_PERMISSION_BY_KEY: Record<string, ContactsPermissionDef> = Object.fromEntries(
  CONTACTS_PERMISSIONS.map((p) => [p.key, p])
);

/**
 * Default boolean for a (role, key) pair when no stored override exists.
 * Admin + Super Admin are LOCKED full-access → always true (D-roles).
 * Unknown role or unknown key → false (safe deny).
 */
export function resolveContactsPermissionDefault(role: string | null | undefined, key: string): boolean {
  if (role === "Admin" || role === "Super Admin") return true;
  const def = CONTACTS_PERMISSION_BY_KEY[key];
  if (!def) return false;
  if (role === "Team Leader") return def.teamLeader;
  if (role === "Agent") return def.agent;
  return false;
}

/** Full default contacts block for a role (every catalog key → its default). */
export function getDefaultContactsPermissions(role: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const def of CONTACTS_PERMISSIONS) {
    out[def.key] = resolveContactsPermissionDefault(role, def.key);
  }
  return out;
}

/**
 * Merge a stored contacts block onto the role defaults: known keys with a boolean
 * value win; missing keys fall back to the role default; unknown stored keys are
 * dropped. Used by the Settings UI on load and by enforcement readers.
 */
export function mergeContactsPermissions(
  role: string,
  stored: unknown
): Record<string, boolean> {
  const defaults = getDefaultContactsPermissions(role);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return defaults;
  const s = stored as Record<string, unknown>;
  const out: Record<string, boolean> = { ...defaults };
  for (const key of CONTACTS_PERMISSION_KEYS) {
    if (typeof s[key] === "boolean") out[key] = s[key] as boolean;
  }
  return out;
}

/**
 * Pure resolution used by usePermissions().hasContactsPermission (extracted so it
 * is unit-testable without rendering the hook). Order:
 *   1. Admin / Super Admin (isFullAccess) → true (locked full-access, D-roles)
 *   2. no role → false
 *   3. stored override (boolean) wins
 *   4. otherwise the catalog default for the role
 * Conversion has no key and is never resolvable here.
 */
export function resolveContactsPermission(
  role: string | null | undefined,
  isFullAccess: boolean,
  storedBlock: Record<string, boolean> | undefined,
  key: string
): boolean {
  if (isFullAccess) return true;
  if (!role) return false;
  if (storedBlock && typeof storedBlock[key] === "boolean") return storedBlock[key];
  return resolveContactsPermissionDefault(role, key);
}
