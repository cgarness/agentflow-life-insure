# Commission grids — private reference-import runbook

**Status (2026-10-15): BACKEND MIGRATIONS, PRIVATE IMPORT AND HOME-AGENCY ACTIVATION VERIFIED; FRONTEND RELEASE PENDING.** Chris supplied the source
`ffl_comp_rates.csv` (D4). Steps 1–3 ran on 2026-10-15 against disposable loopback databases only, and every
check passed; the manifest records the hashes, counts and PASS/FAIL results. Production steps through 7b have now been executed under Chris's exact approval and verified. Both source and artifact are stored privately with matching SHA-256 values. The remaining work is the approved migration-filename reconciliation, final CI, merge and frontend verification.

This runbook is public. It contains no compensation data and must stay that way: no rates, no carrier or
product names from the source, no source notes, no carrier-specific acceptance expectations (D1).

## What is private and where it lives

| Item | Location | In Git? |
|---|---|---|
| Original `ffl_comp_rates.csv`, byte-for-byte | Durable private location named by Chris (**to be named before release**) | Never |
| Import artifact `*.comp_reference_grid.json` | Same private location | Never |
| Private acceptance expectations (`acceptance.json`) | Same private location | Never |
| Validator/importer, reconciliation SQL, ops scripts, synthetic fixture | This repository | Yes |
| Non-sensitive manifest (`reference-import-manifest.json`) | This directory | Yes |

`.gitignore` ignores `/private/commission-grids/`, `**/ffl_comp_rates*.csv` and `**/*.comp_reference_grid.json`.
The importer refuses to read a source CSV from, or write an artifact to, a repository path that Git does not
ignore. Before any commit, inspect the staged content (`git diff --cached --stat` and the full diff). An
ephemeral agent session or database history alone is not the recovery record (D1).

## 1. Validate (read-only, local)

```bash
python3 scripts/comp_grids/reference_grid_importer.py validate \
  --csv "$PRIVATE_DIR/ffl_comp_rates.csv" \
  --expect-products 41 --expect-variants 57 --expect-carriers 11
```

The validator parses the CSV with Python's `csv` module and checks it exactly. It checks:
- the header;
- category mapping (`Term`/`Whole Life`/`IUL` → `term`/`whole_life`/`iul`);
- product identity (category + carrier + product);
- trimmed text without control characters;
- ages 0–100, where a blank means that side is unbounded;
- term lengths given as `10|15`, where a blank means not applicable, never "all terms";
- rates given as plain decimals 0–300 with at most two places. A blank cell means no rate row, and an explicit `0` is kept as a zero rate;
- variant labels, overlaps and mixed term/non-term products;
- encoding.

It reports anomalies by row and column, never by value, and exits 1. **Any anomaly stops the import.**
Nothing is rounded, trimmed, renamed, filled or reordered. A questionable value goes back to Chris. Inventory
counts that differ from 41/57/11 are reported, not accepted silently. A UTF-8 byte-order mark is accepted
and reported as `utf8_bom`, because it changes no value.

## 2. Build the deterministic artifact (local, private output)

```bash
python3 scripts/comp_grids/reference_grid_importer.py build \
  --csv "$PRIVATE_DIR/ffl_comp_rates.csv" \
  --grid-name 'FFL Compensation Grid' --effective-date 2025-11-20 \
  --expect-products 41 --expect-variants 57 --expect-carriers 11 \
  --out "$PRIVATE_DIR/ffl.comp_reference_grid.json"
python3 scripts/comp_grids/reference_grid_importer.py verify --artifact "$PRIVATE_DIR/ffl.comp_reference_grid.json"
```

Same CSV + same importer version ⇒ byte-identical artifact. The grid id is deterministic:
`6ad6d4e4-4024-5dae-bef5-de0202ab1b6e` (the UUIDv5 of the grid name and effective date). Record the printed
`source.sha256`, `artifact_sha256`, `content_sha256` and counts in the manifest. Those values are non-sensitive.

## 3. Local import, reconciliation and acceptance (disposable local database only)

Use a clearly identified disposable loopback database, never a hosted one. Build it the way
`scripts/run_commission_grids_tests.sh` does: harness, `private.campaign_actor()`, then the three
migrations.

```bash
psql "$LOCAL_DB_URL" -X -v approve_comp_reference_import=yes \
  -v artifact_path="$PRIVATE_DIR/ffl.comp_reference_grid.json" -v artifact_sha256="$ARTIFACT_SHA256" \
  -f supabase/ops/commission_grids_import_reference_grid.sql
psql "$LOCAL_DB_URL" -X -v grid_id=6ad6d4e4-4024-5dae-bef5-de0202ab1b6e \
  -f scripts/comp_grids/reconcile_reference_grid.sql < "$PRIVATE_DIR/ffl_comp_rates.csv"
```

Reconciliation works independently of the importer. PostgreSQL parses the CSV itself (`COPY … HEADER MATCH`)
and compares every product, variant, rate cell (exact text) and reference in both directions. It prints
counts and PASS/FAIL only. If the validator reported `utf8_bom`, pipe the CSV through `tail -c +4`.

Source-backed acceptance runs the pure calculator against the artifact and the private expectations file. It
is skipped unless `COMMISSION_PRIVATE_DIR` is set:

```bash
COMMISSION_PRIVATE_DIR="$PRIVATE_DIR" npx vitest run src/lib/commission/__tests__/privateAcceptance.test.ts
```

`acceptance.json` (private) is a JSON array of
`{ "name", "category", "carrier", "product", "age"?, "term"?, "level", "monthly_premium"?, "expect": { "status", "rate_percent"?, "total"?, "advance"?, "month"? } }`.
The test prints PASS/FAIL per case name only. Keep these real-data results separate from the synthetic CI
results (C5).

## 4. Production (release step — only with Chris's exact approval of the revised continuation package)

Managed production `postgres` has `SET=false` for the old `agentflow.approve_comp_*` custom parameters. The psql operator scripts therefore use client-side `-v approve_*=yes` variables for their approval guard. After Chris's exact chat approval, MCP execution calls the postgres-only private functions directly and does not depend on a database approval GUC.

The exact order, the route by which the artifact reaches production, and the filename reconciliation after
`apply_migration` are fixed in plan §12. This section summarizes the data steps.

1. Confirm the three production migrations are installed byte-identically as `20261015211858`, `20261016035150` and `20261016035626`; all were verified. Never replay them.
2. Import: run the same `supabase/ops/commission_grids_import_reference_grid.sql` against the approved target,
   with the exact artifact and its manifest `artifact_sha256`. The transaction verifies the checksum, counts,
   constraints and content fingerprint, and records the ledger row (`public.comp_reference_imports`). A re-run
   of the same artifact is a no-op. Different content for an existing grid is refused (PT409) and never
   overwritten.
3. Verify read-only: the ledger row and `private.comp_grid_content_sha256('6ad6d4e4-…')` equal the manifest.
4. Make available (decision D5): `supabase/ops/commission_grids_make_available_home_agency.sql`
   (`-v approve_comp_home_availability=yes`). It resolves *Family First Life - Chris Garness* by exact
   unique name at execution, refuses zero or several matches and a grid without a verified import, and makes
   the grid available to that agency only. Nothing is enabled or selected by it.
5. Activate: `supabase/ops/commission_grids_activate_home_agency.sql`
   (`-v approve_comp_home_activation=yes`). It resolves the same agency the same way and refuses zero
   or several matches. It enables the grid and selects it only if the agency has no selection. An existing
   selection is kept and reported. Without step 4 it is refused (PT404) and nothing changes.

No migration-history entry is created for the data. The ledger is the record. No other agency can see,
enable, read or copy the grid: availability is granted per agency, only by a separately approved operation
(D5). Being an Agency Admin is not availability.

## 5. Rollback (non-destructive)

- **Frontend:** revert the release commit.
- **Calculator off for everyone:** with separate approval, call `private.comp_set_reference_grid_active(grid,
  false)`. It clears every selection of that grid and never picks a replacement. Access rows and data are kept.
- **Withdraw the grid from one agency:** with separate approval, call
  `private.comp_remove_reference_grid_availability(agency name, grid)`. That agency's availability and access go
  and its selection of the grid is cleared; the grid, the ledger and private copies stay. Steps 4 and 5 reverse
  it.
- **Tables:** the schema rollback refuses while any row exists. Leave the tables dormant instead. Never delete
  live data to make a rollback pass.
