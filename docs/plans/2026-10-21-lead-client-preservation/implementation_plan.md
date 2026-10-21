# Lead → Client conversion: preserve every meaningful lead field (future conversions only)

**Status (2026-10-21): Gate 1 COMPLETE — built and verified locally; draft PR; stopped at Gate 2.** Chris approved
Gate 1 (D1–D9, the file list, local implementation, tests, commits, pushes and one draft PR) and added a mixed-version
requirement (old browser sessions after the migration). Migration `20261021200000` is NOT applied to production; the
frontend is NOT merged or released. The only production contact was the approved read-only check (§9.1). Evidence:
`verification.md` beside this file. Branch `claude/sweet-fermi-jpsnyn` from `main` `51b0e56`.

**Build amendment (no scope change):** replay protection is the preimage-digest guard (a second apply finds the
post-images and refuses), so the function-only rollback can keep the protection trigger and a forward re-apply still
works (`CREATE OR REPLACE TRIGGER`). The release scripts are `release/preflight.sql` and `release/readback.sql`
(rehearsed); the version-preserving apply package for the SQL Editor route is generated at Gate 2.

Original Step 1 status: plan only; no code, SQL, test or backend command before approval.

Scope (from the request): future conversions only. No historical backfill, no data recovery, no change to existing
client rows, no unrelated features or redesign. No merge, production migration or deployment without separate
approval.

## 0. Source of truth (read 2026-10-21)

- **AGENT_RULES**: §3 multi-tenancy; invariant #10 (automation never blocks core writes), #11 (Dialer conversion
  gate), #25 (applied migrations immutable), #27 (custom-field identity), #28 (production read-only by default), #34
  (book of business), #35 (`additional_policies` reserved), #36 (save surfaces never report a save that did not
  happen), #37 (writer-role EXECUTE), #40 (one policy = one sale, stable policy ids), §5 conversion-lineage gotcha,
  "Leaderboard sale recording", "Saved policy commissions — Phase 2A" ("any later change to a sale writer must
  re-verify the companions' conflict-message → PT409 mapping and sale hashes"), "Commissions center", "Commissions
  insights", §7 component standards, §8 workflow, §10 forbidden patterns. VISION (telemetry first; insurance-native).
- **WORK_LOG** newest entries: Commissions insights Gate 2/3 (PR #474, now merged as `51b0e56`). No open work touches
  conversion, clients columns or the client profile. No conflict.
- **Migration history (repository).** `convert_lead_to_client_atomic(uuid,jsonb)`: baseline `20260806000000` →
  last redefined by `20260812042319_client_policy_sold_draft_payment_fields.sql`. Wrapped (never replaced) by
  `convert_lead_to_client_with_sales` (`20261004000819`), patched by `20261005161611` (policy identity; the original
  converter body is untouched), wrapped again by `convert_lead_to_client_with_sales_handoff` (`20261019170000`).
- **Live definition — evidence without contacting production.** The production apply guards of `20261019170000`
  (applied 2026-10-19) and `20261020040000` (applied 2026-10-20) refuse unless
  `md5(pg_get_functiondef(...))` equals `641ba66c96ca4a76f80c9c85eb9caa42` for the converter and
  `96e8f6e7ecc85d0d5385bf8640a144a6` for `update_client_with_policy_sale`; both applied. `scripts/policy_sale_fixture.py`
  asserts the repository body of `20260812042319` produces exactly `641ba66c…`. No later migration
  (`20261020171244`, `20261020212000`, `20261021180000`) touches either function. So the live converter is the
  repository body. **Step 2 re-confirms this read-only** before any SQL is written (see §9), and the new migration
  refuses to apply if the live bodies differ.
- **Hosted head** per the 2026-10-21 records: `20261021180000`. The new version must sort after the hosted head at
  release time (Commissions center ordering rule); re-check with `list_migrations` immediately before Gate 2.

## 1. Verified defects (current code)

| # | Defect | Where |
|---|---|---|
| 1 | The INSERT copies names, phone, email, notes, assigned agent, payload custom fields and `lead_id` only. **`state` is never written** although `clients.state` exists. DOB, age, best time to call, spouse info, lead source, lead status, lead score and lead timestamps are discarded when the lead row is deleted. | `20260812042319…sql` `INSERT INTO public.clients (…)` |
| 2 | `custom_fields` comes **only from the browser payload** (`p_client->'custom_fields'`), built from the in-memory lead. Stale snapshots exist: Contacts list rows patched locally, the Personal Dialer's merged `campaign_leads` row, the Dialer drawer's camelCase merge that leaves `row.custom_fields` stale. The locked database lead row is ignored. | atomic `v_cf := … p_client->'custom_fields'`; `supabase-conversion.ts:35-51`; `DialerPage.tsx:4708-4720` |
| 3 | **Notes are silently overwritten.** "Internal Conversion Notes" replace the lead's notes (`COALESCE(NULLIF(p_client->>'notes',''), v_lead.notes)`); nothing else keeps them, and the lead row is deleted. The browser also falls back to a possibly-stale `lead.notes` (`notes: policyInfo.notes \|\| lead.notes \|\| null`), so even without a conversion note the database notes can be replaced by an old copy. | atomic INSERT; `supabase-conversion.ts:58-80` |
| 4 | The client profile has no place for these fields: `Client` has no DOB/age/best-time/spouse/history; the lead-only cases in `FullScreenContactView` return `null` for clients; the client edit RPC `update_client_with_policy_sale` has a fixed key allowlist (any new key → `22023 Invalid client edit`). | `types.ts:108-140`; `FullScreenContactView.tsx:1061-1121`; `20261005161611…sql:230-248` |

All five entry points — Contacts (status select, row menu, kanban drop, profile Convert), Personal Dialer, Team
Dialer, Open Pool Dialer, Floating Dialer — open `ConvertLeadModal`, which calls
`conversionSupabaseApi.convertLeadToClientHandoff` → `convert_lead_to_client_with_sales_handoff` →
`convert_lead_to_client_with_sales` → `convert_lead_to_client_atomic`. A server-authoritative fix therefore covers
every entry point, whatever snapshot its `lead` object holds.

## 2. Design summary

1. **The server reads the lead from the locked row** it already holds `FOR UPDATE` and writes every preserved field
   from it. The browser payload keeps supplying only what the agent entered at conversion (policy details,
   beneficiary, conversion notes, additional policies). No new RPC, no new signature, no change to the wrapper or
   the commission companion.
2. **Current person fields become ordinary client columns** (editable in the profile): `date_of_birth text`,
   `age integer`, `best_time_to_call text`, `spouse_info jsonb`. `state` already exists and is now populated.
3. **Historical-only metadata goes into one protected, read-only column** `clients.lead_conversion jsonb`: original
   lead status, original lead source, lead score, lead created/last-contacted timestamps, lead owner/importer ids,
   converted at/by, the lead id, and — only when they would otherwise be lost — the lead's displaced notes and any
   lead custom-field value that cannot live in the client namespace. A trigger refuses every change to it after
   insert and refuses it on any insert that is not the conversion function.
4. **Custom fields**: every user-defined key comes from the database lead row, unchanged; only the reserved
   `additional_policies` array comes from the payload (it is the agent's conversion input and the wrapper records one
   sale per element by ordinal). A stale browser bag can no longer overwrite lead fields.
5. **Notes are never silently overwritten** (rule in §4.4).
6. **Client profile** shows the new person fields in the existing details grid (read + edit) and a small read-only
   "Original lead" panel in the existing left column. No layout change.

## 3. Database changes — one new forward-only migration

**File:** `supabase/migrations/20261021200000_lead_client_conversion_preservation.sql` (version re-checked against
hosted history before release; renamed byte-identically if it no longer sorts last). Applied migrations are not
edited.

### 3.1 Guards (refuse before any change)

- `SET LOCAL lock_timeout = '1s'; SET LOCAL statement_timeout = '60s';`
- Preimage md5 of `pg_get_functiondef` must equal the reviewed digests for:
  `public.convert_lead_to_client_atomic(uuid,jsonb)` `641ba66c…`, `public.update_client_with_policy_sale(uuid,jsonb)`
  `96e8f6e7…`, `public.convert_lead_to_client_with_sales(uuid,uuid,jsonb,uuid)` `3d974a5c…` (unchanged; its
  ordinal contract is relied on) and `private.insert_policy_sale(uuid,jsonb,text,uuid)` `3f600b75…` (unchanged;
  reads the stored `additional_policies` by ordinal).
- Both functions to be replaced: owner `postgres`, `SECURITY DEFINER`, `search_path = pg_catalog, pg_temp`,
  `anon` cannot EXECUTE, `authenticated` can.
- `public.normalize_us_state(text)` exists.
- Replay: a second apply finds the post-image digests and refuses (preimage guard). Any of the five new columns that
  already exists must have the exact type, be nullable and have no default (supports re-apply after the function-only
  rollback in §8, which keeps the trigger).

### 3.2 Columns (all nullable, no default, no backfill)

```sql
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS date_of_birth     text,   -- verbatim from leads.date_of_birth (text there too)
  ADD COLUMN IF NOT EXISTS age               integer,
  ADD COLUMN IF NOT EXISTS best_time_to_call text,
  ADD COLUMN IF NOT EXISTS spouse_info       jsonb,  -- verbatim from leads.spouse_info
  ADD COLUMN IF NOT EXISTS lead_conversion   jsonb;  -- protected history (§3.4)
```

Plus `COMMENT ON COLUMN` for each. Nullable/no-default `ADD COLUMN` is metadata-only (brief lock, no rewrite);
existing rows read NULL and are byte-for-byte unchanged in every existing column. No CHECK on `age` (a CHECK would
refuse conversions of leads with legacy out-of-range values; edits are validated in the browser). No RLS policy,
grant or index change: the columns inherit the table's existing row policies and table-level grants.

Column names are deliberately not `status` / `lead_source`: `private.capture_contact_history_event` treats those as
value-visible keys and would render them as client status/source changes. `date_of_birth`, `age`,
`best_time_to_call` and `state` are already in its tracked key list, so later client edits of those fields appear
as changed-field history (names only, values hidden) with no history change.

### 3.3 `lead_conversion` shape (built only by the conversion function)

```json
{
  "version": 1,
  "lead_id": "<uuid>",            "converted_at": "<now()>",          "converted_by": "<auth.uid()>",
  "lead_status": "<text|null>",   "lead_source": "<text|null>",       "lead_score": <int|null>,
  "lead_created_at": "<ts>",      "lead_last_contacted_at": "<text|null>",
  "lead_owner_id": "<uuid|null>", "lead_assigned_agent_id": "<uuid|null>", "lead_imported_by_user_id": "<uuid|null>",
  "lead_notes": "<text>",                     // present ONLY when the lead's notes were displaced (§4.4)
  "preserved_custom_fields": { … }            // present ONLY when §4.3 had to set a lead value aside
}
```

Blank text (`btrim = ''`) becomes JSON null; nothing is invented. No names, phones or emails are copied into it.

### 3.4 Protection trigger

`private.guard_client_lead_conversion()` (SECURITY INVOKER, `search_path = pg_catalog, pg_temp`, owner `postgres`,
EXECUTE revoked from PUBLIC/anon/authenticated/service_role) on
`BEFORE INSERT OR UPDATE OF lead_conversion ON public.clients`:

- **INSERT** with a non-NULL `lead_conversion` is allowed only when `current_user = 'postgres'` (inside the
  SECURITY DEFINER converter), `NEW.lead_id IS NOT NULL` and `NEW.lead_conversion->>'lead_id' = NEW.lead_id::text`;
  otherwise `42501 'Conversion history is recorded only by lead conversion'`. PostgREST inserts run as
  `authenticated`, the import Edge Function as `service_role`, so neither can forge history.
- **UPDATE** that changes it (`IS DISTINCT FROM OLD`) → `23514 'Conversion history is read-only'`, for every role.
  A future reviewed repair would have to disable the trigger explicitly.
- Trigger functions are checked for EXECUTE only at `CREATE TRIGGER` (#37), so revoking EXECUTE is safe.

### 3.5 `convert_lead_to_client_atomic` — restated verbatim with exactly these changes

Everything else is byte-for-byte the current body: `auth.uid()`/`get_org_id()` checks, both idempotent early
returns on `clients.lead_id`, `SELECT … FOR UPDATE` of the lead, cross-org refusal, the profile/role authorization
predicate, payment-frequency validation, the policy columns from the payload, the contact-graph moves (notes,
activities, appointments, tasks, calls, messages ×2, contact emails, workflow executions), the campaign-row count,
the lead delete and the return shape. `CREATE OR REPLACE` keeps the owner and ACL; the post-guard re-asserts them.

1. INSERT gains `state, date_of_birth, age, best_time_to_call, spouse_info, lead_conversion`, all from `v_lead`:
   - `state` = `NULLIF(btrim(public.normalize_us_state(v_lead.state)), '')` — canonical USPS code, the same rule as
     every client save (`clientUpdatePatch` → `normalizeUsState`); unrecognized values pass through unchanged; blank → NULL (D3).
   - `date_of_birth`, `best_time_to_call` = `NULLIF(btrim(…), '')` (text kept verbatim otherwise).
   - `age` = `v_lead.age`; `spouse_info` = `v_lead.spouse_info` unless it is JSON `null`.
2. `custom_fields` (§4.3) built from `v_lead.custom_fields` plus the payload's `additional_policies` only.
3. `notes` and `lead_conversion.lead_notes` per §4.4.
4. `lead_conversion` per §3.3.

The function still trusts nothing else from the payload for lead data. Direct callers (only the wrapper in current
code; the legacy `conversionSupabaseApi.convertLeadToClient` is test-only and also goes through the wrapper) keep
the same signature and result.

### 3.6 `update_client_with_policy_sale` — restated verbatim with exactly these additions

- Allowlist gains `'date_of_birth','age','best_time_to_call','spouse_info'`.
- The UPDATE `SET` list gains the same four columns from `merged`.

Authorization, owner validation, the first-primary-policy sale event, the error messages and the return shape are
unchanged, so the D7 companion `update_client_with_policy_sale_handoff` (unchanged) keeps its PT409 mapping and
payload hash. `lead_conversion` and `state`-like protected/other columns are not added: the writer can never touch
history. `create_client_with_sale` (manual Add Client) is not changed.

### 3.7 Post-guard

Owners, SECURITY DEFINER, `search_path` and ACLs of both functions equal the preimage metadata; `anon` cannot
EXECUTE; the guard function is not executable by client roles; the trigger exists and is enabled.

## 4. Conversion data contract (future conversions)

### 4.1 Preserved, with source and destination

| Lead data | Source (locked DB row) | Client destination | Editable on client |
|---|---|---|---|
| First / last name, phone, email | `leads.*` (unchanged behavior) | same columns | yes (unchanged) |
| State | `leads.state` (normalized; blank → NULL) | `clients.state` | yes (unchanged control) |
| Date of birth | `leads.date_of_birth` (text, verbatim) | `clients.date_of_birth` | yes |
| Age | `leads.age` | `clients.age` | yes |
| Best time to call | `leads.best_time_to_call` | `clients.best_time_to_call` | yes |
| Spouse info | `leads.spouse_info` (jsonb, verbatim) | `clients.spouse_info` | yes when text; read-only when structured (D4) |
| Lead notes | `leads.notes` | `clients.notes`, or `lead_conversion.lead_notes` when displaced | `notes` yes; history no |
| User-defined custom fields | `leads.custom_fields` (every key, unchanged) | `clients.custom_fields` | yes (unchanged editors) |
| Assigned agent | `leads.assigned_agent_id` (unchanged) | `clients.assigned_agent_id` | yes (unchanged) |
| Original lead source | `leads.lead_source` | `lead_conversion.lead_source` | no (history) |
| Original lead status | `leads.status` | `lead_conversion.lead_status` | no (history) |
| Lead score | `leads.lead_score` | `lead_conversion.lead_score` | no; not displayed (D5) |
| Lead created / last contacted, owner, importer | `leads.created_at`, `last_contacted_at`, `user_id`, `assigned_agent_id`, `imported_by_user_id` | `lead_conversion.*` | no |
| Lineage | `p_lead_id` | `clients.lead_id` (unchanged) + `lead_conversion.lead_id` | no |
| Contact graph (calls, SMS, emails, appointments, tasks, activities, notes, workflows) | unchanged moves | unchanged | — |

Not preserved by design: `leads.updated_at` (the moment of conversion), `organization_id` (equal by construction).

### 4.2 Nullable stays nullable

Every new column and every history key is NULL/JSON null when the lead had no value. No default, no derived age,
no guessed state, no `created_at` substitute.

### 4.3 Custom fields

```
lead_bag   := v_lead.custom_fields when it is a JSON object, else NULL
policies   := p_client->'custom_fields'->'additional_policies' when that key is present (the wrapper already
              refuses a non-array)
custom_fields := NULL when lead_bag IS NULL and policies IS NULL;
                 otherwise (lead_bag minus 'additional_policies') || {additional_policies: policies when present}
```

- Every other payload custom-field key is ignored, so a stale browser snapshot cannot overwrite a lead field.
- The stored `additional_policies` array is exactly the payload's array, in order, so the wrapper's per-ordinal
  sales and `private.insert_policy_sale`'s ordinal lookup keep matching (policy ids assigned by the existing
  `clients_policy_identity` trigger).
- **Nothing is lost (D6):** if the lead's own bag holds the reserved key, or is not an object at all, that value is
  set aside verbatim in `lead_conversion.preserved_custom_fields` (`{"additional_policies": …}` or `{"_value": …}`)
  instead of entering the client's policy namespace, where it would create phantom policy identities or fail the
  sale. Production had 0 such definitions at the 2026-09-19 audit; the rule exists so the edge cannot drop data.
- An empty lead bag `{}` with no policies stays `{}` (preserved, not converted to NULL).

### 4.4 Notes — never silently overwritten

```
conv := NULLIF(btrim(p_client->>'notes'), '')
if conv IS NULL or conv = btrim(v_lead.notes):  clients.notes := v_lead.notes      -- database notes win
else:                                            clients.notes := p_client->>'notes'
                                                 if NULLIF(btrim(v_lead.notes),'') IS NOT NULL:
                                                     lead_conversion.lead_notes := v_lead.notes (verbatim)
```

- No conversion note → the client's Notes are the database lead notes (not the browser copy).
- A conversion note → it is the client's Notes (today's behavior) **and** the lead's notes are kept verbatim,
  read-only, in "Original lead notes". Neither is lost; nothing is concatenated or rewritten.
- Pre-release browser tabs that still send `lead.notes` as a fallback are handled: an identical copy is ignored; a
  stale copy becomes the client's Notes and the database notes are still kept.
- Timeline notes (`contact_notes`) keep moving to the client as today.

### 4.5 Unchanged guarantees (re-proved by tests, §6)

Organization and ownership authorization, SECURITY DEFINER boundaries, the lead row lock and whole-transaction
rollback, idempotent conversion (`clients.lead_id` early return, wrapper receipt + payload hash, PT409 conflicts),
`clients.lead_id` lineage, contact-history transfer, campaign membership (`campaign_leads` preserved; `p_campaign_id`
validation), telemetry (calls/call_logs untouched), one sale event per policy with stable policy ids and premium
snapshots, and the Phase 2A commission capture.

## 5. Frontend changes

All edits are surgical; no redesign. The three-column layout, policy cards (`ClientPolicies`), beneficiaries,
conversation, activity, notes/tasks tabs and follow-ups are untouched.

1. **`src/lib/types.ts`** — `Client` gains optional `dateOfBirth`, `age`, `bestTimeToCall`, `spouseInfo` (JSON
   value) and `leadConversion` (parsed history or undefined).
2. **`src/lib/supabase-clients.ts`**
   - `rowToClient`: map the five columns; NULL → `undefined`, so historical rows render exactly as today.
   - `clientUpdatePatch`: send `date_of_birth` (trimmed verbatim; blank → NULL; never re-formatted, so a legacy
     non-ISO value survives unrelated edits), `age` (integer or NULL), `best_time_to_call` (blank → NULL) and
     `spouse_info` (only when it is text or NULL; a structured value is never sent back). Only defined fields are
     sent, so a historical client without these fields sends nothing new. `lead_conversion` is never sent.
   - `clientToRow` / create paths unchanged.
3. **NEW `src/lib/clientLeadDetails.ts`** (pure, Zod)
   - `parseLeadConversion(json)`: tolerant Zod parse of §3.3; malformed or unknown versions → `undefined` (panel
     hidden), never a crash.
   - `clientPersonFieldsSchema` + `validateChangedClientPersonFields(original, edited)`: validates only fields the
     agent changed (age integer 0–130 or blank; DOB a real `YYYY-MM-DD` not in the future or blank; best time one of
     the existing options or blank; spouse text ≤ 500 chars), so a legacy value never blocks an unrelated save.
   - `isEditableSpouseInfo(value)`: text or empty only.
4. **`src/lib/supabase-conversion.ts`** — one line: `notes` sends only the agent's conversion notes (blank → NULL),
   never the in-memory `lead.notes` fallback. `mergeCustomFieldsOnConversion` and the `additional_policies` literal
   stay exactly as they are (invariant #35); a comment records that the server now takes every other custom-field
   key from the locked lead row.
5. **`src/lib/contactFieldLayout.ts`** — default client order adds `dateOfBirth, age, spouseInfo, bestTimeToCall`
   after `email` (mirrors the lead order). Saved user/agency layouts are not rewritten; `buildContactDetailFields`
   already appends standard fields missing from a saved layout. `leadScore` stays hidden. No change to the Dialer
   registry or required-field options (D8).
6. **`src/components/contacts/FullScreenContactView.tsx`** (existing 1,466-line file; minimal diff)
   - The `age`, `dateOfBirth`, `bestTimeToCall`, `spouseInfo` cases render for clients as well as leads (same
     controls; read mode hides empty values as today). `leadSource` stays lead-only.
   - Clients: a structured spouse value renders read-only; a non-ISO DOB edits as plain text so the native date
     input never blanks a legacy value.
   - `handleSave` (clients): runs `validateChangedClientPersonFields` before `onUpdate`; a refusal keeps edit mode,
     the typed values and dirty state, and shows the reason (#36). The existing age-from-DOB recalculation is reused.
   - Renders `<ClientLeadHistory>` in the existing left column below the details grid, client type only.
   - The reserved `additional_policies` exclusions and `ClientPolicies` are untouched.
7. **NEW `src/components/contacts/ClientLeadHistory.tsx`** (< 200 lines, Tailwind only) — read-only "Original lead"
   card: Lead source, Status at conversion, Lead created, Converted on, Converted by (name from the agent list the
   view already loads; "Unknown user" otherwise), Original lead notes (when preserved) and a one-line notice when
   lead custom data was set aside. Renders nothing when `leadConversion` is absent (historical and manual clients).
8. **`src/integrations/supabase/types.ts`** — add the five columns to `clients` Row/Insert/Update only.

No change to `ConvertLeadModal`, `DialerPage`, `FloatingDialer`, `Contacts.tsx`, `ContactDeepLinkPage`, Twilio,
dispositions, queue, SMS, A2P or commission code.

## 6. Test strategy

### 6.1 SQL (disposable localhost PostgreSQL; synthetic data only; locality proven by the runner)

NEW `scripts/run_lead_conversion_preservation_tests.sh` reuses `scripts/policy_commission_fixture.py` (verbatim
production writers, sale identity, commission harness) plus the applied commission migrations — the production end
state — adds the baseline `public.normalize_us_state`, then applies the new migration. NEW suite
`supabase/tests/lead_conversion_preservation.sql`:

| ID | Proves |
|---|---|
| P1 | Preimage guard refuses a changed converter/writer byte; replay refused; owner/ACL post-guard holds. |
| P2 | All standard fields transfer exactly (state normalized, DOB text verbatim, age, best time, spouse object and string verbatim, names, phone, email, assigned agent). |
| P3 | Arbitrary custom fields (strings, numbers, booleans, nested objects, odd key spacing) equal the DB lead row even when the payload carries a stale or conflicting bag; payload `additional_policies` stored verbatim; lead's own reserved key / non-object bag set aside in history. |
| P4 | Notes matrix: none; conversion only; lead only; both differ; both equal; whitespace-only; stale browser copy. Never lost. |
| P5 | History content; protection: `authenticated` direct UPDATE and INSERT refused, `service_role` refused, the update writer cannot change it, postgres UPDATE refused. |
| P6 | Blank/NULL lead values stay NULL / JSON null. |
| P7 | Calls, SMS, emails, appointments, tasks, activities, notes, workflow executions move; durations, dispositions, campaign ids and `call_logs` lineage unchanged. |
| P8 | Primary + two additional policies: three wins, correct `policy_id` ↔ ordinal, premium snapshots, commission captures bound per slot (through the handoff). |
| P9 | Failure inside the transaction (invalid frequency, invalid premium, failed win) rolls back everything: lead intact, no client, graph unmoved. |
| P10 | Same request replay idempotent; changed payload → PT409; two concurrent sessions convert exactly once (runner-level parallel backends). |
| P11 | Cross-org, unauthorized agent, Team Leader, Admin, Super Admin home org: outcomes identical to the preimage. |
| P12 | Personal, Team and Open Pool campaign ids and no campaign (Floating Dialer): `wins.campaign_id`, campaign membership preserved. |
| P13 | Historical clients: full-row fingerprint of every pre-existing client and win identical before/after migration; new columns NULL. |
| P14 | Update writer accepts the four person fields, still refuses every other unknown key and `lead_conversion`; first-policy edit still records one sale. |
| P15 | Differential: the same conversion on a pre-migration and a post-migration database yields identical clients policy columns, wins (minus ids/timestamps), policy identities and commission captures — only the new columns and the notes rule differ. AP inputs (premium, additional premiums, sold dates) identical. |
| P16 | Rollback restores the exact preimage digests; refuses a drifted post-image; keeps columns and data; forward re-apply after rollback succeeds. |

Inventory diff (functions, relations, policies, ACLs, triggers) before/after: only the two replaced bodies, five
columns, one trigger and its function differ. The existing commission handoff, tracking and security suites are
re-run on the post-migration state to re-verify PT409 mapping and hashes. Existing runners
(`run_policy_sale_recording_tests.sh`, `run_policy_commission_tests.sh`) are unchanged and still prove the
historical chain. NEW CI workflow `.github/workflows/lead-conversion-preservation.yml` (postgres:17.6 service, path
filters on the new files and the conversion/writer migrations). Local runs use the container's PostgreSQL 16.

### 6.2 Frontend (Vitest + Testing Library)

- `clientMapping`: new columns map; NULL → undefined; history parsed or hidden; patch sends the four fields
  verbatim, never history, never a structured spouse.
- NEW `clientLeadDetails`: Zod parse (valid, malformed, future version), changed-only validation, legacy values.
- NEW `clientLeadHistory`: panel renders every populated item, hides when absent or malformed, never shows lead score.
- NEW `fullScreenContactViewClientLeadFields`: client read mode shows populated fields and hides empty ones; edit
  mode offers DOB/age/best time/spouse; structured spouse read-only; legacy DOB kept on unrelated edits; refused
  validation keeps edit mode; historical client (no new fields) renders unchanged; `additional_policies` still
  excluded; `ClientPolicies`, conversation, activity and follow-ups still render.
- `conversionContract` + NEW `conversionEntryPoints`: for the lead shapes each entry point produces (Contacts
  `rowToLeadWithAggregates`, profile `contact`, Personal `mapDialerLeadToContactLead(campaign row)`, Team/Open
  `withTeamOpenMasterLead`, Floating `rowToLead`), the prepared handoff carries the same lead id and conversion
  inputs, notes are the conversion notes only, and `additional_policies` is unchanged.
- Expected pinned-test updates (expectations only): default client order in `contactFieldLayout.test.ts`, and any
  suite that enumerates client fields (`contactDetailFields`, `FieldVisibility`, `AdditionalPolicies` T-5).

### 6.3 Gates

`npx tsc --noEmit` (vacuous here) **and** `npx tsc -p tsconfig.app.json --noEmit` compared with `main`'s baseline
(84); full Vitest; scoped ESLint; `npm run build`; `git diff --check`; secret/`service_role`/`.single()` scan.

### 6.4 What cannot be proved in this build (stated honestly)

Signed-in browser conversions through the five entry points against a real backend would write production data
(#28) and are not run. Coverage is the SQL suite per campaign type plus component/contract tests per entry point.
An optional signed-in check on an approved Supabase preview branch can be requested separately.

## 7. Rollout order (database first)

1. **Gate 1 (this approval):** local build, tests, commits and a draft PR on `claude/sweet-fermi-jpsnyn`.
2. **Gate 2 (separate approval, database only):** read-only `list_migrations` + preflight (hosted head, the four
   preimage digests, owners/ACLs, columns absent, trigger absent, advisors baseline) → apply the exact migration
   bytes once through the established version-preserving route (SQL Editor as `postgres`; `apply_migration` stamps
   its own version) → read-back (stored text, post-image digests, columns, trigger, ACLs, advisors unchanged). The
   new database is compatible with the released frontend: it ignores the old payload's custom fields, handles its
   notes fallback, and the old client editor sends none of the new keys.
3. **Gate 3 (separate approval, frontend):** merge after green final-head CI and preview checks with Supabase
   "Deploy to production" confirmed OFF; verify both Vercel production deployments. Agents refresh after their call.

The new frontend must never run against the old database: the old update writer refuses the new keys (22023).

## 8. Rollback

1. **Frontend first:** revert the merge or promote the previous Vercel deployment.
2. **Database (separate approval):** `supabase/migrations/rollback/20261021200000_…rollback.sql` refuses unless the
   current bodies equal the reviewed post-image digests, then restores the exact preimage bodies of both functions
   (digests re-verified). It keeps the five columns, their data and the protection trigger (non-destructive; the old
   functions never write `lead_conversion`, so the trigger only keeps history immutable). Forward re-apply after it
   is supported.
3. Dropping the columns is not part of rollback: it would destroy preserved data of clients converted after release
   and needs its own approval with a proven export (#28, #29).

## 9. Implementation sequence after approval

1. Read-only `list_migrations` and a read-only `md5(pg_get_functiondef(...))` + ACL check of the four functions
   (the only production contact; no writes). Stop and report if anything differs from §0.
2. Migration + rollback + SQL suite + runner + CI; run locally until green.
3. Frontend changes and tests; gates in §6.3.
4. `WORK_LOG.md` (newest first), `AGENT_RULES.md` invariant (conversion data contract, protected history, writer
   allowlist), this plan's `verification.md`, release preflight/read-back scripts.
5. Push and open one draft PR; no merge, no apply, no deploy.

## 10. Files

**New**
- `supabase/migrations/20261021200000_lead_client_conversion_preservation.sql`
- `supabase/migrations/rollback/20261021200000_lead_client_conversion_preservation.rollback.sql`
- `supabase/tests/lead_conversion_preservation.sql`
- `scripts/run_lead_conversion_preservation_tests.sh`
- `.github/workflows/lead-conversion-preservation.yml`
- `src/lib/clientLeadDetails.ts`
- `src/components/contacts/ClientLeadHistory.tsx`
- `src/lib/__tests__/clientLeadDetails.test.ts`
- `src/lib/__tests__/conversionEntryPoints.test.ts`
- `src/components/contacts/__tests__/clientLeadHistory.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewClientLeadFields.test.tsx`
- `docs/plans/2026-10-21-lead-client-preservation/verification.md`
- `docs/plans/2026-10-21-lead-client-preservation/release/preflight.sql`, `release/readback.sql` (read-only; not run)

**Modified**
- `src/lib/types.ts`, `src/lib/supabase-clients.ts`, `src/lib/supabase-conversion.ts`,
  `src/lib/contactFieldLayout.ts`, `src/components/contacts/FullScreenContactView.tsx`,
  `src/integrations/supabase/types.ts`
- Tests (expectations only where they pin the old contract): `src/lib/__tests__/clientMapping.test.ts`,
  `contactFieldLayout.test.ts`, `conversionContract.test.ts`, and if they enumerate client fields
  `contactDetailFields.test.ts`, `src/components/contacts/__tests__/fullScreenContactViewFieldVisibility.test.tsx`,
  `fullScreenContactViewAdditionalPolicies.test.tsx`
- `WORK_LOG.md`, `AGENT_RULES.md`, root `implementation_plan.md`, this plan

**Not touched:** every applied migration, `convert_lead_to_client_with_sales`, all `*_handoff` companions,
`create_client_with_sale`, `record_client_policy`, `ConvertLeadModal`, `DialerPage`, `FloatingDialer`, `Contacts`,
`TwilioContext`, Edge Functions, RLS policies and grants.

## 11. Decisions for Chris (recommendation first)

- **D1 Storage.** Four editable person columns + one protected `lead_conversion` JSON history *(recommended)*;
  alternative: a typed column per historical item (more columns, same protection).
- **D2 Notes.** Conversion notes stay the client's Notes; displaced lead notes kept verbatim as read-only "Original
  lead notes" *(recommended)*; alternative: lead notes stay Notes and the conversion note goes to history.
- **D3 State.** Normalize to the USPS code at conversion, matching every client save *(recommended)*; alternative:
  copy verbatim.
- **D4 Spouse info.** Editable when stored as text (as on leads); structured values read-only *(recommended)*.
- **D5 Lead score.** Kept in protected history, never displayed or editable *(recommended)*; alternative: show
  read-only in the panel.
- **D6 Unplaceable lead custom data** (reserved key / non-object bag): kept in protected history *(recommended)*;
  alternative: refuse the conversion.
- **D7 Edit path.** Extend `update_client_with_policy_sale` by exactly the four person fields — required for edit
  mode because every client save goes through it *(recommended)*; alternative: read-only display only.
- **D8 Required fields.** New fields not offered as requirable for clients, so historical clients never become
  unsaveable *(recommended)*.
- **D9 Payload.** Keep the custom-field merge unchanged (server ignores all but `additional_policies`); notes send
  conversion notes only *(recommended)*.

## 12. Risks and observations

- **Release coupling** (new frontend + old database rejects client edits) — mitigated by database-first release and
  frontend-first rollback.
- **Live drift** — the guard refuses if production bodies differ from the reviewed digests.
- **Sale writer change** — only the update writer's allowlist/SET list grows; the commission companions and their
  PT409 mappings are re-tested, as Phase 2A requires.
- **History volume** — client edits to DOB/age/best time now create changed-field history events (names only).
- **Supabase automatic preview branching** stays enabled; a PR with a migration may build a preview branch (existing
  accepted behavior). Deploy to production must be confirmed OFF before merge.
- Observed, **not fixed** (out of scope; conversion is now immune to them): the Contacts kanban drop of a card not
  on the current table page does nothing; the Dialer drawer's camelCase merge leaves `row.custom_fields` stale;
  `ContactDeepLinkPage` has no Convert button; `rowToClient` maps a nonexistent `clients.user_id`.
- Team Leader hierarchy debt (AGENT_RULES known tech debt) unchanged.

## 13. Approval requested

**Gate 1:** approve this plan, decisions D1–D9 as recommended (or amended), the file list in §10, the single
read-only production check in §9.1, local implementation and tests, commits and pushes to
`claude/sweet-fermi-jpsnyn`, and one draft PR. Not requested now: production migration (Gate 2), merge or frontend
release (Gate 3).

## 14. Bugfix within Gate 1 — final data-integrity corrections (requested by Chris 2026-10-21)

PR #476's seven workflows and both Vercel previews were green. Two corrections before requesting Gate 2, kept inside
the Gate 1 approval (local build and disposable-database tests, the approved files, PR #476 only). No production
contact, migration apply, merge or deployment. Review: AGENT_RULES, VISION and WORK_LOG re-checked; `main` is still
`51b0e56` with no new entries or conflicting work.

### 14.1 Mixed-version conversion notes (replaces the §4.4 legacy behavior)

The old browser sends `notes: conversion note || its copy of lead.notes || null`, so a non-blank value that differs
from the database lead notes is either the agent's note or a stale copy — it cannot be classified. Rule:

- **New browser (explicit):** it sends only the agent's note in `notes` (or null) together with the indicator
  `notes_source: "conversion_note"`. A non-blank note that differs from the database lead notes becomes the client's
  Notes; the displaced lead notes are kept verbatim in `lead_conversion.lead_notes` (unchanged §4.4 rule).
- **Old browser (legacy, no indicator):** blank, or equal (after trimming) to the database lead notes → the database
  notes. Anything else is unclassifiable: the client's canonical Notes stay the **current database lead notes**, and
  the submitted text is kept verbatim, read-only, as `lead_conversion.legacy_conversion_notes`, shown as "Conversion
  notes (older app version)". Neither the current lead notes nor an agent-entered note is discarded, and a stale copy
  can never become the Notes.
- **Unknown indicator** (any `notes_source` other than `conversion_note`, including null; never sent by any browser):
  refused, 22023 "Conversion notes were sent in an unrecognized format. Refresh AgentFlow and try again." — fail closed;
  the whole conversion rolls back.
- **Why an indicator beside `notes`, not a new key:** a database without this migration ignores the indicator and
  reads `notes` exactly as today, so even a mistaken frontend-first release can never drop a typed conversion note.
  (A first draft used a separate `conversion_note` key; the old function would have ignored it and lost the note.)
- Preserve-separately is chosen over failing closed for every legacy note because a refusal would block a sale in the
  Dialer wrap-up for the whole transition window.

### 14.2 Unchanged preserved client fields are never rewritten

- `clientUpdatePatch` sends the four person fields **verbatim**: non-blank text exactly as given (no trimming or
  reformatting), blank → NULL, age as given (integer text → integer). A structured spouse value is still never sent.
- `FullScreenContactView.handleSave` (clients) omits every person field the agent did not change before calling
  `onUpdate`, so an unrelated edit sends none of them (`omitUnchangedPersonFields`). Changed means different from the
  saved contact, with blank / null / undefined treated as the same "empty". The edit surfaces are `Contacts` and
  `ContactDeepLinkPage` (both through this view → `clientsSupabaseApi.update`); `AddClientModal` never sends these
  fields; Calendar and the Dialer mount the view for leads only.
- The changed-field set is shared with the Zod validation, so validation and sending agree.

### 14.3 Exact files

Modified only (all already in §10): the migration (converter notes logic; the update writer, guard, columns and every
other line unchanged) and its rollback (post-image guard); `supabase/tests/lead_conversion_preservation.sql`,
`lead_conversion_differential.sql` (client notes now an intended difference for legacy distinct notes, asserted by
P4), `scripts/run_lead_conversion_preservation_tests.sh` (post-image digest, boundary/race payloads);
`release/readback.sql`; `src/lib/supabase-conversion.ts`, `supabase-clients.ts`, `clientLeadDetails.ts`, `types.ts`;
`src/components/contacts/FullScreenContactView.tsx`, `ClientLeadHistory.tsx`; tests `conversionContract`,
`conversionEntryPoints`, `clientMapping`, `clientLeadDetails`, `clientLeadHistory`,
`fullScreenContactViewClientLeadFields`; `verification.md`, this plan, root `implementation_plan.md`, `WORK_LOG.md`,
`AGENT_RULES.md`. Because the migration bytes change, every checksum, post-image digest, rollback guard and release
script value is regenerated and re-verified.
