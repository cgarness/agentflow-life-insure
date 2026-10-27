# Gate G full availability — implementation and execution plan

Chris accepted Gate F limitations and requested full rollout on October 26, 2026 Pacific.
Separate prerequisite: PR #494 publishes accurate Sheets disclosures; verify production before activation.

## Scope
Current production has one connection and one source, Pilot B, enabled/healthy/eligible, generation 1/config 2.
Mode `on` makes monitoring available for all current and future sources users explicitly enable, subject to existing permission, ownership, connection, health, identity and receipt guards. It does not connect accounts, select files, enable paused sources or import excluded baselines. Future establishment can queue the already-approved event-driven catch-up. No polling, synthetic lead, schema, function, secret, cron or concurrency change.

## Files
New `google-sheets-rollout-release.yml` protected dispatch workflow; `google_sheets_rollout_release.py` and tests; mode-only activation SQL; checksum and fixed-record baseline manifests; tooling CI; this plan and WORK_LOG.
Reuse unchanged Gate D/E verification helpers, byte-pinned in the new manifest. Keep workflow concurrency `google-sheets-production`, main-only, exact reviewed SHA and stage confirmation, required production-environment review and no automatic retries.

## Stages
1. `check`: verify SQL/function/ACL/RLS/migration/cron/Edge/credential integrity, pilot default settings and fixed source/config/lead/receipt/ledger fingerprints. Read-only.
2. `activate`: same preflight; within one bounded transaction lock source/connection and baseline tables against drift, recheck exact current source and existing record fingerprints, change only config.mode pilot→on. Preserve cap=4, renewal=10800, overlap=900, grace=3600, pilot allowlist and live watch. Verify mode and original records afterward.
3. `verify`: read-only general mode, deployed integrity, current eligible source coverage and processing/backlog/error summary; no test leads. Later new user sources are allowed, so do not require initial inventory forever.
4. Emergency `stop-monitoring`: established mode-off/channel-stop SQL. Keep maintenance while Google stop completion and in-flight processing settle. Existing Gate E `finish-rollback` can unschedule only once channels are terminal; independently verify drain and markers twice two minutes apart. No lead/receipt/baseline deletion or credential rotation.

## Approval and observation
Exact reviewed main SHA and explicit environment approval required for execution. Legal release must precede activate. Read-only checks can run independently. Refuse any inventory/baseline drift instead of silently refreshing the approved target set. Record actual run IDs and production results. Activation is general availability, not proof of imports from accounts users have not connected.

## Validation
Offline runner tests for stage/SHA guards, checksum tampering, no import-time effects, read-only verification, fail-closed preconditions and emergency independence. Existing Gate E tooling tests, TypeScript and YAML validation. Existing deployed importer SQL/Edge behavior is unchanged.

## Explicit pending exceptions
The original plan also called for a natural 24-hour renewal observation and a Google quota increase before Gate G. Neither is completed. Proposed owner decision: proceed on successful accelerated renewal/recovery evidence, defer natural-cycle observation and quota expansion, retain cap 4. This is NOT recorded as approved or passed. Activation requires the exact release-decision input after owner acceptance.

Validation so far: 16 existing pilot runner tests and 4 rollout guard tests pass; Python compiles; TypeScript passes. Full SQL execution tests and preview verification remain pending. This package is a draft, not execution-ready.

## Transaction validation update
PGlite PostgreSQL execution passed valid activation with rollback and refused four negative cases: already-on mode, changed source config, missing receipts and changed lead data. This found and fixed a SQL three-valued-logic bug: the transactional guard now uses IS DISTINCT FROM TRUE so NULL refuses execution. This isolated fixture is not managed-production concurrency proof. Production runner retains 5-second lock/30-second statement timeouts. Gate G guard tests are now included in tooling CI.
