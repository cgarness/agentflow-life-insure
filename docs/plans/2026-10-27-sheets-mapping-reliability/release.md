# Google Sheets mapping reliability — production outcome & historical runbook

## Production readback — October 28, 2026

**Release status:** Production feature deployed and operational; **3 of 4 saved sources opted into mapping v2**. The fourth source remains supported v1 by owner choice; it was not forcibly converted.

| Stage | Verified result |
| --- | --- |
| R2 | PR #498 merged into `main` as `f870755586a94f16caf1af631391de0237d82f31`. |
| R3 / M1 | `20261028034425_google_sheets_context_field_types` applied; `private.google_sheets_context` advertises typed catalog v2. |
| R4 / M2 | `20261028040215_standard_lead_fields` applied; provisioning and audited conversion RPCs installed. |
| R5 | `google-sheets-api` v12, `google-sheets-push` v6 and `google-sheets-sync-worker` v11 ACTIVE, `verify_jwt=false` retained. |
| R6 | Production Vercel v2 build `dpl_ApDSmKFJtJTnfNy4mwdzqLsQk58X` READY after enabling `VITE_GOOGLE_SHEETS_MAPPING_V2=true`. |
| R7 | Chris's Address, City and Zip Code converted agency-wide, IDs and lead values preserved; 3 audited scope changes with `CHRIS-APPROVAL-2026-10-28-R7`; standard fields status `complete`. |
| R8 | Chris Pilot B, Alexa FEX Real Time, Teo Goat Leads saved as v2. Alexa FEX Aged intentionally remains v1; 4/4 sources connected/healthy with no current needs-review status. |

**End-to-end:** Chris's "big test" imported through Pilot B v2 automatically, with one lead, one receipt, and the source row marked done. Other saved mappings remain owned by the original sheet owners.

**Migration reconciliation:** The two forward SQL files are renamed (never rewritten) into the active migrations directory:
- `supabase/migrations/20261028034425_google_sheets_context_field_types.sql` — MD5 `e93a8f1e3904fa5c6da6cf3843fe2ad4`.
- `supabase/migrations/20261028040215_standard_lead_fields.sql` — MD5 `d8a405763974cdccd616b800e4314883`.
They were verified byte-identical to production `supabase_migrations.schema_migrations.statements[1]` before reconciliation. The old "NOT APPLIED" comments inside those *applied* forward files remain unchanged to preserve historical bytes. Only repository filenames and related references were reconciled; **no migration was re-applied**.

**Deferred owner / audit items (not silent blockers to v2 availability):**
- Alexa FEX Aged is valid v1; upgrade only when its owner chooses.
- Teo Goat Leads: `Beneficiary Name` is mapped to built-in `Full Name`; Address, City and Zip are ignored along with 14 other headers. Teo will review and correct later. Existing imported data is not automatically backfilled.
- Alexa FEX Real Time intentionally ignores Trusted Form URL, OTP Code and IP Address; assess compliance-evidence retention separately where applicable.
- Nine older Pilot B imported receipts point to lead IDs not currently present. Their provenance is unproven; leave receipts/ledger unchanged pending separate read-only investigation.
- UI dropdown alphabetical/short-copy polish lives in a *separate pending-review frontend branch/PR*; not yet shipped to production.

## Historical pre-release runbook (retained for audit; **do not rerun**)

The instructions below were written **before** this release. All R2–R7 were separately approved and executed; R8 was completed by owner opt-in for three sources. Historical dates, staged code versions, and early paths are preparation evidence, not current production instructions. No later release gate is automatically authorized.



Source of truth for the design: `implementation_plan.md` (base plan + Amendment A). Local and CI evidence:
`verification.md` in this folder.

## Fixed facts (re-read live before each step; stop on any difference)

| Item | Value recorded 2026-10-27 (read-only) |
|---|---|
| Hosted migration head | `20261025120100` |
| `private.google_sheets_context` md5(prosrc) | `2aa8978ceafb8f5079317474f98d4dad` (M1 refuses any other body) |
| Sheets function inventory | 44 private + 31 public = 75 (M1 keeps 75; M2 adds no `google_sheets_*` function) |
| Edge versions | `google-sheets-api` v11, `google-sheets-push` v5 (both = `f980c16`), `google-sheets-sync-worker` v10 (unscheduled; #442-era engine) |
| `verify_jwt` | `false` on all six Sheets functions — every deploy uses `--no-verify-jwt` |
| Sources | 3, all mapping `v: 1`; push mode `on` |
| Chris's agency custom fields | 45 active Lead fields, all personal. `Address` = `ecf2bb91…` (Admin/SA); `City`, `Zip Code` = `7c692e64…` (Agent) |
| Vercel env | `VITE_GOOGLE_SHEETS_MAPPING_V2` absent (must stay absent until R6) |

## The gate

- **G1** (operator intent): build-time `VITE_GOOGLE_SHEETS_MAPPING_V2 === "true"`.
- **G2** (compatibility): the `context` action returns `mapping_versions` containing 2. Only the new Edge code
  returns it, and only when M1 reports `catalog_version: 2`.
- v2 editor only when G1 ∧ G2. Otherwise the legacy editor runs unchanged (`AddSheetDialog`, `SheetMappingStep`,
  `SheetPreviewStep` are not modified). Contact Management / CSV standard-field behaviour needs G1 and the M2 RPCs;
  a missing RPC hides the panel.
- The new Edge refuses v2 **writes** (preview/save/activate/review) unless `catalog_version ≥ 2`
  (`422 mapping_version_unavailable`). Stored v2 mappings are always processed.

## R1 — Review

- PR review; every CI job green on the exact head (`Google Sheets` workflow: SQL/PostgREST/e2e, Deno, frontend,
  browser legacy + v2).

## R2 — Merge to `main` with G1 unset

1. Read-only: confirm `VITE_GOOGLE_SHEETS_MAPPING_V2` is absent in every Vercel environment.
2. Merge. Vercel builds with G1 off → the legacy interface everywhere.
3. Smoke test signed in: Settings → Google Sheets lists 3 sources; Edit on a source opens the legacy editor;
   Contact Management shows no standard-field panel and no "agency-wide" action; CSV import creates fields as before.

Rollback: Vercel rollback (no backend change exists yet).

## R3 — Apply M1 (typed catalog)

1. Move `supabase/migrations/pending/20261028120000_google_sheets_context_field_types.sql` to
   `supabase/migrations/` and re-stamp it to the version the apply records (it must sort after the hosted head).
2. Apply exactly those bytes. The pre-check refuses unless the live body md5 is `2aa8978c…`.
3. Verify:
   - `md5(prosrc)` of `private.google_sheets_context` equals the md5 of the repository body;
   - ACL unchanged (public wrapper: `service_role` only; private function: no PUBLIC/anon/authenticated);
   - inventory still 75;
   - through PostgREST as `service_role`, `google_sheets_context` returns `catalog_version: 2` with typed fields;
     `authenticated` and `anon` are refused;
   - the deployed Edge v11 still works (it ignores the new keys): Sync now on one v1 source, unchanged counts.

Rollback: `supabase/migrations/rollback/20261028120000_google_sheets_context_field_types.rollback.sql` (restores
the exact previous body). Edge v11 is unaffected either way.

## R4 — Apply M2 (standard lead fields)

1. Before: per organization, `count(*)` and `md5(string_agg(to_jsonb(cf)::text, '' ORDER BY id))` of
   `public.custom_fields`; `count(*)` of `public.leads`.
2. Move and re-stamp `pending/20261028120100_standard_lead_fields.sql` as in R3; apply exactly those bytes.
3. Verify:
   - functions `private.provision_standard_lead_fields`, `public.provision_standard_lead_fields`,
     `public.custom_field_make_agency_wide`, trigger `on_organization_created_seed_standard_lead_fields`, tables
     `private.standard_lead_field_provisioning` and `private.custom_field_scope_changes` exist;
   - public RPCs: EXECUTE for `authenticated` only (not `anon`, not PUBLIC); private functions not exposed;
   - **no row changed**: the R4.1 counts and checksums are identical; both new tables are empty;
   - `supabase/ops/standard_lead_fields_report.sql` runs (read-only) and shows Chris's agency as not complete.
   - No disposable organization is created in production; the new-agency trigger (success, failure recorded as
     `failed` + SQLSTATE, non-blocking) is proven locally (S1–S11, section 5b–5d of the runner).

Rollback: `rollback/20261028120100_standard_lead_fields.rollback.sql` drops the trigger and functions, keeps both
tables and any field rows (reversing an ownership change is a separate approved data step using the audit rows).

## R5 — Deploy the three Edge functions from `main`

1. Immediately before: re-read the live source of `google-sheets-api` (v11), `google-sheets-push` (v5) and
   `google-sheets-sync-worker` (v10). api/push must still equal `f980c16`; the worker's known drift is the only
   difference allowed. Stop on anything else.
2. Deploy, each with `--no-verify-jwt`: `google-sheets-api` → v12, `google-sheets-push` → v6,
   `google-sheets-sync-worker` → v11 (unscheduled; parity). `google-sheets-push-maintenance` and both OAuth
   functions do not bundle the mapping and are not redeployed.
3. Verify:
   - `verify_jwt=false` on all three;
   - `context` returns `mapping_versions: [1, 2]`;
   - every v1 source: Sync now → same imported/flagged counts; mapping JSON byte-identical; no new receipts for
     rows already imported; the identity ledger unchanged; push notifications still processed.
   - v1 saves still make no Google request; a v2 save (only possible after R6) re-reads the sheet once (correction C),
     plus one bounded read past column GR when the tab is wider than 200 columns.

Rollback: only after the approved `supabase/ops/google_sheets_mapping_v2_to_v1.sql` (no v2 mapping exists before
R8, so before R8 a plain redeploy of v11/v5/v10 is safe). The old Edge rejects a v2 mapping (`mapping_invalid` →
Needs review): no data loss and no duplicates either way.

## R6 — Turn the v2 interface on

1. Set `VITE_GOOGLE_SHEETS_MAPPING_V2=true` in Vercel (production) and redeploy.
2. Signed-in verification (Admin and Agent):
   - Add sheet → v2 editor: every column listed, Address/City/ZIP auto-mapped where fields exist, nothing mapped
     to Email by an address header, ignored columns listed, preview shows stored values, Enable needs the
     acknowledgement;
   - Edit on an existing v1 source opens the v2 editor with the sheet's current headers;
   - Save / Enable stay disabled ("Checking the sheet…") until the preview has loaded, and while anything not imported
     is unconfirmed; a tab wider than 200 columns states its real width (nothing is enabled or saved for this check
     unless the owner intends it);
   - Contact Management (Admin): the Standard lead fields panel shows the live state.

Rollback: unset the variable and redeploy → legacy interface. Stored v2 mappings keep processing on the new Edge.

## R7 — Existing agencies: conversions and provisioning (production data; exact inputs approved separately)

1. Run `supabase/ops/standard_lead_fields_report.sql` (read-only). For Chris's agency it is expected to show
   `Address` personal (`ecf2bb91…`), `City` and `Zip Code` personal (`7c692e64…`), each with its snapshot and
   `leads_with_key`.
2. Chris approves the exact list. Either:
   - in-app: Chris (Admin + Super Admin) uses Contact Management → "Make agency-wide" on each of the three fields
     (dry run → typed confirmation → snapshot-guarded apply, audited); or
   - ops: `psql "$DB" -1 -v ON_ERROR_STOP=1 -v approval_ref='CHRIS-APPROVAL-…' -v provision='[]'
     -v convert='[{"organization_id":"…","field_id":"…","snapshot":"…"}, …]' -f supabase/ops/standard_lead_fields_apply.sql`.
3. Then provisioning (idempotent; creates only names no active row holds): the Admin's "Add missing fields"
   button, or the ops file with `provision='["<org uuid>"]'`.
4. Verify: the report shows `complete`; field ids unchanged (so `a2011534`'s `City`/`Zip Code` mapping still
   resolves); `private.custom_field_scope_changes` holds one row per conversion; lead rows unchanged.

Effect to accept: after conversion only Admins can edit or delete those three fields; the Agent who created
`City` / `Zip Code` keeps using them.

## R8 — Owners move sources to v2

Each owner opens Edit on their source: current headers, preview (stored values), acknowledge ignored columns,
Save. Then one test row. Typed Number/Date normalization applies only to rows imported after the source is v2;
existing lead values are never rewritten (historical reconciliation is a separate, designed-only step).

## Post-release monitoring

- `public.google_sheets_sources`: no `needs_review` with `mapping_invalid` / `custom_field_unavailable`.
- `private.standard_lead_field_provisioning`: any `failed` row → the Admin's retry or the approved ops apply.
- `google-sheets-api` responses `503 inspection_incomplete` (a scan past GR that timed out or exceeded the byte cap)
  and `409 unacknowledged_columns`: both are safe refusals (nothing written); a sustained rate means a sheet that is
  too wide to check or is changing while owners save.
