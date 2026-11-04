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
  reports_v3_sale_premium_basis: "W",  // PKG-B …21 (D2 §3.7)
  reports_v3_sale_call_links: "C",  // PKG-C …32 (D3 §3.6)
};
/** Class W (plan §2.8, X8): the only GRANTs a writer-enable file may contain. */
const W_ALLOWLIST: Record<string, string[]> = {
  reports_v3_sale_premium_basis: [
    "GRANT EXECUTE ON FUNCTION public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text) TO authenticated",
    "GRANT EXECUTE ON FUNCTION public.get_client_policy_sale_premiums(uuid) TO authenticated",
  ],
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
/** Class C files that replace PKG-A stubs under exact preimage guards (each pinned in its own describe). */
const PREIMAGE_REPLACERS = ["reports_v3_sale_call_links", "20261104120032_reports_v3_sale_call_links.rollback.sql"];
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
    // OUT parameters are not part of a function's identity (its REVOKE names only the input types).
    const types = splitTopLevel(params).map((p) => p.trim()).filter((p) => !/^OUT\s/i.test(p)).map((p) => {
      const noMode = p.replace(/^(?:IN|INOUT|VARIADIC)\s+/i, "");
      const noDefault = noMode.replace(/\s+DEFAULT\s+[\s\S]*$/i, "").replace(/\s*=\s*[\s\S]*$/, "").trim();
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
      // A later package's v3-only window (…32) replaces PKG-A stubs behind md5 preimage guards (pinned below).
      if (!PREIMAGE_REPLACERS.includes(f.suffix)) expect(sql, f.path).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
      if (f.suffix !== CONCURRENT_INDEX) expect(sql.trimStart(), f.path).toMatch(/^SET LOCAL lock_timeout = '2s';/);
    }
    expect(stripSqlComments(files.find((f) => f.suffix === ENVELOPE_OWNER)!.sql)).toMatch(/refusing replay/);
  });

  it("no file grants to anon or PUBLIC, or grants any legacy rpc_report_* function", () => {
    for (const f of files) {
      for (const g of grants(f.sql)) {
        // The grantee list (after TO): a schema-qualified public.function name is not a grant to PUBLIC.
        expect(g, f.path).not.toMatch(/\bTO\b[\s\S]*\b(anon|PUBLIC)\b/i);
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

  it("class W files grant exactly their allowlist, to authenticated only", () => {
    const w = files.filter((x) => x.cls === "W");
    for (const f of w) {
      expect(W_ALLOWLIST[f.suffix], `${f.path} has no class W allowlist`).toBeDefined();
      expect(grants(f.sql).map((g) => g.replace(/\s+/g, " ").trim()), f.path).toEqual(W_ALLOWLIST[f.suffix]);
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
  const raw = read(`${MIGRATIONS}/${callJourney}`);
  const sql = stripSqlComments(raw);
  const body = (name: string) => {
    const start = sql.indexOf(`CREATE FUNCTION private.${name}(`);
    return sql.slice(start, sql.indexOf("$$;", sql.indexOf("AS $$", start)));
  };
  const rawBody = (name: string) => {
    const start = raw.indexOf(`CREATE FUNCTION private.${name}(`);
    return raw.slice(start, raw.indexOf("$$;", raw.indexOf("AS $$", start)));
  };

  it("creates exactly the eighteen call and journey helpers, with invoker rights", () => {
    expect(createdFunctions(sql).map((f) => f.name).sort()).toEqual([
      "private.report_v3_attempt_kpis", "private.report_v3_call_counts", "private.report_v3_call_facts",
      "private.report_v3_call_kpis", "private.report_v3_client_identity_key", "private.report_v3_contact_identity",
      "private.report_v3_contact_predicate", "private.report_v3_duplicates_excluded", "private.report_v3_first_sales",
      "private.report_v3_identity_numbers", "private.report_v3_identity_receipts", "private.report_v3_journey_facts",
      "private.report_v3_journey_facts_by", "private.report_v3_journey_kpis", "private.report_v3_journey_members",
      "private.report_v3_journey_rows", "private.report_v3_local_day_start", "private.report_v3_sale_call_links",
    ]);
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it("never resolves an identity from a phone number (numbers are exclusion evidence only)", () => {
    expect(body("report_v3_contact_identity")).not.toMatch(/phone/i);
    expect(body("report_v3_client_identity_key")).not.toMatch(/phone/i);
    expect(body("report_v3_first_sales")).not.toMatch(/phone/i);
    // Numbers are compared only inside the journey gates (each member's own numbers), never in the counts.
    expect(body("report_v3_journey_rows").match(/n\.phone_last10 = c\.phone_last10/g)).toHaveLength(1);
    for (const name of ["report_v3_journey_members", "report_v3_journey_facts_by", "report_v3_journey_facts"]) {
      expect(body(name), name).not.toMatch(/phone_last10 =/);
    }
  });

  it("takes call rows only from the shared call-row block (the calls suite proves it equals the pinned v2 rows)", () => {
    expect(body("report_v3_call_facts")).not.toContain("private.report_call_facts(");
    expect(rawBody("report_v3_call_facts")).toContain("-- @call-rows begin:");
    expect(rawBody("report_v3_journey_rows")).toContain("-- @call-rows begin:");
    expect(body("report_v3_journey_members")).toContain("private.report_v3_journey_rows(");
    expect(body("report_v3_journey_facts")).toContain("private.report_v3_journey_facts_by(");
    expect(body("report_v3_sale_call_links")).toMatch(/WHERE false/);
  });
});

describe("Reports v3 appointment facts stub", () => {
  const stub = readdirSync(join(ROOT, MIGRATIONS)).find((n) => n.endsWith("_reports_v3_appointment_facts_stub.sql"));
  const sql = stripSqlComments(read(`${MIGRATIONS}/${stub}`));
  const start = sql.indexOf("AS $$");
  const body = sql.slice(start, sql.indexOf("$$;", start));

  it("creates exactly the final X1 signature, as a stable sql helper with invoker rights", () => {
    const created = createdFunctions(sql);
    expect(created.map((f) => `${f.name}(${f.types.join(",")})`)).toEqual([
      "private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamp with time zone,timestamp with time zone,text,timestamp with time zone)",
    ]);
    expect(created[0].header).toMatch(/LANGUAGE sql\s+STABLE\s/);
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it("reads no table and builds the five envelopes in registry order, only through the builders", () => {
    expect(body).not.toMatch(/\bpublic\./);
    expect(new Set([...body.matchAll(/private\.([a-z0-9_]+)/g)].map((m) => m[1]))).toEqual(
      new Set(["report_v3_ratio", "report_v3_total", "report_v3_rate"]),
    );
    for (const call of [
      "private.report_v3_ratio(12, 0, 0, NULL, NULL, 'evidence_not_captured')",
      "private.report_v3_total(15, 0, NULL, 'evidence_not_captured')",
      "private.report_v3_total(16, 0, NULL, 'evidence_not_captured')",
      "private.report_v3_rate(17, 0, 0, NULL, NULL, 'evidence_not_captured')",
      "private.report_v3_rate(18, 0, 0, NULL, NULL, 'evidence_not_captured')",
    ]) expect(body).toContain(call);
    expect([...body.matchAll(/report_v3_(?:ratio|total|rate)\((\d+),/g)].map((m) => Number(m[1]))).toEqual([12, 15, 16, 17, 18]);
  });

  it("adds no appointment evidence: no table, trigger, index, policy or data write", () => {
    expect(sql).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|TRIGGER|INDEX|POLICY)|INSERT\s+INTO|DELETE\s+FROM|ALTER\s+TABLE|\bUPDATE\s+[a-z]/i);
  });

  it("refuses replay, and refuses to install over a changed registry or installed evidence", () => {
    const preflight = sql.slice(0, sql.indexOf("CREATE FUNCTION"));
    expect(preflight).toMatch(/refusing replay/);
    expect(preflight).toContain("private.report_v3_kpi_ids('sales_appointments') IS DISTINCT FROM ARRAY[12, 15, 16, 17, 18]");
    expect(preflight).toContain("private.report_v3_basis_flags() ->> 'appointment_evidence' IS DISTINCT FROM 'not_installed'");
  });
});

describe("Reports v3 state helpers", () => {
  const helpers = readdirSync(join(ROOT, MIGRATIONS)).find((n) => n.endsWith("_reports_v3_state_helpers.sql"));
  const sql = stripSqlComments(read(`${MIGRATIONS}/${helpers}`));
  const body = (name: string) => {
    const start = sql.indexOf(`CREATE FUNCTION private.${name}(`);
    return sql.slice(start, sql.indexOf("$$;", sql.indexOf("AS $$", start)));
  };

  it("creates exactly the classifier, the typed identity resolver and its key form, with invoker rights", () => {
    expect(createdFunctions(sql).map((f) => `${f.name}(${f.types.join(",")})`).sort()).toEqual([
      "private.report_v3_identity_states(uuid,text[])",
      "private.report_v3_identity_states_by_id(uuid,uuid[],uuid[])",
      "private.report_v3_state_classify(text)",
    ]);
    expect(body("report_v3_state_classify")).toMatch(/LANGUAGE sql\s+IMMUTABLE\s+PARALLEL SAFE\s/);
    expect(body("report_v3_identity_states_by_id")).toMatch(/LANGUAGE plpgsql\s+STABLE\s+PARALLEL RESTRICTED\s/);
    expect(body("report_v3_identity_states")).toMatch(/LANGUAGE plpgsql\s+STABLE\s/);
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it("pre-trims ASCII whitespace, never E'\\v', and classifies through the pinned, unchanged normalize_us_state", () => {
    const cls = body("report_v3_state_classify");
    expect(cls).toContain("btrim(coalesce(p_raw, ''), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13))");
    expect(sql).not.toMatch(/E'[^']*\\v/);
    expect(cls.match(/public\.normalize_us_state\(/g)).toHaveLength(1);
    expect(sql).toContain("md5(prosrc) = 'c80ff9ad87445693d84d0276c872ba83'");
    expect(sql).not.toMatch(/(?:CREATE|ALTER|GRANT|REVOKE)[^;]*FUNCTION\s+public\.normalize_us_state/i);
  });

  it("supports exactly 51 jurisdictions, DC included, and names the twelve unsupported codes", () => {
    const cls = body("report_v3_state_classify");
    const codes = (from: string, to: string) =>
      [...cls.slice(cls.indexOf(from), cls.indexOf(to)).matchAll(/'([A-Z]{2})'/g)].map((m) => m[1]);
    const supported = codes("ARRAY['AL'", "AS supported");
    expect(supported).toHaveLength(51);
    expect(new Set(supported).size).toBe(51);
    expect(supported).toContain("DC");
    expect(codes("ARRAY['PR'", "AS unsupported_codes")).toEqual(["PR", "GU", "VI", "AS", "MP", "UM", "FM", "MH", "PW", "AA", "AE", "AP"]);
  });

  it("never reads a phone number and pins every table it reads to the caller's organization", () => {
    expect(sql).not.toMatch(/phone/i);
    const resolver = body("report_v3_identity_states_by_id");
    const reads = [...resolver.matchAll(/(?:FROM|JOIN)\s+(?:public|private)\.[a-z_]+\s+([a-z][a-z0-9_]*)\b/g)];
    expect(reads.length).toBe(9);
    for (const m of reads) {
      const rest = resolver.slice(m.index! + m[0].length);
      const end = rest.search(/\bJOIN\b|\bUNION\b|\bGROUP BY\b|\)\s*,/);
      const clause = end < 0 ? rest : rest.slice(0, end);
      expect(clause, `${m[0]} is not pinned to the organization`).toMatch(new RegExp(`(?<![a-z_.])${m[1]}\\.organization_id = \\$1(?![0-9])`));
    }
    // Every table is read by the typed resolver's one statement, whose $1 is bound to p_org.
    const statements = [...resolver.matchAll(/EXECUTE \$q\$([\s\S]*?)\$q\$ (?:INTO [a-z_, ]+ )?USING ([a-z_, ]+);/g)];
    expect(statements).toHaveLength(1);
    expect(statements[0][2].trim()).toMatch(/^p_org, /);
    // The key form reads no table: it parses its keys, then reads the typed resolver for the same organization.
    const keyForm = body("report_v3_identity_states");
    const keyStatements = [...keyForm.matchAll(/EXECUTE \$q\$([\s\S]*?)\$q\$ (?:INTO [a-z_, ]+ )?USING ([a-z_, ]+);/g)];
    expect(keyStatements).toHaveLength(1);
    expect(keyForm).not.toMatch(/(?:FROM|JOIN)\s+(?:public|private)\.[a-z_]+\s+[a-z]/);
    expect(keyForm).toContain("FROM private.report_v3_identity_states_by_id(p_org, v_leads, v_clients) s");
  });

  it("builds the private lineage index transactionally and changes no RLS setting or policy", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS report_v3_lineage_original_lead ON private\.dialer_conversion_lineage \(organization_id, original_lead_id\);/,
    );
    expect(sql).not.toMatch(/CONCURRENTLY/i);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY|\bPOLICY\b/i);
  });
});

describe("Reports v3 readers", () => {
  const readersFile = readdirSync(join(ROOT, MIGRATIONS)).find((n) => n.endsWith("_reports_v3_readers.sql"));
  const readersRaw = read(`${MIGRATIONS}/${readersFile}`);
  const sql = stripSqlComments(readersRaw);
  const body = (name: string) => {
    const start = sql.indexOf(`CREATE FUNCTION ${name}(`);
    return sql.slice(start, sql.indexOf("$$;", sql.indexOf("AS $$", start)));
  };
  const rawReader = (name: string) => {
    const start = readersRaw.indexOf(`CREATE FUNCTION ${name}(`);
    return readersRaw.slice(start, readersRaw.indexOf("END $$;", start));
  };
  const WINDOWED = [
    "summary", "journey", "sales_appointments", "state_breakdown",
    "call_volume", "disposition_breakdown", "campaign_calls", "lead_source_calls",
  ];
  const CALL_READERS = ["call_volume", "disposition_breakdown", "campaign_calls", "lead_source_calls"];

  it("creates exactly the nine public readers and five private helpers", () => {
    expect(createdFunctions(sql).map((f) => `${f.name}(${f.types.join(",")})`).sort()).toEqual([
      "private.report_v3_agent_call_stats(uuid,uuid[],timestamp with time zone,timestamp with time zone)",
      "private.report_v3_credit_map(text)",
      "private.report_v3_roster(uuid,uuid[],uuid,uuid[])",
      "private.report_v3_session_quality(uuid,timestamp with time zone,timestamp with time zone,uuid[])",
      "private.report_v3_summary_metrics(jsonb,jsonb,numeric,jsonb,numeric,jsonb)",
      "public.get_report_scope_v3(text)",
      ...WINDOWED.map((r) => `public.get_report_${r}_v3(date,date,uuid,text)`),
    ].sort());
  });

  it("makes every reader a stable plpgsql definer that takes no organization, time zone or as_of", () => {
    for (const fn of createdFunctions(sql).filter((f) => f.name.startsWith("public."))) {
      expect(fn.header, fn.name).toMatch(/LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = pg_catalog, pg_temp/);
      expect(fn.header, fn.name).not.toMatch(/p_org|p_organization|p_time_zone|p_as_of/);
    }
  });

  it("resolves access on the server before the window, and builds meta through the v3 envelope", () => {
    const scope = body("public.get_report_scope_v3");
    expect(scope).toContain("private.report_access_v2(p_requested_scope, NULL)");
    expect(scope).not.toContain("private.report_window(");
    for (const r of WINDOWED) {
      const b = body(`public.get_report_${r}_v3`);
      const access = b.indexOf("private.report_access_v2(p_requested_scope, p_agent_id)");
      const window = b.indexOf("private.report_window(a.org_id, p_start_date, p_end_date)");
      expect(access, r).toBeGreaterThan(0);
      expect(window, r).toBeGreaterThan(access);
      expect(b.indexOf(`private.report_v3_envelope('${r}'`), r).toBeGreaterThan(window);
    }
  });

  it("keeps the call readers call-only, on the v3 attempt population", () => {
    for (const r of CALL_READERS) {
      const b = body(`public.get_report_${r}_v3`);
      expect(b, r).not.toMatch(/polic|premium|leads_dialed|contacted_leads|converted|attribution_unavailable|contact_rate_pct|round\(/i);
      expect(rawReader(`public.get_report_${r}_v3`), r).toContain("-- @call-rows begin:");
      expect(b, r).not.toContain("private.report_call_facts(");
      expect(b, r).toContain("$q$ INTO v_body USING a.org_id, w.start_at, w.end_at, a.agent_ids");
      expect(b, r).toContain("private.report_v3_duplicates_excluded(a.org_id, a.agent_ids, w.start_at, w.end_at)");
    }
  });

  it("names campaigns only through report_visible_campaigns", () => {
    // The shared call-row block joins campaigns for the campaign id only, never a name or type.
    const callRows = / {2}-- @call-rows begin:[\s\S]*? {2}-- @call-rows end\n/;
    const block = readersRaw.match(callRows)![0];
    expect(stripSqlComments(block)).not.toMatch(/\b(?:cmp|k)\.(?:name|type)\b/);
    for (const r of WINDOWED) {
      const b = stripSqlComments(rawReader(`public.get_report_${r}_v3`).replace(callRows, ""));
      if (b.includes("public.campaigns")) {
        expect(b, r).toContain("private.report_visible_campaigns(a.org_id)");
        expect(b, r).toMatch(/campaign_class = 'visible'/);
      }
    }
  });

  it("passes now() to the appointment stub and re-verifies the 27 v2 and closure pins first", () => {
    expect(body("public.get_report_sales_appointments_v3")).toMatch(/report_v3_appointment_facts\([^;]*w\.time_zone, now\(\)\)/);
    const preflight = sql.slice(0, sql.indexOf("CREATE FUNCTION"));
    expect(preflight.match(/\('(?:public|private)\.[a-z0-9_]+\([^)]*\)', '[0-9a-f]{32}'/g)).toHaveLength(27);
    expect(preflight).toMatch(/refusing replay/);
  });
});

describe("Reports v3 shared call blocks and planned statements", () => {
  const files = readdirSync(join(ROOT, MIGRATIONS))
    .filter((n) => /_reports_v3_(call_journey_helpers|state_helpers|readers)\.sql$/.test(n))
    .map((n) => read(`${MIGRATIONS}/${n}`));
  const regions = (marker: string) =>
    files.flatMap((f) => [...f.matchAll(new RegExp(`  -- @${marker} begin:[\\s\\S]*?  -- @${marker} end\\n`, "g"))].map((m) => m[0]));

  it("copies each shared block byte for byte wherever it appears", () => {
    // call-rows: call facts, journey rows, summary, state and the four call readers; pointers: call facts, journey
    // rows, summary and state; per-call identity: call facts, journey rows and summary.
    for (const [marker, n] of [["call-rows", 8], ["call-pointers", 4], ["call-identity", 3]] as const) {
      const found = regions(marker);
      expect(found, marker).toHaveLength(n);
      for (const r of found) expect(r, marker).toBe(found[0]);
    }
  });

  it("runs every dynamic statement as constant text with bound parameters, never as built SQL", () => {
    let statements = 0;
    for (const f of files) {
      const code = stripSqlComments(f);
      // A PL/pgSQL EXECUTE statement starts its line (optionally after RETURN QUERY).
      for (const m of code.matchAll(/(?:^|\n)[ \t]*(?:RETURN QUERY[ \t]+)?EXECUTE\b/g)) {
        const next = code.slice(m.index! + m[0].length).trimStart();
        expect(next.startsWith("$q$"), next.slice(0, 40)).toBe(true);
        const close = next.indexOf("$q$", 3);
        expect(next.slice(close + 3).trimStart(), next.slice(0, 40)).toMatch(/^(?:INTO [a-z_, ]+ )?USING /);
        statements += 1;
      }
    }
    // Call facts, receipts, numbers and journey rows (…12); the resolver's two (…14); summary, state and the four
    // call readers (…15).
    expect(statements).toBe(12);
  });
});

describe("Reports v3 calls index", () => {
  const indexFile = readdirSync(join(ROOT, MIGRATIONS)).find((n) => n.endsWith("_reports_v3_calls_campaign_lead_index.sql"));
  const sql = stripSqlComments(read(`${MIGRATIONS}/${indexFile}`)).trim();

  it("holds exactly the one concurrent index statement, outside any transaction control", () => {
    expect(sql).toBe(
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS report_v3_calls_org_campaign_lead ON public.calls(organization_id, campaign_lead_id, created_at);",
    );
  });
});

describe("Reports v3 performance acceptance and differential evidence", () => {
  const workflow = read(".github/workflows/reports-backend.yml");
  const perf = read("supabase/tests/reports_v3_performance.sql");
  const manifest = JSON.parse(read("supabase/tests/reference/reports_v3_reference_manifest.json"));
  const job = (name: string) => {
    const start = workflow.indexOf(`\n  ${name}:\n`);
    expect(start, name).toBeGreaterThan(0);
    const next = workflow.slice(start + 1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
    return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
  };
  const dispatchOnly = "if: github.event_name == 'workflow_dispatch' && inputs.performance_acceptance";

  it("measures no performance in the functional job; the two-run acceptance runs only when a manual dispatch selects it", () => {
    expect(job("postgres")).toContain("REPORTS_V3_PERF=0 bash scripts/run_reports_v3_tests.sh");
    expect(job("perf-acceptance")).toContain(dispatchOnly);
    expect(job("perf-negative-control")).toContain(dispatchOnly);
    expect(job("perf-verdict")).toContain("if: always() && github.event_name == 'workflow_dispatch' && inputs.performance_acceptance");
    expect(job("differential")).not.toContain("inputs.performance_acceptance");
  });

  it("runs acceptance twice on PostgreSQL 17.6 with 20 samples, the restart round and enforcement; both runs must pass", () => {
    const a = job("perf-acceptance");
    expect(a).toContain("image: postgres:17.6");
    expect(a).toContain("matrix:\n        run: [1, 2]");
    expect(a).toContain("REPORTS_V3_PERF_MODE: acceptance");
    expect(a).toContain("REPORTS_V3_PERF_SAMPLES: '20'");
    expect(a).toContain("REPORTS_V3_PERF_ENFORCE: '1'");
    expect(a).toContain("REPORTS_V3_RESTART_CMD: docker restart ${{ job.services.postgres.id }}");
    expect(a).toContain("timeout-minutes: 150\n");
    expect(job("perf-verdict")).toContain('aggregate --sha "$GITHUB_SHA"');
  });

  it("proves detection with a negative control and uploads every run's evidence even on failure", () => {
    const n = job("perf-negative-control");
    expect(n).toContain("REPORTS_V3_PERF_MODE: negative-control");
    expect(n).toContain("if bash scripts/run_reports_v3_perf_acceptance.sh; then echo '::error::the negative control did not fail'; exit 1; fi");
    expect(job("perf-verdict")).toContain("reports_v3_perf_verdict.py negative-control");
    for (const name of ["differential", "perf-acceptance", "perf-negative-control", "perf-verdict"]) {
      expect(job(name), name).toMatch(/upload-artifact@[0-9a-f]{40}\n {8}if: always\(\)/);
    }
  });

  it("keeps the 2 s and 4 s targets, the unchanged 8 s timeout and the 147-combination matrix", () => {
    expect(perf.match(/SET statement_timeout = '8s';/g)?.length).toBe(2);
    expect(perf).not.toMatch(/statement_timeout\s*=\s*'(?!8s'|0')/);
    expect(perf).toContain("CASE WHEN r.reader = 'journey' THEN 4000 ELSE 2000 END");
    expect(perf).toContain("current_setting('server_version_num')::integer = 170006");
    expect(perf).toContain("(SELECT count(*) FROM rt.perf_combos) = 147");
    expect(perf).toContain("p_samples >= 20");
  });

  it("pins the differential reference: the reviewed baseline, its sources, the one reference-only repair and the case inventory", () => {
    expect(manifest.baseline_commit).toBe("4236b8a3f8389d22c6cdf2c3e96815899cb92cd1");
    expect(manifest.sources.map((s: { path: string }) => s.path)).toEqual([
      "supabase/migrations/20261101000011_reports_v3_sale_facts.sql",
      "supabase/migrations/20261101000012_reports_v3_call_journey_helpers.sql",
      "supabase/migrations/20261101000014_reports_v3_state_helpers.sql",
      "supabase/migrations/20261101000015_reports_v3_readers.sql",
    ]);
    expect(manifest.reference_only_repair.from).toBe("ck.lead_id = substr(r.identity_key, 6)::uuid");
    expect(manifest.case_inventory.expected_totals).toEqual({ cases: 2136, payload: 1428, refusal: 708 });
    expect(manifest.case_inventory.retained_totals).toEqual({ state_resolver: 55, journey: 180, journey_by_agent: 120 });
    expect(manifest.case_inventory.scale_cases).toHaveLength(25);
    type ScaleCase = { reader: string; persona: number; scope: string; days: number | null; filter_agent: number | null; expected: string };
    const journeyScale = (manifest.case_inventory.scale_cases as ScaleCase[])
      .filter((c) => c.reader === "journey")
      .map((c) => `${c.persona}:${c.scope}:${c.days}:${c.filter_agent ?? "-"}:${c.expected}`);
    expect(journeyScale).toEqual([
      "0:agency:1:-:payload",
      "0:agency:30:-:payload",
      "0:agency:366:-:payload",
      "1:team:30:-:payload",
      "7:personal:366:-:payload",
      "0:agency:366:7:payload",
    ]);
    expect(manifest.approved_differences).toEqual(["kpi24-quality-a1"]);
  });

  it("compares the journey reader with the baseline at scale only on explicit opt-in, and never reports skipped cases as compared", () => {
    const dx = read("supabase/tests/reports_v3_differential.sql");
    const scale = dx.slice(dx.indexOf("-- @@differential-scale@@"));
    expect(scale).toContain("\\getenv dx_journey_scale REPORTS_V3_DX_JOURNEY_SCALE");
    expect(scale).toContain(":'dx_journey_scale' IN ('0', '1'), true);");
    expect(scale).toContain("WHEN 'all' THEN true ELSE e.reader <> 'journey' END");
    expect(scale).toContain("CASE :'dx_journey_mode' WHEN 'all' THEN '6/6' WHEN 'case' THEN '1/1' ELSE '0/0' END");
    expect(scale).toContain("journey reader cases NOT RUN (6 pinned; set REPORTS_V3_DX_JOURNEY_SCALE=1");
    expect(scale).toContain("'0:agency:1:-:payload 0:agency:30:-:payload 0:agency:366:-:payload 0:agency:366:7:payload 1:team:30:-:payload 7:personal:366:-:payload'");
    expect(scale).toContain("'journey_reader_cases'");
  });

  it("replaces the two unfinishable agency journey comparisons with a bounded exact comparison at divisor 50 (fixed before running)", () => {
    const dx = read("supabase/tests/reports_v3_differential.sql");
    const bounded = dx.slice(dx.indexOf("-- @@differential-bounded@@"));
    expect(dx.indexOf("-- @@differential-scale@@")).toBeLessThan(dx.indexOf("-- @@differential-bounded@@"));
    expect(bounded).toContain("SELECT rt.eq('bounded comparison: the scale fixture at divisor 50', (SELECT divisor FROM rt.perf_meta), 50);");
    expect(bounded).toContain("'10000|100|200|200|100|200'");
    expect(bounded).toContain("FROM rt.perf_meta m, (VALUES (30), (366)) v(days) ORDER BY v.days) x;");
    expect(bounded).toContain("'persona-0:agency:-:journey:30d=payload_equal,persona-0:agency:-:journey:366d=payload_equal'");
    expect(bounded).toContain("every difficult case is present in the bounded fixture");
    expect(bounded).toContain("'ORDER BY lower(r.name) DESC NULLS LAST, r.agent_id'");
    const runner = read("scripts/run_reports_v3_differential.sh");
    expect(runner).toContain("PGOPTIONS='-c rt.perf_divisor=50' brun -f \"$WORK/scale.sql\"");
    expect(runner).toContain("part2, part3 = rest.split(bounded)");
    const perf = read("supabase/tests/reports_v3_performance.sql");
    expect(perf).toContain("coalesce(nullif(current_setting('rt.perf_divisor', true), ''), '1')::integer AS divisor;");
    expect(perf).toContain("the size divisor is 1 (full size) or 50 (bounded comparison)', (SELECT divisor IN (1, 50) FROM rt.perf_meta), true);");
    expect(perf).toContain("WHEN 1 THEN '500000|5000|10000|10000|5000|10000'");
    // The performance gate measures only the full-size fixture.
    const measure = perf.slice(perf.indexOf("-- @@performance-measure@@"));
    expect(measure).toContain("performance measurement runs only on the full-size fixture (rt.perf_divisor = 1)', (SELECT divisor FROM rt.perf_meta), 1);");
  });

  it("checks the full-scale agency journey reader with independent assertions, invariants and planted-error controls (never a baseline claim)", () => {
    const dx = read("supabase/tests/reports_v3_differential.sql");
    const scale = dx.slice(dx.indexOf("-- @@differential-scale@@"), dx.indexOf("-- @@differential-bounded@@"));
    expect(scale).toContain("check_kind text NOT NULL CHECK (check_kind IN ('independent', 'invariant', 'control'))");
    // Independent expectations read base tables only, never the candidate's journey helpers.
    const buyers = scale.slice(scale.indexOf("CREATE FUNCTION rt.jx_first_buyers"), scale.indexOf("-- Every check for one agency"));
    expect(buyers).toContain("FROM public.wins w JOIN public.clients c");
    expect(buyers).not.toMatch(/report_v3_|rtref\./);
    const checks = scale.slice(scale.indexOf("CREATE FUNCTION rt.jx_checks"), scale.indexOf("SET statement_timeout = 0;\nBEGIN ISOLATION LEVEL REPEATABLE READ;\nSELECT rt.dx_grants(true);\nCREATE TEMP TABLE jx_payloads"));
    expect(checks).not.toMatch(/private\.report_v3_|rtref\./);
    expect(scale).toContain("('agency 30 days', 0, 'agency', m.end_date - 29, m.end_date, NULL::uuid)");
    expect(scale).toContain("('agency 366 days', 0, 'agency', m.end_date - 365, m.end_date, NULL::uuid)");
    expect(scale).toContain("'planted KPI 14 eligible + 1 is caught'");
    expect(scale).toContain("'planted credit moved between two agent rows is caught'");
    expect(scale).toContain("(not a baseline comparison)");
  });

  it("verifies one pinned journey case in isolation: exact selector, bounded statement, never counted unless it compared equal", () => {
    const dx = read("supabase/tests/reports_v3_differential.sql");
    const scale = dx.slice(dx.indexOf("-- @@differential-scale@@"));
    expect(scale).toContain("\\getenv dx_journey_case REPORTS_V3_DX_JOURNEY_CASE");
    expect(scale).toContain("the journey case selector names exactly one pinned journey case");
    expect(scale).toContain("the journey case selector and the all-cases switch are exclusive");
    expect(scale).toContain("a selected journey case has a deadline of 1 to 340 minutes");
    expect(scale).toContain("SELECT set_config('statement_timeout', CASE WHEN :'dx_journey_mode' = 'case' THEN (:'dx_case_deadline'::int * 60000)::text ELSE '0' END, true);");
    expect(scale).toContain("WHEN 'case' THEN 'case ' || :'dx_journey_case' || ' compared'");
    const runner = read("scripts/run_reports_v3_differential.sh");
    expect(runner).toContain("^[0-9]+:(agency|team|personal):[0-9]+:(-|[0-9]+)$");
    expect(runner).toContain("REPORTS_V3_DX_CASE_DEADLINE_MINUTES <= 340");
    const j = job("journey-comparison");
    expect(j).toContain("if: github.event_name == 'workflow_dispatch' && inputs.journey_comparisons");
    expect(j).toContain("image: postgres:17.6");
    expect(j).toContain("timeout-minutes: 350\n");
    expect(j).toContain("fail-fast: false");
    expect(j).toContain("case: ['0:agency:30:-', '0:agency:366:-']");
    expect(j).toContain("REPORTS_V3_DX_CASE_DEADLINE_MINUTES: '320'");
    expect(j).toContain("if: always()");
    expect(workflow).toContain("group: reports-backend-${{ github.ref }}${{ inputs.journey_comparisons && '-journey' || '' }}");
    expect(job("postgres")).toContain("if: ${{ !inputs.journey_comparisons }}");
    expect(job("differential")).toContain("if: ${{ !inputs.journey_comparisons }}");
    expect(job("perf-acceptance")).toContain("inputs.performance_acceptance && !inputs.journey_comparisons");
  });
});

describe("PKG-B sale premium corrections (D2 §3.3-§3.7): …20 and its rollback are class C", () => {
  const FORWARD = `${MIGRATIONS}/20261104120020_policy_sale_premium_corrections.sql`;
  const ROLLBACK = `${ROLLBACKS}/20261104120020_policy_sale_premium_corrections.rollback.sql`;
  const forward = stripSqlComments(read(FORWARD));
  const rollback = stripSqlComments(read(ROLLBACK));

  it("is numbered after every PKG-A file and above the production head 20261103191631; …21 follows it", () => {
    const versions = readdirSync(join(ROOT, MIGRATIONS)).filter((n) => /_reports_v3_|_policy_sale_premium_corrections/.test(n)).sort();
    const pkgB = ["20261104120020_policy_sale_premium_corrections.sql", "20261104120021_reports_v3_sale_premium_basis.sql"];
    const firstB = versions.indexOf(pkgB[0]);
    expect(versions.slice(firstB, firstB + 2)).toEqual(pkgB);
    expect(versions.slice(0, firstB).every((v) => v < "20261104120020")).toBe(true);
    expect(versions.slice(firstB + 2).every((v) => v >= "20261104120030")).toBe(true);
    expect(Number("20261104120020")).toBeGreaterThan(20261103191631);
  });

  it("grants nothing, in the migration or its rollback", () => {
    expect(grants(forward)).toEqual([]);
    expect(grants(rollback)).toEqual([]);
  });

  it("creates every new function sealed with a pinned search_path; private helpers run with invoker rights", () => {
    const created = createdFunctions(forward).filter((fn) => fn.name !== "private.performance_sale_monthly");
    expect(created.map((fn) => fn.name).sort()).toEqual([
      "private.guard_policy_sale_premium_correction", "private.policy_sale_book_monthly", "private.policy_sale_effective_premium",
      "private.policy_sale_original_premium", "public.correct_policy_sale_premium", "public.get_client_policy_sale_premiums",
    ]);
    const revoked = revokes(forward);
    for (const fn of created) {
      expect(fn.header, `${fn.name} search_path`).toMatch(/SET search_path = pg_catalog, pg_temp/);
      if (fn.name.startsWith("private.")) expect(fn.header, `${fn.name} must run with invoker rights`).not.toMatch(/SECURITY\s+DEFINER/i);
      else expect(fn.header, `${fn.name} is definer-rights`).toMatch(/SECURITY\s+DEFINER/i);
      const match = revoked.find((r) => r.name === fn.name && r.types.join(",") === fn.types.join(","));
      expect(match, `${fn.name}(${fn.types.join(", ")}) has no REVOKE ALL`).toBeDefined();
      expect(match!.roles, `${fn.name} REVOKE roles`).toEqual(SEALED_ROLES);
    }
    expect(forward).toMatch(/REVOKE ALL ON private\.policy_sale_premium_corrections FROM PUBLIC, anon, authenticated, service_role;/);
    expect(forward).toMatch(/ALTER TABLE private\.policy_sale_premium_corrections ENABLE ROW LEVEL SECURITY;/);
    expect(forward).not.toMatch(/CREATE\s+POLICY/i);
  });

  it("replaces only performance_sale_monthly, behind its md5 preimage, and proves every sale unchanged before commit", () => {
    const replaced = [...forward.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-z_]+\.[a-z0-9_]+)/gi)].map((m) => m[1]);
    expect(replaced).toEqual(["private.performance_sale_monthly"]);
    expect(forward.trimStart()).toMatch(/^SET LOCAL lock_timeout = '2s';/);
    expect(forward).toContain("'51e06b46a13c3a8eec4d672bec158376'");
    expect(forward).toContain("refusing replay");
    expect(forward).toContain("Reports v3 must be disabled first");
    expect(forward).toContain("a sale premium changed at the switch");
    expect(forward).toContain("performance_sale_monthly attributes changed");
  });

  it("never writes a sale, a commission row or a notification", () => {
    expect(forward).not.toMatch(/INSERT\s+INTO\s+public\.wins|UPDATE\s+public\.wins|DELETE\s+FROM\s+public\.wins/i);
    expect(forward).not.toMatch(/policy_commission|notify_win|pg_notify/i);
  });

  it("the rollback refuses while v3 is enabled, always seals the writer, restores only the exact preimage and never drops the ledger", () => {
    expect(rollback).toContain("Reports v3 must be disabled first");
    expect(rollback).toMatch(/REVOKE ALL ON FUNCTION public\.correct_policy_sale_premium\([^)]*\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
    expect(rollback).toContain("'51e06b46a13c3a8eec4d672bec158376'");
    expect(rollback).not.toMatch(/DROP\s+TABLE/i);
    expect(rollback).not.toMatch(/DROP\s+FUNCTION\s+private\.guard_policy_sale_premium_correction/i);
  });

  it("the rollback restores the PKG-A stub and basis flags only from the exact …21 postimages, else seals only", () => {
    for (const md5 of ["9c46e97ff58247a13826ddef83e28355", "67c6a60a1004b4596a4a61487a41d17b",
                       "37800ccc8ada2fae26b86dd5a610eb09", "e446177c344762bec8caf7d5e9321d9b"]) expect(rollback).toContain(`'${md5}'`);
    expect(rollback).toContain("PKG-A sale premium basis not restored exactly");
    expect(rollback).toMatch(/OR v_basis IS NULL THEN/);
  });
});

describe("PKG-B …21 (D2 §3.7): Reports v3 reads the effective premium; class W", () => {
  const BASIS = `${MIGRATIONS}/20261104120021_reports_v3_sale_premium_basis.sql`;
  const basis = stripSqlComments(read(BASIS));

  it("replaces only the PKG-A stub and basis flags, behind their md5 postimages, and refuses while v3 is enabled or on replay", () => {
    const replaced = [...basis.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_]+\.[a-z0-9_]+)/gi)].map((m) => m[1]);
    expect(replaced).toEqual(["private.report_v3_sale_premium", "private.report_v3_basis_flags"]);
    expect(basis.trimStart()).toMatch(/^SET LOCAL lock_timeout = '2s';/);
    for (const md5 of ["37800ccc8ada2fae26b86dd5a610eb09", "e446177c344762bec8caf7d5e9321d9b", "ee64ddb694ad2e1b250ba069342c75fa"])
      expect(basis).toContain(`'${md5}'`);
    for (const text of ["Reports v3 must be disabled first", "the corrections ledger (…20) must be applied first", "refusing replay",
                        "PKG-A preimage drift", "a sale premium changed at the replacement", "function attributes changed"])
      expect(basis).toContain(text);
  });

  it("keeps the monthly amount on the shared choke point and installs 3.1.0 / audited_ledger", () => {
    expect(basis).toMatch(/monthly := private\.performance_sale_monthly\(p_win, p_client\);/);
    expect(basis).toContain('{"contract_version":"3.1.0","corrections":"audited_ledger","sale_call_links":"not_installed","appointment_evidence":"not_installed"}');
  });

  it("checks the exact post-grant ACL and never writes a sale, a commission row or a notification", () => {
    expect(basis).toContain("ACL is not authenticated-only");
    expect(basis).not.toMatch(/INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM/i);
    expect(basis).not.toMatch(/policy_commission|notify_win|pg_notify/i);
  });
});

describe("PKG-C producing-call capture (D3 §3.6): …30 and …32 are class C, …31 is class W", () => {
  const LINKS = stripSqlComments(read(`${MIGRATIONS}/20261104120030_policy_sale_call_links.sql`));
  const CAPTURE = stripSqlComments(read(`${MIGRATIONS}/20261104120031_policy_sale_call_link_capture.sql`));
  const CAPTURE_ROLLBACK = stripSqlComments(read(`${ROLLBACKS}/20261104120031_policy_sale_call_link_capture.rollback.sql`));
  const WINDOW = stripSqlComments(read(`${MIGRATIONS}/20261104120032_reports_v3_sale_call_links.sql`));
  const WINDOW_ROLLBACK = stripSqlComments(read(`${ROLLBACKS}/20261104120032_reports_v3_sale_call_links.rollback.sql`));
  const C_ALLOWLIST = [
    "GRANT EXECUTE ON FUNCTION public.record_client_policy_handoff_v2(uuid,uuid,jsonb,boolean,jsonb,uuid) TO authenticated",
    "GRANT EXECUTE ON FUNCTION public.convert_lead_to_client_with_sales_handoff_v2(uuid,uuid,uuid,jsonb,uuid,jsonb,uuid) TO authenticated",
    "GRANT EXECUTE ON FUNCTION public.retry_policy_sale_call_link(uuid) TO authenticated",
    "GRANT EXECUTE ON FUNCTION public.get_policy_sale_call_link_status(uuid[]) TO authenticated",
  ];

  it("…30, …32 and both rollbacks grant nothing; …31 grants exactly its four RPCs to authenticated", () => {
    for (const sql of [LINKS, WINDOW, CAPTURE_ROLLBACK, WINDOW_ROLLBACK]) expect(grants(sql)).toEqual([]);
    expect(grants(CAPTURE).map((g) => g.replace(/\s+/g, " ").trim())).toEqual(C_ALLOWLIST);
  });

  it("every created function has its REVOKE ALL from PUBLIC, anon, authenticated and service_role, and a pinned search_path", () => {
    for (const sql of [LINKS, CAPTURE]) {
      const revoked = revokes(sql);
      for (const fn of createdFunctions(sql)) {
        expect(fn.header, `${fn.name} search_path`).toMatch(/SET search_path = pg_catalog, pg_temp/);
        const match = revoked.find((r) => r.name === fn.name && r.types.join(",") === fn.types.join(","));
        expect(match, `${fn.name}(${fn.types.join(", ")}) has no REVOKE ALL`).toBeDefined();
        expect(match!.roles).toEqual(SEALED_ROLES);
      }
    }
    expect(LINKS).toMatch(/REVOKE ALL ON private\.policy_sale_call_links FROM PUBLIC, anon, authenticated, service_role;/);
    expect(CAPTURE).toMatch(/REVOKE ALL ON private\.policy_sale_call_link_failures FROM PUBLIC, anon, authenticated, service_role;/);
    expect(`${LINKS}${CAPTURE}`).not.toMatch(/CREATE\s+POLICY/i);
  });

  it("the lead_id guard comes first, and links have no foreign key to sales or calls", () => {
    expect(LINKS.indexOf("CREATE TRIGGER clients_lead_id_guard")).toBeLessThan(LINKS.indexOf("CREATE TABLE private.policy_sale_call_links"));
    expect(LINKS).not.toMatch(/REFERENCES\s+public\.(wins|calls)/i);
  });

  it("capture is bounded, pinned to the handoff preimages and never touches sales, commissions or notifications", () => {
    expect(CAPTURE).toMatch(/SET search_path = pg_catalog, pg_temp SET lock_timeout = '100ms'/);
    for (const md5 of ["b02760be55132f0be3fa91b04955e839", "d39e03a7dd2cf122a68dc0fefcbfb44a",
                       "f331226b398134ea485d5543472d5ccf", "4d6803ff7d94b7735e3f1b3baf18456c"]) expect(CAPTURE).toContain(`'${md5}'`);
    expect(CAPTURE).not.toMatch(/INSERT\s+INTO\s+public\.wins|UPDATE\s+public\.wins|DELETE\s+FROM\s+public\.wins|wins\.call_id/i);
    expect(CAPTURE).not.toMatch(/policy_commission_(estimates|installments|receipts)|notify_win|pg_notify/i);
    expect(CAPTURE).not.toMatch(/WHEN\s+query_canceled|WHEN\s+assert_failure/i);
  });

  it("…32 replaces only the link stub and basis flags behind their postimages; its rollback restores both", () => {
    const replaced = [...WINDOW.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-z_]+\.[a-z0-9_]+)/gi)].map((m) => m[1]);
    expect(replaced).toEqual(["private.report_v3_sale_call_links", "private.report_v3_basis_flags"]);
    for (const md5 of ["769d31d180bf61264b0609e87b3ea24f", "67c6a60a1004b4596a4a61487a41d17b"]) {
      expect(WINDOW).toContain(`'${md5}'`);
      expect(WINDOW_ROLLBACK).toContain(`'${md5}'`);
    }
    expect(WINDOW).toContain('"contract_version":"3.2.0","corrections":"audited_ledger","sale_call_links":"installed"');
    expect(WINDOW).toContain("Reports v3 must be disabled first");
  });
});
