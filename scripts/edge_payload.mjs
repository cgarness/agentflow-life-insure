#!/usr/bin/env node
// =====================================================================================================
// Edge deployment payload — build and verify the EXACT serialized argument, not just the source on disk.
// =====================================================================================================
// WHY THIS EXISTS. The recording-retention-purge v30 deployment failed byte-for-byte verification: the
// pre-submission check validated a FILE ON DISK, and the payload was then transcribed a second time into
// the deployment call. That second transformation — source text -> JSON-escaped string literal — was
// never checked, and it silently dropped ten U+2500 padding characters from eight comment lines.
//
// The correction is to make the thing that is VERIFIED and the thing that is SUBMITTED the same string:
//
//   build   → writes the exact `files` argument (a JSON array of {name, content}) to a file, and prints
//             the per-file and manifest digests that argument encodes.
//   verify  → takes a CANDIDATE payload file — the literal that is about to be submitted — decodes it,
//             and asserts every byte matches the approved repository source. It checks the serialized
//             form, so an escaping or transcription error is caught BEFORE the deployment call.
//
// HOW THE HAND-OFF IS MEANT TO WORK — corrected, because an earlier note overstated the constraint.
// `deploy_edge_function` takes `files` as a STRUCTURED ARGUMENT: an array of {name, content}. The file
// this tool writes IS that argument value. A programmatic caller therefore does NOT have to reconstruct
// any source: it reads this file, parses it, and passes the resulting array straight through as the
// tool argument. No retyping, no second transformation, and no different deployment channel, CLI or
// path-based tool is inherently required — the existing Supabase MCP accepts the resulting object.
//
// THE REMAINING LIMITATION IS SPECIFIC TO THE CALLING ENVIRONMENT, not to MCP. In a harness where the
// caller authors tool-call arguments as literal text in its own output (this Claude Code session is
// one), a tool argument cannot be bound to the result of a file read, so that last hop still passes
// through authored text. In a caller that can pass a parsed value directly, it does not. Either way the
// verified artifact is the serialized payload itself, so the UNCHECKED source-to-JSON transformation
// that produced the v30 defect is gone. The production hand-off belongs to a separately approved
// deployment step.
//
// Usage:
//   node scripts/edge_payload.mjs build  <function-dir> [--out FILE]
//   node scripts/edge_payload.mjs verify <function-dir> <candidate.json>
//   node scripts/edge_payload.mjs selftest
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const die = (msg) => { console.error(msg); process.exit(1); };

/** Deployment paths are `functions/<slug>/<file>`, sorted lexicographically — the approved manifest form. */
function collect(dir) {
  const slug = path.basename(path.resolve(dir));
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => ({
      name: `functions/${slug}/${f}`,
      disk: path.join(dir, f),
      bytes: readFileSync(path.join(dir, f)),
    }));
}

/** lowercase sha256 + two spaces + path + LF per line; hash the whole manifest INCLUDING the final LF. */
function manifest(entries) {
  const text = entries
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e) => `${sha256(e.bytes)}  ${e.name}\n`)
    .join("");
  return { text, digest: sha256(Buffer.from(text, "utf8")) };
}

function describe(entries) {
  for (const e of entries) {
    const b = e.bytes;
    console.log(`  ${e.name}`);
    console.log(`    bytes      : ${b.length}`);
    console.log(`    first byte : 0x${b[0].toString(16).padStart(2, "0")}`);
    console.log(`    last byte  : 0x${b[b.length - 1].toString(16).padStart(2, "0")}${b[b.length - 1] === 0x0a ? " (LF)" : " (NOT LF)"}`);
    console.log(`    sha256     : ${sha256(b)}`);
  }
  const m = manifest(entries);
  console.log(`  canonical manifest: ${m.digest}`);
  return m;
}

function build(dir, out) {
  const entries = collect(dir);
  if (!entries.length) die(`no .ts files in ${dir}`);
  console.log(`payload for ${path.basename(path.resolve(dir))} (${entries.length} files):`);
  describe(entries);
  const payload = entries.map((e) => ({ name: e.name, content: e.bytes.toString("utf8") }));
  const json = JSON.stringify(payload, null, 0);
  const file = out ?? path.join(path.dirname(path.resolve(dir)), `.payload.${path.basename(path.resolve(dir))}.json`);
  writeFileSync(file, json, "utf8");
  console.log(`  payload written    : ${file}`);
  console.log(`  payload sha256     : ${sha256(Buffer.from(json, "utf8"))}`);
  console.log(`  payload bytes      : ${Buffer.byteLength(json, "utf8")}`);
  return file;
}

/**
 * Verifies a CANDIDATE serialized payload against the approved source. Every check is on the decoded
 * candidate, so an escaping mistake, a dropped character or a re-encoded dash fails here.
 */
function verify(dir, candidatePath) {
  const approved = collect(dir);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(candidatePath, "utf8"));
  } catch (err) {
    die(`FAIL: candidate is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed)) die("FAIL: candidate must be a JSON array of {name, content}");

  let ok = true;
  const seen = new Set();
  for (const item of parsed) {
    if (!item || typeof item.name !== "string" || typeof item.content !== "string") {
      die("FAIL: every entry needs a string `name` and a string `content`");
    }
    if (seen.has(item.name)) { console.error(`FAIL: duplicate entry ${item.name}`); ok = false; }
    seen.add(item.name);
    const want = approved.find((e) => e.name === item.name);
    if (!want) { console.error(`FAIL: unexpected file in payload: ${item.name}`); ok = false; continue; }
    const got = Buffer.from(item.content, "utf8");
    if (got.length !== want.bytes.length || !got.equals(want.bytes)) {
      ok = false;
      console.error(`FAIL: ${item.name}`);
      console.error(`      approved ${want.bytes.length} bytes  ${sha256(want.bytes)}`);
      console.error(`      candidate ${got.length} bytes  ${sha256(got)}`);
      // Name the first differing line so the report is actionable, not just "they differ".
      const a = want.bytes.toString("utf8").split("\n");
      const b = got.toString("utf8").split("\n");
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
          console.error(`      first difference at line ${i + 1}:`);
          console.error(`        approved (${[...(a[i] ?? "")].length} chars): ${JSON.stringify((a[i] ?? "").slice(0, 90))}`);
          console.error(`        candidate(${[...(b[i] ?? "")].length} chars): ${JSON.stringify((b[i] ?? "").slice(0, 90))}`);
          break;
        }
      }
    } else {
      console.log(`OK  : ${item.name}  ${got.length} bytes  ${sha256(got)}`);
    }
  }
  for (const e of approved) {
    if (!seen.has(e.name)) { console.error(`FAIL: missing file in payload: ${e.name}`); ok = false; }
  }
  if (!ok) die("PAYLOAD VERIFICATION FAILED — do not submit this payload");

  const m = manifest(approved);
  console.log(`OK  : canonical manifest ${m.digest}`);
  console.log("PAYLOAD VERIFIED — this exact serialized argument matches the approved source byte for byte");
  return m.digest;
}

/**
 * OFFLINE serialization self-test. It proves the round trip survives the shapes that actually broke a
 * deployment, and it is EXPLICITLY offline: it exercises JSON encode/decode, NOT a production
 * deployment, and proves nothing about what an MCP call transmits.
 */
function selftest() {
  const cases = {
    "leading newline": "\nconst a = 1;\n",
    "trailing newlines": "const a = 1;\n\n\n",
    "no trailing newline": "const a = 1;",
    "interior blank lines": "a\n\n\nb\n",
    "double quotes": 'const s = "he said \\"hi\\"";\n',
    "single quotes and backticks": "const s = 'x'; const t = `y${1}`;\n",
    "backslashes": "const re = /^AC[0-9a-fA-F]{32}$/; // C:\\\\path\\\\to\n",
    "tab and CR": "a\tb\r\nc\n",
    "em dash": "// a \u2014 b\n",
    "box rule 80": `// \u2500\u2500 Result shapes ${"\u2500".repeat(80)}\n`,
    "box rule 61": `// \u2500\u2500 Phase 2: provider source cleanup ${"\u2500".repeat(61)}\n`,
    "mixed dashes adjacent": "// \u2500\u2500 x \u2014 y \u2500\u2500\n",
    "astral plane": "// \u{1F600}\n",
    "lone surrogate-ish sequence": "// \\ud83d not a real surrogate\n",
    "NUL-adjacent control": "a\u0001b\n",
  };
  let ok = true;
  for (const [label, content] of Object.entries(cases)) {
    const round = JSON.parse(JSON.stringify([{ name: "functions/x/y.ts", content }]))[0].content;
    const same = Buffer.from(round, "utf8").equals(Buffer.from(content, "utf8"));
    console.log(`  ${same ? "OK  " : "FAIL"}: ${label} (${Buffer.byteLength(content, "utf8")} bytes)`);
    if (!same) ok = false;
  }
  // And the case that actually failed: a rule one character short must be REJECTED, not tolerated.
  const approved = `// \u2500\u2500 Result shapes ${"\u2500".repeat(80)}\n`;
  const short = `// \u2500\u2500 Result shapes ${"\u2500".repeat(79)}\n`;
  const detected = !Buffer.from(short, "utf8").equals(Buffer.from(approved, "utf8"));
  console.log(`  ${detected ? "OK  " : "FAIL"}: a rule one U+2500 short is detected (${Buffer.byteLength(approved) - Buffer.byteLength(short)}-byte delta)`);
  if (!detected) ok = false;
  console.log(ok
    ? "OFFLINE SERIALIZATION SELFTEST PASSED (offline only: proves JSON round-tripping, NOT a deployment)"
    : "OFFLINE SERIALIZATION SELFTEST FAILED");
  if (!ok) process.exit(1);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "build") {
  const outIdx = process.argv.indexOf("--out");
  build(a ?? die("usage: build <function-dir>"), outIdx > -1 ? process.argv[outIdx + 1] : undefined);
} else if (cmd === "verify") {
  verify(a ?? die("usage: verify <function-dir> <candidate.json>"), b ?? die("usage: verify <function-dir> <candidate.json>"));
} else if (cmd === "selftest") {
  selftest();
} else {
  die("usage: edge_payload.mjs build|verify|selftest ...");
}
