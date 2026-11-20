# Sticky Contact Numbers — primary AgentFlow release approval

Updated November 19, 2026 Pacific. This is the active release packet and supersedes the November 14 four-migration packet and its requirement to reconcile a second Vercel project. Earlier inspection records remain historical.

**Status: isolated implementation and release rehearsal complete; production execution is not authorized.** The existing draft PR is [#531](https://github.com/cgarness/agentflow-life-insure/pull/531). Executable source commit: `f49e55b770b97155fac46f3e5eeae949ad9f3047`, based on the recovered PR head `dd3c9c418360a5977cb481902c4ee1a2b3d24be5`; main remains `2129fa8b195cee77ad75f614abe655facfad2725`. Documentation commits may follow the executable commit. Require all 79 source-file hashes in `candidate-manifest.json` to match before release.

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

The November 19 correction adds the existing type-specific Contacts edit permission to deliberate changes and every contact sharing a phone. It also rejects NULL/invalid channels and missing or invalid audit reasons. It replaces only two function definitions in a fifth migration. Existing owners, grants, security settings, contact RLS, four original migrations, frontend and Edge runtime source are unchanged. See `permission-hardening.md`.

Fresh production reads found 381 recorded migrations with head 20261113152433, no installed sticky objects, matching six original DB function preimages and six complete deployed function packages. The primary production site remains main 2129fa8 and its public bundle points to the expected Supabase project with the anon role. Agency number readiness is now 22/22 active numbers registered, pooled and selected by the SMS policy; the earlier registration-gap estimate is obsolete. This task made none of those number changes. Repeat drift/activity checks immediately before an approved installation.

## Frozen database package

| Migration | Bytes | SHA-256 |
|---|---:|---|
| `20261114003115_sticky_contact_numbers_foundation.sql` | 18061 | `3ab479c4553d5d0087a1ee0acd4e2baada84b5255726aeb6db3eda6f107e7d39` |
| `20261114003337_sticky_contact_numbers_sms.sql` | 25131 | `d2466f068e04c03866bdc4fa55303ef71e812d27af700d7e73cd101b043d4908` |
| `20261114003652_sticky_contact_numbers_voice.sql` | 26348 | `269266bc6eda4ac6cf0362c48bfb139b62b02f198e53104a8d699e411d67de58` |
| `20261114004102_sticky_contact_numbers_reconciliation.sql` | 18796 | `9a6a6f670c7e18f74e0ab5c35604824699be238c67c9f6724736a4ff1e51cf64` |
| `20261120060345_sticky_contact_numbers_edit_permissions.sql` | 6052 | `2759c38fd691e2cba4be2b5ba084958dc70f987912ea9582ecb80f8779e996c5` |

`release/install.sql`: **190,981 bytes**, SHA-256 **`8fc2e2f9822829e55496570d0c1ade708a969e3937e4de73f153ad0bbcf35bfc`**. This single transaction executes the five exact migration sources and records their exact version/name/source bytes once. It retains the original six live function guards, both fifth-migration function guards, duplicate-history refusal, a 3-second lock timeout and 60-second statement timeout. The complete original four-migration execution/history prefix is preserved.

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

## Exact approval wording

> Approve the off-by-default Sticky Contact Numbers installation on Supabase `jncvvsvckxhqgqvkppmj` using install.sql SHA-256 `8fc2e2f9822829e55496570d0c1ade708a969e3937e4de73f153ad0bbcf35bfc`, followed by the five complete Edge packages listed here and frontend source `f49e55b770b97155fac46f3e5eeae949ad9f3047` on the primary `agentflow` Vercel project only. Perform the drift, activity, readback and advisor checks in this packet. Keep all sticky modes off. This approval does not include main merge, another Vercel project, number/provider/policy changes, live historical or disposition/allowlist seeding, activation, or real calls/texts.

No production approval has been inferred from the instruction to continue implementation. The user can review this exact package as the final installation approval; do not repeat the implementation or publication approval.
