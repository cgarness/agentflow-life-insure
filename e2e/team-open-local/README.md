# Team/Open local verification harness (TEST-ONLY)

This harness runs the real AgentFlow dialer against a **disposable, isolated, local** Supabase stack, using
synthetic data and genuine local Agent sessions. It was used for the rev 7 verification on 2026-09-24:
- plan: `implementation_plan.md` §10;
- report: `docs/audits/2026-09-24/LOCAL_VERIFICATION_REPORT.md`;
- evidence: `evidence/INDEX.md`.

**Recorded run vs hardening.** Some safety checks below were added **after** the recorded run, while the
evidence was being published, in response to an adversarial review. They are marked *(post-run)*. The recorded
run used the earlier versions, and **no scenario was re-run with the hardened harness**. The *(post-run)* guards
were exercised only by harness self-tests with no backend. `evidence/INDEX.md` has the complete list of post-run changes and self-tests; report §6 summarises them.

## Safety properties (do not weaken)

**Not part of the app.** Nothing in `src/`, `index.html`, `vite.config.ts`, `tsconfig.app.json`,
`tsconfig.node.json`, `vitest.config.ts` or the `package.json` scripts references this directory. The fake
Voice.js module is used only through `vite.local.config.ts`. No CI workflow runs it.

**Checks per script:**

| Script | Refuses / enforces |
|---|---|
| `vite.local.config.ts` | Refuses a `VITE_SUPABASE_URL` other than `http://127.0.0.1:<port>`. Never reads repo `.env*` files (`envDir` is non-existent). *(post-run)* Refuses any `VITE_*` value that is a JWT with a non-`supabase-demo` issuer or the `service_role` role. |
| `local-env.mjs` *(post-run; replaced an equivalent inline command)* | Refuses a non-loopback `API_URL`, refuses an anon or service key whose issuer is not `supabase-demo`, and refuses a workspace inside the repository. Generates the fixture password at runtime. |
| `bootstrap.mjs` | Refuses a non-loopback `API_URL`, a DB container other than `supabase_db_agentflow-localverify`, the production project ref anywhere in the env file, and a **service** key whose issuer is not `supabase-demo`. |
| `fixtures.sql`, `reset.sql` | Refuse when any non-fixture organization exists. This is a fresh-stack check, **not** a locality check. `reset.sql`'s DELETEs are unscoped (whole tables), so locality depends on the harness only ever running them via `docker exec` into the disposable container. |
| `scenarios.mjs`, `lib.mjs` | Talk only to `127.0.0.1` (app and API) and to the fixed DB container. *(post-run)* Refuse a non-loopback `API_URL` and an evidence directory inside the repository (symlink-aware). |
| `isolation.sh` | See below. |

**Credentials.**
- The fixture password is generated at runtime into `<ws>/lv.env.json` (mode 600, outside the repo).
- The local service key passes through `local-env.mjs` and `scenarios.mjs` in memory. It is **used** only by
  `bootstrap.mjs`, a Node process, and never sent to the browser.
- `.gitignore` here ignores raw `evidence.json`, `lv.env.json`, `lv.users.json` and `status.json`.

**No telephony.** `fakeTwilioVoice.ts` has no network access and no Twilio SDK. It cannot place calls, send
SMS or send email.

**Server-side isolation (`isolation.sh`).**
- Tagged **IPv4** `iptables` rules block container egress, container→host connections, and non-loopback
  ingress to 54321/54322.
- *(post-run)* `apply` fails closed if the network or bridge is missing, and refuses on an IPv6-capable kernel,
  because there are no `ip6tables` equivalents yet.
- *(post-run)* `verify` asserts loopback URLs, the local-demo key issuer, the presence of the 4 rules, the
  production ref's absence from `config.toml` and `lv.env.json`, and the DB-side state (empty queue, empty
  config URLs, no HTTP-calling cron job). It also requires a running container before the egress probe.
  It fails on any probe that cannot run. The egress probe shows that egress is blocked, not which control
  blocks it.
- *(post-run)* `remove` deletes only rules with the exact tag, then recounts and fails if any remain.

**Browser isolation (`lib.mjs`).**
- Host-resolver rules map every host except loopback to NOTFOUND. This covers hostnames only, not IP
  literals.
- `--no-proxy-server`.
- A route guard aborts non-loopback HTTP(S).
- *(post-run)* A `routeWebSocket` guard closes non-loopback WebSockets.
- *(post-run)* Scenario page routes use `route.fallback()`, so the guard still applies.
- In the recorded run, WebSockets were only recorded, and every recorded WebSocket host was loopback.

## Files

| File | Role |
|---|---|
| `vite.local.config.ts` | Dev server on 127.0.0.1:8089; swaps `@/lib/twilio-voice` for the fake. |
| `fakeTwilioVoice.ts` | Browser fake of the Voice.js wrapper, driven by `window.__fakeVoice`. |
| `local-env.mjs` | Writes `<ws>/lv.env.json` from `supabase status -o json`, with a fresh random fixture password. |
| `bootstrap.mjs` | Creates the 4 synthetic Auth users, then loads `fixtures.sql` via `docker exec`. |
| `fixtures.sql` / `reset.sql` | Synthetic orgs, users' profiles, campaigns, leads, custom fields and settings; return to baseline. |
| `isolation.sh` | `apply` / `verify` / `remove` for server-side isolation and locality assertions. |
| `lib.mjs` / `scenarios.mjs` | Playwright helpers and the S01–S11 scenarios. The evidence directory must be outside the repo. |
| `sanitize-evidence.mjs` | Derives publishable evidence: redacts JWTs and tokens, summarises network data. |
| `evidence/` | Published evidence from the 2026-09-24 run (see `evidence/INDEX.md`). |

## Reproduce

Follow report §6. Summary:
1. Create a disposable workspace copy of `supabase/` with `project_id = "agentflow-localverify"`.
2. Run `supabase start` with the migrations held back.
3. `isolation.sh apply`.
4. `db reset --local`, then the reference bootstrap.
5. `supabase status -o json | node local-env.mjs <ws>`.
6. `bootstrap.mjs`.
7. `isolation.sh verify`.
8. Start Vite with `env -i` and only the two local `VITE_SUPABASE_*` values.
9. `node scenarios.mjs <ws> <evidence-dir outside the repo>`.
10. `sanitize-evidence.mjs`.
11. `supabase stop --no-backup` and `isolation.sh remove`.

It requires Docker and the repo-pinned Supabase CLI. Never point it at a hosted project.
