// Rev 6 C5 — Realtime identity/display processing is EXACT-ROW scoped.
// The `calls` Realtime subscription covers every call in the organization, so an unrelated inbound
// row assigned to the SAME user must never repaint the current ring's ANI/name/contact or flip
// ownership. Ownership, ANI, name, and contact reconciliation operate only on the row identified by
// inboundCallRowIdRef.current (the server-issued af_call_row_id) — no newest-ringing, phone,
// org-wide, or browser-SID guessing.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyInboundOwnership,
  classifyRealtimeInboundRow,
  pickInboundDisplayPhone,
  type InboundOwnership,
} from "@/lib/inboundCallOwnership";

const ME = "99999999-8888-4777-a666-555555555544";
const OTHER = "00000000-1111-4222-a333-444444444455";
const ROW_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

interface RealtimeRow {
  id: string;
  direction: string;
  agent_id: string | null;
  contact_phone?: string | null;
  caller_id_used?: string | null;
  contact_name?: string | null;
  contact_id?: string | null;
}

/**
 * Behavior-level fold mirroring the TwilioContext Realtime handler wiring:
 * classify → (ignore | ownership observation | ownership + display reconcile).
 * The source-contract block below pins the real handler to this exact composition.
 */
interface DisplayState {
  ownership: InboundOwnership;
  ani: string;
  name: string;
  contactId: string | null;
}

function foldRealtimeEvents(
  currentInboundRowId: string | null,
  events: RealtimeRow[],
): DisplayState {
  const state: DisplayState = { ownership: "pending", ani: "", name: "", contactId: null };
  for (const row of events) {
    const action = classifyRealtimeInboundRow({
      rowId: row.id,
      rowDirection: row.direction,
      rowAgentId: row.agent_id,
      currentInboundRowId,
      myUserId: ME,
    });
    if (action === "ignore") continue;
    state.ownership = classifyInboundOwnership(row.agent_id, ME);
    if (action === "observe") continue; // lost race: observation only, never a display repaint
    const ani = pickInboundDisplayPhone(row);
    if (ani) state.ani = ani;
    if (typeof row.contact_name === "string" && row.contact_name.trim()) {
      state.name = row.contact_name.trim();
    }
    if (row.contact_id) state.contactId = String(row.contact_id);
  }
  return state;
}

const ringA: RealtimeRow = {
  id: ROW_A,
  direction: "inbound",
  agent_id: null,
  contact_phone: "+15550001111",
  contact_name: "Alice Caller",
  contact_id: "lead-A",
};

describe("C5 — two simultaneous inbound rows, same org, same user", () => {
  it("updates to row B leave row A's ownership, ANI, name, and contact unchanged", () => {
    const state = foldRealtimeEvents(ROW_A, [
      ringA,
      // Row B: unrelated simultaneous inbound call...
      { id: ROW_B, direction: "inbound", agent_id: null, contact_phone: "+15559998888", contact_name: "Bob Other", contact_id: "lead-B" },
      // ...which THIS SAME USER answers on another tab/device:
      { id: ROW_B, direction: "inbound", agent_id: ME, contact_phone: "+15559998888", contact_name: "Bob Other", contact_id: "lead-B" },
      // ...and which later gets enriched:
      { id: ROW_B, direction: "inbound", agent_id: ME, contact_phone: "+15559998888", contact_name: "Bob Renamed", contact_id: "client-B" },
    ]);
    expect(state.ownership).toBe("pending"); // B's assignedMine must NOT flip A's ownership
    expect(state.ani).toBe("+15550001111");
    expect(state.name).toBe("Alice Caller");
    expect(state.contactId).toBe("lead-A");
  });

  it("an unrelated row is ignored even when its agent_id equals the current user", () => {
    expect(
      classifyRealtimeInboundRow({
        rowId: ROW_B,
        rowDirection: "inbound",
        rowAgentId: ME,
        currentInboundRowId: ROW_A,
        myUserId: ME,
      }),
    ).toBe("ignore");
  });
});

describe("C5 — the exact current row keeps full lifecycle handling", () => {
  it("exact unassigned current ring → display processed", () => {
    expect(
      classifyRealtimeInboundRow({
        rowId: ROW_A,
        rowDirection: "inbound",
        rowAgentId: null,
        currentInboundRowId: ROW_A,
        myUserId: ME,
      }),
    ).toBe("observe_and_display");
  });

  it("exact row becoming assigned to me → ownership mine + display", () => {
    const state = foldRealtimeEvents(ROW_A, [
      ringA,
      { ...ringA, agent_id: ME },
    ]);
    expect(state.ownership).toBe("mine");
    expect(state.ani).toBe("+15550001111");
  });

  it("exact row claimed by another agent → ownership observation only, no display repaint", () => {
    expect(
      classifyRealtimeInboundRow({
        rowId: ROW_A,
        rowDirection: "inbound",
        rowAgentId: OTHER,
        currentInboundRowId: ROW_A,
        myUserId: ME,
      }),
    ).toBe("observe");
    const state = foldRealtimeEvents(ROW_A, [
      ringA,
      { id: ROW_A, direction: "inbound", agent_id: OTHER, contact_phone: "+15550001111", contact_name: "Should Not Paint", contact_id: "x" },
    ]);
    expect(state.ownership).toBe("lost");
    expect(state.name).toBe("Alice Caller"); // the lost event observed ownership but did not repaint
  });

  it("late enrichment of the exact row still lands", () => {
    const state = foldRealtimeEvents(ROW_A, [
      ringA,
      { ...ringA, agent_id: ME, contact_name: "Alice Linked", contact_id: "client-A" },
    ]);
    expect(state.name).toBe("Alice Linked");
    expect(state.contactId).toBe("client-A");
  });
});

describe("C5 — no fallback keying of any kind", () => {
  it("without a known af_call_row_id nothing is processed (no newest-ringing/org-wide guessing)", () => {
    expect(
      classifyRealtimeInboundRow({
        rowId: ROW_A,
        rowDirection: "inbound",
        rowAgentId: null,
        currentInboundRowId: null,
        myUserId: ME,
      }),
    ).toBe("ignore");
  });

  it("non-inbound rows are ignored", () => {
    expect(
      classifyRealtimeInboundRow({
        rowId: ROW_A,
        rowDirection: "outbound",
        rowAgentId: ME,
        currentInboundRowId: ROW_A,
        myUserId: ME,
      }),
    ).toBe("ignore");
  });
});

describe("C5 — the real handler is pinned to the exact-row composition", () => {
  const src = readFileSync(
    resolve(__dirname, "../../contexts/TwilioContext.tsx"),
    "utf8",
  );

  it("routes every Realtime calls event through classifyRealtimeInboundRow", () => {
    expect(src.includes("classifyRealtimeInboundRow")).toBe(true);
  });

  it("the org-wide assignedMine bypass is gone", () => {
    expect(src.includes("assignedMine")).toBe(false);
  });

  it("browser-SID matching no longer authorizes display reconciliation", () => {
    expect(src.includes("sessionMatch")).toBe(false);
    expect(src.includes("controlMatch")).toBe(false);
    expect(src.includes("providerCallSidsEqual")).toBe(false);
  });

  it("BOTH bounded polls re-classify after their await (a mid-flight ref re-key is ignored)", () => {
    // The ring-identity poll and the post-answer watch each fetch by rowId, await, and must then
    // route the resolved row back through classifyRealtimeInboundRow before any display call —
    // three call sites total (Realtime handler + 2 polls).
    const calls = src.match(/classifyRealtimeInboundRow\(\{/g) || [];
    expect(calls.length).toBe(3);
  });

  it("async reconcile re-validates the ring at every write point (stillCurrent guard)", () => {
    const fnIdx = src.indexOf("const reconcileIdentifiedContactFromCallsRow");
    const body = src.slice(fnIdx, src.indexOf("const applyInboundAniFromCallsRow"));
    expect(body.includes("stillCurrent")).toBe(true);
    // every setIdentifiedContact inside reconcile sits behind the guard
    expect((body.match(/stillCurrent\(\)/g) || []).length).toBeGreaterThanOrEqual(4);
  });

  it("applyInboundAniFromCallsRow only paints the exact current row", () => {
    const fnIdx = src.indexOf("const applyInboundAniFromCallsRow");
    const body = src.slice(fnIdx, fnIdx + 1400);
    expect(body.includes("inboundCallRowIdRef.current")).toBe(true);
  });

  it("'mine' observation arms the active refs ONLY on a leg this browser answered (multi-tab)", () => {
    // A second tab/device ringing the same identity sees agent_id = me via Realtime while its own
    // leg is still 'incoming'; arming activeCallIdRef there would let its Twilio 'cancel' finalize
    // the LIVE call. The mine branch must require callStateRef.current === "active".
    const fnIdx = src.indexOf("const applyInboundOwnershipObservation");
    const mineIdx = src.indexOf('if (ownership === "mine")', fnIdx);
    const lostIdx = src.indexOf('ownership === "lost"', mineIdx);
    const mineBlock = src.slice(mineIdx, lostIdx);
    expect(mineBlock.includes('callStateRef.current === "active"')).toBe(true);
  });

  it("a new ring cancels the previous call's pending 200ms cosmetic reset (no stale wipe)", () => {
    const wireIdx = src.indexOf("const wireTwilioCall");
    const head = src.slice(wireIdx, wireIdx + 1600);
    expect(head.includes("endResetRef.current")).toBe(true);
    expect(head.includes("clearTimeout(endResetRef.current)")).toBe(true);
  });
});
