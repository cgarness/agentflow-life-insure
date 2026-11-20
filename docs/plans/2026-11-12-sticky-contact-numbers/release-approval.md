## November 20, 2026 Pacific — pinned voice cap correction installed

Chris authorized: “Ok correct the cap behavior and then I will run tests.” The exact correction was applied to AGENTFLOW CRM (`jncvvsvckxhqgqvkppmj`) as migration `20261120193109_sticky_pinned_voice_cap` at **11:31:09 AM Pacific**. Both sticky channels remain enforced for Chris's agency; the other five organizations remain off. The primary frontend and Edge packages are unchanged.

An established voice pin, or established SMS pin when voice is unset, now remains usable at and above the operational daily call cap. The database preview, call authorization and final admission use one endpoint-scoped helper. Rotation, one-call overrides, reservations and review states retain their existing restrictions. Ownership, active-number status, Inbounds-only exclusion, campaign groups, DNC, contact access, binding generation and telemetry are preserved.

Verified: six old defects reproduced; **20/20** focused actual-role cap checks; **66/66** existing native regression groups; **5/5** guarded migration/rollback/replay checks preserving exact content across 21 populated tables. PostgreSQL17.6 used the actual managed NOSUPERUSER postgres role. Root TypeScript5.8.3 and test-script syntax pass. The application TypeScript/mobile limitations in earlier records are not newly certified by this database-only change.

Production: all nine expected function definitions/security metadata match; the recorded migration statement is byte-identical to the tested 13,897-byte SQL (SHA-256 `6e88a3472e554ff38c98daa254bea4744dac98a7be82c637b43b6182de2a1bd4`). History is 387 records/head `20261120193109`. Fresh before/after modes, assignments, audit and communication aggregates match. Advisors add no findings; existing 2 security ERROR findings remain, and one performance INFO resolved. No real call/text was initiated by this work. Chris owns the live call/text acceptance.

See [the cap correction closeout](cap-correction-2026-11-20.md) for exact scope, tests, rollback and handoff. Prior statements that pinned numbers still block at cap describe the earlier installation and activation checkpoints; this correction supersedes that limitation. No main merge, secondary-project change, provider/number change, reseeding or arbitrary reassignment occurred.

---

# Sticky Contact Numbers — enabled for Chris's agency

Current status, November 20, 2026 Pacific: Chris's activation instruction was completed at **11:01:17 AM Pacific** for **Family First Life - Chris Garness** (`a0000000-0000-0000-0000-000000000001`). Both voice and SMS are **enforced**. All other five organizations remain off.

Native reconciliation completed 3,183 endpoints: **two established SMS identities, 44 for review, 3,137 unassigned**. No historical voice relationship was invented. The six settled disposition classifications and two exact existing ClearPath alert routes were applied inside the guarded operation. All 22 agency numbers passed current database readiness checks. See [the activation closeout](production-activation-2026-11-20.md) for the applied SQL/hash, evidence, scope and limitations.

Post-UI readback and nineteen successful authenticated preview RPC requests confirm the activation and read-only screen behavior. The contact screen now shows Calls/Texts/Change/Ready after reload; no Call/Send/Change/Save action or real communication was performed. Activation advisors add no findings; existing errors/warnings remain and one unused-index INFO resolved. Installed voice daily caps still block at cap; no pinned soft-cap bypass is claimed.

The installed runtime is unchanged: 386 migrations/head `20261120060345`; Edge versions 62/51/27/48/73 and unchanged ClearPath 25; frontend `f49e55b770b97155fac46f3e5eeae949ad9f3047`, READY primary deployment `dpl_56mpNPZEL3gNBBAqbHga3Es5Gq7f` at `fflagent.com`. Main remains `2129fa8`, unmerged. No idle shadow period, real-media/delivery acceptance, activation-turn console check, secondary/provider work or runtime redeployment is claimed.

Do not replay either the installation or activation operation. Preserve the 44 review endpoints until deliberate resolution. Supported protective rollback is guard_only, preserving identities and audit history.

---

## Historical installation and release records

The text below is preserved as the reviewed installation record. Its all-off status and separate-activation gate describe the earlier checkpoint and are superseded for Chris's agency only by the successful activation above. No old command list authorizes repeating completed work.

# Sticky Contact Numbers — primary installation completed; modes off

Updated November 20, 2026 Pacific. Chris approved the three-statement managed-role correction and resumed the previously approved primary-only installation. The corrected transaction, five complete Edge packages and pinned frontend are installed and verified. **Do not replay the installer. Sticky voice and SMS remain off for every organization.**

| Installed component | Verified identity |
|---|---|
| Supabase | `jncvvsvckxhqgqvkppmj`; 386 migrations/head `20261120060345` |
| Installer | SHA-256 `1d2d1a4d0a7872f6bc1e5c37e940fd37e8f4758c1ced56cda8df24017a9175b9`; all five exact histories, 55 functions/11 tables/one role match |
| Edge | `twilio-sms` 62; `workflow-executor` 51; `sms-consent-worker` 27; `twilio-sms-webhook` 48; `twilio-voice-inbound` 73; all ACTIVE, `verify_jwt=false` |
| Frontend | `f49e55b770b97155fac46f3e5eeae949ad9f3047` |
| Primary production | `agentflow`, `dpl_56mpNPZEL3gNBBAqbHga3Es5Gq7f`, READY |
| Domains | `fflagent.com`, `www.fflagent.com`; apex redirect retained |
| Activation/seed | None; all six organizations' voice/SMS modes off |

See [the November 20 installation record](production-installation-2026-11-20.md) for actual production readbacks, advisor explanations, package-bundling qualification and browser verification. The final 18:38:51 UTC readback again passes exact history/postimages, every mode off and empty seed scope; authenticated preview RPC logs show 17 POST and one OPTIONS request, all HTTP 200. Installation verification is complete. This does not claim pilot or real communication acceptance.

The original November 19 rollback remains historical evidence. The new grant was explicitly approved before the successful attempt. Main is not merged and the secondary project remains outside scope. The future pilot needs its own exact organization/cohort, reconciliation dry run, reviewed disposition mapping, internal-alert allowlist and controlled-test scope. No seeding, activation, number/provider change or real communication is authorized by this record.

---

## Historical approved release packet — November 19

The text below preserves the reviewed payload identities, approval wording, failed-attempt context and release procedure. Its statements about waiting for amendment approval or absent production installation describe the November 19 checkpoint, now superseded by the November 20 installation record above. Its command list is not an instruction to replay completed production work.

# Sticky Contact Numbers — primary release: managed-role amendment

Updated November 19, 2026 Pacific. This is the active release packet and supersedes the November 14 four-migration packet and its requirement to reconcile a second Vercel project. Earlier inspection records remain historical.

**Status: the previously approved installation was attempted once and rolled back completely. The managed-role correction is verified; approval is required only for the amended installer and role grant.** The existing draft PR is [#531](https://github.com/cgarness/agentflow-life-insure/pull/531). Database and rehearsal source commit: `43028ca74e2271c85dc05f87c318fa27cda86aad`; the previously approved frontend stays at `f49e55b770b97155fac46f3e5eeae949ad9f3047`, based on the recovered PR head `dd3c9c418360a5977cb481902c4ee1a2b3d24be5`; main remains `2129fa8b195cee77ad75f614abe655facfad2725`. Documentation commits may follow the executable commit. Require all 80 source-file hashes in `candidate-manifest.json` to match before release.

Chris directed this release to the primary **agentflow** project at **fflagent.com**. The secondary project is outside the scope and is not a prerequisite. Release directly to the primary by exact source SHA; no main merge is needed or included.

## Concrete installation scope

| Target | Exact identity |
|---|---|
| Supabase | AGENTFLOW CRM, `jncvvsvckxhqgqvkppmj` |
| Vercel | `agentflow`, `prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc` |
| Vercel team | `team_iPboOWpwdIQRwdxmA5GJp5Rq` |
| Public domains | `fflagent.com`, `www.fflagent.com` |
| Frontend source | `f49e55b770b97155fac46f3e5eeae949ad9f3047` on `prereq/sticky-numbers-baseline-20261113` |

The initial enabled cohort, historical seed cohort, disposition seed, internal-alert allowlist seed and real test recipients are all **empty**. Installation leaves every sticky mode off. No A2P registration, SMS policy membership, provider setting, preview-automation setting or credential change is included. No real call or text is included. Pilot activation requires a later exact scope.

## Verified changes and current readiness

Phases 1–5 are implemented: persistent voice/SMS endpoint identities; database-bound sender selection; current send readiness; one-time and deliberate changes; native voice qualification/recovery; all three real messaging surfaces including the Dialer; reconciliation and protective rollback.

The November 19 correction adds the existing type-specific Contacts edit permission to deliberate changes and every contact sharing a phone. It also rejects NULL/invalid channels and missing or invalid audit reasons. It replaces only two function definitions in a fifth migration. Existing owners, grants, security settings, contact RLS, the four later migrations, frontend and Edge runtime source are unchanged. The never-applied foundation additionally has the three managed-role setup statements described below. See `permission-hardening.md`.

Fresh production reads found 381 recorded migrations with head 20261113152433, no installed sticky objects, matching six original DB function preimages and six complete deployed function packages. The primary production site remains main 2129fa8 and its public bundle points to the expected Supabase project with the anon role. Agency number readiness is now 22/22 active numbers registered, pooled and selected by the SMS policy; the earlier registration-gap estimate is obsolete. This task made none of those number changes. Repeat drift/activity checks immediately before an approved installation.

## Managed-role amendment and confirmed rollback

The original approved five-migration installer (`8fc2e2f9822829e55496570d0c1ade708a969e3937e4de73f153ad0bbcf35bfc`) failed at the restricted helper ownership transfer with PostgreSQL42501 and rolled back. Production remains381 migrations/head20261113152433 with no sticky role or relations, and no Edge/frontend deployment occurred. Do not retry that installer.

The foundation adds exactly three statements, matching the existing production commission operator/writer pattern: `GRANT agentflow_affinity_scope TO postgres`; temporarily grant `CREATE ON SCHEMA private` to the scope role around the existing OWNER transfer; then immediately revoke CREATE. Persistent database-administrator membership supports the sealed helper's runtime and migration management. No application-role membership, direct helper execution, persistent schema CREATE, LOGIN or BYPASSRLS is added to the restricted role. Function definitions, owners and final function/table ACLs are unchanged.

Actual non-superuser postgres on PostgreSQL17.11 now reproduces the original failure and verifies the revised exact installer,55function/11table/1role postimages,5history source hashes,66native groups and7atomic/replay cases. The new80thsource file, `scripts/sticky-numbers/managed-role-rehearsal.mjs`, reproduces this check using literal loopback test connections only. See `production-installation-2026-11-19.md` for the complete attempt record and amendment.

## Frozen database package

| Migration | Bytes | SHA-256 |
|---|---:|---|
| `20261114003115_sticky_contact_numbers_foundation.sql` | 18474 | `3730a454e79acd793324ba1cc08e3a8a0d05f270b5b0af399f9842675937ed4c` |
| `20261114003337_sticky_contact_numbers_sms.sql` | 25131 | `d2466f068e04c03866bdc4fa55303ef71e812d27af700d7e73cd101b043d4908` |
| `20261114003652_sticky_contact_numbers_voice.sql` | 26348 | `269266bc6eda4ac6cf0362c48bfb139b62b02f198e53104a8d699e411d67de58` |
| `20261114004102_sticky_contact_numbers_reconciliation.sql` | 18796 | `9a6a6f670c7e18f74e0ab5c35604824699be238c67c9f6724736a4ff1e51cf64` |
| `20261120060345_sticky_contact_numbers_edit_permissions.sql` | 6052 | `2759c38fd691e2cba4be2b5ba084958dc70f987912ea9582ecb80f8779e996c5` |

`release/install.sql`: **191,807 bytes**, SHA-256 **`1d2d1a4d0a7872f6bc1e5c37e940fd37e8f4758c1ced56cda8df24017a9175b9`**. This single transaction executes the five exact migration sources and records their exact version/name/source bytes once. It retains the original six live function guards, both fifth-migration function guards, duplicate-history refusal, a 3-second lock timeout and 60-second statement timeout. Only the foundation execution and exact recorded-source blocks differ from the preceding five-migration installer; all other transaction bytes are unchanged.

**Superseded:** do not install the prior four-migration package with SHA-256 `7dddbdc515012a144829f5e089dcadf9831b57fc8c941250c460d69a04414578`; it lacks the permission correction.

The restored historical migrations20261002203426 and20261113152433 and extra captured baseline statements are local reconstruction inputs only. They are not in this installer and must never be replayed in production. Do not use a broad migration push to apply the candidate.

## Frozen complete Edge packages

| Package | Captured live version | verify_jwt | Candidate source-manifest SHA-256 |
|---|---:|---|---|
| `twilio-sms` | 61 | false → false | `41f83e78926637a249681f99ffa4448576284aaeaa34251a225716ffbeb11735` |
| `workflow-executor` | 50 | false → false | `c96d4a8de9cdd8d6d471152a37d0d99203d74799135c5821d4aec1f71a4a53a0` |
| `sms-consent-worker` | 26 | false → false | `b6a1c29848e1bb22d655dbb501a27392434f38724a693323a74d4f0afb9a8a07` |
| `twilio-sms-webhook` | 47 | false → false | `652a3798c51875292d78ba2b843706079826fa200a6c726fa6f91fb31b5822cd` |
| `twilio-voice-inbound` | 72 | false → false | `dbc079f452f8231275d03220de94f308b1a90ab7a9da7d94f5d7eb35807b91bb` |

These five packages are unchanged by the permission correction. Each complete package contains its recursive local import closure and original external import URLs. The manifest hashes identify source-file sets, not provider EZBR hashes. Re-fetch current live content before deploying and compare it with the retained preimages. Preserve `verify_jwt=false` and existing application authentication/signature checks.

`clearpath-lead-alert` remains unchanged and excluded at captured version 25, EZBR `6d88feea6910dce56bb20cf3ca859e1da346c64257c22d44f697bf3731d44638`. PR #429/#444 and the future automatic-number-enrollment feature remain separate.

## Verification and practical limits

- Fresh native PostgreSQL 17.11 baseline: 85 functions and 45 table catalogs, zero differences.
- New regressions fail the original four migrations for the two actual defects; corrected suite passes 66/66 groups, including 52 retained groups and 14 new actual-role groups.
- Installer rehearsal: 7/7 cases, including early/fifth preimage rollback, pre-existing fifth identity, exact five history entries, exact postimages, zero modes/assignments and replay refusal.
- Native postimages: 55 functions, 11 private tables and 1 scope role; only the two intended function definition hashes differ. Owners, ACLs and security settings are identical.
- Read-only isolated advisor delta:zero new ERROR; 6 expected authenticated-definer warnings, 11 private-RLS informational findings and 12 unused-index informational findings on the fresh schema. The 2 baseline errors remain. These findings are recorded, not called clean.
- Root TypeScript, changed-test syntax/scoped lint and whitespace pass. Application TypeScript retains the exact 78 main/previous-candidate diagnostics with no new diagnostics. Existing broader test limitations remain in `verification.md`.
- Prior unchanged Edge/browser/performance results remain recorded in `verification.md`; no production communications were performed. The 11 hosted PR workflows are checked against the final publication commit separately and do not execute the 66 native groups.

## Ordered release after exact approval

1. Confirm the approved source-file/package hashes, current primary deployment, backend history and six DB preimages. Re-fetch the five target Edge packages plus unchanged ClearPath. Stop on material drift. Recheck active calls, unresolved dispatches, worker leases and database locks; retain the rehearsed lock/statement limits.
2. Execute the exact five-migration `release/install.sql` transaction once against `jncvvsvckxhqgqvkppmj`. If transport is ambiguous, inspect history/postimages before retrying. Do not record history twice.
3. Read back all five exact version/name/source records and the expected function/table/role metadata. Require zero settings/enforcement/assignment rows. Run production advisors and compare with the saved baseline before proceeding.
4. Deploy the five complete pinned Edge packages in table order, preserving configuration. Verify deployed versions, full source/configuration and authenticated read-only behavior. Keep sticky modes off.
5. Create a production deployment only for `agentflow` with `gitSource.type=github`, `repoId=1170119250`, `ref=prereq/sticky-numbers-baseline-20261113`, and `sha=f49e55b770b97155fac46f3e5eeae949ad9f3047`. Use existing primary production configuration. This action can immediately assign the live domains; it is a live frontend release, not staging. Verify READY, exact source, domain assignment and read-only application behavior. No main merge, second-project action or configuration change is included.
6. Record outcomes and stop with all modes off. Prepare the pilot's exact organization/cohort, evidence dry-run, reviewed disposition IDs, internal alert allowlist and controlled test recipients before requesting activation approval.

## Readback and protective rollback

`release/readback.sql` SHA-256 `9bbcd5649a56d753a762ef2b24fecf40a08ed7541fe80b6b77d0421f9eeb7625`.

Corrected `release/expected-postimages.json`: 19,717 bytes, SHA-256 `663c58170e02358f2dd82c8bd39460b2fc88674aad11961703e567528f504814`. Never substitute the old postimages.

`release/guard_only.sql` SHA-256 `22d8531a8d59f88f9dd2133d09e1410d8d41cb55ff8f9e0bb1b4b2a7125721e6`. Once activation is separately approved, the approved affected organization's rollback can preserve identities/audit/unresolved sends while setting both channels to guard_only. It does not replay messages or restore default-number fallback. Before first activation, keep all modes off and diagnose any installation defect without creating relationships.

## Exact amendment approval wording

> Approve the managed-role amendment: the three added statements in the never-applied foundation migration and revised five-migration installer SHA-256 `1d2d1a4d0a7872f6bc1e5c37e940fd37e8f4758c1ced56cda8df24017a9175b9`. Resume the previously approved primary-only installation after fresh drift/activity checks. Keep all sticky modes off and retain the original exclusions.

Chris already approved the five unchanged Edge packages and pinned primary frontend. That authority persists. The additional request concerns only the concrete amended installer and database-administrator role membership. It does not authorize a main merge, secondary project work, seeding, activation, provider/number changes or real calls/texts. No revised production attempt has occurred.
