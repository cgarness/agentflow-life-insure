# Gate F evidence and proposed Google Sheets disclosure release

Prepared October 26, 2026 Pacific. Base main: d6902a95fa5f195f09bb08323637f13e05f111f2.
This document records verified evidence and exact proposed copy. It changes no live policy, code, settings, credentials or rollout scope.

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

## Renewal still outstanding

At 02:04:23Z, one active activation channel expires 2026-10-28T01:35:03Z.
Default renewal lead time 10800s; overlap 900s.
Natural renewal eligibility: October 27 around 3:35 PM Pacific; old-channel stop expected after overlap, subject to maintenance completion.
Accelerated drill eligibility: October 26 at 7:35:03 PM Pacific (<=23h remaining), not yet eligible at observation.
Separately approve BOTH protected stages:
1. renewal-window: only renew_before_s 10800→82800.
2. Immediately after a Google-confirmed replacement: restore-renewal-window, 82800→10800.
Then observe the full 900-second overlap and successful stop of superseded channel, with no gap, unexpected catch-up, errors or original-row changes.
No expiry forgery, credential rotation, extra synthetic leads, polling or rollout.
Do not leave accelerated renewal enabled after replacement. Both stages require GitHub environment approval.

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
4. Gate F remains pending renewal and the manual-test evidence limitation. Owner must explicitly accept evidence/thresholds or authorize additional controlled manual samples.
5. Prepare a separately reviewed protected Gate G expansion operation with exact eligible-source inventory, before/after fingerprints and rollback. Re-inventory immediately before expansion.
6. Do not enable all users from this preparation or the legal release. No current Gate E runner stage implements broad rollout.
