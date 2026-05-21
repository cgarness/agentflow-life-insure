import workLogRaw from "../../../WORK_LOG.md?raw";
import agentRulesRaw from "../../../AGENT_RULES.md?raw";

import { EDGE_FUNCTIONS_MANIFEST } from "@/config/edgeFunctionsManifest";

import { parseTechDebt } from "./parseAgentRules";
import { parseMigrationHistory, parseWorkLogEntries } from "./parseWorkLog";
import { itemKey } from "./slug";
import type { InventoryItem } from "./types";

/** Doc-derived reference data (work log, migrations, tech debt) — secondary panel on Project Status. */
export function getProjectReferenceInventory() {
  const workLog = parseWorkLogEntries(workLogRaw);
  const migrations = parseMigrationHistory(workLogRaw);
  const techDebt = parseTechDebt(agentRulesRaw);

  const techDebtItems: InventoryItem[] = techDebt.map((t) => ({
    itemKey: t.itemKey,
    section: "tech_debt",
    title: t.title,
    description: t.description,
  }));

  return {
    workLog,
    migrations,
    techDebtItems,
    edgeFunctions: EDGE_FUNCTIONS_MANIFEST,
  };
}
