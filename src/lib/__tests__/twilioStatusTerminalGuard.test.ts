// Fail-first tests — twilio-voice-status full monotonic status ladder (plan rev5: R7, T25).
// ringing → connected → terminal(completed|no-answer|failed); terminal frozen; enrichment passes through.
import { describe, it, expect } from "vitest";
import { applyStatusLadder, isTerminalCallStatus } from "../../../supabase/functions/twilio-voice-status/terminal-guard";

describe("isTerminalCallStatus", () => {
  it("identifies the three terminal states", () => {
    for (const s of ["completed", "failed", "no-answer"]) expect(isTerminalCallStatus(s)).toBe(true);
    for (const s of ["ringing", "connected", null, undefined, ""]) expect(isTerminalCallStatus(s as string)).toBe(false);
  });
});

describe("applyStatusLadder (R7 full table)", () => {
  it("forward moves are allowed", () => {
    expect(applyStatusLadder(null, "ringing").writeStatus).toBe(true);
    expect(applyStatusLadder("ringing", "connected").writeStatus).toBe(true);
    expect(applyStatusLadder("ringing", "completed").writeStatus).toBe(true);
    expect(applyStatusLadder("connected", "completed").writeStatus).toBe(true);
    expect(applyStatusLadder("connected", "no-answer").writeStatus).toBe(true);
    expect(applyStatusLadder("ringing", "failed").writeStatus).toBe(true);
  });

  it("R7 core: connected + late ringing ⇒ status write DROPPED (the connected→ringing hole is closed)", () => {
    const d = applyStatusLadder("connected", "ringing");
    expect(d.writeStatus).toBe(false);
    expect(d.dropStartedAt).toBe(true);
  });

  it("terminal + ringing/in-progress replays ⇒ dropped", () => {
    for (const stored of ["completed", "failed", "no-answer"]) {
      expect(applyStatusLadder(stored, "ringing").writeStatus).toBe(false);
      expect(applyStatusLadder(stored, "connected").writeStatus).toBe(false);
    }
  });

  it("terminal + different terminal ⇒ first accepted terminal state stands", () => {
    expect(applyStatusLadder("completed", "no-answer").writeStatus).toBe(false);
    expect(applyStatusLadder("no-answer", "completed").writeStatus).toBe(false);
    expect(applyStatusLadder("failed", "completed").writeStatus).toBe(false);
    // duplicate same-terminal replay is also a no-op write
    expect(applyStatusLadder("completed", "completed").writeStatus).toBe(false);
  });

  it("equal non-terminal replays are harmless no-drops (idempotent re-write allowed)", () => {
    expect(applyStatusLadder("ringing", "ringing").writeStatus).toBe(true);
    expect(applyStatusLadder("connected", "connected").writeStatus).toBe(true);
  });

  it("suppressed writes still permit monotonic enrichment (duration/ended_at/shaken handled by caller)", () => {
    const d = applyStatusLadder("completed", "ringing");
    expect(d.allowEnrichment).toBe(true);
  });
});
