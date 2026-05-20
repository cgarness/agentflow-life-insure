import type { ModuleStatus, ParsedModule } from "./types";
import { itemKey } from "./slug";

function inferModuleStatus(text: string): ModuleStatus {
  const lower = text.toLowerCase();
  if (/\bmock\b|\bplaceholder\b|\bnot production\b|\bdeferred\b/.test(lower)) {
    return "PLACEHOLDER";
  }
  if (/\bbroken\b|\bfail/.test(lower)) {
    return "BROKEN";
  }
  if (/\bneeds?\b|\btodo\b|\bcoming soon\b|\boutstanding\b|\bnot yet\b/.test(lower)) {
    return "NEEDS_WORK";
  }
  if (/\bshipped\b|\blive\b|\bbuilt\b/.test(lower)) {
    return "LIVE";
  }
  return "LIVE";
}

/** Parse VISION.md §8 module blocks (### headers under "## 8. Modules"). */
export function parseVisionModules(raw: string): ParsedModule[] {
  const sectionMatch = raw.match(/## 8\. Modules[\s\S]*?(?=\n## |\n---\s*\n## |$)/i);
  if (!sectionMatch) return [];

  const block = sectionMatch[0];
  const parts = block.split(/\n### /).slice(1);

  return parts.map((part) => {
    const lines = part.trim().split("\n");
    const name = lines[0]?.trim() ?? "Unknown";
    const excerpt = lines.slice(1).join(" ").trim().slice(0, 400);
    return {
      itemKey: itemKey("module", name),
      name,
      excerpt,
      inferredStatus: inferModuleStatus(`${name} ${excerpt}`),
    };
  });
}
