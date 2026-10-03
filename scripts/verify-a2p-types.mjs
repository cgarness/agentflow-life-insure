// Compare actual app diagnostics to the exact PR base without changing existing CI gates.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const base = process.env.A2P_BASE_SHA;
if (!base || !/^[0-9a-f]{40}$/.test(base)) throw new Error("A2P_BASE_SHA must be the exact 40-character PR base SHA.");
const root = process.cwd(), dir = mkdtempSync(join(tmpdir(), "a2p-base-")), tree = join(dir, "tree");
function run(cmd, args, cwd = root) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
}
function diagnostics(cwd) {
  const r = run(process.execPath, [
    resolve(cwd, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "-p",
    "tsconfig.app.json",
  ], cwd);
  const lines = r.stdout.split("\n").filter((l) => l.includes("error TS"));
  if (r.status !== 0 && !lines.length) throw new Error(r.stderr || r.stdout || "TypeScript did not finish");
  const count = new Map();
  for (const l of lines) {
    const key = l.replace(/\(\d+,\d+\)/, "(LINE)");
    count.set(key, (count.get(key) || 0) + 1);
  }
  return { count, total: lines.length };
}
try {
  const checkout = run("git", ["worktree", "add", "--detach", tree, base]);
  if (checkout.status !== 0) throw new Error(checkout.stderr);
  if (readFileSync(join(root, "package-lock.json")).equals(readFileSync(join(tree, "package-lock.json")))) {
    symlinkSync(join(root, "node_modules"), join(tree, "node_modules"), "dir");
  } else {
    const install = run("npm", ["ci", "--no-audit", "--no-fund"], tree);
    if (install.status !== 0) throw new Error(install.stderr || "Base dependency installation failed");
  }
  const before = diagnostics(tree), after = diagnostics(root);
  let added = 0;
  for (const [line, count] of after.count) {
    const delta = count - (before.count.get(line) || 0);
    if (delta > 0) {
      added += delta;
      console.error(`${delta} new: ${line}`);
    }
  }
  console.log(`App TypeScript: base=${before.total}, candidate=${after.total}, new=${added}`);
  if (added) process.exitCode = 1;
} finally {
  run("git", ["worktree", "remove", "--force", tree]);
  rmSync(dir, { recursive: true, force: true });
}
