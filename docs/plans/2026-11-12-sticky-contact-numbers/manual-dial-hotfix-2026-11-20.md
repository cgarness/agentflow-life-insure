# Manual-dial hotfix — installed November 20, 2026

## Outcome and authority

Chris approved the exact Revision 2 one-function hotfix packet. The reviewed SQL was applied once to primary **AGENTFLOW CRM (`jncvvsvckxhqgqvkppmj`)** as migration **`20261120230232_sticky_unsaved_reconciled_call`**, recorded at **3:02:32 PM Pacific**. Readback completed at 3:03:10 PM Pacific. History is now 388 records.

Voice and SMS remain enforced for Chris's organization and off for the other five organizations. Exact settings and enforcement-row fingerprints are unchanged. No frontend or Edge Function deployment, main merge, secondary-project operation, seed, number/provider change, real call or real text was performed.

## Defect and correction

The Floating Dialer's unsaved-number path rejected a recipient with reconciled historical calls, no saved CRM contact, and unassigned voice/SMS identities. `private.affinity_voice_scope` raised `affinity_select_contact`; the client presented its generic refresh message. The live recipient state and logs confirmed the failure, and the installed implementation reproduced it in the isolated database. This guard originated in the initial sticky implementation, not the daily-cap correction.

A complete lifecycle test exposed a second consequence: an unsaved call with confirmed callback disposition and verified provider evidence could establish a voice pin during recovery, yet its repeat call would fail final admission because that pin existed without a saved contact. An initial local empty-history-only candidate did not cover this case and was never deployed. Revision 2 supersedes that candidate.

The correction changes one rejecting predicate in `private.affinity_voice_scope(uuid,uuid,uuid,text,text,uuid,uuid,boolean)`. Where no saved lead/client/recruit exists, history may be `new` or `reconciled`, and each channel may be `unassigned` or `established`. All historical/channel review and SMS reservation states remain blocked. Existing authorization uses the voice identity or existing SMS fallback before a proposed caller number; final admission rechecks that identity.

Every other function byte is preserved, including saved/hidden-contact scope, actor/organization, campaign, queue-lock and conversion checks. DNC, number ownership/readiness, expired/reused bindings, telemetry, explicit one-call behavior and the daily-cap correction remain enforced by the unchanged callers. The function retains its invoker security, owner, ACL, volatility and empty search path.

## Verification

| Check | Result |
|---|---:|
| Corrected manual calls, repeat-call lifecycle and authorization negatives | 38/38 |
| Existing sticky native regressions | 66/66 |
| Existing cap regressions | 20/20 |
| Migration/inverse/replay/drift/data preservation | 8/8 |
| **Corrected candidate total** | **132/132** |

The separate installed-code and first-candidate comparisons reproduce their respective defects; those assertions are not counted as successful corrected behavior. The repeat-call proof uses actual authorization, admission, callback disposition and provider-evidence writers with synthetic fixtures. Tests also cover established voice/SMS pins, distinct channel priorities, a different proposed sender, guard-only, nonpermanent one-call overrides, saved/hidden contacts, review/reservation changes before admission, unavailable numbers, ownership, DNC and campaign restrictions.

The PostgreSQL 17.6 runtime used managed `postgres NOSUPERUSER`, real application roles, synthetic data and denied external networking. All nine function/security records and 21 populated table snapshots survived rollback/reapplication exactly. The three NOT NULL and ten validated CHECK guards refused injected drift. Independent exact-SQL review examined all 60 valid state combinations and found no issues. The sandbox was stopped after evidence recovery.

The regression script is `scripts/sticky-numbers/manual-dial-tests.mjs`; it refuses a non-loopback database or a database other than `sticky_candidate`. Run against the isolated installed-plus-cap-plus-hotfix baseline with `STICKY_MANUAL_EXPECT=corrected`. The frozen original runner does not automatically apply later cap/hotfix migrations; the 38-check result above comes from the recorded release rehearsal, not an assertion that the unchanged hosted runner executes this new script. JavaScript syntax and the root TypeScript 5.8.3 check pass. The first no-install TypeScript attempt lacked local dependencies; the pinned package execution succeeded. Full application/mobile/media acceptance is not recertified by this database-only change.

## Exact release evidence

- Forward: `supabase/migrations/20261120230232_sticky_unsaved_reconciled_call.sql`, 12,397 bytes, SHA-256 `3e2045e812bd36b80b07143077a2564f9a3ecbd185ddb06d2f8c7520e7060f6b`.
- Guarded inverse: `supabase/migrations/rollback/20261120230232_sticky_unsaved_reconciled_call.rollback.sql`, 12,058 bytes, SHA-256 `ace9014fc6e785eaf5e13fe3f584c8f8cba8f260c2567651dac681dd01f1220c`.
- Original never-applied CLI source version: `20261120224127`. Filenames were reconciled to the tool-recorded execution identity; approved bytes are unchanged.
- Target definition MD5 changed from `55de8731da7051ddbbec29d5f52ad702` to `35a5067097bf950383c7911789b43ce5`; all other eight guarded function/security records are unchanged.
- Fresh preflight and readback match all nine expected function/security records and the exact state constraints. The recorded production statement is byte-identical to the approved SQL. Migration history advanced once from 387 to 388 records.
- Settings fingerprint remains `7168e8d63d52b12e08bf3c3d40df8ccf`; enforcement fingerprint remains `ef7ce1bdd5cefd063214cbb7ad5488e8`.
- Security/performance/health advisors have zero added and zero resolved findings: security 313 (67 INFO, 244 WARN, 2 existing ERROR); performance 472 (228 INFO, 244 WARN); health zero. The existing RLS findings on `public.app_config` and `public.webhook_debug_log` remain separate hardening work. [Advisor reference](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public).
- Native evidence archive: 23,095 bytes, SHA-256 `fdd89d5d81385e596167461c0d93d219cab362fbcab3cf939d0e1bddeee86460`.

## Source record and handoff

Publish only this migration, inverse, regression script, closeout, focused-plan prefix and newest-first Work Log prefix on existing draft PR #531. Expected parent is `5f1af614231d7e02acae3acbc46ccd7533b2b89d`, tree `4999fb306516adf8a544c87b60062f7ef306b5a6`; main remains `2129fa8b195cee77ad75f614abe655facfad2725`. Preserve old documentation bytes and unrelated local changes. No PR merge is authorized.

The existing frontend can use the correction immediately; there is no replacement JavaScript bundle to wait for. Chris's agent can retry the manual-call path. An actual agent call remains the practical post-release confirmation; no successful real communication is claimed by this record. Selecting a saved contact, review resolution and other legitimate safety refusals retain their existing requirements. No messaging or calling action is automated as a release check.
