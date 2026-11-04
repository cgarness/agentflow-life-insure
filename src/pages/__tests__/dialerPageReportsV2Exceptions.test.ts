import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reports V2 telephony boundary (D3 §4, D4 §4, A-§7). TwilioContext is never edited by PKG-C or PKG-D: it stays
 * byte-identical to the base. DialerPage stays byte-identical to the base until its approved exception lines land
 * (A-§7(a) for PKG-C, A-§7(b) for PKG-D); each, once approved, is removed here before comparing.
 */
const ROOT = join(__dirname, "..", "..", "..");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Approved DialerPage exception lines (none yet; the PKG-C and PKG-D lines await approval). */
const APPROVED_DIALER_LINES: string[] = [];

describe("Reports V2 telephony boundary", () => {
  it("TwilioContext.tsx is byte-identical to the base", () => {
    expect(sha256(read("src/contexts/TwilioContext.tsx"))).toBe("d364c16194387c87caa306ed5ccd9cee80c26dd47df915e58e63e43963d11789");
  });

  it("DialerPage.tsx equals the base once its approved exception lines are removed", () => {
    const lines = read("src/pages/DialerPage.tsx").split("\n").filter((line) => !APPROVED_DIALER_LINES.includes(line.trim()));
    expect(sha256(lines.join("\n"))).toBe("8c9baaae91f5c7ad3ef6c4eb5af95f766a8705ebd6ee0a94be9e1252e7eb20c4");
  });
});
