# Onboarding Email Series — implementation plan (AWAITING CHRIS'S APPROVAL; inactive by design)

**Status (2026-10-10):** plan only. On local branch `claude/onboarding-email-series-20261010` (base `main` `e21728e`), the only changes are this folder and a pointer section in the root `implementation_plan.md`. Nothing else has changed:

- No application file has been edited.
- No migration is written or applied.
- No Edge Function is written or deployed.
- No secret, cron job or trigger has been created.
- No email has been sent.

Production was read only: function list, migration list, catalog/trigger/cron names and aggregate counts.

**Email copy:** `email-copy.md` (this folder).

**Rendered previews (desktop / mobile / plain text):** https://claude.ai/artifact/X18LPg9HJF4NVdaHGNxqWp. The page is private to Chris's account.

---

## §0. TL;DR

- **Database enqueues; an Edge worker sends.** The pattern is the same as the live platform-admin notifications and `sms-consent-worker`.
- **A sweep enrolls new users, not a trigger.** No trigger is added to `auth.users` or `profiles`. The worker's sweep RPC enrolls users who are confirmed, Active, and whose welcome email was sent after an activation timestamp. That timestamp is NULL today, so nobody is eligible.
- **The series is OFF behind four independent locks:**
  1. The DB flag `onboarding_email_program.enabled` defaults to false, and both the enrollment and claim RPCs return nothing while it is off.
  2. The Edge env `ONBOARDING_EMAILS_SEND_ENABLED` must be exactly `true`; otherwise the worker exits before touching the database.
  3. No cron job is created. The schedule SQL lives in `supabase/ops/` and is not run.
  4. The migration is prepared under `supabase/migrations/pending/` (outside the CLI glob) and not applied. No secrets are provisioned.
- **Two series:**
  - Agents and Team Leaders: Day 1, 3, 5, 8, 14.
  - Admins: Day 2, 4, 7, 12.
  - Super Admins are excluded.
  - Day 0 is the existing welcome email, untouched.
  - Emails send at 10:00 in the agency's time zone.
- **Opt-out:**
  - A signed one-click unsubscribe (RFC 8058 header plus a footer link to a confirm page).
  - A Settings switch that appears only when the program is enabled.
  - It suppresses onboarding tips only, never transactional or security email.
- **No changes** to `create-user`, `send-welcome-email`, the invite functions, `send-email-previews`, the admin-notification system, `_shared/systemEmail.ts` or `_shared/systemEmailTemplates.ts`.

---

## §1. Inputs reviewed and conflicts

**Read in full:**
- `AGENT_RULES.md`. Relevant parts: §3, invariants #2, #5, #10, #20, #21, #25, #28, #31, #35 (tsc), and §7–§10.
- `VISION.md`.
- `WORK_LOG.md`, all 13,255 lines. The newest 20 entries were read closely, plus every email, onboarding, notification, cron and flag entry.

**Code read:**
- Edge: `_shared/systemEmail.ts`, `_shared/systemEmailTemplates.ts`, `_shared/systemEmailAuth.ts`, `send-welcome-email`, `create-user`, `send-email-previews`, `_shared/a2p/notifications.ts` (outbox).
- Frontend: `useWelcomeEmailTrigger`, `AuthContext.signup`, `ProtectedRoute`, `safe-redirect.ts`, `ProfileNotificationsSection`, `ProfilePreferencesCard`, `supabase-users.ts` (deactivate/delete), `settingsConfig.ts`, `permissionDefaults.ts`.
- Every route and label used in the copy was checked against `src/App.tsx` and the page components.

**Admin-registration email branch:** `claude/super-admin-registration-emails-20261010`, head `3a6fce2`. I read its plan, migration, worker module and AGENT_RULES #20/#21 amendments.

**Open PRs:** #429, #425, #398, #383, #382, #381, #378, #294. None touch email, auth, onboarding, `_shared/systemEmail*` or the files listed in §7.

**Conflicts found (to resolve before implementation):**

1. **The admin-registration release is live but not recorded on `main`.**
   - Production shows:
     - migration `20261010172702 / platform_admin_registration_notifications` applied;
     - Edge `platform-admin-notify` v1 deployed (`verify_jwt=false`);
     - cron `platform-admin-notify-every-minute` active;
     - triggers `trg_zz_platform_admin_notify_user_registered` on `profiles` and `trg_zz_platform_admin_notify_agency_created` on `organizations`.
   - The branch's newest commit still says "not deployed", and `main` has no WORK_LOG entry for it.
   - This plan does not touch any of those objects. It recommends rebasing the implementation branch after that release record lands on `main` (decision D11).
2. **Live `create-user` does not match the repository.** Production is v57, with the same bundle hash `2dc286da…` as the v56 documented on the admin branch. It refuses self-service signup; the repository copy does not.
   - This plan never touches `create-user`, which removes the risk.
   - With self-serve disabled, every new Admin today arrives by invitation. The Admin series is still useful for them and for self-serve if it reopens.
3. **The Work Log does not record the platform-admin work.** The full read found no entry, which is consistent with conflict 1. It is not a conflict for this plan.

---

## §2. What exists today (evidence)

| Area | Finding |
|---|---|
| Shared renderer | `renderSystemEmail()` is the one shell: light, table-based, inline CSS, preheader, plain-text part, dynamic year. It supports `badge`, `cta`, `ctaNote` and `footerLinks`. `featureRow()` and `paragraph()` exist. Every value is escaped; every link must be https (`assertHttpsUrl`). |
| Welcome email (Day 0) | `send-welcome-email` (live v255) runs when the browser first holds a confirmed session (`useWelcomeEmailTrigger` in `App.tsx:80`, `AppLayout.tsx:19`). It requires a confirmed email and claims `profiles.welcome_email_sent_at` atomically; the stamp is released on send failure. The column is server-only (not in the authenticated UPDATE grant, invariant #20). Production: 16/16 profiles stamped. |
| Signup | Both invite and self-serve create **unconfirmed** users (`email_confirm: false`) and send a confirmation link through `generateLink` + Resend. Production: 3 unconfirmed auth users. |
| Statuses | `profiles.status`: Active (11), Deleted (5). The app also writes Inactive (`deactivate`) and Pending. Deletion is **soft** (`status='Deleted'`, auth user kept). `organizations.status`: active (1), suspended (3), archived possible. 3 auth users are banned. |
| Roles | Agent 9, Team Leader 2, Admin 5. `is_super_admin` and `platform_role` are separate (§3). |
| Email preference | `profiles.email_notifications_enabled` (all true). Settings shows **"Email · Not yet connected"** as a disabled switch. Only the A2P outbox reads it. **No unsubscribe exists for any email today.** |
| Reusable delivery pattern | `platform_admin_notifications` and `a2p_email_outbox` both have: outbox, `SKIP LOCKED` claim with lease, backoff, 6 attempts, a 23 h window from the first attempt, Resend `Idempotency-Key`, a dedicated Vault Bearer token, and a constant-time check. |
| pg_cron | 12 active jobs, including `platform-admin-notify-every-minute` and `sms-consent-recovery-every-minute`. `pg_cron`, `pg_net` and `supabase_vault` are present. |
| Deep links | Signed-out users go to `/login`, then always `/dashboard`. `?redirect=` is allow-listed to `/accept-group-invite` only. So a CTA deep link works only in a signed-in browser. |
| Agent defaults | Reports page, Import, Create Campaign, Assign and Add-to-campaign are **off** for Agents by default (`permissionDefaults.ts`). The agent emails never send agents to those. |

---

## §3. Architecture recommendation

```
 profiles / auth.users (unchanged, no new triggers)
          │  read by
          ▼
 onboarding_email_enroll_due()  ── gated by program.enabled + enrollment_starts_at
          │ inserts
          ▼
 onboarding_email_enrollments (1 per user) ──► onboarding_email_deliveries (1 per step, precomputed scheduled_at)
                                                        │ claimed by (SKIP LOCKED, lease)  ── gated by program.enabled
                                                        ▼
 pg_cron (NOT installed) ─► Edge onboarding-email-worker ─► get context ─► evaluate (pure) ─► render (shared renderer)
                              (env kill switch, Bearer)                                       └► Resend (Idempotency-Key, List-Unsubscribe)
                                                        │
                                                        ▼
                         complete_onboarding_email_delivery() ─► onboarding_email_delivery_attempts (log)

 Footer link ─► /email/unsubscribe page ─► POST Edge email-unsubscribe ─► user_email_subscriptions (+ cancels remaining steps)
 Gmail one-click header ───────────────────► POST Edge email-unsubscribe
```

### 3.1 Data model

All tables are created by one migration. That migration is prepared, not applied (§4).

- **`public.onboarding_email_program`**, a singleton.
  - Columns:
    - `id smallint PK DEFAULT 1 CHECK (id = 1)`
    - `enabled boolean NOT NULL DEFAULT false`
    - `enrollment_starts_at timestamptz NULL`
    - `pilot_organization_ids uuid[] NULL`. When non-null, only these agencies enroll.
    - `send_hour_local smallint NOT NULL DEFAULT 10 CHECK (0–23)`
    - `step_expiry interval NOT NULL DEFAULT '72 hours'`
    - `updated_at`, `updated_by`
  - `CHECK (NOT enabled OR enrollment_starts_at IS NOT NULL)`.
  - Seeded as `(1, false, NULL)`.
- **`public.onboarding_email_steps`**, the timing catalog.
  - Columns: `step_key text PK`, `sequence_key text CHECK IN ('agent','agency_admin')`, `day_offset int CHECK (> 0)`, `position int`, `template_version int NOT NULL DEFAULT 1`, `is_active boolean NOT NULL DEFAULT true`, `UNIQUE (sequence_key, position)`.
  - Seeded with the 9 steps in §5.
  - The TypeScript catalog and this seed are held equal by a parity test.
- **`public.onboarding_email_enrollments`**
  - Columns:
    - `id uuid PK`
    - `user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE`
    - `organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE`
    - `sequence_key`, `role_at_enrollment`
    - `anchor_at timestamptz NOT NULL`, the welcome send time (D2)
    - `status IN ('active','completed','cancelled')`, `cancel_reason`
    - timestamps
- **`public.onboarding_email_deliveries`**
  - Columns:
    - `id`, `enrollment_id` (FK, cascade), `user_id`, `organization_id`
    - `step_key` (FK to steps), `template_version`
    - `scheduled_at`, `expires_at`
    - `status IN ('scheduled','sending','sent','skipped','failed','cancelled')`
    - `attempts`, `available_at`, `locked_until`, `first_attempted_at`, `last_attempt_at`, `sent_at`
    - `provider_message_id` (≤ 200 chars), `skip_reason` (enumerated CHECK), `last_error` (≤ 500 chars, sanitized)
  - Constraints and indexes:
    - `UNIQUE (enrollment_id, step_key)` and `UNIQUE (user_id, step_key)`
    - `CHECK ((attempts = 0) = (first_attempted_at IS NULL))`
    - a due index on `(available_at, id)` `WHERE status IN ('scheduled','sending')`
- **`public.onboarding_email_delivery_attempts`**, an append-only log.
  - Columns: `id`, `delivery_id` (FK, cascade), `organization_id`, `attempt_number`, `outcome IN ('sent','skipped','retry','failed','cancelled')`, `provider_message_id`, `error`, `created_at`.
- **`public.user_email_subscriptions`**, the opt-out store. It is generic so a future "Product Updates" category can reuse it.
  - Columns: `user_id uuid PK REFERENCES profiles ON DELETE CASCADE`, `organization_id uuid NOT NULL`, `onboarding_opted_out_at timestamptz NULL`, `onboarding_opt_out_source text CHECK IN ('unsubscribe_link','settings')`, `updated_at`.

**Privileges and RLS:**
- Every table: RLS on; `REVOKE ALL FROM PUBLIC, anon, authenticated`; `GRANT` to `service_role`.
- `user_email_subscriptions` gets one extra policy, `SELECT TO authenticated USING (user_id = auth.uid())`, and no write policy; writes go through RPCs.
- The queue tables carry `organization_id NOT NULL` and are server-only. That matches the approved `a2p_email_outbox` / `platform_admin_notifications` posture.
- Expected advisor delta: the five server-only tables add `rls_enabled_no_policy` (INFO) findings, the same pattern as the existing outboxes. Nothing else may appear.

### 3.2 Functions

Every function: `search_path = pg_catalog, public, pg_temp`, every object schema-qualified, EXECUTE revoked from PUBLIC/anon. The four worker RPCs below are `service_role` only.

| Function | Caller | Behaviour |
|---|---|---|
| `private.onboarding_email_slot(anchor, day_offset, tz, hour)` | internal | The local calendar day of `anchor` in `tz`, + `day_offset` days, at `hour`:00 local. DST-correct. If `tz` is not in `pg_timezone_names`, it falls back to `anchor + day_offset days`. |
| `public.onboarding_email_enroll_due(p_limit)` | worker | `SECURITY DEFINER` (reads `auth.users`). **Returns 0 at once unless `enabled` and `enrollment_starts_at` is set.** Candidate rules are below the table. Inserts the enrollment plus one delivery per active step in ONE transaction, `ON CONFLICT DO NOTHING`. |
| `public.claim_onboarding_email_deliveries(p_limit)` | worker | **Returns an empty set unless `enabled`.** Never-attempted rows past `expires_at` become `skipped/stale`. Then it claims due rows with `FOR UPDATE SKIP LOCKED`, a 5-minute lease and `attempts + 1`, and stamps `first_attempted_at` once. |
| `public.get_onboarding_email_context(p_delivery_id)` | worker | `SECURITY DEFINER`. Returns one row of current facts (below). Returns NULL when the subject no longer exists. |
| `public.complete_onboarding_email_delivery(p_id, p_outcome, p_provider_message_id, p_error, p_skip_reason, p_cancel_remaining)` | worker | Applies only to a row still `sending`. Backoff is 1/2/5/15/30 min and a row fails after 6 attempts. A row also fails once past `min(expires_at, first_attempted_at + 23 h)`. It writes one attempt-log row, and `p_cancel_remaining` cancels the enrollment's other scheduled steps. When every step is terminal, the enrollment becomes `completed`. |
| `public.record_onboarding_email_opt_out(p_user_id, p_source)` | unsubscribe function | Upserts the opt-out, using the org from `profiles`, and cancels scheduled deliveries plus the enrollment. Idempotent. |
| `public.set_my_onboarding_email_opt_out(p_opted_out boolean)` | authenticated | `SECURITY DEFINER`. The actor is `auth.uid()` read from **`profiles`** (never the JWT). It must be Active, with org = its own `profiles.organization_id`. Opting out cancels pending steps; opting back in never restarts cancelled steps. |
| `public.get_my_email_subscriptions()` | authenticated | Returns `{ onboarding_program_enabled boolean, onboarding_opted_out boolean }` for the caller only. |

`enroll_due` candidate rules:
- `u.email_confirmed_at IS NOT NULL`, `deleted_at IS NULL`, not banned.
- `p.status = 'Active'`, `p.organization_id` not null.
- `NOT is_super_admin`, role in (`Agent`, `Team Leader`, `Admin`).
- Organization status `active` (NULL = column default `active`), and within the pilot list when one is set.
- Not opted out, and no existing enrollment.
- **`p.welcome_email_sent_at >= enrollment_starts_at` AND `p.created_at >= enrollment_starts_at`.**
- Sequence: `Admin` gets `agency_admin`; everyone else gets `agent`.
- `scheduled_at = slot(welcome_email_sent_at, day_offset, company_settings.timezone, send_hour_local)` and `expires_at = scheduled_at + step_expiry`.

`get_onboarding_email_context` returns these facts:
- auth: email, confirmed, deleted, banned;
- profile: first name, status, role, `is_super_admin`, organization;
- organization: status;
- opted out;
- enrollment: status, sequence, organization;
- delivery: step, version, `expires_at`.

### 3.3 Send-time eligibility

The send-time rules are a pure TypeScript function, `evaluateEligibility(context, now)`, so every rule is table-tested.

| Condition, re-checked on every attempt | Outcome |
|---|---|
| Profile or auth user missing, auth `deleted_at`, or `status = 'Deleted'` | cancel remaining (`user_deleted`) |
| Opted out | cancel remaining (`opted_out`) |
| `is_super_admin`, or role no longer eligible | cancel remaining (`role_ineligible`) |
| Role now maps to a different series | cancel remaining (`role_changed`) (D5) |
| Profile organization ≠ enrollment organization | cancel remaining (`organization_changed`) |
| `status` is Inactive / Pending / other, or banned | skip this step (`user_inactive`); later steps still evaluate |
| Agency `suspended` or `archived` | skip this step (`organization_inactive`) (D6) |
| Email no longer confirmed (pending change) | skip this step (`email_unconfirmed`) |
| `now > expires_at` | skip (`stale`) |
| Otherwise | send to the **current confirmed `auth.users.email`** |

### 3.4 Delivery

These rules apply in the Edge worker, `onboarding-email-worker`, deployed with `verify_jwt=false` (invariant #2).

1. Only `POST` with `Authorization: Bearer <token>` is accepted. The token is compared in constant time against `ONBOARDING_EMAIL_WORKER_TOKEN` (≥ 32 chars). Anything else gets 403. The request body is ignored.
2. If `ONBOARDING_EMAILS_SEND_ENABLED !== "true"`, return `200 {ok:true, disabled:true}` **before creating a database client.**
3. If `RESEND_API_KEY` or `EMAIL_UNSUBSCRIBE_SECRET` (≥ 32 chars) is missing, return 503 before any claim, so no attempt is spent.
4. Call `enroll_due(25)`, then `claim(5)`. For each row: load the context, evaluate, render, send, then complete.
5. Each send is a Resend `POST /emails` with:
   - `from: SYSTEM_EMAIL_FROM`;
   - `Idempotency-Key: onboarding-<delivery id>`;
   - headers `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`;
   - tags `category=onboarding` and `step=<step_key>`;
   - a 15 s timeout;
   - at least 600 ms between sends, so the worker never competes with confirmation or invite mail for the shared Resend rate limit. Throughput is capped at 5 per minute.
6. Errors are classified as follows:
   - 2xx: `sent`.
   - 429, 5xx, timeout or network error: `retry`.
   - 409 `invalid_idempotent_request` or a 4xx validation error: `failed` (non-retryable, review).
7. Logs carry the row id, step key, attempt and outcome only. They never carry email addresses, bodies or tokens.

### 3.5 Duplicate-send prevention

The layers:

1. `UNIQUE(user_id)` on enrollments.
2. `UNIQUE(enrollment_id, step_key)` and `UNIQUE(user_id, step_key)` on deliveries.
3. A `SKIP LOCKED` claim plus a lease, and completion applies only to rows still `sending`.
4. A Resend Idempotency-Key per delivery, which covers a crash after the send but before completion.
5. Terminal statuses.
6. No Day-0 step exists, so the welcome email can never be duplicated.
7. Steps whose day has passed are never "caught up": `expires_at` turns them into `stale` skips.

### 3.6 Opt-out

- **Signed token.** The token is `v1.<base64url({u:userId,c:"onboarding",t:issuedAt})>.<base64url(HMAC-SHA256)>`, signed with Edge secret `EMAIL_UNSUBSCRIBE_SECRET`. It does not expire; rotating the secret invalidates old links, and the Settings switch still works.
- **Edge `email-unsubscribe`** (`verify_jwt=false`):
  - accepts `POST` only, with the token in the query string or JSON body;
  - verifies in constant time;
  - calls `record_onboarding_email_opt_out`;
  - always answers the same generic success for a valid token;
  - answers 400 for malformed or tampered tokens;
  - never reveals an email or name.
- **Footer link.** The link goes to the public page `/email/unsubscribe?token=…`, which shows one "Unsubscribe" button. **A GET never unsubscribes**, so link scanners such as Safe Links cannot opt people out.
- **Settings switch.** "Onboarding tips by email" sits under Notifications. It renders only when `get_my_email_subscriptions().onboarding_program_enabled` is true, it is not mounted under View As (invariant #31), and its state comes from a Zod-validated RPC result.
- **Scope.** The opt-out suppresses onboarding tips only. Confirmation, invitation, welcome, password and security emails do not read this table and are unaffected.

### 3.7 No interference with transactional or security email

- The feature has its own function, tables, cron (future) and secrets.
- Transactional functions are byte-unchanged.
- The worker uses the shared renderer read-only and the verified sender constant.
- Throughput is capped and spaced.
- The program never edits `profiles` or `auth.users`.

### 3.8 Why not the alternatives

- **An enrollment trigger on `auth.users`.** The brief forbids production enrollment triggers. A trigger on GoTrue's table is also an avoidable risk to every login.
- **Sending from `send-welcome-email`.** That would modify the welcome email (forbidden), and it is browser-triggered.
- **A DB-triggered `pg_net` send.** Invariant #21 forbids it.

---

## §4. Inactive by design

| Lock | Where | Default | Effect while off |
|---|---|---|---|
| Program flag | `onboarding_email_program.enabled` | `false` (seeded) | `enroll_due` returns 0 and `claim` returns nothing, even if a worker is invoked by hand. |
| Activation watermark | `enrollment_starts_at` | `NULL` | Nobody is eligible. Once set, only users whose welcome email was sent after it can enroll, so **no historical backfill is possible.** |
| Edge kill switch | env `ONBOARDING_EMAILS_SEND_ENABLED` | unset | The worker returns `disabled:true` without touching the database. |
| Scheduler | `supabase/ops/onboarding_emails_schedule.sql` | not run | Nothing invokes the worker. |
| Migration | `supabase/migrations/pending/…` | not applied | Outside the CLI glob, so preview branching and any future GitHub deploy will not apply it. |
| Secrets | worker token, unsubscribe secret, Vault token | not created | The worker answers 403 to everyone. |

**Deterministic local preview and testing:**
- `scripts/render-onboarding-email-previews.ts` (Deno) writes every email's HTML and text for a fixed name and site URL to a local folder (default `tmp/onboarding-email-previews/`, gitignored).
- Every module takes an injected clock, store and mailer.

---

## §5. Role-specific delivery schedule

All times are **10:00 in the agency's time zone** (`company_settings.timezone`, validated IANA), on calendar day N after the welcome email was sent.

| Day | Agent series (Agents + Team Leaders) | Agency admin series (Admins) |
|---|---|---|
| 0 | Existing welcome email (unchanged) | Existing welcome email (unchanged) |
| 1 | `agent_day01_dialer_ready`: Get your dialer ready | — |
| 2 | — | `admin_day02_agency_setup`: Set up your agency |
| 3 | `agent_day03_work_leads`: Work your leads like a pro | — |
| 4 | — | `admin_day04_agents_dialing`: Get your agents dialing |
| 5 | `agent_day05_campaigns`: Understanding your campaigns | — |
| 7 | — | `admin_day07_team_performance`: Manage your team's performance |
| 8 | `agent_day08_numbers`: Know your numbers | — |
| 12 | — | `admin_day12_high_performing`: Build a high-performing agency |
| 14 | `agent_day14_routine`: Build your daily routine | — |

- **Excluded:** Super Admins (`is_super_admin` or role `Super Admin`), users without an organization, agencies outside the pilot list.
- **Step expiry:** 72 h. A step that cannot be sent by then is skipped, never sent late.

---

## §6. Email copy and previews

The complete copy is in `email-copy.md`: subject, preheader, badge, heading, body, CTA, CTA note, footer and the exact plain-text part. Each email has a greeting, a short explanation, "Why it matters" for a life-insurance agent, three concrete steps, one primary CTA and a note giving the menu path.

**Claims removed or avoided after verification:**
- "300 dials"
- Reports for agents
- Microphone or device settings
- SMS from the Dialer
- VM Drop
- Number groups per campaign
- Scheduled reports
- Inbound availability effects
- Training content (no seeded content)
- Texting in workflows

**CTAs (all verified routes):**

| Email | CTA | URL |
|---|---|---|
| Agent Day 1 | Open the Dialer | `/dialer` |
| Agent Day 3 | Open My Contacts | `/contacts` |
| Agent Day 5 | Choose a Campaign | `/dialer` |
| Agent Day 8 | Set My Goals | `/settings?section=my-profile` |
| Agent Day 14 | Open My Dashboard | `/dashboard` |
| Admin Day 2 | Open Company Branding | `/settings?section=company-branding` |
| Admin Day 4 | Invite Your Team | `/settings?section=user-management` |
| Admin Day 7 | Open Reports | `/reports` |
| Admin Day 12 | Add Call Scripts | `/settings?section=call-scripts` |

---

## §7. Exact files (after approval)

**New: backend, prepared and inactive.**

1. `supabase/migrations/pending/20261011120000_onboarding_email_foundation.sql`: the tables, seeds, functions and grants of §3. It has a replay guard, and it has **no triggers and no cron**.
2. `supabase/migrations/rollback/20261011120000_onboarding_email_foundation.rollback.sql`
3. `supabase/ops/onboarding_emails_schedule.sql` and `supabase/ops/onboarding_emails_unschedule.sql`: guarded pg_cron + Vault (`onboarding_email_worker_token`). Not run.
4. `supabase/ops/onboarding_emails_enable.sql` and `supabase/ops/onboarding_emails_disable.sql`: guarded flag flips. Enable requires an explicit pilot list or an explicit `ALL`, and sets `enrollment_starts_at = now()` only if NULL. Not run.
5. `supabase/functions/_shared/onboardingEmail/catalog.ts`: series, steps, offsets, CTA paths, role mapping.
6. `supabase/functions/_shared/onboardingEmail/templates.ts`: the nine `render*` functions using `renderSystemEmail` / `paragraph` / `featureRow` / `strongText`, with no new HTML primitives.
7. `supabase/functions/_shared/onboardingEmail/eligibility.ts`: the pure decision function.
8. `supabase/functions/_shared/onboardingEmail/unsubscribeToken.ts`: HMAC sign and verify (WebCrypto).
9. `supabase/functions/_shared/onboardingEmail/delivery.ts`: store interface, Supabase store, Resend mailer, `processQueue`, worker auth helpers. These are duplicated, not imported from the admin module, so the admin system stays untouched.
10. Tests: `catalog.test.ts`, `templates.test.ts`, `eligibility.test.ts`, `unsubscribeToken.test.ts` and `delivery.test.ts`, all in `_shared/onboardingEmail/`.
11. `supabase/functions/onboarding-email-worker/index.ts` + `index.test.ts`
12. `supabase/functions/email-unsubscribe/index.ts` + `index.test.ts`
13. `supabase/tests/onboarding_emails_harness.sql`, `supabase/tests/onboarding_emails.sql`, `scripts/run_onboarding_email_tests.sh`. The tests run on localhost PostgreSQL only, prove they are local, and use synthetic data (invariant #28).
14. `scripts/render-onboarding-email-previews.ts`
15. `.github/workflows/onboarding-emails.yml`: Deno test/check, the SQL suite, targeted vitest, ESLint, the app tsc baseline comparison and the build.

**New: frontend.**

16. `src/pages/EmailUnsubscribePage.tsx` (< 200 lines, Tailwind, Zod token-shape check, POST on click only) + `src/pages/__tests__/emailUnsubscribePage.test.tsx`
17. `src/lib/emailSubscriptions.ts`: RPC/fetch wrappers with Zod-validated results and a narrow `(supabase as any).rpc` cast, the repo precedent for RPCs missing from generated types. Test: `src/lib/__tests__/emailSubscriptions.test.ts`.
18. `src/components/settings/profile/OnboardingEmailPreference.tsx` + test. It renders nothing unless the program is enabled and the viewer is not impersonating.

**Edited (surgical):**

19. `src/App.tsx`: one public route, `/email/unsubscribe`, plus its import.
20. `src/components/settings/profile/ProfileNotificationsSection.tsx`: render `<OnboardingEmailPreference />` (one line plus an import).
21. `supabase/config.toml`: `[functions.onboarding-email-worker]` and `[functions.email-unsubscribe]`, both with `verify_jwt = false`.
22. `.gitignore`: `tmp/onboarding-email-previews/`.
23. `AGENT_RULES.md`: invariant #21 amendment (the onboarding series uses the shared renderer, copy lives in `_shared/onboardingEmail/templates.ts`, the opt-out scope rule, the four locks); `WORK_LOG.md` (newest first); root `implementation_plan.md` and this file (as built).

**Not touched:**
- Functions: `create-user`, `send-welcome-email`, `invite-user`, `send-invite-email`, `invite-to-agency-group`, `send-email-previews`, `accept-invite`, `create-organization`, `workflow-executor`, every Gmail `email-*` function.
- Admin-notification system: `platform-admin-notify`, `platform_admin_notifications` and its triggers and cron, `_shared/platformAdminNotifications.ts`.
- Shared email modules: `_shared/systemEmail.ts`, `_shared/systemEmailTemplates.ts`, `_shared/systemEmailAuth.ts`.
- Auth templates.
- Frontend auth and settings: `AuthContext`, `ProtectedRoute`, `safe-redirect.ts`, `ProfilePreferencesCard`.
- Data: `src/integrations/supabase/types.ts`, every existing RLS policy, every applied migration.

---

## §8. Verification and testing strategy

**Deno** (`deno test --allow-env`, `deno check` on both functions):

- **Catalog parity:** the TypeScript steps equal the SQL seed (parsed from the migration file).
- **Templates:**
  - subject, preheader, badge and CTA match `email-copy.md`;
  - every link is https on the site origin, and every CTA path is in a verified-route allowlist;
  - first names are escaped (including `<script>` and CRLF);
  - every email has a plain-text part;
  - no forbidden patterns (#21), no hardcoded year, no `vercel.app` / `lovable` / `agentflow.app`;
  - the footer has an unsubscribe link and the Privacy link.
- **Eligibility:** table-driven tests covering every row of §3.3, including boundaries (expiry, role switch, org switch).
- **Token:** round trip, tamper, wrong secret, wrong version, malformed, and a timing-safe comparison.
- **Delivery and worker:**
  - kill switch unset means zero store calls;
  - a missing key or secret means 503 and no claim;
  - bad or missing Bearer means 403;
  - mocked Resend 2xx, 429, 500, timeout, 409 and 422 map to the right outcomes;
  - Idempotency-Key is stable per delivery, the List-Unsubscribe headers are present, and tags are set;
  - a context of NULL means cancel; logs carry no email address.
- **Unsubscribe function:** POST only; a valid token calls the RPC once; a tampered token is 400 and makes no RPC call; the response never echoes identity.

**SQL** (`scripts/run_onboarding_email_tests.sh`, local PostgreSQL 16 or 17, with harness stubs for `auth.users`):

- **Defaults:** `enabled=false` and `starts_at` NULL; no trigger added to `profiles`, `organizations` or `auth.users` (compare `pg_trigger` before and after); no `cron.job` row created.
- **Disabled behaviour:** `enroll_due` and `claim` return nothing while disabled, even with eligible fixtures.
- **Enrollment eligibility:**
  - no historical enrollment (profile or welcome before `starts_at`);
  - excluded: unconfirmed, deleted, banned, Inactive, Deleted, super admin, no org, suspended org, outside the pilot list, opted out;
  - Admin goes to the admin series, Agent and TL to the agent series.
- **Scheduling:** `slot()` gives 10:00 local across a DST change (America/New_York, America/Los_Angeles), Pacific/Honolulu, and the fallback for an invalid zone.
- **Concurrency:** concurrent `enroll_due` in two sessions gives one enrollment; two-session `SKIP LOCKED` claims overlap 0; lease reclaim works.
- **Retry and expiry:** backoff schedule, the 6-attempt cap, the 23 h window from the first attempt, the expiry sweep.
- **Completion and opt-out:** complete-only-when-sending; cancel-remaining; opt-out cancels and is idempotent; opting back in does not restart.
- **Privileges:**
  - anon and authenticated cannot select any queue table or execute any service RPC;
  - an authenticated user reads only their own subscription row;
  - `set_my_…` refuses a non-Active or org-mismatched profile;
  - cross-org isolation.
- **Cascade:** deleting the profile cascades to enrollments and deliveries.
- **Release proofs:** replay guard; rollback proof; negative controls (a rebuilt migration with the flag defaulting true must fail the defaults test).

**Frontend** (vitest, with dummy `VITE_SUPABASE_*` env):
- the unsubscribe page never POSTs on load, POSTs once on click, and has success, invalid and error states;
- the preference switch is hidden when the program is disabled and under View As, and commits only after RPC success;
- the route is present in `App.tsx`.

**Gates:**
- `npx tsc --noEmit` (vacuous, invariant #35) **and** `npx tsc -p tsconfig.app.json --noEmit` against the baseline of 85 diagnostics, with zero new.
- ESLint on changed files, `vite build`, the full vitest run compared with `main`.

**Production:** read-only preflight only. No production email, user, migration or deploy. Real-client rendering (Gmail, Apple Mail, Outlook) is a separately approved step (activation step 6).

---

## §9. Future "System Communications" (Super Admin) — plan only, not built

**Route and access:**
- `/super-admin/communications`, behind the existing `SuperAdminRoute`, with a Super Admin sidebar extra "Communications".
- Not mounted under View As.
- Data comes from new `SECURITY DEFINER` RPCs whose actor check reads `profiles.is_super_admin` for `auth.uid()`, never the JWT.

**Sections:**

1. **Onboarding Emails:**
   - one card per series, showing a timing rail (as in the preview page) and status (Enabled / Disabled / Pilot: N agencies) read from `onboarding_email_program`;
   - per-step preview with Desktop / Mobile / Plain text tabs (sandboxed `srcdoc` iframe), rendered by a super-admin Edge endpoint `system-communications-preview` with sample data, never real recipients;
   - delivery counts per step.
2. **Delivery History:**
   - a paginated table of deliveries: agency, user name, step, scheduled, status, attempts, last error, Resend id;
   - filters by status, step and agency;
   - attempt log in a drawer.
3. **Product Updates:** reserved. No tab is shown until that feature is separately approved (no empty placeholder).

**Draft editing, a later phase:**
- A `onboarding_email_template_drafts` table holds **structured fields only**: subject, preheader, intro, why, three steps, extra note, CTA label, and a CTA path chosen from the verified allowlist. There is no raw HTML.
- Draft → Publish creates `template_version + 1`.
- The worker uses the newest published version, otherwise the code default.
- Every publish records who published it and when.

**Enable/disable:** read-only in the first admin release. A UI toggle needs its own approval.

**Components** stay under 200 lines each: `SystemCommunicationsPage`, `SeriesTimelineCard`, `EmailPreviewFrame`, `DeliveryHistoryTable`, `DeliveryAttemptsDrawer`. Tailwind only, and Zod on every form.

---

## §10. Decisions for Chris (recommendation first)

- **D1 Architecture:**
  - **Queue + sweep enrollment + Edge worker (recommended).**
  - Alternatively, an `auth.users` confirmation trigger plus a worker. This needs a production enrollment trigger, which the brief forbids for now.
- **D2 Day-0 anchor:**
  - **`welcome_email_sent_at` (recommended).** Day 0 is then literally the welcome email, and no tip can arrive before it. Email confirmation is still required separately.
  - Alternatively, `auth.users.email_confirmed_at`. Tips would then go to users who confirmed but never opened the app.
- **D3 Send time:**
  - **10:00 agency time zone (recommended).**
  - Alternatively, the exact anchor time + N×24 h.
- **D4 Audience:**
  - **Admin goes to the admin series; Agent and Team Leader go to the agent series; Super Admins are excluded (recommended).**
  - Alternatively, Admins get both series.
- **D5 Role change mid-series:**
  - **Stop the remaining steps (recommended).**
  - Alternatively, switch to the other series.
- **D6 Suspended or archived agency:**
  - **Skip that step; continue later steps if the agency is active again (recommended).**
  - Alternatively, pause the step until the 72 h expiry.
- **D7 Opt-out UI:**
  - **Unsubscribe link plus a Settings switch shown only when the program is enabled (recommended).**
  - Alternatively, the link only.
- **D8 Sender:**
  - **Keep `AgentFlow <team@fflagent.com>` (`SYSTEM_EMAIL_FROM`, invariant #21) (recommended).**
  - Alternatively, a separate address or subdomain for educational mail. That needs DNS/Resend setup and an invariant change.
- **D9 Deep links:**
  - **Accept as designed: each CTA links to the page and the note gives the menu path (recommended).**
  - Alternatively, separately approve a small change allowing safe internal `?redirect=` targets after login. This is an auth-flow change, so it is not part of this feature.
- **D10 Secrets:**
  - **You set them in the dashboard at activation (recommended).** That means `ONBOARDING_EMAIL_WORKER_TOKEN`, Vault `onboarding_email_worker_token` and `EMAIL_UNSUBSCRIBE_SECRET`, each ≥ 32 random chars, never in git or chat.
  - Alternatively, I generate them through MCP; the values would then appear in the session.
- **D11 Ordering:**
  - **Record the live admin-registration release on `main` first, then rebase this branch onto it (recommended).**
  - Alternatively, proceed in parallel. The file sets are disjoint, so only WORK_LOG, AGENT_RULES and `config.toml` would conflict.
- **D12 Footer mailing address:**
  - **Include none for now.** These are relationship messages about a service the user already uses.
  - Alternatively, give me a business mailing address to add, if you want a commercial-email posture. This is not legal advice.

---

## §11. Activation checklist (future; each step needs its own explicit approval)

1. Merge the inactive implementation PR after green CI. Nothing is applied or deployed by the merge.
2. **Read-only preflight:**
   - `list_migrations`;
   - confirm the objects are absent;
   - `cron.job` names;
   - advisor baseline;
   - `get_edge_function` for both new slugs (expect not found);
   - confirm `create-user`, `send-welcome-email` and `platform-admin-notify` are unchanged.
3. **Apply the foundation migration.**
   - Use MCP `apply_migration` with the exact reviewed bytes, then `git mv` the file to the recorded version with identical bytes (invariant #25).
   - Read back from the catalog: flag false, `starts_at` NULL, no triggers, no cron, grants as designed, advisor delta INFO-only.
4. **Deploy `email-unsubscribe` and `onboarding-email-worker`.**
   - Use `get_edge_function` first, then the full bundle; read back `verify_jwt=false`.
   - Smoke checks:
     - a worker POST without a token → 403;
     - a worker POST with a token and the kill switch unset → `disabled:true`;
     - an unsubscribe POST with a malformed token → 400.
5. **Release the frontend** (unsubscribe page; the switch stays hidden).
6. **Set secrets** (D10). Optionally, with a separate approval, render the nine emails to Chris's own allowlisted inbox to check real-client rendering.
7. **Run `supabase/ops/onboarding_emails_schedule.sql`.** The worker then runs every minute and does nothing while the env and flag are off.
8. **Pilot.**
   - Set `ONBOARDING_EMAILS_SEND_ENABLED=true`.
   - Run `onboarding_emails_enable.sql` with `pilot_organization_ids = {Chris's home org}`; this sets `enrollment_starts_at = now()`.
   - Only users invited after this moment can enroll.
9. **Observe the first sends.** Check:
   - Resend dashboard and the `attempts` log;
   - the unsubscribe link and Gmail one-click;
   - that no transactional email was delayed;
   - the agent and admin series.
10. **Widen the pilot** to all agencies (an explicit `ALL`).

**Kill switches, fastest first:**
1. unset the env flag;
2. `onboarding_emails_disable.sql`;
3. `onboarding_emails_unschedule.sql`.

Queued rows remain for review; nothing is deleted (invariant #28).

---

## §12. Risks and rollback

**Risks:**
- **Wrong recipient or late email.** Mitigated by send-time re-checks (§3.3), step expiry and the current auth email.
- **Duplicate email.** Mitigated by the seven layers in §3.5.
- **Reputation impact on transactional mail.** Low volume, the 5/min cap and spacing, a one-click unsubscribe and a plain-text part. D8 records the subdomain option.
- **Stale copy as the product changes.** Mitigated by the CTA allowlist test, the parity test and versioned templates. The copy should be reviewed when Settings slugs, labels or permissions change.
- **Rollback.**
  - The disable sequence in §11 is non-destructive.
  - The rollback migration drops the objects, **which deletes delivery history**. In production it needs Chris's separate approval under invariant #28.
  - Prefer leaving the tables in place.

---

## §13. Context snapshot

- **Branch:** `claude/onboarding-email-series-20261010`, from `main` `e21728e`. Plan files only.
- **Production (read 2026-10-10, read-only):**
  - Newest migration `20261010172702`.
  - Emails: `send-welcome-email` v255; `platform-admin-notify` v1 live; `create-user` v57 (`2dc286da…`).
  - Data: 12 cron jobs, 16 profiles (11 Active, 5 Deleted); 4 agencies (1 active, 3 suspended).
  - None of this feature's objects exist.
- **Migrations / deploys / secrets / emails:** none.
- **Blockers:** Chris's approval of this plan and the file list; decisions D1–D12; D11 ordering.
- **Observations (not acted on, outside this feature):**
  - The admin-registration release record is missing on `main`.
  - `WORK_LOG.md` contains a plaintext `WORKFLOW_INTERNAL_SECRET` in a 2026-05-15 entry. This is already known (rotation pending, per a newer entry).
  - `/contact` shows a success toast but sends nothing.
  - The welcome template comment says `/privacy` and `/terms` don't exist; they now do (template not changed).
