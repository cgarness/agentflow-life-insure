/**
 * Reports V2 protected-file exceptions in DialerPage (A-§7). PKG-D owns clause (b). -pkg-c (c846e6c1) has its own
 * version of this file with clause (a) and the TwilioContext pin; it cannot run here because clause (a) is not on
 * this branch. Integration resolution: take the -pkg-c file and add the clause (b) `it` block below to its describe.
 * Clause checks, not a whole-file hash. TwilioContext is never edited.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("DialerPage Reports V2 exceptions", () => {
  it("clause (b): the AppointmentModal save passes type: data.type to saveAppointment, and nothing else does", () => {
    const page = read("src/pages/DialerPage.tsx");
    expect(page.match(/type: data\.type,/g)).toHaveLength(1);
    const call = page.slice(page.indexOf("await saveAppointment({ request_id: data.booking_request_id!"));
    const body = call.slice(0, call.indexOf("}, organizationId);"));
    expect(body).toContain("type: data.type,");
  });
  it("TwilioContext is byte-identical to origin/main 2b6f5cef (or to this branch's base 6e39c15, before integration)", () => {
    const sha = createHash("sha256").update(readFileSync(join(ROOT, "src/contexts/TwilioContext.tsx"))).digest("hex");
    expect(["f93605b97dc4fce5c2f75fb574ddaa9570788a4d441fae1d059d561eca7b7c20",
            "d364c16194387c87caa306ed5ccd9cee80c26dd47df915e58e63e43963d11789"]).toContain(sha);
  });
});
