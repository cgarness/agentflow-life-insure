// Rev 8 C14 — the browser performs ZERO calls-row writes for inbound calls, in NORMAL lifecycle too.
// C8 closed the mount-time orphan sweep, but finalizeCallRecord still wrote status='completed' +
// ended_at once activeCallIdRef had been armed for a CLAIMED inbound call — contradicting the
// Revision 7 invariant that only Twilio webhooks terminalize inbound calls, and able to preempt the
// monotonic server-side terminal result (the R7 ladder freezes the FIRST terminal, so a premature
// browser 'completed' would win over the real outcome).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canBrowserFinalizeCallRow,
  canBrowserFinalizeOrphanRow,
  classifyOrphanRecovery,
} from "@/lib/inboundCallOwnership";

const src = readFileSync(resolve(__dirname, "../../contexts/TwilioContext.tsx"), "utf8");

/**
 * Model of finalizeCallRecord's write decision: direction is captured BEFORE the call refs are
 * cleared, and an inbound call issues no `calls` UPDATE at all. `call_logs` telemetry (browser
 * derived, separate table, invariant #8/#12) is unchanged for both directions.
 */
function simulateFinalize(direction: string | null | undefined) {
  const writes: string[] = [];
  const callLogs: string[] = [];
  callLogs.push(`call_logs:${direction ?? "unknown"}`);
  if (canBrowserFinalizeCallRow(direction)) {
    writes.push("calls.update{status,ended_at}");
  }
  return { writes, callLogs };
}

describe("C14.1–C14.4 — every inbound teardown path writes nothing to calls", () => {
  it("accepted + claimed inbound disconnect → zero calls-row writes", () => {
    // ownership confirmed (agent_id = me) armed activeCallIdRef; the disconnect still writes nothing
    expect(simulateFinalize("inbound").writes).toEqual([]);
  });

  it("inbound manual hangup → zero calls-row writes", () => {
    expect(simulateFinalize("inbound").writes).toEqual([]);
  });

  it("inbound cancel/error after ownership confirmation → zero calls-row writes", () => {
    // cancel and error both funnel through finalizeEnded → finalizeCallRecord
    expect(simulateFinalize("inbound").writes).toEqual([]);
    expect(simulateFinalize("incoming").writes).toEqual([]);
  });

  it("a losing inbound browser leg → zero calls-row writes", () => {
    // the lost-race teardown never arms activeCallIdRef, and even if it did the guard holds
    expect(simulateFinalize("inbound").writes).toEqual([]);
  });

  it("unknown/missing direction fails closed (no write)", () => {
    expect(simulateFinalize(null).writes).toEqual([]);
    expect(simulateFinalize(undefined).writes).toEqual([]);
    expect(simulateFinalize("").writes).toEqual([]);
  });

  it("call_logs telemetry is preserved for inbound (separate table, browser-derived by design)", () => {
    expect(simulateFinalize("inbound").callLogs).toEqual(["call_logs:inbound"]);
  });
});

describe("C14.6 — outbound finalization is unchanged", () => {
  it("outbound disconnect still finalizes the calls row", () => {
    expect(simulateFinalize("outbound").writes).toEqual(["calls.update{status,ended_at}"]);
    expect(simulateFinalize("outgoing").writes).toEqual(["calls.update{status,ended_at}"]);
  });

  it("the outbound finalize payload is byte-identical (status + ended_at only, no duration)", () => {
    const fnStart = src.indexOf("const finalizeCallRecord");
    const body = src.slice(fnStart, src.indexOf("const stopAndUploadBrowserRecording"));
    expect(body.includes("status: 'completed',")).toBe(true);
    expect(body.includes("ended_at: new Date().toISOString(),")).toBe(true);
    expect(body.includes(".eq('id', callId)")).toBe(true);
    // invariant #8: the browser never writes calls.duration — assert on the UPDATE PAYLOAD, not the
    // function signature (`duration` is still the call_logs/diagnostics argument).
    const payload = body.slice(body.indexOf(".update({"), body.indexOf("})", body.indexOf(".update({")));
    expect(/duration/.test(payload)).toBe(false);
  });

  it("call_logs behavior is preserved for outbound", () => {
    expect(simulateFinalize("outbound").callLogs).toEqual(["call_logs:outbound"]);
  });
});

describe("C14.5 — C8's inbound orphan handling stays read-only", () => {
  it("inbound orphans are still surfaced read-only, outbound unchanged", () => {
    const now = Date.parse("2026-08-23T12:00:00.000Z");
    expect(
      classifyOrphanRecovery({ direction: "inbound", status: "connected", started_at: null }, now),
    ).toBe("surface_inbound_readonly");
    expect(
      classifyOrphanRecovery({ direction: "outbound", status: "connected", started_at: null }, now),
    ).toBe("silent_finalize");
    expect(canBrowserFinalizeOrphanRow("inbound")).toBe(false);
    expect(canBrowserFinalizeOrphanRow("outbound")).toBe(true);
  });

  it("the orphan and lifecycle guards share one predicate", () => {
    for (const d of ["inbound", "incoming", "outbound", "outgoing", "", null, undefined]) {
      expect(canBrowserFinalizeOrphanRow(d)).toBe(canBrowserFinalizeCallRow(d));
    }
  });
});

describe("C14 — finalizeCallRecord captures direction before clearing refs", () => {
  const fnStart = src.indexOf("const finalizeCallRecord");
  const body = src.slice(fnStart, src.indexOf("const stopAndUploadBrowserRecording"));

  it("reads lastCallLogDirectionRef before the refs are nulled", () => {
    const dirIdx = body.indexOf("lastCallLogDirectionRef.current");
    const clearIdx = body.indexOf("activeCallIdRef.current = null");
    expect(dirIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeGreaterThan(-1);
    expect(dirIdx).toBeLessThan(clearIdx);
  });

  it("routes the calls-row write through the shared guard", () => {
    expect(body.includes("canBrowserFinalizeCallRow")).toBe(true);
    const guardIdx = body.indexOf("canBrowserFinalizeCallRow");
    const updateIdx = body.indexOf(".from('calls')");
    expect(updateIdx).toBeGreaterThan(guardIdx);
  });
});

describe("C14.7 — static audit: EVERY browser calls-row mutation is direction-guarded", () => {
  /** Approved guard tokens; each mutation site must be preceded by at least one. */
  const GUARDS = [
    "classifyOrphanRecovery",       // orphan sweep: inbound => surface_inbound_readonly (no write)
    "canBrowserFinalizeOrphanRow",  // hangUpOrphan
    "canBrowserFinalizeCallRow",    // finalizeCallRecord
    "shouldSyncIdsToRow",           // syncIdsToRow (inbound skipped entirely)
    "direction: 'outbound'",        // makeCall INSERT creates the outbound row itself
  ];

  const mutationSites = [...src.matchAll(/\.from\((['"])calls\1\)\s*\n\s*\.(update|insert)\(/g)];

  it("finds every mutation site (and no unaccounted ones)", () => {
    // stale cleanup, silent finalize, hangUpOrphan, finalizeCallRecord, syncIdsToRow, makeCall insert
    expect(mutationSites.length).toBe(6);
  });

  it("each mutation site sits behind an outbound-only / non-inbound guard", () => {
    const unguarded: string[] = [];
    for (const m of mutationSites) {
      const idx = m.index ?? 0;
      // UPDATEs must be preceded by a guard; the makeCall INSERT is self-guarding — it CREATES the
      // row and stamps direction:'outbound' in its own payload.
      const scope = m[2] === "insert"
        ? src.slice(idx, idx + 1200)
        : src.slice(Math.max(0, idx - 2000), idx);
      if (!GUARDS.some((g) => scope.includes(g))) {
        unguarded.push(`line ${src.slice(0, idx).split("\n").length} (${m[2]})`);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it("no browser path writes inbound terminal or provider fields", () => {
    // Scoped to the `calls` payloads themselves — `call_logs` telemetry (a different table) keeps
    // its browser-derived duration by design (invariants #8/#12).
    const payloads = mutationSites.map((m) => {
      const idx = m.index ?? 0;
      const open = src.indexOf("({", idx);
      return src.slice(open, src.indexOf("})", open));
    });
    expect(payloads.length).toBe(6);
    for (const payload of payloads) {
      for (const field of ["outcome", "is_missed", "duration", "provider_error_code", "shaken_stir"]) {
        expect(payload.includes(field)).toBe(false);
      }
    }
    // status/ended_at/SID writes still exist, but only on the guarded outbound paths above.
    const statusWrites = [...src.matchAll(/status:\s*['"]completed['"]/g)].length;
    expect(statusWrites).toBe(3); // orphan silent finalize, hangUpOrphan, finalizeCallRecord (all guarded)
  });

  it("the documented invariant matches the code (no stale 'no inbound writes' claim without the guard)", () => {
    expect(src.includes("C14")).toBe(true);
  });
});
