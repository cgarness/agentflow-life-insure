# Lead → Client conversion preservation — verification record

**Status (2026-10-21, 20:21 UTC): LIVE.** Migration `20261021200000` was applied once before the merge — not by the
session that prepared it (§8: no SQL Editor route there) — and verified read-only: read-back 11/11, the four
fingerprints identical to the 17:42 preflight, both advisor sets unchanged (§9). Frontend released by squash merge
`40a298c` (PR #476); both Vercel production deployments READY. Earlier entries below are kept as history.

Gate 1 status (kept): local build and disposable-database tests only. Contract: `implementation_plan.md` beside this
file (Gate 1 approved by Chris: D1–D9 and the file list, plus the mixed-version requirement in §5 below). **Updated for
the §14 bugfix** (explicit conversion note; unchanged person fields never rewritten): every value below is regenerated
for the corrected migration bytes; §7 records the bugfix proofs.

## 1. Production contact (read-only, Gate 1 §9.1)

One `list_migrations` and one SELECT (`release/production-readonly-check-20261021.json`). No write.

- Hosted head `20261021180000 / policy_commission_center_insights`; `20261021200000` sorts after it.
- PostgreSQL 17.6. Preimages equal the reviewed digests: converter `641ba66c…`, update writer `96e8f6e7…`, wrapper
  `3d974a5c…`, `private.insert_policy_sale` `3f600b75…`, `normalize_us_state` `c8905751…`; owners `postgres`,
  SECURITY DEFINER, `search_path = pg_catalog, pg_temp`, `anon` cannot execute.
- `clients` has none of the five new columns; triggers `clients_policy_identity`, `clients_policy_sale_complete`,
  `contact_history_capture`, `workflow_client_insert_trigger`.

## 2. Migration and rollback

| File | SHA-256 | MD5 | Bytes |
|---|---|---|---|
| `supabase/migrations/20261021200000_lead_client_conversion_preservation.sql` | `ce189016d2ca39af780c9f61909f74dd65c13b867a6238d8498cb9ce23729ae5` | `3b8f527b3991660d2ae0d03fe42b1af7` | 24,911 |
| `supabase/migrations/rollback/20261021200000_lead_client_conversion_preservation.rollback.sql` | `adffa3d3379c6114e865d130075bb83b2165be624f4263b2dd4d546ca841188e` | `88ee9a93cca27a200489c12320c81813` | 11,897 |

Superseded by the §14 bugfix (never applied anywhere but disposable databases): SHA-256 `b1488c4e…8127`, converter
post-image `ac116f01…`. Current post-image digests: converter `7109fdab661eac16ab6ff4f8d8343c20`, update writer
`6313ca0c1fc374a613bfcb7e9e587d4c` (unchanged by the bugfix),
guard `private.guard_client_lead_conversion()` `f2558ce56aae6f7db84df1b17f085aa0`. Both replaced bodies were diffed
against their source migrations: only the planned lines differ (plan §3.5–3.6). The rollback embeds the two preimage
bodies copied byte-for-byte from `20260812042319` and `20261005161611` (generated, not retyped) and re-verifies
`641ba66c…` / `96e8f6e7…` after restoring them.

## 3. Database proofs (`scripts/run_lead_conversion_preservation_tests.sh`)

Disposable localhost PostgreSQL 16.15 (locality and absence of hosted roles enforced by the runner), synthetic data
only. CI runs the same script on `postgres:17.6` (`.github/workflows/lead-conversion-preservation.yml`). Fixture =
production end state of the chain: verbatim sale writers + identity upgrade (`policy_commission_fixture.py`, which
asserts the converter preimage), applied commission migrations, contact-history migrations, baseline
`normalize_us_state`; fixture digests equal production's (§1).

| Stage | Result |
|---|---|
| Guards | Drift in the converter, the update writer or the wrapper; an `anon` EXECUTE grant; a pre-existing `age text` column; a missing `normalize_us_state` — each refused, nothing changed. |
| Inventory | Exactly 2 bodies replaced (owner, definer flag, ACL kept), 5 nullable columns with no default and no column ACL, 1 trigger + its guard; 1,043 other objects (functions, relations, columns, triggers, policies, schema ACLs) unchanged; replay refused. |
| Historical rows + release boundary | A full-row fingerprint of clients (minus new columns), leads, wins, policy identities, receipts, commission handoffs/captures/estimates/installments, calls, messages, campaign leads and contact-history events is identical before and after the migration; every existing client reads NULL in all new columns. A pre-release conversion's frozen retry replays exactly once with no change. See §5. |
| Preservation suite P2–P15 | `supabase/tests/lead_conversion_preservation.sql` — PASS (table below). |
| Differential | `supabase/tests/lead_conversion_differential.sql` run on a database without and with the migration: 1,706 canonical lines identical (7 clients, 10 sales, 10 policy identities, 7 receipts/handoffs, commission captures/estimates/8 installments, calls, SMS, timeline notes, appointments, campaign rows, 21 history events, 3 refusals). Excluded as intended changes: the new columns, `state` (now populated; P2) and client `notes` (an older browser's distinct notes text no longer replaces the lead notes; P4). |
| Existing suites with the migration | Commission security, handoff, tracking, expected windows, center (11 sections) and insights (8 sections) PASS; the 44-step sale/identity/performance/Sold Date/reconciliation/reviewed-repair chain PASS with the migration inserted after the last suite that pins the old converter bytes. |
| Race | Two independent backends submit the same conversion: identical results, one client, one sale, notes and state preserved. |
| Rollback | Restores both exact preimages; preserved data, protection trigger and its refusal kept; the restored converter runs as before; second rollback refused; forward re-apply restores the post-images. |

Suite scenarios (every conversion through `convert_lead_to_client_with_sales_handoff` as `authenticated`):

| ID | Proves |
|---|---|
| P2 | Names, phone, email, owner, state (`' california '` → `CA`), DOB, age, best time, spouse object, notes and custom fields from the locked row, while the payload carries a stale bag and a notes copy; full history content. |
| P3 | Arbitrary custom fields (number, boolean, nested, spaced keys, punctuation, Unicode, empty, JSON null) survive; injected/stale payload keys ignored; `additional_policies` verbatim and in order; three sales with correct policy ids, premium snapshots and seller; commission slots recorded; lead's reserved key / non-object bag set aside in history; NULL and `{}` bags kept. |
| P4 | Notes matrix, 9 cases each from the current browser (explicit `conversion_note`) and an older browser (`notes`): the agent's explicit note becomes the Notes with displaced lead notes kept; an older browser's differing text never becomes the Notes — the current lead notes stay and the text is kept as `legacy_conversion_notes`; blank/equal/whitespace cases keep the database notes. |
| P5 | `authenticated` and `service_role` cannot insert or change history; `postgres` cannot change it; lineage mismatch refused; the update writer refuses the key; ordinary edits unaffected. |
| P6 | Blank lead values stay NULL / JSON null; text spouse, unknown state, legacy DOB format kept verbatim. |
| P7 | Calls (duration, disposition, recording, campaign ids), SMS (both link paths), email, appointment, task, activity, timeline note and workflow execution move; campaign row preserved; sale carries the campaign; contact history records `converted` with no capture gap. |
| P9 | A failure after the client insert (invalid additional sold date) and an invalid frequency roll back everything; a later valid conversion preserves everything. |
| P10 | Same-request replay returns the one client; a changed payload is PT409; another request with the same payload is idempotent. |
| P11 | Cross-organization, non-owner agent and out-of-downline Team Leader refused; Team Leader, Admin, Super Admin (home org) and unassigned-lead conversions succeed; nothing crosses organizations. |
| P12 | Personal, Team and Open Pool campaign conversions and a no-campaign (Floating Dialer) conversion, each with a stale snapshot, preserve the database lead and record the right campaign; a campaign not containing the lead is refused. |
| P14 | The update writer saves and clears the four person fields, refuses `lead_source`, `lead_conversion` and a bad age; history unchanged; contact history records the edited fields by name; the first-policy companion still records one sale. |
| P15 | An older browser's edit (old keys + whole custom bag) changes only what it sent; padded text, a legacy DOB format and an out-of-range age survive an unrelated edit byte-for-byte. |
| P16 | A payload with both note forms is refused (22023 "Conversion notes were sent in two formats. Refresh AgentFlow and try again.") and changes nothing. |

Fail-first: with the columns present but the original bodies restored (rollback), the suite fails at P2.

**Release scripts rehearsed** (`release/preflight.sql`, `release/readback.sql`, read-only): on a pre-migration fixture
with a hosted-style `supabase_migrations.schema_migrations` and a stand-in `workflow_client_insert_trigger`, preflight
12/12 → apply + history row → read-back 11/11, with the four fingerprints (clients rows minus new columns, clients
policies, clients ACL, wins rows) identical across the apply; replay refused.

## 4. Frontend

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 (vacuous: solution-style root config, AGENT_RULES #35) |
| `npx tsc -p tsconfig.app.json --noEmit` | 84 errors = `main` `51b0e56` baseline 84; line-insensitive multiset identical; none in touched files |
| Vitest (full) | Final tree (after §14): 387 files passed / 10 failed / 2 skipped; 5,994 tests passed / 1 failed / 36 skipped. `main`: 383 / 10 / 2 files, 5,948 / 1 / 36 tests. The failure set is identical to `main` (9 files that need `VITE_SUPABASE_URL` in this environment, and `recordingRetentionVoicemail` deployed-bundle identity). +4 files, +46 tests (5,987 before §14). |
| ESLint (touched files) | 0 errors; 7 warnings identical to `main` (pre-existing in `FullScreenContactView.tsx`, `supabase-clients.ts`); new files clean |
| `npm run build` | passed |
| `git diff --check`, scans | clean; no secrets, service-role key, `.single()`, Telnyx or inline styles added |

New/updated suites: `clientLeadDetails` (Zod parse, editors, changed-only validation), `clientMapping` (mapping,
historical rows, patch semantics), `clientLeadHistory`, `fullScreenContactViewClientLeadFields` (read/edit, legacy
DOB, structured spouse, refusal keeps edit mode, historical client, leads unchanged, `additional_policies` excluded),
`conversionEntryPoints` (five entry-point lead shapes → identical server-authoritative submission; source contract
that every Convert surface uses the one handoff), `conversionContract` (notes), `contactFieldLayout` (default order).
Fail-first: the view suite fails 4/5 against the original component (the lead non-regression case passes on both);
the notes contract fails 6 cases against the old payload line.

## 5. Mixed-version compatibility (Chris's Gate 1 requirement)

| Browser | Database | Conversions | Client edits |
|---|---|---|---|
| Released (old) | Current | Today's defects | Unchanged |
| **Old** | **New** | Every preserved field comes from the locked row; the old tab's stale custom-field bag is ignored (P2, P3, P12, runner §3). Its unmarked `notes`: blank or equal to the database notes → the database notes; anything else cannot be classified, so the **current database lead notes stay the client's Notes** and the submitted text is kept verbatim as read-only "Conversion notes (older app version)" (P4 older-browser matrix, runner §3). Frozen pre-release retries replay exactly once (runner §3). | The old patch never contains the new keys; person fields, history and policies are untouched (P15, runner §3). |
| New | New | Target behavior; the browser sends only the agent's note, marked `notes_source: "conversion_note"` (P4 current-browser matrix, `conversionContract`, `conversionEntryPoints`). | Saves only the person fields the agent changed (P14, view suite). |
| New | Old | Must not happen (database first). It degrades safely: the old database ignores the marker and reads `notes` as today, so a typed note is kept (runner §3 release-order case); a client save that sends a new person field is refused with `Invalid client edit` and stays in edit mode (no loss, no false success). | — |

**Transitional risk after the §14 bugfix:** none that loses or silently replaces original lead information. During the
window between the database release and agents refreshing, an old tab's agent-typed conversion note that differs from
the lead notes lands in "Conversion notes (older app version)" instead of the client's Notes (visible, verbatim,
read-only); the client's Notes stay the current lead notes. Agents refreshing promptly after the frontend release
shortens the window. An unknown `notes_source` fails closed with a refresh instruction.

## 6. Not proven here (stated honestly)

- Signed-in browser conversions through the five entry points against a real backend: they would write production
  data (AGENT_RULES #28) and were not run. Coverage is the SQL suite per campaign type plus component/contract tests
  per entry point. An optional signed-in check on an approved Supabase preview branch can be requested separately.
- The local cluster is PostgreSQL 16.15; production is 17.6. Preimage digests match across both (§1, fixture); the
  CI job on `postgres:17.6` confirms the post-image digests used by the rollback and read-back.
- The fixture has no `workflow_client_insert_trigger` (production does; its dispatch is exception-swallowing, #10, and
  it fired on conversion inserts before this change too).
- Observed and out of scope (not fixed): a kanban drop of a card not on the current table page does nothing; the
  Dialer drawer's camelCase merge leaves `row.custom_fields` stale; the deep-link page has no Convert button;
  `rowToClient` maps a nonexistent `clients.user_id`. Conversion is now immune to the stale-snapshot ones.

## 7. §14 bugfix proofs (2026-10-21)

Chris reported PR #476's seven workflows and both Vercel previews green, then asked for two corrections before Gate 2.
`main` unchanged at `51b0e56`; no new Work Log entries or conflicting work. No production contact in this pass.

**Mixed-version notes.** The new browser marks its note with `notes_source: "conversion_note"`; an older browser's
unmarked differing `notes` is kept separately and never becomes the Notes; an unknown marker is refused (22023, refresh
instruction). Proofs: P4 (18 cases: current-browser and older-browser matrices), P16 (unknown and null markers refused,
nothing changed), runner §3 (old tab after release keeps the current Notes and the stale text separately; new browser
on the OLD database keeps a typed note), `conversionContract` and `conversionEntryPoints` (every entry point sends
`notes` = the agent's note or null plus the marker, never a lead copy), `clientLeadDetails`/`clientLeadHistory` (the
older-version notes are parsed and shown read-only). Fail-first: against the previous migration the current-browser
matrix still passes (same behavior) and the older-browser matrix fails. A first draft used a separate
`conversion_note` key; review showed the old database would have ignored it and dropped a typed note in a
frontend-first accident, so the marker design replaced it before any commit.

**Unchanged person fields.** `clientUpdatePatch` sends non-blank text verbatim (no trimming), and the profile omits
every person field the agent did not change (`omitUnchangedPersonFields`, the same changed-field set the Zod check
uses). Proofs: `clientLeadDetails` (omission rules, structured comparison, the form is not mutated), `clientMapping`
(verbatim patch), the view suite (an unrelated edit sends none; an end-to-end case through the real
`clientsSupabaseApi.update` shows the `update_client_with_policy_sale` patch carries no preserved field for an
unrelated edit and only the changed one, as typed, otherwise), SQL P15 (padded text, a legacy DOB and age 140 survive an
unrelated edit byte-for-byte). Fail-first: 4 cases fail against the previous `FullScreenContactView`/`supabase-clients`.

**Regenerated values.** Migration SHA-256 `ce189016…9ae5` (24,911 bytes), rollback `adffa3d3…188e`, converter
post-image `7109fdab…` (rollback guard, runner, read-back updated); update writer `6313ca0c…` and guard `f2558ce5…`
unchanged. SQL runner: all stages PASS on PostgreSQL 16.15 (39 s; differential 1,706 identical lines). Release
rehearsal: preflight 12/12, read-back 11/11, fingerprints identical, replay refused, rollback restores
`641ba66c…`/`96e8f6e7…`. Frontend gates on the final tree: root `tsc --noEmit` exit 0; app typecheck 84 = `main` (identical multiset); Vitest
5,994 passed with the failure set identical to `main`; scoped ESLint 0 errors (7 pre-existing warnings, identical);
build passed; `git diff --check` and secret/pattern scans clean. Previous head `c6f17a2`: all seven workflows green
(both PostgreSQL 17.6 jobs included), Supabase Preview cancelled (the accepted, recorded exception).
Final head `439d0cb`: every workflow green (12 checks; "Reports frontend verification" included), both Vercel previews
ready, Supabase Preview skipped (concurrent preview-branch limit; same accepted exception), no merge conflict.

## 8. Gate 2 — approval, package, rehearsal and production preflight; NOT applied (2026-10-21, 17:40–17:55 UTC)

**Approval.** Chris approved the database-only release of `20261021200000_lead_client_conversion_preservation.sql` to
`jncvvsvckxhqgqvkppmj`, SHA-256 `ce189016d2ca39af780c9f61909f74dd65c13b867a6238d8498cb9ce23729ae5`, through the
version-preserving SQL Editor route, with stop-and-report on any discrepancy. No backfill. Gate 3 not approved.

**1. Checksum.** SHA-256 `ce189016…9ae5`, MD5 `3b8f527b3991660d2ae0d03fe42b1af7`, 24,911 bytes — identical in the
working tree, at PR head `439d0cb`, at `6621d9b` and on `origin/claude/sweet-fermi-jpsnyn`.

**2. Production, read-only (17:42 UTC; `list_migrations`, `execute_sql` SELECTs, `get_advisors`).**
- History: 341 rows; hosted head `20261021180000 / policy_commission_center_insights`; nothing at or after
  `20261021200000`. Session `postgres`, PostgreSQL 17.6, TimeZone UTC. History columns `version, statements, name,
  created_by, idempotency_key, rollback`. Event triggers: the six known pgrst/graphql/cron/net helpers.
- `release/preflight.sql`: **12/12 `t`** — server 17.6; version free and sorts last; converter `641ba66c…`, update
  writer `96e8f6e7…`, wrapper `3d974a5c…`, `insert_policy_sale` `3f600b75…`, `normalize_us_state` `c8905751…`; writer
  owner/definer/`search_path`/ACL unchanged and no `anon` EXECUTE; the five columns and the guard absent; `clients`
  triggers exactly the four known; no waiting lock on `clients`.
- Fingerprints: `clients_rows` 19 / `eda90062…`, `clients_policies` 1 / `eb563177…`, `clients_acl` `46875263…`,
  `wins_rows` 20 / `3801e71a…`. The read-back must reproduce these unless a real user wrote clients or sales in
  between, which must then be explained.
- Advisors: security **253** (finding-set MD5 `6aea31d7…`), performance **452** (`e4775516…`); the same totals as the
  previous Gate 2 record. Expected delta after the apply: none.
- Machine-readable: `release/gate2-preflight-evidence.json`.

**Package.** `release/build_apply.py` → `release/apply_20261021200000.sql`: 28,862 ASCII bytes, SHA-256
`fd796409d106b6f84c57ad187982ef794218a451b5d8d5a384ba815ff837742a` (deterministic; two runs identical). Same method as
the Commissions center and insights releases: one request; the migration's own `lock_timeout 1s` /
`statement_timeout 60s`; the reviewed text as a dollar-quoted literal with its three non-ASCII characters (— → ─) as
placeholders expanded server-side; refuses unless the expanded text is 24,911 bytes with the approved MD5 and
SHA-256, the preflight's hosted head `20261021180000` is recorded, nothing is recorded at or after `20261021200000`,
and the caller is `postgres`; EXECUTEs the text unchanged (its own preimage, metadata, replay and post-image guards run
inside); records `(20261021200000, lead_client_conversion_preservation, ARRAY[text])`.

**Rehearsal (disposable PostgreSQL 16.15, loopback).** Pre-migration fixture plus hosted-style history (production's
columns; `20261020212000` and `20261021180000` recorded), production's default privileges for `postgres` in `public`, a
stand-in `workflow_client_insert_trigger`, and seeded pre-release history (an old-browser conversion, a manual client
with a recorded policy, a new-browser note on the old database: 3 clients, 4 sales).

| Step | Result |
|---|---|
| Preflight before apply | 12/12 `t` |
| One changed byte in the sent text | refused ("release text differs…"); nothing created, no history row |
| A later version recorded | refused ("would not sort last"); the disposable row removed afterwards |
| Preflight head not recorded | refused ("hosted head observed at preflight is not recorded") |
| A superuser other than `postgres` | refused ("apply as postgres") |
| Open `ROW EXCLUSIVE` lock on `clients` | refused after 1.17 s (lock timeout); nothing created |
| Preflight after the refusals | 12/12 `t` |
| Apply (one request) | 0.058 s, no output; history `20261021200000 / lead_client_conversion_preservation`, one statement, 24,911 bytes, MD5 `3b8f527b…`, SHA-256 `ce189016…`; it is the head |
| Read-back | 11/11 `t`; the four fingerprints identical to the preflight's; 13-table full-row fingerprint identical; digests `7109fdab…` / `6313ca0c…` |
| Catalog | only the two replaced function bodies changed; added exactly the five columns, the guard function and the guard trigger |
| Replay | refused by the package (version recorded) and by the file's own preimage guard; one history row; preflight then 6/12 as designed (2, 3, 4, 9, 10, 11) |
| Preservation suite on the package-applied database | PASS |
| Rollback from the package-applied state | both preimages restored (`641ba66c…` / `96e8f6e7…`) |
| Reference `psql -1 -f` on a fresh copy of the same seeded state | schema dump identical (9,509 lines; one contact-history fixture function embeds its own install time, normalized) and catalog inventory identical (1,054 objects) |

**3. Apply — NOT performed (blocker).** The approved route is the Supabase SQL Editor as `postgres`. This cloud
session has no browser or computer-use tool and no reachable Claude session on Chris's computer (`ListAgents`: none),
so it cannot use that route. `execute_sql` stayed SELECT-only (AGENT_RULES §11) and `apply_migration` was not used (it
stamps its own version). Per the approval's stop-and-report rule, nothing was written: no history row, column,
function, trigger or client value. Steps 4–5 (read-back, post-apply fingerprints and advisors) wait for the apply.

**To finish Gate 2** (the approval and bytes are unchanged): immediately before the apply, re-run `preflight.sql`
(12/12) and the fingerprints read-only; paste `release/apply_20261021200000.sql` (SHA-256 `fd796409…742a`, 28,862 bytes)
unchanged into the SQL Editor (Primary database, role `postgres`) and Run it once as one request — expect "Success. No
rows returned"; on any error do not retry. Then `readback.sql` 11/11, history text SHA-256 `ce189016…`, the four
fingerprints equal to the fresh preflight's, and both advisors compared with the baseline above.

## 9. Gate 2 completed — post-apply read-back (2026-10-21, 20:18–20:21 UTC; read-only)

**How it was applied.** Not by this session: §8 stopped before any write. Between the 17:42 preflight and 20:18 the
migration was applied outside this session (route not observed here); merge commit `40a298c` states it was applied and
verified before the merge. The stored history row is exactly what the version-preserving package records.

**History.** 342 rows (341 + 1); head `20261021200000 / lead_client_conversion_preservation`; previous head
`20261021180000` still recorded; no other row added (no baseline replay). The row holds **one** statement: 24,911 bytes,
MD5 `3b8f527b3991660d2ae0d03fe42b1af7`, SHA-256 `ce189016d2ca39af780c9f61909f74dd65c13b867a6238d8498cb9ce23729ae5` —
the reviewed file byte for byte; `created_by`, `idempotency_key` and `rollback` NULL.

**`readback.sql`: 11/11 `t`.** History row; stored text is the reviewed file; converter `7109fdab…`; update writer
`6313ca0c…`; wrapper `3d974a5c…` and `insert_policy_sale` `3f600b75…` unchanged; writer owner, definer flag,
`search_path` and ACL unchanged, no `anon` EXECUTE; guard `f2558ce5…` (owner `postgres`, invoker, EXECUTE `postgres`
only); trigger `clients_lead_conversion_guard` enabled with the exact definition; the five columns exact (nullable, no
default, no column ACL); no existing client has a value in any new column; `clients` triggers exactly the five expected.

**Existing data (fingerprints identical to the 17:42 preflight).** `clients_rows` 19 / `eda900620f2a4b3432692f6b005b9a08`
(excluding the five new columns, all NULL), `clients_policies` 1 / `eb56317784a48539aee785497258dca1`, `clients_acl`
`46875263bd6598c4534e2df7d1847a5e`, `wins_rows` 20 / `3801e71a32660dcbb497cc83f7db4fc7`. No client, sale, RLS policy or
table grant changed, and no conversion had run on the new functions at read-back time.

**Advisors.** Security **253 → 253**, performance **452 → 452**; the full finding sets (name, level, detail,
metadata; observation times excluded) are identical — zero added, zero removed (set digests `6aea31d7…`,
`e4775516…`).

**Frontend.** PR #476 squash-merged by Chris as `40a298c` at 20:18:05 UTC; Vercel production deployments READY for
that commit on both projects (`agentflow` `dpl_7usFF2Q1…`, `agentflow-life-insure` `dpl_3gtzqNve…`). Not performed or
claimed here: signed-in production conversions (they would write production data). Agents should refresh open tabs;
until they do, an old tab's differing conversion note is kept in the read-only history instead of Notes (§5).

Machine-readable: `release/gate2-readback-evidence.json`.
