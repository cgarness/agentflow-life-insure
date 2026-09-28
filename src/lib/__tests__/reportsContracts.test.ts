/**
 * Source contracts for the Reports rebuild — cheap, static guarantees that fail CI the moment a
 * security or accuracy property is edited away.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_DATA_ACCESS, DEFAULT_FEATURES, DEFAULT_PAGES } from "@/config/permissionDefaults";

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MIGRATION = "supabase/migrations/20260928120000_reports_secure_scoped_rpcs.sql";
const ROLLBACK = "supabase/migrations/rollback/20260928120000_reports_secure_scoped_rpcs.rollback.sql";
const OPS = ["supabase/ops/reports_disable.sql", "supabase/ops/reports_enable.sql"];
const PUBLIC_RPCS = [
  "get_report_scope()",
  "get_report_call_summary(date, date, uuid)",
  "get_report_call_volume(date, date, uuid)",
  "get_report_disposition_breakdown(date, date, uuid)",
  "get_report_campaign_performance(date, date, uuid)",
  "get_report_lead_source_performance(date, date, uuid)",
];
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, "");
/** Code only: block and line comments removed (explanations may name what the code must not do). */
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
const gitBlobSha = (content: string) =>
  createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");

describe("migration security contract", () => {
  const sql = stripSqlComments(read(MIGRATION));

  it("every function is SECURITY DEFINER-or-helper with search_path pinned to pg_catalog, pg_temp", () => {
    const bodies = sql.split(/CREATE FUNCTION /).slice(1);
    expect(bodies.length).toBe(14);
    for (const b of bodies) expect(b).toMatch(/SET search_path = pg_catalog, pg_temp/);
    for (const name of PUBLIC_RPCS) {
      const fn = name.split("(")[0];
      const def = bodies.find((b) => b.startsWith(`public.${fn}(`))!;
      expect(def, fn).toMatch(/STABLE\s+SECURITY DEFINER/);
    }
  });

  it("public RPCs take no organization or time-zone parameter", () => {
    for (const m of sql.matchAll(/CREATE FUNCTION public\.(get_report_\w+)\(([^)]*)\)/g)) {
      expect(m[2], m[1]).not.toMatch(/org|time_?zone/i);
    }
  });

  it("revokes PUBLIC/anon on every public RPC and grants only authenticated + service_role", () => {
    for (const rpc of PUBLIC_RPCS) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${rpc}`);
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc.replace(/[()]/g, "\\$&")}\\s+TO authenticated, service_role;`));
    }
    expect(sql).not.toMatch(/GRANT[^;]*\banon\b/);
    expect(sql).not.toMatch(/GRANT[^;]*\bPUBLIC\b/);
  });

  it("seals the four legacy rpc_report_* functions from PUBLIC, anon and authenticated", () => {
    for (const legacy of ["rpc_report_call_summary", "rpc_report_call_volume_timeseries", "rpc_report_campaign_performance", "rpc_report_disposition_breakdown"]) {
      expect(sql).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${legacy}\\(uuid, timestamptz, timestamptz, uuid\\)\\s+FROM PUBLIC, anon, authenticated;`));
    }
  });

  it("never re-grants the legacy functions anywhere in rollback or recovery scripts", () => {
    for (const f of [ROLLBACK, ...OPS]) {
      expect(stripSqlComments(read(f)), f).not.toMatch(/GRANT[^;]*rpc_report/i);
    }
    expect(stripSqlComments(read(ROLLBACK))).toMatch(/REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
  });

  it("keeps the canonical Contacted rule: No Answer first, then > 45 s, then counts_as_contacted", () => {
    const facts = sql.slice(sql.indexOf("CREATE FUNCTION private.report_call_facts"));
    const noAnswer = facts.indexOf("= 'no answer' THEN false");
    const over45 = facts.indexOf("b.duration_seconds > 45 THEN true");
    const flag = facts.indexOf("WHEN b.counts_contacted THEN true");
    expect(noAnswer).toBeGreaterThan(0);
    expect(over45).toBeGreaterThan(noAnswer);
    expect(flag).toBeGreaterThan(over45);
    expect(sql).not.toMatch(/dnc_auto_add = true\)\) as is_contacted/i);
  });

  it("has no conversion-rate field", () => {
    expect(sql).not.toMatch(/conversion_rate/i);
  });
});

describe("server permission defaults mirror permissionDefaults.ts", () => {
  const sql = read(MIGRATION);
  const page = DEFAULT_PAGES.find((p) => p.name === "Reports")!;
  const feature = (name: string) => DEFAULT_FEATURES.flatMap((c) => c.features).find((f) => f.name === name)!;
  const scope = DEFAULT_DATA_ACCESS.find((d) => d.label === "Dashboard & Reports")!;

  for (const [roleKey, sqlRole] of [["agent", "Agent"], ["teamLeader", "Team Leader"]] as const) {
    it(`${sqlRole} defaults`, () => {
      const start = sql.indexOf(`p_role = '${sqlRole}'`);
      expect(start).toBeGreaterThan(0);
      const block = sql.slice(start);
      const line = block.split("\n").find((l) => l.includes("v_page :="))!;
      const expected =
        `v_page := ${page[roleKey]}; v_own := ${feature("View Own Reports")[roleKey]}; ` +
        `v_team := ${feature("View Team Reports")[roleKey]}; v_export := ${feature("Export Reports")[roleKey]}; ` +
        `v_scope := '${scope[roleKey]}';`;
      expect(line.trim()).toBe(expected);
    });
  }
});

describe("frontend data-path contract", () => {
  const queries = read("src/lib/reports-queries.ts");

  it("the query layer never fabricates zeros and never sends an organization", () => {
    const code = queries.slice(0, queries.indexOf("// ─── Legacy saved / scheduled report CRUD"));
    expect(code).not.toMatch(/\|\|\s*\[\]/);
    expect(code).not.toMatch(/\?\?\s*0\b/);
    expect(code).not.toMatch(/p_org_id/);
    expect(code).not.toMatch(/rpc_report_/);
  });

  it("the Reports page and sections read no raw table and no legacy RPC", () => {
    const files = ["src/pages/Reports.tsx", ...readdirSync(join(ROOT, "src/components/reports"))
      .filter((f) => f.endsWith(".tsx") && !["CustomReportBuilder.tsx", "ScheduledReportsModal.tsx"].includes(f))
      .map((f) => `src/components/reports/${f}`)];
    for (const f of files) {
      const src = stripTsComments(read(f));
      expect(src, f).not.toMatch(/@\/integrations\/supabase\/client/);
      expect(src, f).not.toMatch(/rpc_report_|\.from\(["']/);
      expect(src, f).not.toMatch(/downloadCSV|agent_scorecards|dialer_daily_stats/);
    }
  });

  it("Reports does not mount the non-functional saved/scheduled report features", () => {
    const page = read("src/pages/Reports.tsx");
    expect(page).not.toMatch(/CustomReportBuilder|ScheduledReportsModal/);
  });
});

describe("Dialer / Leaderboard boundary", () => {
  it("leaves Dialer-owned and permission files byte-identical to main", () => {
    expect(gitBlobSha(read("src/lib/report-utils.ts"))).toBe("9fa35b22a24648e5901a985d59f853288c049c57");
    expect(gitBlobSha(read("src/lib/supabase-dialer-stats.ts"))).toBe("8145b1950856ffbe397f299a15d5d9ff78e9b1f4");
    expect(gitBlobSha(read("src/hooks/usePermissions.ts"))).toBe("6789cc0e0208ffe1569c820c83b038b3b78e1ea5");
    expect(gitBlobSha(read("src/config/permissionDefaults.ts"))).toBe("9d61aa0d758c70dd9c031bd9e3e34d00dfda9050");
  });
});
