import visionRaw from "../../../VISION.md?raw";
import workLogRaw from "../../../WORK_LOG.md?raw";
import agentRulesRaw from "../../../AGENT_RULES.md?raw";

import { DEFAULT_FEATURES, DEFAULT_PAGES, PLATFORM_ONLY_SETTINGS_SLUGS } from "@/config/permissionDefaults";
import { SETTINGS_CONFIG } from "@/config/settingsConfig";
import { STAT_DEFINITIONS } from "@/lib/stat-computations";
import { ACTION_METAS } from "@/lib/workflow-types";
import { EDGE_FUNCTIONS_MANIFEST } from "@/config/edgeFunctionsManifest";

import { parseTechDebt } from "./parseAgentRules";
import { parseMigrationHistory, parseEnvironmentVariables, parseWorkLogEntries, parseInProgressBuildQueue } from "./parseWorkLog";
import { parseVisionModules } from "./parseVision";
import { itemKey } from "./slug";
import type { InventoryItem } from "./types";

export const DOC_SOURCES = {
  visionRaw,
  workLogRaw,
  agentRulesRaw,
} as const;

export function getProjectInventory() {
  const modules = parseVisionModules(visionRaw);
  const workLog = parseWorkLogEntries(workLogRaw);
  const buildQueueSeed = parseInProgressBuildQueue(workLogRaw);
  const migrations = parseMigrationHistory(workLogRaw);
  const envVars = parseEnvironmentVariables(workLogRaw);
  const techDebt = parseTechDebt(agentRulesRaw);

  const pages = DEFAULT_PAGES.map((p) => ({
    itemKey: itemKey("page", p.name),
    section: "page" as const,
    title: p.name,
    description: `Agent: ${p.agent ? "yes" : "no"} · Team Leader: ${p.teamLeader ? "yes" : "no"}`,
    meta: { agent: p.agent, teamLeader: p.teamLeader },
  }));

  const features = DEFAULT_FEATURES.flatMap((cat) =>
    cat.features.map((f) => ({
      itemKey: itemKey("feature", `${cat.category}-${f.name}`),
      section: "feature_gap" as const,
      title: f.name,
      description: f.description,
      meta: { category: cat.category },
    }))
  );

  const settings = SETTINGS_CONFIG.flatMap((cat) =>
    cat.sections.map((s) => ({
      itemKey: itemKey("settings", s.slug),
      title: s.label,
      slug: s.slug,
      category: cat.label,
      platformOnly: (PLATFORM_ONLY_SETTINGS_SLUGS as readonly string[]).includes(s.slug),
    }))
  );

  const statGaps = STAT_DEFINITIONS.filter((s) => s.comingSoon).map((s) => ({
    itemKey: itemKey("feature-gap", `stat-${s.id}`),
    section: "feature_gap" as const,
    title: s.label,
    description: `Reports · ${s.category}`,
    inferredStatus: "PLACEHOLDER",
  }));

  const workflowGaps = ACTION_METAS.filter((a) => a.comingSoon).map((a) => ({
    itemKey: itemKey("feature-gap", `workflow-${a.type}`),
    section: "feature_gap" as const,
    title: a.label,
    description: "Workflow builder action",
    inferredStatus: "PLACEHOLDER",
  }));

  const featureGaps: InventoryItem[] = [...statGaps, ...workflowGaps];

  const buildQueue: InventoryItem[] = buildQueueSeed.map((e) => ({
    itemKey: e.itemKey,
    section: "build_queue",
    title: e.title,
    description: `${e.date} — ${e.excerpt}`,
    inferredStatus: e.status,
    meta: { date: e.date },
  }));

  const techDebtItems: InventoryItem[] = techDebt.map((t) => ({
    itemKey: t.itemKey,
    section: "tech_debt",
    title: t.title,
    description: t.description,
  }));

  return {
    modules,
    workLog,
    migrations,
    envVars,
    pages,
    features,
    settings,
    featureGaps,
    buildQueue,
    techDebtItems,
    edgeFunctions: EDGE_FUNCTIONS_MANIFEST,
  };
}

export type ProjectInventory = ReturnType<typeof getProjectInventory>;
