# Implementation Plan — System Email Audit, Repair & Unification

**Status:** **RELEASING (2026-07-31)** — Chris approved the production release. The P0 blocker shipped first as **PR #340** (merge commit `ad893910c7072af1729e7d3a40397ba62057cfbd`); this branch is rebased onto that `main`. The original approval scope is unchanged: A1–A6, A8, A9-prep, R1, Welcome **Option B**. Still excluded and untouched: `workflow_dispatch_event` lockdown, profile SELECT/privacy ([#339](https://github.com/cgarness/agentflow-life-insure/issues/339)), `create-organization` authorization, cron repairs, telephony/dialer, general advisor cleanup. **The prior "no deploys / no migration / no test emails" hard gate is LIFTED for exactly the steps in §12 and nothing else.** See §12 for live execution state.
**Date:** 2026-07-30
**Branch:** `claude/system-email-unification` (created off fresh `origin/main` = `e1d7624`). Pre-existing dirty files (`scripts/seed-test-leads.mjs`, `services/hypercheap-voice-bridge/*`, `.cursor/`, `.claude/`, `tsconfig*.tsbuildinfo`) stay excluded from every commit as in prior tasks.
**Approved decisions locked in:** welcome endpoint requires a valid user JWT, derives the recipient exclusively from the authenticated user, requires a confirmed email, and is idempotent with persisted delivery state (`profiles.welcome_email_sent_at`, atomic claim); initial + resent invitations share `renderTeamInvitationEmail` with a server-derived `{invitation_id}`-only public contract; Agency Group email delivery fixed; `send-invite-email` / `send-welcome-email` / `send-email-previews` secured **in code** (verify_jwt flags unchanged); workflow + Gmail emails stay unwrapped. Local toolchain note: Deno 2.9.4 installed user-locally at `~/.deno` (official installer) to run the mandated `deno check`/`deno test` gates — removable with `rm -rf ~/.deno`.
**Scope:** All AgentFlow-owned transactional/system emails → one light, email-client-safe shell via a shared Edge renderer. Agency-authored workflow emails and user-authored Gmail/contact emails are explicitly **excluded** from the wrapper.

---

## 0. How this was audited

- Live code for all 7 target Edge Functions fetched via MCP `get_edge_function` and diffed byte-for-byte against repo (SHA/MD5 verified). Live snapshots saved to session scratchpad (`scratchpad/live/*`); per AGENT_RULES invariant #4 they will be **re-fetched immediately before any deploy**.
- Live DB introspected read-only (`pg_trigger`, `pg_get_functiondef`, `current_setting`, `cron.job`, `pg_extension`, RLS policies, `auth.users` counts). No DDL, no writes.
- WORK_LOG.md (all 7,800 lines) + docs/ scanned for every email decision. **Newest email decision: 2026-06-01 "Transactional Email Templates — Light-Mode Redesign"** (send-invite-email v208, send-welcome-email v234, create-user v34 → light system, commit `547d95c`). It explicitly did **not** touch invite-user or invite-to-agency-group. Nothing newer conflicts with this task — the canonical design below is the direct continuation of that decision. The 2026-07-29/30 entries (PRs #335–#337) are auth-page frontend only.

---

## 1. Email inventory & classification

| # | Email | Sender path | Caller / delivery path | Subject | From | Visual style today | Status |
|---|-------|-------------|------------------------|---------|------|--------------------|--------|
| 1 | Signup confirmation | `create-user` (v50, verify_jwt=true) | `AuthContext.signup()` → `SignupPage` (self-serve + invited signup); Resend send inside function, best-effort | "You're almost in — confirm your AgentFlow email" | `AgentFlow <team@fflagent.com>` | Light card (2026-06-01 system), div-based | ACTIVE |
| 2 | Team invitation (initial) | `invite-user` (v220, verify_jwt=false, in-code Admin auth) | `usersSupabaseApi.invite()` ← `InviteUserModal` (send + "Copy Link" both email) | "Invitation to join AgentFlow" | `AgentFlow <team@fflagent.com>` | **Dark glass**, `<style>`-block CSS, gradient text | ACTIVE |
| 3 | Team invitation (resend) | `send-invite-email` (v224, verify_jwt=false, **no auth at all**) | `sendInviteEmail()` ← `PendingInvitesTable` resend; also `SuperAdminDashboard` agency-provisioning wizard (direct `invitations` insert + this send) | "You've been invited to join AgentFlow" | `AgentFlow <team@fflagent.com>` | Light card | ACTIVE (open endpoint) |
| 4 | Welcome | `send-welcome-email` (v250, verify_jwt=false, **no auth at all**) | DB trigger `on_profile_created_welcome_email` → `pg_net` — **delivery dead** (see §3) | "Welcome to AgentFlow — You're all set" | `AgentFlow <team@fflagent.com>` | Light card | DEPLOYED but **never delivers** |
| 5 | Agency Group invitation | `invite-to-agency-group` (v20, verify_jwt=false, in-code Admin auth) | `agency-group/api.ts` ← `AgencyGroupLeaderView.handleInvite` | "You've been invited to join {MasterOrg}'s Agency Group on AgentFlow" | `AgentFlow <team@fflagent.com>` | **Dark glass** | **BROKEN — email crashes every send** (logoUrl scope bug) |
| 6 | Password recovery | Supabase Auth (GoTrue) template | `resetPasswordForEmail` (AuthContext.tsx:257; duplicate at supabase-users.ts:336) → `/reset-password` | Dashboard-managed | Dashboard/SMTP-managed (likely Supabase default SMTP) | Unknown — dashboard-only | ACTIVE (only Auth template in real use) |
| 7 | Auth: Confirm signup / Magic link / Change email / Invite / Reauth | GoTrue templates | **Bypassed** — no `auth.signUp`, `signInWithOtp`, `updateUser({email})`, or `inviteUserByEmail` anywhere in src/ | — | — | Unreviewed defaults | DORMANT |
| 8 | Workflow send_email | `workflow-executor` (v23, X-Workflow-Secret auth) | workflow-trigger-evaluator / workflow-resume-paused → Resend | Agency-authored (template/override) | `WORKFLOW_EMAIL_FROM` \|\| `AgentFlow <noreply@fflagent.com>` | **None — raw agency HTML, no wrapper (correct)** | ACTIVE |
| 9 | Contact email | `email-send-contact-message` via user's Gmail API | Contact composer / Conversations | User-authored | User's connected Gmail | User-authored | ACTIVE — **out of scope** |
| 10 | Template previews | `send-email-previews` (v21, verify_jwt=false, allowlist `cgarness.ffl@gmail.com`) | No repo callers — manual invocation | "[Preview] Confirm Your Email" | `AgentFlow <team@fflagent.com>` | Light (live); repo copy is stale dark 3-email version | PREVIEW/TEST-ONLY |
| 11 | `accept-invite` Edge Fn | (v44, verify_jwt=true) | **Zero callers** — `/accept-invite` route uses `get_invitation_by_token_rpc` + `/signup?token=`; acceptance happens inside create-user | — | — | — | **OBSOLETE/DEAD but deployed with service-role power** |

**Classification:** #1–#7 = AgentFlow system/transactional (unify). #8 = agency-authored workflow (never wrap). #9 = user-authored (untouched). #10 = preview/test-only (rebuild on shared renderers). #11 = obsolete/dead (decommission candidate, separate approval).

---

## 2. Live vs repo drift (invariant #4 check — every item)

| Function | Drift |
|---|---|
| `create-user` | **None.** Byte-identical (SHA-256 `4491797…` both). Absent from config.toml → default verify_jwt=true matches live. |
| `invite-user` | **Diverged both directions.** LIVE fallback = obsolete Lovable domain `https://preview--life-agent-hub.lovable.app`; renders a **text** logo (Agent/Flow spans). REPO fallback = `agentflow-life-insure.vercel.app`; renders an **image** logo — but `const logoUrl` is declared inside the handler (index.ts:22) and referenced in module-level `buildEmailHtml()` (index.ts:177) → **out of scope; deploying the repo file would silently kill every invite email** (ReferenceError swallowed, `email_sent:false`, API still `success:true`). Neither version is acceptable; both are replaced. |
| `send-invite-email` | None. Byte-identical (SHA-256 `685b20b…`); config.toml verify_jwt=false matches. |
| `send-welcome-email` | index.ts byte-identical. Repo dir additionally carries stray `confirmation_template.txt` (unused dark GoTrue-style template, not in live bundle). **config.toml has no entry → a CLI deploy from repo would silently flip verify_jwt false→true.** Live is v250 vs the v234 recorded in WORK_LOG — 16 unrecorded redeploys, all landing on identical bytes. |
| `invite-to-agency-group` | None. Byte-identical (MD5 `6388a32…`) — meaning the **fatal logoUrl scope bug (index.ts:22 declared in handler, referenced at index.ts:222 in module-level `buildEmailHtml`) is live**: every send throws ReferenceError, caught and swallowed; invites are recorded with `email_sent:false` and no invitee ever gets an email. |
| `send-email-previews` | **Major drift — repo is stale.** Repo = pre-redesign dark 3-email harness (dark confirm + dark agency-group + unwrapped workflow sample). LIVE v21 = light single confirm preview, edited directly in prod on 2026-06-01 and never committed (WORK_LOG.md:1929/1933 documents this). Deploying from repo would regress the live design. New repo version will be authored from the live baseline + shared renderers. |
| `workflow-executor` | None. All 4 bundled files (index.ts, `_shared/workflowAuth.ts`, `_shared/workflowMergeFields.ts`, `_shared/twilioSubaccountCreds.ts`) MD5-identical to live. |

---

## 3. Defect register

### P0 — security (block-level)

1. **`send-invite-email` is an open phishing relay.** verify_jwt=false + zero in-code auth + CORS `*`; caller controls recipient, firstName, role, and the CTA `inviteURL` (any scheme/domain), all interpolated unescaped (plus `String.replace` `$`-pattern expansion). Anyone on the internet can send arbitrary-content mail from `team@fflagent.com` to any address. (index.ts:17–110)
2. **`send-welcome-email` is an open relay too.** Same posture; caller controls recipient + unescaped firstName into the HTML. (index.ts:15–133)
3. **`create-user` anonymous privilege escalation** *(flagged; fix is a separate approval item A7a — it changes signup behavior)*: endpoint is effectively public (anon key), yet body-supplied `role` / `organization_id` / `upline_id` / `commission_level` flow unchecked into `profiles` via SECURITY DEFINER `handle_new_user` — an anonymous caller can self-register as **Admin in any existing org**. Related: `.ilike("email", email)` wildcard injection can auto-accept other pending invitations (index.ts:145); invite acceptance doesn't validate that the invitation's email/org/role match the signup; `admin.createUser` error text leaks account existence.
4. **`invitations_update_status` RLS policy** *(flagged; A7b, needs `#APPROVE_RLS_CHANGE`)*: grants UPDATE on **all** invitation rows to **any authenticated user** (`USING true`, only `WITH CHECK status='accepted'`) — a hostile user can rewrite email/role/org/commission on any org's pending invite. Also dead weight for the real flow (edge functions write `'Accepted'` capitalized via service role).
5. **HTML injection by org admins**: `invite-user` interpolates `firstName`/`role` unescaped (index.ts:181); `invite-to-agency-group` interpolates `masterOrgName`/`groupName` unescaped into body and subject (index.ts:171,225,226) — admin-controlled DB strings become raw HTML in platform-signed mail to arbitrary recipients.
6. **`workflow-executor` cross-tenant template read** *(optional surgical fix A7c)*: `message_templates` lookups filter by id only on a service-role client (index.ts:458–464, 554–561) — a node config holding another org's template UUID sends that org's content. (SSRF via the webhook action and merge-field HTML injection are also present — documented as out-of-scope follow-ups, no change proposed here.)

### P1 — reliability

7. **Welcome delivery is dead.** Verified live: `current_setting('app.settings.supabase_url')` and `…service_role_key` are **NULL**; the trigger's guard `RAISE WARNING`s and returns — every welcome email is silently skipped. The migration's design also stores a service-role key in a DB GUC (readable via `current_setting` from any SQL context) — forbidden going forward. **Bonus finding:** cron jobs 1 (`spam-check-daily`) and 2 (`daily-call-limit-reset`) build their Authorization header from the same NULL GUC and are silently broken daily (separate follow-up A7d).
8. **Agency-group invite email crashes 100% of the time** (logoUrl scope bug, §2) — invites recorded, never delivered; only signal is `email_sent:false` (the UI does surface "Recorded — email may not have sent.").
9. **False success reporting:** `InviteUserModal` toasts "Invitation email sent" unconditionally, ignoring `email_sent`; `send-email-previews` returns `success:true` even when every send failed; `SuperAdminDashboard` inserts the invitation *before* the send, so a failed send strands a pending invite and a retry duplicates it.
10. **verify_jwt posture not reproducible:** `send-welcome-email` (and `create-user`) missing from config.toml.
11. Deliverability: **no plain-text part, no hidden preheader, no List-Unsubscribe** on any system email; hardcoded "© 2026"; invalid `width="auto"` attr.

### P2 — consistency / rendering

12. Initial vs resent invitation use **different functions, templates (dark vs light), and subjects**.
13. Dark-glass templates (invite-user, invite-to-agency-group) rely on `<head><style>` class CSS, gradient text via `-webkit-background-clip`, rgba/border-radius/box-shadow — stripped or unrenderable in Outlook; light templates are div-based (no table fallback) so Outlook desktop loses width/radius/shadow too.
14. URL/fallback chaos: live invite-user → Lovable preview domain; five functions → `agentflow-life-insure.vercel.app`; send-welcome-email uses **two different fallbacks in one email** (`vercel.app` logo/footer vs `agentflow.app` CTA); live send-email-previews hardcodes `https://fflagent.com/dashboard`. `sendInviteEmail` builds the CTA from `window.location.origin` (emailed domain follows whatever origin the inviter browsed).
15. Stray dark artifact `send-welcome-email/confirmation_template.txt` contradicts the shipped light system; `usersSupabaseApi.resendInvite` is dead code; invitation tokens are returned in JSON responses (wider exposure than the recipient's inbox).

---

## 4. Canonical design & shared module

**Design tokens** (continuation of the documented 2026-06-01 light system, upgraded to email-safe structure per this task's spec):

- Outer bg `#F1F5F9`; centered **560px** white card, 1px `#E2E8F0` border, 8px radius; 4px `#2563EB` top accent; official image logo `${siteUrl}/agentflow-logo-full.png` (h36) + small-caps tagline; system font stack; H1 `#0F172A` 26/800; body `#475569`; solid `#2563EB` CTA (8px radius); optional pill badge (`#EFF6FF`/`#1D4ED8`/border `#BFDBFE`); footer `#F8FAFC` with tagline "LIFE INSURANCE CRM & POWER DIALER" + `© {currentYear} AgentFlow Inc.`
- **Table-based structural layout** (role="presentation", MSO-safe centering), all CSS inline, minimal `<style>` reset only; solid hex colors; no gradients, no backdrop-filter, no background-clip text, no emoji-as-icon, no hardcoded years, no preview/obsolete domains.
- Every email gets: hidden preheader, **plain-text alternative**, visible fallback URL box for security/invitation actions, mobile padding via `@media` (progressive enhancement only).

**New module `supabase/functions/_shared/systemEmail.ts`** (Deno-native, zero new deps, camelCase per `_shared` convention):

```
escapeHtml(v)                       // & < > " ' — used on EVERY interpolated value
safeUrl(v)                          // https-only allowlist + attribute-encoding for href/src
resolveSiteUrl()                    // PUBLIC_SITE_URL || "https://www.fflagent.com"  (D2)
resolveLogoUrl(siteUrl)             // `${siteUrl}/agentflow-logo-full.png`
SYSTEM_EMAIL_FROM                   // "AgentFlow <team@fflagent.com>"  (D1)
renderSystemEmail({ preheader, badge?, heading, bodyHtml (pre-escaped via helpers),
                    cta?: {label, url}, fallbackUrl?, footerNote? })
  → { html, text }                  // text = deterministic plain-text rendering
```

Each function keeps its own subject + copy and calls the renderer; Resend payload always includes `html`, `text`.

---

## 5. Per-email changes

### 5.1 `create-user` (confirmation)
Migrate `buildConfirmEmailHtml` to `renderSystemEmail` (badge "VERIFY YOUR EMAIL", same subject/copy/CTA "Confirm email →", fallback URL box). Preserve exactly: verify_jwt=true, `admin.createUser` + `generateLink({type:'signup'})` behavior, best-effort send (`email_sent` accurate, never aborts), existing escaping. Add text part + preheader. Fallback domain → D2. Add explicit `[functions.create-user] verify_jwt = true` to config.toml. **No auth-model change in this pass** (P0 #3 is approval item A7a).

### 5.2 `invite-user` (initial team invitation)
Keep untouched: JWT validation + Admin/Super-Admin gate, caller-org scoping of the insert, invitation-creation-survives-email-failure (`email_sent:false` accurate). Replace the dark template with the shared renderer; **escape firstName, role, org name**; kill the Lovable fallback (D2). Fetch the caller org's `name` (one query, `.maybeSingle()`) for subject/copy — **R1:** unified subject for initial *and* resent invitations: `You've been invited to join {OrgName} on AgentFlow` (fallback "an AgentFlow agency"). Also: profiles lookup `.single()` → `.maybeSingle()`; stop returning the raw DB error string; stop returning `token` in the response (the accept URL is already emailed; `PendingInvitesTable`/UI don't use it — verified) — **R2**, approve or keep token.

### 5.3 `send-invite-email` (resend) — **secure + internalize the contract (A2)**
Decision needed; **recommendation: keep the endpoint, harden it** (it serves two real UI flows):
- New contract: body `{ invitation_id }` only. In-code auth (verify_jwt stays false per invariant #2): validate Bearer JWT → load caller profile → require (Admin/Super-Admin of `invitation.organization_id`) OR `is_super_admin`. Load the invitation `.maybeSingle()`; 404 if missing/not Pending.
- Server derives recipient/name/role/org and builds `inviteURL = ${siteUrl}/accept-invite?token=…` — **no more caller-supplied recipient, HTML fields, or `window.location.origin` URLs**. Renders via the **same renderer + same subject as invite-user** (the "initial and resent invitations use the same renderer" test asserts this).
- Frontend: `sendInviteEmail()` sends `{invitation_id}`; `PendingInvitesTable` passes the invite id; `SuperAdminDashboard` keeps its create-then-send flow but now sends only the id (and its failure toast becomes accurate: invitation recorded, email failed).
- Rejected alternatives: *eliminate* (breaks resend UX; SuperAdmin flow would need invite-user rework), *fold into invite-user* (invite-user always creates a new invitation row — resend must not).

### 5.4 `send-welcome-email` — **fix delivery architecture (A3) + secure**
Template → shared renderer (keep subject/copy/3 feature rows; icons become neutral initials/blue squares, not emoji-as-primary). Endpoint hardening + delivery, **decision needed**:
- **Option B (recommended) — JWT self-service, trigger retired:** function requires a valid Bearer JWT (in-code `getUser`), derives recipient email + first name **from the caller's own profile** (arbitrary-recipient send becomes impossible by construction), idempotent via new `profiles.welcome_email_sent_at` (migration; `.maybeSingle()` guard; send once). Frontend calls it fire-and-forget after first confirmed login (`AuthCallback`/dashboard mount — one small hook). Migration **drops** `on_profile_created_welcome_email` + `handle_new_user_welcome_email` (the GUC-dependent dead path). Email failure can never block anything (it's post-login and best-effort). Welcome lands *after confirmation* instead of simultaneously with the confirm email — better sequencing.
- **Option A (alternative) — keep DB-trigger delivery, fix its transport:** migration replaces the GUC pattern with a `private.system_email_config` table (url + internal secret, mirroring `private.workflow_engine_config`); trigger posts with `X-System-Email-Secret`; function validates that header. No frontend change; welcome fires at profile insert (same moment as the confirm email); service-role key never stored in Postgres settings either way.
- Both options: add `[functions.send-welcome-email] verify_jwt = false` to config.toml; delete stray `confirmation_template.txt`; single site-URL resolution (D2) — the two-fallback split disappears.

### 5.5 `invite-to-agency-group`
Fix the fatal scope bug by construction (renderer takes parameters). **Escape masterOrgName + groupName in body AND subject.** Keep: JWT + Admin gate, master-org scoping, contacts/phone/billing/settings-independence copy, `email_sent` semantics (the UI already surfaces it correctly). Migrate to light shell; fallback domain → D2; drop the dead `organization_name` body field/param. Known non-email bug **not** fixed silently (flag A7e): the duplicate-membership check is global-one-group for org-matched invites but group-scoped for email-matched ones, and discarded `maybeSingle` errors can bypass dedupe.

### 5.6 Supabase Auth templates (A6 — nothing changes without approval)
Only **Recovery** is in real use (verified: no `auth.signUp`/OTP/`updateUser({email})`/`inviteUserByEmail` in src; all 4 prod users confirmed via the create-user Resend path). Deliver in-repo, version-controlled canonical templates for all five (`supabase/templates/auth/{confirm_signup,recovery,magic_link,change_email,invite_user}.html` + subjects doc) rendered in the same visual system with GoTrue variables (`{{ .ConfirmationURL }}` etc.).
**Manual dashboard steps (Chris or approved agent):** Dashboard → Authentication → Emails → Templates → paste subject+HTML per tab; **also inspect SMTP Settings tab** — no custom SMTP exists in repo config, so Recovery likely goes out via Supabase default SMTP (unbranded sender, ~2/hr rate limit) — decision D4: configure custom SMTP (e.g. Resend SMTP with `team@fflagent.com`) — DNS-sensitive, dashboard-only, explicitly approval-gated. Alternative to the dashboard: Management API `PATCH /v1/projects/jncvvsvckxhqgqvkppmj/config/auth` (documented in the repo doc, still approval-gated).

### 5.7 `send-email-previews`
Rewrite **from the live v21 baseline** (repo copy is stale — §2): render every system template via the shared renderers (confirm, team invite initial=resend, welcome, agency-group) with clearly-fake data + "[Preview]" subjects; keep the hardcoded allowlist (`cgarness.ffl@gmail.com`); add in-code auth (valid JWT + `is_super_admin`); fix false-success (report per-send results and overall `success` honestly); no send occurs in this task without approval (A9). The removed "workflow raw sample" stays removed — workflow emails are intentionally unwrapped and don't belong in the system-template preview set.

### 5.8 `workflow-executor`
**No wrapper — no change to email rendering.** Verified live+repo identical; send_email passes agency-authored HTML verbatim (correct per product intent; a neutral agency wrapper is documented as a future option only). Sole surgical candidate (A7c, separate approval): add `.eq("organization_id", execution.organization_id)` to the two `message_templates` lookups (index.ts:458–464, 554–561) to close the cross-tenant read. `WORKFLOW_EMAIL_FROM` / `noreply@fflagent.com` untouched.

---

## 6. Sender & URL standardization (decisions)

- **D1 — canonical system sender:** `AgentFlow <team@fflagent.com>` (already used by all 6 system functions; zero DNS change). Workflow sender stays `WORKFLOW_EMAIL_FROM` \|\| `AgentFlow <noreply@fflagent.com>`. Centralized in `systemEmail.ts` as the one literal. *Manual check for Chris (no repo action): confirm fflagent.com is the verified Resend domain — nothing in repo/worklog records SPF/DKIM setup.*
- **D2 — canonical site URL:** `PUBLIC_SITE_URL` env, code fallback `https://www.fflagent.com` (the verified production domain — worklog-confirmed live; **not** an invented domain). Removes: `preview--life-agent-hub.lovable.app` (live invite-user), `agentflow-life-insure.vercel.app` (6 functions), `agentflow.app` (send-welcome-email CTA), hardcoded `fflagent.com/dashboard` (live previews), and `window.location.origin` URL-building in `supabase-users.ts`. *Deploy-time check: confirm the `PUBLIC_SITE_URL` secret value in Supabase (can't be read via MCP) and that `https://www.fflagent.com/agentflow-logo-full.png` serves 200.*
- **D3 — logo:** keep `/agentflow-logo-full.png` from the site origin (asset exists in `public/`, currently reachable); no storage mirror in this pass.
- **D4 — Auth SMTP:** see §5.6 — dashboard inspection + decision, approval-gated.

---

## 7A. IMPLEMENTATION COMPLETE — actual files changed (2026-07-30)

**Gates all green:** `npx tsc --noEmit` clean · `npx vitest run` **526/526** (baseline unchanged) · `deno check` clean on all 6 changed Edge Functions · `deno test` **79/79** on the shared modules · `git diff --check` clean · repo-wide sweep: zero `lovable` / `vercel.app` / `agentflow.app` / hardcoded-year / `buildEmailHtml` left under `supabase/functions/`.

| File | Status |
|---|---|
| `supabase/functions/_shared/systemEmail.ts` | NEW — renderer, tokens, escaping, URL/sender resolution, plain-text |
| `supabase/functions/_shared/systemEmailTemplates.ts` | NEW — the 4 system templates + subjects |
| `supabase/functions/_shared/systemEmailAuth.ts` | NEW — in-code caller auth helpers |
| `supabase/functions/_shared/{systemEmail,systemEmailTemplates,systemEmailAuth}.test.ts` | NEW — 79 Deno tests |
| `supabase/functions/create-user/index.ts` | EDIT — shared renderer; behavior preserved |
| `supabase/functions/invite-user/index.ts` | EDIT — shared renderer, dark template + scope bug deleted, `.maybeSingle()`, org name, no raw DB error |
| `supabase/functions/send-invite-email/index.ts` | REWRITE — `{invitation_id}` + JWT/Admin/org gate, same renderer as initial |
| `supabase/functions/send-welcome-email/index.ts` | REWRITE — Option B JWT self-service + atomic idempotent claim |
| `supabase/functions/send-welcome-email/confirmation_template.txt` | DELETED |
| `supabase/functions/invite-to-agency-group/index.ts` | EDIT — logoUrl crash fixed, escaping in body + subject |
| `supabase/functions/send-email-previews/index.ts` | REWRITE — all 4 templates, super-admin auth, honest results |
| `supabase/config.toml` | EDIT — records live verify_jwt posture (no deployment change) |
| `supabase/migrations/20260730120000_welcome_email_delivery_v2.sql` | NEW — **NOT APPLIED** |
| `supabase/templates/auth/*.html` (5) + `docs/auth-email-templates.md` | NEW — **NOT APPLIED to dashboard** |
| `src/lib/supabase-users.ts` | EDIT — `sendInviteEmail(invitationId)`, dead `resendInvite` removed, `createInvitation` → `{id, token}` |
| `src/components/settings/user-management/{InviteUserModal,PendingInvitesTable}.tsx` | EDIT — honor `email_sent`; resend by id |
| `src/pages/SuperAdminDashboard.tsx` | EDIT — no duplicate invitation on email failure |
| `src/components/layout/AppLayout.tsx` + `src/hooks/useWelcomeEmailTrigger.ts` | EDIT/NEW — one-time welcome trigger |
| `src/integrations/supabase/types.ts` | EDIT — `welcome_email_sent_at` on profiles |
| `AGENT_RULES.md` | EDIT — new invariant #20 |
| `WORK_LOG.md`, `implementation_plan.md` | EDIT — entry + this plan |

**Untouched (verified):** `supabase/functions/workflow-executor/` (`git diff` empty), `email-send-contact-message`, all Twilio/dialer code, `accept-invite`, every RLS policy. **Excluded from commits:** `scripts/seed-test-leads.mjs`, `services/hypercheap-voice-bridge/*`, `.cursor/`, `.claude/`, `tsconfig*.tsbuildinfo`, `deno.lock` (installer/workspace noise, reverted).

---

## 7. Files to touch (original plan)

| File | Change |
|---|---|
| `supabase/functions/_shared/systemEmail.ts` | **NEW** — tokens, renderer, escaping, URL/sender resolution, plain-text |
| `supabase/functions/_shared/systemEmail.test.ts` | **NEW** — Deno unit tests (see §9) |
| `supabase/functions/create-user/index.ts` | EDIT — confirm email via renderer; D2 fallback |
| `supabase/functions/invite-user/index.ts` | EDIT — renderer, escaping, org-name subject, Lovable fallback removed, `.maybeSingle()`, response hygiene |
| `supabase/functions/send-invite-email/index.ts` | REWRITE — `{invitation_id}` contract + in-code auth + shared renderer (identical to initial invite) |
| `supabase/functions/send-welcome-email/index.ts` | REWRITE — renderer + Option A/B auth & delivery |
| `supabase/functions/send-welcome-email/confirmation_template.txt` | **DELETE** — stray dark artifact |
| `supabase/functions/invite-to-agency-group/index.ts` | EDIT — logoUrl fix via renderer, escaping (body+subject), D2 |
| `supabase/functions/send-email-previews/index.ts` | REWRITE from live baseline — all system templates via renderer, auth, honest results |
| `supabase/config.toml` | EDIT — explicit `create-user` (true) + `send-welcome-email` (false) entries |
| `supabase/migrations/<ts>_welcome_email_delivery_v2.sql` | **NEW** — Option B: drop trigger+fn, add `profiles.welcome_email_sent_at`; Option A: `private.system_email_config` + trigger rewrite |
| `src/lib/supabase-users.ts` | EDIT — `sendInviteEmail({invitation_id})`; remove `window.location.origin` URL build; delete dead `resendInvite` |
| `src/components/settings/user-management/PendingInvitesTable.tsx` | EDIT — new resend payload |
| `src/components/settings/user-management/InviteUserModal.tsx` | EDIT — honor `email_sent` in toasts |
| `src/pages/SuperAdminDashboard.tsx` | EDIT — new send payload + accurate failure toast |
| (Option B only) `src/pages/AuthCallback.tsx` or small hook + `src/contexts/AuthContext.tsx` | EDIT — fire-and-forget welcome trigger post-confirmation |
| `supabase/templates/auth/*.html` + `docs/auth-email-templates.md` | **NEW** — five Auth templates + subjects + exact dashboard/Management-API steps |
| Tests: existing vitest files for touched components + new renderer tests | EDIT/NEW |
| `implementation_plan.md`, `WORK_LOG.md`, `AGENT_RULES.md` | this plan; SHIPPED entry; new invariant (§10) |

**Explicitly untouched:** `workflow-executor` email path (unless A7c approved), `email-send-contact-message`, all Twilio/dialer code, `accept-invite` (decommission is A7f, not an edit), RLS policies (unless A7b approved), DNS/Vercel/env values.

---

## 7B. Authentication posture per Edge Function (threat model)

**Why `verify_jwt=false` is the norm here, not laziness.** Per AGENT_RULES invariant #2, the Supabase gateway rejects this project's **ES256**-signed user access tokens when `verify_jwt=true`. A frontend-called function set to `verify_jwt=true` would reject every real user token at the gateway. The supported pattern is therefore `verify_jwt=false` + **mandatory in-code validation** via `auth.getUser(jwt)` on a service-role client. `verify_jwt` is a transport-layer gate only — it proves *some* valid project JWT was presented (the public anon key qualifies), never *who* the caller is. **Authorization is always in code.**

| Function | `verify_jwt` | In-code authorization | Threat-model justification |
|---|---|---|---|
| `create-user` | **true** (unchanged) | **None** — deliberately anonymous | Public signup endpoint: no user exists yet, so no user JWT can exist. The anon key satisfies the gateway, which means `verify_jwt=true` provides **no real protection** — it only blocks unauthenticated internet scanners. **This is the endpoint the P0 security work must fix** (body-supplied `role`/`organization_id` are trusted). Left as-is here per exclusion instruction. |
| `invite-user` | false | JWT → profile → `Admin`/`Super Admin`/`is_super_admin`; invitation always inserted with the **caller's own** `organization_id` | Frontend-called with a user token (ES256 → gateway must not verify). Recipient is arbitrary but only reachable by an authenticated org Admin; cross-org invitation is impossible because the org is derived from the caller, never the body. |
| `send-invite-email` | false | JWT → `isOrgAdmin` → `canManageOrganization(invitation.organization_id)`; cross-org returns the **same 404** as a missing row | Frontend-called with a user token. Was an open relay; now the recipient, name, role, and CTA URL all come from the `invitations` row, so a caller controls nothing but *which* invitation id to resend, and only within their own org. |
| `send-welcome-email` | false | JWT → **confirmed email required** → recipient is `user.email` from the validated token; atomic one-time claim | Frontend-called with a user token. Arbitrary-recipient send is impossible **by construction** — the body is ignored entirely. Worst case for a hostile authenticated user is mailing *themselves*. |
| `invite-to-agency-group` | false | JWT → profile → `Admin`/`is_super_admin` → group's `master_organization_id` must equal caller's org (super admin exempt) | Frontend-called with a user token. Unchanged auth model; only the (previously crashing) email path was rewritten. |
| `send-email-previews` | false | JWT → **`is_super_admin` only** → hardcoded recipient allowlist | Internal design-QA tool. Two independent gates: even a stolen super-admin token can only mail the one allowlisted address. Previously had **no** auth at all. |
| `workflow-executor` | false | `X-Workflow-Secret` shared secret (unchanged) | Server-internal only (pg_net triggers, cron, edge→edge). Never receives user JWTs. **Not modified by this PR.** |

**Residual risk, stated plainly:** every gate above except `send-welcome-email`'s self-scoping resolves through `profiles.role` / `profiles.is_super_admin`, and RLS policy `profiles_update_own` (`UPDATE USING (id = auth.uid())`, **no `WITH CHECK`**) currently lets any authenticated user write those columns on their own row. **Until the P0 authorization remediation lands, these gates are only as strong as a self-writable column.** That is why this PR is marked blocked rather than merge-ready.

---

## 8. Deployment & rollback sequence (after approval only)

1. Implement on branch → `npx tsc --noEmit` → `npx vitest run` (526 baseline) → `deno check` + `deno test` on touched functions → `git diff --check` → PR for review.
2. **Apply the welcome migration FIRST** (`20260730120000_welcome_email_delivery_v2.sql`) via `apply_migration`, BEFORE deploying `send-welcome-email` or merging the frontend. Two reasons: (a) the new function selects `profiles.welcome_email_sent_at`, so without the column every invocation 500s while the frontend's per-tab `sessionStorage` guard suppresses the retry — those users silently never get a welcome email; (b) the migration's backfill is the guard against a mass send.
   - **Mass-send guard — verify, do not assume.** Immediately after applying, run `SELECT count(*) FROM public.profiles WHERE welcome_email_sent_at IS NULL`. It MUST return **0**. A non-zero count means the backfill did not run, and deploying the frontend would mail "Welcome to AgentFlow" to the entire existing user base — irreversible, from the shared `team@fflagent.com` sender. Do not proceed to step 3 until this returns 0.
3. **Per function, immediately before deploy:** `get_edge_function` re-fetch (invariant #4), archive live body, then deploy **complete** contents incl. the three `_shared/systemEmail*.ts` modules. Order: `send-email-previews` -> (approved test sends to allowlisted inbox; client matrix §9) -> `invite-to-agency-group` -> `invite-user` -> `send-invite-email` (**with** the frontend PR merged in lockstep — contract change) -> `create-user` -> `send-welcome-email`. verify_jwt flags preserved exactly (all changes are in-code auth).
4. Post-deploy: `list_edge_functions` version check; edge logs for each function; one end-to-end invite + resend + agency-group invite against a controlled address (approval-gated); `get_advisors(security)` after the migration.
5. **Rollback:** functions — redeploy the archived live bodies (already snapshotted this session; re-archived at deploy time). Migration — Option B down path documented in-file (recreate trigger/fn from `20260331195900`, drop column); Option A down = drop config table + restore old fn. Frontend — `git revert` of the squashed commit. Auth dashboard — templates are pasted manually, so rollback = re-paste previous content (screenshot each template before changing; noted in the doc).

---

## 9. Tests & verification matrix

**Automated (new `systemEmail.test.ts` + per-function template tests):**

| Assertion | Covers |
|---|---|
| Every system template renders non-empty html+text | confirm, invite (initial+resend), welcome, group-invite, previews |
| No unresolved `{{…}}` / `${…}` tokens in output | all |
| `escapeHtml`/`safeUrl` on every dynamic value — incl. `O'Brien & Sons`, `"><script>`, `&`, `<`, `>` org/group/first names | all |
| CTA + visible fallback URL correct & https-only | confirm, invites |
| Logo URL = `${resolveSiteUrl()}/agentflow-logo-full.png`; no lovable/vercel/agentflow.app literals anywhere in `supabase/functions` (grep test) | all |
| Plain-text part present; hidden preheader present; `© ${new Date().getFullYear()}` dynamic | all |
| From = D1 constant; subjects match convention | all |
| **Initial and resent invitation produce identical HTML for identical inputs (same renderer call)** | invite-user + send-invite-email |
| Email failure never aborts invitation/user/profile creation (unit: send-stub throws → success path with `email_sent:false`) | create-user, invite-user, group-invite |
| Unauthorized caller → 401/403 (auth-helper unit tests; live curl smoke post-deploy) | send-invite-email, send-welcome-email, send-email-previews |
| Workflow emails unwrapped: `workflow-executor` byte-diff empty (or A7c-only diff) | workflow-executor |
| Frontend: vitest for new payloads/toast logic | supabase-users, InviteUserModal, PendingInvitesTable, SuperAdminDashboard |

**Gates:** `npx tsc --noEmit` · `npx vitest run` · `deno check`/`deno test` on touched functions · `git diff --check` · post-migration `get_advisors(security)`.

**Visual matrix (via approved preview sends to the allowlisted inbox):** Gmail web · Apple Mail · Outlook web · Outlook desktop (Word engine — table layout must hold) · narrow mobile (~375px). One pass per template.

---

## 10. Proposed AGENT_RULES.md invariant (added on ship)

> **System email renderer** — Every AgentFlow-owned transactional/system email (signup confirmation, team invitation initial **and** resent, welcome, Agency Group invitation, Auth templates, previews) MUST render through `supabase/functions/_shared/systemEmail.ts` (light shell, table layout, inline CSS, escaped values, text part, dynamic year, `PUBLIC_SITE_URL` → `https://www.fflagent.com` fallback, sender `AgentFlow <team@fflagent.com>`). Agency-authored workflow emails (`workflow-executor` send_email) and user-authored Gmail/contact emails are **excluded** and must never be wrapped in the AgentFlow shell. No standalone mail endpoint may accept a caller-supplied recipient or HTML without application-level authorization.

---

## 11. Approval checklist — Chris decides each

| # | Item | Default if unstated |
|---|---|---|
| **A1** | Shared renderer + migrate the 5 system templates (§4–5) | core of the task |
| **A2** | `send-invite-email` hardening + `{invitation_id}` contract (frontend lockstep) | recommended |
| **A3** | Welcome delivery: **Option B** (JWT self-service + drop trigger) vs Option A (private-config trigger) | recommend **B** |
| **A4** | The welcome migration (shape depends on A3) | required by A3 |
| **A5** | D1/D2/D3 sender + URL standardization; confirm `PUBLIC_SITE_URL` secret at deploy | recommended |
| **A6** | Auth templates: repo-authored files + manual dashboard application + SMTP decision (D4) | files yes; dashboard only on explicit go |
| **A7** | Separately-approvable security follow-ups: **a)** create-user priv-esc hardening · **b)** `invitations_update_status` RLS fix (`#APPROVE_RLS_CHANGE`) · **c)** workflow-executor org-scoped template lookups · **d)** cron jobs 1–2 NULL-GUC fix · **e)** group-invite dedupe logic · **f)** decommission dead `accept-invite` | **not** in this pass unless approved |
| **A8** | `send-email-previews` rewrite + super-admin auth | recommended |
| **A9** | Post-deploy test sends to `cgarness.ffl@gmail.com` + client visual matrix | requires explicit go |
| **R1/R2** | Unified subject "You've been invited to join {OrgName} on AgentFlow"; stop returning invite token in JSON | recommend yes |

---

## 12. Release execution state (live — updated as the rollout proceeds)

**Preflight verified 2026-07-31:** `main` = `ad893910c7072af1729e7d3a40397ba62057cfbd` · PR #338 head = `f7a208ff3d1a7fc3d144858c752e94aad94ae7de`, OPEN/draft, **MERGEABLE / CLEAN** · security migration `20260731180000` applied **exactly once** at the repo filename version · `welcome_email_sent_at` **absent** · welcome migration `20260730120000` **not applied** · `create-user` live **v51** (`verify_jwt=true`) · 4 profiles, 1 organization · `profile_authz` present, 3 profiles policies, `trg_00_enforce_profile_field_authorization` present, `anon` holds **0** grants on `profiles` · `net.http_request_queue` empty · no leftover test fixtures · `https://www.fflagent.com` **200**, `/agentflow-logo-full.png` **200 image/png** · no `lovable` / `vercel.app` / `agentflow.app` under `supabase/functions/` · sender `AgentFlow <team@fflagent.com>`, `resolveSiteUrl()` fallback `https://www.fflagent.com`.

### Remaining rollout order (each step archives the live body immediately before deploying, preserves the reviewed `verify_jwt`, and ships the three `_shared` modules)

| # | Step | State |
|---|---|---|
| 1 | Apply `20260730120000_welcome_email_delivery_v2.sql`, then assert NULL count = **0** | ✅ **DONE** — applied, history repaired to the repo version (exactly once). NULL count **0**, 4/4 profiles backfilled, old trigger + function dropped, `net.http_request_queue` **0** (no mail sent), #340 guard/policies/grants intact, `authenticated` cannot write the new column, `service_role` can (welcome claim works). |
| 2 | Deploy `send-email-previews` (live v21 → **v22**, `verify_jwt=false`) | ✅ **DONE** — ACTIVE. Live v21 archived (only copy not in git). Auth gate verified: no header → 401, anon-key bearer → 401, GET → 405. Previously this endpoint had **no** caller auth. |
| 3 | Send **exactly four** previews to `cgarness.ffl@gmail.com` only | ⛔ **BLOCKED — credential unavailable.** v22 is correctly super-admin gated, so invoking it needs a **super-admin user JWT**. Available to this environment: anon key only. No `SUPABASE_SERVICE_ROLE_KEY` (it is an Edge secret), no Supabase Management API token, no authenticated CLI, no connected Chrome session. Templates were instead verified by rendering them **locally with Deno** and inspecting the real HTML in a browser (see §12a). |
| 4 | Deploy `invite-to-agency-group` (live v20, `verify_jwt=false`) | see below |
| 5 | Deploy `invite-user` (live v220, `verify_jwt=false`) | see below |
| 6 | Deploy `create-user` (live v51, **`verify_jwt=true`**) | see below |
| 7 | Deploy `send-welcome-email` (live v250, `verify_jwt=false`) | see below |
| 8 | Apply 5 Auth email templates | ⛔ **BLOCKED — credential unavailable.** Requires Management API token, authenticated CLI, or a logged-in Dashboard session; none present (`list_connected_browsers` → `[]`). Not attempted by any unsupported route. |
| 9 | Merge PR #338 (head-SHA guard, merge-commit method), watch Vercel | see below |
| 10 | Deploy `send-invite-email` (live v224) **at the narrowest safe point around the merge** — its `{invitation_id}`-only contract is a breaking change vs. the currently deployed frontend | see below |
| 11 | Production verification + advisors + `WORK_LOG.md` via a separate branch/PR | see below |

**Rollback per component:** Edge Function → redeploy its archived complete live body at the recorded `verify_jwt`. Welcome migration → `ALTER TABLE public.profiles DROP COLUMN IF EXISTS welcome_email_sent_at;` then recreate trigger + function from `20260331195900_welcome_email_trigger.sql`. Frontend → restore the prior Vercel production deployment or revert the merge commit. Auth templates → restore captured prior values.

**Known constraint:** no Supabase Management API access token is present in the environment and the Supabase CLI is unauthenticated, so Auth-template application must go through authenticated Dashboard automation; if that is unavailable it is the one item that may need a nontechnical login from Chris.


## 12a. Template verification actually performed (no deployment required)

All four templates were rendered **locally with Deno** by importing the shipped `_shared/systemEmailTemplates.ts` directly, using hostile inputs (`O'Brien & Sons <script>alert(1)</script>`, `Team Leader<img src=x onerror=alert(1)>`, `Evil\r\nBcc: attacker@evil.com`) and inspected in a real browser at desktop and **375px**:

- **Escaping** — no raw `<script>` or raw `<img …onerror…>` in any body; both render as inert visible text. `document.querySelectorAll('script').length === 0`; zero console output.
- **Header injection** — CR/LF stripped from subjects (`subject has CR/LF: false`); `Evil\r\nBcc:` collapses to a single line.
- **Structure** — table-based, inline CSS; the one `<style>` block is resets + a single `.af-pad` media query (not class-based layout).
- **Logo** — `https://www.fflagent.com/agentflow-logo-full.png`, `naturalWidth > 0` (loads live).
- **CTAs** — `…/dashboard?token=…`, `…/accept-invite?token=…`, `…/dashboard`, `…/accept-group-invite?token=…` — all absolute https.
- **Preheader** — present and hidden (`display:none; font-size:1px; max-height:0; opacity:0; mso-hide:all`), measured height < 2px.
- **Footer year** — `© 2026`, from `new Date().getFullYear()`.
- **Mobile 375px** — no horizontal scroll (`scrollWidth === innerWidth === 375`), CTA within viewport, fallback URL wraps.
- **Plain-text alternative** — present for all four and readable with images off.
- **No** `lovable` / `vercel.app` / `agentflow.app` in any output.

**Not claimed:** Gmail / Apple Mail / Outlook web / Outlook desktop were **not** inspected, and no preview email has been sent. Resend's acceptance of `team@fflagent.com` is therefore **still unproven for the new renderer** (it is the sender the live functions already use).
