# Google Sheets mapping reliability — verification (local, 2026-10-27; re-run after correction C)

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
| Focused Vitest (CI list) | Sheets + standard fields + CSV import | 11 files, 187 tests pass |
| Full Vitest | `npx vitest run` | 6511 pass, 37 skipped; the same 10 files fail **identically on `main` `f980c16`** (9 cannot load without `VITE_SUPABASE_URL`; `recordingRetentionVoicemail` v29 byte check). None is in a file this branch touches |
| Deno tests (CI set) | `deno test --allow-env _shared/googleSheets/ google-sheets-*/` | 145 pass (v1 golden output unchanged) |
| Deno check (six entry points) | `deno check supabase/functions/google-sheets-*/index.ts` | pass |
| SQL / PostgREST / e2e runner | `scripts/run_google_sheets_tests.sh` | **ALL GOOGLE SHEETS CHECKS PASSED** (76 PostgREST, 104 e2e, 48 push e2e) |
| Browser, legacy (flag unset) | `verify.mjs` at 1440 / 390 px | 68 checks pass |
| Browser, flag on + server without v2 | same, `VITE_GOOGLE_SHEETS_MAPPING_V2=true` | 68 checks pass (legacy editor runs) |
| Browser, mapping v2 | `GS_MAPPING_V2=1 verify.mjs` | 42 checks pass; the new "nothing cut off sideways at 390 px" check fails without the `min-w-0` fix (negative control) |

Not run locally: the `supabase/postgres` real pg_cron job (Docker Hub rate limit); CI runs it.

## SQL runner sections (this branch's additions in bold)

1–4i, 5: foundation, push, regressions, concurrency and rollback — unchanged expectations, M1 applied in every
database. **5b** typed catalog (M1): V1–V5 incl. `normalize_us_state` parity with the Deno port (367 fixture cases),
M1 rollback restores the exact body and ACL, refuses a non-foundation body, v2 → v1 ops aid. **5c** standard lead
fields (M2): S1–S11 (catalog, new-agency seed, recorded failure without blocking org creation, authorized retry,
role/JWT/profile checks, snapshot-guarded conversion and audit, logical-name guard, no lead changes), ops report/apply
(fail-closed, approval reference), rollback keeps audit/status/fields. **5d** two sessions provisioning one agency:
the retry waits and reports; negative control without the lock fails on the guard (never a duplicate). **6** 76
PostgREST checks (new RPCs authenticated-only; private helpers hidden). **7** 104 end-to-end checks incl. scenario 8,
multi-agency v2, and **scenario 9 (correction C)**: an active v2 source edited against a sheet that changed after the
preview is refused (new column, renamed mapped header) with mapping, version and receipts unchanged, the running source
keeps syncing and the corrected edit saves with no re-import; a 260-column tab with headerless data and a header past
GR is reported without any cell value, save AND activate need the exact acknowledgement token, nothing past GR is
stored and later changes there never block sync; 200 columns → no scan; 450 columns → bounded scan to OJ, rest
unchecked. **8** 48 push end-to-end checks incl. scenario 6b (a v2 source through the push path).

## Correction C (PR #498 review: preview validation and column overflow)

- Edge (`actions.test.ts`, `mapping.test.ts`): widths 200 / 201 (blank header + data, empty) / 260 / 450; data far
  down a headerless column past GR; no cell value returned; incomplete scans fail closed in preview and v2 writes
  (shape, declared size, streamed size over the cap, stalled response past the timeout) and show as "unchecked past GR"
  in the display-only `headers` action shared with the legacy screen, while quota keeps `rate_limited`; v2 `save` refuses
  drift, a missing mapped header and a gone field with nothing written; the acknowledgement must match the content as
  it is now (missing / wrong / malformed / changed refused; wider empty grid accepted); **v1 `save` makes no Google
  request**; `activate` checks the token on its baseline read; an owner-edited `review` is checked, a structural
  review keeping the stored mapping is not; signature stable, width-independent, content-sensitive.
- Frontend (`mappingV2.test.ts` +3, `googleSheetsV2Ui.test.tsx` +10): preview key = exact request; the blocker matrix
  (loading, failed, stale, columns changed, acknowledgement); Enable disabled while loading and after failure, Retry
  recovers; an out-of-order response for an earlier draft is ignored; drift → Review columns → re-read → new column
  ignored and marked New → fresh confirmation; a refused save refreshes the preview; active-source edit sends the token
  with the save and with the Lead ID review override; the review dialog forwards it (v1 payloads unchanged);
  200 / 201 / 450-column sheets in the UI, and a scan that could not finish shown as "not checked", never complete.

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
