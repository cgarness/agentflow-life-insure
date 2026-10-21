# Lead → Client conversion preservation — verification record

**Status (2026-10-21):** Gate 1 complete — local build and disposable-database tests only. Migration
`20261021200000` is **NOT applied** anywhere but disposable localhost clusters; frontend **NOT merged or released**.
Stopped at Gate 2. Contract: `implementation_plan.md` beside this file (Gate 1 approved by Chris: D1–D9 and the file
list, plus the mixed-version requirement in §5 below).

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
| `supabase/migrations/20261021200000_lead_client_conversion_preservation.sql` | `b1488c4e3285e9fead40406d37fcfcce81d90f7ac81e211607492ffc723c8127` | `35f1eb12bdda76daf6124b7783ba8248` | 23,279 |
| `supabase/migrations/rollback/20261021200000_lead_client_conversion_preservation.rollback.sql` | `59add9cabf76c5838212529b662ba63cb1ed46418beafde3fca994e98db2049e` | `92345b07ef783f29e60f0870596d61a9` | 11,897 |

Post-image digests: converter `ac116f01810768581707e837a5ca3b99`, update writer `6313ca0c1fc374a613bfcb7e9e587d4c`,
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
| Differential | `supabase/tests/lead_conversion_differential.sql` run on a database without and with the migration: 1,713 canonical lines identical (7 clients, 10 sales, 10 policy identities, 7 receipts/handoffs, commission captures/estimates/8 installments, calls, SMS, notes, appointments, campaign rows, 21 history events, 3 refusals). Only `state` (now populated) and the new columns are excluded. |
| Existing suites with the migration | Commission security, handoff, tracking, expected windows, center (11 sections) and insights (8 sections) PASS; the 44-step sale/identity/performance/Sold Date/reconciliation/reviewed-repair chain PASS with the migration inserted after the last suite that pins the old converter bytes. |
| Race | Two independent backends submit the same conversion: identical results, one client, one sale, notes and state preserved. |
| Rollback | Restores both exact preimages; preserved data, protection trigger and its refusal kept; the restored converter runs as before; second rollback refused; forward re-apply restores the post-images. |

Suite scenarios (every conversion through `convert_lead_to_client_with_sales_handoff` as `authenticated`):

| ID | Proves |
|---|---|
| P2 | Names, phone, email, owner, state (`' california '` → `CA`), DOB, age, best time, spouse object, notes and custom fields from the locked row, while the payload carries a stale bag and a notes copy; full history content. |
| P3 | Arbitrary custom fields (number, boolean, nested, spaced keys, punctuation, Unicode, empty, JSON null) survive; injected/stale payload keys ignored; `additional_policies` verbatim and in order; three sales with correct policy ids, premium snapshots and seller; commission slots recorded; lead's reserved key / non-object bag set aside in history; NULL and `{}` bags kept. |
| P4 | Notes matrix (9 cases incl. whitespace, equal text and an old tab's stale copy): never lost. |
| P5 | `authenticated` and `service_role` cannot insert or change history; `postgres` cannot change it; lineage mismatch refused; the update writer refuses the key; ordinary edits unaffected. |
| P6 | Blank lead values stay NULL / JSON null; text spouse, unknown state, legacy DOB format kept verbatim. |
| P7 | Calls (duration, disposition, recording, campaign ids), SMS (both link paths), email, appointment, task, activity, timeline note and workflow execution move; campaign row preserved; sale carries the campaign; contact history records `converted` with no capture gap. |
| P9 | A failure after the client insert (invalid additional sold date) and an invalid frequency roll back everything; a later valid conversion preserves everything. |
| P10 | Same-request replay returns the one client; a changed payload is PT409; another request with the same payload is idempotent. |
| P11 | Cross-organization, non-owner agent and out-of-downline Team Leader refused; Team Leader, Admin, Super Admin (home org) and unassigned-lead conversions succeed; nothing crosses organizations. |
| P12 | Personal, Team and Open Pool campaign conversions and a no-campaign (Floating Dialer) conversion, each with a stale snapshot, preserve the database lead and record the right campaign; a campaign not containing the lead is refused. |
| P14 | The update writer saves and clears the four person fields, refuses `lead_source`, `lead_conversion` and a bad age; history unchanged; contact history records the edited fields by name; the first-policy companion still records one sale. |
| P15 | An older browser's edit (old keys + whole custom bag) changes only what it sent. |

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
| Vitest (full) | 387 files passed / 10 failed / 2 skipped; 5,987 tests passed / 1 failed / 36 skipped. `main`: 383 / 10 / 2 files, 5,948 / 1 / 36 tests. The failure set is identical to `main` (9 files that need `VITE_SUPABASE_URL` in this environment, and `recordingRetentionVoicemail` deployed-bundle identity). +4 files, +39 tests. |
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
| **Old** | **New** | Every preserved field comes from the locked row; the old tab's stale custom-field bag is ignored (P2, P3, P12, runner §3). Its notes fallback: an identical copy is ignored; a **stale** copy becomes the client's Notes while the current database notes are kept verbatim as read-only "Original lead notes" (P4 case 7, runner §3). Frozen pre-release retries replay exactly once (runner §3). | The old patch never contains the new keys; person fields, history and policies are untouched (P15, runner §3). |
| New | New | Target behavior; the browser sends only the conversion note (P4, `conversionContract`). | Saves the four person fields (P14, view suite). |
| New | Old | Must not happen (database first). It degrades safely: conversions behave as today; a client save that sends a new person field is refused with `Invalid client edit` and stays in edit mode (no loss, no false success). | — |

**Remaining transitional risk** (between the database release and every agent refreshing onto the new frontend):
an old tab converting a lead **without** typing a conversion note, whose in-memory notes are older than the database
(edited elsewhere after that tab loaded the lead), makes that older copy the client's Notes. Nothing is lost — the
current lead notes are preserved verbatim and shown as "Original lead notes" — but the client's Notes field shows the
older text until edited. The server cannot tell such a fallback from a typed note. Mitigation: release the frontend
promptly after Gate 2 and ask agents to refresh after their current call. No other mixed-version path loses or
silently replaces original lead information.

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
