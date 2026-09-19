/**
 * Static source contracts for the Agent Profile / Team Profile surface.
 *
 * These assert things a rendering test cannot: that a forbidden SOURCE never appears, that no
 * fabricated value is hardcoded, and that theme tokens are used rather than raw colours. The repo
 * already uses this technique (inboundBrowserLifecycleWrites.test.ts, inboundDeviceLifetime.test.ts)
 * precisely because a defect that is invisible in one render is still a defect.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/** Every production file this feature owns. */
function collect(dir: string): string[] {
  const abs = resolve(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? collect(`${dir}/${entry.name}`)
      : entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
        ? [`${dir}/${entry.name}`]
        : [],
  );
}

const FEATURE_FILES = [
  ...collect("components/agent-profile"),
  ...collect("lib/profile"),
  "hooks/useProfileData.ts",
  "pages/AgentProfile.tsx",
].filter((f) => !f.includes("__tests__"));

/**
 * Strip comments before auditing.
 *
 * These audits are about what the code DOES. Several of the files below discuss the very patterns
 * being forbidden — why `wins` is not the book of business, why `hierarchy_path` is unusable, why
 * the "Top Producer" badge was deleted — and a naive substring search would flag the explanation
 * as the offence. Stripping comments is what makes the assertion mean "this code never does it"
 * rather than "nobody ever mentions it".
 */
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const FEATURE_CODE = new Map(FEATURE_FILES.map((f) => [f, stripTsComments(read(f))]));
const FEATURE_SOURCE = [...FEATURE_CODE].map(([f, src]) => `\n/* ${f} */\n${src}`).join("\n");
const readCode = (rel: string) => FEATURE_CODE.get(rel) ?? stripTsComments(read(rel));
const page = read("pages/AgentProfile.tsx");
const pageCode = stripTsComments(page);

describe("the canonical licensing source", () => {
  it("no production file in this feature reads profiles.licensed_states as a licence source", () => {
    // agent_state_licenses is canonical. profiles.licensed_states is the legacy store the previous
    // page used; onboarding still writes it and nothing syncs it, so reading it here would
    // reintroduce the disagreement this rebuild exists to fix.
    for (const [file, src] of FEATURE_CODE) {
      // `distinct_licensed_states` is the RPC's CANONICAL count, derived from agent_state_licenses.
      // Only a bare `licensed_states` is the legacy profiles column this audit is about.
      const legacyUses = [...src.matchAll(/(\w*)licensed_states/g)].filter(
        (m) => !m[1].endsWith("distinct_"),
      );
      if (legacyUses.length === 0) continue;
      // The ONE permitted use is COUNTING the legacy entries so the licensing card can offer to
      // migrate them. It must never feed a licence list or a state count.
      expect(file).toBe("components/agent-profile/AgentProfileTab.tsx");
      expect(src).toContain("countLegacyLicensedStates");
      expect(src).toContain("legacyLicensedStateCount");
    }
  });

  it("licences are read from agent_state_licenses through the shared query layer", () => {
    expect(read("lib/profile/profile-queries.ts")).toContain('.from("agent_state_licenses")');
  });
});

describe("the book of business is clients, never wins", () => {
  it("no production file in this feature reads public.wins", () => {
    // wins is a frozen sale-time event log: one win per conversion regardless of policy count, none
    // at all for a manually created or CSV-imported client, and never updated when a client is
    // edited. Production already holds one win whose policy_type disagrees with its client's.
    expect(FEATURE_SOURCE).not.toMatch(/from\(["']wins["']\)/);
    expect(FEATURE_SOURCE).not.toMatch(/\bwins\./);
  });

  it("clients.premium_amount is never read", () => {
    // Deferred schema debt (AGENT_RULES section 5). clients.premium is canonical.
    expect(FEATURE_SOURCE).not.toContain("premium_amount");
  });

  it("performs no annualization arithmetic", () => {
    // Premium is MONTHLY in clients.premium, wins.premium_amount and additional_policies
    // (src/lib/policyPaymentFields.ts:5-9). The only x12 in the product is the Leaderboard's.
    // The check is on the ARITHMETIC, not the word: the tile copy says "Not annualized" on purpose.
    expect(FEATURE_SOURCE).not.toMatch(/\*\s*12\b/);
    expect(FEATURE_SOURCE).not.toMatch(/\b12\s*\*/);
  });

  it("tells the reader on the tile that the premium total is monthly", () => {
    const snapshot = read("components/agent-profile/BusinessSnapshot.tsx");
    expect(snapshot).toContain("Monthly Premium");
    expect(snapshot).toContain("Not annualized.");
  });
});

describe("hierarchy resolution", () => {
  it("nothing reads hierarchy_path or is_ancestor_of", () => {
    // 7 of 12 stored paths disagree with compute_hierarchy_path() in production, so is_ancestor_of
    // denies almost everything. upline_id is the only trustworthy source.
    expect(FEATURE_SOURCE).not.toContain("hierarchy_path");
    expect(FEATURE_SOURCE).not.toContain("is_ancestor_of");
    expect(FEATURE_SOURCE).not.toContain("get_contact_scope_agents");
  });

  it("scope comes from the ONE audited resolver, not a second traversal", () => {
    expect(readCode("lib/profile/profile-queries.ts")).toContain("usersSupabaseApi.getAgentScopeIds");
    // getDownlineAgents is one level deep and carries NO organization filter.
    expect(FEATURE_SOURCE).not.toContain("getDownlineAgents");
  });

  it("the org chart reuses the existing forest builder rather than a new algorithm", () => {
    const view = readCode("lib/profile/profile-org-view.ts");
    expect(view).toContain('from "@/lib/profile-org-tree"');
    expect(view).toContain("buildProfileOrgForest");
    // filterReportingLineHierarchy includes the viewer's UPLINE — the opposite of "beneath me".
    expect(FEATURE_SOURCE).not.toContain("filterReportingLineHierarchy");
    // HierarchyTree fetches profiles with NO organization filter; the component is not reused.
    expect(FEATURE_SOURCE).not.toContain("HierarchyTree");
  });

  it("the roster query never selects avatar_url", () => {
    // avatar_url holds a base64 data URL; selecting it across a downline pulls megabytes.
    const queries = readCode("lib/profile/profile-queries.ts");
    const rosterSelect = /fetchTeamRoster[\s\S]*?\.select\(([^)]*)\)/.exec(queries);
    expect(rosterSelect).not.toBeNull();
    expect(rosterSelect![1]).not.toContain("avatar_url");
  });
});

describe("no fabricated data", () => {
  it("the invented Top Producer and Hot Streak badges are gone", () => {
    for (const forbidden of ["Top Producer", "Hot Streak", "Multistate Licensed", "Multi-Carrier"]) {
      expect(FEATURE_SOURCE).not.toContain(forbidden);
    }
  });

  it("no agency name is hardcoded", () => {
    expect(FEATURE_SOURCE).not.toMatch(/Family First Life/i);
  });

  it("no mock, sample or demo data", () => {
    expect(FEATURE_SOURCE).not.toMatch(/\bMOCK_[A-Z_]+/);
    expect(FEATURE_SOURCE).not.toMatch(/\bSAMPLE_[A-Z_]+/);
    expect(FEATURE_SOURCE).not.toMatch(/\bDUMMY_[A-Z_]+/);
    expect(FEATURE_SOURCE).not.toMatch(/faker\./);
  });
});

describe("the page is orchestration, and the daily-work sections are gone", () => {
  it("fetches nothing itself", () => {
    expect(pageCode).not.toContain("supabase");
    expect(pageCode).not.toContain("useQuery");
  });

  it("does not render dialer telemetry, callbacks, appointments or availability", () => {
    for (const forbidden of [
      "todayCalls",
      "monthCalls",
      "monthWins",
      "totalTalkTime",
      "availability_status",
      "callback",
      "appointment",
      "campaign",
    ]) {
      expect(pageCode.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("never reads the three unbounded tables the previous version scanned", () => {
    expect(pageCode).not.toContain('from("calls")');
    expect(pageCode).not.toContain('from("clients")');
    expect(pageCode).not.toContain('from("wins")');
  });
});

describe("every component respects AGENT_RULES section 7", () => {
  it("no component file reaches 200 lines", () => {
    const oversized = FEATURE_FILES.filter(
      (f) => f.endsWith(".tsx") && read(f).split("\n").length >= 200,
    ).map((f) => `${f} (${read(f).split("\n").length})`);
    expect(oversized).toEqual([]);
  });

  it("uses Tailwind classes, not inline style objects, outside the charted/measured surfaces", () => {
    // Recharts takes colours as props, and a percentage width has to be a computed value — those
    // four files are the only permitted exceptions, and their colours are still theme tokens.
    const allowed = new Set([
      "components/agent-profile/PolicyTypeMixCard.tsx",
      "components/agent-profile/ProfilePrimitives.tsx",
      "components/agent-profile/ReadinessCard.tsx",
      "components/agent-profile/team/TeamReadinessCard.tsx",
    ]);
    for (const file of FEATURE_FILES.filter((f) => f.endsWith(".tsx"))) {
      if (allowed.has(file)) continue;
      expect({ file, inlineStyle: /style=\{\{/.test(read(file)) }).toEqual({
        file,
        inlineStyle: false,
      });
    }
  });
});

describe("both themes stay readable", () => {
  it("no raw hex or rgb colour anywhere in the feature", () => {
    // Every colour must be a token so light and dark resolve from one definition. The repo has real
    // precedent for this going wrong: DispositionDeepDive.tsx:9 hardcodes a hex palette.
    expect(FEATURE_SOURCE.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(FEATURE_SOURCE).not.toMatch(/\brgba?\(/);
  });

  it("defines no colour only under a dark: variant", () => {
    // A `dark:`-only colour leaves the light theme inheriting whatever it happens to inherit.
    expect(FEATURE_SOURCE).not.toMatch(/dark:(bg|text|border)-/);
  });

  it("chart colours resolve through CSS variables that actually exist", () => {
    const slices = readCode("lib/profile/policy-type-slices.ts");
    const colours = [...slices.matchAll(/"(hsl\(var\(--[a-z-]+\)\))"/g)].map((m) => m[1]);
    expect(colours.length).toBeGreaterThanOrEqual(5);
    // --chart-1..n are NOT in this repo's token set; referencing them renders nothing.
    expect(slices).not.toContain("--chart-");
  });

  it("uses the semantic tokens for status, and MUTED for unknown", () => {
    const licensing = readCode("components/agent-profile/LicensingCard.tsx");
    expect(licensing).toContain("text-destructive");
    expect(licensing).toContain("text-warning");
    expect(licensing).toContain("text-success");
    // An unknown expiration is muted, never green. This is the mapping the Settings card gets wrong.
    expect(licensing).toMatch(/none:\s*\{\s*label:\s*"No expiration on file",\s*cls:\s*"[^"]*muted/);
  });
});

describe("failures are never rendered as zeros", () => {
  it("the query layer throws on a Supabase error rather than coalescing", () => {
    const queries = readCode("lib/profile/profile-queries.ts");
    expect(queries).toContain("assertNoQueryError");
    // `Res.data || []` is the exact pattern that made the old page report a confident zero on an
    // RLS denial.
    expect(queries).not.toMatch(/result\?\.data\s*(\|\||\?\?)\s*\[\]/);
    expect(queries).not.toMatch(/Res\.data\s*\|\|\s*\[\]/);
  });

  it("every data-driven card can render an explicit unavailable state", () => {
    const cards = FEATURE_FILES.filter(
      (f) =>
        (f.endsWith("Card.tsx") || f.endsWith("Snapshot.tsx") || f.endsWith("Preview.tsx")) &&
        // CarrierAppointmentsCard reads an already-loaded profile field, so it has no failure mode.
        !f.endsWith("CarrierAppointmentsCard.tsx"),
    );
    expect(cards.length).toBeGreaterThan(5);
    for (const card of cards) {
      expect({ card, handlesError: read(card).includes("MetricUnavailable") }).toEqual({
        card,
        handlesError: true,
      });
    }
  });

  it("the unavailable state says explicitly that it is not a zero", () => {
    expect(read("components/agent-profile/ProfilePrimitives.tsx")).toContain("This is not a zero.");
  });
});

describe("query options are explicit, because the global QueryClient sets none", () => {
  it("pins staleTime, retry and refetchOnWindowFocus", () => {
    // src/App.tsx builds `new QueryClient()` with no defaultOptions, so react-query v5 defaults
    // (staleTime 0, refetchOnWindowFocus true, retry 3) would otherwise apply.
    const hooks = readCode("hooks/useProfileData.ts");
    expect(hooks).toContain("staleTime:");
    expect(hooks).toContain("retry:");
    expect(hooks).toContain("refetchOnWindowFocus: false");
  });

  it("does not modify the global QueryClient", () => {
    expect(read("App.tsx")).toContain("const queryClient = new QueryClient();");
  });
});

describe("View As stays closed for this route", () => {
  it("/agent-profile is not added to the allow-list", () => {
    const surfaces = read("lib/viewAsSurfaces.ts");
    expect(surfaces).not.toContain("/agent-profile");
    expect(surfaces).toContain(
      'const SUPPORTED_PATHNAMES: readonly string[] = ["/conversations", "/contacts"]',
    );
  });

  it("org-wide branches gate on isOrganizationWideViewer, never useOrganization().isSuperAdmin", () => {
    // useOrganization().isSuperAdmin is `isSuperAdmin || isImpersonating`, which would widen a
    // "View As" session of an Agent back to the whole organization.
    expect(readCode("hooks/useProfileData.ts")).toContain("isOrganizationWideViewer");
    expect(FEATURE_SOURCE).not.toMatch(/useOrganization\(\)\.isSuperAdmin/);
  });
});

describe("the SQL side of the contract", () => {
  const migration = readFileSync(
    resolve(ROOT, "../supabase/migrations/20260919210000_profile_book_and_team_stats_rpcs.sql"),
    "utf8",
  );

  it("never reads wins or clients.premium_amount, and never annualizes", () => {
    // Strip BOTH the `--` banners and the COMMENT ON ... IS '...' prose. Both explain at length
    // why wins is not read and why nothing is annualized, so an unstripped search would flag the
    // documentation as the violation.
    const body = migration
      .replace(/^\s*--.*$/gm, "")
      .replace(/COMMENT ON [\s\S]*?';/g, "");
    expect(body).not.toMatch(/public\.wins/);
    expect(body).not.toMatch(/premium_amount/);
    expect(body).not.toMatch(/\*\s*12\b/);
  });

  it("is SECURITY DEFINER with a pinned search_path on every function it creates", () => {
    const fns = [...migration.matchAll(/^CREATE OR REPLACE FUNCTION\s+([a-z_]+\.[a-z_]+)/gm)];
    expect(fns.length).toBe(5);
    // Every function declares the pinned search_path; the two public ones and the resolver are
    // additionally SECURITY DEFINER.
    expect((migration.match(/SET search_path = pg_catalog, pg_temp/g) ?? []).length).toBe(5);
    expect((migration.match(/SECURITY DEFINER/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("revokes the public functions from PUBLIC and anon, and the private ones from authenticated", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.get_profile_book_stats(text, text) FROM PUBLIC, anon;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.get_profile_team_readiness() FROM PUBLIC, anon;",
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION private\.resolve_downline_ids\(uuid, uuid\)\s+FROM PUBLIC, anon, authenticated;/,
    );
  });

  it("accepts no caller-supplied agent id, organization id or role", () => {
    expect(migration).toContain("public.get_profile_book_stats(\n  p_scope     text,\n  p_time_zone text DEFAULT NULL\n)");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_profile_team_readiness()");
  });

  it("resolves the downline from upline_id, never hierarchy_path", () => {
    const resolver = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION private.resolve_downline_ids"),
      migration.indexOf("COMMENT ON FUNCTION private.resolve_downline_ids"),
    );
    expect(resolver).toContain("c.upline_id = w.id");
    expect(resolver).not.toContain("hierarchy_path");
    expect(resolver).toContain("c.organization_id = p_org");
    expect(resolver).toContain("NOT (c.id = ANY (w.visited))"); // cycle guard
  });

  it("has a paired rollback that drops every object it creates", () => {
    const rollback = readFileSync(
      resolve(
        ROOT,
        "../supabase/migrations/rollback/20260919210000_profile_book_and_team_stats_rpcs.rollback.sql",
      ),
      "utf8",
    );
    for (const obj of [
      "public.get_profile_team_readiness()",
      "public.get_profile_book_stats(text, text)",
      "private.resolve_downline_ids(uuid, uuid)",
      "private.profile_parse_iso_date(text)",
      "private.profile_parse_currency(text)",
      "public.idx_clients_assigned_agent_id",
    ]) {
      expect(rollback).toContain(obj);
    }
    // It must NOT drop private.campaign_actor, which it only calls and does not own.
    expect(rollback).not.toMatch(/DROP FUNCTION[^\n]*campaign_actor/);
  });
});
