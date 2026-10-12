# Pinned-clock Reports CSV capture: evidence for the UI copy cleanup V2

This folder lets anyone reproduce the byte comparison of every Reports CSV export between base `main` `e11c8bea` and the cleanup branch. It is the evidence for "Part A and Part B change no export".

- **Fixture evidence only.** The data is synthetic, from the local Reports fixture with embedded SQL. That path must be labelled "embedded SQL + real browser"; it is not native PostgreSQL.
- **Not equivalent to the historical 74-file golden.** The 74-file capture tool was never committed and its composition cannot be reconstructed. 13 of its 74 files cannot be identified, so equivalence is not claimed.

## Result recorded here (2026-10-12)

- **Base:** `e11c8bea8bb546023da3fc6489140be2cd464a3e`, served from a detached worktree on strict port 4181.
- **Candidate:** `022e7d1c52b307cb153c5cb4665040945b186341`, branch `claude/ui-copy-cleanup-v2-20261011`, served from the repository root on strict port 4182.
- **How each server ran.** Alone, one at a time, because the two trees share a Vite dependency cache. Each served root was proven from the transformed entry's `/@fs/` imports, and only its own PID was stopped.
- **Result: 61 of 61 downloads byte-identical.**
  - Comparison: raw SHA-256 with no normalization of any kind, 98,865 bytes.
  - Composition: 42 distinct contents and 16 file names (Agency 23, Team 20, Personal 18). No export was unavailable, and the capture logged no page errors.
  - The `Generated` row matches too, because the clock is pinned.
- **Independent checks.**
  - A separate `sha256sum` over the saved files agrees.
  - **Negative control A:** one byte appended to a saved file, manifest untouched. The comparison fails ("file does not match manifest").
  - **Negative control B:** one byte changed and the manifest re-hashed. The comparison fails ("DIFFERENT").
- **Earlier runs.** The same 61 hashes were recorded at the Part A head (`62546df`) and at the pre-review Part B head (`b7ab152`).
- `manifest-base.json` and `manifest-candidate.json` are the two manifests from this run, re-indented. They differ only in `url`.

## Fixture identity

| Item | Identity |
|---|---|
| SQL payloads (`REPORTS_SQL_PAYLOADS`) | `reports-payloads.json`, SHA-256 `fd579249e72a6d72774d0c28611e6de63c2119044c45edcb6c78f3732baa6ba1`. Produced by `PGLITE_PACKAGE=<@electric-sql/pglite 0.3.14> REPORTS_SQL_PAYLOADS=<out> node scripts/tests/reports-integrity-embedded.mjs` (it runs `scripts/reports_integrity_fixture.py --payload-sql`). It covers only the custom window 1 October 2026. |
| `scripts/tests/reports-integrity-embedded.mjs` | SHA-256 `ca502693196c6a04…`, identical on base and candidate |
| `scripts/tests/reports-visual/vite.config.ts` | SHA-256 `1ce1365541ee8624…`, identical |
| `scripts/tests/reports-visual/entry.tsx` | SHA-256 `56443ec2b998c1fc…`, identical |
| `scripts/tests/reports-visual/index.html` | SHA-256 `4ea998bdc225ecbd…`, identical |
| `scripts/tests/reports-visual/stubs.ts` | SHA-256 `8a54f4af82e9c2d8…`, identical |
| Clock and locale | Fixed at `2026-10-09T04:00:00Z`, `America/Los_Angeles`, viewport 1440 × 1000, 1,100 ms between downloads |
| Network | Every non-loopback request is aborted; only a `127.0.0.1` fixture server is accepted |
| Tools | Node v22.22.0, Playwright 1.56.1, Chromium 141.0.7390.37 |
| `csv-capture.mjs` | SHA-256 `410648f07d48577f4da7ce420e2df8583c9e459b50982861d36834a372f26b2c` (unchanged since Part A) |
| `compare-csv-captures.mjs` | SHA-256 `79d7528d20afffa754ea19c2c8721592c378606000c8d6e07ff4dadbcdb3c290` |

**Compare script history.** The Part A version, `0638d261…`, compared the manifest digests only. On 2026-10-12 it was hardened to re-hash every saved file against its manifest entry, so a file or a manifest edited on its own also fails. With the hardened script, the result above is unchanged.

## What the capture covers

It downloads every export control in every view toggle and trend grouping that renders in each scope: Agency, Team and Personal.

**Not covered:**
- other periods and windows (the payloads carry only 1 October 2026, so the Daily, Weekly and Monthly groupings produce identical files);
- the heatmap, call-flow and call-duration toggles in Team and Personal (their payloads have no outbound calls, so the toggles do not render);
- the Personal agent tables (not offered);
- agent drill-downs;
- error, stale and loading exports, and export refusal while a panel is unavailable (covered by unit tests, not this capture);
- native PostgreSQL payloads.

## Reproduce

```bash
# 1. A detached worktree at the base, sharing the candidate's node_modules
git worktree add --detach /tmp/base e11c8bea8bb546023da3fc6489140be2cd464a3e
ln -s "$PWD/node_modules" /tmp/base/node_modules
# 2. SQL payloads (embedded PGlite 0.3.14); check the SHA-256 against the table above
PGLITE_PACKAGE=/path/to/node_modules/@electric-sql/pglite REPORTS_SQL_PAYLOADS=/tmp/reports-payloads.json \
  node scripts/tests/reports-integrity-embedded.mjs
# 3. Capture both sides and compare (ports 4181 and 4182 must be free)
BASE_TREE=/tmp/base CAND_TREE="$PWD" OUT=/tmp/csv-capture PAYLOADS=/tmp/reports-payloads.json \
  PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
  bash docs/plans/2026-10-11-ui-copy-cleanup-v2/evidence/csv-capture/run-capture.sh
```

`run-capture.sh` runs only the CSV part. The recorded run used an equivalent session script that also ran the Reports and Leaderboard/TV browser gates between captures. `run-capture.sh` was then run on its own at the same head, and it reproduced the same 61 hashes.
