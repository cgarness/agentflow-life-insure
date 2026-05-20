export type OverlaySection =
  | "module"
  | "tech_debt"
  | "build_queue"
  | "feature_gap"
  | "page"
  | "risk";

export type ModuleStatus = "LIVE" | "NEEDS_WORK" | "PLACEHOLDER" | "BROKEN";

export type TechDebtPriority = "HIGH" | "MEDIUM" | "LOW";

export type BuildQueueMode = "THINK" | "BUILD" | "DEBUG";

export type RiskSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type RiskStatus = "OPEN" | "IN_PROGRESS" | "FIXED";

export interface InventoryItem {
  itemKey: string;
  section: OverlaySection;
  title: string;
  description?: string;
  inferredStatus?: string;
  meta?: Record<string, string | boolean | number>;
}

export interface ParsedModule {
  itemKey: string;
  name: string;
  excerpt: string;
  inferredStatus: ModuleStatus;
}

export interface ParsedWorkLogEntry {
  itemKey: string;
  date: string;
  status: "DONE" | "IN PROGRESS" | string;
  title: string;
  excerpt: string;
}

export interface ParsedMigrationRow {
  migrationId: string;
  topic: string;
  outcome: string;
}

export interface ParsedTechDebtItem {
  itemKey: string;
  title: string;
  description: string;
}

export interface ProjectStatusOverlay {
  id: string;
  item_key: string;
  section: string;
  status: string | null;
  note: string | null;
  sort_order: number;
  updated_at: string;
  updated_by: string | null;
}

export interface OverlayMap {
  byKey: Map<string, ProjectStatusOverlay>;
}
