/**
 * Contacts table configuration — Contacts Build 6 (extracted from Contacts.tsx).
 *
 * Pure, stateless constants/types: per-tab column definitions, default-visible
 * sets, the new-user starter layout, fallback status/source colors, and the
 * status option lists. Behavior is identical to the prior inline definitions;
 * this module only relocates them so the page component is smaller and the
 * table config is independently importable/testable.
 */

import type { LeadStatus } from "@/lib/types";

// Fallback status colors (used if pipeline stages haven't loaded)
export const fallbackStatusColors: Record<string, string> = {
  "New": "#3B82F6",
  "Contacted": "#A855F7",
  "Interested": "#EAB308",
  "Follow Up": "#14B8A6",
  "Hot": "#F97316",
  "Not Interested": "#EF4444",
  "Closed Won": "#22C55E",
  "Closed Lost": "#EF4444",
};

export const fallbackRecruitColors: Record<string, string> = {
  "Prospect": "#6B7280",
  "Contacted": "#A855F7",
  "Interview": "#EAB308",
  "Licensed": "#3B82F6",
  "Active": "#22C55E",
  "Appointment Set": "#9333EA",
  "APPPINTMENT SET": "#9333EA",
};

export const policyTypeColors: Record<string, string> = {
  "Term": "bg-primary/10 text-primary",
  "Whole Life": "bg-success/10 text-success",
  "IUL": "bg-info/10 text-info",
};

export const allStatuses: LeadStatus[] = ["New", "Contacted", "Interested", "Follow Up", "Hot", "Not Interested", "Closed Won", "Closed Lost"];
export const recruitStatuses = ["Prospect", "Contacted", "Interview", "Licensed", "Active"];

// ===== LEAD Column definitions =====
export type ColumnKey = "name" | "phone" | "email" | "state" | "status" | "source" | "agent" | "dob" | "bestTime" | "leadSourceAlias" | "createdDate" | "lastContacted";
export interface ColDef { key: ColumnKey; label: string; defaultVisible: boolean; locked?: boolean; }
export const ALL_COLUMNS: ColDef[] = [
  { key: "name", label: "Name", defaultVisible: true, locked: true },
  { key: "phone", label: "Phone", defaultVisible: true },
  { key: "email", label: "Email", defaultVisible: true },
  { key: "state", label: "State", defaultVisible: true },
  { key: "status", label: "Status", defaultVisible: true },
  { key: "source", label: "Source", defaultVisible: true },
  { key: "agent", label: "Agent", defaultVisible: true },
  { key: "dob", label: "Date of Birth", defaultVisible: false },
  { key: "bestTime", label: "Best Time to Call", defaultVisible: false },
  { key: "leadSourceAlias", label: "Lead Source", defaultVisible: false },
  { key: "createdDate", label: "Created Date", defaultVisible: false },
  { key: "lastContacted", label: "Last Contacted", defaultVisible: false },
];
export const DEFAULT_VISIBLE = new Set(ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key));

// ===== CLIENT Column definitions =====
export type ClientColumnKey = "name" | "phone" | "email" | "state" | "policyType" | "carrier" | "premium" | "faceAmount" | "issueDate" | "agent";
export interface ClientColDef { key: ClientColumnKey; label: string; defaultVisible: boolean; locked?: boolean; }
export const CLIENT_COLUMNS: ClientColDef[] = [
  { key: "name", label: "Name", defaultVisible: true, locked: true },
  { key: "phone", label: "Phone", defaultVisible: true },
  { key: "email", label: "Email", defaultVisible: true },
  { key: "state", label: "State", defaultVisible: true },
  { key: "policyType", label: "Policy Type", defaultVisible: true },
  { key: "carrier", label: "Carrier", defaultVisible: true },
  { key: "premium", label: "Premium", defaultVisible: true },
  { key: "faceAmount", label: "Face Amount", defaultVisible: true },
  { key: "issueDate", label: "Issue Date", defaultVisible: true },
  { key: "agent", label: "Agent", defaultVisible: true },
];
export const DEFAULT_CLIENT_VISIBLE = new Set(CLIENT_COLUMNS.filter(c => c.defaultVisible).map(c => c.key));

// ===== RECRUIT Column definitions =====
export type RecruitColumnKey = "name" | "phone" | "email" | "state" | "status" | "agent";
export interface RecruitColDef { key: RecruitColumnKey; label: string; defaultVisible: boolean; locked?: boolean; }
export const RECRUIT_COLUMNS: RecruitColDef[] = [
  { key: "name", label: "Name", defaultVisible: true, locked: true },
  { key: "phone", label: "Phone", defaultVisible: true },
  { key: "email", label: "Email", defaultVisible: true },
  { key: "state", label: "State", defaultVisible: true },
  { key: "status", label: "Status", defaultVisible: true },
  { key: "agent", label: "Agent", defaultVisible: true },
];
export const DEFAULT_RECRUIT_VISIBLE = new Set(RECRUIT_COLUMNS.filter(c => c.defaultVisible).map(c => c.key));

// ===== AGENT Column definitions =====
export type AgentColumnKey = "name" | "email" | "licensedStates" | "commission" | "role" | "status";
export interface AgentColDef { key: AgentColumnKey; label: string; defaultVisible: boolean; locked?: boolean; }
export const AGENT_COLUMNS: AgentColDef[] = [
  { key: "name", label: "Agent", defaultVisible: true, locked: true },
  { key: "email", label: "Email", defaultVisible: true },
  { key: "licensedStates", label: "Licensed States", defaultVisible: true },
  { key: "commission", label: "Commission", defaultVisible: true },
  { key: "role", label: "Role", defaultVisible: true },
  { key: "status", label: "Status", defaultVisible: true },
];
export const DEFAULT_AGENT_VISIBLE = new Set(AGENT_COLUMNS.filter(c => c.defaultVisible).map(c => c.key));

// Starter layout for new users (Rank 4 QA Requirement)
export const STARTER_LAYOUT: Record<string, Record<string, number>> = {
  Leads: { name: 200, phone: 150, email: 200, status: 120, state: 80, source: 150, agent: 150 },
  Clients: { name: 200, phone: 150, email: 200, state: 80, policyType: 120, carrier: 150, premium: 100, faceAmount: 120, issueDate: 120, agent: 150 },
  Recruits: { name: 200, phone: 150, email: 200, state: 80, status: 120, agent: 150 },
  Agents: { name: 200, email: 220, licensedStates: 180, commission: 120, role: 120, status: 100 },
};
