// Rev 7 C8 — the browser must NEVER auto-finalize an inbound row found by the agent-wide
// mount-time orphan query. That query selects "my newest ringing/connected call" with no tie to
// this browser's actual call leg, so a second tab opened during a live inbound call would complete
// the winning row out from under it. Inbound lifecycle is provider/webhook authoritative; inbound
// orphans may only ever be surfaced READ-ONLY.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canBrowserFinalizeOrphanRow,
  classifyOrphanRecovery,
  ORPHAN_STALE_RINGING_MS,
} from "@/lib/inboundCallOwnership";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");
const fresh = new Date(NOW - 10_000).toISOString();
const stale = new Date(NOW - ORPHAN_STALE_RINGING_MS - 60_000).toISOString();

describe("C8.1 — a second tab during an active inbound call performs ZERO calls-row writes", () => {
  it("an inbound connected row is surfaced read-only, never finalized", () => {
    expect(
      classifyOrphanRecovery(
        { direction: "inbound", status: "connected", started_at: fresh },
        NOW,
      ),
    ).toBe("surface_inbound_readonly");
  });

  it("legacy 'incoming' direction is treated identically", () => {
    expect(
      classifyOrphanRecovery(
        { direction: "incoming", status: "connected", started_at: fresh },
        NOW,
      ),
    ).toBe("surface_inbound_readonly");
  });

  it("the browser may never finalize an inbound orphan row", () => {
    expect(canBrowserFinalizeOrphanRow("inbound")).toBe(false);
    expect(canBrowserFinalizeOrphanRow("incoming")).toBe(false);
  });
});

describe("C8.3 — inbound mount-time stale cleanup performs zero writes", () => {
  it("an inbound row ringing past the stale threshold is still read-only (no failed-marking)", () => {
    expect(
      classifyOrphanRecovery(
        { direction: "inbound", status: "ringing", started_at: stale },
        NOW,
      ),
    ).toBe("surface_inbound_readonly");
  });

  it("a missing/unknown direction is treated as NOT browser-finalizable (fail closed)", () => {
    expect(canBrowserFinalizeOrphanRow(null)).toBe(false);
    expect(canBrowserFinalizeOrphanRow(undefined)).toBe(false);
    expect(canBrowserFinalizeOrphanRow("")).toBe(false);
    expect(
      classifyOrphanRecovery({ direction: null, status: "connected", started_at: fresh }, NOW),
    ).toBe("surface_inbound_readonly");
  });
});

describe("C8.4 — outbound orphan behavior is unchanged", () => {
  it("outbound ringing past the threshold still stale-cleans", () => {
    expect(
      classifyOrphanRecovery(
        { direction: "outbound", status: "ringing", started_at: stale },
        NOW,
      ),
    ).toBe("stale_cleanup");
  });

  it("outbound ringing inside the threshold silently finalizes (existing recovery)", () => {
    expect(
      classifyOrphanRecovery(
        { direction: "outbound", status: "ringing", started_at: fresh },
        NOW,
      ),
    ).toBe("silent_finalize");
  });

  it("outbound connected silently finalizes, and legacy 'outgoing' matches", () => {
    expect(
      classifyOrphanRecovery(
        { direction: "outbound", status: "connected", started_at: fresh },
        NOW,
      ),
    ).toBe("silent_finalize");
    expect(
      classifyOrphanRecovery(
        { direction: "outgoing", status: "connected", started_at: null },
        NOW,
      ),
    ).toBe("silent_finalize");
  });

  it("outbound rows remain browser-finalizable", () => {
    expect(canBrowserFinalizeOrphanRow("outbound")).toBe(true);
    expect(canBrowserFinalizeOrphanRow("outgoing")).toBe(true);
  });

  it("the stale threshold is unchanged at 5 minutes", () => {
    expect(ORPHAN_STALE_RINGING_MS).toBe(5 * 60 * 1000);
  });
});

describe("C8.5 — no browser source path auto-finalizes an inbound orphan", () => {
  const src = readFileSync(resolve(__dirname, "../../contexts/TwilioContext.tsx"), "utf8");
  const orphanStart = src.indexOf("const checkOrphanedCalls");
  const orphanEnd = src.indexOf("const hangUpOrphan");
  const orphanBody = src.slice(orphanStart, orphanEnd);
  const hangUpOrphanBody = src.slice(orphanEnd, src.indexOf("const dismissOrphanCall"));

  it("the orphan query selects direction so inbound can be excluded", () => {
    expect(orphanStart).toBeGreaterThan(-1);
    expect(/select\([^)]*direction/.test(orphanBody)).toBe(true);
  });

  it("the sweep routes through the pure classifier instead of writing unconditionally", () => {
    expect(orphanBody.includes("classifyOrphanRecovery")).toBe(true);
  });

  it("hangUpOrphan cannot issue a calls UPDATE for an inbound orphan", () => {
    expect(hangUpOrphanBody.includes("canBrowserFinalizeOrphanRow")).toBe(true);
  });

  it("the surfaced orphan carries its direction so the UI can render inbound read-only", () => {
    expect(src.includes("interface OrphanCall")).toBe(true);
    const typeBlock = src.slice(src.indexOf("interface OrphanCall"), src.indexOf("interface OrphanCall") + 400);
    expect(typeBlock.includes("direction")).toBe(true);
  });

  it("no newest-row/phone/SID/agent-wide replacement guess was introduced", () => {
    expect(orphanBody.includes("peek_inbound_call_identity")).toBe(false);
    expect(orphanBody.includes("provider_session_id")).toBe(false);
    expect(orphanBody.includes("phone_last10")).toBe(false);
  });
});
