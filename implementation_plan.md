# Implementation Plan — Notifications: exactly-once creation, correct recipients, right-side drawer refactor

**Task branch:** `claude/notifications-drawer-refactor-gi8cee` (from `origin/main` `cbc4c49` = PR #360 squash-merge)
**Date:** 2026-08-18 · **Status:** PLAN — awaiting Chris's approval. **No source file modified, no migration applied, no Edge Function deployed, no production data touched.** All production access this pass was read-only (Supabase MCP `execute_sql` SELECTs, `get_edge_function`, `list_migrations`, `get_advisors`).
**Reading:** AGENT_RULES.md (full, v5.0.0) + VISION.md read; newest WORK_LOG entries read (2026-08-18 disposition colors, 2026-08-17 conversation redesign, 2026-08-12 policy dates) — no overlapping notification/inbound-routing/lead-import work in flight. This file supersedes the shipped #360 plan.

---

## 1. Current-state architecture (verified on `main` @ `cbc4c49` + live prod read-only, 2026-08-18)

**Table.** `public.notifications(id, user_id NOT NULL→auth.users ON DELETE CASCADE, type CHECK in (win, missed_call, lead_claimed, appointment_reminder, anniversary, system, inbound_sms, inbound_email), title, body, read bool, action_url, action_label, metadata jsonb, created_at, organization_id NULL→organizations)`. Indexes: pkey, `(user_id, created_at DESC)`, partial `(user_id) WHERE read=false`, `(organization_id)`. **No unique/dedupe constraint of any kind.** RLS: SELECT/UPDATE/DELETE require `organization_id = get_user_org_id() AND user_id = auth.uid()`; **INSERT requires only `organization_id = get_user_org_id()`** — any org member can insert arbitrary notifications for any other member. In `supabase_realtime` publication with **default replica identity** (DELETE events carry only the PK — a `user_id` filter on DELETE is structurally unenforceable). Cleanup: live cron job 8 `cleanup-old-notifications` (03:00 UTC daily) deletes rows > 30 days — data-only (`cron.job`), absent from the baseline migration by nature of schema dumps.

**Writers (all confirmed, exhaustive):**
1. `supabase/functions/_shared/notifications.ts` `insertMissedCallNotifications` (service role) — called from **4 sites**: `twilio-voice-inbound` L794 (fallback chain exhausted / direct line with no identity), L932 (Dial-action no-answer→voicemail path), L1120 (after-hours), and `twilio-voice-status` L359 (no-answer/busy/canceled or `is_missed`, inbound only). Recipient logic: lead `assigned_agent_id` → `calls.agent_id` → **all org Admins + Team Leaders**. Dedupe = SELECT on `metadata @> {call_id}` with `.maybeSingle()`, then insert.
2. `twilio-sms-webhook` L277 (service role) — matched inbound SMS → assigned agent else Admin/TL fan-out. **No dedupe key at all**; `messages.provider_message_id` also non-unique.
3. `email-sync-incremental` L245 (service role) — matched inbound email → assigned agent else Admin/TL. Gated on `wasNewInsert` from the `contact_emails` upsert (`UNIQUE (organization_id, provider, external_message_id)`, `ignoreDuplicates`) — genuinely idempotent today; no per-notification key.
4. `src/lib/win-trigger.ts` `triggerWin` (client, authenticated) — inserts win row (idempotent via `uq_wins_idempotency_key` on the conversion path only), then selects **`profiles` with no org filter** (org scoping is implicit via `profiles_select_org` RLS) and inserts one `win` notification per profile.
5. DB trigger `trg_notify_lead_assigned` — **AFTER UPDATE OF assigned_agent_id only** (no INSERT coverage); fn `notify_lead_assigned()` SECURITY DEFINER, `search_path='public'`, EXECUTE granted to PUBLIC/anon/authenticated (the 2 security-advisor WARNs).
6. `src/lib/notifications-api.ts` — **dead code**: zero importers anywhere; all 8 builders unused.

**Reader/UI.** `NotificationContext` fetches `select("*").eq(user_id).order(created_at desc).limit(100)`; `unreadCount` = filter over those ≤100 rows; Realtime INSERT/UPDATE/DELETE handlers filtered by `user_id`; optimistic markRead/markAllRead/delete with rollback (console-only errors). `NotificationsPanel` is a hand-rolled `fixed top-0 right-0 w-[380px]` panel: 5 category tabs with per-tab unread badges, inline "View Contact" labels, hover-only delete, no loading state (flashes "No notifications"), row click **awaits** markRead before navigating, raw `navigate(action_url)`. `TopBar` opens it and calls `requestPushPermission()` on every open. Browser pushes fire when permission granted AND (tab hidden OR panel closed) — never consulting `profiles.push_notifications_enabled`. A second, independent system (`src/lib/incomingCallAlerts.ts` + TwilioContext) handles incoming-call desktop alerts via its own localStorage opt-in — untouched by this task.

**Preferences.** `ProfilePreferencesCard` saves `email/sms/push_notifications_enabled` to `profiles` columns; verified **no code path reads any of the three** for behavior.

**Inbound routing (twilio-voice-inbound, 1,272 lines).** Flow: signature validation → phone_numbers lookup → per-number + org settings → insert `calls` row (`agent_id: null` explicit, `status: 'ringing'`) → contact match → optional auto-lead → business hours (closed ⇒ mark missed + notify + fallback TwiML) → direct line (Dial owner, action `fallback=voicemail`) or routing mode `assigned`/`all-ring`/`round_robin` (Dial, action `fallback=chain`) → chain tiers (`last_agent`, `campaign_agents`, `state_licensed`, `all_available`) → terminal fallback (forward/hangup/voicemail). **At every decision point the resolved agent user-ids are known in local variables and then lost** — only identity strings reach TwiML, only `call_row_id/org_id/phone_number_id/chain_step/forwarded` survive in action URLs, and nothing ever writes `calls.agent_id` (only `inbound-call-claim` does, on an *answered* call). Live prod: 1 org, `routing_mode='all-ring'`, `fallback_action='voicemail'`, 3 Admin/TL profiles.

## 2. Confirmed root causes (all audit findings reconfirmed live, read-only, 2026-08-18)

Counts match the audit exactly: **79 rows / 53 unread / 73 missed_call from 13 calls / 37 expected pairs / 36 duplicates** (12 calls ×3 recipients ×2 copies; call `7e7de72a…` ×3 copies each); 6 win rows for one win (no dupes); **0 lead rows vs 321 assigned leads created in 30 days**; 4/4 inbound SMS and 106 inbound emails (30-day window; 232 all-time — the audit's number is the 30-day figure) unmatched and correctly silent; all 21 inbound calls have `agent_id` null; 187 security-advisor findings (unchanged), 2 naming `notify_lead_assigned`. Latest applied migration is still `20260812042319` — nothing landed since the audit.

1. **Missed-call duplicates.** Up to 4 helper invocations per call across two functions; the dedupe is read-then-insert (not concurrency-safe — two webhooks pass the SELECT before either inserts), and once ≥2 rows exist for a call the `.maybeSingle()` returns an *error* (not data), which is ignored ⇒ `existingNotif` null ⇒ **every subsequent callback re-inserts a full recipient fan-out**. That is exactly the 2-and-3-copy pattern in prod. The dedupe SELECT is also unscoped by org.
2. **Wrong recipients.** Routed agents are never persisted, `calls.agent_id` is null at webhook time (fallback #2 is dead), so any unmatched/unassigned caller's miss blasts all Admins/TLs — the intended ringing agent is never notified as such.
3. **Zero lead-assignment notifications.** Trigger is UPDATE-only; every live assignment path sets `assigned_agent_id` **at INSERT** (import Edge Function, `leadsSupabaseApi.create`, AddLeadModal). The import Edge Function inserts **all rows in one statement** and stamps `leads.imported_by_user_id`; `import_history` is written client-side afterwards.
4. **Win fan-out** is client-driven, org-scoped only implicitly by profiles RLS, and any authenticated user can hand-craft notification rows for anyone in their org (INSERT policy gap).
5. **UI defects** as audited: 100-row unread count, no loading state, navigation blocked on mark-read, unreliable DELETE realtime, no tests, panel z-50 tie with TopBar.
6. **Preference toggles** are write-only DB state; permission is requested on drawer open, not on enabling the preference.

## 3. Approved product behavior

Notifications stay a **full-height right-side drawer** (no dropdown/popover/modal/page) with backdrop, Escape, mobile full-width. Header: bell, "Notifications", compact unread count, Mark all read, close. Filters: **All | Unread only** (five category tabs removed; no per-filter badges). List: **New** (unread) / **Earlier** (read) groups, newest-first, one compact row (icon, title, one metadata/preview line, timestamp, small unread dot), whole row clickable, no repeated "View Contact" labels, Delete inside an overflow menu, no permanent colored row backgrounds, category identity via icon shape/color. States: loading skeleton, error + Retry, empty, "No unread notifications". Fast: optimistic read + immediate navigation. Truthful browser-push preference. Exactly-once creation; correct missed-call recipients; lead assignment without import spam; win/messages behavior preserved.

## 4. Proposed technical design

### 4.1 Database-enforced idempotency (`event_key`)

- `notifications.event_key text NOT NULL DEFAULT (gen_random_uuid())::text` + **`UNIQUE INDEX uq_notifications_user_event_key (user_id, event_key)`**.
  - *Why NOT NULL + filler default instead of nullable + partial index:* PostgREST's `on_conflict` upsert cannot infer a partial unique index (42P10), and multi-row `INSERT … ON CONFLICT DO NOTHING` semantics are exactly what "one conflicting recipient must not block the others" requires. A volatile default means adding the column rewrites the 79-row table (content unchanged, new column only; sub-second) — noted explicitly, this is not a data backfill.
  - *Why `(user_id, event_key)` and not org-scoped triple:* `user_id` is globally unique (FK to auth.users) and every deterministic key embeds a source-row UUID that is itself org-bound, so the pair is already organization-scoped by construction; adding nullable `organization_id` to the key would *weaken* it (NULL never conflicts). `organization_id` remains explicitly set by every writer (it must not go NOT NULL: `leads.organization_id` is nullable and a trigger insert violating NOT NULL would abort a core lead write — forbidden by the invariant-#10 philosophy).
- Deterministic keys per event, per recipient (the index adds the recipient dimension):
  - missed call → `missed_call:<calls.id>` · win → `win:<wins.id>` · inbound SMS → `inbound_sms:<MessageSid>` (fallback `inbound_sms:msg:<messages.id>`) · inbound email → `inbound_email:<contact_emails.id>` · lead-assignment trigger rows keep the unique filler default (a statement-level trigger fires exactly once per statement and never retries).
- Writers switch to `.upsert(rows, { onConflict: "user_id,event_key", ignoreDuplicates: true })` (Edge) / `INSERT … ON CONFLICT DO NOTHING` (SQL). The `.maybeSingle()` pre-check in the shared helper is **deleted** — the constraint is the dedupe. Concurrent Twilio callbacks, retried webhooks, and repeated win RPC calls each converge to one row per (recipient, event); a partially-delivered earlier attempt fills in only the missing recipients.

### 4.2 Correct missed-call recipients

- `calls.routed_agent_ids uuid[] NULL` — written **only** by `twilio-voice-inbound` (service role) at the moment a Dial wave is emitted; the routing/forwarding behavior itself is untouched:
  - direct line / `assigned` → `[phone_numbers.assigned_to]`; `round_robin` → `[picked.agentId]`; `all-ring` → all rung agents (extend `resolveAllOrgIdentities` to select `id` alongside `twilio_client_identity` — same rows, one more column); chain tiers → the tier's agent ids appended (union) per wave (resolvers already hold the ids internally; they gain them in their return values). Each write is wrapped so a failure is logged and **never** alters TwiML output.
  - After-hours and forward-to-PSTN waves record nothing (no agent was rung / target is an external phone) — documented.
- `insertMissedCallNotifications` recipient priority becomes: **(1)** `calls.routed_agent_ids` (validated as Active profiles in the call's org before use — explicit org scoping, not trust) → **(2)** the dialed number's owner: `phone_numbers.assigned_to` looked up org-scoped by `calls.caller_id_used` (covers legacy rows and any insert-failure gap) → **(3)** the CRM contact's assigned agent (current lead lookup, extended to clients/recruits by `contact_type`) → **(4)** Admins/Team Leaders only when 1–3 produced nobody. A known routed agent can no longer fall through to managers. Multiple legitimate recipients each get one row (per-recipient event key). Answered calls produce nothing (guards unchanged: `DialCallStatus completed/answered` exits before the notify sites; `twilio-voice-status` still requires terminal-missed/`is_missed` + inbound).
- Routing scenarios and their recipient outcome are documented in the helper header: direct line → owner; assigned → owner; round robin → the picked agent; all-ring → all rung agents; fallback chain → union of rung tiers; after-hours → priority 2→4; unanswered forward to the agent's phone → the routed agent recorded before the forward wave; unknown/unmatched caller → same priority chain (never silently dropped).
- Action URL standardized to `/contacts?contact=<id>` (Contacts.tsx L1175 accepts both `contact` and `id`, but the other deep-link effects read only `contact`).

### 4.3 Lead assignment without import spam

Replace the row-level trigger with **statement-level triggers with transition tables** on `leads` (one AFTER INSERT, one AFTER UPDATE), new fn `notify_lead_assignments()`:
- Collect rows where `assigned_agent_id IS NOT NULL` (INSERT) / `IS DISTINCT FROM` old (UPDATE); **skip self-assignments** (`assigned_agent_id = auth.uid()` — hard-claim, self-add, self-bulk-assign) and **self-imports** (`assigned_agent_id = imported_by_user_id`); group by `(assigned_agent_id, organization_id)`; skip NULL-org rows defensively.
- Per group: count = 1 → today's detailed notification (lead name, `/contacts?contact=<id>`); count > 1 → **one summary** "N new leads assigned to you" (`/contacts`). Because `import-contacts` inserts each set in a single statement, a 300-lead round-robin import yields exactly one summary per recipient (clean + flagged sets can add a second — truthful). Type stays `lead_claimed` (no CHECK change); metadata carries `{lead_id}` or `{count}`.
- Entire body wrapped `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING` — notification failure must never abort a lead write (invariant-#10 pattern). SECURITY DEFINER, `SET search_path = public, pg_temp`, EXECUTE **revoked** from PUBLIC/anon/authenticated (old `notify_lead_assigned()` dropped with its trigger — resolves both advisor WARNs).
- Boundary honestly stated: bulk assigns > 1,000 selected rows chunk at 1,000/statement (`bulkAssign`) ⇒ one summary per chunk; batch-import summaries are per-insert-statement, not per `import_history` row (which doesn't exist yet at insert time — it's written client-side afterwards). This is the smallest truthful V1; a per-import single notification would require restructuring import history creation (out of scope, flagged for Chris).

### 4.4 Win notifications

New RPC `public.notify_win(p_win_id uuid)` (SECURITY DEFINER, pinned search_path, EXECUTE granted to authenticated + service_role only): loads the win, requires the **database-authoritative** caller org (`profiles` row for `auth.uid()`, never the JWT claim) to equal `wins.organization_id`, builds title/body server-side from the win row (caller cannot spoof content), fans out to Active profiles **explicitly filtered by `organization_id = wins.organization_id`**, keys `win:<win_id>`, `ON CONFLICT DO NOTHING`. `win-trigger.ts` replaces its profiles-select + direct insert with this RPC (win insert, 23505 handling, celebration flow unchanged). Win idempotency preserved: conversion path keeps `conversion:<lead-id>`; the notification layer is additionally exactly-once per win id even if the RPC is retried.

### 4.5 Message notifications

Rule unchanged: matched inbound SMS/email notifies the assigned agent (else Admin/TL). Add event keys + `ignoreDuplicates` upserts (4.1) so Twilio webhook retries and email cursor replays cannot duplicate alerts. **No unmatched-message inbox is built; unmatched communication remains silent** unless Chris separately approves a broader workflow. (Adjacent, documented, NOT in scope: `messages.provider_message_id` is non-unique, so a Twilio retry can still duplicate the *message row* — its own approval.)

### 4.6 Notification preferences (truthful)

- `maybeFireBrowserPush` gates on `profile.push_notifications_enabled !== false` AND permission granted AND the app is actually hidden/unfocused (`document.visibilityState !== "visible" || !document.hasFocus()`) — replacing the "drawer closed" condition. Alerts get `tag: <notification id>` and `onclick → window.focus() + navigate(action_url)` (validated internal path).
- Permission is requested when the user **enables the toggle** in ProfilePreferencesCard (a user gesture), not on drawer open (`TopBar`'s `requestPushPermission()` call removed). The card shows an accurate status line: enabled / off / **"Blocked in browser"** with recovery guidance (site-settings hint) when `Notification.permission === "denied"`.
- Email + SMS toggles: **recommended treatment — keep visible but disabled with a "Not yet connected" caption** (honest and discoverable; hiding is the alternative). Awaits Chris's exact UX ruling (Open decision D1). No email/SMS delivery infrastructure is added.
- The separate incoming-call alert system (localStorage opt-in, TwilioContext) is deliberately untouched; only the shared browser permission state overlaps, documented in code.

### 4.7 Accurate unread count + scalable loading

- `unreadCount` becomes an authoritative server count (`head:true, count:"exact"` on `read=false`, served by the existing partial index), adjusted optimistically on local actions and Realtime INSERTs, and **reconciled** (count + first page refetch) on: Realtime channel (re)`SUBSCRIBED`, `visibilitychange → visible`, and `window focus`.
- List loads a first page of 30 (`.range()`), "Load earlier notifications" appends pages; newest-first preserved; client state deduplicated by id (Map merge) so Realtime inserts and page fetches cannot double-render. The DELETE handler stays as best-effort but nothing depends on it — cross-device deletes converge via the reconciliation triggers. 30-day retention unchanged.

### 4.8 Fast interaction + drawer UI

- Row click: optimistic `markRead` (not awaited) + immediate `navigate`; markRead/markAllRead/delete keep their rollback and now also surface a destructive toast on persistence failure. Delete moves into a row overflow menu (`DropdownMenu`, keyboard/touch accessible, not hover-only).
- `NotificationsPanel.tsx` is rewritten on the existing **shadcn/Radix Sheet** (`side="right"`, `w-full sm:w-[440px] sm:max-w-md p-0 flex flex-col` — the ContactsFilterModal house pattern), giving backdrop, Escape, focus trap/return, and `SheetTitle`/`SheetDescription` for free; slide animation via the existing tailwindcss-animate data-state classes with `motion-reduce:` fallbacks (ReputationAiScanner precedent). All/Unread filter pills; New/Earlier grouping; skeleton loading; error + Retry (new `loadError`/`retry` in context); distinct empty vs no-unread states; scrollable list region. Tailwind only. Bell button gains `aria-label` (with unread count), `aria-expanded`, `aria-controls`.
- `action_url` navigation goes through a small internal-path validator (leading `/`, no `//`, no scheme — the safe-redirect *pattern*; its allowlist function itself is too narrow and is not modified).

## 5. Exact files expected to change

**Frontend — modified (7):**
1. `src/components/notifications/NotificationsPanel.tsx` — rewritten as the Sheet drawer (shell, header, filters, groups, states)
2. `src/contexts/NotificationContext.tsx` — server count, pagination, error state, reconciliation, preference-gated push with click-to-focus, id-dedupe
3. `src/components/layout/TopBar.tsx` — bell a11y attrs; remove drawer-open permission request (+ `setPanelOpen` removal)
4. `src/components/settings/profile/ProfilePreferencesCard.tsx` — push toggle ↔ permission flow + status/recovery copy; email/SMS honest treatment per D1
5. `src/lib/win-trigger.ts` — fan-out replaced by `notify_win` RPC (narrow cast; win insert untouched)
6. `src/lib/types.ts` — notification type union completed (`inbound_sms`/`inbound_email`)
7. `src/integrations/supabase/types.ts` — surgical adds only: `notifications.event_key`, `calls.routed_agent_ids`

**Frontend — new (2 + tests):**
8. `src/components/notifications/NotificationRow.tsx` — compact row + overflow menu (keeps files < 200 lines)
9. `src/lib/notification-presentation.ts` — pure helpers: icon/type map, New/Earlier grouping, All/Unread filtering, timeAgo, internal-path validation
10. Tests (new): `src/components/notifications/__tests__/notificationsDrawer.test.tsx`, `src/contexts/__tests__/notificationContext.test.tsx`, `src/lib/__tests__/notificationPresentation.test.ts`; modified: `src/lib/__tests__/winTriggerIdempotency.test.ts` (RPC swap)

**Frontend — deleted (1):** `src/lib/notifications-api.ts` (dead module, zero importers; removing it closes a latent duplicate-writer and the client-side arbitrary-recipient path)

**Backend — modified (5, deploy-gated separately):**
12. `supabase/functions/_shared/notifications.ts` — recipient priority chain + event-key upsert (pre-check deleted)
13. `supabase/functions/twilio-voice-inbound/index.ts` — persist `routed_agent_ids` at each Dial wave; resolver selects/returns gain agent ids; zero TwiML/routing change
14. `supabase/functions/twilio-voice-status/index.ts` — no logic change intended (redeployed only because the bundled `_shared/notifications.ts` changes)
15. `supabase/functions/twilio-sms-webhook/index.ts` — event key + upsert
16. `supabase/functions/email-sync-incremental/index.ts` — event key + upsert

**Migration — new (1, apply-gated separately):**
17. `supabase/migrations/<ts>_notifications_idempotency_recipients_security.sql` (§6)

**SQL integration tests — new (1):** `supabase/tests/notifications_idempotency.sql` (house pattern; localhost-only)

**Docs:** `implementation_plan.md` (this file) · `WORK_LOG.md` entry after code changes. **No other file.** Explicitly untouched: `DialerPage.tsx`, `TwilioContext.tsx`, `incomingCallAlerts.ts`, all routing settings UI, `inbound-call-claim`, `twilio-sms` (outbound), recording functions.

## 6. Migration design (file authored in this task; **applied only with separate approval**)

One migration, idempotent guards throughout, `NOTIFY pgrst, 'reload schema'` at the end:
1. `ALTER TABLE public.notifications ADD COLUMN event_key text NOT NULL DEFAULT (gen_random_uuid())::text;` (79-row table rewrite, sub-second; content of historical rows unchanged)
2. `CREATE UNIQUE INDEX uq_notifications_user_event_key ON public.notifications (user_id, event_key);`
3. `ALTER TABLE public.calls ADD COLUMN routed_agent_ids uuid[];` (nullable, no default, no rewrite; inherits existing calls RLS)
4. `DROP TRIGGER trg_notify_lead_assigned ON public.leads; DROP FUNCTION public.notify_lead_assigned();` then `CREATE FUNCTION public.notify_lead_assignments() … ; CREATE TRIGGER … AFTER INSERT … REFERENCING NEW TABLE … FOR EACH STATEMENT; CREATE TRIGGER … AFTER UPDATE … REFERENCING OLD TABLE … NEW TABLE … FOR EACH STATEMENT;` (per §4.3; EXCEPTION-guarded; DEFINER; pinned search_path; EXECUTE revoked from PUBLIC/anon/authenticated)
5. `CREATE FUNCTION public.notify_win(p_win_id uuid) …` (per §4.4; REVOKE PUBLIC/anon, GRANT authenticated/service_role)
6. `DROP POLICY notifications_insert ON public.notifications; CREATE POLICY notifications_insert … WITH CHECK (organization_id = public.get_user_org_id() AND user_id = auth.uid());` (self-only client inserts; requires Chris's `#APPROVE_RLS_CHANGE`)

No backfill, no DELETE, no change to the cleanup cron, no change to the `type` CHECK, no realtime-publication change. Expect MCP `apply_migration` to re-stamp the version (S3 precedent). Post-apply (in the later, separately-approved step): advisors re-run (expect the two `notify_lead_assigned` WARNs to disappear and no new findings) + surgical typegen check.

## 7. Optional historical cleanup (separate, NOT part of this implementation)

The 36 duplicate missed-call rows self-expire by the 30-day cron (all were created ≤ Aug 18; gone by mid-September). If Chris wants them gone sooner, this exact statement (keep-oldest per recipient/call) would be a **separately approved production mutation** with read-only preflight + row-count bound (expected: exactly 36):
`DELETE FROM public.notifications n USING public.notifications k WHERE n.type='missed_call' AND k.type='missed_call' AND n.user_id=k.user_id AND n.metadata->>'call_id' = k.metadata->>'call_id' AND k.created_at < n.created_at;`
Recommendation: **skip it** and let retention handle it.

## 8. Security impact

- **Closes:** org members minting arbitrary notifications for other users (INSERT policy → self-only; cross-user creation becomes server-authoritative: service-role Edge, DEFINER trigger, `notify_win` RPC); win fan-out's implicit-RLS org scoping (now explicit `organization_id` filter + DB-authoritative caller-org check, content server-built); the two advisor WARNs on `notify_lead_assigned` (function replaced, EXECUTE revoked); unscoped dedupe SELECT (deleted); cross-org recipients (routed ids re-validated against the call's org).
- **Preserved:** SELECT/UPDATE/DELETE RLS untouched; no service-role material in frontend; Twilio signature validation untouched; `verify_jwt=false` webhook posture untouched.
- **Explicitly NOT touched:** the wide baseline table grants to `anon` (pre-existing baseline state across many tables), the other 185 advisor findings, `wins_insert` breadth, `messages` schema. Any of those is its own approval.

## 9. Twilio / routing safety analysis

Notification changes avoid altering call routing because every `twilio-voice-inbound` edit is one of exactly three shapes: (a) a resolver SELECT gains the `id` column next to `twilio_client_identity` (same rows, same filters, same ordering); (b) resolvers return `{identities, agentIds}` instead of `identities` (call sites updated mechanically); (c) a fire-and-forget `UPDATE calls SET routed_agent_ids…` before an already-existing Dial emission, try/caught so failure cannot change the TwiML string. **Byte-level invariants:** no TwiML verb/attribute changes; Dial targets, action URLs, chain order, business-hours logic, voicemail/forward/hangup selection, auto-lead creation, after-hours SMS, recording callbacks, signature validation, and credentials all unchanged; `twilio-voice-status` keeps its monotonic `calls.duration` canon (invariant #8) with zero index.ts logic change; no `device.connect()`/TwilioContext/re-entrancy-guard/`inbound-call-claim` changes; no REST-originated dialing. Deploy protocol (later, gated): `get_edge_function` immediately before each deploy, ship full bodies incl. `_shared`, one function at a time, verify with a live test call before the next.

## 10. Test matrix

**Backend/idempotency — `supabase/tests/notifications_idempotency.sql`** (disposable localhost stack only, synthetic data; concurrency expressed as repeated statements against the unique arbiter, which is the same code path a concurrent second writer hits):
Two identical missed-call upserts → 1 row/recipient · repeated Twilio-callback simulation (status + inbound orders) → stable rows · 3 legitimate recipients → exactly 3 rows (never 6/9) · pre-existing row for recipient A does not block B/C's insert · cross-org routed ids filtered out; `notify_win` rejects a caller org ≠ win org · `notify_win` twice → one set · reassignment → exactly one row to the new owner · single INSERT-with-assignment → one detailed row; self-assign and self-import → zero rows · one-statement 300-row import → one summary per recipient · trigger failure injected → lead write still commits (warning only).
**Recipient routing (unit-level over the helper, vitest with mocked client):** direct line → owner · assigned → owner · round robin → picked agent · all-ring → all rung · chain union · contact-owner fallback · manager fallback only when empty · after-hours (no routed ids) → priority 2→4 · answered call → no insert (guard tests).
**Frontend (vitest + RTL; fail-first against unmodified source per house norm):** drawer renders via Sheet from the right; backdrop + Escape close; All/Unread filter; New/Earlier grouping newest-first; badge shows server count independent of page size (mock count 137 vs 30 loaded); skeleton (no "No notifications" flash), error + Retry, empty, no-unread states; row click navigates immediately with optimistic read (navigation not awaiting the update promise); markAllRead rollback + toast on failure; delete via overflow menu; realtime INSERT/UPDATE dedupe by id; reconnect/focus reconciliation refetches; push fires only when preference on + permission granted + hidden/unfocused; permission requested from the preferences toggle, not drawer open; denied state copy; mobile full-width class; keyboard operability of filters/rows/menu.
**Regression:** existing suites (`winTriggerIdempotency` updated, `incomingCallAlerts`, dialer/contacts suites) all green; full `npx vitest run` = main baseline + exactly the new tests; app-project tsc error multiset identical to a clean `origin/main` worktree; ESLint parity; `npm run build`. Inbound call-row creation, status updates, forwarding/voicemail, recording, contact deep links, outbound dialer are untouched code paths pinned by the byte-invariants in §9 (plus a recommended manual live-call pass at deploy time: answered call, missed direct-line, missed all-ring, after-hours).

## 11. Rollback strategy

- **Migration inverse (documented in the migration header):** drop `uq_notifications_user_event_key`; drop `notifications.event_key`; drop `calls.routed_agent_ids`; drop the two statement triggers + `notify_lead_assignments()`; recreate `notify_lead_assigned()` + its trigger verbatim from baseline `20260806000000` L4474–4501/L10235 (with its original grants); drop `notify_win`; restore the baseline `notifications_insert` policy. All steps are metadata-only except the event_key column drop (trivial).
- **Edge Functions:** live bodies are captured (read-only) before any deploy; rollback = redeploy the captured prior body (the standing house protocol). Functions are individually revertible; the DB accepts writes from old and new bodies alike (event_key has a default, routed_agent_ids is nullable) — no lockstep required, any interleaving is safe.
- **Frontend:** single revert commit / Vercel redeploy of the prior build; the old UI reads the new schema unchanged (extra columns are invisible to `select("*")` consumers' behavior).

## 12. Explicit exclusions (documented, NOT done)

No unmatched-message inbox · no email/SMS delivery infrastructure · no historical row deletion/backfill (see §7 for the optional separate action) · no change to inbound routing, forwarding, business hours, voicemail, recordings, or `calls.duration` canon · no `messages.provider_message_id` uniqueness (adjacent gap, own approval) · no per-`import_history` notification consolidation beyond per-statement summaries (§4.3 boundary) · no appointment-reminder/anniversary notification writers (types stay renderable; no producer exists today) · no changes to other security-advisor findings, baseline grants, or `wins_insert` · no realtime-publication or replica-identity change · no notification email digests · Vercel/production deployment of any of this is its own later approval.

## 13. Open decisions requiring Chris's approval

- **D1 — Email/SMS toggles:** disable with "Not yet connected" caption (**recommended**) or hide entirely?
- **D2 — Multi-wave missed call (fallback chain):** notify the **union of all rung agents** (recommended — each genuinely missed it) or only the final wave?
- **D3 — All-ring misses:** notify every rung agent (recommended; can be the whole org by that mode's nature — it is their missed call) or clamp to Admins/TL?
- **D4 — V1 summarization boundaries:** accept per-statement summaries (one per 1,000-row bulk-assign chunk; clean+flagged import sets may produce two) as the smallest truthful V1?
- **D5 — Quick-call win idempotency (adjacent, 1-line):** pass `idempotencyKey: "quickcall:<callId>"` from FloatingDialer when a callId exists, closing the duplicate-win retry gap? (Notification layer is already exactly-once per win id either way.) Recommended: yes.
- **D6 — Dead module:** delete `src/lib/notifications-api.ts` (recommended) or keep pruned?
- **D7 — Drawer width:** 440 px desktop / full-width mobile (recommended, within the approved 420–448 range)?
- **D8 — RLS change:** explicit `#APPROVE_RLS_CHANGE` for the self-only `notifications_insert` policy (§6.6).
- **D9 — Historical duplicate cleanup:** skip and let 30-day retention expire them (recommended), or approve the §7 statement separately.

**Recommended implementation sequence (after approval):** 1) migration file + SQL test suite authored and proven on a disposable localhost stack → 2) shared helper + Edge Function edits with unit coverage (no deploy) → 3) frontend context + drawer + preferences with fail-first tests → 4) full verification battery (`npx tsc --noEmit`, app-tsc multiset vs main, vitest, ESLint, build) → 5) WORK_LOG entry + context snapshot → 6) **separate approvals**: production migration apply → Edge deploys (voice-status first, then sms/email, `twilio-voice-inbound` last, each preceded by a fresh live `get_edge_function` pull and followed by a live-call check) → frontend release.

**STOP — awaiting Chris's explicit approval before touching any source file, migration, or deployment.**
