import type { ParsedMigrationRow, ParsedWorkLogEntry } from "./types";
import { itemKey } from "./slug";

const ENTRY_RE =
  /^(\d{4}-\d{2}-\d{2})\s*\|\s*\[(DONE|IN PROGRESS)\]\s*([^|]+?)(?:\s*\|\s*)?(.*)$/i;

/** Top work log entries (before ## Migration History). */
export function parseWorkLogEntries(raw: string, limit = 30): ParsedWorkLogEntry[] {
  const cut = raw.split(/\n## Migration History/i)[0] ?? raw;
  const entries: ParsedWorkLogEntry[] = [];

  for (const line of cut.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("202")) continue;
    const m = trimmed.match(ENTRY_RE);
    if (!m) continue;
    const title = m[3].trim();
    entries.push({
      itemKey: itemKey("build-queue", `${m[1]}-${title}`),
      date: m[1],
      status: m[2].toUpperCase() === "IN PROGRESS" ? "IN PROGRESS" : "DONE",
      title,
      excerpt: (m[4] ?? "").trim().slice(0, 280),
    });
    if (entries.length >= limit) break;
  }

  return entries;
}

export function parseInProgressBuildQueue(raw: string): ParsedWorkLogEntry[] {
  return parseWorkLogEntries(raw, 50).filter((e) => e.status === "IN PROGRESS");
}

/** Markdown table under ## Migration History. */
export function parseMigrationHistory(raw: string): ParsedMigrationRow[] {
  const idx = raw.search(/## Migration History/i);
  if (idx < 0) return [];

  const tableBlock = raw.slice(idx);
  const rows: ParsedMigrationRow[] = [];

  for (const line of tableBlock.split("\n")) {
    if (!line.includes("|") || line.includes(":---")) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 3) continue;
    if (cells[0] === "Migration ID") continue;
    const migrationId = cells[0].replace(/`/g, "");
    if (!/^\d{8}/.test(migrationId) && !migrationId.startsWith("2026")) continue;
    rows.push({
      migrationId,
      topic: cells[1],
      outcome: cells[2].slice(0, 500),
    });
  }

  return rows;
}

/** Optional ## Environment Variables section. */
export function parseEnvironmentVariables(raw: string): { name: string; location: string; domain: string }[] {
  const idx = raw.search(/## Environment Variables/i);
  if (idx < 0) return [];

  const block = raw.slice(idx).split(/\n## /)[0] ?? "";
  const rows: { name: string; location: string; domain: string }[] = [];

  for (const line of block.split("\n")) {
    if (!line.includes("|") || line.includes(":---")) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 2 || cells[0] === "Variable") continue;
    rows.push({
      name: cells[0],
      location: cells[1] ?? "",
      domain: cells[2] ?? "",
    });
  }

  return rows;
}
