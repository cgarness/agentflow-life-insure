## November 14, 2026 Pacific — approved review publication

Chris approved the three exact preview pauses and one draft PR. Saved and reloaded: Preview Branch Tracking OFF on both agentflow Vercel projects; Supabase Automatic branching OFF, Deploy to production remains OFF, Supabase changes-only ON and branch limit3 retained. No credentials, production mappings, existing branches or protection settings changed. Main remains2129fa8; all78 frozen source files match. Publish only prereq/sticky-numbers-baseline-20261113, open one draft PR, inspect isolated CI. Production installation/merge/deployment, preview restoration, activation and real communication remain held. Documentation changes only: root/focused plans, WORK_LOG and focused release approval/publication record; source and migrations remain frozen.

# Sticky Contact Numbers — exact production-release approval packet

**Status: prepared for review; publication and all production execution HELD.** November 14, 2026.

Source candidate: `a57ea11168fff51156b8d624b4966c10869d8dcd`. Repository: `cgarness/agentflow-life-insure`. Exact inspected base/main: `2129fa8b195cee77ad75f614abe655facfad2725`. No PR or preview was created. The offline bundle also includes final documentation commits; the executable source and test files are pinned by candidate-manifest.json.

This packet defines a complete, off-by-default installation of Phases 1–5. Its exact initial cohort is **none**, historical seed cohort **none**, disposition seed **none**, internal-alert allowlist seed **none**, activation **none**, provider registration/policy changes **none**, and real test recipients/numbers **none**. Those empty scopes are intentional boundaries, not implicit authorization to choose live people or send communications. A pilot activation requires the remaining pilot section to be filled with verified identifiers and separately approved in this same packet. The feature must remain off until all pilot gates close.

## November 14 read-only preflight update — publication still held

Main/source and backend drift checks pass: all85 functions,45 table catalogs,381 migration records,six full Edge packages and78 pinned source files match. No executable package changed. Full evidence and exact settings: [release-preflight.md](release-preflight.md).

Dashboard access resolved the connector403 inspection blocker. It confirmed that BOTH Vercel projects automatically build Preview branches and Supabase automatically creates preview databases for changed supabase paths. Primary VITE_SUPABASE keys apply to All Environments; isolated preview behavior is not proved. Supabase automatic production deployment is OFF. The secondary Vercel project's visible Production/Preview inventories lack the required Vite backend keys and must be reconciled before frontend release; a READY build alone is insufficient.

**Next proposed approval is publication preparation only:** set Preview Branch Tracking OFF on prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc and prj_PctERc2MEVcpKkYtBtQYc1ruunKb; set Automatic branching OFF on the Supabase GitHub integration for jncvvsvckxhqgqvkppmj, retaining automatic production deployment OFF. Verify saved state, then push only prereq/sticky-numbers-baseline-20261113 and open one draft PR against main for the frozen candidate and documentation. Observe existing isolated CI. This temporarily pauses future automatic previews for other work in these projects. Existing production/preview deployments keep running. No credentials/protections/production mappings change; no merge, DB/Edge/frontend deployment, live seed, activation or communication. Leave preview automation paused until restoration is separately reviewed with queued events and branch state. No setting change or publication has yet occurred.

> Approve the three exact preview-automation pauses above, verification that they are saved, and publication of the frozen Sticky Contact Numbers branch as one draft PR for isolated CI. Keep production execution and all live testing held.

This approval is distinct from, and does not grant, the frozen production installation approval at the end of this packet. The original installation hashes below remain unchanged. Fresh table sizes support retaining the rehearsed guards; an approved quiet window and immediate activity recheck remain required. Live advisors were captured for later delta comparison and were not represented as clean.

## Frozen database package

Production target: **AGENTFLOW CRM**, `jncvvsvckxhqgqvkppmj` only.

| Migration | Bytes | SHA-256 |
|---|---:|---|
| `20261114003115_sticky_contact_numbers_foundation.sql` | 18061 | `3ab479c4553d5d0087a1ee0acd4e2baada84b5255726aeb6db3eda6f107e7d39` |
| `20261114003337_sticky_contact_numbers_sms.sql` | 25131 | `d2466f068e04c03866bdc4fa55303ef71e812d27af700d7e73cd101b043d4908` |
| `20261114003652_sticky_contact_numbers_voice.sql` | 26348 | `269266bc6eda4ac6cf0362c48bfb139b62b02f198e53104a8d699e411d67de58` |
| `20261114004102_sticky_contact_numbers_reconciliation.sql` | 18796 | `9a6a6f670c7e18f74e0ab5c35604824699be238c67c9f6724736a4ff1e51cf64` |

Generated all-or-nothing transaction: `release/install.sql`, 178,462 bytes, SHA-256 `7dddbdc515012a144829f5e089dcadf9831b57fc8c941250c460d69a04414578`. It executes exactly those four new sources in order and records each exact version/name/source statement in `supabase_migrations.schema_migrations` inside the same transaction. It refuses previously recorded identities and changed original SMS/voice function preimages. No reconciliation, classification seed, allowlist seed, number enrollment or mode activation is included. Native rehearsal proves preimage-drift rollback, correct history bytes, schema/security postimages and duplicate refusal.

The restored historical sources `20261002203426` and `20261113152433`, and captured extra Reports/Fidelity/carrier statements, are **local baseline inputs only**. They are not in install.sql and must not be replayed.

Security changes are explicit: eleven private RLS-enabled, browser-inaccessible tables; the NOLOGIN/NOBYPASSRLS scope role; scoped public RPCs; preserved old bodies moved privately behind compatible wrappers; new immutable binding columns in the existing SMS ledger; reviewed disposition classification defaulting to unreviewed. No existing contact RLS policy is broadened. The four new migration files contain the complete schema delta.

## Frozen Edge packages

| Complete function package | Captured live version | verify_jwt (current → proposed) | Candidate source-manifest SHA-256 |
|---|---:|---|---|
| `twilio-sms` | 61 | false → false | `41f83e78926637a249681f99ffa4448576284aaeaa34251a225716ffbeb11735` |
| `workflow-executor` | 50 | false → false | `c96d4a8de9cdd8d6d471152a37d0d99203d74799135c5821d4aec1f71a4a53a0` |
| `sms-consent-worker` | 26 | false → false | `b6a1c29848e1bb22d655dbb501a27392434f38724a693323a74d4f0afb9a8a07` |
| `twilio-sms-webhook` | 47 | false → false | `652a3798c51875292d78ba2b843706079826fa200a6c726fa6f91fb31b5822cd` |
| `twilio-voice-inbound` | 72 | false → false | `dbc079f452f8231275d03220de94f308b1a90ab7a9da7d94f5d7eb35807b91bb` |

Digests above identify sorted source-file manifests, **not** Supabase EZBR deployment hashes. `manifest.json` contains every file hash, external import URL, current live EZBR digest and entrypoint. Each `edge-packages/<slug>/` folder contains the full recursive local import closure and config. Deploy complete packages, never a partial patch. Preserve `verify_jwt=false`; application-specific JWT/worker-token/Twilio-signature validation remains in code. No credential changes are included.

Compatibility consumer `clearpath-lead-alert` remains unchanged at captured version 25, EZBR `6d88feea6910dce56bb20cf3ca859e1da346c64257c22d44f697bf3731d44638`. Its complete independent deployed package is preserved and tested, but is not a deployment target. PR #429/#444 and automatic SMS enrollment are excluded.

## Frontend and all known deployment targets

The frontend source manifest is `3c819a2ae0f6abbc80c50502fbf853e3c1a092a339b614b29889dbaa9c90cbd1`. Build from the pinned source using the existing lockfile and authorized production environment; never upload the local synthetic test build.

| Vercel project | Project ID | Release implication |
|---|---|---|
| agentflow | prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc | Vite frontend; linked repository; main can affect this target |
| agentflow-life-insure | prj_PctERc2MEVcpKkYtBtQYc1ruunKb | Also linked to the repository; must be inspected and controlled in the same release |

Team: `team_iPboOWpwdIQRwdxmA5GJp5Rq`. Re-discover linked projects at preflight and stop if another target appears. Connector environment metadata returned403; the authenticated dashboard follow-up above now identifies the exact automatic-preview controls. Safe publication still requires the proposed pauses to be approved and saved. Do not push, open a PR or merge merely because local tests passed. No unknown workflow toggle, Supabase integration setting or Vercel environment change is authorized by this packet.

## Ordered release procedure, only after explicit approval and preconditions

1. Verify a safe publication path and inspect automatic GitHub/Supabase/Vercel jobs. Obtain any separately needed exact configuration approval. Re-read current main/Work Log/conflicting work; require executable source manifest equality. Re-fetch all five live Edge packages plus ClearPath independently and compare full bytes/config with the retained preimages. Re-read the six original DB function preimages, relevant grants/RLS and migration history. Stop on drift; do not overwrite newer work.
2. Review the six authenticated-definer advisor warnings and the new scope role with actual role evidence. Retain unrelated baseline findings. Confirm production table/index sizes and a suitable install window; retain 3-second lock and 60-second statement limits.
3. Through the approved authenticated production SQL release mechanism, execute **only the exact frozen install.sql transaction once**. Do not use an indiscriminate migration push, replay restored historical SQL, or independently record migration history a second time. On an ambiguous transport result, inspect exact history/postimages before any retry.
4. Read back all four version/name/statements records, the schema/security postimages and zero activation rows. Run live Supabase advisors. Stop if the postimages differ, a new unexpected advisor error appears, or any mode is unexpectedly enabled.
5. Deploy the five complete pinned Edge source packages in the listed order, preserving config. Verify each actual uploaded source/package version and authenticated health behavior before proceeding. Keep all sticky modes off.
6. Publish/review/merge the frozen frontend only through the separately approved safe path; observe both linked Vercel targets and their production source SHAs/build results. Re-test read-only UI/preview, fresh/cached-client failure behavior and absence of automatic provider traffic. Keep modes off.
7. Complete the pilot section below before any history seed or activation. Only after exact additional approval may the approved organization/cohort be reconciled, classifications/allowlist seeded, and modes enabled; then run only the named controlled recipients/numbers. Any unexpected write/send/scope issue invokes the protective rollback below.

## Pilot fields still required — activation remains blocked

- Verified Chris-agency organization UUID and exact approved cohort/fingerprint, with a fresh bounded history dry-run and explicit treatment of ambiguous/deleted/legacy/unresolved endpoints.
- Reviewed disposition **IDs** mapped to excluded/duration/confirmed. Names or contacted flags alone do not qualify. Proposed business classes: sold/callback/appointment confirmed; reviewed conversation duration-based; no-answer/DNC/voicemail excluded.
- Exact internal ClearPath actor, recipient, sender and key prefix if that existing alert will remain active in the pilot; no broad bypass or wildcard recipient.
- Current eligible number IDs/snapshots, account/service ownership and readiness; no implicit A2P registration, toll-free texting or provider membership change.
- Specifically authorized controlled recipient numbers/participants and exact call/text scenarios. No real recipients were selected by this build.
- Exact mode activation rows, order, observation interval, success criteria and responsible rollback scope. New-mode creation must wait for completed reconciliation; remaining agencies stay off.

These are release gates, not unfinished feature scaffolding. Choosing or activating real recipients without those values would exceed current authority. Keep this one packet as the approval record; do not create repeated approval requests for unchanged source.

## Protective rollback and readback

`release/guard_only.sql`: SHA-256 `22d8531a8d59f88f9dd2133d09e1410d8d41cb55ff8f9e0bb1b4b2a7125721e6`. In one approved transaction, set transaction-local `agentflow.sticky_release_org` to the exact affected approved UUID and execute this file. It sets **both voice and SMS to guard_only**, preserves pins, provenance, immutable history and prepared/attempting/uncertain dispatches, and never submits a message. Execute separately for each explicitly approved organization; never guess the scope. Native rehearsal proves preservation and refusal of unbound SMS.

Do not remove the durable enforcement marker, restore unprotected old DB bodies, clear identities, delete uncertain receipts or replay customer sends. Off/shadow/settings deletion cannot disable safeguards after first enforcement. Frontend rollback can hide controls but does not authorize backend fallback. Before first activation, keep all organizations off and diagnose any install defect without creating relationships.

`release/readback.sql`: SHA-256 `9bbcd5649a56d753a762ef2b24fecf40a08ed7541fe80b6b77d0421f9eeb7625`. `release/expected-postimages.json`: SHA-256 `f0d11438152187f12daadf7400548c1be4f10cccf579511898b1d014718ce71e`; compares schema/function/role metadata only, with synthetic fixture rows excluded. Save actual production version/source hashes, migration histories, advisor deltas and both Vercel deployment identities with the approved record.

## Approval wording for the frozen installation

> Approve the off-by-default Sticky Contact Numbers installation from source `a57ea11168fff51156b8d624b4966c10869d8dcd` using install.sql SHA-256 `7dddbdc515012a144829f5e089dcadf9831b57fc8c941250c460d69a04414578` and the five full Edge source-manifest hashes above, followed by the pinned frontend on both identified Vercel targets, **only after** the publication/isolation, drift, security and install-window preconditions are satisfied. Keep every sticky mode off. This approval does not authorize live history seed, disposition/allowlist seed, provider registration/policy changes, activation, test recipients or real calls/texts. Stop on unresolved gates or drift.

No approval has been assumed or executed. The supplied candidate is locally verified; full validation details, inherited failures, performance bounds and all 88 acceptance IDs accompany it.
