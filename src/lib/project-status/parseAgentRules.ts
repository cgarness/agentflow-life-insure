import type { ParsedTechDebtItem } from "./types";
import { itemKey } from "./slug";

/** Parse ## Known Tech Debt bullets from AGENT_RULES.md. */
export function parseTechDebt(raw: string): ParsedTechDebtItem[] {
  const match = raw.match(/## Known Tech Debt[\s\S]*?(?=\n## |\n---\s*\n## |$)/i);
  if (!match) return [];

  const items: ParsedTechDebtItem[] = [];
  for (const line of match[0].split("\n")) {
    const bullet = line.match(/^-\s+(.+)$/);
    if (!bullet) continue;
    const text = bullet[1].trim();
    const title = text.replace(/\*\*/g, "").slice(0, 120);
    items.push({
      itemKey: itemKey("tech-debt", title),
      title,
      description: text,
    });
  }

  return items;
}
