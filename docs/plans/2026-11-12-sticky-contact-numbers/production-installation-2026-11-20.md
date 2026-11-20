# Sticky Contact Numbers — primary production installation

November 20, 2026 Pacific. Primary `agentflow` / `fflagent.com` only.

## Outcome and authority

Chris explicitly approved the three added database role-setup statements and resumption of the previously approved five-migration, five-complete-Edge-package, pinned-frontend release. The corrected database transaction and all five Edge deployments succeeded. The primary frontend is READY at the approved source. **All sticky modes remain off. Installation is complete; pilot activation and real communication acceptance are not part of this release.**

This follows the November 19 failed attempt, which rolled back completely. Its old installer must not be retried. The corrected installer has now been applied successfully and must not be replayed either.

## Production database

Target: AGENTFLOW CRM, `jncvvsvckxhqgqvkppmj`. Executed exact corrected `release/install.sql`, 191,807 bytes, SHA-256 `1d2d1a4d0a7872f6bc1e5c37e940fd37e8f4758c1ced56cda8df24017a9175b9`, once with the frozen transaction, three-second lock timeout and sixty-second statement timeout.

| Applied version | Name | Recorded source SHA-256 |
|---|---|---|
| `20261114003115` | `sticky_contact_numbers_foundation` | `3730a454e79acd793324ba1cc08e3a8a0d05f270b5b0af399f9842675937ed4c` |
| `20261114003337` | `sticky_contact_numbers_sms` | `d2466f068e04c03866bdc4fa55303ef71e812d27af700d7e73cd101b043d4908` |
| `20261114003652` | `sticky_contact_numbers_voice` | `269266bc6eda4ac6cf0362c48bfb139b62b02f198e53104a8d699e411d67de58` |
| `20261114004102` | `sticky_contact_numbers_reconciliation` | `9a6a6f670c7e18f74e0ab5c35604824699be238c67c9f6724736a4ff1e51cf64` |
| `20261120060345` | `sticky_contact_numbers_edit_permissions` | `2759c38fd691e2cba4be2b5ba084958dc70f987912ea9582ecb80f8779e996c5` |

Production history is now 386 records with head `20261120060345`. All five version/name/source-byte records match. The prior 381-record history SHA-256 remains `a05a983f6d8173f0192202e90acc86adef4d3db8fa88cd4d23f9acd1c4a573c3`; no historical migration was replayed or changed.

Actual production function/table/role readbacks match the expected 55 functions, 11 private tables and one role. The supplemental role check confirms postgres SET/INHERIT/helper execution; the scope role's authenticated inheritance; NOLOGIN/NOSUPERUSER/NOBYPASSRLS; no retained private-schema CREATE; zero unexpected role members; and no anon/authenticated/service-role membership, SET, private CREATE or direct helper execution.

All six organizations have effective voice/SMS mode `off`. Settings, enforcement, assignments, reconciliation, assignment events, internal-alert allowlist, bound sticky dispatches and classified dispositions were zero at the installation readback. The final checkpoint below records all eleven private feature table counts.

## Complete Edge packages

| Function | Prior → installed | State | `verify_jwt` |
|---|---:|---|---|
| `twilio-sms` | 61 → 62 | ACTIVE | false |
| `workflow-executor` | 50 → 51 | ACTIVE | false |
| `sms-consent-worker` | 26 → 27 | ACTIVE | false |
| `twilio-sms-webhook` | 47 → 48 | ACTIVE | false |
| `twilio-voice-inbound` | 72 → 73 | ACTIVE | false |

Each complete frozen package was deployed and retrieved again. Every executable local dependency is present and byte-identical to the approved package; configuration remains unchanged. The provider's inbound bundle omits `_shared/a2p/types.ts`, referenced only by erased `import type` declarations. Independent closure analysis confirms this is type erasure rather than a missing executable dependency. The other four package file sets match exactly.

`clearpath-lead-alert` was not redeployed. Its version 25 and full source remain unchanged. Outbound voice webhook/status packages, purchasing/registration code, UV, provider settings and number policy membership remain outside this operation.

## Primary frontend and browser readback

- Source: `f49e55b770b97155fac46f3e5eeae949ad9f3047` from `prereq/sticky-numbers-baseline-20261113`.
- Project/team: `agentflow` / `prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc` / `team_iPboOWpwdIQRwdxmA5GJp5Rq`.
- Deployment: `dpl_56mpNPZEL3gNBBAqbHga3Es5Gq7f`, production, READY; https://agentflow-d4wjfg1ur-cgarness-projects.vercel.app.
- Independent alias readback: both `fflagent.com` and `www.fflagent.com` point to that deployment, with the apex-to-www redirect preserved and no alias error.
- Build: 24.9 seconds overall; Vite 18.06 seconds; Vercel build 20 seconds. Existing chunk-size warning disclosed; successful deployment.
- Authenticated read-only contact preview passed. No application console error was observed. Six metadata errors came from browser extensions and were unrelated to AgentFlow. No call or text was initiated.

Main remains `2129fa8b195cee77ad75f614abe655facfad2725`. PR #531 was draft and unmerged at deployment. The approved frontend was deployed directly; no main merge event or secondary-project operation occurred.

## Production advisors

Before/after security, performance and health results were compared using actual production evidence, ignoring only timestamps and ordering. **Zero new ERROR**; both existing RLS-disabled-table errors remain unchanged and are not part of this task. No unapproved privilege or policy DDL change was found.

The exact observed additions are:

- Six authenticated SECURITY DEFINER warnings for the intended public RPCs, with owners, ACLs and security metadata independently matched.
- Eleven informational private-table RLS/no-policy findings for storage intentionally reachable only through authorized server functions.
- Twelve performance warnings enumerate existing PUBLIC-targeted permissive policy combinations for the newly created restricted role. Every combination was already reported for an existing role before installation; current catalog proof and exact migration sources show no policy creation, alteration or removal.
- Ten unused-index informational findings for the newly installed, inactive feature. The isolated rehearsal's two additional unused-index findings were on pre-existing profiles/wins indexes that have nonzero production usage; they are not unused in production.

Full details and remediation URLs are retained in `advisor-comparison.json` in the November 20 evidence package. These results are explained findings, not a claim of a clean advisor report. No unrelated RLS or index remediation was performed.

## Evidence and final checkpoint

The November 20 operation evidence contains the exact approval, frozen-package verification, source/main/primary-domain drift checks, six database preimages, six complete Edge preimages, workload checks, migration receipt and exact history digest, function/table/role/mode checks, advisor deltas, every deployed source/configuration readback, primary deployment/alias receipt and browser verification.

Prior isolated managed-role verification remains 66/66 native groups and 7/7 atomic cases. Hosted exact-head `5e12020e` verification remains 11/11 workflows and 22/22 jobs, all on the first attempt. Those results retain the existing TypeScript/test findings and two blocked mobile SMS cases; a production read-only preview does not erase those limitations or substitute for a pilot send/call.

Final production checkpoint at **18:38:51 UTC / 10:38 AM Pacific** again reports `all_checks_pass = true`: exact five history sources and 55-function/11-table/one-role postimages remain intact, all six organizations retain voice/SMS off, all eleven private feature tables are empty, and classified dispositions/bound dispatches are zero.

Authenticated read-only browser evidence and backend aggregate logs agree. From 18:32:00–18:38:18 UTC, `/rest/v1/rpc/preview_contact_numbers` handled 17 POST requests and one OPTIONS request, all HTTP 200. The actual installed `previewContactNumbers` client calls this RPC directly, so no `twilio-sms` Edge preview request is expected. The contact preview resolved without the unavailable/error state, the number-change control stayed hidden while both modes were off, the draft remained empty, and returning to Contacts loaded normally. These are bounded read-only checks, not a general production error-rate or live-media guarantee.

Production verification is complete. The documentation-only release record and durable closeout preserve `final-readback.json`, `browser-verification.json` and `preview-log-readback.json` alongside the earlier receipts.

## Preserved exclusions and next work

No main merge, secondary-project inspection/change, historical/disposition/allowlist seeding, activation, number/provider change, or real call/text was performed. No production credentials, customer message bodies or screenshots are included in this document.

Keep every sticky mode off. Before any pilot, prepare the exact organization and cohort, evidence reconciliation dry run, reviewed disposition mapping, internal-alert allowlist and controlled communication tests. Those actions require their own exact scope and approval. Do not repeat installation or broaden this release into number enrollment.
