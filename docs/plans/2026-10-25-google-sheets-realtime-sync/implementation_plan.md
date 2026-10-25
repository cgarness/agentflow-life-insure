# Google Sheets real-time sync (Drive push notifications) — implementation plan

**Status: GATE A APPROVED (2026-10-25, "#APPROVE_PLAN", plan at `540e333`); GATE B BUILT on
`claude/modest-knuth-y5cqor` (draft PR, stopped at Gate C; evidence in `verification.md`).** Nothing is applied,
deployed or enabled. Production stays read-only: no merge,
production migration, Edge deploy, secret, live Google watch, monitoring activation, RLS or data change, and no
synthetic production lead. Each of those needs its own approval. §17 records the approved decisions and the
refinements they require, and **§17 supersedes the earlier sections wherever they differ**. Every production
observation in this plan came from read-only queries (`SET TRANSACTION READ ONLY`) and Edge Function read-backs.
Base: `main` `27c8d0d`.

**Goal.** A new valid row in a connected spreadsheet becomes an AgentFlow lead automatically, driven by Google
Drive change notifications (`files.watch`). Agents never press Sync Now, keep AgentFlow open, stay signed in,
configure Zapier or write Apps Script. There is **no recurring spreadsheet polling**.

**What "real time" can mean here.** Google sends a *signal* that a file changed, not the row. We then read the
sheet through the existing importer. Our part (notification received → lead committed) is designed for
**< 5 s** and is measured. Google's part (row written → notification sent) is outside our control and is
measured separately. One public report says Google coalesces Sheets change notifications to roughly one every
~3 minutes after the first one (§1.5). If that holds, end-to-end latency for bursts of rows will be
Google-bound. The pilot (Gate E/F) measures it; nothing in this plan promises instant imports.

---

## 0. Decisions for Chris (answer at Gate A)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Where the import runs after a notification is acknowledged | In the receiver, through `EdgeRuntime.waitUntil` once the notification is durably queued. This is the lowest-latency path and the repo already uses it in `twilio-voice-status` and `twilio-voice-inbound`. A maintenance cron is the recovery path. |
| D2 | **Event catch-up reads.** Read the sheet once when monitoring is (re)established (Enable, Resume, a reconnect, recovery of a failed channel) and after a mapping save or review apply. Today these actions set `next_sync_at = now()` for a poller that will never run. | Yes. Each read is tied to one user action or one lifecycle event; none is periodic. Without them, rows added while a channel was missing would wait for the next unrelated edit. |
| D3 | Maintenance schedule | `pg_cron` every minute. It sends an HTTP request **only** when `private.google_sheets_push_maintenance_due()` is true: channels to register, renew or stop, or queued notification jobs that are due for retry or recovery. It never reads a spreadsheet without a queued job. |
| D4 | `verify_jwt` on the two new functions | Both `false`. The receiver must be `false` because Google sends no Supabase JWT. Maintenance follows the repo's cron pattern (`uv-profile-sync-worker`, `sms-consent-worker`, `platform-admin-notify`) and invariant #2, with a constant-time Vault bearer token. **Your brief says "`verify_jwt=false` only where required for Google callbacks", so please confirm maintenance explicitly.** |
| D5 | How the UI reads monitoring status | Through the existing service-role `status` action. No new RLS-readable table; every new table is in `private`. |
| D6 | Notifications for unknown or malformed channels | Rejected, with a structured log line only. No tenant row, because there is no tenant, and no org-less table. Rejections on a *known* channel (bad token or resource) are recorded with that channel's `organization_id`. |
| D7 | Pilot scoping | `GOOGLE_SHEETS_PUSH_MODE=pilot` plus `GOOGLE_SHEETS_PUSH_PILOT_SOURCES=<Pilot B source id>`. This is enforced in the Edge code **and** passed into the SQL claims. Mode `on` is Gate G. |
| D8 | Who writes the pilot's synthetic rows | A separate test-writer Google identity: your own `gcloud` ADC on your Mac, or a service account shared on Pilot B only. **Never AgentFlow's production token**: the published privacy policy says AgentFlow does not change your spreadsheets. |
| D9 | Privacy/Terms | `src/content/legal.ts` says AgentFlow "checks for new rows in the background about every five minutes". That copy must change in a **separate reviewed release** before Gate G (§13). |
| D10 | How production steps run at Gate D | The migration goes through the same protected-runner pattern as Phase B (exact bytes, history read-back). Functions deploy with complete bundles, followed by a `get_edge_function` byte-for-byte read-back. Decided at Gate D. |
| D11 | Production already moved past the last WORK_LOG entry (§1.3) | Confirm that the 2026-10-24 Pilot B activation and its two manual syncs were your Phase D tests. The plan treats them as the baseline: the Gate E catch-up must re-import **none** of those rows. |

---

## 1. Phase 0 findings

### 1.1 Repository and conflicting work
- I read AGENT_RULES §1–§11 and the Google Sheets lead import invariant (including the Picker rules), VISION, and
  the newest WORK_LOG entries.
- The newest work is the hierarchy Gate 2c closeout, which does not touch Sheets.
- The Picker bugfix (#489) is merged on `main` as `86e0010`.
- Open PRs:
  - #480 and #481 are docs-only Sheets release records. Their only overlap is the newest-first inserts in
    `WORK_LOG.md` and `implementation_plan.md`.
  - No other open PR touches `supabase/functions/*google-sheets*`, `_shared/googleSheets`, the Sheets
    migrations or `src/**/google-sheets`.
  - **No conflicting work.**
- The current Sheets implementation:
  - **Engine:** `engine.ts` (`runSource`), `identity.ts`, `mapping.ts`, `google.ts`, `oauth.ts`, `db.ts`.
  - **Functions:** `google-sheets-api`, `google-sheets-oauth-start`, `google-sheets-oauth-callback`,
    `google-sheets-sync-worker`.
  - **Foundation migration:** `20261022062539`, SHA-256 `fc68da86…efed`, which equals the approved bytes.
  - **Pending cron:** `pending/20261013120100_google_sheets_sync_schedule.sql`, SHA-256 `6116f414…9665`. **It stays
    unapplied and byte-identical.**
  - **Ops files:** `supabase/ops/google_sheets_*`.
  - **Tests:** `supabase/tests/google_sheets_*`, `scripts/run_google_sheets_*`, `scripts/google_sheets_e2e.ts`,
    `scripts/tests/google-sheets-ui/verify.mjs`.
  - **CI:** `.github/workflows/google-sheets.yml`.

### 1.2 Invariants this design must preserve (from the code, not only the docs)
- **Claims.** `google_sheets_claim` has two paths:
  - **Scheduled** (`p_source` NULL): due sources by `next_sync_at`. This is the poller; it stays unscheduled.
  - **Manual** (Sync Now): owner-checked, with a **30-second cooldown** on `last_checked_at`.

  Push needs its own explicitly authorized claim (§5.4), not repeated Sync Now calls.
- **Finish.** `google_sheets_finish` accepts only `p_trigger IN ('schedule','manual','activation')`, and
  `google_sheets_sync_runs_trigger_check` pins the same three values. Push adds `'push'` to both (§5.6), behind a
  preimage guard.
- **Write guard.** `lock_for_work` locks the source `FOR UPDATE`, then the connection `FOR SHARE`. It checks lease,
  config version, state and health, connection status and `auth_generation`, owner match and owner eligibility on
  the real clock. **Unchanged.** It stays the authority for every write.
- **Ingest.** Receipts are written in the same subtransaction as the lead. The receipt unique key and the Sheets
  advisory lock prevent duplicates. **Unchanged.**
- **Finish semantics.** `finish` writes status, history and `last_success_at` only when it returns `completed`. A
  non-completed finish releases only its own lease. **Unchanged.**
- **Function inventory.** 31 private + 21 public = 52 functions, pinned by T1. It will grow (§5) and T1 is updated
  together with it.

### 1.3 Live production state (read-only, 2026-10-25 ~01:30 UTC)
- **Migration history:** 346 rows, head `20261024045812`. A new migration must sort after it and is re-stamped at
  Gate D.
- **Edge Functions:** the four Sheets functions are ACTIVE at API version 6 with `verify_jwt=false`. Their
  `created_at` and `updated_at` are both 2026-10-22 16:17 UTC (Phase B), so they have not been redeployed since.
  - `google-sheets-sync-worker` and `google-sheets-api`: every file in the live bundle is **byte-identical** to
    this repo.
  - `oauth-start` and `oauth-callback` were retrieved and reviewed; their content matches the repo.
- **Database:** 31 private + 21 public Sheets functions. Sheets cron jobs: none, out of 13 jobs. Vault holds one
  Sheets secret, a refresh token; there is no worker token.
- **Not in the WORK_LOG:**
  - one Google connection in the home org, `connected` since 2026-10-24 16:54 UTC (generation 1, scopes
    `openid email drive.file`);
  - **one enabled source, "AgentFlow Sheets Pilot B – Leads"** (row-position mode, include existing, activated
    22:45 UTC);
  - two `manual` sync runs (2 imported, then 1);
  - 3 receipts and 3 leads, each with the correct org and assigned agent;
  - 3 ledger rows, all `done`.

  So the backend flag must already be on. I cannot read Edge secrets, so this is inferred. See D11.
- **Extensions:** `pg_cron` 1.6.4, `pg_net` 0.19.5 and `supabase_vault` are installed. `pgmq` 1.5.1 is available
  but not installed. Postgres is 17.6.
- **Preimages for the guarded replacement:**
  - `md5(pg_get_functiondef(private.google_sheets_finish))` = `f1cf66bea7de1d469e2ff03c57f1a414`;
  - the claim's md5 is `aedc1364…` (unchanged by this plan);
  - the public wrappers' ACL is `{postgres=X, service_role=X}`.

### 1.4 Google API facts used (source quality labeled)
**Official: Drive v3 discovery document (`www.googleapis.com/discovery/v1/apis/drive/v3/rest`, revision 20261020).**
- `files.watch` is `POST files/{fileId}/watch`.
- `channels.stop` is `POST channels/stop`, and its body is a `Channel`.
- **Both accept `https://www.googleapis.com/auth/drive.file`. No broader scope is needed.**
- `Channel` fields:
  - `id`: "UUID or similar unique string";
  - `token`: an arbitrary string delivered with each notification;
  - `expiration`: Unix ms;
  - `resourceId`: "opaque … stable across API versions";
  - `resourceUri`: version-specific;
  - `type`: `web_hook`.

**Official push guide (developers.google.com is blocked here, so these come from search snippets of the guide).**
- The address must be HTTPS with a valid, trusted certificate.
- The channel id is echoed in `X-Goog-Channel-ID`.
- File states are `sync` / `add` / `remove` / `update` / `trash` / `untrash`.
- `X-Goog-Changed` is `content` / `parents` / `children` / `permissions`.
- A `sync` message starts each channel, and "it's possible to receive the sync message even before you receive the
  watch method response".
- Message numbers increase but **are not sequential**, and `sync` is always 1.
- There is no automatic renewal: renew by watching again, and expect overlap.
- `X-Goog-Channel-Expiration` and `X-Goog-Channel-Token` are present when set.

**Secondary or from memory — re-verify at Gate D.**
- File-channel maximum expiration is 86,400 s (1 day); the default is 3,600 s.
- Channel id is at most 64 characters; token at most 256.
- Google retries `500`/`502`/`503`/`504` with exponential backoff and treats other non-2xx answers as failures.

The design does not depend on these exact values. It stores the expiration Google *returns* and uses 43-character
ids and tokens.

**Default Sheets API quota (re-verify).** 300 read requests per minute per project, and 60 per user per project.
This is the binding scale limit (§12).

### 1.5 Do manual edits and Sheets API writes produce notifications? (Phase 0 item 8)
**Not verifiable from this container.** Verifying it needs a real channel on a real file, which is Gate E.

**Evidence.** Drive treats a Sheets edit as an `update` with `X-Goog-Changed: content`. In
`googleapis/google-api-go-client#444` (2020), a commenter wrote that "Drive [does] push updates for sheets but changes are
coalesced and only sent around every 3 minutes or so". API writes (`values.append`) change the file's content the
same way UI edits do, so both should notify, but this is **unconfirmed**.

**Stop rule (from your brief).** If API-written rows are not reliably notified at Gate E, I stop and report. I do
not substitute polling.

---

## 2. Architecture

```
Google Sheet change
  └─► Google Drive files.watch channel  (one per connection × spreadsheet; overlap only during renewal)
        └─► POST https://<project>.supabase.co/functions/v1/google-sheets-push   (verify_jwt=false)
              1. header shape + HMAC-tagged channel id pre-check (no DB for forgeries)
              2. google_sheets_push_accept(): channel lookup → constant-time token digest → resource id →
                 state / expiry / generation → dedupe (channel, message#) → target.requested_seq += 1
                 ── COMMIT (durable) ──► 200
              3. EdgeRuntime.waitUntil(processTarget):
                   google_sheets_push_claim (target lease, snapshot seq, eligible sources)
                   for each enabled tab: google_sheets_push_claim_source → runSource(trigger "push")
                       (existing engine: refresh token → Drive/Sheets read → plan → ingest → finish)
                   google_sheets_push_complete (processed_seq := snapshot; dirty? loop)
pg_cron (every minute, guard-only) ─► google-sheets-push-maintenance: renew / register / stop channels,
                                      recover expired leases, run due retries. Never reads a sheet without a job.
```

### 2.1 Latency budget, notification receipt → lead committed (estimates; measured at Gate E)

| Step | Warm | Cold |
|---|---|---|
| Receiver start + header checks | ~10 ms | 0.3–1 s |
| `push_accept` RPC (commit) | 30–80 ms | |
| `push_claim` + `push_claim_source` | 60–120 ms | |
| OAuth refresh (`oauth2.googleapis.com`) | 100–250 ms | |
| Drive `files.get` + Sheets metadata + `values.get` | 300–700 ms | |
| `context` + `load_state` + `ingest` + `finish` + `complete` | 200–450 ms | |
| **Total** | **≈ 0.7–1.6 s** | **≈ 1.5–2.6 s** |

Google's own delivery delay is added on top, and that part is unmeasured until Gate E.

---

## 3. Data model (one versioned migration; every new table is in `private`)

Each table below:
- carries `organization_id` and `user_id`, copied **server-side** from the connection (never from a request);
- has RLS enabled with no policies;
- has `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated` and `service_role`.

This is the same posture as `private.google_sheets_receipts`.

### 3.1 `private.google_sheets_watch_targets`
One row per (connection, spreadsheet). It is the watch target and its coalescing job.

| Column | Purpose |
|---|---|
| `id`, `organization_id`, `user_id`, `connection_id` (FK, `ON DELETE CASCADE`), `spreadsheet_id` | Identity. `UNIQUE (connection_id, spreadsheet_id)`. |
| `state` | `setting_up` / `active` / `interrupted` / `stopped`. This is the UI projection. |
| `requested_seq`, `processed_seq` (bigint) | **No-lost-work protocol** (§5.3). |
| `next_attempt_at`, `attempts`, `last_outcome`, `last_error_code` | Retry and backoff. |
| `lease_owner`, `lease_expires_at` | Job lease (one worker per target). |
| `watch_failures`, `next_watch_attempt_at`, `maint_lease_owner`, `maint_lease_expires_at` | Registration backoff, and a maintenance lease so overlapping runs never double-register. |
| `last_notification_at`, `last_processed_at`, `created_at`, `updated_at` | Telemetry and UI. |

**Indexes.**
- Due jobs: `(next_attempt_at) WHERE requested_seq > processed_seq`.
- Leased jobs: `(lease_expires_at) WHERE lease_owner IS NOT NULL`.
- Owner: `(organization_id, user_id)`.

### 3.2 `private.google_sheets_watch_channels`
One row per Google channel.

| Column | Purpose |
|---|---|
| `id`, `target_id` (FK, cascade), `organization_id`, `user_id`, `connection_id`, `spreadsheet_id`, `auth_generation` | Persisted ownership and authorization snapshot. |
| `channel_id` (`UNIQUE`) | What we send to Google, 43 characters (§4.1). |
| `token_digest` bytea | SHA-256 of the 32-byte random token. **The token itself is never stored.** |
| `key_id` | Which push key minted the channel id (supports rotation). |
| `resource_id`, `observed_resource_id` | The opaque Google id from the watch response, and from a `sync` that arrived first. |
| `state` | `registering` / `active` / `stopping` / `stopped` / `failed` / `abandoned`. |
| `requested_expiration`, `expires_at` | We store Google's **returned** expiration. |
| `sync_received_at`, `activated_at`, `stopped_at`, `stop_attempts`, `last_error_code`, `reason` | Lifecycle. `reason` is `activate` / `resume` / `renew` / `reconnect` / `recover`. |

**Indexes.**
- At most one registration in flight per target: partial `UNIQUE (target_id) WHERE state = 'registering'`.
- Renewal scan: `(expires_at) WHERE state = 'active'`.

### 3.3 `private.google_sheets_push_events`
One row per notification on a known channel. Kept 14 days.

| Column | Purpose |
|---|---|
| `id`, `organization_id`, `user_id`, `target_id`, `channel_row_id` (FK, cascade) | Identity. |
| `message_number`, `resource_state`, `changed` | Header values. **No token, resource URI or PII.** |
| `outcome` | `queued` / `sync` / `duplicate` / `ignored_inactive` / `ignored_stale` / `rejected_token` / `rejected_resource` / `catch_up`. |
| `job_seq` | The `requested_seq` this event produced. |
| `received_at` (Edge clock), `queued_at` (`clock_timestamp()` inside the accept transaction) | Telemetry. |

`UNIQUE (channel_row_id, message_number)` provides redelivery dedupe.

### 3.4 `private.google_sheets_push_attempts`
One row per processing attempt. Kept 30 days.
- **Timing:** `snapshot_seq`, `from_seq`, `oldest_received_at`, `oldest_queued_at`, `started_at`,
  `first_commit_at`, `finished_at`.
- **Counts:** `sources_run`, `imported`, `flagged`, `skipped_duplicate`, `already_receipted`, `errors`,
  `google_requests`.
- **Result:** `outcome`, `error_code`, `worker` (`receiver` / `maintenance` / `api`).

### 3.5 Existing objects changed (minimal, guarded)
- **`private.google_sheets_finish`:** `CREATE OR REPLACE`. The **only** change is adding `'push'` to the trigger
  validation.
  - Preimage md5 guard `f1cf66be…a414`, as the foundation migration did for `_contacts_permission_default`.
  - Signature, owner and ACL are preserved.
- **`public.google_sheets_sync_runs`:** replace `google_sheets_sync_runs_trigger_check` with
  `trigger IN ('schedule','manual','activation','push')`.
- **Not changed:** every other table, policy, function, trigger, workflow, DNC, SMS, consent and telephony object,
  including `google_sheets_claim`, `lock_for_work`, `ingest`, `store_connection` and `disconnect`. No RLS change,
  so `#APPROVE_RLS_CHANGE` is not needed.

---

## 4. Secure notification receiver — `supabase/functions/google-sheets-push`

### 4.1 Channel credentials
- **`channel_id`** = `"gs1"` + base64url(18 random bytes) + base64url(first 12 bytes of
  HMAC-SHA256(`GOOGLE_SHEETS_PUSH_KEY`, prefix)). That is 43 characters of `[A-Za-z0-9_-]`. The HMAC tag lets
  the receiver reject random or forged ids **without a database call**.
- **`token`** = base64url(32 random bytes), 43 characters. Only its SHA-256 digest is persisted.
- **`key_id`** = the first 8 hex characters of SHA-256(key). After a key rotation, maintenance renews every channel
  minted under another `key_id`. The new channel's catch-up read covers the overlap.

### 4.2 Validation order (fail closed)
1. **Method.** `POST` only, otherwise `405`. The body is never read (Google's file notifications have none).
2. **Header shape**, otherwise `400` with no database call:
   - `X-Goog-Channel-ID`: exactly the §4.1 shape and HMAC tag (constant-time compare);
   - `X-Goog-Channel-Token`: 43 base64url characters;
   - `X-Goog-Resource-ID`: printable ASCII, 1–256 characters;
   - `X-Goog-Resource-State`: present;
   - `X-Goog-Message-Number`: 1–19 digits.
3. **`google_sheets_push_accept(...)`, one transaction.** The receiver passes only the channel id, the token
   digest, the resource id, the state, the message number and `X-Goog-Changed`. **No organization, user or
   spreadsheet value is ever taken from the request**, and `X-Goog-Resource-URI` is ignored.
   1. Find the channel by `channel_id` (`FOR UPDATE`). Unknown → `unknown_channel` → `404`.
   2. Compare token digests in constant time with `private.google_sheets_ct_equal` (fixed-length XOR fold, no early
      exit). A mismatch is recorded as `rejected_token` → `401`.
   3. Resource id. If one is stored, it must equal the header (a mismatch → `rejected_resource` → `401`). While
      `registering`, the first value is recorded as `observed_resource_id`, and any later value must match it.
   4. Lifecycle. All of these must hold:
      - channel state in `registering` / `active` / `stopping`;
      - `expires_at` in the future (when known);
      - `channel.auth_generation = connection.auth_generation`;
      - connection `connected`, with the same owner and org;
      - target not `stopped`.

      Otherwise the event is `ignored_stale` / `ignored_inactive`, answered `200`. The message is acknowledged and
      dropped; there is no job.
   5. `sync` → record `sync_received_at` → `200`. There is no job.
   6. Dedupe: `INSERT … ON CONFLICT (channel_row_id, message_number) DO NOTHING`. A duplicate → `200`, with no
      sequence bump.
   7. Otherwise `requested_seq += 1` and `last_notification_at = now()`. The event gets `job_seq` and `queued_at`.
      An active failure backoff is respected.
      - Any other state (`update`, `add`, `remove`, `trash`, `untrash`, unknown) is queued. A read is idempotent,
        and `remove` / `trash` surface as `access_lost` through the engine.
      - The function returns `process = (lease free AND due)`.
4. **Response.** `200` **only after that transaction commits**. A database or network failure → `503`, so Google
   retries.
5. **Background work.** `EdgeRuntime.waitUntil(processTarget(...))` runs when `process` is true and push mode allows
   processing for this target.

**Accepting is unconditional on the flags.** Mode `off` still validates and durably queues, and processing resumes
when the mode comes back on. Only a missing push key or a closed admission gate makes the receiver answer `503`.

**Logging.** One structured line per request:
- the outcome code;
- the internal channel row id, or a SHA-256 prefix of the channel id when the channel is unknown;
- the state;
- the duration in ms.

**Never logged:** tokens, raw headers or lead data. Errors pass through the existing `sanitizeError`.

### 4.3 Threat model (summary)
- **A notification carries no data.** A successful forgery can at most trigger one extra idempotent read of a sheet
  the owner already authorized. The import path re-checks everything under locks (§1.2).
- **Random or forged ids** are dropped before the database by the HMAC tag.
- **Replays** are deduplicated by `(channel, message number)`. A replay that is accepted is still idempotent:
  receipts block re-imports.
- **Cross-tenant mix-ups are impossible.** Ownership resolves from the channel row → its target → its connection →
  that connection's sources, with org and user equality at each hop.
- **Amplification is bounded** by:
  - one in-flight job per target;
  - per-connection serialization;
  - a global concurrency cap;
  - the HMAC pre-check.
- **Platform logs.** At Gate D, verify that Supabase function logs do not capture `X-Goog-Channel-Token`. Send one
  test request with a dummy header and inspect the log metadata.

---

## 5. Durable queue (Postgres; no new extension)

`pgmq` is not used. It has no per-key coalescing, and a counter row per target gives coalescing, deduplication and
no lost work in one place. Everything below is a `private.*` SECURITY DEFINER function with
`search_path = pg_catalog, pg_temp`. Each has a `public.google_sheets_*` wrapper whose `EXECUTE` is granted to
`service_role` only. `authenticated` and `anon` are refused, which is verified through PostgREST.

### 5.1 New functions (+12 private, +10 public → 74 total; T1 updated)

**Private only (no wrapper):**
- `ct_equal(bytea, bytea)`;
- `push_maintenance_due()`: the cron guard, run as `postgres`.

**With a `public.` wrapper:**

| Function | Purpose |
|---|---|
| `push_accept` | §4.2 |
| `push_claim(p_lease, p_target, p_lease_s, p_allow_sources)` | Claim a job (§5.3) |
| `push_claim_source(p_target, p_target_lease, p_source, p_lease)` | Claim one source for push processing (§5.4) |
| `push_complete(p_target, p_lease, p_snapshot, p_result)` | Finish a job (§5.3) |
| `push_kick(p_user, p_org, p_source, p_reason)` | Event-driven enqueue after an owner action (D2) |
| `watch_begin` | Start a watch registration (§6.1) |
| `watch_result(p_channel_row, p_action, …)` | Record `activated` / `failed` / `stopped` / `stop_failed` / `abandoned` |
| `watch_release(p_user, p_org, p_connection, p_spreadsheet)` | Stop watches on pause, remove or disconnect |
| `push_maintenance_claim(p_lease, p_limit, p_allow_sources)` | Maintenance work items, plus bounded retention deletes |
| `push_status(p_user, p_org)` | Monitoring summary for the UI |

### 5.2 Lock order (new and existing)
**channels of a target (by id) → target → source → connection.**
- Existing functions keep source → connection.
- Connection-only operations (`store_connection`, `mark_reconnect`, `disconnect`) lock only the connection, and
  never touch targets or channels.
- `push_accept` reads the connection without a lock, so a reconnect never blocks the receiver. Generation
  consistency for writes is enforced later by `lock_for_work`.
- `push_maintenance_claim` locks targets with `SKIP LOCKED` and only *reads* channels.

### 5.3 No-lost-work protocol
1. **A notification:** `requested_seq += 1`. This is the only increment. **Nothing ever lowers `requested_seq` or
   discards it.**
2. **`push_claim`** takes the target lease (default 300 s; tests pass a short `p_lease_s`). It records
   `snapshot = requested_seq` and returns:
   - the eligible sources: `state = 'enabled'`, `health IN ('ok','error')`, same connection, spreadsheet, org and
     user, and filtered by the pilot allowlist;
   - the oldest unprocessed event's `received_at` and `queued_at`.

   It refuses when any of these holds:
   - the lease is held;
   - the target is not due;
   - the connection is not `connected` or the owner is ineligible;
   - another target on the **same connection** is leased (per-Google-user serialization);
   - **global concurrent leases ≥ 4** (serialized by a transaction advisory lock; raised at Gate G with quota).
3. **`push_complete`** applies the outcome:

   | Outcome | Effect |
   |---|---|
   | `done` | `processed_seq = GREATEST(processed_seq, snapshot)`, `attempts = 0` |
   | `backlog` (a run hit `rowsPerRun` or the budget) | `processed_seq` unchanged, due now |
   | `retry` | `processed_seq` unchanged, `next_attempt_at` per the backoff table below |
   | `blocked` (reconnect required) | unchanged; resumes after reconnect, because claim requires `connected` |
   | no eligible sources (paused, removed, review, access lost) | `done`. Notifications for sources that are not running are intentionally dropped; Resume and review apply kick their own catch-up (D2) |

   It releases the lease, writes the attempt row and returns `dirty = requested_seq > processed_seq AND due`.
4. **The worker loops** while `dirty` and its budget allows. A notification that arrives mid-run therefore always
   causes exactly one follow-up run.
5. **Work stealing.** With budget left, the worker claims any other due target (`p_target` NULL).
6. **A crashed worker** leaves an expired lease. The next receiver run or maintenance run reclaims the target.
   `processed_seq` never advanced, so nothing is lost.

**Backoff (with ±20% jitter).**

| Cause | Next attempt |
|---|---|
| Source busy (a Sync Now holds its lease) | 10 s (also retried in-process up to 3 × 3 s) |
| Stale finish (config changed mid-run) | 5 s, at most 3 times in a row, then the transient schedule |
| Google 429, 5xx or network; `run_failed` | 30 s → 1 m → 2 m → 5 m → 15 m → 30 m → 60 m (cap) |

There is **never** a terminal drop while a source is eligible.

### 5.4 Explicitly authorized push claim (instead of repeated Sync Now)
`push_claim_source` first verifies **the caller's target lease is current**, read `FOR SHARE` on the real clock.
It then claims the source with exactly the scheduled path's eligibility:
- state `enabled` and health `ok` / `error`;
- connection `connected` with a refresh token;
- lease free or expired;
- `owner_eligible`;
- plus the same connection and spreadsheet as the target.

It does this **without** `next_sync_at` and **without** the manual 30-second cooldown. The scheduled and manual
claim paths are untouched. A push run sets `last_checked_at` through `finish`, so a Sync Now right after it
still sees the existing cooldown.

### 5.5 Two workers can never import the same lead
There are three independent layers:
1. the target lease (one job worker);
2. the source lease (one run per source, shared with Sync Now);
3. the existing receipt unique key plus the advisory lock inside `ingest`.

### 5.6 `finish` / `sync_runs` change
`'push'` is added to both. Push runs appear in the existing 50-row run history as `push`.
- `next_sync_at` is still computed by `finish`. It is inert because no poller is scheduled.
- `last_success_at` is still written only on a completed, healthy run. It feeds the UI's "Last successful sync".

---

## 6. Watch lifecycle

### 6.1 Register (`ensureWatch`, in `_shared/googleSheets/push/watches.ts`)
1. **`watch_begin`.**
   - Requires a connected connection at the expected generation, an eligible owner, and at least one enabled
     source for the (connection, spreadsheet) pair. It creates the target if it is missing.
   - It returns `exists` when an active channel at the current generation and key is not inside the renew window.
   - Otherwise it inserts a `registering` channel (`channel_id`, `token_digest`, `key_id`, generation).
2. **Google.**
   - Refresh the access token with the existing `refreshAccessToken`. On `invalid_grant`, call the existing
     generation-guarded `markReconnect`.
   - Call `POST https://www.googleapis.com/drive/v3/files/{spreadsheetId}/watch?supportsAllDrives=true` with
     `{id, type:"web_hook", address, token, expiration: now+24h}`.
   - The address is built from `SUPABASE_URL` (invariant #7 style) and never from a request.
3. **Success → `watch_result('activated', resourceId, expiration)`.**
   - It locks every channel of the target in id order, then the target.
   - It requires the channel still `registering`, the generation unchanged, and `observed_resource_id` either NULL
     or equal. Otherwise the outcome is `stale` and the channel is stopped.
   - It sets the channel `active`, stores Google's returned expiration, and sets the target `active`.
   - Earlier active channels become `stopping`: **this is the renewal overlap**. Their notifications are still
     accepted until they are stopped, and deduplication plus coalescing absorb the double delivery.
   - On a **fresh** registration it also adds one `catch_up` event (`requested_seq += 1`), per D2.
4. **Failure → `watch_result('failed', code)`.**
   - The target becomes `interrupted` when it has no other active channel.
   - Registration backoff: 1 m → 5 m → 15 m → 1 h → 6 h (cap).
   - Codes: `reconnect_required`, `access_lost`, `address_rejected` (see risk R1), `rate_limited`,
     `google_unavailable`.

**A `sync` before the watch response** is handled by step 4.2.3.3 (the `registering` channel's
`observed_resource_id`). A `registering` row older than 5 minutes (an Edge crash between steps 1 and 3) is stopped
when its resource id is known, and `abandoned` otherwise. Google expires it within a day, and its notifications
are ignored.

### 6.2 Renew
Maintenance renews a channel when `expires_at - now() < 3 h`. `GOOGLE_SHEETS_PUSH_RENEW_BEFORE_MIN` is bounded to
30–1380 minutes and exists for the Gate E renewal test. Renewal is the same register flow; the old channel is then
stopped.

### 6.3 Stop
`POST /drive/v3/channels/stop` with `{id, resourceId}`.
- `404` counts as stopped.
- Other failures increment `stop_attempts`, and maintenance retries on the registration backoff.
- After 5 failures, or when no valid token exists, the channel becomes `abandoned`. It is ignored by the receiver
  and expires at Google within a day.

### 6.4 Lifecycle events

| Event | What happens |
|---|---|
| **Enable** (`activate`) / **Resume** | After the RPC succeeds, `ensureWatch` runs inline (bounded at 8 s; failures go to maintenance) and the processing is kicked through `waitUntil`. With "include existing", the initial import now starts within seconds, with no Sync Now. |
| Mapping save on an enabled source / review apply / identity review apply | `push_kick`, then `waitUntil` processing. These replace today's inert `next_sync_at = now()`. |
| **Pause** / **Remove** | After the RPC succeeds, `watch_release`: when no enabled source remains for the target, its channels move to `stopping` and are stopped inline (best effort). A notification already in flight finds no eligible source and completes as `done`. |
| **Disconnect** | *Before* the existing RPC deletes the refresh token: a bounded (5 s) best-effort stop of every channel on the connection. Then the unchanged `google_sheets_disconnect`. Leftover channels are stale by generation, ignored by the receiver, marked `abandoned` by maintenance, and expire at Google. Disconnect is never blocked, and **Google revoke is never called** (existing invariant). |
| **Reconnect** (same Google account; generation +1) | Old channels become stale, so their notifications are acknowledged and dropped. Maintenance registers new channels at the new generation within a minute, with a catch-up read (no lost rows), and stops the old ones with the new token. The OAuth callback is **not modified**. |
| Account switch | `store_connection` already refuses a different Google account while sources exist. Removing the sources releases the watches first. |
| Permission loss | Token revoked → `invalid_grant` → `markReconnect` → as reconnect. File unshared or deleted → `access_lost` on the read → no eligible source → maintenance stops the channel; Resume re-registers it. |

---

## 7. Importer reuse

The engine is reused **unchanged in behavior**. `runSource` gains only:
- the trigger type `"push"`;
- an `already` count, summed from `ingest`'s `o === "already"` rows, for the "duplicates prevented" metric. It is
  not sent to `finish`.

`db.ts` widens `finish`'s trigger type.

**Preserved untouched:**
- the mappings, `identity.ts` (row-position and Lead ID planners, blank-baseline accounting, structural review);
- receipts, the identity ledger, the duplicate predicate and settings;
- the advisory lock and owner eligibility;
- lead ownership (`assigned_agent_id = user_id = imported_by_user_id` = the connection owner);
- `trg_workflow_lead_created` as the only workflow dispatch;
- Contact Management settings and the RLS/security checks.

**Incomplete rows** are recorded as `pending` (with no lead), as today. Row-position pending positions are revisited
on every read. The agent's later edit produces a new notification, and the completed row imports then.

**Not read or written:** SMS consent, DNC, suppression, calling and workflow behavior.

---

## 8. Frontend (Tailwind only; no redesign; no new forms or modals, so Zod is unaffected)
- **`status` action** returns
  `realtime: { mode: "off"|"pilot"|"on", spreadsheets: { [spreadsheetId]: { state, last_notification_at } } }`.
- **`status.ts`** gains `monitoringStatus(source, realtime)`. It returns:
  - **Real-time sync active** (success): the target is `active`;
  - **Setting up monitoring** (default): the target is `setting_up`, or is missing while push applies;
  - **Monitoring interrupted** (warning): the target is `interrupted`;
  - nothing, for a draft or paused source or when push mode is `off`. The UI is then exactly today's.
- **`SheetSourceRow.tsx`** adds one small status line. The existing "Checked … ago" becomes **"Last successful
  sync … ago"**, from the same `last_success_at`.
  - The row stays under 200 lines.
  - Sync Now, Pause/Resume, Remove, Review, Edit mapping, Add Sheet, the Picker, Mapping, Preview and Enable are
    unchanged.
- **`useGoogleSheets.ts`** refetches `status` every 60 s while push applies to an enabled source. This is
  AgentFlow-to-Supabase only; nothing calls Google.
- **`SheetSourceList.tsx` / `GoogleSheetsSettings.tsx`** pass `realtime` through. That is a one-prop change.

---

## 9. Telemetry

| # | Timestamp | Where |
|---|---|---|
| 1 | Test row created | Pilot harness (API rows, exact). Manual rows: tester's recorded time, reported as approximate. |
| 2 | Notification received | `push_events.received_at` (Edge clock at request start) |
| 3 | Durably queued | `push_events.queued_at` (`clock_timestamp()` in the committing transaction) |
| 4 | Processing started | `push_attempts.started_at` |
| 5 | Lead committed | `push_attempts.first_commit_at` (Edge time after the first `ingest` with imports returns) and `receipts.created_at` (database) |
| 6 | UI visibility | Best effort. Only with a separately approved signed-in browser run or your screen recording; otherwise reported as not measured. |

**Report** (`supabase/ops/google_sheets_push_metrics.sql`, read-only): p50/p95/p99 via `percentile_cont` for:
- notification → commit;
- queued → started (queue delay);
- run duration;
- row write → commit (from the harness).

**Also reported:**
- notifications received and their outcomes (valid, duplicate, stale, rejected);
- queue delays;
- Google requests (a counting `fetch` wrapper around the engine);
- leads imported;
- duplicates prevented (`skipped_duplicate` + `already_receipted`);
- failed imports;
- active and expired channels;
- renewal failures;
- retry attempts;
- estimated usage per 1,000 leads.

No token, header value, row value, phone, email or name is stored in telemetry. Unknown-channel rejections are
counted from the structured log lines (D6).

---

## 10. Security and database rules checklist
- **Tenancy.** Every new tenant row carries `organization_id` and `user_id`, copied from server records. There is
  no RLS change.
- **Migrations.** Versioned files only:
  - the migration, re-stamped at Gate D after a fresh hosted read;
  - a paired rollback;
  - a **separate** pending maintenance-schedule file, applied only at Gate E.
- **Function security.** SECURITY DEFINER functions are `private`, with `REVOKE ALL`. Public wrappers are
  `service_role` only, with `search_path` pinned. Verified through PostgREST, not only native SQL.
- **Queries.** `.maybeSingle()` wherever zero rows are possible.
- **Secrets.** `service_role` is used only in Edge. New Edge secrets:
  - `GOOGLE_SHEETS_PUSH_KEY` (≥ 32 characters);
  - `GOOGLE_SHEETS_PUSH_MAINTENANCE_TOKEN` (≥ 32 characters; Vault `google_sheets_push_maintenance_token` for the
    cron);
  - `GOOGLE_SHEETS_PUSH_MODE`;
  - `GOOGLE_SHEETS_PUSH_PILOT_SOURCES`.

  No frontend secret.
- **Unchanged:** the Sheets OAuth client, PKCE, state, `auth_generation`, Vault refresh tokens and the
  `drive.file`-only scope. Gmail/Calendar code and tables are untouched.
- **No mock data** in production paths. Tests use isolated databases and fakes only.
- **Old poller.** `pending/20261013120100_google_sheets_sync_schedule.sql` stays unapplied and byte-identical, and a
  CI check pins its SHA-256. The new schedule is asserted never to call `google-sheets-sync-worker` and never to
  select by `next_sync_at`.

---

## 11. Files

### New
- `supabase/migrations/<ts>_google_sheets_push_sync.sql`. `<ts>` is provisional and re-stamped at Gate D.
- `supabase/migrations/rollback/<ts>_google_sheets_push_sync.rollback.sql`. It drops the new objects, restores the
  `finish` preimage, and restores the 3-value CHECK as `NOT VALID` when `push` rows exist, so history is never
  deleted.
- `supabase/migrations/pending/<ts2>_google_sheets_push_maintenance_schedule.sql`: guarded `cron.schedule` of
  `google-sheets-push-maintenance-every-minute`.
- `supabase/functions/google-sheets-push/index.ts` and `index.test.ts`.
- `supabase/functions/google-sheets-push-maintenance/index.ts` and `index.test.ts`.
- `supabase/functions/_shared/googleSheets/push/`:
  - `headers.ts`, `channel.ts` (mint/verify, watch/stop calls), `db.ts`, `processor.ts`, `watches.ts`;
  - matching `*.test.ts` files.
- `supabase/functions/google-sheets-api/push.ts`: the action hooks, keeping `actions.ts` small.
- `supabase/tests/google_sheets_push.sql`: the SQL behavior suite.
- `supabase/ops/google_sheets_push_metrics.sql` (read-only), `google_sheets_push_stop_all.sql`,
  `google_sheets_push_unschedule.sql`.
- `scripts/google_sheets_push_pilot.ts`: the Gate E harness. It needs the test-writer credential (D8). CI only
  type-checks it.
- `docs/plans/2026-10-25-google-sheets-realtime-sync/verification.md` (Gate B) and `release-package.md` (Gate D).

### Modified
- `supabase/functions/_shared/googleSheets/config.ts`: push config and limits.
- `supabase/functions/_shared/googleSheets/engine.ts`: the `"push"` trigger and the `already` count.
- `supabase/functions/_shared/googleSheets/db.ts`: the `finish` trigger type.
- `supabase/functions/google-sheets-api/actions.ts` and `actions.test.ts`: hooks on activate, resume, save, the two
  review applies, pause, remove, disconnect and status.
- `supabase/config.toml`: two new `verify_jwt = false` entries.
- **SQL suite:**
  - `supabase/tests/google_sheets_import.sql`: the T1 inventory count and ACL;
  - `supabase/tests/google_sheets_harness.sql`: fixture helpers;
  - `supabase/tests/google_sheets_cron_check.sql`.
- **Runners:** `scripts/run_google_sheets_tests.sh` (push suite, two-session concurrency, PostgREST) and
  `scripts/run_google_sheets_cron_check.sh`.
- **PostgREST and end-to-end:** `scripts/google_sheets_postgrest_check.mjs` and `scripts/google_sheets_e2e.ts` (push
  end-to-end with fake Google).
- **Ops:** `supabase/ops/google_sheets_drain_check.sql` (maintenance requests and job leases).
- **CI:** `.github/workflows/google-sheets.yml` (paths, `deno test` / `deno check` for the two new entry points).
- **Frontend:**
  - `src/lib/google-sheets/schema.ts` and `src/lib/google-sheets/status.ts`;
  - `src/components/settings/google-sheets/SheetSourceRow.tsx`, `SheetSourceList.tsx` and
    `GoogleSheetsSettings.tsx`;
  - `src/hooks/useGoogleSheets.ts`;
  - the tests `src/lib/google-sheets/__tests__/googleSheets.test.ts` and
    `src/components/settings/google-sheets/__tests__/googleSheetsUi.test.tsx`;
  - the browser harness `scripts/tests/google-sheets-ui/verify.mjs`.
- **Docs:** `AGENT_RULES.md` (new "Google Sheets real-time sync" invariant and inventory count), `WORK_LOG.md`,
  root `implementation_plan.md`.

**Not in this PR:** `src/content/legal.ts` (D9, separate release). Also unchanged: `google-sheets-oauth-start`,
`google-sheets-oauth-callback`, `google-sheets-sync-worker`, and the pending 5-minute schedule.

---

## 12. Cost and scale

**Per notification processed (one tab).** About 4 Google requests:
- OAuth refresh;
- Drive `files.get`;
- Sheets metadata;
- `values.get`.

On our side it costs 1 receiver invocation and about 10 PostgREST RPCs. Extra tabs add about 4 Google requests each.

**Per 1,000 imported leads (estimate):**

| Scenario | Notifications | Google requests | Edge invocations | Supabase cost beyond quota |
|---|---|---|---|---|
| Worst case: one notification per lead, ×1.5 for duplicate deliveries | 1,500 | ≈ 6,000 | ≈ 1,500 | ≈ $0.003 at $2 per million |
| Batched: Google coalesces bursts | ≪ 1,000 | proportionally less | proportionally less | |

Google read APIs are free within quota.

**Upkeep per spreadsheet per day** is about 3 Google requests: watch, stop and refresh at renewal. The maintenance
cron sends an HTTP request only when work is due.

**Scale limit.** The default Sheets read quota of 300 per minute per project allows about **150 runs per minute**.
- The global cap of 4 concurrent jobs plus per-connection serialization keeps the pilot well inside it.
- Before Gate G: request a quota increase, which is free, and raise the cap with it.
- Google's coalescing limits each actively edited sheet to about 20 notifications per hour.
- Very large tabs (up to the 10,000-row cap) cost a full read per notification, the same as today's Sync Now. A
  range-read optimization is a possible follow-up, not part of this plan.

---

## 13. Tests

Your 20 scenarios, mapped to test layers:
- **SQL** = `supabase/tests/google_sheets_push.sql` plus two-session psql tests;
- **Deno** = unit and receiver tests with fake Google;
- **E2E** = `google_sheets_e2e.ts` through PostgREST;
- **Pilot** = Gate E with real Google.

| # | Scenario | Layers |
|---|---|---|
| 1 | Manual row in Google Sheets | Pilot (manual), E2E (simulated) |
| 2 | Row appended with the Sheets API | Pilot (harness), E2E |
| 3 | Several rows together | E2E, Pilot |
| 4 | Incomplete row completed later | E2E (pending → import on the next notification), Pilot |
| 5 | Duplicate notifications | SQL (dedupe, no sequence bump), Deno |
| 6 | Notification during active processing | SQL two-session (seq protocol: exactly one follow-up run), E2E |
| 7 | After Pause | SQL, E2E |
| 8 | After Disconnect | SQL (stale generation → ignored), Deno (stop before disconnect), E2E |
| 9 | After source removal | SQL, E2E |
| 10 | Expiry and automatic renewal | SQL + Deno (renew window, overlap, stop), Pilot (forced renew window) |
| 11 | Overlapping channels | SQL (both accepted until stopped, coalesced), E2E |
| 12 | Invalid or forged webhook | Deno (shape, HMAC, token, resource), SQL (constant-time compare, known-channel rejects), PostgREST (anon/authenticated refused) |
| 13 | Cross-agency isolation | SQL (two orgs; swapped tokens and channels; ownership only from server rows) |
| 14 | Reconnect and generation changes | SQL, Deno, E2E (new channel and catch-up; old one ignored, then stopped) |
| 15 | Google rate limiting | Deno (429 → `retry` backoff), SQL (global cap, per-connection serialization) |
| 16 | Worker failure and retry | SQL (abandoned lease → recovered; `processed_seq` unchanged), E2E (an error thrown mid-run) |
| 17 | Rapid changes to one spreadsheet | SQL two-session (N notifications → ≤ 2 runs), E2E |
| 18 | Several tabs in one spreadsheet | SQL, E2E (one target, two sources) |
| 19 | Several agents and organizations | SQL, E2E |
| 20 | Earlier imports never duplicated | SQL, E2E (push after Sync Now → `already`; leads unchanged), Pilot (Pilot B's 3 leads stay 3) |

**Also:**
- the receiver's `200`-only-after-commit guarantee (Deno, with a database failure → `503`);
- registration's sync-before-response race (Deno + SQL);
- negative controls in the style of the existing suite. For example, removing the per-target lease must make the
  concurrency test fail.

**Required commands (same as CI):**
- `npx tsc --noEmit`;
- the strict app type-check against the unchanged base (`scripts/verify-a2p-types.mjs`, 0 new diagnostics);
- focused Vitest (the CI list);
- `deno test` and `deno check` for all six Sheets entry points;
- `scripts/run_google_sheets_tests.sh`: the **complete existing Sheets regression suite** plus the push suite (SQL,
  PostgREST, regressions, concurrency, shutdown, end-to-end);
- `scripts/run_google_sheets_cron_check.sh`;
- ESLint on the CI Sheets file set;
- `npm run build`;
- the browser harness `verify.mjs` at 1440 and 390 px;
- `git diff --check`;
- `scripts/google_sheets_regression_evidence.sh <sha>`.

There are no production test leads without separate approval.

---

## 14. Rollback and shutdown

| Level | Action | Effect |
|---|---|---|
| 1 | Unset `GOOGLE_SHEETS_PUSH_MODE` | The receiver still acknowledges and durably queues, but nothing is processed or registered. Maintenance only stops channels. Sync Now keeps working. |
| 2 | Run `google_sheets_push_stop_all.sql`, then `google_sheets_push_unschedule.sql` | Every channel moves to `stopping`; maintenance stops them; then the cron is removed. |
| 3 | Existing admission gate (`google_sheets_admission_close.sql`) | It revokes every `public.google_sheets_*` wrapper except disconnect, **new wrappers included** (same `LIKE` pattern). The receiver answers `503`. The drain check is extended to the maintenance URL and the job leases. |
| 4 | Code: redeploy the recorded pre-change `google-sheets-api` bundle (the live v6 equals `main`); disable the two new functions | |
| 5 | Database: the paired rollback SQL | Leads, receipts, the ledger and `sync_runs` history are never deleted. |

---

## 15. Release gates

| Gate | Scope | Requires |
|---|---|---|
| **A** | This plan, D1–D11 | Your explicit approval |
| **B** | Build on `claude/modest-knuth-y5cqor`; all §13 local checks; `verification.md`; **draft PR**; WORK_LOG and AGENT_RULES; context snapshot. **Stop.** | Gate A |
| **C** | Independent review (fresh reviewer: code, security, concurrency) plus green CI on the exact head | Gate B |
| **D** | Fresh hosted read → re-stamp → apply the migration → deploy `google-sheets-push`, `google-sheets-push-maintenance` and the new `google-sheets-api` (complete bundles, byte read-back, `verify_jwt=false` preserved) → set the push key and maintenance token secrets. **`GOOGLE_SHEETS_PUSH_MODE` stays absent; no cron; no watch.** Then read-only verification and advisors, plus the log-header check (§4.3). | Separate approval |
| **E** | `GOOGLE_SHEETS_PUSH_MODE=pilot`, allowlist = Pilot B only → apply the pending maintenance schedule (Vault token) → Pilot B's watch registers (first Google acceptance of the address; risk R1) → synthetic rows through the harness (D8) and your manual rows → measure → verify records and **0 duplicates** → recovery test (mode off → add a row → mode on → backlog drains) → forced renewal → advisors | Separate approval |
| **F** | Latency and reliability report: p50/p95/p99, coverage of API-written vs manual rows, renewals over at least one real 24 h expiry | Your review |
| **G** | Mode `on`, Sheets quota increase, raised cap, **privacy/Terms release (D9) published first** | Separate approval |

No push to `main` without your approval. Supabase "Deploy to production" must stay OFF.

---

## 16. Risks and open questions

| # | Risk | Mitigation |
|---|---|---|
| R1 | Google may refuse `*.supabase.co` as a webhook address (older docs required domain verification; current status unconfirmed here) | It is detected at the first Gate E registration (`address_rejected`). The fallback needs separate approval: a Vercel rewrite on the verified `www.fflagent.com`. |
| R2 | Google's coalescing (~3 min reported) makes bursts slow end to end | Measured and reported honestly at Gate F. No polling substitute. |
| R3 | API-written rows not notified | Stop and report (your rule). |
| R4 | Sheets read quota at scale | Concurrency cap, per-user serialization, backoff, quota increase before G. |
| R5 | OAuth app in Testing mode: refresh tokens expire after 7 days | Already surfaced as Reconnect. Reconnect recovers with a catch-up read. Publishing the app is a separate decision. |
| R6 | Edge CPU limits on very large tabs | Same exposure as Sync Now today. The pilot is small. Follow-up optimization is noted in §12. |
| R7 | Platform logs might capture channel headers | Checked at Gate D. A captured token still only allows idempotent extra reads (§4.3). |
| R8 | Production state drifted from the WORK_LOG (§1.3) | D11. A fresh hosted read before each production gate. |

---

## 17. Gate A decisions (approved 2026-10-25) and the refinements they require

### 17.1 Decisions as approved

| # | Ruling | How the build implements it |
|---|---|---|
| D1 | APPROVED. Work must survive Edge termination. | `waitUntil` runs **only after** the durable commit. If an isolate dies, an expired target lease and `processed_seq` that never advanced let the next receiver or maintenance run reclaim the job (§5.3). |
| D2 | APPROVED, with the reconciliation policy clarified | §17.3 |
| D3 | APPROVED | The cron guard (`push_maintenance_due`) only sees watch work and jobs that already exist. No step reads a sheet unless a queued job asks for it. |
| D4 | APPROVED FOR BUILD | `google-sheets-push`: HMAC-tagged channel id, then a constant-time token digest, resource id, state, expiry and generation. `google-sheets-push-maintenance`: a constant-time ≥ 32-character Vault bearer token, as `google-sheets-sync-worker` does. Both are `verify_jwt=false`. |
| D5 | APPROVED | The private tables are never exposed. The UI reads `status.realtime`, produced by the service-role `google_sheets_push_status` wrapper. |
| D6 | APPROVED | Unknown or malformed requests get a structured log line (outcome code plus a channel-id hash prefix). Rejections on a known channel are stored with that channel's org, with no secret or header values. |
| D7 | APPROVED. **Enforced server-side.** | §17.2: a database-held mode and allowlist that every SQL entry point checks, plus the Edge kill switch. |
| D8 | REVISED | §17.5: the pilot's API rows are written by Chris's connected **ChatGPT Google Drive integration**, outside AgentFlow's OAuth client and only after separate approval. Measurement is read-only SQL. There is no write harness and no `gcloud` or service-account setup. |
| D9 | APPROVED | The draft is `privacy-terms-draft.md` in this folder; `legal.ts` is not changed in this PR. §17.7 evaluates the pilot timing. |
| D10 | APPROVED | Protected, version-pinned release steps at Gate D only. |
| D11 | CONFIRMED | Pilot B's 3 imported leads (including "First Test") must stay byte-unchanged and never duplicated. Receipts `pos:<source>:1:{2,3,4}` and `done` ledger rows already protect them, and Gate E re-checks them (§17.5). |

### 17.2 Design refinements

**R-a. Server-side pilot scope (D7).** Two new private tables hold the gate:
- `private.google_sheets_push_config`: a single row with `mode IN ('off','pilot','on')` (seeded `off`),
  `max_concurrent_jobs` (4) and `renew_before_s` (10,800);
- `private.google_sheets_push_pilot_sources`: `(source_id, organization_id)`.

`private.google_sheets_push_source_allowed(source)` is true only when mode is `on`, or mode is `pilot` and the
source is listed. Mode `off` refuses everything except stops. These entry points refuse non-allowed sources:
- `push_claim` (it filters the eligible sources);
- `push_claim_source`;
- `push_kick`;
- `watch_begin`;
- `push_maintenance_claim` (registration);
- the cron guard.

`push_accept` still queues durably, so notifications are never lost while scope is closed.

The Edge flag `GOOGLE_SHEETS_PUSH_ENABLED` is a second gate (the kill switch). Processing and registration need
**both**. Setting the database mode and allowlist is a production config write, prepared as the reviewed ops file
`google_sheets_push_pilot_enable.sql` (not run).

**This replaces the env-only `GOOGLE_SHEETS_PUSH_MODE` / `PILOT_SOURCES` of §0 and §15.** The renew window and the
concurrency cap also live in this config row, so the cron guard and the claims read the same values.

**R-b. A queued event is processed only when every eligible source really finished.** `push_complete` re-derives the
outcome **in SQL**. The Edge result can only make it stricter: severity runs `done` < `backlog` < `retry` <
`blocked`. For every source that is still eligible (enabled, health `ok`/`error`, allowed):
- `health = 'ok'` and `last_success_at >=` the attempt's start is required. Otherwise the outcome is `retry`. This
  covers an unfinished run, a failed or non-completed `finish`, health `error`, and a backoff, quota or reconnect
  result.
- `last_result.backlog` must be false, otherwise the outcome is `backlog`. The guarded `finish` replacement adds
  `backlog` to `last_result`; the UI ignores the key.
- The connection must be `connected`, otherwise the outcome is `blocked`.
- Mode `off` at completion gives `deferred`.

Only `done` advances `processed_seq`.

**R-c. Monitoring state is derived.** `push_status` computes the UI state from the channels themselves:
- an active, unexpired channel at the current generation → `active`;
- a channel `registering` → `setting_up`;
- registration failures, or no live channel after one existed → `interrupted`;
- target `stopped` → nothing.

A stored state therefore cannot drift. `watch_targets.state` is only `live` or `stopped`.

**R-d. Constant-time compare** is `private.google_sheets_ct_equal(bytea, bytea)`. It is a SQL-language aggregate
`bit_or` over every byte, with no early exit, plus a fixed-length check (digests are always 32 bytes).

**R-e. Function inventory.** +13 private and +10 public functions, from 52 to **75** (44 private + 31 public). T1 is
updated in the same change.

**R-f. Lock order** (§5.2) is pinned by two-session tests in which the receiver, `watch_result`, `watch_release`,
maintenance and `push_complete` run concurrently: no deadlock and no lost increment. Source leases and target leases
each get a two-worker SKIP LOCKED test. Every new lease test has a negative control.

### 17.3 Reconciliation policy (D2) and missed-notification recovery (requirement 4)

**A notification is a trigger for a full reconciliation of the tab, never a row payload.** Each run reads the whole
tab and diffs it against the identity ledger and permanent receipts. Any row not yet imported is a candidate,
whatever change triggered the run. A missed notification therefore delays an import until the next reconciliation of
that spreadsheet; it does not lose the row.

**Reconciliation triggers (all event-driven):**
1. any authenticated `add` / `update` / `remove` / `trash` / `untrash` / unknown-state notification;
2. Enable;
3. Resume;
4. mapping save on an enabled source;
5. structural review apply;
6. identity review apply;
7. a **fresh** channel registration, meaning no live channel existed just before. That covers first monitoring,
   reconnect, recovery from interrupted monitoring, expiry without a successful renewal, and key rotation;
8. Sync Now, unchanged.

**Routine renewal does not reconcile, as long as it is seamless (§18.2).** The superseded channel stays accepted for
`renew_overlap_s` (900 s) and is stopped only after that, so Google's pending notifications on it still arrive. A
renewal is seamless only when the old channel is `active` at the same generation and key and stays valid for the
whole overlap. Anything else is fresh and triggers item 7. That includes renewal failing until the old channel
expires, or an old channel that would expire inside the overlap.

*Gate C correction:* the Gate B build stopped the old channel immediately. That left a gap for notifications Google
had not yet sent on it; §18.2 has the details.

**Delivery failures we can see:**
- An answer of `503` (database unavailable, admission closed) makes Google retry 500/502/503/504 with exponential
  backoff, for up to several days according to Google's APIs-Google documentation.
- A Google 429 or 5xx on the *read* → job `retry` with backoff, never dropped.
- A crashed worker → an expired lease → reclaimed.

**Delivery failures we cannot see:** a notification Google never sends. AgentFlow cannot detect it. The rows in
question are imported at the next trigger above.

**What we do not promise:** instant delivery, or detection of every change without Google's notification. The UI
shows "Monitoring interrupted" when we *know* monitoring is down, and Sync Now remains.

**No periodic safety-net read is included.** A daily reconciliation at renewal time would be scheduled content
reading. It is listed only as an option Chris could approve after Gate F evidence.

### 17.4 Official webhook constraints (requirement 5)
The Drive guide and the discovery document were checked on 2026-10-25. `developers.google.com` is unreachable from
this container, so the guide was read through search excerpts of the official pages, and the discovery document was
fetched from `www.googleapis.com`.

**Request and channel limits:**
- `files.watch` and `channels.stop` accept the `drive.file` scope (discovery document, revision 20261020).
- The channel `id` is unique within the project, at most **64 characters**. Ours are 43.
- The `token` is at most **256 characters**. Ours are 43.
- `type` is `web_hook`.
- `address` must be **HTTPS with a valid, trusted SSL certificate**. Self-signed, untrusted-issuer and revoked
  certificates fail.
- `expiration` is in Unix ms. For the **files resource it is at most 86,400 s; the default is 3,600 s**. The more
  restrictive of the requested value and Google's limit applies. We request 24 h and store the returned value.

**Responses Google expects:**
- **Success codes are 200, 201, 202, 204 or 102.** The receiver answers 200.
- On **500, 502, 503 or 504**, Google retries with exponential backoff. Every other code is a message failure, so we
  answer 400/401/404 only to forged or unknown requests.

**Notification contents:**
- `sync` is message number 1. It "can arrive before the watch response" and may be ignored safely. We record it.
- Message numbers increase but are **not sequential**. We never require contiguity.
- `X-Goog-Changed` is `content` / `parents` / `children` / `permissions`.
- There is no automatic renewal. Renew by calling watch again with a new id, and expect overlap.

**Authentication.** Google signs nothing. Authentication is our channel token, which is documented for exactly this
purpose (verifying that a message is for a channel we created). User agent and source IP are never relied on.

**Domain verification.** An older guide version required registering and verifying the domain; the current excerpts
show only HTTPS and a valid certificate. This stays risk R1, decided by the first real registration (Gate E).

### 17.5 Pilot procedure and measurement (D8, requirements 1 and 6; Gate E only, separately approved)

**Before.**
- Read-only snapshot of Pilot B's 3 leads: `md5` over every column, keyed by lead id.
- Their receipts and ledger.

**API-written rows.**
- Chris's ChatGPT Google Drive integration appends synthetic rows to Pilot B → Leads, one at a time and in a burst
  of 3.
- Each row uses a reserved fixture phone (702-555-0111…0114 and so on) and a unique last name, `PushApi-<n>`.
- The writer reports each row's write time in UTC, to the second.

**Manual rows.** Chris types rows `PushManual-<n>` in the Google Sheets UI and notes the time each row is complete.
That time is reported as approximate.

**Measurement.** `supabase/ops/google_sheets_push_pilot_evidence.sql` (read-only) is parameterized by those phones.
Per row it reports:
- the write time → `push_events.received_at` (**Google delivery latency**);
- `received_at` → `queued_at` → `attempt.started_at` → `first_commit_at` / receipt `created_at` (**our latency**);
- end to end;
- whether the run was `push` or `manual`;
- duplicate checks: exactly one lead per phone, and Pilot B's original 3 leads byte-identical.

**Go / no-go for Gate G.** These are criteria; the thresholds are Chris's decision at Gate F.
1. **Coverage:** 100% of API-written rows and 100% of manual rows import through `push` runs with no Sync Now.
2. **Google delivery latency:** p50, p95 and max, reported separately for API and manual rows. The proposed bar is
   p95 ≤ 5 minutes, to be decided at Gate F.
3. **Our latency:** notification → commit p95 < 5 s.
4. **Zero duplicates**, and Pilot B's original 3 leads unchanged.
5. **Renewal:** at least one real renewal with overlap and a stopped old channel (forced through
   `renew_before_s`, plus one natural 24 h cycle).
6. **Recovery:** with the kill switch off, a row is queued; when it is turned back on, the row drains.

If API-written rows are not notified, Gate E **stops and reports**. No polling substitute.

### 17.6 Definitive file list (Gate B)

**New:**
- `supabase/migrations/20261025120000_google_sheets_push_sync.sql`. The version is provisional and re-stamped at
  Gate D after a fresh hosted read.
- `supabase/migrations/rollback/20261025120000_google_sheets_push_sync.rollback.sql`.
- `supabase/migrations/pending/20261025120100_google_sheets_push_maintenance_schedule.sql`.
- `supabase/functions/google-sheets-push/index.ts` and `index.test.ts`.
- `supabase/functions/google-sheets-push-maintenance/index.ts` and `index.test.ts`.
- `supabase/functions/_shared/googleSheets/push/`:
  - `config.ts`, `headers.ts`, `channel.ts`, `db.ts`, `processor.ts`, `watches.ts`, `runtime.ts`;
  - tests: `headers.test.ts`, `channel.test.ts`, `processor.test.ts`, `watches.test.ts`.
- `supabase/functions/google-sheets-api/push.ts` and `push.test.ts`.
- `supabase/tests/google_sheets_push.sql` and `supabase/tests/google_sheets_push_cron_check.sql`.
- `supabase/ops/`:
  - `google_sheets_push_metrics.sql` (read-only);
  - `google_sheets_push_pilot_evidence.sql` (read-only);
  - `google_sheets_push_pilot_enable.sql`, `google_sheets_push_stop_all.sql`, `google_sheets_push_unschedule.sql`.
    These three are NOT RUN; each needs its own approval.
- `scripts/google_sheets_push_e2e.ts`: push end-to-end through PostgREST with fake Google.
- `docs/plans/2026-10-25-google-sheets-realtime-sync/verification.md` and `privacy-terms-draft.md`.

**Modified:**
- `supabase/functions/_shared/googleSheets/engine.ts`:
  - the `"push"` trigger;
  - the `already` count;
  - an optional `onIngest` hook for the commit timestamp.
- `supabase/functions/_shared/googleSheets/db.ts`: the `finish` trigger type.
- `supabase/functions/google-sheets-api/actions.ts`: hook calls in activate, resume, save, review apply, identity
  review apply, pause, remove, disconnect and status.
- `supabase/functions/google-sheets-api/actions.test.ts`, if needed for the hooks.
- `supabase/config.toml`: two `verify_jwt = false` entries.
- `supabase/tests/google_sheets_import.sql`: the T1 count of 75.
- `supabase/ops/google_sheets_drain_check.sql`: push columns appended at the end.
- `scripts/run_google_sheets_tests.sh`:
  - stacked migrations;
  - the push suite;
  - two-session push concurrency, with negative controls;
  - re-targeted negative controls for `finish`;
  - stacked rollback;
  - push end-to-end.
- `scripts/run_google_sheets_cron_check.sh`: the new schedule's guard.
- `scripts/google_sheets_postgrest_check.mjs`: the new wrappers' ACL and a push cycle over HTTP.
- `scripts/google_sheets_regression_evidence.sh`, only if the stacked build requires it.
- `.github/workflows/google-sheets.yml`: paths, `deno test` and `deno check` for the two new entry points.
- Frontend:
  - `src/lib/google-sheets/schema.ts` and `src/lib/google-sheets/status.ts`;
  - `src/components/settings/google-sheets/SheetSourceRow.tsx`, `SheetSourceList.tsx` and `GoogleSheetsSettings.tsx`;
  - `src/hooks/useGoogleSheets.ts`;
  - the tests `src/lib/google-sheets/__tests__/googleSheets.test.ts` and
    `src/components/settings/google-sheets/__tests__/googleSheetsUi.test.tsx`;
  - the browser harness `scripts/tests/google-sheets-ui/verify.mjs`.
- `AGENT_RULES.md`, `WORK_LOG.md`, root `implementation_plan.md`, and this plan.

**As built (delta from the list above).**
- Added `supabase/tests/google_sheets_push_concurrency_fixture.sql`: the shared two-session fixture for runner
  steps 4e–4h.
- Not needed: `google-sheets-api/actions.test.ts` (the hooks are covered by `push.test.ts` and the push end-to-end
  harness) and `scripts/google_sheets_regression_evidence.sh`.

**Not touched:**
- `google-sheets-oauth-start`, `google-sheets-oauth-callback` and `google-sheets-sync-worker` (code);
- the foundation migration (immutable) and `pending/20261013120100_google_sheets_sync_schedule.sql` (byte-identical,
  SHA-256 `6116f414…9665`);
- `src/content/legal.ts`;
- every RLS policy, the Gmail/Calendar code, and the Twilio dialer.

### 17.7 Privacy timing (D9)
The draft (`privacy-terms-draft.md`) replaces "about every five minutes". The new copy says that Google notifies
AgentFlow when an enabled spreadsheet changes, that AgentFlow then reads that tab, and that monitoring is renewed
about daily.

**Evaluation.**
- The pilot is limited by the server-side allowlist to Chris's own Pilot B sheet in Chris's own agency, with Chris's consent.
  Data access is unchanged: the same `drive.file` reads of the same picked file.
- The copy currently published describes *more frequent* reads than push produces.

Publication is therefore **not required before the Gate E pilot**, but **is required before Gate G**. That is a
recommendation; Chris decides.

## 18. Gate C hardening (approved 2026-10-25; implemented on this branch)

Approval: "APPROVED — PR #491 GATE C HARDENING" (plan at `509fa62`). The unapplied migration `20261025120000` was
edited in place. The function inventory stays at 75. Edge code is unchanged; the database decides outcomes and the
stop list.

### 18.1 Bounded receiver cost (duplicates, rejected requests, retention)

| Request | Lock | Rows written |
|---|---|---|
| Bad HMAC tag, malformed headers | none (refused in Edge, no DB call) | 0 |
| Unknown channel, invalid arguments | none | 0 |
| Wrong token / wrong resource id | **none**: authenticated on an unlocked read | **≤ 1 per channel per minute** (sampled via `last_rejected_at`, `FOR UPDATE SKIP LOCKED`, so it never waits) |
| Redelivery of a recorded message | **none** (unlocked fast path; re-checked under the channel lock only if the first delivery is still in flight) | **0** |
| Authenticated first delivery | channel, then target (lock order unchanged) | 1 |

Supporting rules:
- **Unlocked authentication is safe.** The token digest never changes, and an effective resource id
  (`COALESCE(resource_id, observed_resource_id)`) never changes once known.
- **Database-level uniqueness:** `UNIQUE (channel_row_id, message_number) WHERE authenticated AND message_number IS
  NOT NULL`. `duplicate` is no longer a stored outcome.
- **Rejections never suppress a genuine message.** Unauthenticated rows take no part in de-duplication.
- **Retention keeps pace.** The cron guard is also true while events older than 14 days or attempts older than 30
  days exist. Each pass deletes at most 5,000 of each. This is housekeeping, never a spreadsheet read.
- **Tests:**
  - P4, P12 and P15: 50 redeliveries; 100 rejections in a minute; uniqueness; the retention guard;
  - runner 4i: rejections and redeliveries complete under `lock_timeout = 1s` while another session holds the
    channel and target rows, with a negative control that reproduces the wait.

### 18.2 Renewal overlap and bounded late-delivery grace

**Overlap.**
- When a renewal is activated, each older `active` channel at the same generation and key becomes `stopping`, with
  `last_error_code = 'superseded'` and `next_stop_at = now + renew_overlap_s`.
- It is **not** returned for an immediate stop. Maintenance stops it once `next_stop_at` passes; the guard fires once
  for it.
- Channels of another generation or key are stopped immediately. Their successor's activation is fresh and
  reconciles.
- `renew_overlap_s` defaults to 900 s (`CHECK 60–3600`, and `< renew_before_s`).
- `google_sheets_push_stop_all.sql` ends any running overlap at once.

**Seamless renewal.** A renewal counts as seamless (no catch-up) only if another channel is `active` at the same
generation and key with `expires_at > now + renew_overlap_s`. A `stopping` channel never counts as coverage, either
for this rule or for the Settings status.

**Acceptance by channel state (the security adjustment).** A notification can trigger work only if the channel is in
one of these states:
- **live:**
  - `registering`, for at most 5 minutes after creation;
  - `active` or `stopping`, Google-confirmed (`activated_at`) and unexpired;
- **in grace:** Google-confirmed, in state `active`, `stopping` or `stopped`, and
  `now < LEAST(expires_at, stopped_at) + late_grace_s`. `late_grace_s` defaults to 3600 s (`CHECK 0–21600`). The
  event is recorded with `reason = 'late_delivery'`.

These never trigger work:
- `failed` channels;
- `abandoned` channels;
- never-confirmed `stopping`/`stopped` channels;
- `registering` channels older than 5 minutes;
- any channel past its grace.

On every path, the token, the resource id, a live target, and the connection's current status, generation and owner
still apply. Tests: P16b (state matrix) and P16d (revoked, old generation, paused, disconnected).

**Why a seamless renewal leaves no undetected gap.** Let Google establish channel B at `t_B`, before our
`watch_result`. Take a change at time `t`:
- **If `t ≥ t_B`,** Google notifies B, which is active and accepted.
- **If `t < t_B`,** Google notifies A, which was live at `t`. A is still sending until `t_B + renew_overlap_s` at the
  earliest, and the seamless rule guarantees it has not expired by then. A delivery Google sends during that time is
  accepted. A delivery that arrives after A is stopped or expired (in flight, or a retry of a `503`) is accepted for
  `late_grace_s`.

Every accepted notification starts a full read of every enabled tab of the spreadsheet *after* acceptance. That read
diffs against receipts and the identity ledger, so it covers `t` and any earlier miss.

**Residual risk.** A notification Google holds longer than the overlap and then discards because A was stopped, or
delivers more than `late_grace_s` after A ended. Gate E/F measures notification delay against these defaults, and
both are configurable without a migration. Tests: P10, P16a, and push e2e scenario 10b (through the real receiver
and maintenance).

**Genuine interruptions reconcile by event** (P10b and P16c). These each end in a fresh activation, which queues
one catch-up:
- expiry without a successful renewal (maintenance registers `recover`);
- an old channel that would expire inside the overlap;
- reconnect;
- key rotation;
- stopping-only coverage (stop-all or release followed by a new registration).

Enable, Resume, save and Review apply kick through the API hooks. No periodic read was added.

### 18.3 What Google Drive notifications cannot guarantee
1. Delivery of every change. A notification can be lost.
2. Any maximum delay. Sheets edits are reportedly batched at about 3 minutes (R2).
3. Content. A notification says only that the file changed (`X-Goog-Changed` is coarse), never which rows.
4. Loss detection. Message numbers increase but are not sequential, so a gap proves nothing.
5. A signal when Google stops sending on a channel, other than its expiry.
6. Automatic renewal. Channels expire (files: at most 24 h).
7. Delivery of pending notifications after `channels.stop` or expiry. This is undocumented, so we assume the worst.
8. Retries beyond a bounded backoff, and only after 500/502/503/504. An outage longer than Google's retry period
   loses notifications.
9. A signature. Authentication is only our channel token.
10. That rows written through the Sheets API notify at all (R3, Gate E).

**What AgentFlow therefore cannot detect:** a notification Google never sends for a healthy channel. Such a row is
imported at the next accepted notification for that spreadsheet (any later change), the next event-driven catch-up,
or Sync now. There is **no periodic spreadsheet polling**. The UI never promises instant or guaranteed detection.
