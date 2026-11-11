# Carrier directory verification

## Story and release status

An authenticated life-insurance agent opens Carriers, searches their agency's existing carrier names, expands one card, and uses its portal, guides/training and labeled contacts. An agency administrator edits ordered links in Settings → Carriers; an acknowledged organization-scoped save refreshes the directory without changing unrelated carrier fields.

Implementation is on `feat/carrier-directory-20261111`, based on `e07d28bdef1d8a9a21f0eee408b181b625389527`. Main was rechecked and unchanged before publication. PR #527, #486 and #398 remain separate work. This feature is **not applied to production, merged, deployed or live**. No carrier resources were seeded or existing carriers renamed.

## Executed local evidence

| Boundary | Evidence |
|---|---|
| UI and interactions | Tests render actual Radix accordion, directory and editor: alphabetical/name-only search, single open card, keyboard focus, safe external attributes, portal deduplication, empty groups, phone/email actions and awaited clipboard feedback. |
| Settings → client write | Actual Settings component tests assert resource-only payloads, exact `organization_id`/carrier id/raw `updated_at` filters, `.maybeSingle()` acknowledgement, invalidation, removal to `[]`, failed-save drafts, duplicate-submit prevention and conflict/reopen recovery. |
| Identity and permissions | Actual hook tests cover A→B→A, different users, late replies, View As, missing identity, loading/error/denied permissions and malformed rows. Real permission hook/Settings tests preserve saved denial and unrelated missing-page denial after saving Carriers. Existing View As allowlist remains unchanged. |
| Database validation and authority | Native PostgreSQL 17.11 suite passes: 84 malformed payloads rejected on both INSERT and UPDATE (168 rejection checks), ordered/empty/50-link/Unicode boundaries, real authenticated roles, own-agency reads/writes, and existing privileged exception. |
| Preservation | Native fingerprints compare all pre-existing columns, constraints, indexes, ACLs, RLS, helpers, private-schema permissions, update trigger and legacy carrier values. Old-client inserts default to `[]`; unrelated updates retain resources. |
| Static/build | `npx tsc --noEmit` passes; production Vite build passes. The repository's strict application baseline comparator passes with base=79, candidate=78, new=0 after removing the inherited impossible Sidebar root-path comparison. Only shifted line numbers are normalized. Scoped lint and whitespace checks pass. |

The exact focused CI command passes **281 tests across 17 files**, locally and in [hosted frontend verification](https://github.com/cgarness/agentflow-life-insure/actions/runs/43080598452/job/130731822849). The completed broad regression run has **7,186 passing tests, 10 skipped, and one inherited failure** across 492 files. The failure in `recordingRetentionVoicemail.test.ts`, named “the authentication and conversation-recording purge are byte-identical to deployed v29,” reproduces on clean base `e07d28b`; it is unrelated and remains unchanged. No unhandled errors were reported. These runs used tree `89cef1f10b08970c573459e66f80d4a82f14e35b`; subsequent scoped changes fix reduced-motion specificity, mobile header shrinking and the inherited Sidebar comparison, with browser-wait/overflow verification described below. Final hosted results are recorded in the PR; do not interpret a test that was only authored as executed.

Independent read-only reviews found and resolved two concrete issues before publication: stale optimistic-conflict recovery needed a backing-list refresh; saving Carriers from a legacy permission array needed to keep unrelated missing pages denied. The editor's 50-row test was also changed to a direct display-value query after expensive accessibility queries exceeded jsdom's time budget under concurrent full-suite load; its boundary/editability assertions are retained.

## Native database contract

Generated with pinned Supabase CLI **2.84.5**, original version **20261111182547**, then moved before authoring to `supabase/migrations/pending/carrier_resource_links.sql`.

SHA-256: `6809e2be65dd77835251edd069b85e043ac6793d9dfce6266f6954401e3ce97d`.

The migration adds `resource_links jsonb NOT NULL DEFAULT '[]'`, a private SECURITY INVOKER validator with `search_path=pg_catalog`, and an INSERT/UPDATE OF resource_links trigger. It creates no public RPC and gives clients no private-schema usage or direct validator execution. The native suite proves authorized writes still invoke validation despite those revoked direct privileges. The validator returns NEW unchanged.

Existing ordinary Admin/Agent/Team Leader tenant rules and the existing Super Admin cross-organization exception are preserved. Existing broad table ACLs, including TRUNCATE, are also preserved; this feature makes no assertion that RLS constrains TRUNCATE and does not bundle unrelated ACL hardening. No index is needed for the JSON field because the directory filters carrier names client-side within one agency.

Local runner invocation:

```bash
PG_BIN_DIR=/path/to/postgresql/17/bin CARRIER_PG_TCP_PORT=55483 \
  bash scripts/run_carrier_resource_links_tests.sh
```

It creates and cleans a disposable local database/cluster, refuses non-loopback connection URLs and clears libpq host/service overrides. The local runtime is 17.11. The exact **PostgreSQL 17.6** gate also [passed in hosted CI](https://github.com/cgarness/agentflow-life-insure/actions/runs/43080598452/job/130731822193), with all 168 rejection checks, real-role access and preservation assertions observed in the job log. SQL bytes remain unchanged after that run.

## Browser evidence and limits

The isolated browser fixture builds successfully and imports the actual directory, Settings, permission and organization hooks. Only authentication and the Supabase transport are synthetic. Vite env-file loading is disabled; the verifier permits only its exact loopback origin and blocks external HTTP requests. PostgreSQL/RLS behavior is proved separately by the native suite, not by this adapter.

The verifier defines nine scenario groups and ten screenshots: real Enter/Space/arrow actions, contact/clipboard behavior, exact links, 1440/390/320-pixel light/dark layouts, reduced motion, admin add/reorder/save/reload, failed-save recovery, Agent read-only controls, identity/org changes, View As and read-error recovery.

Local Chromium launch was refused by the workspace (`process_singleton_posix.cc: socket() failed: Operation not permitted`) before page creation. No local browser scenario or screenshot is claimed. The PR workflow installs pinned Playwright 1.56.1 and executes the prepared verifier in an isolated runner; its observed outcome and screenshot artifact are the browser gate.

The first hosted browser run passed native keyboard/single-open behavior and exact groups/new-tab/contact/actual-clipboard checks, then caught a real reduced-motion specificity issue: the shared Accordion's state selector overrode the local `animate-none`. The local reduced-motion descendant utilities now use Tailwind's important modifier, with compiled CSS confirming `animation:none !important` and `transition-property:none !important`. All 14 directory/page tests and scoped lint pass after that fix. The browser verifier retains its computed-style assertion and waits for real animations to settle before interacting with or capturing expanded content; it does not force animation completion or alter application styles. The rerun and screenshots are recorded in [PR #528](https://github.com/cgarness/agentflow-life-insure/pull/528).

The automatic Supabase Preview check was cancelled by the existing concurrent-branch limit. No integration setting was changed. Vercel preview links therefore are not acceptance evidence for an isolated database; all write tests use the synthetic browser adapter or disposable native database.

The corrected feature workflow [passed all three jobs](https://github.com/cgarness/agentflow-life-insure/actions/runs/43081268574): 281 focused tests/build, native PostgreSQL 17.6, and all nine browser scenarios with ten screenshots and zero external requests. The wider CI type-baseline gate then identified a changed inherited Sidebar diagnostic: its new path union included `/carriers`, so its exact diagnostic comparison correctly refused to treat it as byte-identical. Removed the impossible `item.path !== "/"` branch (all core menu paths are non-root), preserving active-route behavior. The unmodified strict comparator now reports **base=79, candidate=78, new=0**; all 56 Sidebar/View As tests pass. Final hosted checks are recorded in the PR.

Visual inspection of all ten screenshots found that an unbroken long carrier name could clip the mobile expand arrow, despite the original document-overflow assertion passing. The trigger now has `min-w-0` so its existing truncated name can shrink within the card. The verifier additionally checks every trigger against its header bounds and intrinsic scroll width, and waits for real finite document animations before screenshots to avoid capturing a theme transition. It retains all earlier assertions and does not cancel or force animations. Final browser results and inspected screenshots are recorded in PR #528.

## Exact pending production sequence

1. After Chris approves the finished PR and this exact SQL, re-read current main/work log, production schema/history, existing carrier RLS/ACL/trigger metadata, project binding and relevant integration/release settings. Stop on unexpected drift or overlapping changes.
2. Apply only the pending `carrier_resource_links.sql` bytes with the SHA-256 above to `jncvvsvckxhqgqvkppmj` through the approved migration mechanism. Do not run all pending or active migrations, seed links, rename carriers, modify policies or use production data for acceptance tests. Read back column/default/validator/trigger metadata and migration history; run advisors and compare against the immediate preflight.
3. After backend verification, merge the reviewed feature head and release the frontend under Chris's explicit release approval. Inspect both linked Vercel projects' actual deployment results; an automatic preview does not establish isolated database access or production readiness.
4. A read-only live smoke check may confirm the directory loads existing carrier records. Any test edit of real carrier data needs exact separate authorization. Existing rows initially have empty extra links, while their portal and contacts remain available.

An ordinary frontend rollback can restore the prior compatible frontend while leaving the additive backend intact. Do not drop the new column as a routine rollback after admins add resources; doing so would delete those saved links. Prepare an exact recovery action if a real release issue requires one.

## Suggested future rule clarification

For a later approved `AGENT_RULES.md` update: new page defaults should add only the intended page to legacy saved arrays, and Settings must preserve effective denials for unrelated missing pages when saving. This build tests that behavior without rewriting the shared permission model.
