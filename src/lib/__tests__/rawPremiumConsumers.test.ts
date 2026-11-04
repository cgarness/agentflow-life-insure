import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The raw wins.premium_amount helpers are dead code (Reports V2 PKG-B, D2 §4.2): every live surface reads the effective
 * sale premium through the switched server readers. No production file under src/ may import them.
 */
const SRC = join(__dirname, "..", "..");
function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (name !== "__tests__" && name !== "node_modules") yield* sources(path); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.spec\./.test(name)) yield path;
  }
}

describe("raw premium dead code has no production importer", () => {
  const files = [...sources(SRC)];
  it.each([
    ["leaderboardPremium", /from\s+["'][^"']*leaderboardPremium["']|import\(\s*["'][^"']*leaderboardPremium["']\s*\)/],
    ["AgentScorecardModal", /from\s+["'][^"']*AgentScorecardModal["']|import\(\s*["'][^"']*AgentScorecardModal["']\s*\)/],
  ])("%s", (name, pattern) => {
    expect(files.length).toBeGreaterThan(100);
    const importers = files.filter((f) => pattern.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f));
    expect(importers, `${name} importers`).toEqual([]);
  });
});
