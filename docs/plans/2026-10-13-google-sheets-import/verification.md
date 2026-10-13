# Google Sheets V1 — verification record (local only)

Date: 2026-10-13. Branch `claude/keen-brown-e4u3ht`, base `main` `f91e4ba`.

**Local verification only.** There was no production mutation, Google account, live import or deployment.

## Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` (root) | PASS (exit 0). The root config checks no app files (invariant #35). |
| `npx tsc -p tsconfig.app.json --noEmit` | **85 baseline / 85 candidate.** The sorted diagnostic lists are byte-identical, so there are zero new diagnostics. Both exit 2 on the pre-existing errors. |
| ESLint, all changed and new app, test and script files | PASS: 0 errors, 0 warnings. |
| `npm run build` | PASS (21.5 s). Only the existing chunk-size and Browserslist warnings remain. |
| Vitest, feature suites | 15 new tests pass (`src/lib/google-sheets/__tests__`, `src/components/settings/google-sheets/__tests__`), plus 19 in `contactsPermissions.test.ts`. |
| Vitest, full suite | 5,178 passed, 2 failed, 34 skipped (334 files). The 10 failing files fail identically on an untouched worktree of `main` `f91e4ba`; they are pre-existing. Two files changed by this work were fixed and pass: `reportsContracts` (an intentional `permissionDefaults.ts` blob pin) and `settingsPageHeading` (section stub). |
| Deno type-check (four entry points) | PASS. |
| Deno tests (`_shared/googleSheets` + three handlers) | **42 passed, 0 failed.** deno.land is blocked by this environment's proxy, so `std@0.190.0/testing/asserts.ts` was mapped locally to `jsr:@std/assert@1` through a scratch import map; the test files keep the repository-standard import. |
| SQL suite `scripts/run_google_sheets_tests.sh` (PostgreSQL 16 + PostgREST v12.2.3 in Docker) | **ALL PASSED** — details below. |
| Browser flow `scripts/tests/google-sheets-ui/verify.mjs` (Chromium 1194; mocked Supabase host + fake Picker script) | **36/36 PASS** at 1440×900 and 390×844 — details below. |

## SQL / PostgREST suite (local disposable database)

**Harness fidelity.** The harness reproduces the live `_contacts_permission_default` exactly: MD5 `a199d5dd…b8`, equal to production. It also mirrors:
- Supabase default privileges;
- the production lead triggers (`sync_leads_user_id`, `workflow_on_lead_created`, `notify_lead_assignments`), copied verbatim, with the workflow dispatcher stubbed to a counting table.

**T1–T14**
- **T1 ACL:** 43 functions.
  - No EXECUTE for anon, authenticated or PUBLIC on any of them.
  - Private helpers are denied even to `service_role`; public wrappers are `service_role` only.
  - All are SECURITY DEFINER or have a pinned `search_path`.
  - Private tables are hidden; there are no client writes.
- **T2 permissions:** Agent and Team Leader default ON; CSV import and assign defaults unchanged; explicit deny wins; Admin bypass works. Deleted profile, cross-org user and suspended org are all refused.
- **T3 OAuth state:** single use; expiry; bad origin rejected; cross-org rejected.
- **T4 connection:**
  - generation mismatch → superseded;
  - a refresh token is required, and an absent one never overwrites; it is retained only for the same `sub`;
  - a stale `invalid_grant` cannot disable a newer generation;
  - disconnect deletes the Vault secret, and a late callback after disconnect is refused;
  - the same Google account in another org is allowed.
- **T5 drafts:** duplicate tab refused; the same tab for another agent is allowed; version conflict detected; preview and context create no leads or workflows; cross-agent edit refused.
- **T6 activation:**
  - the baseline excludes existing rows, and baseline records are not receipts;
  - repeated activation is idempotent;
  - ownership and attribution are correct: `assigned_agent_id = user_id = imported_by_user_id` = owner, plus the org default stage and lead source;
  - exactly one `lead_created` dispatch, and no self-notification;
  - repeated ingest is idempotent;
  - the receipt survives lead deletion.
- **T7 pending:**
  - counted once; a corrected row imports;
  - conflicting `dup:` rows become pending errors;
  - a blank-ID baseline carries over to its new ID and is never imported;
  - forged baseline carry-over is refused;
  - an invalid row writes neither a lead nor a receipt.
- **T8 duplicate matrix:** **all 24 rule × scope × action combinations**, × 2 owners × 4 candidate kinds = 192 checks, against an independent truth table of `import-contacts` semantics.
  - Skip writes no lead and fires no workflow.
  - Flag adds the `__agentflow.duplicateImport` marker and the `Duplicate` tag.
  - The existing lead is never modified or reassigned.
  - Within-batch duplicates are flagged.
- **T9 stale work:** these are all refused with `stale`:
  - a wrong lease, an expired lease, and an old lease after a re-claim;
  - a remap (version change), a pause, a disconnect (generation change) and a permission revocation.

  Also covered:
  - stale finish refuses status writes but releases the lease;
  - an identity change requires review;
  - paused and ineligible sources are not claimed;
  - reconnect preserves needs_review and draft;
  - account mismatch is refused while sources exist.
- **T10:** remove and re-add (ID mode) does not replay; receipts and leads survive removal; a backlog makes the source due immediately; prior-receipt count works by key.
- **T11:** a no-ID re-add with "import existing" baselines only the previously imported fingerprint.
- **T12 review:** dry run writes nothing; multiset matching; apply bumps the epoch, baselines known rows and leaves unknown rows as candidates; a stale version is refused.
- **T13 RLS as `authenticated`:** own rows only; UPDATE refused; claim refused; receipts unreadable.
- **T14:** DNC untouched; no self-import notifications; exactly one workflow dispatch per imported receipt; skipped rows have no lead.

**Concurrency (two real sessions)**
- Two sources importing the same person: `imported flagged`.
- **Negative control** (advisory lock removed): `imported imported`, proving the test detects the race.
- Overlapping SKIP LOCKED claims: 4 + 4 claimed, 0 overlap.

**Rollback:** all objects removed, the exact helper preimage restored (MD5 asserted), and the migration re-applies cleanly.

**PostgREST (same HTTP path as the Edge code), 23 checks**
- `service_role` reaches the wrappers and completes claim → load_state → ingest → finish.
- authenticated and anon get 401/403 on six privileged wrappers.
- Unknown RPCs and private tables return 404.
- authenticated reads only its own sources, connection and runs; PATCH is refused.

## Deno tests (42)

- **Mapping:** CSV contract (Full name split, one-word name invalid, phone required, DOB, age, custom fields); headers matched by name; fingerprints cover core values only; custom-field representative and built-in shadow rules.
- **Identity:**
  - Baseline exclusion; an appended identical row is still a candidate.
  - **An insertion plus a compensating deletion above the old tail, with the last 25 rows unchanged, sets needs_review.** Deletion and sort are detected.
  - Pending rows are exempt and revisited.
  - ID-mode sorting never re-imports. Conflicting IDs are errors with no first-row-wins; identical copies import once.
  - Blank IDs, blank-baseline carry-over and edited-baseline handling work; corrected rows import despite other receipts.
- **OAuth:** exact scopes with `include_granted_scopes=false`, PKCE S256 checked against the RFC 7636 vector, scope normalisation and excess rejection, id_token claims, refresh classification, tokeninfo actual scopes, AES-GCM AAD binding.
- **Errors:** quota and API-configuration 403s are not `access_lost`; redaction works.
- **Engine:** baseline + new rows; 500-row cap in 10×50 batches with the backlog flagged; structural, header and too-large cases go to review with nothing imported; `invalid_grant` triggers a generation-guarded reconnect; a quota 403 backs off while a 404 is `access_lost`; stale work releases its lease.
- **Handlers:** start refuses when disabled, unconfigured, with a bad origin, unauthenticated or not permitted, and stores only the hash plus the encrypted verifier. The callback handles success, replay and expiry, denial, missing or excess scopes, a sub mismatch, an audience mismatch, a late callback, account mismatch and no offline access. The worker gate and the disabled state work.

## Browser flow (36 checks; screenshots in `screenshots/`)

At desktop and mobile widths:
- the connected account comes from server status;
- Picker `setAppId` = `87346168200` and the developer key is set; the token is never in localStorage or sessionStorage;
- headers auto-map, including a custom field;
- preview makes no save or activate call;
- **"Also import existing rows" is unchecked by default**, and the workflow warning appears when it is checked;
- Enable keeps new rows only;
- Sync now shows "2 imported (1 flagged) · 1 error";
- Pause, Resume and Remove (with confirmation copy) work;
- there is no horizontal scroll and there are no page errors.

## Edge bundle checksums (SHA-256)

```
32e1eb1766d68523a3c2bccaf407878e650a80a174f3b59e9e9f9a00bfa2ea39  _shared/googleSheets/auth.ts
69f8b0fb022a25a7e444f7ca3b173b30ebb24452d9cdaabcb2d971fa7037e36e  _shared/googleSheets/config.ts
93ff0530d1a3fd74c6072ac56ccc101221713722199ead0290a58f1d836e759f  _shared/googleSheets/crypto.ts
8e09cd42ea98f04f00713e84b238dff19dfd337949e856b0318aae907fabc07f  _shared/googleSheets/db.ts
97ee8f6415ffac204d4a1a3e5ba2379009cfc7a71a13a2ff26cefcb7c4c57315  _shared/googleSheets/engine.ts
4264d9014631b95e2a39bc3039f0d487984f140e7f9366e69245c39f68564633  _shared/googleSheets/errors.ts
93464d53ce96044ea6b37e5f52b2efc506b2b7938076ff93bc3955d77551c3df  _shared/googleSheets/google.ts
b04a85967f04177e2aaa3ac0b7c6f04381aa0153994e62fdded9dcca54b605ad  _shared/googleSheets/http.ts
133c18db60b5a38dc695a01206986e0254add0bf85ed2b81b8bea65729b8ed0e  _shared/googleSheets/identity.ts
a874dcd7f4041a6996014b1d9d028d6bba288a6bb3ea907014aafe2a942428ef  _shared/googleSheets/mapping.ts
bd4421a3cb49777b73dae23d511ccfbbe9f5ed94d7b1a61e5b25e16679c0efab  _shared/googleSheets/oauth.ts
715b1e006062327267b3a186b0e59ce111a78e1d3d11fe18cfa88827802baa22  google-sheets-api/actions.ts
7118ceb48df339d5a87a6a269bc687aeb82d5fabb6d91153946c0cdc60a4e8d2  google-sheets-api/index.ts
14b26e77c8e9cef7fe915903614968593eff463e7fd675bcce377b8da4886e9a  google-sheets-oauth-callback/deps.ts
fd9f8d754f63c0e62f39014200f7b052807c51d9f693aeaff0eb260e982e0edb  google-sheets-oauth-callback/index.ts
fb671d3e49f98476e74fd2b56ec9f0d7e2ac69d5c6fa2264b617ec378d1c27d4  google-sheets-oauth-start/deps.ts
1848091f95e27dab97d7adfb2e503e4f148851a5cfa37def9cef807b86cd0986  google-sheets-oauth-start/index.ts
0a22af357ace3559cebea21c328866559087ba1f03034750c4b5e588d818b495  google-sheets-sync-worker/index.ts
```

Recompute after any later commit; the release must deploy exactly the reviewed head.

## Not performed (pending)

- The real Google-account test (release package §6): Picker-picked file readable by the server, and still readable after a fresh token from the stored refresh token.
- Production migration, Edge deployment, secrets, Google Cloud setup, cron, Vercel flags, privacy publication, merge and release.
- A fresh Google publishing-status check (Testing vs In production).
- Hosted authenticated walkthrough, real Lead Created workflow execution and real Gmail/Calendar regression checks (beyond the code isolation shown here).
