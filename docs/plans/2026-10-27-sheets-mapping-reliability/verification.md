# Google Sheets mapping reliability — verification (local, 2026-10-27)

All results below are from disposable local services (PostgreSQL 17.6 in Docker, PostgREST v12.2.3, Vite with a
mocked Supabase host and fake Google Picker). **No production service, Google account or real lead was used.**
Base: `origin/main` `f980c16` is an ancestor of the branch head (no conflicts).

| Check | Command | Result |
|---|---|---|
| Root typecheck | `npx tsc --noEmit` | pass (exit 0) |
| App project typecheck | `npx tsc --noEmit -p tsconfig.app.json` | 80 errors, same count as `main`; the only one in a touched file (`ContactManagement.tsx` `active` on `MappableCustomField`) is pre-existing (`main` line 528) |
| Production build | `npm run build` | pass |
| Whitespace | `git diff --check origin/main...HEAD` | clean |
| ESLint (CI list + new files) | see `.github/workflows/google-sheets.yml` | 0 errors, 0 warnings |
| Focused Vitest (CI list) | Sheets + standard fields + CSV import | 11 files, 174 tests pass |
| Full Vitest | `npx vitest run` | 6499 pass, 37 skipped; 10 files fail **identically on `main` `f980c16`** (9 cannot load without `VITE_SUPABASE_URL`; `recordingRetentionVoicemail` v29 byte check). None is in a file this branch touches |
| Deno tests (CI set) | `deno test --allow-env _shared/googleSheets/ google-sheets-*/` | 135 pass |
| Deno check (six entry points) | `deno check supabase/functions/google-sheets-*/index.ts` | pass |
| SQL / PostgREST / e2e runner | `scripts/run_google_sheets_tests.sh` | **ALL GOOGLE SHEETS CHECKS PASSED** |
| Browser, legacy (flag unset) | `verify.mjs` at 1440 / 390 px | 68 checks pass |
| Browser, flag on + server without v2 | same, `VITE_GOOGLE_SHEETS_MAPPING_V2=true` | every legacy check passes (legacy editor runs) |
| Browser, mapping v2 | `GS_MAPPING_V2=1 verify.mjs` | 30 checks pass |

Not run locally: the `supabase/postgres` real pg_cron job (Docker Hub rate limit); CI runs it.

## SQL runner sections (this branch's additions in bold)

1–4i, 5: foundation, push, regressions, concurrency and rollback — unchanged expectations, M1 applied in every
database. **5b** typed catalog (M1): V1–V5 incl. `normalize_us_state` parity with the Deno port (367 fixture cases),
M1 rollback restores the exact body and ACL, refuses a non-foundation body, v2 → v1 ops aid. **5c** standard lead
fields (M2): S1–S11 (catalog, new-agency seed, recorded failure without blocking org creation, authorized retry,
role/JWT/profile checks, snapshot-guarded conversion and audit, logical-name guard, no lead changes), ops report/apply
(fail-closed, approval reference), rollback keeps audit/status/fields. **5d** two sessions provisioning one agency:
the retry waits and reports; negative control without the lock fails on the guard (never a duplicate). **6** 76
PostgREST checks (new RPCs authenticated-only; private helpers hidden). **7** 81 end-to-end checks incl. scenario 8,
multi-agency v2. **8** 48 push end-to-end checks incl. scenario 6b (a v2 source through the push path).

## Frontend coverage added

- `src/lib/google-sheets/__tests__/mappingV2.test.ts` (11): gate (G1 ∧ G2), catalog grouping/visibility/search,
  header state (blank-with-data, duplicate, new, missing), auto-map (Mailing Address never → Email), v2 form schema
  and acknowledgement reset, frontend ↔ Edge ↔ SQL contract parity.
- `src/components/settings/google-sheets/__tests__/googleSheetsV2Ui.test.tsx` (11): gate matrix; catalog
  loading/error/Retry with no partial list; header failure → Retry; new-sheet flow (auto-map, stored-value preview,
  acknowledgement, v2 payload); picker search and move confirmation; inline creation for Agent (standard name →
  ask an Admin), Admin (idempotent provisioning) and personal fields; review dialog keeps v1/v2.
- `src/components/settings/__tests__/makeAgencyWide.test.tsx` (6): panel hidden when undeployed / not permitted;
  failed automatic setup surfaced; retry adds only missing fields; conversion dry run → exact-name confirmation →
  snapshot apply; `field_changed` refusal; refused review.
- `src/lib/__tests__/standardLeadFields.test.ts` (5) and `importLeadsCustomFields.test.tsx` (+5): RPC contract and
  error codes; the `standard` verdict is opt-in; CSV flag off unchanged, Agent blocked, Admin provisions, personal-only
  name fails closed, visible "Zip Code" reused.
- Deno: `v1Golden.test.ts` pins v1 output byte-for-byte; `values.test.ts`; v2 cases in `mapping`, `engine`,
  `regressions` and `actions` tests.
