import { describe, it, expect } from "vitest";
import type { CampaignCardStats } from "@/lib/campaign-card-stats";
import {
  CAMPAIGN_LIST_COLUMNS,
  CAMPAIGN_STATUSES,
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  DuplicatePayloadSchema,
  SORT_LABELS,
  agentsModel,
  buildDuplicatePayload,
  campaignTypeKey,
  collectAssigneeIds,
  defaultDirFor,
  duplicateEligibility,
  filterCampaigns,
  idsHash,
  isDefaultView,
  isLeadershipViewer,
  metricNumber,
  parseStringList,
  progressPercent,
  resolveCampaignMetrics,
  sortCampaigns,
  type CampaignFilters,
  type CampaignMetrics,
  type CampaignRow,
  type MetricState,
  type SortContext,
  type SortDir,
  type SortKey,
  type StatsView,
} from "@/lib/campaigns-table/model";
import {
  COLUMN_DEFS,
  COLUMN_IDS,
  DEFAULT_COLUMN_LAYOUT,
  isColumnId,
  normalizeColumnLayout,
  sameColumnLayout,
  visibleColumns,
  type ColumnId,
  type ColumnLayout,
} from "@/lib/campaigns-table/columns";

/* ─── Fixtures ─── */

/** Every CampaignRow field, populated. Typed so a schema change surfaces here. */
const BASE_ROW: CampaignRow = {
  id: "base",
  name: "Base",
  type: "Team",
  status: "Active",
  description: "desc",
  assigned_agent_ids: [],
  tags: [],
  user_id: "owner-1",
  created_by: "creator-1",
  created_at: "2026-01-01T00:00:00.000Z",
  organization_id: "org-1",
  retry_interval_minutes: 30,
  retry_interval_hours: null,
  max_attempts: 3,
  calling_hours_start: "09:00",
  calling_hours_end: "17:00",
  ring_timeout_seconds: 25,
  total_leads: 40,
  leads_called: 10,
};

function row(id: string, overrides: Partial<CampaignRow> = {}): CampaignRow {
  return { ...BASE_ROW, id, name: id, ...overrides };
}

const ids = (rows: CampaignRow[]) => rows.map((r) => r.id);

function stats(total: number, called: number, contacted: number, converted: number, policiesSold = 0): CampaignCardStats {
  return { total, called, contacted, converted, policiesSold };
}

const val = (n: number): MetricState => ({ kind: "value", value: n });
const LOADING: MetricState = { kind: "loading" };
const ERROR: MetricState = { kind: "error" };
const UNAVAILABLE: MetricState = { kind: "unavailable" };

function metrics(overrides: Partial<CampaignMetrics> = {}): CampaignMetrics {
  return { total: UNAVAILABLE, called: UNAVAILABLE, contacted: UNAVAILABLE, converted: UNAVAILABLE, ...overrides };
}

const ALL_SORT_KEYS: SortKey[] = ["created", "name", "status", "type", "progress", "total", "converted", "contacted", "last_dialed"];

/* ─── Projection ─── */

describe("CAMPAIGN_LIST_COLUMNS", () => {
  const cols = CAMPAIGN_LIST_COLUMNS.split(",").map((c) => c.trim());

  it("includes the trigger-maintained total_leads and leads_called", () => {
    expect(cols).toContain("total_leads");
    expect(cols).toContain("leads_called");
  });

  it("never selects the unmaintained leads_contacted / leads_converted, and is not a wildcard", () => {
    expect(cols).not.toContain("leads_contacted");
    expect(cols).not.toContain("leads_converted");
    expect(CAMPAIGN_LIST_COLUMNS).not.toMatch(/leads_contacted|leads_converted/);
    expect(cols).not.toContain("*");
  });

  it("is an explicit projection of exactly the CampaignRow fields, without duplicates", () => {
    expect(new Set(cols).size).toBe(cols.length);
    expect([...cols].sort()).toEqual(Object.keys(BASE_ROW).sort());
  });
});

/* ─── Type keys & list parsing ─── */

describe("campaignTypeKey", () => {
  it.each([
    ["Personal", "personal"],
    ["personal", "personal"],
    ["  PERSONAL  ", "personal"],
    ["Team", "team"],
    ["team", "team"],
    ["\tTEAM\n", "team"],
    ["Open Pool", "open"],
    ["open pool", "open"],
    [" Open Pool ", "open"],
    ["OPEN", "open"],
    ["open", "open"],
    ["  Open ", "open"],
  ])("%j → %s", (input, expected) => {
    expect(campaignTypeKey(input)).toBe(expected);
  });

  it.each([["OpenPool"], ["Open  Pool"], ["Agency"], [""], ["   "]])("%j → other", (input) => {
    expect(campaignTypeKey(input)).toBe("other");
  });

  it("null / undefined → other", () => {
    expect(campaignTypeKey(null)).toBe("other");
    expect(campaignTypeKey(undefined)).toBe("other");
  });
});

describe("parseStringList", () => {
  it("returns array entries as strings, dropping null / undefined", () => {
    expect(parseStringList(["a", null, "b", undefined, 3])).toEqual(["a", "b", "3"]);
    expect(parseStringList([])).toEqual([]);
  });

  it("parses a JSON-encoded array string", () => {
    expect(parseStringList('["u1","u2"]')).toEqual(["u1", "u2"]);
    expect(parseStringList('["u1",null,7]')).toEqual(["u1", "7"]);
    expect(parseStringList("[]")).toEqual([]);
  });

  it("returns [] for garbage, non-array JSON and non-list values", () => {
    expect(parseStringList("not json")).toEqual([]);
    expect(parseStringList("")).toEqual([]);
    expect(parseStringList('{"a":1}')).toEqual([]);
    expect(parseStringList('"u1"')).toEqual([]);
    expect(parseStringList("5")).toEqual([]);
    expect(parseStringList("null")).toEqual([]);
    expect(parseStringList(null)).toEqual([]);
    expect(parseStringList(undefined)).toEqual([]);
    expect(parseStringList(42)).toEqual([]);
    expect(parseStringList({ 0: "a", length: 1 })).toEqual([]);
  });
});

/* ─── Metrics ─── */

describe("resolveCampaignMetrics", () => {
  const r = row("c1", { total_leads: 999, leads_called: 888 });

  it("uses the stats map value when present (never the stored columns)", () => {
    const view: StatsView = { status: "ready", map: { c1: stats(40, 12, 7, 2, 5) } };
    expect(resolveCampaignMetrics(r, view)).toEqual({
      total: val(40), called: val(12), contacted: val(7), converted: val(2),
    });
  });

  it("exposes only total / called / contacted / converted (policiesSold is not a table metric)", () => {
    const view: StatsView = { status: "ready", map: { c1: stats(1, 1, 1, 1, 9) } };
    expect(Object.keys(resolveCampaignMetrics(r, view)).sort()).toEqual(["called", "contacted", "converted", "total"]);
  });

  it("renders a genuine zero from the RPC as value 0", () => {
    const view: StatsView = { status: "ready", map: { c1: stats(0, 0, 0, 0) } };
    const m = resolveCampaignMetrics(r, view);
    expect(m).toEqual({ total: val(0), called: val(0), contacted: val(0), converted: val(0) });
    expect(metricNumber(m.total)).toBe(0);
  });

  it("is loading on the first fetch (no map entry)", () => {
    const view: StatsView = { status: "loading", map: {} };
    expect(resolveCampaignMetrics(r, view)).toEqual({
      total: LOADING, called: LOADING, contacted: LOADING, converted: LOADING,
    });
  });

  it("placeholder map while loading: an id already present shows values, a new id shows loading", () => {
    const view: StatsView = { status: "loading", map: { c1: stats(5, 4, 3, 2) } };
    expect(resolveCampaignMetrics(r, view)).toEqual({
      total: val(5), called: val(4), contacted: val(3), converted: val(2),
    });
    expect(resolveCampaignMetrics(row("new-id"), view)).toEqual({
      total: LOADING, called: LOADING, contacted: LOADING, converted: LOADING,
    });
  });

  it("is error (never zero, never stored) when the request failed with no data", () => {
    const view: StatsView = { status: "error", map: {} };
    expect(resolveCampaignMetrics(r, view)).toEqual({
      total: ERROR, called: ERROR, contacted: ERROR, converted: ERROR,
    });
  });

  it("keeps an existing map entry even while status is error", () => {
    const view: StatsView = { status: "error", map: { c1: stats(3, 2, 1, 0) } };
    expect(resolveCampaignMetrics(r, view)).toEqual({
      total: val(3), called: val(2), contacted: val(1), converted: val(0),
    });
  });

  it("ready response that omits the campaign: Total / Called fall back to stored values; Contacted / Converted unavailable", () => {
    const view: StatsView = { status: "ready", map: { other: stats(1, 1, 1, 1) } };
    expect(resolveCampaignMetrics(r, view)).toEqual({
      total: val(999), called: val(888), contacted: UNAVAILABLE, converted: UNAVAILABLE,
    });
  });

  it("ready + omitted with stored zeros keeps genuine zeros", () => {
    const view: StatsView = { status: "ready", map: {} };
    expect(resolveCampaignMetrics(row("z", { total_leads: 0, leads_called: 0 }), view)).toEqual({
      total: val(0), called: val(0), contacted: UNAVAILABLE, converted: UNAVAILABLE,
    });
  });

  it("ready + omitted with null (or non-finite) stored values → unavailable", () => {
    const view: StatsView = { status: "ready", map: {} };
    expect(resolveCampaignMetrics(row("n", { total_leads: null, leads_called: null }), view)).toEqual({
      total: UNAVAILABLE, called: UNAVAILABLE, contacted: UNAVAILABLE, converted: UNAVAILABLE,
    });
    expect(resolveCampaignMetrics(row("nan", { total_leads: Number.NaN, leads_called: Number.POSITIVE_INFINITY }), view)).toEqual({
      total: UNAVAILABLE, called: UNAVAILABLE, contacted: UNAVAILABLE, converted: UNAVAILABLE,
    });
    expect(resolveCampaignMetrics(row("mixed", { total_leads: 12, leads_called: null }), view)).toEqual({
      total: val(12), called: UNAVAILABLE, contacted: UNAVAILABLE, converted: UNAVAILABLE,
    });
  });

  it("never reads stored leads_contacted / leads_converted, even if they are present on the object", () => {
    const legacy = { ...row("legacy"), leads_contacted: 77, leads_converted: 66 } as unknown as CampaignRow;
    const m = resolveCampaignMetrics(legacy, { status: "ready", map: {} });
    expect(m.contacted).toEqual(UNAVAILABLE);
    expect(m.converted).toEqual(UNAVAILABLE);
  });
});

describe("metricNumber", () => {
  it("returns the number only for value states", () => {
    expect(metricNumber(val(7))).toBe(7);
    expect(metricNumber(val(0))).toBe(0);
    expect(metricNumber(LOADING)).toBeNull();
    expect(metricNumber(ERROR)).toBeNull();
    expect(metricNumber(UNAVAILABLE)).toBeNull();
  });
});

describe("progressPercent", () => {
  it("is called / total as a percentage", () => {
    expect(progressPercent(metrics({ total: val(200), called: val(50) }))).toBe(25);
    expect(progressPercent(metrics({ total: val(3), called: val(1) }))).toBeCloseTo(33.333, 2);
    expect(progressPercent(metrics({ total: val(10), called: val(10) }))).toBe(100);
    expect(progressPercent(metrics({ total: val(10), called: val(0) }))).toBe(0);
  });

  it("is null when either side is unknown", () => {
    for (const unknown of [LOADING, ERROR, UNAVAILABLE]) {
      expect(progressPercent(metrics({ total: unknown, called: val(1) }))).toBeNull();
      expect(progressPercent(metrics({ total: val(10), called: unknown }))).toBeNull();
    }
  });

  it("is 0 (not NaN / Infinity) when total is 0", () => {
    expect(progressPercent(metrics({ total: val(0), called: val(0) }))).toBe(0);
    expect(progressPercent(metrics({ total: val(0), called: val(5) }))).toBe(0);
  });

  it("clamps to 0–100", () => {
    expect(progressPercent(metrics({ total: val(10), called: val(25) }))).toBe(100);
    expect(progressPercent(metrics({ total: val(10), called: val(-5) }))).toBe(0);
  });

  it("does not depend on contacted / converted", () => {
    expect(progressPercent(metrics({ total: val(4), called: val(1), contacted: UNAVAILABLE, converted: ERROR }))).toBe(25);
  });
});

/* ─── Filters ─── */

describe("filterCampaigns", () => {
  const rows: CampaignRow[] = [
    row("p1", { name: "Spring Personal", type: "Personal", status: "Active", description: "team notes", tags: ["team"] }),
    row("t1", { name: "Team Alpha", type: "Team", status: "Paused" }),
    row("o1", { name: "Open Pool Main", type: "Open Pool", status: "Active" }),
    row("o2", { name: "Legacy Open", type: "OPEN", status: "Draft" }),
    row("o3", { name: "spaced", type: "  open pool ", status: "Archived" }),
    row("x1", { name: "Weird Type", type: "Agency", status: "Completed" }),
  ];

  const f = (overrides: Partial<CampaignFilters>): CampaignFilters => ({ ...DEFAULT_FILTERS, ...overrides });

  it("default filters return every row in input order", () => {
    expect(ids(filterCampaigns(rows, DEFAULT_FILTERS))).toEqual(ids(rows));
    expect(DEFAULT_FILTERS).toEqual({ search: "", type: "all", status: "all" });
  });

  it("search is case-insensitive, trimmed, substring on the name only", () => {
    expect(ids(filterCampaigns(rows, f({ search: "  ALPHA  " })))).toEqual(["t1"]);
    expect(ids(filterCampaigns(rows, f({ search: "open" })))).toEqual(["o1", "o2"]);
    // "team" appears in p1's description and tags but not its name.
    expect(ids(filterCampaigns(rows, f({ search: "team" })))).toEqual(["t1"]);
    // Type text is not searched.
    expect(ids(filterCampaigns(rows, f({ search: "personal" })))).toEqual(["p1"]);
    expect(ids(filterCampaigns(rows, f({ search: "agency" })))).toEqual([]);
    expect(ids(filterCampaigns(rows, f({ search: "   " })))).toEqual(ids(rows));
  });

  it("tolerates a null name when searching", () => {
    const nameless = { ...row("nn"), name: null } as unknown as CampaignRow;
    expect(ids(filterCampaigns([nameless, ...rows], f({ search: "alpha" })))).toEqual(["t1"]);
    expect(ids(filterCampaigns([nameless], DEFAULT_FILTERS))).toEqual(["nn"]);
  });

  it("type filter uses the normalized type key (open matches Open Pool and legacy OPEN)", () => {
    expect(ids(filterCampaigns(rows, f({ type: "open" })))).toEqual(["o1", "o2", "o3"]);
    expect(ids(filterCampaigns(rows, f({ type: "team" })))).toEqual(["t1"]);
    expect(ids(filterCampaigns(rows, f({ type: "personal" })))).toEqual(["p1"]);
  });

  it("status filter matches exactly", () => {
    expect(ids(filterCampaigns(rows, f({ status: "Active" })))).toEqual(["p1", "o1"]);
    expect(ids(filterCampaigns(rows, f({ status: "Archived" })))).toEqual(["o3"]);
    expect(ids(filterCampaigns(rows, f({ status: "Completed" })))).toEqual(["x1"]);
  });

  it("combines search, type and status with AND", () => {
    expect(ids(filterCampaigns(rows, f({ type: "open", status: "Active" })))).toEqual(["o1"]);
    expect(ids(filterCampaigns(rows, f({ type: "open", status: "Draft", search: "legacy" })))).toEqual(["o2"]);
    expect(ids(filterCampaigns(rows, f({ type: "open", status: "Draft", search: "main" })))).toEqual([]);
    expect(ids(filterCampaigns(rows, f({ type: "team", status: "Active" })))).toEqual([]);
  });

  it("does not mutate the input", () => {
    const input = [...rows];
    filterCampaigns(input, f({ type: "open" }));
    expect(input).toEqual(rows);
  });
});

describe("isDefaultView", () => {
  it("is true only for default filters (blank search after trim) and created/desc", () => {
    expect(isDefaultView(DEFAULT_FILTERS, DEFAULT_SORT)).toBe(true);
    expect(isDefaultView({ ...DEFAULT_FILTERS, search: "   " }, DEFAULT_SORT)).toBe(true);
    expect(isDefaultView({ ...DEFAULT_FILTERS, search: "x" }, DEFAULT_SORT)).toBe(false);
    expect(isDefaultView({ ...DEFAULT_FILTERS, type: "team" }, DEFAULT_SORT)).toBe(false);
    expect(isDefaultView({ ...DEFAULT_FILTERS, status: "Active" }, DEFAULT_SORT)).toBe(false);
    expect(isDefaultView(DEFAULT_FILTERS, { key: "name", dir: "desc" })).toBe(false);
    expect(isDefaultView(DEFAULT_FILTERS, { key: "created", dir: "asc" })).toBe(false);
  });
});

/* ─── Sorting ─── */

describe("sort constants", () => {
  it("DEFAULT_SORT is created / desc and SORT_LABELS covers every sort key", () => {
    expect(DEFAULT_SORT).toEqual({ key: "created", dir: "desc" });
    expect(Object.keys(SORT_LABELS).sort()).toEqual([...ALL_SORT_KEYS].sort());
    expect(SORT_LABELS.progress).toBe("Lead progress");
  });

  it("defaultDirFor: text-like keys ascend, measures and dates descend", () => {
    const expected: Record<SortKey, SortDir> = {
      name: "asc", status: "asc", type: "asc",
      created: "desc", progress: "desc", total: "desc", converted: "desc", contacted: "desc", last_dialed: "desc",
    };
    for (const key of ALL_SORT_KEYS) expect(defaultDirFor(key)).toBe(expected[key]);
  });
});

describe("sortCampaigns", () => {
  const EMPTY_CTX: SortContext = { metrics: {}, lastDialed: null };

  describe("created", () => {
    const rows = [
      row("c-mid", { created_at: "2026-02-01T00:00:00Z" }),
      row("c-null", { created_at: null }),
      row("c-old", { created_at: "2026-01-01T00:00:00Z" }),
      row("c-bad", { created_at: "not-a-date" }),
      row("c-new-b", { created_at: "2026-03-01T00:00:00Z" }),
      row("c-new-a", { created_at: "2026-03-01T00:00:00Z" }),
    ];

    it("asc: oldest first; ties by id; null / invalid dates last", () => {
      expect(ids(sortCampaigns(rows, { key: "created", dir: "asc" }, EMPTY_CTX)))
        .toEqual(["c-old", "c-mid", "c-new-a", "c-new-b", "c-bad", "c-null"]);
    });

    it("desc: newest first; ties by id; null / invalid dates still last", () => {
      expect(ids(sortCampaigns(rows, { key: "created", dir: "desc" }, EMPTY_CTX)))
        .toEqual(["c-new-a", "c-new-b", "c-mid", "c-old", "c-bad", "c-null"]);
    });
  });

  describe("name", () => {
    const rows = [
      row("n-charlie", { name: "charlie", created_at: "2026-01-01T00:00:00Z" }),
      row("n-bravo", { name: "Bravo", created_at: "2026-01-02T00:00:00Z" }),
      row("n-echo-old", { name: "Echo", created_at: "2026-01-03T00:00:00Z" }),
      row("n-alpha", { name: "alpha", created_at: "2026-01-04T00:00:00Z" }),
      row("n-echo-new", { name: "echo", created_at: "2026-01-05T00:00:00Z" }),
      row("n-delta", { name: "Delta", created_at: "2026-01-06T00:00:00Z" }),
    ];

    it("asc is case-insensitive; equal names fall back to newest first", () => {
      expect(ids(sortCampaigns(rows, { key: "name", dir: "asc" }, EMPTY_CTX)))
        .toEqual(["n-alpha", "n-bravo", "n-charlie", "n-delta", "n-echo-new", "n-echo-old"]);
    });

    it("desc reverses names but ties stay newest first", () => {
      expect(ids(sortCampaigns(rows, { key: "name", dir: "desc" }, EMPTY_CTX)))
        .toEqual(["n-echo-new", "n-echo-old", "n-delta", "n-charlie", "n-bravo", "n-alpha"]);
    });
  });

  describe("status", () => {
    const rows = [
      row("s-draft", { status: "Draft", created_at: "2026-01-01T00:00:00Z" }),
      row("s-archived", { status: "Archived", created_at: "2026-01-02T00:00:00Z" }),
      row("s-active-old", { status: "Active", created_at: "2026-01-03T00:00:00Z" }),
      row("s-completed", { status: "Completed", created_at: "2026-01-04T00:00:00Z" }),
      row("s-paused", { status: "Paused", created_at: "2026-01-05T00:00:00Z" }),
      row("s-active-new", { status: "Active", created_at: "2026-01-06T00:00:00Z" }),
    ];

    it("asc follows the lifecycle rank Active, Paused, Draft, Completed, Archived (not alphabetical)", () => {
      expect(ids(sortCampaigns(rows, { key: "status", dir: "asc" }, EMPTY_CTX)))
        .toEqual(["s-active-new", "s-active-old", "s-paused", "s-draft", "s-completed", "s-archived"]);
    });

    it("desc reverses the rank; ties stay newest first", () => {
      expect(ids(sortCampaigns(rows, { key: "status", dir: "desc" }, EMPTY_CTX)))
        .toEqual(["s-archived", "s-completed", "s-draft", "s-paused", "s-active-new", "s-active-old"]);
    });
  });

  describe("type", () => {
    const rows = [
      row("ty-team-old", { type: "Team", created_at: "2026-01-01T00:00:00Z" }),
      row("ty-open-legacy", { type: "OPEN", created_at: "2026-01-02T00:00:00Z" }),
      row("ty-personal", { type: "Personal", created_at: "2026-01-03T00:00:00Z" }),
      row("ty-open-pool", { type: "Open Pool", created_at: "2026-01-04T00:00:00Z" }),
      row("ty-team-new", { type: "  team ", created_at: "2026-01-05T00:00:00Z" }),
    ];

    it("asc sorts by display label Open Pool, Personal, Team (legacy OPEN groups with Open Pool)", () => {
      expect(ids(sortCampaigns(rows, { key: "type", dir: "asc" }, EMPTY_CTX)))
        .toEqual(["ty-open-pool", "ty-open-legacy", "ty-personal", "ty-team-new", "ty-team-old"]);
    });

    it("desc reverses the labels; ties stay newest first", () => {
      expect(ids(sortCampaigns(rows, { key: "type", dir: "desc" }, EMPTY_CTX)))
        .toEqual(["ty-team-new", "ty-team-old", "ty-personal", "ty-open-pool", "ty-open-legacy"]);
    });
  });

  describe.each([
    ["total", "total"],
    ["contacted", "contacted"],
    ["converted", "converted"],
  ] as const)("%s", (key, field) => {
    const rows = [
      row("m10-old", { created_at: "2026-01-01T00:00:00Z" }),
      row("m-missing", { created_at: null }),
      row("m30", { created_at: "2026-01-02T00:00:00Z" }),
      row("m-loading", { created_at: "2026-01-05T00:00:00Z" }),
      row("m20", { created_at: "2026-01-03T00:00:00Z" }),
      row("m-error", { created_at: "2026-01-07T00:00:00Z" }),
      row("m10-new", { created_at: "2026-01-04T00:00:00Z" }),
      row("m-unavailable", { created_at: "2026-01-06T00:00:00Z" }),
      row("m0", { created_at: "2026-01-08T00:00:00Z" }),
    ];
    const ctx: SortContext = {
      lastDialed: null,
      metrics: {
        "m10-old": metrics({ [field]: val(10) }),
        m30: metrics({ [field]: val(30) }),
        "m-loading": metrics({ [field]: LOADING }),
        m20: metrics({ [field]: val(20) }),
        "m-error": metrics({ [field]: ERROR }),
        "m10-new": metrics({ [field]: val(10) }),
        "m-unavailable": metrics({ [field]: UNAVAILABLE }),
        m0: metrics({ [field]: val(0) }),
        // "m-missing" has no metrics entry at all.
      },
    };
    const UNKNOWN_TAIL = ["m-error", "m-unavailable", "m-loading", "m-missing"];

    it("asc: genuine zero is a value; ties newest first; unknown values last", () => {
      expect(ids(sortCampaigns(rows, { key, dir: "asc" }, ctx)))
        .toEqual(["m0", "m10-new", "m10-old", "m20", "m30", ...UNKNOWN_TAIL]);
    });

    it("desc: unknown values are still last (not first)", () => {
      expect(ids(sortCampaigns(rows, { key, dir: "desc" }, ctx)))
        .toEqual(["m30", "m20", "m10-new", "m10-old", "m0", ...UNKNOWN_TAIL]);
    });
  });

  describe("progress", () => {
    const rows = [
      row("p25-old", { created_at: "2026-01-01T00:00:00Z" }),
      row("p-total-unknown", { created_at: "2026-01-09T00:00:00Z" }),
      row("p100-clamped", { created_at: "2026-01-02T00:00:00Z" }),
      row("p0-empty", { created_at: "2026-01-03T00:00:00Z" }),
      row("p-missing", { created_at: null }),
      row("p50", { created_at: "2026-01-04T00:00:00Z" }),
      row("p-called-unknown", { created_at: "2026-01-08T00:00:00Z" }),
      row("p25-new", { created_at: "2026-01-05T00:00:00Z" }),
      row("p75", { created_at: "2026-01-06T00:00:00Z" }),
    ];
    const ctx: SortContext = {
      lastDialed: null,
      metrics: {
        "p25-old": metrics({ total: val(40), called: val(10) }),
        "p-total-unknown": metrics({ total: LOADING, called: val(1) }),
        "p100-clamped": metrics({ total: val(5), called: val(9) }),
        "p0-empty": metrics({ total: val(0), called: val(0) }),
        p50: metrics({ total: val(10), called: val(5) }),
        "p-called-unknown": metrics({ total: val(10), called: ERROR }),
        "p25-new": metrics({ total: val(4), called: val(1) }),
        p75: metrics({ total: val(4), called: val(3) }),
      },
    };
    const UNKNOWN_TAIL = ["p-total-unknown", "p-called-unknown", "p-missing"];

    it("asc by called / total; ties newest first; unknown last", () => {
      expect(ids(sortCampaigns(rows, { key: "progress", dir: "asc" }, ctx)))
        .toEqual(["p0-empty", "p25-new", "p25-old", "p50", "p75", "p100-clamped", ...UNKNOWN_TAIL]);
    });

    it("desc by called / total; unknown still last", () => {
      expect(ids(sortCampaigns(rows, { key: "progress", dir: "desc" }, ctx)))
        .toEqual(["p100-clamped", "p75", "p50", "p25-new", "p25-old", "p0-empty", ...UNKNOWN_TAIL]);
    });
  });

  describe("last_dialed", () => {
    const rows = [
      row("d-early", { created_at: "2026-01-01T00:00:00Z" }),
      row("d-null", { created_at: "2026-01-05T00:00:00Z" }),
      row("d-late", { created_at: "2026-01-02T00:00:00Z" }),
      row("d-absent", { created_at: "2026-01-04T00:00:00Z" }),
      row("d-bad", { created_at: "2026-01-06T00:00:00Z" }),
      row("d-mid", { created_at: "2026-01-03T00:00:00Z" }),
    ];
    const ctx: SortContext = {
      metrics: {},
      lastDialed: {
        "d-early": "2026-03-01T10:00:00Z",
        "d-null": null,
        "d-late": "2026-03-03T10:00:00Z",
        "d-bad": "garbage",
        "d-mid": "2026-03-02T10:00:00Z",
        // "d-absent" has no entry.
      },
    };
    const UNKNOWN_TAIL = ["d-bad", "d-null", "d-absent"];

    it("asc: earliest dial first; never-dialed / invalid last", () => {
      expect(ids(sortCampaigns(rows, { key: "last_dialed", dir: "asc" }, ctx)))
        .toEqual(["d-early", "d-mid", "d-late", ...UNKNOWN_TAIL]);
    });

    it("desc: latest dial first; never-dialed / invalid still last", () => {
      expect(ids(sortCampaigns(rows, { key: "last_dialed", dir: "desc" }, ctx)))
        .toEqual(["d-late", "d-mid", "d-early", ...UNKNOWN_TAIL]);
    });

    it("before last-dialed data loads every row is unknown, so both directions use the newest-first fallback", () => {
      const expected = ["d-bad", "d-null", "d-absent", "d-mid", "d-late", "d-early"];
      expect(ids(sortCampaigns(rows, { key: "last_dialed", dir: "asc" }, EMPTY_CTX))).toEqual(expected);
      expect(ids(sortCampaigns(rows, { key: "last_dialed", dir: "desc" }, EMPTY_CTX))).toEqual(expected);
    });
  });

  describe("tie fallback", () => {
    it("equal values fall back to created_at desc, then id asc, in both directions", () => {
      const rows = [
        row("b", { name: "Same", created_at: "2026-01-01T00:00:00Z" }),
        row("a", { name: "Same", created_at: "2026-01-01T00:00:00Z" }),
        row("z-null", { name: "Same", created_at: null }),
        row("y-null", { name: "Same", created_at: null }),
        row("newest", { name: "Same", created_at: "2026-05-01T00:00:00Z" }),
      ];
      const expected = ["newest", "a", "b", "y-null", "z-null"];
      for (const dir of ["asc", "desc"] as const) {
        expect(ids(sortCampaigns(rows, { key: "name", dir }, EMPTY_CTX))).toEqual(expected);
      }
    });

    it("unknown values among themselves use the same fallback", () => {
      const rows = [row("b", { created_at: null }), row("a", { created_at: null }), row("c", { created_at: "2026-01-01T00:00:00Z" })];
      for (const dir of ["asc", "desc"] as const) {
        expect(ids(sortCampaigns(rows, { key: "total", dir }, EMPTY_CTX))).toEqual(["c", "a", "b"]);
      }
    });
  });

  describe.each(ALL_SORT_KEYS)("invariants for %s", (key) => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      row(`r${String(i).padStart(2, "0")}`, {
        name: `Name ${(i * 7) % 13}`,
        status: CAMPAIGN_STATUSES[i % CAMPAIGN_STATUSES.length],
        type: ["Personal", "Team", "Open Pool", "OPEN"][i % 4],
        created_at: i % 9 === 0 ? null : new Date(Date.UTC(2026, 0, 1 + (i % 17))).toISOString(),
      }),
    );
    const ctx: SortContext = {
      metrics: Object.fromEntries(
        rows.filter((_, i) => i % 5 !== 0).map((r, i) => [
          r.id,
          i % 4 === 0
            ? metrics({ total: LOADING, called: LOADING, contacted: LOADING, converted: LOADING })
            : metrics({ total: val((i * 3) % 11), called: val((i * 2) % 7), contacted: val(i % 6), converted: val(i % 3) }),
        ]),
      ),
      lastDialed: Object.fromEntries(
        rows.map((r, i) => [r.id, i % 3 === 0 ? null : new Date(Date.UTC(2026, 2, 1 + (i % 11))).toISOString()]),
      ),
    };

    it.each(["asc", "desc"] as const)("%s: returns a new permutation of the full set without mutating input", (dir) => {
      const input = [...rows];
      const out = sortCampaigns(input, { key, dir }, ctx);
      expect(out).not.toBe(input);
      expect(ids(input)).toEqual(ids(rows));
      expect(out).toHaveLength(rows.length);
      expect([...ids(out)].sort()).toEqual([...ids(rows)].sort());
    });

    it("is deterministic regardless of input order", () => {
      for (const dir of ["asc", "desc"] as const) {
        const forward = ids(sortCampaigns(rows, { key, dir }, ctx));
        const reversed = ids(sortCampaigns([...rows].reverse(), { key, dir }, ctx));
        expect(reversed).toEqual(forward);
      }
    });
  });
});

/* ─── Roles ─── */

describe("isLeadershipViewer", () => {
  it.each([
    [{ role: "Admin" }, true],
    [{ role: "Team Leader" }, true],
    [{ role: "Super Admin" }, true],
    [{ role: "Agent", is_super_admin: true }, true],
    [{ role: null, is_super_admin: true }, true],
    [{ role: "Agent" }, false],
    [{ role: "Team Lead" }, false],
    [{ role: "Agent", is_super_admin: false }, false],
    [{ role: "Agent", is_super_admin: null }, false],
    [{ role: null }, false],
    [{}, false],
  ])("%j → %s", (viewer, expected) => {
    expect(isLeadershipViewer(viewer)).toBe(expected);
  });

  it("null / undefined profile → false", () => {
    expect(isLeadershipViewer(null)).toBe(false);
    expect(isLeadershipViewer(undefined)).toBe(false);
  });
});

describe("duplicateEligibility (legacy card-page rule, unchanged)", () => {
  const USER = "user-1";
  const notOwned = row("n", { created_by: "someone-else", assigned_agent_ids: ["other-agent"] });
  const created = row("c", { created_by: USER, assigned_agent_ids: [] });
  const assigned = row("a", { created_by: "someone-else", assigned_agent_ids: ["x", USER] });
  const assignedJson = row("j", { created_by: "someone-else", assigned_agent_ids: JSON.stringify(["x", USER]) });
  const ALL_ROWS = [notOwned, created, assigned, assignedJson];

  it.each(["Agent", "agent", "AGENT"])("role %j → hidden for every campaign", (role) => {
    for (const r of ALL_ROWS) expect(duplicateEligibility(role, r, USER)).toBe("hidden");
    expect(duplicateEligibility(role, created, null)).toBe("hidden");
  });

  it.each(["Admin", "admin", "ADMIN"])("role %j → allowed for every campaign, owner or not", (role) => {
    for (const r of ALL_ROWS) expect(duplicateEligibility(role, r, USER)).toBe("allowed");
    expect(duplicateEligibility(role, notOwned, null)).toBe("allowed");
    expect(duplicateEligibility(role, notOwned, undefined)).toBe("allowed");
  });

  describe.each(["Team Leader", "team leader", "TEAM LEADER", "team_leader", "Team_Leader"])("role %j", (role) => {
    it("allowed when the viewer created the campaign", () => {
      expect(duplicateEligibility(role, created, USER)).toBe("allowed");
    });

    it("allowed when the viewer is in assigned_agent_ids (array or JSON string)", () => {
      expect(duplicateEligibility(role, assigned, USER)).toBe("allowed");
      expect(duplicateEligibility(role, assignedJson, USER)).toBe("allowed");
    });

    it("owner_only when the viewer neither created nor is assigned", () => {
      expect(duplicateEligibility(role, notOwned, USER)).toBe("owner_only");
    });

    it("owner_only without a user id, even when created_by is null", () => {
      const ownerless = row("o", { created_by: null, assigned_agent_ids: [] });
      expect(duplicateEligibility(role, ownerless, null)).toBe("owner_only");
      expect(duplicateEligibility(role, ownerless, undefined)).toBe("owner_only");
      expect(duplicateEligibility(role, created, null)).toBe("owner_only");
      expect(duplicateEligibility(role, assigned, undefined)).toBe("owner_only");
    });

    it("an empty user id never matches an empty created_by", () => {
      expect(duplicateEligibility(role, row("e", { created_by: "", assigned_agent_ids: [] }), "")).toBe("owner_only");
    });

    it("JSON-string assignees are parsed, not substring-matched", () => {
      const lookalike = row("l", { created_by: "someone-else", assigned_agent_ids: JSON.stringify(["user-10"]) });
      expect(duplicateEligibility(role, lookalike, USER)).toBe("owner_only");
      const garbage = row("g", { created_by: "someone-else", assigned_agent_ids: `not json ${USER}` });
      expect(duplicateEligibility(role, garbage, USER)).toBe("owner_only");
    });
  });

  it.each(["Super Admin", "super admin", "Team Lead", "team lead", "Manager", ""])(
    "role %j → owner_only even for the creator / an assignee",
    (role) => {
      for (const r of ALL_ROWS) expect(duplicateEligibility(role, r, USER)).toBe("owner_only");
    },
  );

  it("null / undefined role → owner_only", () => {
    for (const r of ALL_ROWS) {
      expect(duplicateEligibility(null, r, USER)).toBe("owner_only");
      expect(duplicateEligibility(undefined, r, USER)).toBe("owner_only");
    }
  });
});

/* ─── Duplicate payload ─── */

describe("buildDuplicatePayload", () => {
  const EXPECTED_KEYS = [
    "assigned_agent_ids", "created_by", "description", "leads_contacted", "leads_converted",
    "name", "organization_id", "status", "tags", "total_leads", "type",
  ];

  it("builds the exact legacy insert shape (configuration only, zeroed counters, Draft)", () => {
    const src = row("src-1", {
      name: "Spring Push",
      type: "Open Pool",
      status: "Active",
      description: "Q2 outreach",
      assigned_agent_ids: ["a1", "a2"],
      tags: ["hot", "q2"],
      total_leads: 500,
      leads_called: 120,
    });
    const payload = buildDuplicatePayload(src, "user-9", "org-7");
    expect(payload).toStrictEqual({
      name: "Spring Push (Copy)",
      type: "Open Pool",
      description: "Q2 outreach",
      assigned_agent_ids: ["a1", "a2"],
      tags: ["hot", "q2"],
      status: "Draft",
      total_leads: 0,
      leads_contacted: 0,
      leads_converted: 0,
      created_by: "user-9",
      organization_id: "org-7",
    });
    expect(Object.keys(payload).sort()).toEqual(EXPECTED_KEYS);
  });

  it("never carries the source id, owner, lead counts or dialing settings", () => {
    const payload = buildDuplicatePayload(row("src-2"), "u", "org") as Record<string, unknown>;
    for (const key of ["id", "user_id", "created_at", "leads_called", "max_attempts", "retry_interval_minutes", "ring_timeout_seconds"]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("passes assigned_agent_ids / tags through by reference, falling back to [] when empty", () => {
    const assignedRef = ["a"];
    const tagsRef = ["t"];
    const p = buildDuplicatePayload(row("r", { assigned_agent_ids: assignedRef, tags: tagsRef }), "u", "org");
    expect(p.assigned_agent_ids).toBe(assignedRef);
    expect(p.tags).toBe(tagsRef);

    const json = '["a","b"]';
    expect(buildDuplicatePayload(row("r", { assigned_agent_ids: json }), "u", "org").assigned_agent_ids).toBe(json);

    for (const empty of [null, undefined, ""]) {
      const q = buildDuplicatePayload(row("r", { assigned_agent_ids: empty, tags: empty }), "u", "org");
      expect(q.assigned_agent_ids).toEqual([]);
      expect(q.tags).toEqual([]);
    }
  });

  it("created_by is the user id or null", () => {
    expect(buildDuplicatePayload(row("r"), "user-1", "org").created_by).toBe("user-1");
    expect(buildDuplicatePayload(row("r"), null, "org").created_by).toBeNull();
    expect(buildDuplicatePayload(row("r"), undefined, "org").created_by).toBeNull();
    expect(buildDuplicatePayload(row("r"), "", "org").created_by).toBeNull();
  });

  it("passes description and organization_id through unchanged (including null)", () => {
    expect(buildDuplicatePayload(row("r", { description: null }), "u", "org").description).toBeNull();
    expect(buildDuplicatePayload(row("r", { description: "  padded  " }), "u", "org").description).toBe("  padded  ");
    expect(buildDuplicatePayload(row("r"), "u", null).organization_id).toBeNull();
  });
});

describe("DuplicatePayloadSchema", () => {
  const valid = () => buildDuplicatePayload(
    row("r", { name: "  Spaced Name  ", type: "Team", description: "  keep me  ", assigned_agent_ids: ["a"], tags: ["t"] }),
    "user-1",
    "org-1",
  );

  it("accepts a built payload and passes every value through unmodified", () => {
    const payload = valid();
    const parsed = DuplicatePayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toStrictEqual(payload);
    expect(parsed.data.name).toBe("  Spaced Name   (Copy)");
    expect(parsed.data.description).toBe("  keep me  ");
    expect(parsed.data.assigned_agent_ids).toBe(payload.assigned_agent_ids);
    expect(parsed.data.tags).toBe(payload.tags);
  });

  it("accepts null description and null created_by", () => {
    expect(DuplicatePayloadSchema.safeParse({ ...valid(), description: null, created_by: null }).success).toBe(true);
  });

  it("accepts a JSON-string assigned_agent_ids as stored (passthrough)", () => {
    const parsed = DuplicatePayloadSchema.safeParse({ ...valid(), assigned_agent_ids: '["a"]' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.assigned_agent_ids).toBe('["a"]');
  });

  it("strips keys outside the insert shape", () => {
    const parsed = DuplicatePayloadSchema.safeParse({ ...valid(), id: "src", leads_called: 9, user_id: "x" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("id");
      expect(parsed.data).not.toHaveProperty("leads_called");
      expect(parsed.data).not.toHaveProperty("user_id");
    }
  });

  it.each([
    ["blank name", { name: "   " }],
    ["empty name", { name: "" }],
    ["blank type", { type: "  " }],
    ["null organization", { organization_id: null }],
    ["empty organization", { organization_id: "" }],
    ["missing organization", { organization_id: undefined }],
    ["non-Draft status", { status: "Active" }],
    ["non-zero total_leads", { total_leads: 5 }],
    ["non-zero leads_contacted", { leads_contacted: 1 }],
    ["non-zero leads_converted", { leads_converted: 1 }],
    ["non-string description", { description: 5 }],
    ["non-string created_by", { created_by: 5 }],
  ])("rejects %s", (_label, override) => {
    expect(DuplicatePayloadSchema.safeParse({ ...valid(), ...override }).success).toBe(false);
  });

  it("rejects the payload built without an organization", () => {
    expect(DuplicatePayloadSchema.safeParse(buildDuplicatePayload(row("r"), "u", null)).success).toBe(false);
  });
});

/* ─── Assignees ─── */

describe("agentsModel", () => {
  it("Personal → the owner (user_id) only; assigned_agent_ids ignored", () => {
    expect(agentsModel(row("p", { type: "Personal", user_id: "owner", assigned_agent_ids: ["x"] })))
      .toEqual({ kind: "personal", ids: ["owner"] });
    expect(agentsModel(row("p", { type: "personal", user_id: null, assigned_agent_ids: ["x"] })))
      .toEqual({ kind: "personal", ids: [] });
  });

  it("Team → parsed assigned_agent_ids (array or JSON string)", () => {
    expect(agentsModel(row("t", { type: "Team", assigned_agent_ids: ["a", "b"] }))).toEqual({ kind: "team", ids: ["a", "b"] });
    expect(agentsModel(row("t", { type: "Team", assigned_agent_ids: '["c"]' }))).toEqual({ kind: "team", ids: ["c"] });
    expect(agentsModel(row("t", { type: "Team", assigned_agent_ids: null }))).toEqual({ kind: "team", ids: [] });
  });

  it("Open Pool (and legacy OPEN) → kind open with its assignees", () => {
    expect(agentsModel(row("o", { type: "Open Pool", assigned_agent_ids: [] }))).toEqual({ kind: "open", ids: [] });
    expect(agentsModel(row("o", { type: "OPEN", assigned_agent_ids: ["z"] }))).toEqual({ kind: "open", ids: ["z"] });
  });

  it("unknown type → kind other", () => {
    expect(agentsModel(row("x", { type: "Agency", assigned_agent_ids: ["q"] }))).toEqual({ kind: "other", ids: ["q"] });
  });
});

describe("collectAssigneeIds", () => {
  it("collects Personal owners, Team participants and Open Pool assignees, unique and sorted", () => {
    const rows = [
      row("p1", { type: "Personal", user_id: "u-owner", assigned_agent_ids: ["ignored-personal-assignee"] }),
      row("t1", { type: "Team", assigned_agent_ids: ["u-c", "u-a"] }),
      row("t2", { type: "Team", assigned_agent_ids: JSON.stringify(["u-a", "u-owner"]) }),
      row("o1", { type: "Open Pool", assigned_agent_ids: ["u-b"] }),
      row("p2", { type: "Personal", user_id: null }),
    ];
    expect(collectAssigneeIds(rows)).toEqual(["u-a", "u-b", "u-c", "u-owner"]);
  });

  it("returns [] for no rows", () => {
    expect(collectAssigneeIds([])).toEqual([]);
  });
});

describe("idsHash", () => {
  it("is the id count plus a 32-bit FNV-1a hex digest of the sorted, comma-joined ids", () => {
    expect(idsHash([])).toBe("0:811c9dc5");
    expect(idsHash(["a"])).toBe("1:e40c292c");
    expect(idsHash(["x", "y", "z"])).toMatch(/^3:[0-9a-f]{1,8}$/);
  });

  it("is order-independent and does not mutate the input", () => {
    const input = ["c", "a", "b"];
    expect(idsHash(input)).toBe(idsHash(["a", "b", "c"]));
    expect(idsHash(input)).toBe(idsHash(["b", "c", "a"]));
    expect(input).toEqual(["c", "a", "b"]);
  });

  it("distinct id sets produce distinct keys", () => {
    expect(idsHash(["a", "b"])).not.toBe(idsHash(["a", "c"]));
    expect(idsHash(["a"])).not.toBe(idsHash(["a", "b"]));
  });

  it("the length prefix separates sets whose joined strings collide", () => {
    const one = idsHash(["a,b"]);
    const two = idsHash(["a", "b"]);
    expect(one.split(":")[1]).toBe(two.split(":")[1]);
    expect(one).toBe(`1:${one.split(":")[1]}`);
    expect(two).toBe(`2:${two.split(":")[1]}`);
    expect(one).not.toBe(two);
  });
});

/* ─── Columns ─── */

describe("column registry", () => {
  it("lists the configurable columns; Campaign, Actions and the chevron are not part of it", () => {
    expect([...COLUMN_IDS]).toEqual(["status", "progress", "agents", "converted", "contacted", "created", "tags", "last_dialed"]);
    for (const fixed of ["campaign", "name", "actions", "chevron", "expand"]) expect(isColumnId(fixed)).toBe(false);
  });

  it("every definition is keyed by its own id and sorts by a real SortKey (or not at all)", () => {
    for (const id of COLUMN_IDS) {
      const def = COLUMN_DEFS[id];
      expect(def.id).toBe(id);
      expect(def.label.length).toBeGreaterThan(0);
      if (def.sortKey !== null) expect(ALL_SORT_KEYS).toContain(def.sortKey);
    }
    expect(COLUMN_DEFS.agents.sortKey).toBeNull();
    expect(COLUMN_DEFS.tags.sortKey).toBeNull();
    expect(COLUMN_DEFS.progress.label).toBe("Lead progress");
  });
});

describe("DEFAULT_COLUMN_LAYOUT", () => {
  it("shows status, progress, agents and converted by default", () => {
    expect(DEFAULT_COLUMN_LAYOUT.order).toEqual([...COLUMN_IDS]);
    expect(DEFAULT_COLUMN_LAYOUT.hidden).toEqual(["contacted", "created", "tags", "last_dialed"]);
    expect(visibleColumns(DEFAULT_COLUMN_LAYOUT)).toEqual(["status", "progress", "agents", "converted"]);
    for (const id of COLUMN_IDS) {
      expect(DEFAULT_COLUMN_LAYOUT.hidden.includes(id)).toBe(!COLUMN_DEFS[id].defaultVisible);
    }
  });

  it("is frozen", () => {
    expect(Object.isFrozen(DEFAULT_COLUMN_LAYOUT)).toBe(true);
  });
});

describe("isColumnId", () => {
  it("accepts every registry id and rejects anything else", () => {
    for (const id of COLUMN_IDS) expect(isColumnId(id)).toBe(true);
    for (const bad of ["Status", " status", "", null, undefined, 1, {}, ["status"]]) expect(isColumnId(bad)).toBe(false);
  });
});

describe("normalizeColumnLayout", () => {
  const defaults = (): ColumnLayout => ({ order: [...COLUMN_IDS], hidden: ["contacted", "created", "tags", "last_dialed"] });

  it("null / undefined → fresh copies of the defaults", () => {
    for (const input of [null, undefined]) {
      const out = normalizeColumnLayout(input);
      expect(out).toEqual(defaults());
      expect(out.order).not.toBe(DEFAULT_COLUMN_LAYOUT.order);
      expect(out.hidden).not.toBe(DEFAULT_COLUMN_LAYOUT.hidden);
    }
    const out = normalizeColumnLayout(null);
    out.order.reverse();
    out.hidden.length = 0;
    expect(DEFAULT_COLUMN_LAYOUT).toEqual(defaults());
  });

  it("all columns missing (empty / non-array / garbage order) → defaults", () => {
    expect(normalizeColumnLayout({})).toEqual(defaults());
    expect(normalizeColumnLayout({ order: [], hidden: [] })).toEqual(defaults());
    expect(normalizeColumnLayout({ order: "status,progress", hidden: "tags" })).toEqual(defaults());
    expect(normalizeColumnLayout({ order: ["nope", 3, null], hidden: ["status"] })).toEqual(defaults());
  });

  it("keeps a complete stored layout as-is", () => {
    const order: ColumnId[] = ["last_dialed", "tags", "created", "contacted", "converted", "agents", "progress", "status"];
    const out = normalizeColumnLayout({ order, hidden: ["agents", "status"] });
    expect(out.order).toEqual(order);
    expect(out.hidden).toEqual(["agents", "status"]);
  });

  it("drops unknown and duplicate ids from order and hidden", () => {
    const out = normalizeColumnLayout({
      order: ["tags", "bogus", "status", "tags", 7, "progress", "agents", "converted", "contacted", "created", "last_dialed", "status"],
      hidden: ["status", "bogus", "status", null, "tags"],
    });
    expect(out.order).toEqual(["tags", "status", "progress", "agents", "converted", "contacted", "created", "last_dialed"]);
    expect(out.hidden).toEqual(["tags", "status"]);
  });

  it("hidden is limited to known columns and returned in display order", () => {
    const out = normalizeColumnLayout({ order: [...COLUMN_IDS], hidden: ["last_dialed", "status", "agents"] });
    expect(out.hidden).toEqual(["status", "agents", "last_dialed"]);
  });

  it("stored hidden entries for columns missing from the stored order are ignored (default visibility applies)", () => {
    // "status" and "tags" are missing from order; status defaults visible, tags defaults hidden.
    const out = normalizeColumnLayout({
      order: ["progress", "agents", "converted", "contacted", "created", "last_dialed"],
      hidden: ["status"],
    });
    expect(out.order).toEqual(["status", "progress", "agents", "converted", "contacted", "created", "tags", "last_dialed"]);
    expect(out.hidden).toEqual(["tags"]);
  });

  it("inserts a missing column after its default predecessor with its default visibility", () => {
    const out = normalizeColumnLayout({
      order: ["agents", "status", "progress", "converted", "created", "tags", "last_dialed"],
      hidden: ["status"],
    });
    expect(out.order).toEqual(["agents", "status", "progress", "converted", "contacted", "created", "tags", "last_dialed"]);
    expect(out.hidden).toEqual(["status", "contacted"]);
  });

  it("a missing first column (no predecessor) is inserted at the start", () => {
    const out = normalizeColumnLayout({
      order: ["converted", "progress", "agents", "contacted", "created", "tags", "last_dialed"],
      hidden: [],
    });
    expect(out.order[0]).toBe("status");
    expect(out.hidden).toEqual([]);
  });

  it("chains insertions when consecutive columns are missing, relative to the stored order", () => {
    const out = normalizeColumnLayout({ order: ["tags", "status"], hidden: [] });
    expect(out.order).toEqual(["tags", "last_dialed", "status", "progress", "agents", "converted", "contacted", "created"]);
    expect(out.hidden).toEqual(["last_dialed", "contacted", "created"]);
  });

  it("is idempotent and does not mutate its input", () => {
    const order = Object.freeze(["tags", "status", "bogus"]);
    const hidden = Object.freeze(["status"]);
    const once = normalizeColumnLayout({ order, hidden });
    expect(normalizeColumnLayout(once)).toEqual(once);
    expect(order).toEqual(["tags", "status", "bogus"]);
    expect(hidden).toEqual(["status"]);
  });

  it("always returns every column exactly once", () => {
    const out = normalizeColumnLayout({ order: ["created", "created", "agents"], hidden: ["agents", "x"] });
    expect([...out.order].sort()).toEqual([...COLUMN_IDS].sort());
    expect(new Set(out.order).size).toBe(COLUMN_IDS.length);
  });
});

describe("visibleColumns", () => {
  it("returns the order minus hidden columns", () => {
    expect(visibleColumns({ order: ["tags", "status", "agents"], hidden: ["status"] })).toEqual(["tags", "agents"]);
    expect(visibleColumns({ order: [...COLUMN_IDS], hidden: [...COLUMN_IDS] })).toEqual([]);
    expect(visibleColumns({ order: ["converted", "status"], hidden: [] })).toEqual(["converted", "status"]);
  });
});

describe("sameColumnLayout", () => {
  it("is order-sensitive for columns and order-insensitive for the hidden set", () => {
    const a: ColumnLayout = { order: ["status", "progress"], hidden: ["progress", "status"] };
    expect(sameColumnLayout(a, { order: ["status", "progress"], hidden: ["status", "progress"] })).toBe(true);
    expect(sameColumnLayout(a, { order: ["progress", "status"], hidden: ["progress", "status"] })).toBe(false);
    expect(sameColumnLayout(a, { order: ["status", "progress"], hidden: ["status"] })).toBe(false);
    expect(sameColumnLayout(DEFAULT_COLUMN_LAYOUT, normalizeColumnLayout(null))).toBe(true);
  });

  it("does not mutate the hidden arrays it compares", () => {
    const hidden: ColumnId[] = ["tags", "agents"];
    sameColumnLayout({ order: [], hidden }, { order: [], hidden: ["agents", "tags"] });
    expect(hidden).toEqual(["tags", "agents"]);
  });
});
