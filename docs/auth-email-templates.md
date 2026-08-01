# Supabase Auth (GoTrue) Email Templates

Version-controlled source of truth for the five Supabase Auth email templates:
[`supabase/templates/auth/`](../supabase/templates/auth/).

These are **GoTrue** emails — sent by Supabase Auth itself, not by any AgentFlow Edge
Function. They are rendered by Go's `html/template`, so they use GoTrue variables
(`{{ .ConfirmationURL }}`, `{{ .SiteURL }}`, `{{ .Email }}`, `{{ .NewEmail }}`) rather than the
TypeScript renderer in `supabase/functions/_shared/systemEmail.ts`.

They are hand-mirrored to that renderer's shell so a password-reset email is visually
indistinguishable from an AgentFlow-sent invite or welcome email: `#F1F5F9` page background,
560px white card, 4px `#2563EB` top bar, logo + uppercase tagline, pill badge, 26px/800 `#0F172A`
heading, `#475569` centered copy, solid `#2563EB` table button, monospace fallback-link box,
`#F8FAFC` footer. Inline CSS only; no gradients, no `background-clip`, no emoji, no external CSS.

> **Note on the footer year.** Go templates have no date function, so the footer reads
> `© AgentFlow Inc. All Rights Reserved.` with **no year**. Do not hardcode one — it would go
> stale silently. (The TypeScript renderer *does* interpolate the live year; this is the one
> deliberate divergence.)

These files are **not** wired into `supabase/config.toml` — the repo has no `[auth]` section.
They are the paste source for the hosted-project dashboard (or the Management API), and the
rollback reference if a dashboard edit needs to be undone.

---

## 1. Inventory

| Template file | Dashboard tab | GoTrue variables used | Status in AgentFlow |
| --- | --- | --- | --- |
| `recovery.html` | Reset Password | `{{ .ConfirmationURL }}`, `{{ .SiteURL }}` | **LIVE — the only template GoTrue actually sends.** `supabase.auth.resetPasswordForEmail` at `src/contexts/AuthContext.tsx:257` (Forgot password on the login page) and `src/lib/supabase-users.ts:317` (admin-triggered reset in User Management). Both pass `redirectTo: ${window.location.origin}/reset-password` → `src/App.tsx:158`. |
| `confirm_signup.html` | Confirm signup | `{{ .ConfirmationURL }}`, `{{ .SiteURL }}` | **Content bypassed.** `supabase/functions/create-user/index.ts:106` calls `supabaseAdmin.auth.admin.generateLink({ type: "signup" })` and then sends the resulting `action_link` itself through Resend using `renderConfirmationEmail()`. `generateLink` mints the link **without** invoking GoTrue's mailer, so GoTrue never renders this template on the normal signup path. Kept in sync anyway as a fallback for any future direct `signUp()` path and so a stray GoTrue-sent confirmation is never unbranded. |
| `magic_link.html` | Magic Link | `{{ .ConfirmationURL }}`, `{{ .SiteURL }}` | **Dormant / unused.** No `signInWithOtp` call exists anywhere in `src/` or `supabase/`. The only `magiclink` string in the repo is a test fixture (`src/pages/__tests__/resetPassword.test.tsx:99`) exercising URL-hash parsing, not a send path. |
| `change_email.html` | Change Email Address | `{{ .ConfirmationURL }}`, `{{ .SiteURL }}`, `{{ .Email }}`, `{{ .NewEmail }}` | **Dormant / unused.** No `supabase.auth.updateUser({ email })` call exists. The three `updateUser` call sites pass `password` (`src/pages/ResetPassword.tsx:101`, `src/components/settings/profile/ProfilePasswordCard.tsx:87`) or `data` (`src/hooks/useOnboardingPageFlow.ts:192`) only. |
| `invite_user.html` | Invite user | `{{ .ConfirmationURL }}`, `{{ .SiteURL }}` | **Dormant / unused.** No `inviteUserByEmail` call exists. All AgentFlow invitations are AgentFlow-owned Resend sends: `invite-user` / `send-invite-email` (team, via `renderTeamInvitationEmail`) and `invite-to-agency-group` (via `renderAgencyGroupInviteEmail`). |

Verified by grep on branch `claude/system-email-unification` (2026-07-30):
`resetPasswordForEmail` → 2 hits; `signInWithOtp` → 0; `inviteUserByEmail` → 0;
`updateUser` with an `email` key → 0; `generateLink` → `create-user` only.

**Practical consequence:** pasting `recovery.html` changes what real users receive today.
The other four are pre-staging — pasting them changes nothing users see now, but guarantees the
branding is correct the moment one of those flows is switched on.

---

## 2. Recommended subjects

| Tab | Subject |
| --- | --- |
| Reset Password | `Reset your AgentFlow password` |
| Confirm signup | `Confirm your AgentFlow email` |
| Magic Link | `Your AgentFlow sign-in link` |
| Change Email Address | `Confirm your new AgentFlow email` |
| Invite user | `You've been invited to join AgentFlow` |

---

## 3. Manual dashboard steps (approval-gated — see §6)

1. Open <https://supabase.com/dashboard/project/jncvvsvckxhqgqvkppmj>
2. **Authentication** → **Emails** → **Templates**
3. For each tab below, in this order:
   1. **FIRST, copy the existing subject and the existing HTML body into a scratch file
      (e.g. `rollback-<tab>-YYYYMMDD.txt`) and save it somewhere safe.** This is the only
      rollback — the dashboard keeps no version history for these templates.
   2. Replace the **subject** with the recommended subject from §2.
   3. Replace the **message body** with the *entire* contents of the repo file, including the
      `<!DOCTYPE html>` line.
   4. Click **Save**.

| Tab | Repo file |
| --- | --- |
| Confirm signup | `supabase/templates/auth/confirm_signup.html` |
| Invite user | `supabase/templates/auth/invite_user.html` |
| Magic Link | `supabase/templates/auth/magic_link.html` |
| Change Email Address | `supabase/templates/auth/change_email.html` |
| Reset Password | `supabase/templates/auth/recovery.html` |

**Verification after saving Reset Password (the live one):** trigger Forgot password for a
throwaway address you control, confirm the email renders with the AgentFlow card and that the
button lands on `/reset-password` with a working token. Do this only with explicit approval —
it sends real mail and consumes rate-limit budget (see §5).

---

## 4. Management API alternative

Same effect without the dashboard, using a Personal Access Token:

```
PATCH https://api.supabase.com/v1/projects/jncvvsvckxhqgqvkppmj/config/auth
Authorization: Bearer <SUPABASE_PERSONAL_ACCESS_TOKEN>
Content-Type: application/json
```

Body keys (send only the ones being changed):

| Key | Value |
| --- | --- |
| `mailer_subjects_recovery` | `Reset your AgentFlow password` |
| `mailer_templates_recovery_content` | full HTML of `recovery.html` |
| `mailer_subjects_confirmation` | `Confirm your AgentFlow email` |
| `mailer_templates_confirmation_content` | full HTML of `confirm_signup.html` |
| `mailer_subjects_magic_link` | `Your AgentFlow sign-in link` |
| `mailer_templates_magic_link_content` | full HTML of `magic_link.html` |
| `mailer_subjects_email_change` | `Confirm your new AgentFlow email` |
| `mailer_templates_email_change_content` | full HTML of `change_email.html` |
| `mailer_subjects_invite` | `You've been invited to join AgentFlow` |
| `mailer_templates_invite_content` | full HTML of `invite_user.html` |

`GET` the same endpoint first and save the response — that is the rollback snapshot, and it is
strictly better than copy-pasting from the dashboard. This route is **equally approval-gated**:
it mutates the same production Auth config.

---

## 5. SMTP inspection (read-only step)

Same page: **Authentication** → **Emails** → **SMTP Settings**.

**Record the finding** (custom SMTP configured: yes / no; if yes, host + sender address) in this
section or in `WORK_LOG.md`. Nothing in this repo configures SMTP — `supabase/config.toml` has no
`[auth]` section and no `smtp` keys — so the working assumption until someone reads the dashboard
is **no custom SMTP**.

If custom SMTP is **not** configured:

- Password-reset mail (the one live GoTrue template) goes out through **Supabase's shared default
  sender**, not `team@fflagent.com`. The From address is Supabase's, not AgentFlow's — so the
  branded template lands under an unbranded sender.
- The default sender is **rate-limited to a small number of emails per hour** (historically ~2–4/hr
  project-wide, and Supabase documents it as not for production). A burst of password resets will
  silently fail for some users.

Moving Auth mail onto **Resend SMTP with `team@fflagent.com`** — matching `SYSTEM_EMAIL_FROM` in
`supabase/functions/_shared/systemEmail.ts` — would fix both. That is **decision D4** and is
explicitly out of scope here: it is dashboard-only, DNS-sensitive (SPF/DKIM/DMARC alignment on
`fflagent.com`, which also carries all existing Resend sending), and a misstep degrades deliverability
for every AgentFlow email, not just Auth. Treat it as a separate, separately-approved change.

---

## 6. Approval gate — READ BEFORE TOUCHING THE DASHBOARD

> **NONE of the changes in §3, §4, or §5 may be made without Chris's explicit approval.**
>
> Editing the Auth templates, the Auth subjects, or the SMTP settings mutates **production
> authentication** for the live project `jncvvsvckxhqgqvkppmj`. A bad paste can break password
> recovery for every user — and an SMTP change can silently break deliverability for *all*
> AgentFlow email, including invitations and welcome mail, in a way that is not visible from the
> app. No agent may apply these, and no "while I was in there" adjacent tweaks.
>
> Committing the files in `supabase/templates/auth/` is safe and changes nothing by itself — they
> are inert until someone deliberately pastes them into the dashboard or PATCHes the Auth config.

---

## 7. Editing these templates

- Edit the repo files first; the dashboard is downstream, never the source of truth.
- Keep the shell identical across all five and identical to `renderSystemEmail()` in
  `supabase/functions/_shared/systemEmail.ts`. If that renderer's shell changes, update these
  five by hand in the same pass — there is no build step linking them.
- Allowed template actions are exactly `{{ .ConfirmationURL }}`, `{{ .SiteURL }}`, `{{ .Email }}`,
  and `{{ .NewEmail }}`. Anything else will render as an error or an empty string.
- No JavaScript template syntax (`${...}`), no backticks — these are Go templates, not TS strings.
- No year in the footer. No emoji. No gradients. No external stylesheets or fonts.
