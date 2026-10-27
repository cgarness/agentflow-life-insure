# Gate E — Pilot B activation package

Prepared 2026-10-27 UTC. Preparation approved; production actions NOT approved or executed.
Base: main 3bc4a4b64878ce010986be6e1998dfcc3d650381. This is a tooling-only PR:
no application, Edge function, applied migration, policy or permission change.
The final PR head and its eventual merge SHA identify the reviewed package.

## Current evidence

- Gate D check: run 40427552977 attempt 2 passed; configure-secrets: 40428546001 passed.
- Fresh production verification: head 20261025120000, 347 migration rows,
  57 recorded push statements, statement SHA-256
  0561e767049e118b1cf53d9e51e2ec69a8eab5069bee82592e724535db5b79ff.
- 75 Sheets functions: private 44/public 31; digest 6e8c43651043ce83254dcec092505cd6.
  ACL violations 0, RLS tables 12, own-read policies 3; every release verification boolean true.
- Mode off, cap 4, renewal 10800s, overlap 900s, late grace 3600s.
  All five push tables empty; no Sheets cron; pg_net queue empty.
- Existing data fingerprint:
  1|1|3|3|3|2|98aae47446d6778fb467f78b78023b3f.
- Vault: exactly one push token, verified-v1 marker format valid.
  Full current Edge/Vault binding is rechecked by the protected runner before each forward action;
  the connector cannot retrieve the GitHub environment secret or current Edge secret digests.
  Do not confuse today's marker-format check with the full binding verification from Gate D.
- All six Sheets Edge functions ACTIVE with verify_jwt=false; bundle hashes captured in
  gate-e-edge-baseline.json. Versions: worker/OAuth 7, API 8, push/maintenance 2.
- GitHub environment inspected: required reviewer cgarness, main branch only, admin bypass disabled.
  SUPABASE_ACCESS_TOKEN last updated October 26, 17:42 PDT; no replacement or rotation performed.
- Fixed-id all-column MD5 baseline captured at 2026-10-27T00:56:24.826272Z:
  three leads, their three receipts and three done ledger rows. Aggregate lead MD5
  5263f79719315b72c7b162b5e4411d9e. Requery originals_unchanged=true.
  These are database row serialization fingerprints, not a physical storage-byte checksum.

## Exact target and test data

Source: 2a9ce6b6-0500-454d-8c46-48dfab8042b5.
Organization: a0000000-0000-0000-0000-000000000001.
Connection: ad9b771e-2dd0-45fb-be5d-46a87ce54d57, connected generation 1.
Source: enabled / ok / steady / row_position / config version 2.

Google Drive metadata and a single header read confirmed:
spreadsheet 1KJGUykGZLLeKDLiuWBOIIdzECBJGm-jd7XykvXHgqtg, title AgentFlow Sheets Pilot B,
tab Leads, sheetId 1727565395; A:E = First Name, Last Name, Phone, Email, State.
No sheet was modified. Inspect the tail immediately before the approved append;
never overwrite/reorder/delete the original rows.

| Group | Last name | Phone | First name | Email | State |
|---|---|---|---|---|---|
| API single | PushApi-E20261027-01 | 702-555-0111 | Pilot | blank | NV |
| API burst (3 in one call) | PushApi-E20261027-02 | 702-555-0112 | Pilot | blank | NV |
| API burst | PushApi-E20261027-03 | 702-555-0113 | Pilot | blank | NV |
| API burst | PushApi-E20261027-04 | 702-555-0114 | Pilot | blank | NV |
| Manual single | PushManual-E20261027-01 | 702-555-0115 | Pilot | blank | NV |
| Manual single | PushManual-E20261027-02 | 702-555-0116 | Pilot | blank | NV |
| Paused-processing recovery | PushApi-E20261027-05 | 702-555-0117 | Pilot | blank | NV |

All seven phone numbers are absent from the home organization's leads at preparation time.
Recheck collisions before writing; stop on any collision. The connected ChatGPT Google Drive integration
writes the API rows with appendCells, sheetId 1727565395, fields=userEnteredValue.
No AgentFlow Google write scope or service account is introduced. Chris types the two manual rows.
Do not run Sync Now during measurement. Ordinary lead-created workflows remain in force; inspect their
applicable rules before approved test creation, and stop if a test could message a real recipient.

## Checksums and migration ordering

gate-e-checksums.json pins the complete SQL bytes, Gate D helper workflow, baseline and Edge inventory.
The original applied migration and rollback are byte-identical to the Gate D reviewed package:

| File | Bytes | SHA-256 |
|---|---:|---|
| 20261025120000_google_sheets_push_sync.sql | 80739 | 2774557acaf98db80fc169f6ed502003d8533ea13a08ebeefdf18657aefa609d |
| pending/20261025120100_google_sheets_push_maintenance_schedule.sql | 2639 | 2db0a82a52bc591f4f2530ce659ea6b5b406c5322ecb5951bbb6bb628e6283f3 |
| google_sheets_push_pilot_enable.sql | 1970 | 4ae2f6f7bd4cbbaed09d24c572e78f306cad6a74e37e3053fba45994b94194fe |
| google_sheets_push_stop_all.sql | 1747 | f049e5df94b38e40f5a01a45e62708625c25ddb5a67444880317d6606aa64aba |
| google_sheets_push_unschedule.sql | 863 | 7672b3c2fb80e603d9bec58a457e8f99a4948b813dbfe74fa13c168a244454f7 |

20261025120100 sorts after the current hosted head; do not re-stamp unless the head advances.
The runner stops on head or history-count drift. It does not run db push, apply_migration, or the
pending five-minute poll. Existing SQL files remain immutable in this PR.

## Protected execution

Workflow: .github/workflows/google-sheets-pilot-release.yml.
Manual dispatch only, main only, same google-sheets-production environment and concurrency group as Gate D.
Each dispatch requires stage, confirm equal to stage, reviewed_sha equal to the full dispatch/main SHA.
Checkout uses that immutable SHA. No user input is interpolated into a shell command.
psql 16, Supabase CLI 2.121.0; pinned actions. Database TLS and role checked.
No secret/error body logging, no automatic retry or rollback after a partial failure.
The verified push credential set is read/validated only; it is never rotated.

After merging the reviewed tooling and passing CI, bind the following dispatches to the resulting merge SHA:

| Order | stage = confirm | Exact effect |
|---|---|---|
| E0 | check | Read-only state, schema, original rows, secret binding, function bundle and file checks |
| E1 | schedule-maintenance | Apply ONLY the pinned pending schedule in one transaction; mode remains off and all push tables empty |
| E2 | record-schedule | History-only CLI repair for 20261025120100; verify exact single statement, name, head and 348 rows; no SQL replay |
| E3 | activate-pilot | Apply pinned pilot SQL, verify exactly one allowlist row, then set only GOOGLE_SHEETS_PUSH_ENABLED=true |
| E4 | verify-active | Read-only verify live Google-confirmed unexpired channel, credentials, defaults and original rows |

E1's guarded cron ticks once a minute but issues HTTP only if maintenance_due is true.
It does not poll spreadsheet content. While mode is off and no work exists, it is inert.
E3 permits registration on the next due tick and the first-watch catch-up. This catch-up can
import any new rows already appended to Pilot B; confirm the sheet still contains only the original
three rows before E3. If it differs, stop and review before activation.

Wait for an active channel and initial catch-up to settle before any measurement sample.
Check one live target, intended source only, no unexpected imports, queue drained, original fingerprints
unchanged. If registration fails, do not insert synthetic leads: inspect the sanitized code and stop.
Do not treat successful E3 as proof that Google accepted a watch; only E4 plus evidence does that.

## Test sequence and latency evidence (separate test approval)

1. Capture API call start and completion UTC timestamps to the second and returned appended range.
   Retain both endpoints: the server write lies within this interval; do not call local completion time
   an exact server timestamp. Wait for queue/catch-up quiescence before each independent sample.
2. Append API single, observe through read-only SQL. Observe up to 10 minutes without Sync Now.
   If no qualifying notification/import arrives, record failure and STOP before further API tests.
3. Append the burst of three in one call; same write-time interval for all three.
4. Chris types each manual row completely, one at a time; record approximate completion time and uncertainty.
5. Run supabase/ops/google_sheets_pilot_latency.sql with samples JSON containing phone, kind, written.
   It reports counts, importing push run, attempt and eligible event candidates; p50/p95/max by kind.
   It uses each row's receipt timestamp, not the attempt's first commit for every burst row.
   Receipt created_at is a transaction timestamp proxy; report first_commit_at/attempt completion alongside
   it when assessing actual commit timing. Do not claim sub-second commit precision from receipt time alone.
6. Google supplies no row correlation ID. Only an authenticated queued event in the importing attempt's
   sequence interval, after write and before receipt, with no catch-up, qualifies. Multiple candidates,
   catch-up, null/negative times or missing receipts are UNMEASURED, not a latency pass.
7. Report all expected samples, missing/duplicate counts and measured denominator. Four API and two
   manual samples are smoke evidence, not a statistically strong p95 guarantee.
8. Re-run fixed-id originals SQL after every batch. Each fixture must have exactly one lead, one Pilot B
   receipt, correct ownership and a push import. Never change/delete originals or receipts for cleanup.

Acceptance proposal for Gate F: all API/manual samples imported automatically, zero duplicates,
all original hashes unchanged, Google p95 <=300s and notification-to-receipt proxy p95 <5000ms.
Gate F decides thresholds and rollout; absent Google notification never authorizes polling.

## Renewal and recovery drills (separate production-action approval)

- Natural renewal: observe through at least one complete 24-hour lifetime with default 10800s lead time,
  900s overlap, old channel stopped, new channel active. Do not create a ChatGPT automation as part of preparation.
- Forced renewal: after a channel has <=23h and >15m remaining, run renewal-window to set only
  renew_before_s=82800. Wait for one replacement; immediately run restore-renewal-window to restore 10800.
  Observe 900-second overlap and eventual channels.stop. Never forge expires_at, resource IDs or notifications.
  At 24h lifetime the forced drill cannot happen immediately: the schema caps the window at 23h.
- Recovery: pause-processing deletes only the push-enabled flag while mode stays pilot and receiver acceptance
  stays active. After in-flight work settles, append ONLY fixture 0117. Prove an authenticated event queued,
  requested_seq>processed_seq and no receipt; resume-processing restores the flag. Confirm maintenance drains
  that notification into exactly one lead without Sync Now. If it imported before pause took effect, the drill is
  inconclusive; do not silently create more rows.
- These workflow stages require exact confirmation and environment approval like activation.

## Rollback, including partial activation

Prepared, not executed:

1. stop-monitoring applies the checksum-pinned stop-all SQL: mode off blocks new admissions and live channels
   become stopping/abandoned. This stage deliberately does not depend on good lead hashes or credential
   binding; a failed integrity/credential check may be the reason to stop.
2. Keep the maintenance job and credentials so Google channels.stop can complete even with mode off.
   Inspect channel states and sanitized errors. Retry failures only after independent diagnosis and approval.
   An abandoned channel with unknown resource ID may still deliver until expiry; it cannot import with mode off.
3. When no registering/active/stopping channels remain, finish-rollback unschedules ONLY the maintenance job
   and deletes ONLY GOOGLE_SHEETS_PUSH_ENABLED. It preserves the verified credential set, history, source
   intent, leads, receipts and ledger. The applied schedule history row remains an audit of the application;
   unscheduling is an explicit operational rollback, not a false claim the migration never ran.
4. Query google_sheets_drain_check.sql twice at least 2 minutes apart: no active Sheets backend or queued
   worker/maintenance request; stable receipt/lead/run/ledger/target/attempt markers. Leases alone prove nothing.
   Late accepted notifications may still queue; report them and mode off, never claim all activity vanished.
5. Level-2 rollback preserves manual Sync Now. Full foundation admission closure is a stronger, separately
   approved operation (google_sheets_admission_close.sql), needed before claiming the drain script's full
   wrappers_executable=0 shutdown predicate. Do not invoke that stronger rollback automatically.
6. Any continuing imports, changing data markers, channel-stop failures or uncertain queue drain are BLOCKED,
   not a successful shutdown. Preserve all evidence and stop further writes.

Failure recovery: if schedule applied but history was not recorded, inspect job command and history independently;
record-schedule can run only with exactly the expected job, original off state and no history row.
If pilot SQL committed but flag write failed/unknown, do not retry activate-pilot; use independent inspection
and an approved stop-monitoring rollback. No stage rotates credentials or rewrites a verified set.

## Validation and limits

- 16 offline runner checks pass (including fail-before-write and partial-failure controls).
- Workflow YAML parses; file hashes verified.
- Fixed-id originals SQL executed read-only against production: true.
- Latency SQL executed read-only with a reserved absent sample: zero leads/imports/measurements, no false pass.
- New production mutation stages have NOT been executed. PR CI validates the candidate; real registration,
  notifications, renewal and recovery remain Gate E evidence to collect after exact approval.
- No production workflow dispatch/run ID exists for this package yet. No monitoring, job or test lead created.
- Privacy/Terms release remains mandatory before Gate G; broad rollout is not included.

## Approval request

Approve merging the reviewed Gate E tooling PR (which triggers the existing frontend integration), then E0–E4
through the protected workflow at that merge SHA: exact guarded maintenance schedule, history-only record,
Pilot B-only database mode/allowlist, push Edge flag, first-watch catch-up, and read-only verification.
GitHub's required environment approval remains necessary for each dispatch.

Separately approve the named seven fixture rows, API/manual timing procedure, pause/resume and paired renewal
drill before those actions. Approving activation alone creates no synthetic leads and authorizes no broader rollout.
