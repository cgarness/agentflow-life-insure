// Corrective pass 13, item 5 — the deployment-payload gap.
//
// The v30 deployment failed byte-for-byte verification because the pre-submission check validated a FILE
// ON DISK and the payload was then transcribed a SECOND time into the deployment call. That second
// transformation — source text into a JSON-escaped string literal — was never checked, and it dropped ten
// U+2500 characters from eight comment lines.
//
// `scripts/edge_payload.mjs` closes that by verifying the SERIALIZED payload itself. These tests run it
// for real over the actual packages.
//
// SCOPE, stated plainly: everything here is OFFLINE. It proves the build/verify round trip and that the
// exact v30 defect is now caught before submission. It proves NOTHING about what a real deployment call
// transmits.
//
// CORRECTION to an earlier note in this file: `deploy_edge_function` takes `files` as a STRUCTURED
// argument, so a programmatic caller can read the verified JSON, parse it, and pass the array directly —
// no source reconstruction, and no CLI or path-based tool inherently required. The residual gap belongs
// to a calling ENVIRONMENT that must author tool arguments as literal text (this session is one), not to
// MCP itself.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "../../..");
const TOOL = path.join(REPO, "scripts/edge_payload.mjs");
const PKGS = [
  "supabase/functions/recording-retention-purge",
  "supabase/functions/twilio-recording-status",
];

function run(args: string[]): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync("node", [TOOL, ...args], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

describe("edge payload: offline serialization", () => {
  it("survives every shape that has broken a deployment (leading/trailing newlines, blank lines, quotes, repeated Unicode rules)", () => {
    const r = run(["selftest"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("OFFLINE SERIALIZATION SELFTEST PASSED");
    for (const label of ["leading newline", "trailing newlines", "interior blank lines", "double quotes",
                         "backslashes", "box rule 80", "box rule 61", "mixed dashes adjacent"]) {
      expect(r.out).toContain(`OK  : ${label}`);
    }
    expect(r.out).toContain("offline only");     // the label is part of the contract
  });
});

describe.each(PKGS)("edge payload: %s", (pkg) => {
  const tmp = mkdtempSync(path.join(tmpdir(), "payload-"));
  const file = path.join(tmp, "payload.json");

  it("builds a payload that verifies byte-for-byte against the repository source", () => {
    expect(run(["build", pkg, "--out", file]).code).toBe(0);
    const v = run(["verify", pkg, file]);
    expect(v.code).toBe(0);
    expect(v.out).toContain("PAYLOAD VERIFIED");
  });

  it("REGRESSION (the v30 defect): one dropped U+2500 is REFUSED, with the differing line named", () => {
    run(["build", pkg, "--out", file]);
    const payload = JSON.parse(readFileSync(file, "utf8")) as Array<{ name: string; content: string }>;
    const target = payload.find((f) => /─{20,}/.test(f.content));
    if (!target) return;                       // this package has no long rules; nothing to regress
    target.content = target.content.replace(/─{20,}/, (m) => "─".repeat(m.length - 1));
    const broken = path.join(tmp, "broken.json");
    writeFileSync(broken, JSON.stringify(payload), "utf8");

    const v = run(["verify", pkg, broken]);
    expect(v.code).not.toBe(0);                // a non-zero exit is what stops a deployment
    expect(v.out).toContain("PAYLOAD VERIFICATION FAILED");
    expect(v.out).toMatch(/first difference at line \d+/);
  });

  it("refuses a payload that is missing a file, has an extra file, or is not valid JSON", () => {
    run(["build", pkg, "--out", file]);
    const payload = JSON.parse(readFileSync(file, "utf8")) as Array<{ name: string; content: string }>;

    const missing = path.join(tmp, "missing.json");
    writeFileSync(missing, JSON.stringify(payload.slice(0, 1)), "utf8");
    expect(run(["verify", pkg, missing]).out).toContain("missing file in payload");

    const extra = path.join(tmp, "extra.json");
    writeFileSync(extra, JSON.stringify([...payload, { name: "functions/x/evil.ts", content: "x" }]), "utf8");
    expect(run(["verify", pkg, extra]).out).toContain("unexpected file in payload");

    const bad = path.join(tmp, "bad.json");
    writeFileSync(bad, "{not json", "utf8");
    expect(run(["verify", pkg, bad]).code).not.toBe(0);
  });
});
