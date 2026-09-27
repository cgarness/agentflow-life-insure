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
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "../../..");
const TOOL = path.join(REPO, "scripts/edge_payload.mjs");
const PKGS = [
  "supabase/functions/recording-retention-purge",
  "supabase/functions/twilio-recording-status",
  "supabase/functions/twilio-voice-status",
  "supabase/functions/twilio-voice-inbound",
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

// IMPORT CLOSURE (2026-09-27). `twilio-voice-status` and `twilio-voice-inbound` import
// `../_shared/notifications.ts` (→ `./notification-recipients.ts`); a payload of the function directory
// alone would deploy a package that cannot load. The closure is checked against esbuild's own module
// graph for the same entrypoint, so no file count is hard-coded here.
const ESBUILD = path.join(REPO, "node_modules/.bin/esbuild");

function closure(pkg: string): string[] {
  const r = run(["closure", pkg]);
  expect(r.code).toBe(0);
  return r.out.trim().split("\n").filter(Boolean);
}

function esbuildInputs(pkg: string): string[] {
  const tmp = mkdtempSync(path.join(tmpdir(), "closure-"));
  const meta = path.join(tmp, "meta.json");
  execFileSync(ESBUILD, [
    path.join(pkg, "index.ts"), "--bundle", "--format=esm", "--platform=neutral",
    "--external:https://*", `--metafile=${meta}`, `--outfile=${path.join(tmp, "out.js")}`, "--log-level=error",
  ], { cwd: REPO, stdio: "pipe" });
  const inputs = Object.keys((JSON.parse(readFileSync(meta, "utf8")) as { inputs: Record<string, unknown> }).inputs);
  return inputs.map((i) => i.replace(/^supabase\//, "")).sort();
}

describe.each(PKGS)("edge payload closure: %s", (pkg) => {
  it("contains every file esbuild bundles from index.ts, named by its path under supabase/functions", () => {
    const names = closure(pkg);
    for (const input of esbuildInputs(pkg)) expect(names).toContain(input);
  });

  it("adds nothing outside the function directory that index.ts does not import", () => {
    const slug = path.basename(pkg);
    const outside = closure(pkg).filter((n) => !n.startsWith(`functions/${slug}/`));
    const inputs = esbuildInputs(pkg);
    for (const n of outside) expect(inputs).toContain(n);
  });

  it("still carries every .ts file of the function directory", () => {
    const slug = path.basename(pkg);
    const own = readdirSync(path.join(REPO, pkg)).filter((f) => f.endsWith(".ts")).map((f) => `functions/${slug}/${f}`);
    const names = closure(pkg);
    for (const n of own) expect(names).toContain(n);
  });
});

describe("edge payload closure: shared files", () => {
  it.each(["supabase/functions/twilio-voice-status", "supabase/functions/twilio-voice-inbound"])(
    "%s ships both shared notification modules under their deployed names",
    (pkg) => {
      const names = closure(pkg);
      expect(names).toContain("functions/_shared/notifications.ts");
      expect(names).toContain("functions/_shared/notification-recipients.ts");
      expect(names.some((n) => n.includes(".test."))).toBe(false);
    },
  );

  it("a payload missing a shared file is refused", () => {
    const pkg = "supabase/functions/twilio-voice-status";
    const tmp = mkdtempSync(path.join(tmpdir(), "payload-shared-"));
    const file = path.join(tmp, "payload.json");
    expect(run(["build", pkg, "--out", file]).code).toBe(0);
    const payload = JSON.parse(readFileSync(file, "utf8")) as Array<{ name: string; content: string }>;
    const withoutShared = payload.filter((f) => f.name !== "functions/_shared/notification-recipients.ts");
    expect(withoutShared).toHaveLength(payload.length - 1);
    const broken = path.join(tmp, "broken.json");
    writeFileSync(broken, JSON.stringify(withoutShared), "utf8");
    const v = run(["verify", pkg, broken]);
    expect(v.code).not.toBe(0);
    expect(v.out).toContain("missing file in payload: functions/_shared/notification-recipients.ts");
  });

  it("a package without imports outside its directory keeps the manifest of the directory-only algorithm", () => {
    const pkg = "supabase/functions/twilio-recording-status";
    const slug = path.basename(pkg);
    const text = readdirSync(path.join(REPO, pkg))
      .filter((f) => f.endsWith(".ts"))
      .sort()
      .map((f) => {
        const hash = createHash("sha256").update(readFileSync(path.join(REPO, pkg, f))).digest("hex");
        return `${hash}  functions/${slug}/${f}\n`;
      })
      .join("");
    const legacy = createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
    const tmp = mkdtempSync(path.join(tmpdir(), "payload-legacy-"));
    const r = run(["build", pkg, "--out", path.join(tmp, "p.json")]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`canonical manifest: ${legacy}`);
  });
});

describe("edge payload closure: refusals", () => {
  function tree(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), "closure-tree-"));
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), content, "utf8");
    }
    return path.join(root, "functions", "fx");
  }

  it("fails when a relative import does not exist", () => {
    const dir = tree({ "functions/fx/index.ts": 'import { a } from "../_shared/missing.ts";\nconsole.log(a);\n' });
    const r = run(["closure", dir]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("does not exist");
  });

  it("fails when a relative import escapes the functions root", () => {
    const dir = tree({
      "functions/fx/index.ts": 'import { a } from "../../outside.ts";\nconsole.log(a);\n',
      "outside.ts": "export const a = 1;\n",
    });
    const r = run(["closure", dir]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("escapes");
  });

  it("follows multi-line, type-only, re-export and bare imports, and ignores commented-out imports", () => {
    const dir = tree({
      "functions/fx/index.ts": [
        "// import { gone } from \"../_shared/gone.ts\";",
        "import {",
        "  a,",
        "} from \"../_shared/a.ts\";",
        "import type { T } from \"../_shared/t.ts\";",
        "export { b } from \"./b.ts\";",
        "import \"../_shared/side.ts\";",
        "import { createClient } from \"https://esm.sh/@supabase/supabase-js@2\";",
        "console.log(a, createClient);",
        "",
      ].join("\n"),
      "functions/fx/b.ts": "export const b = 1;\n",
      "functions/_shared/a.ts": 'import { c } from "./c.ts";\nexport const a = c;\n',
      "functions/_shared/c.ts": "export const c = 1;\n",
      "functions/_shared/t.ts": "export type T = string;\n",
      "functions/_shared/side.ts": "export {};\n",
    });
    const r = run(["closure", dir]);
    expect(r.code).toBe(0);
    expect(r.out.trim().split("\n")).toEqual([
      "functions/_shared/a.ts",
      "functions/_shared/c.ts",
      "functions/_shared/side.ts",
      "functions/_shared/t.ts",
      "functions/fx/b.ts",
      "functions/fx/index.ts",
    ]);
  });
});
