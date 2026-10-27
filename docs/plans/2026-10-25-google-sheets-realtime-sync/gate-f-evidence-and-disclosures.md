# Gate F evidence and proposed Google Sheets disclosure release

Prepared October 26, 2026 Pacific. Base main: d6902a95fa5f195f09bb08323637f13e05f111f2.
This document records verified evidence and the disclosure changes prepared in PR #494. Production publication and Gate G execution are tracked separately below.

## Verified production evidence

Pilot source: 2a9ce6b6-0500-454d-8c46-48dfab8042b5. Only this source is allowlisted.
Protected workflow google-sheets-pilot-release.yml, reviewed SHA above:
- E0 check: 40432446470 success.
- E1 schedule-maintenance: 40432690089 success.
- E2 record-schedule: 40433094915 success.
- E3 activate-pilot: 40433298534 success.
- E4 verify-active: 40433516660 success.
- Recovery pause-processing: 40435141007 success.
- Recovery resume-processing: 40435423696 success.

Four approved API fixtures (phone suffixes 0111–0114) imported once each, each with one source receipt, correct owner and assignment, no manual sync.
Single append request interval UTC: 2026-10-27T01:38:55.922Z–01:38:59.785Z.
Single receipt: 01:39:29.334944Z; Google delivery from request completion 28.143s; notification-to-receipt proxy 1406.944ms.
Burst append request interval UTC: 2026-10-27T01:40:10.514Z–01:40:14.592Z.
Three burst receipts: 01:43:40.082078Z; Google delivery from completion 204.067s; notification-to-receipt proxy 1423.078ms.
All four samples attributable to one authenticated queued event in their importing attempt; no catch-up attribution.
Four rows represent only TWO independent API write/notification samples. Observed maxima are not a population p95 guarantee.
Receipt timestamps are transaction-time proxies, not exact per-row physical commit times.
Attempt first-commit markers: 01:39:29.372Z and 01:43:40.132Z; attempts finished 01:39:29.570921Z and 01:43:40.281044Z.

Chris reported a successful manual-entry test. This is user-reported functional evidence; two controlled manual samples and manual-write latency timestamps have NOT been collected.

Recovery fixture 0117 appended at 01:54:22.708Z–01:54:26.676Z, after pause and zero running/queued work.
At 01:55:08Z: one authenticated queued notification, requested_seq=7, processed_seq=6, zero fixture leads.
Resume flag verified at 02:00:55.136075Z. Receipt at 02:01:02.425282Z.
Exactly one lead/receipt, correct owner/assignment, one completed push run, outcome done/imported=1/errors=0.
Sequence advanced 6→7; requested_seq=processed_seq=7; queued Sheets HTTP requests=0.
All three fixed original leads, receipts and ledger rows still match every-column baseline hashes.

## Renewal drill completed

Both protected stages were explicitly approved and passed GitHub environment review:
- renewal-window: run 40444405736, job 121992116732, success.
- restore-renewal-window: run 40444673754, job 121992996922, success.

Replacement reason=renew channel activated 2026-10-27T03:31:04.658695Z (October 26, 8:31 PM Pacific), generation 1, expiration 2026-10-28T03:31:04Z.
Old channel entered stopping at replacement activation; next_stop_at=03:46:04.658695Z, preserving the full 900-second overlap.
Old channel reached stopped at 03:47:00.991301Z (8:47 PM Pacific), with zero failed stop attempts. The deployed stop path records this after Google returns 2xx or 404 (already gone); the database does not retain which successful response occurred. It had not expired, and last_error_code remains the prior superseded marker.
Replacement remained active at 03:47:13.510312Z; observed channel timestamps show no coverage gap.

Normal renew_before_s=10800 was restored at 03:43:50.263740Z, before old-channel stop. Mode remains pilot, cap 4, overlap 900, grace 3600.
Protected restore checks passed: SQL/migration checksums, all 75 function postimages and ACLs, RLS, deployed Edge bundles, fresh credential digests against Vault marker, exactly Pilot B allowlisted, guarded maintenance/no polling, migration history and original records.
Read-only verification at 03:45:41Z found no pending targets, running attempts, queued Sheets HTTP requests or attempts since the renewal drill began. Original leads, receipts and ledger rows matched all fixed baseline hashes.
No expiry forgery, credential rotation, extra synthetic leads, polling or rollout occurred.

## Exact proposed disclosure copy

Target: src/content/legal.ts. Preserve unrelated Gmail/Calendar, A2P, provider, retention and contact language.
Set publication effective/reviewed date to the actual approved publication date (not this preparation date).

Replace the Sheets paragraph beginning "For each spreadsheet tab you enable" with:

"For spreadsheet tabs you enable, AgentFlow can use Google's change notifications to check for new rows in the background, including while you are signed out. Automatic monitoring is available only where enabled; check the monitoring status and last successful sync in Google Sheets settings. Notifications can be delayed or may not arrive, including for changes made by other apps or APIs. AgentFlow does not check spreadsheet contents on a fixed interval or guarantee immediate imports. You can use Sync Now to request a check. By default, only rows added after you enable a sheet become leads; the rows already in the sheet at that time are recorded so they are not imported. When you enable a sheet, you can instead choose to also import the rows already in it."

Add after that paragraph:

"AgentFlow registers and renews monitoring subscriptions for selected spreadsheets and stores subscription identifiers, expiration times and synchronization event records to operate and troubleshoot automatic imports. Google change notifications identify a change; AgentFlow then reads the selected spreadsheet using your authorization. Pausing or removing a sheet stops automatic imports for that source. Disconnecting Google Sheets stops automatic imports for that connection. A spreadsheet's monitoring subscription may remain active if another enabled tab uses it, and notifications or work already in progress may take time to settle."

In the controls section replace only "stops checking all of your sheets" with "stops automatic imports from all of your sheets".

In Terms / Google and other integrations, add:

"Where enabled, automatic Google Sheets imports depend on Google's change notifications and service availability. Notifications may be delayed or absent, including for changes made through other apps or APIs. Automatic import timing and delivery are not guaranteed. Review the last successful sync and import results, and use Sync Now when needed."

Keep selected-file access, read-only spreadsheet behavior, existing import choices, duplicate/agency access rules and retained imported leads unchanged. Do not claim verified Google status or a new OAuth scope.

## Implementation and release plan

1. Apply only the above text replacements to src/content/legal.ts; update publication date on approval and WORK_LOG.md.
2. Typecheck and run existing relevant legal checks; verify rendered Privacy and Terms in a preview.
3. Obtain approval of exact PR head for separate legal publication. Merge/deploy only then and verify production copy.
4. Gate F renewal evidence is complete; the manual-test evidence limitation remains. Chris accepted this limitation on October 26, 2026; no further controlled manual samples are required for this rollout.
5. Prepare a separately reviewed protected Gate G expansion operation with exact eligible-source inventory, before/after fingerprints and rollback. Re-inventory immediately before expansion.
6. Do not enable all users from this preparation or the legal release. No current Gate E runner stage implements broad rollout.

## Owner decision and final implementation plan — October 26, 2026 Pacific

Chris accepted the recommendation to accept current testing limits, finish disclosures, and proceed to full rollout: “Agreed. Let’s continue and finish this for full rollout.” Gate F is accepted with the two independent API notification samples and user-reported manual success; no additional timing samples or statistical p95 claim are implied.

Files in this disclosure release: `src/content/legal.ts`, this evidence file, and `WORK_LOG.md`. Apply the exact copy above, date October 26, 2026, and preserve all unrelated sections. Validate TypeScript, existing relevant tests, build and rendered Privacy/Terms.

Separate Gate G package: new dispatch-only protected workflow and runner, fixed source/config fingerprint and original record baseline, mode-only pilot→on operation, read-only check/verify stages and emergency stop using the established rollback. Current inventory has only Pilot B; mode on also admits future user-enabled sources subject to unchanged owner, connection, health and receipt checks. No automatic account connection, sheet selection, source-state change, synthetic write or polling. Recheck inventory in the write transaction; refuse drift. Publish and verify disclosures before Gate G activation. Keep required GitHub environment approval.
