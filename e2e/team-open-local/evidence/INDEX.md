# Evidence index: Team/Open lead details, isolated LOCAL verification (rev 7, 2026-09-24)

**Report:** `docs/audits/2026-09-24/LOCAL_VERIFICATION_REPORT.md`.

**Provenance:**
- Everything here comes from the original run.
- Screenshots are the original PNG files, copied byte-for-byte; `screenshots.sha256` lists their hashes.
- JSON files are **derived** by `../sanitize-evidence.mjs`, which records the raw file's sha256 in
  `derivedFrom`.
- **No scenario, browser run, Vitest run or build was re-run, and nothing was re-captured, for publication.**
- **Evidence derivation (publication):**
  - `sanitize-evidence.mjs` over the two raw `evidence.json` files;
  - `sha256sum` of the copied PNGs (`screenshots.sha256`);
  - `gates-summary.json` derived from the recorded raw gate files;
  - a recomputation of the S10 comparison on the published excerpts (`SESSION_RECORDS.md` R5).
- **Checks re-run during publication** (they produced no evidence here):
  - `npx tsc --noEmit`;
  - `npx tsc -p tsconfig.app.json --noEmit` (91 errors, the same multiset as recorded);
  - ESLint and syntax checks on the harness;
  - harness-only guard self-tests with no backend;
  - a secret and scope scan of the staged diff;
  - `git diff --check`.

**Not published:**
- the raw `evidence.json` files (they contained the local demo anon JWT inside Realtime WebSocket URLs);
- credentials, JWTs, cookies and browser storage;
- database dumps, volumes and images;
- raw Vitest, tsc, ESLint and build outputs. These are summarised in `gates-summary.json`, with a sha256 for
  each raw file. The mocked-suite counts have no raw file and are marked "transcribed";
- exploratory and intermediate runs, listed below. They are kept only in the disposable session workspace,
  which is lost when the session ends.

## Files

| Path | What it is |
|---|---|
| `final-run/evidence.sanitized.json` | Consolidated final run on the feature branch `ee24e7d9`: 12 scenario rows (UI observations, local DB results, simulated steps, screenshots, console errors) plus a per-session network summary. |
| `final-run/*.png` | 21 screenshots from that run. |
| `base-S10/evidence.sanitized.json`, `base-S10/S10-personal-connected.png` | S10 (Personal) run against clean `main` `f78140d7`, for the unchanged-behaviour comparison. |
| `gates-summary.json` | Recorded automated results, derived: Vitest in both environments on both trees (counts, failed test names, failed files, skipped tests), tsc, touched-file ESLint, build. |
| `local-migrations.txt` | `supabase_migrations.schema_migrations` of the local database after `db reset`: the 20 versions applied **locally**. |
| `SESSION_RECORDS.md` | Verbatim transcriptions of session output that was not saved as files: egress denials, image sourcing, PostgREST provenance, Realtime failure, isolation proofs, RLS baseline, S10 comparison method. |
| `screenshots.sha256` | sha256 of every published screenshot. |

## Scenario → evidence

| Scenario | Screenshots | Simulated (not real) |
|---|---|---|
| S01 pre-claim | `S01-ringing.png`, `S01-connected-preclaim.png` | Voice.js ringing and accept |
| S02 claim + field rendering | `S02-postclaim-details.png` | Voice.js accept and hang-up |
| S03 inline edit | `S03-editing.png`, `S03-saved.png` | Voice.js |
| S04 failed / partial saves | `S04a-validation.png`, `S04b-refused.png`, `S04c-partial.png` | (b) concurrent privileged reassignment. (c) browser-level failure of the snapshot PATCH only. |
| S05 stale read | `S05-lead-B-after-stale-read.png` | Browser-level 6 s delay of lead A's master **GET** |
| S06 call events | `S06-unanswered.png`, `S06-inbound.png`, `S06-after-inbound.png` | Voice.js events; inbound Call via the fake Device |
| S06b lock loss | `S06b-lock-loss.png` | Lock row deleted by a privileged local actor; the client detected it through its `renew_lead_lock` heartbeat |
| S07 two Agents | `S07-agent1.png`, `S07-agent2.png` | — |
| S08 Sold blocked / Retry | `S08a-blocked.png`, `S08b-error-retry.png` | (b) browser-level failure of the post-claim master GET, removed before Retry |
| S09 conversion | `S09-convert-modal.png`, `S09-after-convert.png` | Voice.js |
| S10 Personal | `S10-personal-connected.png` (feature), `base-S10/S10-personal-connected.png` (main) | Voice.js accept |
| S11 cross-org | `S11-orgB-dialer.png` | — |

## Known label inaccuracies in the recorded evidence (kept as recorded, not edited)

- **S05:** the recorded `title` and `simulated` text say "delayed claim re-read **and delayed save**" and
  "DELAY … of the real master GET **and of the real leads PATCH**". The script delayed **only the GET**, so
  no delayed save was exercised. B was idle, so the details component was not rendered for B. S05 shows that
  B's idle card carried no lead-A text; it does not show a stale read being rejected by B's rendered details.
  The script's labels were corrected after the run; there was no re-run.
- **S06:** the recorded `title` and `simulated` text mention lock loss. Lock loss was exercised in the
  separate row **S06b**. The title and the `simulated` entry were corrected after the run (the `simulated`
  entry only during publication); there was no re-run.
- **S04:** the recorded `title` ("…RLS refusal…") and `simulated` text ("…so RLS refuses the Agent's
  write") overstate (b).
  - After the privileged reassignment, RLS hid the row from the save's pre-write custom-fields read. The hook
    stopped with "This contact is not available to you. Nothing was saved."
  - No `PATCH /rest/v1/leads` was sent for (b). The S04 session's two leads PATCHes are the claiming save (the
    O1 406) and (c).
  - The server-side refused-UPDATE branch was **not** exercised in the browser.
  - The second privileged UPDATE (restoring ownership before (c)) was not listed in `simulated`.
  - The script's labels were corrected after the run; there was no re-run.
- **S10:** the recorded comparison covers the **complete** `<main>` innerText (681 characters, under the
  700-character capture cap). It does not cover the sidebar, the top bar, form-field values or the visual
  rendering. The only raw difference was the lead-local clock. See `SESSION_RECORDS.md` R5.

## Earlier runs not published

Exploratory runs and intermediate scenario runs (before the final consolidated run) exercised the harness.
They exposed three harness defects, each fixed before the final run:
1. The S02 label parser read the value `TX` as a label.
2. S04(c) edited a field that is not snapshot-synced, so no partial save happened.
3. S06 was blocked by the floating dialer panel after a simulated inbound call.

Those runs' files were not published (they remain only in the disposable session workspace). They are not
evidence for the report, except that the session-time S10 comparison used the intermediate run's raw excerpt
(`SESSION_RECORDS.md` R5).

## Harness changes after the recorded run (none re-run; none produced evidence here)

- **Labels:** S04, S05 and S06 `title` / `simulated` labels corrected.
- **New files:** `local-env.mjs` (runtime fixture password; replaced an inline command), `sanitize-evidence.mjs`,
  `README.md`, `.gitignore`.
- **`isolation.sh`:**
  - `apply` fails closed on a missing network or bridge, and refuses on IPv6-capable kernels.
  - `verify` asserts:
    - the key issuer, loopback URLs and rule presence;
    - the DB-side state: empty queue, empty config URLs, no HTTP-calling cron job;
    - that the container is running and the egress probe started inside it.

    It fails on any probe that cannot run.
  - `remove` matches the exact tag and recounts; it fails if any tagged rule remains.
- **Path handling:**
  - `bootstrap.mjs`, `scenarios.mjs` and `local-env.mjs` resolve their own paths with `fileURLToPath`.
  - The in-repo refusals resolve symlinks and treat only `..` / `../…` as outside.
- **`lib.mjs`:** `routeWebSocket` guard. **`scenarios.mjs`:** `route.fallback()`, plus refusal of an in-repo
  evidence directory and a non-loopback `API_URL`.
- **`vite.local.config.ts`:** refuses non-demo or `service_role` JWTs in `VITE_*`.
- **`fixtures.sql` / `reset.sql`:** guard comments corrected (no behaviour change).
- **Self-tests of these guards (no backend):**
  - the Vite config refused a non-loopback URL, a `service_role` JWT and a non-demo issuer, and started with a
    local anon key;
  - `isolation.sh apply` exited 1 without the stack network;
  - the `routeWebSocket` guard closed a non-loopback WebSocket and passed a loopback one through;
  - `local-env.mjs` and `scenarios.mjs` refused in-repo paths (including a `..raw` directory inside the repo
    and a symlink into it) and a non-loopback URL;
  - the `verify` DB-side assertions, run against a throwaway PostgreSQL 16 with stub tables, passed on a clean
    state and raised on a non-empty queue, a set config URL and an HTTP-calling cron job;
  - the `verify` production-ref check failed when the ref was present.

## Addendum, 2026-09-24 (America/Los_Angeles): `isolation.sh` failure-handling fix (implementation_plan.md §11)

This addendum does not change any evidence file. Screenshots, scenario JSON, checksums, the gate summary,
the migration list and the session transcriptions are byte-for-byte unchanged.

- **Correction.** Two statements above were not fully true of the version published at `cb6584af`.
  - The earlier `verify` statement "fails on any probe that cannot run" did not hold: a `docker exec` exit
    of 137/143 after `PROBE_STARTED`, or a probe exit 1 with no recognisable error, was reported as blocked.
  - The `remove` statement "recounts; it fails if any tagged rule remains" did not hold when a chain read
    failed: failed reads were ignored and "0 remain" was printed.
  - Both are fixed in `isolation.sh`: a validated probe-result envelope, and checked per-chain reads shared by
    `apply`, `verify` and `remove`.
- **Historical browser verification (unchanged):** the recorded run used the original, pre-hardening script
  (`SESSION_RECORDS.md` R3). Its results are not affected, and nothing was re-run.
- **New offline regression results (mocked; `tests/isolation.test.sh`):** these run the real script under
  stubs, with no Docker, firewall, Supabase CLI or network reachable.

  | Category | Fixed script | Pre-fix script (`cb6584af`) |
  |---|---|---|
  | ORIGINAL (the 5 reviewed cases) | 5/5 pass | 0/5 pass: each exited 0 claiming egress blocked or "0 remain" |
  | SAME-DEFECT variants | 5/5 pass | 0/5 pass under the final expectations: 4 were false successes that exited 0; 1 already failed closed but lacked the explicit read-failure diagnostic |
  | PROTOCOL (new result protocol) | 16/16 pass | 2/16 pass under the final expectations: 5 were false successes that exited 0 claiming egress blocked; the remaining failures are differences introduced by the new protocol/wording, not additional historical false-success defects |
  | BASELINE | 4/4 pass | 4/4 pass |
- **Real-infrastructure checks still NOT run:** the corrected script has not been executed against Docker,
  `iptables` or a Supabase stack. `apply` is not covered end-to-end; only its shared helper is.
