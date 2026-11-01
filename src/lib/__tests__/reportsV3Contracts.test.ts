/**
 * Static privilege-class contract for the Reports V2 (v3) SQL files (plan §2.7–§2.8). Cheap guarantees
 * that fail CI the moment a file is added without a class, a helper is created without its REVOKE, or a
 * grant appears outside its allowlist. The effective-privilege matrix itself runs in PostgreSQL
 * (scripts/run_reports_v3_tests.sh).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, "");

type PrivilegeClass = "C" | "E" | "W" | "R";

/** Planned PKG-A migrations by unique suffix (plan §2.7). Each is checked once it exists. */
const MIGRATION_CLASS: Record<string, PrivilegeClass> = {
  reports_v3_foundation: "C",
  reports_v3_sale_facts: "C",
  reports_v3_call_journey_helpers: "C",
  reports_v3_appointment_facts_stub: "C",
  reports_v3_state_helpers: "C",
  reports_v3_readers: "C",
  reports_v3_calls_campaign_lead_index: "C",
  reports_v3_release_enable: "E",
};
const OPS_CLASS: Record<string, PrivilegeClass> = {
  "reports_v3_enable.sql": "E",
  "reports_v3_disable.sql": "R",
  "reports_all_disable.sql": "R",
  "reports_v3_preflight.sql": "R",
  "reports_v3_readback.sql": "R",
};
/** The only migration that may build a KPI envelope directly; every other file uses the builders. */
const ENVELOPE_OWNER = "reports_v3_foundation";
const CONCURRENT_INDEX = "reports_v3_calls_campaign_lead_index";

const MIGRATIONS = "supabase/migrations";
const ROLLBACKS = "supabase/migrations/rollback";
const OPS = "supabase/ops";

interface SqlFile { path: string; suffix: string; cls: PrivilegeClass | undefined; sql: string }

const v3Files = (): SqlFile[] => {
  const files: SqlFile[] = [];
  for (const name of readdirSync(join(ROOT, MIGRATIONS))) {
    const m = /^\d{14}_(reports_v3_[a-z0-9_]+)\.sql$/.exec(name);
    if (!m) continue;
    const suffix = m[1].startsWith("reports_v3_release_enable") ? "reports_v3_release_enable" : m[1];
    files.push({ path: `${MIGRATIONS}/${name}`, suffix, cls: MIGRATION_CLASS[suffix], sql: read(`${MIGRATIONS}/${name}`) });
  }
  for (const name of readdirSync(join(ROOT, ROLLBACKS))) {
    if (/^\d{14}_reports_v3_[a-z0-9_]+\.rollback\.sql$/.test(name)) {
      files.push({ path: `${ROLLBACKS}/${name}`, suffix: name, cls: "C", sql: read(`${ROLLBACKS}/${name}`) });
    }
  }
  for (const name of readdirSync(join(ROOT, OPS))) {
    if (/^reports_v3_|^reports_all_disable/.test(name)) {
      files.push({ path: `${OPS}/${name}`, suffix: name, cls: OPS_CLASS[name], sql: read(`${OPS}/${name}`) });
    }
  }
  return files;
};

const TYPE_ALIASES: Record<string, string> = {
  int: "integer", int4: "integer", int8: "bigint", bool: "boolean", timestamptz: "timestamp with time zone",
  float8: "double precision", varchar: "character varying",
};
const normalizeType = (t: string) => {
  const s = t.trim().toLowerCase().replace(/\s+/g, " ");
  const array = s.endsWith("[]");
  const base = array ? s.slice(0, -2).trim() : s;
  return (TYPE_ALIASES[base] ?? base) + (array ? "[]" : "");
};
/** Split on top-level commas only. */
const splitTopLevel = (s: string) => {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
};
/** The balanced parenthesised text starting at `open`. */
const balanced = (s: string, open: number) => {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    if (s[i] === ")" && --depth === 0) return s.slice(open + 1, i);
  }
  throw new Error("unbalanced parentheses");
};

interface CreatedFunction { name: string; types: string[]; header: string }
const createdFunctions = (sql: string): CreatedFunction[] => {
  const out: CreatedFunction[] = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_]+\.[a-z0-9_]+)\s*\(/gi;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const params = balanced(sql, m.index + m[0].length - 1);
    const types = splitTopLevel(params).map((p) => {
      const noDefault = p.replace(/\s+DEFAULT\s+[\s\S]*$/i, "").replace(/\s*=\s*[\s\S]*$/, "").trim();
      return normalizeType(noDefault.split(/\s+/).slice(1).join(" "));
    });
    const bodyStart = sql.indexOf("AS $", m.index);
    out.push({ name: m[1].toLowerCase(), types, header: sql.slice(m.index, bodyStart) });
  }
  return out;
};
interface Revoke { name: string; types: string[]; roles: string[] }
const revokes = (sql: string): Revoke[] => {
  const out: Revoke[] = [];
  const re = /REVOKE\s+ALL\s+ON\s+FUNCTION\s+([a-z_]+\.[a-z0-9_]+)\s*\(([^)]*)\)\s+FROM\s+([^;]+);/gi;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    out.push({
      name: m[1].toLowerCase(),
      types: m[2].trim() ? splitTopLevel(m[2]).map(normalizeType) : [],
      roles: m[3].split(",").map((r) => r.trim().toLowerCase()).sort(),
    });
  }
  return out;
};
/** Every GRANT statement, including ones built inside string literals for dynamic SQL. */
const grants = (sql: string) => [...stripSqlComments(sql).matchAll(/\bGRANT\b[^;']*/gi)].map((m) => m[0]);

const SEALED_ROLES = ["anon", "authenticated", "public", "service_role"];

describe("Reports v3 SQL privilege classes", () => {
  const files = v3Files();

  it("finds the PKG-A foundation and classifies every v3 SQL file", () => {
    expect(files.some((f) => f.suffix === ENVELOPE_OWNER)).toBe(true);
    for (const f of files) expect(f.cls, `${f.path} has no privilege class`).toBeDefined();
  });

  it("class C files grant nothing and create every function sealed with a pinned search_path", () => {
    for (const f of files.filter((x) => x.cls === "C")) {
      const sql = stripSqlComments(f.sql);
      expect(grants(sql), f.path).toEqual([]);
      const created = createdFunctions(sql);
      const revoked = revokes(sql);
      for (const fn of created) {
        expect(fn.header, `${f.path}: ${fn.name} search_path`).toMatch(/SET search_path = pg_catalog, pg_temp/);
        if (fn.name.startsWith("private.")) {
          expect(fn.header, `${f.path}: ${fn.name} must run with invoker rights`).not.toMatch(/SECURITY\s+DEFINER/i);
        }
        const match = revoked.find((r) => r.name === fn.name && r.types.join(",") === fn.types.join(","));
        expect(match, `${f.path}: ${fn.name}(${fn.types.join(", ")}) has no REVOKE ALL`).toBeDefined();
        expect(match!.roles, `${f.path}: ${fn.name} REVOKE roles`).toEqual(SEALED_ROLES);
      }
    }
  });

  it("PKG-A migrations refuse replay, never replace silently and take the short lock timeout", () => {
    for (const f of files.filter((x) => x.path.startsWith(`${MIGRATIONS}/`) && x.cls === "C")) {
      const sql = stripSqlComments(f.sql);
      expect(sql, f.path).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
      if (f.suffix !== CONCURRENT_INDEX) expect(sql.trimStart(), f.path).toMatch(/^SET LOCAL lock_timeout = '2s';/);
    }
    expect(stripSqlComments(files.find((f) => f.suffix === ENVELOPE_OWNER)!.sql)).toMatch(/refusing replay/);
  });

  it("no file grants to anon or PUBLIC, or grants any legacy rpc_report_* function", () => {
    for (const f of files) {
      for (const g of grants(f.sql)) {
        expect(g, f.path).not.toMatch(/\b(anon|PUBLIC)\b/i);
        expect(g, f.path).not.toMatch(/rpc_report_/i);
      }
    }
  });

  it("class R files only revoke or read", () => {
    for (const f of files.filter((x) => x.cls === "R")) expect(grants(f.sql), f.path).toEqual([]);
  });

  it("class E files grant EXECUTE to exactly authenticated and service_role", () => {
    for (const f of files.filter((x) => x.cls === "E")) {
      const found = grants(f.sql);
      expect(found.length, f.path).toBeGreaterThan(0);
      for (const g of found) expect(g.replace(/\s+/g, " "), f.path).toMatch(/^GRANT EXECUTE ON FUNCTION \S+ TO authenticated, ?service_role$/i);
    }
  });

  it("only the foundation builds KPI envelopes directly; every reader uses the BC4 builders", () => {
    for (const f of files.filter((x) => x.suffix !== ENVELOPE_OWNER)) {
      expect(stripSqlComments(f.sql), f.path).not.toMatch(/report_v3_metric\s*\(/);
      expect(stripSqlComments(f.sql), f.path).not.toMatch(/report_v3_evaluate\s*\(/);
    }
  });
});

describe("Reports v3 foundation", () => {
  const foundation = readdirSync(join(ROOT, MIGRATIONS)).find((n) => n.endsWith("_reports_v3_foundation.sql"));
  const sql = stripSqlComments(read(`${MIGRATIONS}/${foundation}`));

  it("creates exactly the fourteen private helpers, with invoker rights", () => {
    expect(createdFunctions(sql).map((f) => `${f.name}(${f.types.join(",")})`).sort()).toEqual([
      "private.report_v3_basis_flags()",
      "private.report_v3_envelope(text,text,text,uuid,text,text,date,date,timestamp with time zone,timestamp with time zone)",
      "private.report_v3_evaluate(integer,text,numeric,numeric,jsonb)",
      "private.report_v3_kpi_codes()",
      "private.report_v3_kpi_ids(text)",
      "private.report_v3_median(integer,numeric,numeric,jsonb,text,jsonb)",
      "private.report_v3_metric(integer,text,numeric,numeric,numeric,jsonb,jsonb,text,jsonb)",
      "private.report_v3_metric_registry()",
      "private.report_v3_rate(integer,numeric,numeric,jsonb,jsonb,text,jsonb)",
      "private.report_v3_ratio(integer,numeric,numeric,jsonb,jsonb,text,jsonb)",
      "private.report_v3_reason_codes()",
      "private.report_v3_reason_kind(text)",
      "private.report_v3_sold_window(date,date,date)",
      "private.report_v3_total(integer,numeric,jsonb,text,jsonb)",
    ]);
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it("pins the 15 v2 readers and 12 closure helpers before creating anything", () => {
    const preflight = sql.slice(0, sql.indexOf("CREATE FUNCTION"));
    expect(preflight.match(/\('(?:public|private)\.[a-z0-9_]+\([^)]*\)', '[0-9a-f]{32}'/g)).toHaveLength(27);
  });

  it("holds the closed 29-code reason registry in precedence order", () => {
    const body = sql.slice(sql.indexOf("FUNCTION private.report_v3_reason_codes()"));
    const list = body.slice(body.indexOf("ARRAY[") + 6, body.indexOf("]::text[]"));
    const codes = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(codes).toHaveLength(29);
    expect(codes[0]).toBe("evidence_not_captured");
    expect(codes.slice(5, 14)).toContain("premium_not_entered");
    expect(codes[28]).toBe("panel_not_loaded");
    expect(new Set(codes).size).toBe(29);
  });

  it("registers exactly 23 KPIs, with percentages exactly 8, 17, 18, 19 and 38", () => {
    const registry = JSON.parse(/\$registry\$([\s\S]*?)\$registry\$/.exec(sql)![1]) as Array<{ id: number; unit: string; cohort_30d: boolean }>;
    expect(registry.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 21, 24, 25, 34, 38]);
    expect(registry.filter((r) => r.unit === "percent").map((r) => r.id)).toEqual([8, 17, 18, 19, 38]);
    expect(registry.filter((r) => r.cohort_30d).map((r) => r.id)).toEqual([12, 18, 19]);
  });
});

describe("Reports v3 sale facts", () => {
  const saleFacts = readdirSync(join(ROOT, MIGRATIONS)).find((n) => n.endsWith("_reports_v3_sale_facts.sql"));
  const sql = stripSqlComments(read(`${MIGRATIONS}/${saleFacts}`));

  it("creates exactly the five sale-fact helpers, with invoker rights", () => {
    expect(createdFunctions(sql).map((f) => `${f.name}(${f.types.join(",")})`).sort()).toEqual([
      "private.report_v3_production(uuid,uuid[],date,date,timestamp with time zone)",
      "private.report_v3_production_kpis(jsonb)",
      "private.report_v3_sale_facts(uuid,uuid[],date,date)",
      "private.report_v3_sale_premium(public.wins,numeric)",
      "private.report_v3_stored_without_sale(uuid)",
    ]);
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it("takes every monthly premium from the shared choke point, with no second premium formula", () => {
    expect(sql.match(/private\.performance_sale_monthly\(p_win, p_client\)/g)).toHaveLength(1);
    expect(sql).not.toMatch(/performance_monthly\(\s*p_/);
    expect(sql.match(/private\.report_v3_sale_premium\(w, c\.premium\)/g)).toHaveLength(1);
  });

  it("pins the live premium choke point it delegates to", () => {
    for (const pin of ["7e7063317a34f37d90faf14914b98827", "deb0d3330a432cd4324ea422856d67a0", "51e06b46a13c3a8eec4d672bec158376"]) {
      expect(sql).toContain(`'${pin}'`);
    }
  });
});

describe("Reports v3 call and journey helpers", () => {
  const callJourney = readdirSync(join(ROOT, MIGRATIONS)).find((n) => n.endsWith("_reports_v3_call_journey_helpers.sql"));
  const sql = stripSqlComments(read(`${MIGRATIONS}/${callJourney}`));
  const body = (name: string) => {
    const start = sql.indexOf(`CREATE FUNCTION private.${name}(`);
    return sql.slice(start, sql.indexOf("$$;", sql.indexOf("AS $$", start)));
  };

  it("creates exactly the fourteen call and journey helpers, with invoker rights", () => {
    expect(createdFunctions(sql).map((f) => f.name).sort()).toEqual([
      "private.report_v3_call_counts", "private.report_v3_call_facts", "private.report_v3_call_kpis",
      "private.report_v3_client_identity_key", "private.report_v3_contact_identity", "private.report_v3_contact_predicate",
      "private.report_v3_first_sales", "private.report_v3_identity_numbers", "private.report_v3_identity_receipts",
      "private.report_v3_journey_facts", "private.report_v3_journey_kpis", "private.report_v3_journey_members",
      "private.report_v3_local_day_start", "private.report_v3_sale_call_links",
    ]);
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it("never resolves an identity from a phone number (numbers are exclusion evidence only)", () => {
    expect(body("report_v3_contact_identity")).not.toMatch(/phone/i);
    expect(body("report_v3_client_identity_key")).not.toMatch(/phone/i);
    expect(body("report_v3_first_sales")).not.toMatch(/phone/i);
    // Numbers are compared only inside the journey gates, member by member.
    for (const m of body("report_v3_journey_members").matchAll(/n\.phone_last10 = c\.phone_last10/g)) expect(m.index).toBeGreaterThan(0);
    expect(body("report_v3_journey_facts")).not.toMatch(/phone_last10 =/);
  });

  it("keeps the v2 call reader as the single source of call rows and the stub link reader empty", () => {
    expect(body("report_v3_call_facts")).toMatch(/private\.report_call_facts\(p_org, p_start, p_end, NULL\)/);
    expect(body("report_v3_sale_call_links")).toMatch(/WHERE false/);
  });
});
