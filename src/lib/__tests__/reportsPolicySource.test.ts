/**
 * Reports Policies Sold source (plan §20 rev 2): normalized STORED policies, never wins.
 *   - the frontend refuses any payload that is not policy-based (old / recovery-state functions);
 *   - an OLD tab (pre-fix schema) still parses the new summary/volume but NOT the new campaign payload;
 *   - policy basis, current-assignment and conversion-lineage wording reach the screen and the CSV;
 *   - static contracts on the migration, the fail-closed recovery files and the untouched canon.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  reportCampaignsSchema, reportDispositionsSchema, reportSummarySchema, reportVolumeSchema,
} from "@/lib/reports-schemas";
import { buildReportCsv } from "@/lib/reports-export";
import {
  CAMPAIGN_ATTRIBUTION_NOTE, CURRENT_ASSIGNMENT_NOTE, POLICY_SOURCE_NOTE, policyExportNotes, policyQualityNote,
} from "@/lib/reports-policy-text";
import { policyQuality, reportCampaigns, reportDispositions, reportSummary, reportVolume, reportWindow } from "./reportsFixtures";

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const gitBlobSha = (content: string) =>
  createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, "");

const POLICY_MIGRATION = "supabase/migrations/20260930120000_reports_policies_sold_normalized_source.sql";
const POLICY_FIXTURE = "supabase/migrations/rollback/20260930120000_reports_policies_sold_normalized_source.rollback.sql";

/** A win-based payload: exactly what the pre-fix functions (or a restored preimage) return. */
function winBased(payload: object, drop: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  for (const k of drop) delete copy[k];
  return copy;
}

describe("new frontend: only policy-based payloads are accepted", () => {
  it("accepts the policy-based summary, volume and campaign payloads", () => {
    expect(reportSummarySchema.safeParse(reportSummary()).success).toBe(true);
    expect(reportVolumeSchema.safeParse(reportVolume()).success).toBe(true);
    expect(reportCampaignsSchema.safeParse(reportCampaigns()).success).toBe(true);
  });

  it("refuses a summary or volume without policy_source (win-based function) — it is never shown as policies", () => {
    expect(reportSummarySchema.safeParse(winBased(reportSummary(), ["policy_source", "policy_basis", "policy_quality"])).success).toBe(false);
    expect(reportSummarySchema.safeParse(winBased(reportSummary(), ["policy_source"])).success).toBe(false);
    expect(reportVolumeSchema.safeParse(winBased(reportVolume(), ["policy_source", "policy_quality"])).success).toBe(false);
    expect(reportSummarySchema.safeParse({ ...reportSummary(), policy_source: "wins" }).success).toBe(false);
  });

  it("refuses the win-based campaign payload (COUNT(wins) policies_sold, no lineage fields)", () => {
    const c = reportCampaigns();
    const old = {
      ...winBased(c, ["policy_source", "policy_attribution", "policies_in_period", "policies_attribution_unavailable"]),
      campaigns: c.campaigns.map(({ attributed_policies, ...rest }) => ({ ...rest, policies_sold: attributed_policies })),
    };
    expect(reportCampaignsSchema.safeParse(old).success).toBe(false);
  });

  it("requires the current-assignment basis and SCOPE-WIDE, ALL-TIME quality counts", () => {
    const s = reportSummary();
    expect(reportSummarySchema.safeParse({ ...s, policy_basis: { ...s.policy_basis, agent_attribution: "seller" } }).success).toBe(false);
    expect(reportSummarySchema.safeParse({ ...s, policy_quality: { ...s.policy_quality, basis: "period" } }).success).toBe(false);
  });
});

describe("old tab (pre-fix schema) against the new functions — documented release behaviour", () => {
  // The pre-fix schemas are the current ones minus exactly the fields this fix added.
  const oldSummary = reportSummarySchema.omit({ policy_source: true, policy_basis: true, policy_quality: true });
  const oldVolume = reportVolumeSchema.omit({ policy_source: true, policy_quality: true });
  const oldCampaigns = reportCampaignsSchema
    .omit({ policy_source: true, policy_attribution: true, policies_in_period: true, policies_attribution_unavailable: true })
    .extend({
      campaigns: z.array(reportCampaignsSchema.shape.campaigns.element.omit({ attributed_policies: true }).extend({ policies_sold: z.number() })),
    });

  it("summary and volume keep every field name, so an old tab shows the corrected counts (with its old labels) until reload", () => {
    expect(oldSummary.safeParse(reportSummary()).success).toBe(true);
    expect(oldVolume.safeParse(reportVolume()).success).toBe(true);
  });

  it("the campaign payload no longer carries policies_sold, so an old tab's campaign panel fails closed (unavailable)", () => {
    expect(oldCampaigns.safeParse(reportCampaigns()).success).toBe(false);
  });
});

describe("policy wording on screen and in CSV metadata", () => {
  it("the quality note says scope-wide and all dates, and is absent when there is nothing to report", () => {
    expect(policyQualityNote(policyQuality())).toBeNull();
    const note = policyQualityNote(policyQuality(3, 6))!;
    expect(note).toMatch(/across this scope, all dates \(not only this period\)/);
    expect(note).toMatch(/3 policies have no usable sale date and are not counted in any period/);
    expect(note).toMatch(/6 additional-policy records could not be read/);
    expect(policyQualityNote(policyQuality(1, 0))).toMatch(/1 policy has no usable sale date and is not counted/);
  });

  it("summary exports state the source and the current-assignment basis; campaign exports state lineage-only attribution", () => {
    expect(policyExportNotes("summary", reportSummary())).toEqual([POLICY_SOURCE_NOTE, CURRENT_ASSIGNMENT_NOTE]);
    expect(policyExportNotes("summary", { ...reportSummary(), policy_quality: policyQuality(2, 0) })).toHaveLength(3);
    expect(policyExportNotes("volume", reportVolume())).toEqual([POLICY_SOURCE_NOTE]);
    expect(policyExportNotes("campaigns", reportCampaigns())).toEqual([POLICY_SOURCE_NOTE, CAMPAIGN_ATTRIBUTION_NOTE]);
    expect(policyExportNotes("dispositions", {})).toEqual([]);
    expect(CURRENT_ASSIGNMENT_NOTE).toMatch(/not the original seller/);
    expect(CAMPAIGN_ATTRIBUTION_NOTE).toMatch(/not complete campaign sales attribution and not proof the campaign caused the sale/);
  });

  it("notes are written as labelled metadata rows before the data", () => {
    const csv = buildReportCsv(
      { report: "Report Summary", scope: "team", agentLabel: "Whole team", window: reportWindow(), notes: [CURRENT_ASSIGNMENT_NOTE] },
      ["Metric", "Value"],
      [["Policies sold (stored, by sale date)", 5]],
    );
    const lines = csv.split("\n");
    const noteAt = lines.findIndex((l) => l.startsWith(`"Note",`));
    expect(noteAt).toBeGreaterThan(0);
    expect(lines[noteAt]).toContain("current assigned agent");
    expect(noteAt).toBeLessThan(lines.indexOf(`"Metric","Value"`));
  });
});

describe("static contracts: migration, fail-closed recovery, untouched canon", () => {
  const sql = stripSqlComments(read(POLICY_MIGRATION));

  it("the applied Reports migration and the Profile policy canon are byte-identical to main", () => {
    expect(gitBlobSha(read("supabase/migrations/20260929152553_reports_secure_scoped_rpcs.sql"))).toBe("93978f8df56292f698e55a702113de25e93eaa51");
    expect(gitBlobSha(read("supabase/migrations/20260919183544_profile_book_and_team_stats_rpcs.sql"))).toBe("35b354fc4d716127253fb31e3bd37c2f42999f5b");
    expect(gitBlobSha(read("src/lib/profile/normalized-policy.ts"))).toBe("060b8db52806093e17dcd9db61ef0c052b9346cf");
  });

  it("no policy count in the new migration reads public.wins; only the lineage helper consults it", () => {
    const bodies = sql.split(/CREATE (?:OR REPLACE )?FUNCTION /).slice(1);
    const withWins = bodies.filter((b) => /public\.wins/.test(b.split("\n$$;")[0])).map((b) => b.split("(")[0]);
    expect(withWins).toEqual(["private.report_policy_campaign_lineage"]);
  });

  it("grants nothing to clients and keeps the helpers private", () => {
    expect(sql).not.toMatch(/GRANT\s/i);
    for (const h of ["report_policy_facts", "report_policy_quality", "report_policy_campaign_lineage"]) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION private\\.${h}\\(uuid, uuid\\[\\]\\)\\s+FROM PUBLIC, anon, authenticated;`));
    }
  });

  it("mirrors the server canon: evidence rule, object-only elements, issueDate only when soldDate is absent", () => {
    expect(sql).toMatch(/nullif\(pg_catalog\.btrim\(sc\.carrier\), ''\)\s+IS NOT NULL/);
    expect(sql).toMatch(/sc\.premium\s+> 0/);
    expect(sql).toMatch(/sc\.face_amount > 0/);
    expect(sql).toContain("private.profile_parse_iso_date(\n             coalesce(e.entry ->> 'soldDate', e.entry ->> 'issueDate')");
    expect(sql).toContain("WHERE pg_catalog.jsonb_typeof(e.entry) = 'object'");
  });

  it("the preimage fixture refuses unless Reports is disabled, and nothing in recovery grants legacy access", () => {
    const fixture = read(POLICY_FIXTURE);
    expect(fixture).toMatch(/NOT A STANDALONE PRODUCTION ROLLBACK/);
    expect(stripSqlComments(fixture)).toMatch(/Reports must be DISABLED first/);
    expect(stripSqlComments(fixture)).not.toMatch(/GRANT\s/i);
    const enable = stripSqlComments(read("supabase/ops/reports_enable.sql"));
    expect(enable).toMatch(/is not the verified normalized-policy implementation; refusing/);
    // The guard runs before any grant in the file.
    expect(enable.indexOf("policy_guard")).toBeLessThan(enable.indexOf("GRANT EXECUTE"));
    expect(enable).not.toMatch(/GRANT[^;]*rpc_report/i);
  });
});


describe("campaign privacy response and fixture contracts", () => {
  it("requires a server-authorized campaign visibility marker on both campaign-bearing panels", () => {
    for (const [schema, payload] of [[reportCampaignsSchema, reportCampaigns()], [reportDispositionsSchema, reportDispositions()]] as const) {
      expect(schema.safeParse(payload).success).toBe(true);
      expect(schema.safeParse(winBased(payload, ["campaign_visibility"])).success).toBe(false);
    }
  });
  it("labels restricted or missing lineage as unavailable, not nonexistent", () => {
    expect(CAMPAIGN_ATTRIBUTION_NOTE).toContain("unavailable attribution is non-identifying");
    expect(read("src/components/reports/CampaignPerformance.tsx")).toContain("unavailable campaign attribution");
    expect(read("src/components/reports/DispositionDeepDive.tsx")).toContain("No campaign breakdown is available");
  });
  it("fixture setup is separate, fatal and uses the exact loader tested by the failure probe", () => {
    const runner = read("scripts/run_reports_rpc_tests.sh");
    const block = runner.slice(runner.indexOf("run_policy_neg()"), runner.indexOf('echo; echo "== P2a.'));
    expect(block).toContain('load_report_fixtures "$PGURL/$db" "$FIXTURES"');
    expect(block).not.toMatch(/\|\| true/);
    expect(read("supabase/tests/reports_fixtures.sql")).toContain("REPORTS FIXTURE SETUP INCOMPLETE");
    expect(runner).toContain('declare -f load_report_fixtures');
  });
});
