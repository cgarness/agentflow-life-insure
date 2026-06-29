/**
 * Contacts Build 4 — Kanban data contract + drag-resolution unit tests.
 *
 * Covers the pure pieces the board relies on:
 *  - toLeadKanbanPayload: preserves scope/filters but drops the single-status
 *    filter (D1) and pagination.
 *  - parseKanbanResult: jsonb → typed { stages, grandTotal, perColumnLimit }.
 *  - buildKanbanColumns: deterministic order (sort_order, name, id), EXACT
 *    per-stage totals (not card count), explicit Unmapped column (D3), records
 *    never dropped.
 *  - resolveDragTarget: empty/truncated columns are valid drop targets; Unmapped
 *    is a no-op target (D4); drag OUT of Unmapped allowed; unchanged → no-op.
 */
import { describe, it, expect } from "vitest";
import type { Lead, Recruit, PipelineStage } from "@/lib/types";
import {
  toLeadKanbanPayload,
  parseKanbanResult,
  type LeadFilterPayload,
  type KanbanStageData,
} from "@/lib/contactsFilters";
import {
  buildKanbanColumns,
  resolveDragTarget,
  resolveDragOutcome,
  orderPipelineStages,
  COLUMN_DROP_PREFIX,
  UNMAPPED_KEY,
} from "@/lib/contactsKanban";

const stage = (
  id: string,
  name: string,
  order: number,
  color = "#000",
  convertToClient = false,
): PipelineStage => ({
  id,
  name,
  color,
  isDefault: false,
  convertToClient,
  order,
  pipelineType: "lead",
});

const card = (id: string, status: string | null) => ({ id, status }) as unknown as Lead;

describe("toLeadKanbanPayload (D1)", () => {
  const full: LeadFilterPayload = {
    scope: "team",
    agent_ids: ["a1", "a2"],
    search: "smith",
    status: "Quoted",
    source: "Facebook",
    state: "TX",
    created_start: "2026-01-01",
    created_end: "2026-02-01",
    timezone_states: ["TX", "CA"],
    callable_states: ["TX"],
    attempt_buckets: ["1-3"],
    last_disposition: "Interested",
    sort_column: "name",
    sort_direction: "asc",
    page: 3,
    page_size: 50,
  };

  it("drops the single-status filter (columns ARE the statuses)", () => {
    expect(toLeadKanbanPayload(full).status).toBeNull();
  });

  it("drops pagination (Kanban shows full per-stage counts)", () => {
    const out = toLeadKanbanPayload(full);
    expect(out.page).toBeUndefined();
    expect(out.page_size).toBeUndefined();
  });

  it("preserves scope + every other filter + sort", () => {
    const out = toLeadKanbanPayload(full);
    expect(out.scope).toBe("team");
    expect(out.agent_ids).toEqual(["a1", "a2"]);
    expect(out.search).toBe("smith");
    expect(out.source).toBe("Facebook");
    expect(out.state).toBe("TX");
    expect(out.created_start).toBe("2026-01-01");
    expect(out.created_end).toBe("2026-02-01");
    expect(out.timezone_states).toEqual(["TX", "CA"]);
    expect(out.callable_states).toEqual(["TX"]);
    expect(out.attempt_buckets).toEqual(["1-3"]);
    expect(out.last_disposition).toBe("Interested");
    expect(out.sort_column).toBe("name");
    expect(out.sort_direction).toBe("asc");
  });
});

describe("parseKanbanResult", () => {
  it("maps the jsonb shape and coerces numeric strings", () => {
    const raw = {
      grand_total: "7",
      per_column_limit: 50,
      stages: [
        { status: "New", total: "5", cards: [{ id: "l1", status: "New" }] },
        { status: "Lost", total: 2, cards: [] },
      ],
    };
    const out = parseKanbanResult<Lead>(raw, (r) => r as Lead);
    expect(out.grandTotal).toBe(7);
    expect(out.perColumnLimit).toBe(50);
    expect(out.stages).toHaveLength(2);
    expect(out.stages[0]).toMatchObject({ status: "New", total: 5 });
    expect(out.stages[0].cards).toHaveLength(1);
  });

  it("defaults gracefully on empty/missing payload", () => {
    const out = parseKanbanResult<Lead>(null, (r) => r as Lead);
    expect(out).toEqual({ stages: [], perColumnLimit: 50, grandTotal: 0 });
  });

  it("preserves a null status (→ Unmapped downstream)", () => {
    const out = parseKanbanResult<Lead>({ stages: [{ status: null, total: 3, cards: [] }] }, (r) => r as Lead);
    expect(out.stages[0].status).toBeNull();
  });
});

describe("orderPipelineStages (D5 deterministic order)", () => {
  it("orders by sort_order, then name, then id when sort_order ties", () => {
    const stages = [
      stage("id-z", "Zeta", 1),
      stage("id-a", "Alpha", 1), // tie on order with Zeta → name breaks it
      stage("id-2", "New", 0),
      stage("id-1b", "Dup", 3),
      stage("id-1a", "Dup", 3), // identical order+name → id breaks it
    ];
    const ordered = orderPipelineStages(stages).map((s) => `${s.name}:${s.id}`);
    expect(ordered).toEqual(["New:id-2", "Alpha:id-a", "Zeta:id-z", "Dup:id-1a", "Dup:id-1b"]);
  });
});

describe("buildKanbanColumns", () => {
  const stages = [stage("s-new", "New", 0), stage("s-quote", "Quoted", 1), stage("s-sold", "Sold", 2)];

  it("renders a column per configured stage in order, with EXACT totals (not card count)", () => {
    const data: KanbanStageData<Lead | Recruit>[] = [
      { status: "New", total: 312, cards: [card("l1", "New"), card("l2", "New")] }, // truncated slice
      { status: "Quoted", total: 0, cards: [] },
    ];
    const cols = buildKanbanColumns(data, stages);
    expect(cols.map((c) => c.key)).toEqual(["New", "Quoted", "Sold"]); // Sold has no data → still a column
    expect(cols[0].total).toBe(312); // exact full count, not 2
    expect(cols[0].cards).toHaveLength(2);
    expect(cols[1].total).toBe(0);
    expect(cols[2].total).toBe(0); // Sold absent from data → 0, present as a column
    expect(cols.some((c) => c.isUnmapped)).toBe(false);
  });

  it("appends an explicit Unmapped column for off-stage + null statuses (D3) — records never disappear", () => {
    const data: KanbanStageData<Lead | Recruit>[] = [
      { status: "New", total: 1, cards: [card("l1", "New")] },
      { status: "Legacy Status", total: 4, cards: [card("l2", "Legacy Status")] },
      { status: null, total: 2, cards: [card("l3", null)] },
    ];
    const cols = buildKanbanColumns(data, stages);
    const unmapped = cols.find((c) => c.isUnmapped);
    expect(unmapped).toBeDefined();
    expect(unmapped!.key).toBe(UNMAPPED_KEY);
    expect(unmapped!.total).toBe(6); // 4 + 2 merged
    expect(unmapped!.cards.map((c) => c.id).sort()).toEqual(["l2", "l3"]);
    // Unmapped is always last.
    expect(cols[cols.length - 1].isUnmapped).toBe(true);
  });

  it("does not render an Unmapped column when every status maps", () => {
    const data: KanbanStageData<Lead | Recruit>[] = [{ status: "New", total: 1, cards: [card("l1", "New")] }];
    expect(buildKanbanColumns(data, stages).some((c) => c.isUnmapped)).toBe(false);
  });
});

describe("resolveDragTarget", () => {
  const stages = [stage("s-new", "New", 0), stage("s-quote", "Quoted", 1)];
  const data: KanbanStageData<Lead | Recruit>[] = [
    { status: "New", total: 300, cards: [card("a", "New"), card("b", "New")] }, // truncated
    { status: "Quoted", total: 0, cards: [] }, // empty
    { status: "Legacy", total: 1, cards: [card("u", "Legacy")] }, // unmapped
  ];
  const columns = buildKanbanColumns(data, stages);
  const col = (key: string) => COLUMN_DROP_PREFIX + key;

  it("dropping on an EMPTY column persists that stage", () => {
    expect(resolveDragTarget({ activeId: "a", overId: col("Quoted"), columns })).toBe("Quoted");
  });

  it("dropping on a TRUNCATED column persists that stage", () => {
    // 'u' is unmapped → moving it into a column with a bounded slice still works.
    expect(resolveDragTarget({ activeId: "u", overId: col("New"), columns })).toBe("New");
  });

  it("dropping over a card adopts that card's column status", () => {
    expect(resolveDragTarget({ activeId: "u", overId: "a", columns })).toBe("New");
  });

  it("dropping INTO the Unmapped column is a no-op (D4)", () => {
    expect(resolveDragTarget({ activeId: "a", overId: col(UNMAPPED_KEY), columns })).toBeNull();
  });

  it("dropping over an unmapped card is a no-op", () => {
    expect(resolveDragTarget({ activeId: "a", overId: "u", columns })).toBeNull();
  });

  it("unchanged status is a no-op", () => {
    expect(resolveDragTarget({ activeId: "a", overId: col("New"), columns })).toBeNull();
  });

  it("dragging OUT of Unmapped into a real stage is allowed", () => {
    expect(resolveDragTarget({ activeId: "u", overId: col("Quoted"), columns })).toBe("Quoted");
  });

  it("unknown active card is a no-op", () => {
    expect(resolveDragTarget({ activeId: "ghost", overId: col("New"), columns })).toBeNull();
  });

  it("unknown column key is a no-op", () => {
    expect(resolveDragTarget({ activeId: "a", overId: col("DoesNotExist"), columns })).toBeNull();
  });
});

describe("buildKanbanColumns — convertToClient flag (Fix 4)", () => {
  const stages = [stage("s-new", "New", 0), stage("s-sold", "Sold", 1, "#000", true)];

  it("copies convertToClient onto configured columns; Unmapped is always false", () => {
    const data: KanbanStageData<Lead | Recruit>[] = [
      { status: "New", total: 1, cards: [card("a", "New")] },
      { status: "Legacy", total: 1, cards: [card("u", "Legacy")] }, // → Unmapped
    ];
    const cols = buildKanbanColumns(data, stages);
    expect(cols.find((c) => c.key === "New")!.convertToClient).toBe(false);
    expect(cols.find((c) => c.key === "Sold")!.convertToClient).toBe(true);
    expect(cols.find((c) => c.isUnmapped)!.convertToClient).toBe(false);
  });
});

describe("resolveDragOutcome — convert vs status vs no-op (Fix 4)", () => {
  // New + Quoted are normal stages; Sold is a convert_to_client stage.
  const stages = [stage("s-new", "New", 0), stage("s-quote", "Quoted", 1), stage("s-sold", "Sold", 2, "#000", true)];
  const data: KanbanStageData<Lead | Recruit>[] = [
    { status: "New", total: 1, cards: [card("a", "New")] },
    { status: "Quoted", total: 0, cards: [] },
    { status: "Sold", total: 0, cards: [] },
  ];
  const columns = buildKanbanColumns(data, stages);
  const col = (key: string) => COLUMN_DROP_PREFIX + key;

  it("dropping a lead on a convert_to_client stage → { kind: 'convert' }", () => {
    expect(resolveDragOutcome({ activeId: "a", overId: col("Sold"), columns })).toEqual({ kind: "convert", status: "Sold" });
  });

  it("dropping a lead on a normal stage → { kind: 'status' }", () => {
    expect(resolveDragOutcome({ activeId: "a", overId: col("Quoted"), columns })).toEqual({ kind: "status", status: "Quoted" });
  });

  it("a no-op drag (unchanged status) → { kind: 'none' }", () => {
    expect(resolveDragOutcome({ activeId: "a", overId: col("New"), columns })).toEqual({ kind: "none" });
  });
});
