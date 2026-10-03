# FEATURE — Contact Conversation History and operational Activity

**Status: Chris approved branch implementation with “Start the build” on October 3, 2026. Production mutation, deployment and main merge remain unauthorized.**

Audit date: October 2 PDT / October 3 UTC, 2026. Repository: `cgarness/agentflow-life-insure`. Main inspected and rechecked: `40e0deaed008dafb3674235930bf7bb941546989`. Production Supabase: `jncvvsvckxhqgqvkppmj`.

At the audit handoff, only the review artifact existed. The build checkpoint below records the subsequently approved branch implementation. No production mutation or deployment has occurred.

## 1. Recommendation and approval boundary

Preserve the three-column Contact page, existing tabs, Follow-ups card, call-card shell, composer, recording player and voicemail player. Add the missing trustworthy call details and replace the Activity tab’s incomplete local array with a paginated operational-history reader.

Recommend **C: a hybrid**:

1. Communications remain canonical in `calls`, `messages` and `contact_emails`. Activity reads concise summaries from those records; it does not copy complete conversation cards or create a second call telemetry store.
2. Preserve existing `contact_activities` as legacy recorded history and the existing disposition writer’s output. Do not rewrite or delete those records.
3. Add a small, structured, append-only operational event store for future changes that current-state tables cannot reconstruct: assignment, rescheduling, completion, deletion, status and relevant field changes. Give it source-aware RLS rather than placing sensitive appointment/task history in the existing organization-wide activity table.
4. Use authenticated, security-invoker history readers, strict contact/organization scope, batch name resolution, stable pagination, and one bounded refresh coordinator for the open contact.

Implement in two checkpoints under the approved scope: first the read/display layer and pagination; then operational capture and its database/security regression suite. Neither checkpoint authorizes production application or deployment. A frontend-only first release can improve existing evidence, but must not be called the complete Activity fix.

**Migration required: YES. Historical business-data backfill recommended: NO.** Existing evidence should be read directly; missing historical changes must not be invented. A future evidence-backed repair would require a separate bounded proposal and approval.

## 2. Source-of-truth and concurrency review

Inputs obtained: current `AGENT_RULES.md`, `VISION.md`, complete `WORK_LOG.md` source, and root `implementation_plan.md`. Rules and relevant plan sections were inspected; the 2.16 MB Work Log was searched across its full contents and relevant entries were read. **This audit does not claim a line-by-line reading of every historical Work Log entry.** Before implementation, finish any remaining source-of-truth review required by the project protocol; no historical entry is treated as proof of the current deployment without checking current code/catalogs.

Relevant precedence:

- Rules #8/#12: stored `calls.duration`, no browser timing authority.
- Rules #22: appointment `user_id` is responsible person; `created_by` is scheduler. Quick-call callbacks and campaign callbacks are distinct supported sources.
- Rules #28: production read-only unless exact action approved.
- Rules #30/#32: inbound answering/routing ownership, D13 mobile classification, private voicemail media.
- Rule #31: View-As fail closed; Contact details remain blocked there. New code must not widen that allowlist.
- Rule #36: use saved authoritative records; failed saves do not become activity.
- Rule #39: permanent organization/phone DNC disposition fix is shipped; its writers, receipts, admission and queue behavior are not refactored here.
- Conversion moves the existing polymorphic graph; immutable `clients.lead_id` is lineage, not a live FK.
- Root plan §17 / dedicated Contact Follow-ups release record: preserve the September 29 layout and ownership changes. Root §19: preserve the Main Dialer’s corrected appointment instant and creator. Root DNC pointer and §21: preserve current DNC and Team-display work.
- Earlier Conversation History rulings preserved card design and deliberately left the broad calls SELECT unchanged. This task explicitly authorizes investigating and changing the read projection; that prior scope restriction is not a reason to retain unused debug payload.

GitHub: six open PRs were observed: #398 underwriting, #383 leaderboard resilience, #382 leaderboard containment record, #381 work-log closeout, #378 Google OAuth, #294 AI realtime. **#378 overlaps `src/lib/supabase-email.ts`, email functions and root docs**; use a Contact-specific reader instead of changing its email/OAuth paths. The remaining open PRs have no identified application overlap with the proposed Contact reader. All four branch-list pages were inspected (394 branches). Recent DNC/release and inbound branches are relevant; old branch existence does not prove active development. Unpushed work in another coding session is not observable here.

Production migration history confirms DNC `20261003043122`, resume `20261003043738`, Team provenance `20261002184930` / `20261002184954`, and **inbound recent-outbound routing `20261002203426`**, which the newest log says is absent from repository migration history. Do not overwrite live inbound functions from a stale main checkout. This feature needs no voice Edge deployment.

Live source retrieved: voice-status v44, voice-inbound v46, SMS-send v33, SMS-webhook v22, contact-email-send v29, email-sync v30, workflow-executor v23. Database catalogs, relevant live function bodies, RLS, indexes, publications and aggregate population patterns were checked read-only. No authenticated browser walkthrough or role-by-role production UI test was performed. Vercel settings/deployments were not changed or independently audited for this plan.

## 3. Current architecture and confirmed defects

### Conversation

`FullScreenContactView.tsx` loads core Contact resources and later issues three independent communication reads. Calls: newest 300 by `created_at`. SMS: 300 by `sent_at`. `emailSupabaseApi.getContactEmails`: **oldest 300 by ascending `created_at`**. `buildCallItem`, `buildSmsItem`, and `buildEmailItem` map and merge rows; rendering sorts by different timestamp fallback expressions. There is no Load earlier control or exhaustion indicator.

Confirmed:

- The calls SELECT includes `agent_id`, `answered_by_agent_id`, campaign, notes and technical fields. The mapper discards the agent identity, campaign and notes; the card cannot render them.
- No profile or campaign resolution exists for these call cards. The Active-agent assignment roster is not an appropriate historical-agent resolver.
- Outbound `outcome` is not rendered in Details; a generic `completed` status can conceal `busy` outcome. Inbound `completed` alone is not evidence of an answer.
- Missing duration becomes zero; missing/invalid timestamp becomes epoch zero. These are unsafe neutral-value defaults for historical records.
- The SELECT omits `disposition_id`, `routed_agent_ids`, `missed_for_agent_id` and `recording_storage_path`, all relevant to reliable presentation or lookup.
- Paging order and display order differ; there is no deterministic id tie-break. SMS null timestamp ordering and email’s oldest-first cap can omit relevant rows.
- The queries lack explicit organization predicates, and calls use only `contact_id`. New readers need the audited lead compatibility relation and strict organization scope.
- Conversation errors suggest reopening the contact instead of providing in-place Retry.
- The Contact Call button writes “Call initiated” **before** `dispatchQuickCall`, including a no-dialable-number path. It proves a UI request, not a call. The earlier Work Log deliberately preserved this under a narrower task; the present trustworthy-history objective should retire that unsupported claim without changing the dispatch.

### Activity

`activitiesSupabaseApi.getByContact(contactId)` selects `contact_activities` by contact id, ordered only by `created_at`, with no explicit tenant/type predicate or pagination. It requests all matches, but an API row limit can still truncate the result. It batches profiles, but uses a raw UUID when a profile cannot be resolved and labels every null actor “System”.

`FullScreenContactView` loads Activity with notes as part of its core load. Some handlers use `logActivity` and append the persisted returned row. **Status and details-save handlers bypass that helper**, write a row, discard its return, and do not refresh the list. Their secondary logging failure can escape after the primary save already succeeded. Details edits are mislabeled `note` and contain no field changes. Rendering sorts the state array in place.

Tasks invalidate only `['tasks', contactId]`. Calendar mutations update Calendar state, not this Activity array. Campaign attachment refreshes campaign membership only. SMS/email send success updates Conversation but does not reconcile Activity. There is no complete open-contact refresh contract or Activity error/Retry state.

The separate `activity_logs` settings audit is not this Activity tab. Conversion and outbound-email activity can be recorded there and remain invisible here. Its text is not a safe source to parse into structured contact relationships.

## 4. Sanitized production evidence

Home-organization call sample was bounded to the newest 10,000 rows and returned all **5,203** available rows: **5,058 outbound, 145 inbound**. Counts describe population, not correctness of every individual historical value.

| Field / evidence | Outbound | Inbound | Interpretation |
|---|---:|---:|---|
| `agent_id` populated | 5,058 | 22 | Outbound dialing agent; inbound stored AgentFlow answer ownership |
| `answered_by_agent_id` populated | 0 | 0 | Supported mobile attribution, unavailable in this sample |
| Nonempty routed-agent array | 0 | 57 | Historical routing evidence, not answer evidence |
| Campaign id | 3,328 | 0 | Resolve only visible campaign names; no campaign does not prove Quick Call |
| Nonblank call notes | 70 | 0 | Useful optional Details content |
| Disposition id / nonblank name | 1,669 / 1,696 | 0 / 0 | Maintain legacy name fallback |
| Duration present / positive | 5,058 / 3,322 | 145 / 108 | Non-null does not prove answered/talk time |
| Nonblank outcome | 1,093 | 1 | Important secondary semantics; cannot expect it on all rows |
| `is_missed` true | 1,048 | 109 | Apply inbound missed labels only to inbound calls |
| Missed reason | 0 | 69 | Missing older reason stays neutral |
| Voicemail id | 0 | 24 | Preserve private voicemail playback |
| Recording URL / storage path | 1,588 / 1,588 | 5 / 5 | Media existence is not permission to bypass the player |
| Caller ID populated | 4,992 | 145 | Missing outbound endpoint remains Not recorded |
| Nonblank contact phone | 4,817 | 145 | Do not substitute the current contact phone into history |
| Start / end populated | 5,058 / 5,032 | 145 / 140 | End may be absent |
| Recording duration populated | 0 | 5 | Media duration, not canonical call duration |
| Quality, MOS, STIR, provider error, SIP, PDD populated | 0 each | 0 each | No useful normal-card data today |
| Coaching flag true | 0 | 0 | Not normal Contact history content |
| Null contact type | 4,449 | 50 | Strict `contact_type='lead'` would lose real history |

All populated call agent/campaign references in this organization resolved to a same-org database record in the privileged audit. That does **not** prove each viewer may see those records; production UI must retain RLS.

Other evidence:

- 86 appointments: 81 linked to contacts; all 86 have an assignee, only 59 have a creator. 84 Scheduled and 2 Confirmed. No completed/cancelled/no-show example was available in this organization.
- 5 campaign rows retain callback due times, all with callback owners. This is current state, not five complete callback histories.
- 0 tasks and 0 workflow executions in this organization: those future paths require isolated synthetic verification; there was no representative production row to inspect.
- 37 SMS: 34 inbound received, 3 outbound queued; only 8 linked to contacts. Activity has 8 SMS rows. Do not fabricate links for the other 29, or relabel queued as delivered.
- 233 emails: 232 inbound received, 1 outbound sent; only 1 linked to a contact. No email-type `contact_activities` rows. The unlinked messages are not evidence that they belong to any particular contact.
- Existing Activity categories: 1,441 call; 776 status; 478 assignment; 450 note; 66 pipeline; 44 appointment; 10 delete; 8 SMS. Most ordinary rows have no source metadata. The 478 assignment rows carry transfer provenance from a particular historical operation, not proof of a universal assignment writer.
- Six converted clients have six linked calls and 41 activities. The live conversion function explicitly transfers notes, activities, appointments, tasks, calls, messages, emails and workflow executions.
- Largest linked call history in this organization: 20 rows; largest Activity: 34. The 300-row bug is structurally confirmed, but no currently truncated home-org call history was found.
- Relevant Realtime publication members: **calls and campaign_leads only**. Activity, appointments, tasks, notes, SMS and email are absent.
- Existing Activity has only organization indexes, not a contact/time/id composite. Calls have contact and organization/time indexes; email has an effective timestamp expression index without the proposed full tie-break.

### Separate telemetry finding — do not fix in this feature

Both main and live voice-status v44 contain a completed-call fallback using elapsed server time since `started_at` when Twilio duration is absent. This differs from the strongest “Twilio-backed” wording in the rules. The UI must still read **stored `calls.duration` exclusively**, label it Duration, and never calculate a substitute or call it proven talk time. This audit cannot determine which historical rows used that fallback because no per-row provenance flag records it. Any writer correction or historical repair is a separate telephony task.

## 5. Call fields and attribution contract

| Data | Treatment |
|---|---|
| `calls.agent_id`, outbound | Canonical stored dialing agent. Batch same-org profile lookup, including inactive profiles. No current-contact-owner fallback. |
| `calls.agent_id`, inbound | Stored AgentFlow answering ownership; use existing inbound outcome rules. Do not infer an answer from duration or terminal parent status. |
| `answered_by_agent_id` | Mobile answer attribution only with stored forwarded-answer evidence. Never use it to claim an AgentFlow browser answer. Missing on all sampled rows. |
| `routed_agent_ids` | Show “Routed to” in Details; may contain several names. Never choose the first as the answering agent. |
| `missed_for_agent_id` | “Missed for” when present, distinct from actor/answerer. Notification recipients are not answering agents. |
| `duration` | Canonical stored duration; null/invalid is Not recorded; a stored zero is 0:00. No timer arithmetic. In-progress row must not imply a final duration. |
| `disposition_id` / name | Prefer id to resolve configuration; retain the stored name as historical label, with name-only fallback for legacy rows. Do not replace a historical disposition label with current contact status. Colors retain current configured behavior. |
| Status / outcome | Separate stored facts. Give meaningful busy/failed/no-answer or inbound outcome precedence over generic completed in the collapsed summary. Unknown strings render neutrally, not as a successful connection. |
| Campaign | Batch `id,name` from same-org, RLS-visible campaigns. No campaign → Not recorded; hidden/unresolved → Campaign unavailable. Never infer Quick Call. Names are current labels for historically stored IDs, not guaranteed immutable name snapshots. |
| Numbers | Historical `contact_phone` and `caller_id_used`; no replacement from current profile/contact settings. |
| Notes | Stored `calls.notes`, plain text in Details. No body in the collapsed card. |
| Times | Started/ended as recorded, formatted in the existing display timezone. If a fallback created time is used, label it Recorded, not Started. Missing time must not render 1970. |
| Media | Keep `RecordingPlayer(callId)` and `VoicemailPlayer(voicemailId)`. Do not construct public media URLs. Respect pending/unavailable/expired media. Recording duration remains separate. |
| Quality/MOS/PDD/SIP/STIR/provider identifiers/coaching | Exclude from normal projection/UI. STIR and provider error have webhook code paths, but no populated sample; quality/MOS/PDD/SIP had no identified current voice writer. Treat these as debug/legacy-or-unpopulated fields, not fabricated performance metrics. No new debug panel in this feature. |

Collapsed card: Inbound/Outbound Call, agent label/name, date/time, duration, disposition or meaningful status/outcome. Unknown direction is neutral “Call”, not automatically outbound. Missing/unresolvable agent is **Agent unavailable**, never a UUID. For an unanswered inbound row with routing evidence, the agent line may say “Routed to …” rather than imply someone answered.

Details: Contact number, AgentFlow number, Direction, Started/Recorded, Ended, Duration, Agent, Routed to / Answered by / Missed for where supported, Status, Outcome, Disposition, Campaign, Call notes. Use **Not recorded** for absent historical facts. Preserve D13 missed-plus-mobile-answer coexistence.

Resolve unique profile and campaign IDs in bounded batches per history page, not per card. A Map lookup replaces repeated linear profile searches. Cache by real viewer + organization and short lifetime; clear on identity change. RLS-hidden names stay unavailable. Name fetch failure does not erase a real call; it yields the neutral label and a recoverable enrichment state.

## 6. Activity writer audit: A/B/C/D/E

Classification: A = correct persisted event in covered path; B = incomplete; C = duplicate risk; D = missing; E = stale visible Activity. More than one can apply.

| Area | Current finding | Proposed supported evidence |
|---|---|---|
| Outbound call | B/D/E: legacy wrap-up rows cover only some calls; Contact button logs before a call exists. | One concise canonical call summary, updated from the stored call. Remove the unsupported button-generated call claim. |
| Inbound/missed/mobile/voicemail | D/E in contact activities; canonical calls/voicemail exist. | Inbound outcome summary using existing D13 rules; voicemail existence/playback retains its own access check. No inferred answerer. |
| Disposition | A/B/E: new server-authoritative RPC writes a disposition activity with call/membership/operation IDs; older rows mostly lack IDs. | Keep canonical RPC intact. Use exact source links to attach the disposition to the call summary and avoid a second completed-call event. Preserve no-call disposition events. |
| SMS | B/C/E: both live endpoints write concise-ish body snippets when linked; no message id in legacy activity; webhook message/activity retry dedupe is not guaranteed. | Canonical linked SMS summary with actual queued/received/failed status; no duplicate body. Source-qualified message identity; do not silently repair provider duplicates. |
| Email | D/E in this tab; send writes `activity_logs`, sync writes `contact_emails`. | Linked canonical sent/received/failed email summary. Do not infer delivery/opening. |
| Appointments | B/D/E: Contact schedule writes a generic activity, Dialer writes generic status; Calendar create/edit/delete does not write this stream. | Created, assigned/reassigned, rescheduled, completed, cancelled, no-show and deleted transitions, with actor distinct from assignee. |
| Campaign callback | B/D/E: campaign fields are overwritten; legacy appointment shadow can also produce “Appointment scheduled”. | Scheduled, due-time/owner changed, cleared or terminalized. Never label merely cleared as completed. Suppress known Main-Dialer shadow as a second callback; existing signature is heuristic, so no unsupported historical pairing. |
| Quick-call callback | D/B/E: separate supported appointment source. | Follow-up/Call Back appointment lifecycle. Do not force a campaign membership or change its ownership fallback. |
| Tasks | D/E: create/complete/delete APIs exist, no activity writer; task query refresh only. | Created/assigned, meaningful changed, completed and deleted. Reopened only if `completed_at` actually changes back to null; no new reopen/edit UI is added. |
| Contact create/import | D/B: operational rows exist; import audit is batch-level and not consumed here. | Creation from stored evidence; import only through exact immutable import membership. Importer is not assumed to be assigned owner. |
| Contact details/status/owner | B/D/E: FullScreen writes generic note/status; bulk/other surfaces lack a universal writer. | Allowlisted field changes, status old→new and owner old→new from persisted transitions. No-op updates produce nothing. |
| Pipeline | A/B/E: disposition RPC writes name-only pipeline activity; other status paths vary. | Preserve existing exact evidence. New status changes are labeled as status unless a real stage relationship proves pipeline semantics. Leads do not have a general `pipeline_stage_id`. |
| Conversion | B/D/E: graph moves correctly; Convert modal writes separate settings audit with `leadId` and `clientId`. | Exact linked conversion event from existing metadata or new client lineage capture. Do not guess converter from client owner. |
| Merge/archive/delete | D/unsupported: no Contact merge workflow was found; delete uses existing permission RPC. | Capture actual supported deletion/status transitions; do not introduce merge/archive capabilities. Deleted contact has no current detail page; keep event safely retained, not a new deleted-contact browser. |
| Notes | B/D/E: Contact add/delete logs generic text; pin/unpin is not logged; Dialer notes may exist only as activities. | Added/deleted/pinned/unpinned, and edit if a real content update occurs. Keep note text in Notes or existing recorded-note evidence, not duplicated in generic operation events. |
| Campaign membership | D/E: attachment/removal changes canonical memberships; Contact only refreshes Campaigns. | Added, removed, meaningful terminal/state and ownership changes; omit locks/heartbeats/retry countdown noise. |
| DNC | B/D/E: disposition activity exists; phone-level suppression is canonical elsewhere. | Describe the confirmed disposition/removal and any directly proven DNC operation. No name-based inference that an arbitrary old disposition added DNC; no history-time phone matching or mass fan-out to guess old contact links. |
| Automation | D/E: separate execution/step records and source mutations. | Material source changes captured like manual changes; label actor System unless explicit trusted automation provenance exists. Execution summary only from exact linked successful steps, not every workflow wake-up. |

No production tasks, workflow executions or terminal appointment examples existed to establish runtime coverage; tests must construct them locally.

## 7. Why the hybrid, and its exact capture boundary

| Option | Benefit | Failure for this requirement |
|---|---|---|
| A: only fill `contact_activities` writers | Familiar existing table | Browser-only logs miss server/import/automation paths; generic strings lose before/after and dedupe keys; its existing SELECT policy is too broad for copying restricted appointment/task history. |
| B: only union current source tables | Accurate existing communications, no extra write load | A current appointment cannot reconstruct three past reschedules; a deleted task disappears; current owner is not historical actor. |
| C: canonical reads + structured future operations | Preserves telemetry authority and historical mutations while avoiding a second communication store | Requires a migration, source-aware permissions, dedupe rules and bounded observer overhead. Recommended. |

Proposed `public.contact_history_events` stores: immutable event id and recorded time; non-null organization; source table/id; source contact id/type; action; authenticated actor id or explicit system/automation actor kind; assignee before/after; an allowlisted before/after payload; optional exact correlation/operation id; capture version; and minimal access facts needed for safely retaining deleted-source events. No broad row dumps, secrets, payment account fields or copied email bodies.

Database observer functions capture actual INSERT/meaningful UPDATE/DELETE on **appointments, tasks, contact_notes, leads, clients, recruits and campaign_leads**. They compare only approved business fields. Ignore pure `updated_at`, call counters, locks, heartbeat, retry timing and conversion contact-id-only rewrites. No observer on `calls`, no changes to Twilio webhooks, no changes to `advance_campaign_lead`, DNC admission, routing, locks or reminders.

Campaign callback/campaign terminal state is observed at the membership boundary, not reimplemented. Existing DNC activity/linked source evidence is read, not a new DNC writer. An organization-wide DNC operation with no persisted contact relationship is not falsely retroactively assigned to a contact. Recording all such operations against all duplicate contacts would require a separately specified phone-history model and is out of scope.

Observers necessarily run within source transactions, including some transactions invoked by Dialer/automation. They must be small and bounded, acquire **no new business-row locks**, make no network calls, and contain audit failures so they cannot abort dialing, disposition, conversion or workflow-independent CRM writes. Record a capture-failure diagnostic where possible and emit a server warning. A recorder outage means history can be incomplete; the UI must never promise an infallible audit trail. Release verification must exercise fault containment and measure hot-path overhead. If implementation cannot contain failures and keep calling behavior unchanged, defer that observer and return the exact scope decision for review; do not quietly change the dialer transaction’s failure semantics.

The new table is needed rather than adding sensitive events to `contact_activities`: its current policy exposes same-org rows and even null-org rows, independent of appointment/task access. Do not change that legacy policy or its existing Dialer/Agent consumers in this task. The new reader can narrow legacy results to exact org/contact/type without claiming to harden the old direct API.

**One writer per new event:** the database observer owns operational transitions; remove overlapping FullScreen generic write calls after capture is enabled. Existing Dialer/Edge legacy logs remain untouched. They are not promoted to second structured events. Retry of an unchanged row creates no transition; an actual change-back is a new event, not suppressed by a permanent old/new hash.

Deduplication is only by exact event/source/correlation identity. Do not fuzzy-match timestamps, agent names, note text or phone numbers. For old unlinked records, retain an explicitly labeled **Earlier logged activity** section inside Activity; keep it separate from authoritative structured events rather than pretending their relationship can be recovered. Dialer activity-only notes remain available as recorded notes. Known linked disposition entries can enrich their call summary. A legacy record remains historical evidence, not authoritative duration/answer telemetry.

## 8. Pagination and read contracts

Two authenticated security-invoker RPCs are proposed: `get_contact_conversation_page` and `get_contact_activity_page`. They accept a validated contact id/type, bounded page size and opaque versioned cursor; derive/verify organization from the authenticated context; require the contact to be visible in its existing source relation; and retain underlying source RLS. No client-provided agent list or privileged role is accepted. A denied read is not an empty history.

Page size: **30 displayed rows**, plus one to establish `hasMore`; hard maximum 100. No all-history browser fetch and no separate exact-count request. Each union branch is bounded before the global merge, but the **global page is selected after the merge**. Never independently offset sources. Queries need index/explain checks with representative synthetic volumes before adding indexes.

Conversation key: effective event timestamp + fixed source rank + source id. Calls use start then created; SMS sent then created; email direction-appropriate received/sent then created. SQL computes the same expression used for order and cursor. Missing times live in a deterministic null bucket and display Not recorded. `id` is always the tie-break. Filter mode is part of the cursor; Calls/SMS/Email filters page their full source, not just the already-loaded All slice.

Activity key: immutable recorded/event timestamp + source rank + event/source id. Distinguish the event’s recorded time from appointment due time and a legacy current-state row’s `updated_at`. Never turn an appointment’s current start time into a historical reschedule timestamp.

Cursors bind viewer, organization, contact/type, filter, schema version, source cutoff and last emitted key. Refresh starts a new page generation; late results from an old generation cannot append. Changed source timestamps or conversion invalidate the old cursor chain. A fixed upper bound excludes new inserts from an in-progress page chain; on refresh, reload the retained visible window and merge by source identity. Keyset pagination prevents ordinary offset drift; it is not a multi-request PostgreSQL transaction snapshot. Tests must cover backdated inserts and timestamp corrections, and force a refresh when the chain can no longer be trusted rather than claim gap-free snapshot consistency across arbitrary edits.

Load earlier is visible whenever `hasMore`; preserve scroll anchor when prepending. New sends may scroll to the latest entry, but older-page loads must not snap to the bottom. The current unconditional scroll-on-items-change must be narrowed.

Do not show “complete history.” Exhaustion means **No more recorded events available**. Initial failure, successful empty, loading older, and stale-refresh failure are distinct. A failed source cannot silently yield a plausible partial All timeline.

## 9. Refresh and saved-row behavior

Create one Contact history hook/coordinator shared by Conversation and Activity:

- Scope keys include real viewer, org, contact type/id, perspective and filter. State is withheld synchronously on key change; stale starts and finishes are both rejected.
- Keep activity/history loading independent of contact core/notes so its failure cannot strand the Contact page.
- After successful Contact save/status/note/campaign/message actions, invalidate history and re-read persisted rows. No fabricated local history items.
- Calendar and Tasks data-layer success paths emit a scoped invalidation signal. The open Contact hook coalesces signals; source writers do not create UI-shaped event objects.
- Realtime on existing published sources can accelerate refresh. Do not add organization-wide unfiltered calls subscriptions.
- Because most sources are not published, include explicit Refresh, refresh when Activity becomes active and on focus/reconnect, and a **60-second visible/online active-contact reconciliation**. Stop while hidden/offline or unmounted; coalesce with action refreshes; one request lane, timeout/cancellation and error backoff. No 4-second polling or parallel accumulating fetches.
- When an action is performed in this tab, persisted history should refresh immediately. Events from another user/window are bounded by reconciliation, not falsely described as instantaneous Realtime.
- A failed primary operation produces no new authoritative event. A successful primary save plus failed history refresh keeps the save successful and shows “Saved; history could not refresh”/Retry.
- Tasks/notes delete or complete paths must verify a row was actually affected before emitting a success-based signal. Use `.maybeSingle()` when absence is possible and treat null as unconfirmed, not success.

## 10. Conversion handling

Live `convert_lead_to_client_atomic` moves `contact_notes`, `contact_activities`, `appointments`, `tasks`, `calls`, `messages` including lead-id-only rows, `contact_emails`, and `workflow_executions`. It preserves call telemetry and campaign IDs. The lead is deleted; campaign membership remains, with its live lead FK set null. The new DNC work also preserves private conversion lineage.

Do not edit that RPC in this feature. New events retain immutable source contact identity. A client history reader adds the exact same-org `clients.lead_id` alias for **lead-typed prior history**, after verifying the current client’s visibility. Never union arbitrary matching phone/email contacts. Existing moved records are keyed once by source id. Client-created-with-lineage is a conversion event, not “unrelated new client” plus “lead deleted”; suppress the conversion’s contact-id-only observer noise. A conversion retry cannot duplicate the event.

Future campaign events retain original source identity before lead deletion. Historical campaign attribution after conversion uses exact visible call/membership links where available. Private DNC provenance tables are not exposed or granted to the frontend to fill a missing historical campaign link. An unprovable historical link stays unavailable.

After conversion, cancel old requests, switch to returned `clientId`, reset cursors and read the client’s lineage-aware history. Neither old lead requests nor a delayed refresh may overwrite it.

## 11. Security and actor policy

- Strict `organization_id` on every new read/enrichment path and non-null org on every new event. No null-org compatibility widening. Production calls currently have zero null-org rows in the catalog aggregate; other legacy data is not repaired here.
- New event-table RLS intersects visible current contact and source-record access. A call’s visibility does not grant campaign name or voicemail media access.
- Restricted appointment/task fields must **not** become visible merely because a contact is visible. For existing source rows, use the source’s current RLS visibility. For a deleted source, only a conservative minimal tombstone is available to the recorded actor/creator/assignee or appropriately authorized same-org admin, additionally requiring current contact visibility; no full body is retained for a broader audience. Do not grant general contact owners access to another user’s hidden appointment.
- Invoker readers do not bypass RLS. A private, non-callable trigger function may use narrowly justified definer privilege solely to append authentic source-change events to the protected ledger. Revoke public/anon/authenticated direct event writes and trigger EXECUTE; pin search_path; schema-qualify objects. This is capture authority, not a definer reader added to get around source access.
- Actor for authenticated mutation = actual authenticated actor. Actor for service/internal write = System unless exact trusted automation provenance proves otherwise. Do not infer from task assignee, appointment owner, current contact owner, workflow configuration’s `created_by`, or a null legacy agent field.
- Appointment creator is immutable historical scheduler; assignee before/after is separate. Reminder logic is untouched.
- Profile names are human labels for stored actor IDs. Null/unknown historical actors display Actor not recorded or Agent unavailable; never UUIDs. Null inbound-SMS actor is the contact/system reception event, not a fabricated agent action.
- Existing View-As guards stay in place. Do not mount new Contact readers in a blocked View-As route, write preferences there, or emit mutations with the operator’s identity under an impersonated label.
- Run Supabase advisors after any separately approved production migration, report unrelated pre-existing findings separately.

## 12. Exact intended file manifest

**Before implementation, recheck main/PRs and print this manifest again. Files below are proposed, not edited.** “Data” means behavior if later deployed/applied, not permission to mutate production now. “Telephony” means dialing/routing/ownership/telemetry behavior.

### Existing files

| File | Why / behavior change | Production data effect | Telephony effect |
|---|---|---|---|
| `src/components/contacts/FullScreenContactView.tsx` | Mount scoped history hook/Activity component; pass call enrichment; refresh after successful actions; remove unsupported call-button activity claim and redundant generic operational logs once capture exists; keep layout/dispatch. | Stops redundant UI-origin audit rows; existing business save paths retained. | No dialing change. |
| `src/components/contacts/conversation-history/conversationTypes.ts` | Preserve actor/routing/campaign/notes/outcome; nullable trustworthy fields; source-aligned timestamps. | None; mapping only. | None. |
| `src/components/contacts/conversation-history/CallHistoryItem.tsx` | Add agent to existing card and secondary details; neutral missing data/outcome priority. | None. | None. |
| `src/components/contacts/conversation-history/CommunicationDetails.tsx` | Allow explicit neutral missing-value text and readable multiline notes without redesign. | None. | None. |
| `src/components/contacts/conversation-history/ConversationTimeline.tsx` | Load earlier, Retry/Refresh states and scroll-anchor preservation. | None. | None. |
| `src/lib/supabase-activities.ts` | Add scoped legacy-page adapter/neutral actor mapping while preserving `AgentModal` compatibility; do not silently change other consumers’ source. | None to business rows; existing add API retained. | None. |
| `src/lib/tasksApi.ts` | Confirm affected row and emit post-success history invalidation for create/complete/delete. | Existing task operations only; no new fake history. | None. |
| `src/lib/supabase-notes.ts` | Confirm affected note rows and emit post-success scoped history invalidation. | Existing note operations only. | None. |
| `src/contexts/CalendarContext.tsx` | Emit post-success contact-history invalidation; retain scheduler/assignee/sync/reminder rules. | Existing appointment operations only. | None. |
| `src/integrations/supabase/types.ts` | Surgical new history table/RPC contracts matching approved SQL. | None. | None. |
| `src/components/contacts/conversation-history/__tests__/conversationTypes.test.ts` | Mapping/neutral-value/canonical-duration regressions. | Tests only. | None. |
| `src/components/contacts/__tests__/fullScreenContactViewConversation.test.tsx` | Existing card/compose/media behavior plus scoped history integration. | Tests only. | None. |
| `src/components/contacts/__tests__/conversationDispositionColors.test.tsx` | Preserve configured badge colors and existing neutral fallback. | Tests only. | None. |
| `AGENT_RULES.md` | Propose documented history-source/actor invariants; preserve all old rules. | None. | None. |
| `WORK_LOG.md` | Newest-first implementation/verification record after approved work. | None. | None. |
| `implementation_plan.md` | Add pointer/status to the dedicated approved plan; preserve unrelated plans. | None. | None. |

### New files

| File | Why / behavior | Production data effect | Telephony effect |
|---|---|---|---|
| `src/lib/contact-history/types.ts` | Typed page/event/actor/cursor contract. | None. | None. |
| `src/lib/contact-history/queries.ts` | Authenticated history RPC adapters; batched profiles/campaign labels; errors, bounds and cancellation. | Read-only. | None. |
| `src/lib/contact-history/presentation.ts` | Pure canonical/legacy event formatting and exact-source dedupe. | None. | None. |
| `src/lib/contact-history/refresh.ts` | Scoped invalidation/coalescing keys, no row cache across viewers. | None. | None. |
| `src/hooks/useContactHistory.ts` | Paged, generation-guarded loading and bounded refresh. | Read-only. | None. |
| `src/components/contacts/activity/ContactActivityTimeline.tsx` | Existing Activity-column presentation with pagination/error/legacy evidence states. | None. | None. |
| `src/components/contacts/activity/ContactActivityItem.tsx` | What/who/when/old→new/assignee labels, no full communication card. | None. | None. |
| `src/lib/contact-history/__tests__/historyQueries.test.ts` | Scope, batching, failure, pagination and source authorization contracts. | Tests only. | None. |
| `src/lib/contact-history/__tests__/historyPresentation.test.ts` | Attribution, duplicate handling, nulls and legacy semantics. | Tests only. | None. |
| `src/hooks/__tests__/useContactHistory.test.tsx` | Stale-start/finish, refresh, pagination, conversion and identity races. | Tests only. | None. |
| `src/components/contacts/__tests__/contactActivityTimeline.test.tsx` | Operational event rendering and saved-row updates. | Tests only. | None. |
| `src/components/contacts/__tests__/contactHistoryMutationRefresh.test.tsx` | Real Calendar/Task/Note/Contact success/failure refresh contracts. | Tests only. | None. |
| `supabase/tests/contact_history.sql` | Synthetic PostgreSQL/RLS/conversion/capture/pagination tests. | Local tests only. | None. |
| `scripts/run_contact_history_tests.sh` | Run isolated SQL suite with locality guards and production-derived policies. | Local tests only. | None. |
| `.github/workflows/contact-history-backend.yml` | Isolated PostgreSQL verification gate, no production credentials. | None. | None. |
| `supabase/ops/contact_history_disable.sql` | Guarded disable-only recovery template; retains captured history. | Only if separately approved/executed. | Never rolls back DNC/voice behavior. |
| `docs/plans/2026-10-03-contact-history/implementation_plan.md` | Dedicated approved specification copied from this review artifact. | None. | None. |

Two **new migrations** are required, with stable descriptive names:

1. `contact_history_read_model`: invoker readers and only explain-justified pagination indexes.
2. `contact_history_operational_events`: new protected event/health objects, source-aware policies and bounded observers; update Activity reader to include them.

Exact CLI-generated migration files: `supabase/migrations/20261003154258_contact_history_read_model.sql` and `supabase/migrations/20261003154259_contact_history_operational_events.sql`. Both are authored and locally tested; neither is applied to production. No applied migration was edited.

No planned edits to DialerPage, FloatingDialer, TwilioContext, voice/SMS/email Edge Functions, workflow-executor, existing disposition/DNC/queue functions, reminder eligibility, `supabase-email.ts`, Reports or Leaderboard. SMS/email/automation summaries read existing canonical evidence. If an implementation finding needs any excluded file or an additional migration, update the plan/file list before proceeding.

## 13. Why frontend changes alone are insufficient

Frontend can display agent names and paginate existing rows. It cannot reconstruct an old appointment time after overwrite, retain a deleted task, observe changes made by a different browser or service reliably, or atomically capture actual old/new values for every writer. Copying restricted data into the existing broadly readable log creates a privacy problem. The migration provides durable structured observations and source-aware access; it does not change business decisions.

Indexes should be composite organization/contact/type/time/id where source columns permit, or expression indexes matching effective timestamp branches. Validate query plans before deciding final definitions; do not create one index per speculative future field. Set bounded lock/statement timeouts in migration, test against the exact production-derived baseline, and apply during an explicitly approved release window.

## 14. Historical handling / no backfill

Read existing canonical communications, exact import membership, linked conversion logs, current appointment/task evidence and existing recorded activities without writing reconstructed events. Label current-state evidence accurately; a scheduled appointment row proves its stored current schedule, not each historical change. For unlinked old logs, preserve the record separately, not a guessed source join.

Do not reconstruct missing agents, reschedules, deletes, DNC phone history, campaign provenance, unlinked SMS/email contacts, or duration provenance. No fuzzy timestamp/phone/content dedupe and no cleanup of old duplicates. Old rows stay unchanged. Display the capture-start boundary for detailed operational changes and avoid a claim that every past event is present.

## 15. Verification plan after approval

1. Recheck HEAD, open PRs, exact live object definitions and migration drift. Preserve the fresh DNC release and Google work. Record baseline hashes for protected disposition/conversion/queue functions and policies.
2. Run focused mapping/component tests for outbound/inbound/missed/mobile/voicemail, unknown agent/campaign, inactive profiles, null duration/time/direction, legacy dispositions, busy-versus-completed, notes, media playback, existing badge colors and unchanged three-column layout.
3. Synthetic pagination: >300 calls/SMS/emails, equal timestamps, missing primary timestamp, mixed sources, filter switching, backdated insert, timestamp correction, page-boundary retry, conversion during load. Every source identity appears once under a stable generation; no silent source exhaustion.
4. Synthetic operational lifecycle: create/change/no-op/change-back/delete; appointment actor vs assignee, reschedule/completion/cancel/no-show; campaign and quick-call callbacks, shadow handling; tasks complete/reopen/delete; contact/import/assignment/status/conversion; notes pin/delete; campaign attach/remove/terminal state; proven automation changes. No workflow completion label on a failed/unconfirmed write.
5. Real PostgreSQL role tests: anonymous denied; Agent/Team Leader/Admin scopes; different org; source-hidden appointment/task/email/campaign; deleted-source tombstones; null org; no event forging; profile/campaign enrichment; View-As zero-query/zero-write boundary in frontend tests.
6. Concurrency and conversion: simultaneous updates produce distinct events; retries/no-op writes do not duplicate; stable lineage after lead deletion; conversion idempotency; no false mass edit/delete events from graph transfer; stale requests cannot paint another contact.
7. Refresh: saved rows visible without reopening; failed primary action creates no event; history-refresh failure does not negate saved business data; hidden/offline pauses; reconnect coalesces; no parallel accumulating requests; unrelated contact events do not cause organization-wide reloads.
8. Capture fault injection: source write/call/disposition/conversion remains functional; observer diagnostics are visible operationally; no audit trigger changes queue locks, DNC outcome, call ownership, canonical duration or reminder recipient. Measure source-write latency under synthetic dial/import volume; stop for material regression.
9. Run `npx tsc --noEmit` **and** `npx tsc -p tsconfig.app.json --noEmit`; root solution-style command alone checks no app files. Compare app diagnostics to fresh main instead of claiming its pre-existing errors were fixed. Build, lint touched files and run relevant broader Contact/Follow-ups/Calendar/View-As/Conversion/DNC/inbound regression suites. Do not weaken tests to obtain green.
10. Before production release, review exact SQL/full file manifest, SQL role tests, query plans, rollback and capture boundary. Production apply, frontend merge/deploy and any historical mutation need Chris’s separate exact approval. After an approved apply: catalog readback, advisors, genuine user-session UI checks and no PII in reports.

No test suite was run during this read-only planning audit; no code was implemented. The test cases above are acceptance requirements, not completed evidence.

## 16. Rollback / recovery

Frontend: revert only this feature’s UI/read wiring to its previous Contact implementation. Do not roll back the DNC release, inbound migrations or Google work.

Backend: guarded disable-only migration/template can stop the new observers/readers if performance or access is wrong. Keep captured events and original source records; do not drop history as “rollback”. Restore compatible reader behavior or fix forward. Disable failing capture before redeploying an old reader, and truthfully record the coverage gap. Index removal, ACL/policy changes and production disable actions are separately approved operations. No recovery grants broader source access, re-enables a forbidden call path, or reverses `is_missed` monotonicity.

## 17. Risks, scope estimate and out-of-scope items

**Production risk now: none from mutations; inspection only. Proposed implementation risk: moderate**, concentrated in event-capture overhead, source-aware history permissions, conversion lineage and merged paging. The call-card display itself is low risk. The new observers indirectly execute during some Dialer source transactions, even though no telephony behavior is edited; that distinction must remain explicit.

Estimated scope: **two implementation checkpoints, roughly 4–6 focused engineering days including SQL/RLS/concurrency and UI verification**, subject to current main drift and test environment availability. It is not a one-file UI patch. Estimated manifest: 16 existing files, 17 new non-migration files, and 2 CLI-named migrations; scope expansion requires a manifest update.

Tradeoffs: history can show only records the viewer may read; historical completeness is limited by evidence; names reflect currently resolvable profiles/campaigns; old unlinked logs cannot be perfectly deduplicated; observed service actions may remain System; polling reconciliation is bounded, not instantaneous; capture faults preserve CRM availability and may leave a documented audit gap.

Out of scope: Contact redesign; new tab structure; new telephony architecture; queue locking/admission/ownership/disposition/DNC behavior; inbound routing/forwarding/recording policy; reminder ownership; telemetry duration correction; existing RLS hardening beyond the new history objects; unlinked-message matching; SMS delivery infrastructure; email OAuth or deliverability changes; historical backfill/repair/deletion; campaign ownership semantics; Contact merge/archive features; task editing/reopen UI; workflow engine correctness fixes; Reports/Leaderboard changes; public debug IDs or new technical-details panels.

## 18. Approval request and handoff

Approve the functional/read-model/event-capture design and proposed file manifest for isolated branch implementation and tests. This is **not** permission to apply migrations, change hosted policies, mutate business data, merge to main or deploy. Before SQL authoring, print the CLI-generated migration filenames; before any production action, present the exact migration/release and recovery package.

Remaining audit limitations are explicit: not every historical Work Log entry was read line by line; no production task/workflow or terminal-appointment example existed; no signed-in browser verification; full behavioral RLS matrix and performance/fault tests remain implementation gates; migration filenames are now CLI-generated and recorded below. These must not be represented as completed checks.

Ready for your approval to begin file modifications.

## Build checkpoint — October 3, 2026

Main/PRs rechecked: unchanged at `40e0dea`. Isolated branch `codex/contact-history-20261003`. CLI-generated migration paths: `supabase/migrations/20261003154258_contact_history_read_model.sql` and `supabase/migrations/20261003154259_contact_history_operational_events.sql`. No applied migration changes. Supabase changelog/RLS docs reviewed; current grants will be explicit.

Build manifest refinement: `src/components/contacts/conversation-history/SmsHistoryItem.tsx` and `EmailHistoryItem.tsx` also change, only to render missing timestamps neutrally. No production writes or telephony effects. Necessary to satisfy the approved no-fabricated-history requirement across the unified reader.

Regression manifest refinement: `src/components/contacts/__tests__/fullScreenContactViewQuickCall.test.tsx`, `fullScreenContactViewSaveFailure.test.tsx`, `fullScreenContactViewSchedule.test.tsx`, `fullScreenContactViewStatusSave.test.tsx`, and `src/contexts/__tests__/calendarAddAppointmentOwnership.test.tsx` update obsolete browser-log expectations and saved-row readback mocks. Tests only, no production or telephony effects.

## Implementation handoff — branch only

**Built:** existing Contact layout/tabs retained; call attribution and secondary details; canonical communication summaries, legacy evidence section, structured future operational history, 30-row keyset pagination, source-aware invoker reads, scoped name batches, serialized saved-row refresh, explicit capture-start/gap labels, and source-write failure containment. Both migrations are required before this frontend can be released.

**Verification:** 36 frontend/invariant test files: **408 passed, 6 skipped**. Root `npx tsc --noEmit` passes; the separate application project check retains exactly **88 existing diagnostic fingerprints**, matching main, with zero new errors. Vite production build passes with existing chunk-size warnings. Scoped ESLint passes. PostgreSQL **16.15**, disposable local cluster: actual source SELECT policy expressions against synthetic rows, >300 records per communication source, same-time ties, bounded merged pages, null timestamps, tenant/source restrictions, blocked event forgery, attribution, callbacks, no-op/lock noise, conversion graph simulation, deletion tombstones, failed capture and real concurrent ledger-lock containment pass. The source call-page index is used (31 rows, 4 shared buffer hits in the small fixture); this is not production-scale performance proof. CI is authored for PostgreSQL 17.6 but has not run remotely.

**Exact verification limits:** no signed-in browser or live-agent test; no hosted migration/RLS test, complete historical migration replay, or production-scale load test. Conversion testing simulates the existing graph moves and separately passes the existing conversion contract suite; it is not a full hosted atomic-conversion execution. The fixture uses actual audited SELECT policy expressions with isolated identity/hierarchy helpers, not a full Supabase deployment. The audit's full historical Work Log was searched, not read line by line.

**Evidence decisions:** do not infer workflow actors from task creators or assignees; successful workflow step status alone is not proof of a mutation. Material workflow changes appear through the observed source mutation or canonical communication. No new workflow-executor writes. Ambiguous callback shadow/legacy rows are retained as separately labeled recorded evidence rather than deleted via fuzzy matching. Historical campaign linkage after conversion is only available from retained event identity or an RLS-visible exact call/membership link. A history page chain is not a multi-request MVCC snapshot: refresh after corrections; calls/email updates invalidate cursors when their source update time advances. SMS has no general update timestamp, so arbitrary historical SMS clock rewrites are not detectable through a complete revision token. No UI promises complete historical coverage.

**Rollback:** separately approve source/UI rollback and the guarded `supabase/ops/contact_history_disable.sql`; it disables the new readers/observers and retains captured data. Never drop event history, change legacy RLS, or revert DNC/voice/queue/reminder functions. Both new migrations precede frontend rollout; no frontend-only rollout removing old logs.

**Publication:** no remote branch push/PR, main merge, Vercel deployment, Supabase apply, backfill or live dial. Remote publication may automatically create a Vercel preview and therefore remains outside this no-deployment build.

### Migration checksums

- `supabase/migrations/20261003192907_contact_history_operational_events.sql` — SHA-256 `4ab202ccd47675b2439f5fa8d34d028292da6441d497afc2ef14820d6766587f`
- `supabase/migrations/20261003192857_contact_history_read_model.sql` — SHA-256 `2ebadc7e277ac600bdc77d1ff6a4693d9cbb67f84250f7352aea0c200161c81d`

### Final exact changed-file list

- `.github/workflows/contact-history-backend.yml`
- `AGENT_RULES.md`
- `WORK_LOG.md`
- `docs/plans/2026-10-03-contact-history/implementation_plan.md`
- `implementation_plan.md`
- `scripts/run_contact_history_tests.sh`
- `src/components/contacts/FullScreenContactView.tsx`
- `src/components/contacts/__tests__/contactActivityTimeline.test.tsx`
- `src/components/contacts/__tests__/contactHistoryMutationRefresh.test.tsx`
- `src/components/contacts/__tests__/conversationDispositionColors.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewConversation.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewQuickCall.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewSaveFailure.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewSchedule.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewStatusSave.test.tsx`
- `src/components/contacts/activity/ContactActivityItem.tsx`
- `src/components/contacts/activity/ContactActivityTimeline.tsx`
- `src/components/contacts/conversation-history/CallHistoryItem.tsx`
- `src/components/contacts/conversation-history/CommunicationDetails.tsx`
- `src/components/contacts/conversation-history/ConversationTimeline.tsx`
- `src/components/contacts/conversation-history/EmailHistoryItem.tsx`
- `src/components/contacts/conversation-history/SmsHistoryItem.tsx`
- `src/components/contacts/conversation-history/__tests__/conversationTypes.test.ts`
- `src/components/contacts/conversation-history/conversationTypes.ts`
- `src/contexts/CalendarContext.tsx`
- `src/contexts/__tests__/calendarAddAppointmentOwnership.test.tsx`
- `src/hooks/__tests__/useContactHistory.test.tsx`
- `src/hooks/useContactHistory.ts`
- `src/integrations/supabase/types.ts`
- `src/lib/contact-history/__tests__/historyPresentation.test.ts`
- `src/lib/contact-history/__tests__/historyQueries.test.ts`
- `src/lib/contact-history/presentation.ts`
- `src/lib/contact-history/queries.ts`
- `src/lib/contact-history/refresh.ts`
- `src/lib/contact-history/types.ts`
- `src/lib/supabase-activities.ts`
- `src/lib/supabase-notes.ts`
- `src/lib/tasksApi.ts`
- `supabase/migrations/20261003192857_contact_history_read_model.sql`
- `supabase/migrations/20261003192907_contact_history_operational_events.sql`
- `supabase/ops/contact_history_disable.sql`
- `supabase/tests/contact_history.sql`


## Review publication checkpoint — October 3, 2026

Chris authorized review publication after the implementation handoff (“Continue”; “finish the task”). Draft PR: https://github.com/cgarness/agentflow-life-insure/pull/407. Rechecked current main `84829dfe59e1da4d3ab5974bb1b763f5a886008c` and all six open PR heads; merged the concurrent floating-dialer/A2P releases with no Contact runtime overlap. Both work-log additions were preserved. Published runtime commit `2c0370be2e192ef94755749570b5c43c29e566ff` has tree `52e1aed1795043498a9d8a6bbab4da49dbc1318c`, exactly matching the local candidate. The 42-file feature manifest and SQL hashes above are unchanged.

Post-merge verification: 256 tests passed, 5 skipped in 27 passing files. The additional addLeadAssignmentGate suite fails for missing Supabase configuration identically on main; a first unbounded-worker run timed out once, and the bounded-worker rerun passed every collected test without assertion changes. Root tsc and Vite build pass; actual application TypeScript has the exact same 88 diagnostic lines as current main. PostgreSQL 17.6 Contact history CI run `37146071813` passes; DNC `37146071756` and full frontend `37146071820` were running when this checkpoint was written. Final results/check links for the documentation follow-up head are maintained on PR #407.

Primary preview `dpl_EahArSRuJkspLWygWTBn6dTYhk2Q` and secondary `dpl_AJGf1YnuXkeRNcdXjVXTkZNiFcgF` are READY at the runtime commit, with preview target and no alias errors. Primary URL: https://agentflow-1hbberjia-cgarness-projects.vercel.app. Its HTML and generated JavaScript return HTTP 200 and include the history reader. This is asset/build verification only: no authenticated browser Contact walkthrough or hosted migration test is claimed. Preview build success does not make the new readers available against an unmigrated database.

Production remains held. No migration apply, data/backfill, main merge, production deployment, Edge replacement or customer action occurred. Apply only the two approved Contact history migrations in dependency order after exact release approval and a fresh catalog/main preflight; do not bulk-push the repository's pending migrations. Their authored timestamps predate the subsequently applied A2P migration, so any production migration-history reconciliation must be explicit, recorded, and retain these reviewed SQL bytes. Hosted source-RLS/conversion validation and production-volume evidence remain release gates.


## Full-suite compatibility correction — exact manifest now 43 files

Run `37146187444` compared current main and the branch successfully through both type checks and all frontend tests, then correctly rejected three additional failed assertions in `src/pages/__tests__/contactDeepLinkDuplicateParity.test.tsx`. All three required an old browser activity insert after a successful canonical update. The approved implementation instead captures operations in the database and rereads persisted history. This is an obsolete integration expectation, not permission to weaken duplicate-detection or the comparison gate.

**Additional file:** `src/pages/__tests__/contactDeepLinkDuplicateParity.test.tsx`. Test only; no production data or telephony effect. Update the Supabase RPC fixture to a valid history page, retain all duplicate detection/refusal/exactly-one-update checks, require zero frontend activity writes and a fresh contact-scoped Activity query on save. All 50 tests across this file, save-failure, status-save and history-hook suites pass, as do scoped ESLint and diff checks. The three documentation files above record this correction; no other file or runtime behavior changes. The earlier 42-file manifest plus this one file is the final **43-file** manifest.

The first full run has 4,014 passing base tests and 4,036 passing candidate tests, the same 88 app diagnostic lines and zero unhandled runtime errors. Its only additional failed test names are the three corrected assertions. Both sides retain the pre-existing recording-retention test failure and the same configuration-dependent failed files. Keep the full comparison unchanged and rerun on the corrected head; final status/evidence links are recorded on PR #407. No production release or migration apply is authorized by this correction.


## Authorized production backend checkpoint — October 3, 2026, 12:29 PDT

Chris instructed “begin the next steps to complete the task” after the explicit migration/release handoff. This authorizes the reviewed two-migration release and PR #407 frontend rollout after verification. No separate historical backfill, synthetic production data, customer calls/messages, voice/Edge deployment or permission broadening is included.

Main remains `84829dfe`; PR #407 runtime/test head `73c85571` has all three checks green: PostgreSQL 17.6 run `37147072283`, DNC run `37147072298`, and full frontend run `37147072333`. Full comparison: 4,039 candidate tests pass vs 4,014 on main, identical existing failure set, the same 88 app diagnostics, zero unhandled errors; scoped lint/root tsc/build pass. Both previews are READY.

Preflight: no recent active calls or long-running transactions; calls about 5,251 estimated rows / 6.6 MB including indexes; other source tables smaller. Applied only the reviewed migrations with 3-second lock and 60-second statement timeouts. Supabase assigned:

| Authored version | Applied version / file | SQL MD5 |
|---|---|---|
| 20261003154258 | `supabase/migrations/20261003192857_contact_history_read_model.sql` | `dfd13959e746a1a71f1fad90182daccd` |
| 20261003154259 | `supabase/migrations/20261003192907_contact_history_operational_events.sql` | `31238cf33e95e4fa335cb19854caceb7` |

Applied statements exactly match reviewed file bytes and the SHA-256 values above. Filename reconciliation and the isolated test runner references change only; no SQL body changes or migration replay.

Catalog readback: both tables have RLS; authenticated SELECT only, no authenticated/service/anonymous writes, no anonymous SELECT. All seven public functions are invoker with empty search_path; anonymous execution denied. The private capture function is definer, empty search_path, and uncallable by anonymous/authenticated/service roles. Seven enabled source observers. A hosted call with no authenticated identity is denied by the reader guard (42501), with no claims or user impersonation. Capture began `2026-10-03T19:29:07.59474Z`; initial event/error counts zero, no historical writes. No security-advisor finding involves a new Contact history object. Unrelated existing advisor findings remain, including the existing [public-table RLS notices](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public); this feature does not change them.

Before/after protected fingerprints match exactly: non-history public/private functions/owners/ACLs `044ed64f385d33e83a9cf5fe9070559f`; source policies `a61aa971365abd31ce4e53e47373b947`; existing source triggers `394f215e89d473516c7f8d9f62cfad45`. Telephony/disposition/DNC/conversion/queue behavior remains unchanged by definition and privilege fingerprint.

Release remains staged: preview is behind Vercel sign-in. Genuine authenticated hosted history/UI checks remain required before frontend rollout; do not impersonate a user in SQL or extract browser credentials to replace them. Reconcile filenames/docs and rerun the unchanged CI gate, obtain the secure login when needed, then merge the approved PR and verify normal Vercel production deployments. Production backend is installed; frontend has not been merged/released at this checkpoint. The exact same disable-only recovery remains available under separate recovery approval, retaining captured history.

Release reconciliation touches only the two migration paths, `scripts/run_contact_history_tests.sh`, `AGENT_RULES.md`, `WORK_LOG.md`, root `implementation_plan.md`, and this plan. Runtime source is unchanged. Final verification/merge/deployment evidence will be recorded on PR #407.
