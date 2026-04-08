/**
 * MASTER ADMIN PAGE - DATA SOURCE MIGRATION GUIDE
 *
 * This page supports both Supabase (real) and mock data during the transition period.
 *
 * TO MIGRATE A CATEGORY FROM MOCK TO SUPABASE:
 * 1. Create the Supabase table (via Claude Code migration)
 * 2. Change DATA_SOURCES config: 'mock' → 'supabase'
 * 3. Test that fetching, editing, and deleting work correctly
 * 4. Remove the mock data import if no longer needed
 *
 * Categories still using mock data:
 * - Custom Fields
 * - Pipeline Stages
 * - Lead Sources
 * - Health Statuses
 */

import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Pencil, Trash2, Search, ChevronLeft, ChevronRight,
  ExternalLink, Check, X, AlertTriangle, Database, RefreshCw,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";

// ─── Data Source Configuration ────────────────────────────────────────────────
// Update DATA_SOURCES as tables migrate from mock to Supabase

const DATA_SOURCES: Record<string, 'supabase' | 'mock'> = {
  'Dispositions': 'supabase',
  'Call Scripts': 'supabase',
  'Custom Fields': 'supabase',
  'Pipeline Stages': 'supabase',
  'Lead Sources': 'supabase',
  'Health Statuses': 'supabase',
  'Carriers': 'supabase',
  'Email/SMS Templates': 'supabase',
  'Custom Menu Links': 'supabase',
  'Phone Numbers': 'supabase',
  'Leads': 'supabase',
  'Clients': 'supabase',
  'Recruits': 'supabase',
  'Appointments': 'supabase',
  'Calls': 'supabase',
  'Campaigns': 'supabase',
  'Campaign Leads': 'supabase',
  'Import History': 'supabase',
  'DNC List': 'supabase',
  'Activity Logs': 'supabase',
  'Users': 'supabase',
};

const SUPABASE_TABLES: Record<string, string> = {
  'Dispositions': 'dispositions',
  'Call Scripts': 'call_scripts',
  'Custom Fields': 'custom_fields',
  'Pipeline Stages': 'pipeline_stages',
  'Lead Sources': 'lead_sources',
  'Health Statuses': 'health_statuses',
  'Carriers': 'carriers',
  'Email/SMS Templates': 'message_templates',
  'Custom Menu Links': 'custom_menu_links',
  'Phone Numbers': 'phone_numbers',
  'Leads': 'leads',
  'Clients': 'clients',
  'Recruits': 'recruits',
  'Appointments': 'appointments',
  'Calls': 'calls',
  'Campaigns': 'campaigns',
  'Campaign Leads': 'campaign_leads',
  'Import History': 'import_history',
  'DNC List': 'dnc_list',
  'Activity Logs': 'activity_logs',
  'Users': 'profiles',
};

// ─── Types ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

interface ColDef {
  key: string;
  label: string;
  render?: (val: unknown, row: Row, ctx: RenderCtx) => React.ReactNode;
}

interface EditField {
  key: string;
  label: string;
  type: "text" | "color" | "toggle" | "select" | "agent-select";
  options?: string[];
}

interface CategoryConfig {
  table: string;
  orderBy?: { col: string; asc: boolean };
  columns: ColDef[];
  editFields: EditField[];
  getLabel: (row: Row) => string;
  readOnly?: boolean;
  /** Extra table to fetch alongside rows (e.g. campaigns for campaign_leads) */
  extraTable?: string;
}

interface RenderCtx {
  profileMap: Record<string, string>;
  extraMap: Record<string, string>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const PRESET_COLORS = [
  "#EF4444", "#F97316", "#EAB308", "#22C55E", "#3B82F6",
  "#8B5CF6", "#EC4899", "#6B7280", "#14B8A6", "#F59E0B",
];

const CATEGORIES = [
  "Dispositions", "Call Scripts", "Custom Fields", "Pipeline Stages",
  "Lead Sources", "Health Statuses", "Carriers", "Email/SMS Templates",
  "Custom Menu Links", "Phone Numbers", "Leads", "Clients", "Recruits",
  "Appointments", "Calls", "Campaigns", "Campaign Leads", "Import History",
  "DNC List", "Activity Logs", "Users",
];

// ─── Small render helpers ─────────────────────────────────────────────────────

const ColorDot = memo(({ color }: { color: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <span
      className="inline-block w-3 h-3 rounded-full border border-black/10 shrink-0"
      style={{ backgroundColor: color }}
    />
    <span className="text-xs font-mono text-muted-foreground">{color}</span>
  </span>
));
ColorDot.displayName = "ColorDot";

const BoolIcon = memo(({ value }: { value: boolean }) =>
  value
    ? <Check className="w-3.5 h-3.5 text-green-500" />
    : <X className="w-3.5 h-3.5 text-muted-foreground/40" />
);
BoolIcon.displayName = "BoolIcon";

const Badge = memo(({ value, variant }: { value: string; variant?: string }) => {
  const base = "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium";
  const colors: Record<string, string> = {
    Active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    Inactive: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    Pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    Scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    Completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    Cancelled: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
    Draft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    Paused: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    Archived: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
    Claimed: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    Available: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    Locked: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    Called: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    Skipped: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
    SMS: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
    Email: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    Admin: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    "Team Leader": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    Agent: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    Clean: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    Spam: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
    Appointed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    "Not Appointed": "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    "No Show": "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  };
  const fallback = variant === "destructive"
    ? "bg-red-100 text-red-600"
    : "bg-accent text-foreground";
  return (
    <span className={`${base} ${colors[value] ?? fallback}`}>{value ?? "—"}</span>
  );
});
Badge.displayName = "Badge";

const PillList = memo(({ items }: { items: string[] }) => (
  <span className="flex flex-wrap gap-1">
    {items.map((item) => (
      <span key={item} className="inline-flex px-1.5 py-0.5 rounded bg-accent text-foreground text-[10px] font-medium">
        {item}
      </span>
    ))}
  </span>
));
PillList.displayName = "PillList";

function formatDuration(secs: number | null): string {
  if (!secs && secs !== 0) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return phone;
}

function formatDate(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function truncate(str: string | null, n = 60): string {
  if (!str) return "—";
  return str.length > n ? str.slice(0, n) + "…" : str;
}

// ─── Category Configurations ─────────────────────────────────────────────────

function buildConfig(profiles: { id: string; name: string }[]): Record<string, CategoryConfig> {
  const agentOpts = profiles.map((p) => p.id);

  return {
    "Dispositions": {
      table: "dispositions",
      orderBy: { col: "sort_order", asc: true },
      columns: [
        { key: "name", label: "Name" },
        { key: "color", label: "Color", render: (v) => <ColorDot color={String(v ?? "#888")} /> },
        { key: "require_notes", label: "Req. Notes", render: (v) => <BoolIcon value={!!v} /> },
        { key: "callback_scheduler", label: "Callback", render: (v) => <BoolIcon value={!!v} /> },
        { key: "sort_order", label: "Order" },
      ],
      editFields: [
        { key: "name", label: "Name", type: "text" },
        { key: "color", label: "Color", type: "color" },
      ],
      getLabel: (r) => r.name,
    },
    "Call Scripts": {
      table: "call_scripts",
      orderBy: { col: "name", asc: true },
      columns: [
        { key: "name", label: "Name" },
        { key: "product_type", label: "Product Type" },
        { key: "content", label: "Word Count", render: (v) => String(v ? String(v).split(/\s+/).filter(Boolean).length : 0) },
        { key: "updated_at", label: "Last Updated", render: (v) => formatDate(v as string) },
      ],
      editFields: [
        { key: "name", label: "Name", type: "text" },
      ],
      getLabel: (r) => r.name,
    },
    "Custom Fields": {
      table: "custom_fields",
      orderBy: { col: "name", asc: true },
      columns: [
        { key: "name", label: "Name" },
        { key: "type", label: "Type" },
        { key: "applies_to", label: "Applies To", render: (v) => Array.isArray(v) ? <PillList items={v as string[]} /> : <span className="text-muted-foreground">—</span> },
        { key: "required", label: "Required", render: (v) => <BoolIcon value={!!v} /> },
        { key: "active", label: "Active", render: (v) => <BoolIcon value={!!v} /> },
      ],
      editFields: [
        { key: "name", label: "Name", type: "text" },
        { key: "active", label: "Active", type: "toggle" },
      ],
      getLabel: (r) => r.name,
    },
    "Pipeline Stages": {
      table: "pipeline_stages",
      orderBy: { col: "sort_order", asc: true },
      columns: [
        { key: "name", label: "Name" },
        { key: "color", label: "Color", render: (v) => <ColorDot color={String(v ?? "#888")} /> },
        { key: "pipeline_type", label: "Pipeline Type" },
        { key: "is_positive", label: "Positive", render: (v) => <BoolIcon value={!!v} /> },
        { key: "convert_to_client", label: "Convert Trigger", render: (v) => <BoolIcon value={!!v} /> },
        { key: "sort_order", label: "Order" },
      ],
      editFields: [
        { key: "name", label: "Name", type: "text" },
        { key: "color", label: "Color", type: "color" },
        { key: "convert_to_client", label: "Convert Trigger", type: "toggle" },
        { key: "is_positive", label: "Positive", type: "toggle" },
        { key: "pipeline_type", label: "Pipeline Type", type: "select", options: ["lead", "recruit"] },
      ],
      getLabel: (r) => r.name,
    },
    "Lead Sources": {
      table: "lead_sources",
      orderBy: { col: "name", asc: true },
      columns: [
        { key: "name", label: "Name" },
        { key: "color", label: "Color", render: (v) => <ColorDot color={String(v ?? "#888")} /> },
        { key: "active", label: "Active", render: (v) => <BoolIcon value={!!v} /> },
        { key: "usage_count", label: "Usage" },
      ],
      editFields: [
        { key: "name", label: "Name", type: "text" },
        { key: "color", label: "Color", type: "color" },
        { key: "active", label: "Active", type: "toggle" },
      ],
      getLabel: (r) => r.name,
    },
    "Health Statuses": {
      table: "health_statuses",
      orderBy: { col: "sort_order", asc: true },
      columns: [
        { key: "name", label: "Name" },
        { key: "color", label: "Color", render: (v) => <ColorDot color={String(v ?? "#888")} /> },
        { key: "description", label: "Description", render: (v) => truncate(v as string) },
        { key: "sort_order", label: "Order" },
      ],
      editFields: [
        { key: "name", label: "Name", type: "text" },
        { key: "color", label: "Color", type: "color" },
      ],
      getLabel: (r) => r.name,
    },
    "Carriers": {
      table: "carriers",
      orderBy: { col: "name", asc: true },
      columns: [
        { key: "name", label: "Name" },
        { key: "is_appointed", label: "Status", render: (v) => <Badge value={v ? "Appointed" : "Not Appointed"} /> },
        { key: "portal_url", label: "Portal", render: (v) => v ? <a href={String(v)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline text-xs"><ExternalLink className="w-3 h-3" />Link</a> : <span className="text-muted-foreground">—</span> },
      ],
      editFields: [
        { key: "name", label: "Name", type: "text" },
        { key: "is_appointed", label: "Is Appointed", type: "toggle" },
      ],
      getLabel: (r) => r.name,
    },
    "Email/SMS Templates": {
      table: "message_templates",
      orderBy: { col: "name", asc: true },
      columns: [
        { key: "name", label: "Name" },
        { key: "type", label: "Type", render: (v) => v ? <Badge value={String(v).charAt(0).toUpperCase() + String(v).slice(1)} /> : <span className="text-muted-foreground">—</span> },
        { key: "subject", label: "Subject", render: (v) => truncate(v as string, 50) },
        { key: "updated_at", label: "Last Updated", render: (v) => formatDate(v as string) },
      ],
      editFields: [
        { key: "name", label: "Name", type: "text" },
      ],
      getLabel: (r) => r.name,
    },
    "Custom Menu Links": {
      table: "custom_menu_links",
      orderBy: { col: "sort_order", asc: true },
      columns: [
        { key: "label", label: "Name" },
        { key: "url", label: "URL", render: (v) => v ? <a href={String(v)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline text-xs"><ExternalLink className="w-3 h-3" />{truncate(v as string, 40)}</a> : <span className="text-muted-foreground">—</span> },
        { key: "icon", label: "Icon", render: (v) => v ? String(v) : <span className="text-muted-foreground">—</span> },
        { key: "sort_order", label: "Order" },
      ],
      editFields: [
        { key: "label", label: "Name", type: "text" },
        { key: "url", label: "URL", type: "text" },
      ],
      getLabel: (r) => r.label,
    },
    "Phone Numbers": {
      table: "phone_numbers",
      orderBy: { col: "created_at", asc: false },
      columns: [
        { key: "phone_number", label: "Phone", render: (v) => formatPhone(v as string) },
        { key: "friendly_name", label: "Friendly Name" },
        { key: "spam_status", label: "Spam Status", render: (v) => v ? <Badge value={String(v)} /> : <span className="text-muted-foreground">—</span> },
        { key: "assigned_to", label: "Agent", render: (_v, row, ctx) => ctx.profileMap[row.assigned_to] ?? <span className="text-muted-foreground">Unassigned</span> },
        { key: "is_default", label: "Default", render: (v) => <BoolIcon value={!!v} /> },
      ],
      editFields: [
        { key: "friendly_name", label: "Friendly Name", type: "text" },
        { key: "assigned_to", label: "Assigned Agent", type: "agent-select" },
      ],
      getLabel: (r) => formatPhone(r.phone_number),
    },
    "Leads": {
      table: "leads",
      orderBy: { col: "created_at", asc: false },
      columns: [
        { key: "first_name", label: "First" },
        { key: "last_name", label: "Last" },
        { key: "phone", label: "Phone", render: (v) => formatPhone(v as string) },
        { key: "email", label: "Email", render: (v) => truncate(v as string, 30) },
        { key: "state", label: "State" },
        { key: "status", label: "Status", render: (v) => v ? <Badge value={String(v)} /> : <span className="text-muted-foreground">—</span> },
        { key: "lead_source", label: "Source" },
        { key: "assigned_agent_id", label: "Agent", render: (_v, row, ctx) => ctx.profileMap[row.assigned_agent_id] ?? <span className="text-muted-foreground">—</span> },
        { key: "created_at", label: "Created", render: (v) => formatDate(v as string) },
      ],
      editFields: [
        { key: "status", label: "Status", type: "text" },
        { key: "assigned_agent_id", label: "Assigned Agent", type: "agent-select" },
      ],
      getLabel: (r) => `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
    },
    "Clients": {
      table: "clients",
      orderBy: { col: "created_at", asc: false },
      columns: [
        { key: "first_name", label: "First" },
        { key: "last_name", label: "Last" },
        { key: "phone", label: "Phone", render: (v) => formatPhone(v as string) },
        { key: "policy_type", label: "Policy", render: (v) => v ? <Badge value={String(v)} /> : <span className="text-muted-foreground">—</span> },
        { key: "carrier", label: "Carrier" },
        { key: "premium", label: "Premium", render: (v) => v != null ? `$${Number(v).toLocaleString()}` : "—" },
        { key: "face_amount", label: "Face Amt", render: (v) => v != null ? `$${Number(v).toLocaleString()}` : "—" },
        { key: "issue_date", label: "Issue Date", render: (v) => formatDate(v as string) },
        { key: "assigned_agent_id", label: "Agent", render: (_v, row, ctx) => ctx.profileMap[row.assigned_agent_id] ?? <span className="text-muted-foreground">—</span> },
        { key: "created_at", label: "Created", render: (v) => formatDate(v as string) },
      ],
      editFields: [
        { key: "policy_type", label: "Policy Type", type: "text" },
        { key: "carrier", label: "Carrier", type: "text" },
        { key: "policy_number", label: "Policy #", type: "text" },
        { key: "premium", label: "Premium", type: "text" },
        { key: "face_amount", label: "Face Amount", type: "text" },
        { key: "issue_date", label: "Issue Date", type: "text" },
        { key: "assigned_agent_id", label: "Assigned Agent", type: "agent-select" },
      ],
      getLabel: (r) => `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
    },
    "Recruits": {
      table: "recruits",
      orderBy: { col: "created_at", asc: false },
      columns: [
        { key: "first_name", label: "First" },
        { key: "last_name", label: "Last" },
        { key: "phone", label: "Phone", render: (v) => formatPhone(v as string) },
        { key: "email", label: "Email", render: (v) => truncate(v as string, 30) },
        { key: "status", label: "Status", render: (v) => v ? <Badge value={String(v)} /> : <span className="text-muted-foreground">—</span> },
        { key: "assigned_agent_id", label: "Agent", render: (_v, row, ctx) => ctx.profileMap[row.assigned_agent_id] ?? <span className="text-muted-foreground">—</span> },
        { key: "created_at", label: "Created", render: (v) => formatDate(v as string) },
      ],
      editFields: [
        { key: "status", label: "Status", type: "select", options: ["New", "Contacted", "Interested", "In Training", "Licensed", "Inactive"] },
        { key: "assigned_agent_id", label: "Assigned Agent", type: "agent-select" },
      ],
      getLabel: (r) => `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
    },
    "Appointments": {
      table: "appointments",
      orderBy: { col: "start_time", asc: false },
      columns: [
        { key: "contact_name", label: "Contact" },
        { key: "type", label: "Type", render: (v) => v ? <Badge value={String(v)} /> : <span className="text-muted-foreground">—</span> },
        { key: "status", label: "Status", render: (v) => v ? <Badge value={String(v)} /> : <span className="text-muted-foreground">—</span> },
        { key: "start_time", label: "Start", render: (v) => formatDate(v as string) },
        { key: "user_id", label: "Agent", render: (_v, row, ctx) => ctx.profileMap[row.user_id] ?? <span className="text-muted-foreground">—</span> },
        { key: "created_at", label: "Created", render: (v) => formatDate(v as string) },
      ],
      editFields: [
        { key: "status", label: "Status", type: "select", options: ["Scheduled", "Confirmed", "Completed", "Cancelled", "No Show"] },
      ],
      getLabel: (r) => r.contact_name ?? r.title ?? r.id,
    },
    "Calls": {
      table: "calls",
      orderBy: { col: "created_at", asc: false },
      columns: [
        { key: "contact_name", label: "Contact" },
        { key: "agent_id", label: "Agent", render: (_v, row, ctx) => ctx.profileMap[row.agent_id] ?? <span className="text-muted-foreground">—</span> },
        { key: "duration", label: "Duration", render: (v) => formatDuration(v as number) },
        { key: "disposition_name", label: "Disposition", render: (v) => v ? <Badge value={String(v)} /> : <span className="text-muted-foreground">—</span> },
        { key: "outcome", label: "Outcome", render: (v) => truncate(v as string, 40) },
        { key: "created_at", label: "Created", render: (v) => formatDate(v as string) },
      ],
      editFields: [
        { key: "disposition_name", label: "Disposition", type: "text" },
      ],
      getLabel: (r) => r.contact_name ?? r.id,
    },
    "Campaigns": {
      table: "campaigns",
      orderBy: { col: "created_at", asc: false },
      columns: [
        { key: "name", label: "Name" },
        { key: "type", label: "Type", render: (v) => v ? <Badge value={String(v)} /> : <span className="text-muted-foreground">—</span> },
        { key: "status", label: "Status", render: (v) => v ? <Badge value={String(v)} /> : <span className="text-muted-foreground">—</span> },
        { key: "total_leads", label: "Total Leads" },
        { key: "leads_contacted", label: "Contacted" },
        { key: "created_by", label: "Created By", render: (_v, row, ctx) => ctx.profileMap[row.created_by] ?? <span className="text-muted-foreground">—</span> },
        { key: "created_at", label: "Created", render: (v) => formatDate(v as string) },
      ],
      editFields: [
        { key: "status", label: "Status", type: "select", options: ["Active", "Paused", "Draft", "Completed", "Archived"] },
      ],
      getLabel: (r) => r.name,
    },
    "Campaign Leads": {
      table: "campaign_leads",
      orderBy: { col: "created_at", asc: false },
      extraTable: "campaigns",
      columns: [
        { key: "campaign_id", label: "Campaign", render: (_v, row, ctx) => ctx.extraMap[row.campaign_id] ?? <span className="text-muted-foreground text-xs font-mono">{String(row.campaign_id ?? "").slice(0, 8)}…</span> },
        { key: "first_name", label: "First" },
        { key: "phone", label: "Phone", render: (v) => formatPhone(v as string) },
        { key: "status", label: "Status", render: (v) => v ? <Badge value={String(v)} /> : <span className="text-muted-foreground">—</span> },
        { key: "claimed_by", label: "Claimed By", render: (_v, row, ctx) => row.claimed_by ? (ctx.profileMap[row.claimed_by] ?? row.claimed_by) : <span className="text-muted-foreground">Unclaimed</span> },
        { key: "call_attempts", label: "Attempts" },
      ],
      editFields: [
        { key: "status", label: "Status", type: "select", options: ["Available", "Locked", "Claimed", "Called", "Skipped"] },
      ],
      getLabel: (r) => `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.phone || r.id,
    },
    "Import History": {
      table: "import_history",
      orderBy: { col: "created_at", asc: false },
      columns: [
        { key: "file_name", label: "File" },
        { key: "total_records", label: "Total" },
        { key: "imported", label: "Imported" },
        { key: "duplicates", label: "Dupes" },
        { key: "errors", label: "Errors" },
        { key: "agent_id", label: "Agent", render: (_v, row, ctx) => ctx.profileMap[row.agent_id] ?? <span className="text-muted-foreground">—</span> },
        { key: "created_at", label: "Date", render: (v) => formatDate(v as string) },
      ],
      editFields: [],
      readOnly: true,
      getLabel: (r) => r.file_name ?? r.id,
    },
    "DNC List": {
      table: "dnc_list",
      orderBy: { col: "created_at", asc: false },
      columns: [
        { key: "phone_number", label: "Phone", render: (v) => formatPhone(v as string) },
        { key: "reason", label: "Reason", render: (v) => truncate(v as string, 50) },
        { key: "added_by", label: "Added By", render: (_v, row, ctx) => ctx.profileMap[row.added_by] ?? <span className="text-muted-foreground">—</span> },
        { key: "created_at", label: "Date", render: (v) => formatDate(v as string) },
      ],
      editFields: [
        { key: "reason", label: "Reason", type: "text" },
      ],
      getLabel: (r) => formatPhone(r.phone_number),
    },
    "Activity Logs": {
      table: "activity_logs",
      orderBy: { col: "created_at", asc: false },
      columns: [
        { key: "user_name", label: "User", render: (v, row, ctx) => String(v ?? ctx.profileMap[row.user_id] ?? "—") },
        { key: "action", label: "Action", render: (v) => truncate(v as string, 80) },
        { key: "created_at", label: "Date", render: (v) => formatDate(v as string) },
      ],
      editFields: [],
      readOnly: true,
      getLabel: (r) => r.action ?? r.id,
    },
    "Users": {
      table: "profiles",
      orderBy: { col: "first_name", asc: true },
      columns: [
        { key: "first_name", label: "First" },
        { key: "last_name", label: "Last" },
        { key: "email", label: "Email", render: (v) => truncate(v as string, 35) },
        { key: "role", label: "Role", render: (v) => v ? <Badge value={String(v)} /> : <span className="text-muted-foreground">—</span> },
        { key: "status", label: "Status", render: (v) => v ? <Badge value={String(v)} /> : <span className="text-muted-foreground">—</span> },
        { key: "availability_status", label: "Availability" },
        { key: "created_at", label: "Created", render: (v) => formatDate(v as string) },
      ],
      editFields: [
        { key: "status", label: "Status", type: "select", options: ["Active", "Inactive", "Pending"] },
        { key: "role", label: "Role", type: "select", options: ["Admin", "Team Leader", "Agent"] },
      ],
      getLabel: (r) => `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.email,
    },
  };
}

// ─── Color Picker ─────────────────────────────────────────────────────────────

const ColorPicker = memo(({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <div>
    <div className="flex flex-wrap gap-2 mb-2">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`w-7 h-7 rounded-md border-2 transition-all ${value === c ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
          style={{ backgroundColor: c }}
          type="button"
        />
      ))}
    </div>
    <div className="flex items-center gap-2">
      <span className="w-7 h-7 rounded-md border shrink-0" style={{ backgroundColor: value }} />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="#3B82F6" className="font-mono text-sm h-8" />
    </div>
  </div>
));
ColorPicker.displayName = "ColorPicker";

// ─── Table Row (memoized) ─────────────────────────────────────────────────────

interface TableRowProps {
  row: Row;
  columns: ColDef[];
  ctx: RenderCtx;
  checked: boolean;
  isEven: boolean;
  readOnly: boolean;
  onCheck: (id: string) => void;
  onEdit: (row: Row) => void;
  onDelete: (row: Row) => void;
}

const TableRow = memo(({ row, columns, ctx, checked, isEven, readOnly, onCheck, onEdit, onDelete }: TableRowProps) => (
  <tr className={`${isEven ? "bg-accent/20" : ""} hover:bg-accent/40 transition-colors`}>
    <td className="px-3 py-2 w-8">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onCheck(row.id)}
        className="rounded border-border"
      />
    </td>
    {columns.map((col) => (
      <td key={col.key} className="px-3 py-2 text-sm text-foreground whitespace-nowrap max-w-[200px] truncate">
        {col.render
          ? col.render(row[col.key], row, ctx)
          : (row[col.key] != null ? String(row[col.key]) : <span className="text-muted-foreground">—</span>)
        }
      </td>
    ))}
    <td className="px-3 py-2 w-20">
      <div className="flex items-center gap-1">
        {!readOnly && (
          <button
            onClick={() => onEdit(row)}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => onDelete(row)}
          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </td>
  </tr>
));
TableRow.displayName = "TableRow";

// ─── Main Component ───────────────────────────────────────────────────────────

const MasterAdmin: React.FC = () => {
  const [category, setCategory] = useState("Dispositions");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [extraMap, setExtraMap] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Edit state
  const [editTarget, setEditTarget] = useState<Row | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [editSaving, setEditSaving] = useState(false);

  // Delete state
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [deleteLabel, setDeleteLabel] = useState("");
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Refresh state (tracks button-initiated refreshes separately from initial loads)
  const [refreshing, setRefreshing] = useState(false);

  const configs = useMemo(() => buildConfig(profiles), [profiles]);
  const config = configs[category];

  const ctx: RenderCtx = useMemo(() => ({ profileMap, extraMap }), [profileMap, extraMap]);

  // ── Load profiles once ──────────────────────────────────────────────────────
  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .then(({ data }) => {
        if (!data) return;
        const list = data.map((p) => ({ id: p.id, name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() }));
        setProfiles(list);
        setProfileMap(Object.fromEntries(list.map((p) => [p.id, p.name])));
      });
  }, []);

  // ── Load rows when category changes ────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    setRows([]);
    setSelected(new Set());
    setPage(0);
    setSearch("");
    setExtraMap({});

    try {
      // Fetch from Supabase
      const tableName = SUPABASE_TABLES[category] ?? config.table;
      let q = supabase.from(tableName as "leads").select("*"); // type cast — runtime table name
      if (config.orderBy) {
        q = q.order(config.orderBy.col, { ascending: config.orderBy.asc });
      }
      const { data, error } = await q;
      if (error) {
        toast({ title: `Cannot load ${category}`, description: error.message, variant: "destructive" });
        setRows([]);
      } else {
        setRows(data ?? []);
      }

      // Load extra map (e.g. campaigns for campaign_leads)
      if (config.extraTable) {
        const { data: extraData } = await supabase
          .from(config.extraTable as "campaigns")
          .select("id, name");
        if (extraData) {
          setExtraMap(Object.fromEntries(extraData.map((r) => [r.id, r.name])));
        }
      }
    } finally {
      setLoading(false);
    }
  }, [category, config]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Refresh handler (button-triggered, shows spinner on button) ─────────────
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }, [loadData, refreshing]);

  // ── Search filter ───────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((row) =>
      config.columns.some((col) => {
        const raw = row[col.key];
        if (raw == null) return false;
        const str = typeof raw === "object" ? JSON.stringify(raw) : String(raw);
        return str.toLowerCase().includes(q);
      })
    );
  }, [rows, search, config]);

  // ── Pagination ──────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // ── Selection ───────────────────────────────────────────────────────────────
  const allOnPageChecked = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageChecked) {
        pageRows.forEach((r) => next.delete(r.id));
      } else {
        pageRows.forEach((r) => next.add(r.id));
      }
      return next;
    });
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Edit ────────────────────────────────────────────────────────────────────
  const openEdit = (row: Row) => {
    const initial: Record<string, unknown> = {};
    config.editFields.forEach((f) => { initial[f.key] = row[f.key] ?? ""; });
    setEditTarget(row);
    setEditForm(initial);
  };

  const saveEdit = async () => {
    if (!editTarget || !config) return;
    setEditSaving(true);
    try {
      // Route to Supabase
      const tableName = SUPABASE_TABLES[category] ?? config.table;
      const { error } = await supabase
        .from(tableName as "leads")
        .update({ ...editForm, updated_at: new Date().toISOString() })
        .eq("id", editTarget.id);
      if (error) throw error;

      toast({ title: "Saved successfully" });
      setEditTarget(null);
      loadData();
    } catch (e) {
      const msg = (e as Error).message;
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const openDelete = (row: Row) => {
    setDeleteIds([row.id]);
    setDeleteLabel(config.getLabel(row));
    setDeleteText("");
  };

  const openBulkDelete = () => {
    const ids = Array.from(selected);
    setDeleteIds(ids);
    setDeleteLabel(`${ids.length} item${ids.length !== 1 ? "s" : ""}`);
    setDeleteText("");
  };

  const confirmDelete = async () => {
    if (deleteText !== "DELETE" || !config) return;
    setDeleting(true);
    try {
      // Route to Supabase
      const tableName = SUPABASE_TABLES[category] ?? config.table;
      const { error } = await supabase
        .from(tableName as "leads")
        .delete()
        .in("id", deleteIds);
        if (error) {
          const isFk = error.message.toLowerCase().includes("foreign key") || error.code === "23503";
          toast({
            title: isFk ? "Cannot delete — this item is referenced by other records" : "Delete failed",
            description: isFk ? undefined : error.message,
            variant: "destructive",
          });
        } else {
          toast({ title: `Deleted ${deleteIds.length} item${deleteIds.length !== 1 ? "s" : ""}` });
          setDeleteIds([]);
          setDeleteText("");
          setSelected(new Set());
          loadData();
        }
    } finally {
      setDeleting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!config) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Database className="w-5 h-5 text-primary" /> Master Admin
        </h3>
        <p className="text-sm text-muted-foreground">System-level data management. Full edit and delete access.</p>
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Category dropdown */}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 px-3 rounded-lg bg-accent text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* Bulk delete */}
        {selected.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={openBulkDelete}
            className="gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete {selected.size} Selected
          </Button>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search…"
            className="pl-8 h-9 w-56 text-sm"
          />
        </div>

        {/* Refresh */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="px-2.5"
          title="Refresh data"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Row count */}
      <p className="text-xs text-muted-foreground">
        {loading ? "Loading…" : `${filteredRows.length.toLocaleString()} record${filteredRows.length !== 1 ? "s" : ""}${search ? " (filtered)" : ""}`}
      </p>

      {/* Table */}
      <div className="bg-card rounded-xl border overflow-auto">
        {loading ? (
          <div className="space-y-px p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-9 rounded bg-accent/40 animate-pulse" />
            ))}
          </div>
        ) : pageRows.length === 0 ? (
          <div className="py-16 text-center">
            <Database className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No records found{search ? " matching your search" : ""}.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-accent/30">
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={allOnPageChecked}
                    onChange={toggleSelectAll}
                    className="rounded border-border"
                  />
                </th>
                {config.columns.map((col) => (
                  <th key={col.key} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    {col.label}
                  </th>
                ))}
                <th className="px-3 py-2 w-20 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageRows.map((row, idx) => (
                <TableRow
                  key={row.id}
                  row={row}
                  columns={config.columns}
                  ctx={ctx}
                  checked={selected.has(row.id)}
                  isEven={idx % 2 === 0}
                  readOnly={!!config.readOnly}
                  onCheck={toggleRow}
                  onEdit={openEdit}
                  onDelete={openDelete}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </p>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Edit Modal ─────────────────────────────────────────────────────── */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit — {config.getLabel(editTarget ?? {})}</DialogTitle>
            <DialogDescription>Quick edit for {category}.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {config.editFields.map((field) => (
              <div key={field.key}>
                <label className="text-sm font-medium text-foreground block mb-1.5">{field.label}</label>

                {field.type === "text" && (
                  <Input
                    value={editForm[field.key] ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, [field.key]: e.target.value }))}
                  />
                )}

                {field.type === "color" && (
                  <ColorPicker
                    value={editForm[field.key] ?? "#3B82F6"}
                    onChange={(v) => setEditForm((f) => ({ ...f, [field.key]: v }))}
                  />
                )}

                {field.type === "toggle" && (
                  <Switch
                    checked={!!editForm[field.key]}
                    onCheckedChange={(v) => setEditForm((f) => ({ ...f, [field.key]: v }))}
                  />
                )}

                {field.type === "select" && (
                  <select
                    value={editForm[field.key] ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, [field.key]: e.target.value }))}
                    className="w-full h-9 px-3 rounded-lg bg-accent text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
                  >
                    <option value="">— select —</option>
                    {(field.options ?? []).map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                )}

                {field.type === "agent-select" && (
                  <select
                    value={editForm[field.key] ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, [field.key]: e.target.value }))}
                    className="w-full h-9 px-3 rounded-lg bg-accent text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
                  >
                    <option value="">— unassigned —</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Modal ─────────────────────────────────────── */}
      <Dialog open={deleteIds.length > 0} onOpenChange={(open) => { if (!open) { setDeleteIds([]); setDeleteText(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Delete {deleteLabel}?
            </DialogTitle>
            <DialogDescription>
              This is a permanent hard delete from the database and cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-foreground">
              Type <span className="font-mono font-bold text-destructive">DELETE</span> to confirm:
            </p>
            <Input
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder="DELETE"
              className="font-mono"
              autoComplete="off"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setDeleteIds([]); setDeleteText(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteText !== "DELETE" || deleting}
            >
              {deleting ? "Deleting…" : `Delete ${deleteIds.length > 1 ? `${deleteIds.length} Items` : "Item"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MasterAdmin;
