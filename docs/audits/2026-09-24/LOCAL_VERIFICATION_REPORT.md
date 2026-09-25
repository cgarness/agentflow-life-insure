# Team/Open lead details: isolated LOCAL verification report (rev 7)

**Outcome:**
- 12 of 12 authenticated local browser scenarios **PASSED** (S01–S11 plus S06b): 0 failed, 0 blocked.
- The Personal scenario (S10) was also run once on clean `main`, for comparison.
- The scope is exactly what §2 lists. The coverage limits in §4 are part of the result.

**Approval and boundaries:**
- Chris approved the run on 2026-09-24 in this session: a disposable local stack with synthetic fixtures.
- No application code was changed.
- No hosted project was touched: no production query, `supabase link`, remote push or deploy, Vercel change or
  hosted staging.
- The verification pass itself committed nothing. These artefacts (this report, the plan and WORK_LOG
  updates, and the test-only harness and evidence under `e2e/team-open-local/`) were published afterwards,
  under Chris's separate approval limited to docs and test artefacts.

**Code under test:** feature branch `claude/lead-details-team-open-pool-03hfuh` at `ee24e7d9`. Comparison:
clean `main` at `f78140d7`.

**Evidence:** `e2e/team-open-local/evidence/INDEX.md`.
- **Screenshots:** the 22 original files, byte-identical, with sha256s listed.
- **Scenario JSON:** sanitized and derived from the original run, with the raw file's sha256 recorded.
- **Recorded results:** items marked *(recorded)* were recorded during the run and **not re-run** for
  publication.

**Unavailable or not published:**
- the raw `evidence.json` files (they held the local demo anon JWT inside Realtime URLs);
- raw Vitest, tsc, ESLint and build outputs, summarised in `gates-summary.json` with each raw file's sha256;
- earlier exploratory and intermediate runs (not published; kept only in the disposable session workspace).

**Transcribed only.**
- The following exist only as verbatim transcriptions of session output in `evidence/SESSION_RECORDS.md`:
  the isolation proofs (R3), the inline key and locality checks (R7), image and PostgREST provenance (R1),
  the Realtime failure (R2), the RLS baseline (R4), the user-id mapping (R6) and the session-time S10
  comparison (R5).
- The mocked-suite counts in §3 (9 files, 123/123, and the per-file 16/15/11/3) have **no raw file**. They
  come from session console output and the rev 5 WORK_LOG, and are marked "transcribed" in
  `gates-summary.json`.

## 1. Environment and isolation

| Item | Value |
|---|---|
| Container runtime | Docker 29.3.1. `dockerd` was started in this container for the run and stopped afterwards. |
| Supabase CLI | Repo-pinned `supabase` 2.84.5. |
| Project identity | A disposable copy of `supabase/` with `project_id = "agentflow-localverify"`. The repo `config.toml` is unchanged. |
| Services run | Postgres `17.6.1.095`, GoTrue `v2.188.1`, PostgREST `v14.7` (see provenance below), Kong `2.8.1`, storage-api `v1.44.11`, pg-meta `v0.96.1`. |
| Services **not** run | **Realtime**, edge-runtime (Edge Functions), Studio, mailpit, imgproxy, analytics, pooler. |
| Frontend | The real app, served by test-only `e2e/team-open-local/vite.local.config.ts`. It binds 127.0.0.1:8089, never reads repo `.env` files, refuses a non-loopback Supabase URL, and swaps only `@/lib/twilio-voice` for the fake Voice.js boundary. |
| Browser | Pre-installed Chromium with Playwright 1.56.1 (global install, outside the repo). No dependency or lockfile change. |

### Realtime

- Realtime **was not running**. Its container cannot bind a listener on this kernel, which has no IPv6
  (`eafnosupport`).
- It was disabled in the disposable workspace config (`[realtime] enabled = false`).
- The browser's Realtime WebSocket targeted `ws://127.0.0.1:54321/realtime/v1` and failed locally.
- **Realtime-driven behaviour was NOT tested:** live queue metrics, presence, calendar and notification
  channels.

### Image provenance

- **Policy-denied hosts:** the ECR and GHCR blob hosts are denied by this environment's egress policy (403).
  They were not routed around.
- **Docker Hub:** all images except PostgREST were pulled from Docker Hub (an allowed host) after
  rate-limit retries.
- **PostgREST v14.7** was never pullable (Docker Hub 429 on every attempt).
  - The image was **built locally** (`FROM scratch`) from the official PostgREST `v14.7` `linux-static-x86-64`
    release tarball, downloaded from github.com.
  - The binary reports `PostgREST 14.7`.
  - The tarball's locally computed sha256 is
    `3fb8d83b10b964d0258cf47d3b1775d8c38e4b8fae791f9efb0e7550973c6960`.
  - **It is NOT checksum-verified:** the release's `.sha256` asset returned 404, and no published digest was
    obtainable. Its integrity rests only on the TLS download.
  - The image was deleted at teardown.
- **Details:** `evidence/SESSION_RECORDS.md` R1–R2.

### Migrations applied LOCALLY

`evidence/local-migrations.txt` holds the local `supabase_migrations.schema_migrations` after `db reset`: all
20 repository files, in order.

- **Versions:** `20260806000000`, `20260811200920`, `20260811201250`, `20260811201401`, `20260812042319`,
  `20260819163413`, `20260820233402`, `20260823203257`, `20260823222528`, `20260823222805`,
  `20260823222926`, `20260914000530`, `20260915025931`, `20260915035141`, `20260915053646`,
  `20260918000614`, `20260918002859`, `20260919052941`, `20260919183544`, `20260922222659`.
- **Plus:** `supabase/seed_reference/bootstrap_reference_data.sql`, run by `docker exec` into the local
  container.
- **Nothing was applied to any hosted project.**

**Reported differences from production.** These come from repository records only; production was **not**
queried in this pass.
- **Baseline:** `20260806000000_baseline_production_schema` is a production-derived snapshot with **no
  production history row**. The repository records it as the sole pending migration (WORK_LOG 2026-08-25
  reconciliation entry).
- **The other 19 local versions:** recorded in the repository as applied in production. Sources:
  - `20260811200920`, `20260811201250`, `20260811201401`: WORK_LOG 2026-08-11 S3 entry;
  - `20260812042319`: WORK_LOG 2026-08-12 apply entry;
  - `20260819163413`, `20260820233402`: WORK_LOG 2026-08-20 entries;
  - these six are also in the 2026-08-25 reconciliation table;
  - `20260823203257`, `20260823222528`, `20260823222805`, `20260823222926`: AGENT_RULES #30;
  - M4–M7 (`20260914000530`, `20260915025931`, `20260915035141`, `20260915053646`): the D13 amendment
    (AGENT_RULES line 239);
  - M8 `20260918000614`, M9 `20260918002859`, `20260919052941`: WORK_LOG apply entries;
  - `20260919183544`: AGENT_RULES #34;
  - `20260922222659`: AGENT_RULES #37.
- **Stale records that contradict this:**
  - the "NOT APPLIED" headers of AGENT_RULES #32 and #33;
  - the AGENT_RULES #30 header's "seven legacy … versions that do not match" (six were realigned on
    2026-08-25; the baseline is the remaining one);
  - the authoring-time status headers inside **13** of the 20 migration files, all written before those files
    were applied. Applied files are immutable by invariant #25.
    - "NOT YET APPLIED ANYWHERE": `20260918000614`, `20260918002859`, `20260919052941`, `20260922222659`.
    - "NOT APPLIED to jncvvsvckxhqgqvkppmj": `20260919183544`.
    - "NOT been applied remotely": `20260823203257`.
    - Local-only or gated wording: `20260819163413`, `20260820233402`.
    - "Development-only": `20260823222926`, `20260914000530`, `20260915025931`, `20260915035141`,
      `20260915053646`.

  The later WORK_LOG apply records supersede all of these.
- **Production-only versions:**
  - Production carries `20260923224254 emergency_pause_org_leaderboard_20260923`, which is not in the
    repository and therefore **not in the local schema**. Source: D-7 read-only `list_migrations`, plan §2,
    2026-09-24.
  - Production also carries 262 pre-baseline history rows (as recorded on 2026-08-25) that are not in the
    active `supabase/migrations/` chain. **All 262 match archived files by name**, under
    `supabase/migrations_archive/pre_baseline/` (WORK_LOG 2026-08-11 correction: 0 by-name mismatches).
    34 of them have no archived file with the same **version prefix**, because of the renamed and duplicate
    prefixes documented in the archive README.

**Current production-schema parity is NOT established.** Local results describe the repository migration
chain. An earlier draft of this report and of the rev 7 WORK_LOG entry said inbound v2 M4–M7 and
`20260919052941` were "not applied in production". That was **incorrect** and is corrected here.

### Server-side isolation

These controls were applied after image pulls and before any migration or fixture.
- **`iptables` rules** tagged `agentflow-localverify`:
  - drop NEW flows leaving the stack bridge (container egress);
  - drop NEW flows into the bridge from other interfaces;
  - drop NEW flows from the bridge to host services;
  - drop non-loopback connections to the published ports 54321/54322 (the CLI binds 0.0.0.0).
- **Probes:**
  - On the **first** stack start (earlier bridge, same rules), container → 1.1.1.1:443 failed, container →
    host service failed, and loopback API health returned 200.
  - On the **final** stack, `isolation.sh verify` ran the egress probe twice (after migrations, and after the
    last scenario); it failed both times. The host-service probe was not repeated there.
  - The egress probe shows egress was blocked; it does not show which control blocked it.
- **Database-triggered HTTP:**
  - Only two functions contain `net.http_*`: `private.workflow_dispatch_event` and
    `public.handle_new_organization_provisioning`.
  - Both configs were empty: `workflow config url=<empty>` and `twilio provisioning url=<empty>` in the full
    verify output (`SESSION_RECORDS.md` R3). Provisioning logged "skipped". Workflow dispatch failed its queue
    insert inside the swallowing wrapper (AGENT_RULES #10).
  - `net.http_request_queue` = 0 and `net._http_response` = 0 at the end.
  - `cron.job` has two inbound sweeps with no HTTP calls.
- **Edge Functions:** not running. The app's `send-welcome-email` call on sign-in reached
  `127.0.0.1:54321/functions/v1/…` and got 503; **no email was sent**.
- **Vite process:** started with `env -i`: only `PATH`, `HOME`, `NO_PROXY` and the two local `VITE_SUPABASE_*`
  values.
- **Production ref:** absent from the workspace `config.toml` and the disposable env files. The copied
  migration files mention it in comments only. The anon key's issuer (`supabase-demo`) was checked inline at
  setup, and the service key's issuer is checked by `bootstrap.mjs` (`SESSION_RECORDS.md` R7).

### Browser-side isolation

- Chromium `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"` and
  `--no-proxy-server`.
- A route guard aborted and recorded every non-loopback **HTTP(S)** request.
- **WebSockets were only recorded** (`page.on("websocket")`), not guarded, in the recorded run. Every recorded
  WebSocket host was loopback.
- The resolver rules block hostnames but not IP literals.
- A `routeWebSocket` guard and `route.fallback()` in scenario routes were added after the run (§6).
- **Observed destinations** (14 sessions):
  - pages/HMR `127.0.0.1:8089`;
  - Auth, REST, RPC and Functions `127.0.0.1:54321`;
  - WebSockets `127.0.0.1:8089/` (HMR) and `127.0.0.1:54321/realtime/v1/websocket` (which failed).
- **The only non-loopback attempt** was `fonts.googleapis.com`, which was blocked.
- **No external or production traffic was observed.** No request reached `*.supabase.co` or any
  non-loopback host.
- **What did run locally:** the scenarios necessarily used the **local** database, Auth and API heavily.
- The app's `warnIfSupabaseUrlHostMismatch` logged its expected warning and did not fall back.

### Sessions and fixtures

- **Sessions:** genuine local GoTrue sessions via the real `/login` page.
- **Agents:** ordinary `Agent` users with default permissions (`contacts.leads.view_unassigned` = false,
  `contacts.leads.edit` = true).
- **Organization claims:** `app_metadata` (`organization_id`, `role`) comes from the app's own
  `on_profile_update` trigger.
- **Service key:** used only by the Node fixture bootstrap, never in the browser.
- **Fixture credentials:** generated at runtime, outside the repository.
- **Reset:** all fixtures were reset to baseline before every scenario.

| Org | Users | Data |
|---|---|---|
| LV Main Test Org | Admin, Agent One, Agent Two | Team campaign (both Agents), Open Pool, and Agent One's Personal campaign. Leads: Tessa (Team, unassigned), Oliver and Olga (Open, unassigned), Owen (Open, owned by Agent Two), Pat (Personal, Agent One). |
| LV Second Test Org | Agent B | Its own Open Pool and lead Bianca. |

- **Custom fields:** Policy Interest, Dependents `0`, Coverage Amount, Smoker `false`, Blank Note `""`, and a
  custom **Email** (name collision with the standard field).
- **Internal keys:** `__agentflow`, `tags`, `additional_policies`.
- **Org layout:** includes Policy Interest, Dependents and Blank Note. It **omits** Coverage Amount, Smoker and
  the custom Email.

**RLS baseline** (`evidence/SESSION_RECORDS.md` R4):

| User | Readable `leads` | Readable `campaign_leads` |
|---|---|---|
| Agent One | Pat only | All 5 org-A campaign copies. This is the existing `campaign_leads_select` Agent policy (the Open Pool exposure is finding F3, live-confirmed in D-7b). It is established from unchanged source, since the branch changes no `supabase/` file. |
| Agent B | Bianca only | Bianca only |
| Admin | All 5 org-A leads | — |

## 2. Scenario evidence (feature branch, one consolidated final run)

For every row, the external behaviour listed under **Simulated** was not real. The Voice.js SDK was always
replaced by the fake boundary. That covers the Voice access-token fetch, Device registration and Call events; no
Twilio request was made. Lead reads, `claim_lead`, permissions, saves and conversion were **real
local** calls under RLS.

| # | Role, fixture | UI action | Observed UI | Local DB result | Result | Simulated |
|---|---|---|---|---|---|---|
| S01 | Agent One; Tessa (Team, unassigned) | Start Team → Call → ringing → accept | Idle, dialing and ringing: **no details**. Connected: the notice "The full contact record isn't available to you yet — showing this campaign's copy…" plus the campaign copy (name, phone, email, state, source, age). No custom fields, notes or other master-only data. Edit disabled with its explanation. | Lead still unassigned. Lock held by Agent One on Tessa's campaign lead. One outbound `calls` row with that `campaign_lead_id`. | PASSED | Ringing (early media) and accept |
| S02 | Agent One; Tessa | Accept → Hang Up → **Not Interested** → Save (ordinary claim path) | Master details load. Order: First, Last, Phone, Policy Interest, Email, State, Dependents `0`, Source, Age, Notes, then Assigned Agent, Coverage Amount `250000`, Email (Custom), Smoker `No`. Blank Note, `__agentflow`, `tags` and `additional_policies` are not shown. | `claim_lead` set `assigned_agent_id` and `user_id` to Agent One. | PASSED | Accept and hang-up |
| S03 | Agent One; Tessa (claimed) | Edit → Policy Interest "Term 30", Age 42, State OK → Save Edits | "Contact updated"; new values shown. | Only `Policy Interest` changed in `custom_fields`; all other keys, including `0`, `false`, `""` and internal keys, are unchanged. `leads.age` 42, `leads.state` OK. Snapshot `state` OK. Snapshot `age` stays 41 **by design**: only name, phone, email and state are snapshot-synced (`teamOpenLeadEdit.ts:11`). | PASSED | Accept and hang-up |
| S04 | Agent One; Tessa (claimed) | (a) Phone "abc" → Save. (b) Draft "Should Not Save" after a privileged SQL reassignment of the lead → Save. (c) State NM while the snapshot PATCH fails in transit → Save | (a) "Enter a valid phone number"; draft kept. (b) "…This contact is not available to you. Nothing was saved."; draft kept. (c) "Contact saved, but this campaign's copy of the name/phone/email/state could not be updated…"; the card keeps showing the old snapshot State, as the message warns. | (a) Nothing written. (b) Unchanged (Policy Interest still `Term 20`): RLS hid the row from the save's pre-write read, so **no UPDATE was sent**. The server-side refused-UPDATE branch was not exercised (§4). (c) `leads.state` NM; snapshot state TX. | PASSED | (b) Privileged local UPDATE reassigning the lead, then a second privileged UPDATE restoring ownership before (c). (c) Browser-level failure of the snapshot PATCH only; the leads PATCH was real. |
| S05 | Agent One; Open Pool (A = Oliver, B = Olga) | Claim A while A's post-claim master **GET** is delayed 6 s → Skip to B → wait past the delayed read | B's card shows no lead-A data. B was idle (not connected), so the details component was not rendered for B. | A claimed. The lock moved to B. | PASSED | Browser-level 6 s delay of the GET only; **no delayed save was exercised** (see §4 and the INDEX label note) |
| S06 | Agent One; Tessa | Call → ringing → disconnect. Call again → accept emitted on the **previous** Call → accept on the current Call → Hang Up → inbound ring → reject | Unanswered: never revealed. Previous attempt's late accept: **not** revealed. Current accept: revealed. Wrap-up keeps the reveal. Inbound ringing: **masked**. After the inbound ended, the answered attempt's campaign copy was shown again. | — | PASSED | Voice.js events on specific Call objects; inbound Call via the fake Device |
| S06b | Agent One; Tessa | Connected and revealed → the Agent's lock row is deleted | The details became masked **after the client detected the loss through its heartbeat**. That session recorded one `renew_lead_lock` call, and masking was observed within the 45 s polling window. This is client-side detection of a server-side change, **not instantaneous server-side revocation**. | Lock removed; the dialer then held another lock. | PASSED | Lock row deleted by a privileged local actor (models expiry or admin release) |
| S07 | Agent One and Agent Two concurrently; Open Pool | Both start the Open Pool | Different leads served. | Locks: Agent One → Oliver, Agent Two → Olga. Agent Two's owned lead (Owen) was not served to Agent One. | PASSED | — |
| S08 | Agent One; Tessa | (a) Pre-claim: notes → **Sold** → Save. (b) Claim while the post-claim GET fails → notes → Sold → Save → toast action **Retry loading record** | (a) "This sale can't be completed in this dialer flow yet…"; disposition and notes kept; no modal. (b) Notice "could not be loaded… Retry". Sold toast "…can't be converted yet… nothing has been saved" with Retry. Retry sent exactly **one `GET /rest/v1/leads`**: no RPC, no conversion. Afterwards the record loaded and the notes were kept. | No `clients` row. (a) Nothing claimed. | PASSED | (b) Browser-level failure of the post-claim GET, removed before Retry |
| S09 | Agent One; Tessa (claimed, record loaded) | Sold → Save → Convert modal → synthetic carrier → **Convert Lead** | Modal "Closing the sale for Tessa Teamlead"; conversion completed. | `clients.custom_fields` kept Policy Interest, Dependents `0`, Coverage Amount, Smoker `false`, the custom Email, `__agentflow`, `tags` and Blank Note `""`. **The stored `additional_policies` array was dropped** (existing behaviour, O2). The client's assignee is non-NULL: the conversion copies the lead's assignee, which the claim had set to Agent One. The lead was deleted. One win, whose `agent_id` is Agent One's local id (`SESSION_RECORDS.md` R6). | PASSED | Voice.js |
| S10 | Agent One; Personal lead Pat | Start Personal → Call → accept | The legacy Personal card; no Team/Open component. | No lock row. | PASSED | Accept |
| S10 on `main` | Same, on clean `main` `f78140d7` | Same | The **complete** `<main>` innerText (681 characters, under the 700-character capture cap: header stats, badge, lead card fields and notes, conversation panel, call controls, dispositions, Save buttons) is **identical** to the feature branch after normalising the clock. The only raw difference is the lead-local clock line. Not compared: sidebar, top bar, form-field values, visual rendering. | No lock row. | PASSED | Accept |
| S11 | Agent B vs org A; Agent One vs org B | Authenticated REST reads with each real session token; org B's dialer | Org B's dialer lists no org-A campaign. | Reads of org-A leads by Agent B, and of org-B's lead by Agent One, each returned `200 []`. | PASSED | — |

**What the S09 result does and does not show:** it shows that ordinary stored custom fields survive a
loaded-record conversion under the current implementation. It does **not** prove lossless conversion,
because `additional_policies` was lost.

**Console errors** (application; excluding blocked fonts, the local Realtime WebSocket and its channel errors,
the notifications "unread count" fetch errors, and the expected host-mismatch warning):
- 7 × `406` on `PATCH /rest/v1/leads`:
  - 6 from O1: the pre-claim status update on a claiming save (S02, S03, S04, S05, S08, and the first in
    S09);
  - 1 in S09 from the same status update after the conversion had deleted the lead.
- 4 × `503` from `functions/v1/send-welcome-email` (Edge Functions not running);
- 2 × `ERR_FAILED` (the intentional S04c and S08b failures);
- 3 transient "Failed to fetch" (profile and notifications) at session start.

## 3. Automated results *(recorded; not re-run for publication, except as noted)*

Derived counts and names are in `evidence/gates-summary.json`. **The full suite is not green:** one test
fails on both the feature branch and clean `main`.

**Without Supabase env** (`VITE_SUPABASE_*` unset):

| Tree | Tests | Passed | Failed tests | Failed files (Vitest failed-suite count) | Skipped |
|---|---|---|---|---|---|
| Feature `ee24e7d9` | 3264 | 3251 | 1 | 12 (13) | 12 |
| Clean `main` `f78140d7` | 3141 | 3128 | 1 | 12 (13) | 12 |

- 11 files fail to load with "supabaseUrl is required".
- The 12th file is `recordingRetentionVoicemail.test.ts`, with one failing test.

**With the local Supabase env** (`VITE_SUPABASE_URL=http://127.0.0.1:54321` plus the local demo anon key):

| Tree | Tests | Passed | Failed tests | Failed files (Vitest failed-suite count) | Skipped |
|---|---|---|---|---|---|
| Feature `ee24e7d9` | 3364 | 3351 | 1 | 1 (2) | 12 |
| Clean `main` `f78140d7` | 3241 | 3228 | 1 | 1 (2) | 12 |

- The 11 previously failing files now load and pass.
- **The one failing test (both trees, both environments):** `recordingRetentionVoicemail.test.ts` >
  "handler wiring the authentication and conversation-recording purge are byte-identical to deployed v29".
- **Skipped (all runs):** 12 tests in `localCalendar.test.ts`.

**Other recorded results:**

| Check | Result |
|---|---|
| Team/Open mocked suites (jsdom; no real Supabase; kept **separate** from the authenticated run above) | 9 files, 123/123 |
| `teamOpenRevealIntegration` (real `TwilioProvider`, fake SDK) | 11/11 |
| `npx tsc --noEmit` | exit 0, but it compiles **no files** (`"files": []`), so it proves nothing. Re-run during publication: same. |
| `npx tsc -p tsconfig.app.json --noEmit` | 91 errors on both trees; identical line-insensitive multiset. **Re-run on the feature tree during publication:** 91, same multiset, none in `e2e/`. |
| `npm run build` (feature) | OK |
| Touched-file ESLint | Feature: the 20 changed `.ts`/`.tsx` files give 3 errors and 18 warnings, all in `src/pages/DialerPage.tsx`. `main`: only the 2 of those files that exist there, with the same 3 and 18 in the same file. |
| Mutation proof (rev 5, recorded) | **12 mutations caught; 2 assessed redundant** |

## 4. Coverage limits: NOT tested in this run

- **Not exercised in the authenticated browser run; covered only by the all-mocked hook tests**
  (`useTeamOpenMasterLead` 16/16, `useTeamOpenLeadEdit` 15/15):
  - the **A→B→A** return (the ordinary queue does not re-serve A after it is claimed or skipped);
  - **delayed-save / old Save or Retry callbacks across a lead change**;
  - **mid-load viewer (sign-in) changes**.
- **The server-side refused-UPDATE branch of the inline-edit save** ("You don't have permission to edit this
  contact"). S04(b) stopped earlier, at the RLS-filtered pre-write read. The refused-UPDATE branch is covered
  only by the mocked `useTeamOpenLeadEdit` test "a failed update keeps edit mode and the draft".
- **S05's scope:** lead B was idle, so the details component was not rendered for B. S05 shows that B's card
  carried no lead-A text; it does not show B's rendered details rejecting a stale read.
- **Realtime-driven behaviour:** Realtime was disabled.
- **Real calls, Twilio webhooks and their timing, recordings, audio quality and inbound routing:** NOT
  tested. Local `calls` rows created by simulated events are **not** evidence of Twilio behaviour.
- **Edge Functions:** not running.
- **Production-schema parity:** not established (§1).

## 5. Findings and observations (recorded; nothing fixed)

No new defect was found in the Team/Open lead-details implementation. Each item below states how
"pre-existing" was established.

| # | Observation | Basis |
|---|---|---|
| O1 | The dialer save's master `status` update (`leadsSupabaseApi.update(masterId, { status })`, which uses `.single()`) targets the **lead** id. On a claiming Save it runs **before** `claim_lead`: RLS returns 0 rows and PostgREST answers 406, so the lead's status stays "New" while the activity feed shows the disposition (`S02-postclaim-details.png`). After a conversion it also targets the already-deleted lead (a 406 in S09). | **Established from unchanged source:** the save block (status update → `claimOnDisposition`) is line-for-line identical to clean `main`, and `leadsSupabaseApi.update` (`src/lib/supabase-contacts.ts`) is unchanged. **Observed locally on the feature branch.** **Not reproduced on clean `main`**: only S10 ran on `main`. |
| O2 | Conversion drops a stored `additional_policies` array when the modal collects none (`mergeCustomFieldsOnConversion`, `src/lib/supabase-conversion.ts:38-40`). | **Established from unchanged source:** `src/lib/supabase-conversion.ts` and `src/lib/reservedCustomFields.ts` are unchanged from `main`. `SC1_CONVERSION_MERGE_DESIGN.md` §6 proposes keeping the stored array. **Observed locally on the feature branch** (S09). **Not reproduced on clean `main`.** |
| O3 | The Personal card shows "—" for Pat's populated custom values (Policy Interest "IUL", Dependents 2). This is separate from the Personal defects in plan §7.4. | **Reproduced on clean `main`:** S10 on `main` shows the identical text. |
| O4 | `public.get_org_id()` falls back to a `profiles` lookup that recurses under RLS ("stack depth limit exceeded") when the JWT lacks `app_metadata.organization_id`. Real GoTrue tokens carry the claim, so the app path was unaffected. | **Established from unchanged source:** the branch changes no `supabase/` file. **Observed locally only through direct SQL without the claim** (`SESSION_RECORDS.md` R4). Not observed through the app, and **not confirmed in production**. |

**Current limitations** (safeguards intact; nothing was weakened to obtain a pass):
- **Pre-claim master access:** Agents see only the campaign copy until the claim lands.
- **Short-Sold completion:** remains **blocked** under the current approved design (S08).
- **Server-side merge and ownership:** unimplemented proposals (SC-1 plus the short-Sold ownership design);
  they are not part of this build.

## 6. Reproducible setup (local only)

`e2e/team-open-local/README.md` lists the safety properties and file roles.

```bash
# 0. daemon + disposable workspace with a distinct project id (repo config untouched)
dockerd &                                   # if not running
WS=<scratch>/lv; mkdir -p $WS/supabase
cp -r supabase/migrations supabase/config.toml supabase/seed_reference $WS/supabase/
sed -i 's/^project_id = .*/project_id = "agentflow-localverify"/' $WS/supabase/config.toml
printf '\n[realtime]\nenabled = false\nip_version = "IPv4"\n' >> $WS/supabase/config.toml   # no-IPv6 kernels only
# 1. start with migrations held back, isolate, then migrate
mv $WS/supabase/migrations $WS/migrations.hold && mkdir $WS/supabase/migrations
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npx supabase start --workdir $WS \
  -x studio,imgproxy,logflare,vector,supavisor,edge-runtime,mailpit,realtime
e2e/team-open-local/isolation.sh apply $WS
rmdir $WS/supabase/migrations && mv $WS/migrations.hold $WS/supabase/migrations
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npx supabase db reset --local --workdir $WS
docker exec -i supabase_db_agentflow-localverify psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/seed_reference/bootstrap_reference_data.sql
# 2. runtime-generated local credentials (outside the repo) + fixtures
npx supabase status --workdir $WS -o json | node e2e/team-open-local/local-env.mjs $WS
NO_PROXY='*' node e2e/team-open-local/bootstrap.mjs $WS/lv.env.json
e2e/team-open-local/isolation.sh verify $WS
# 3. app (clean env) + scenarios
env -i PATH=$PATH HOME=$HOME NO_PROXY='*' VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=<local anon> \
  node_modules/.bin/vite --config e2e/team-open-local/vite.local.config.ts &
(cd e2e/team-open-local && NO_PROXY='*' CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scenarios.mjs $WS <evidence-dir OUTSIDE the repo> [S01 …])
node e2e/team-open-local/sanitize-evidence.mjs <evidence-dir>/evidence.json <out>.json "<run label>"
# 4. teardown (this task's resources only)
npx supabase stop --workdir $WS --no-backup; e2e/team-open-local/isolation.sh remove $WS
```

**Changes to the harness after the recorded run.** No scenario was re-run with them, and they produced no
evidence. The complete list, with the guard self-tests, is in `evidence/INDEX.md`.
- **Labels:** S04, S05 and S06 `title` / `simulated` labels corrected.
- **New files:** `local-env.mjs` (replaces an inline command used during the run), `sanitize-evidence.mjs`,
  `README.md`, `.gitignore`.
- **Hardening from an adversarial pre-publication review:**
  - `isolation.sh`: fail-closed `apply`; `verify` assertions, including DB-side HTTP/cron state and a
    container-running check before the egress probe; exact-tag `remove` with a recount; IPv6 refusal;
  - path handling: `fileURLToPath` in `bootstrap.mjs`, `scenarios.mjs` and `local-env.mjs`; symlink-aware
    in-repo refusals;
  - `lib.mjs`: `routeWebSocket` guard;
  - `scenarios.mjs`: `route.fallback()`, and refusal of an in-repo evidence directory and a non-loopback URL;
  - `vite.local.config.ts`: refusal of non-demo or `service_role` JWTs;
  - `fixtures.sql` / `reset.sql`: guard-comment corrections.
- **Effect on scenarios:** none changes a scenario's user steps or assertions. The guards were exercised only
  by harness self-tests with no backend.
- **Semantics note:** the scenario page routes' `fallback()` now hands requests to the loopback guard instead
  of sending them directly. For the loopback URLs used, the outcome is the same.

**Teardown performed:**
- Vite stopped.
- `supabase stop --no-backup`: containers, volume and network removed.
- `iptables` rules removed (0 remain).
- Base worktree removed.
- Locally built PostgREST image deleted.
- `dockerd` stopped.

## Addendum, 2026-09-24 (America/Los_Angeles): harness failure-handling fix (implementation_plan.md §11)

This addendum leaves the historical results above unchanged.

**Historical browser verification.** §1–§5 describe the recorded run, which used the original,
pre-hardening `isolation.sh`. Nothing in them changes, and nothing was re-run.

**Correction to §6.** Two post-run hardening claims about the version published at `cb6584af` were not fully
true:
- `verify` could report "egress blocked" when `docker exec` was killed after `PROBE_STARTED` (137/143), or
  when the probe exited 1 with no recognisable network error.
- `remove` (and the `apply`/`verify` counts) ignored failed chain reads, so it could print "0 remain" after
  reads failed.

Both are fixed:
- **Probe:** a validated result envelope, with `docker exec` failure kept separate from the inner probe exit.
  It accepts only a timeout or one recognised connect error. A pass covers one destination only.
- **Chain reads:** checked per-chain reads, shared by `apply`, `verify` and `remove`.

**New offline regression results** (mocked logic checks; `e2e/team-open-local/tests/isolation.test.sh`):

| Script | Cases passing | Of which: the 5 original regression cases |
|---|---|---|
| Fixed | 30/30 | 5/5 |
| Pre-fix (`cb6584af`) | 6/30 | 0/5 (each exited 0 with a false success) |

The pre-fix run's baseline cases pass 4/4 on both versions. The full per-category table is in
`e2e/team-open-local/evidence/INDEX.md`.

**Real-infrastructure checks still NOT run:** the corrected script has not been run against Docker,
`iptables` or a stack. `apply` is covered only through its shared helper.
