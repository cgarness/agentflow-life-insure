# Implementation Plan — PR #367 — Production Auth Email Template Closeout

**Date:** 2026-08-26
**Status:** BLOCKED — NO SUPABASE PRODUCTION ACCESS AVAILABLE IN THIS RUN (see §6). No production mutation was attempted; no production read was possible either.
**Production project:** `jncvvsvckxhqgqvkppmj` (AGENTFLOW CRM)
**Source of truth:** current `main` @ `1aa83281` — the PR #367 merge commit itself ("fix(brand): correct AgentFlow wordmark geometry to match the approved reference").

---

## 1. Objective

Finish the ONLY remaining production work from PR #367: update the five hosted Supabase Auth
(GoTrue) email templates + their five subjects so production exactly matches the
version-controlled templates in `supabase/templates/auth/`. Then verify production read-only,
document the rollout, and leave the repo clean. Chris has already explicitly approved this exact
production action (and only this action).

## 2. Repo preconditions — VERIFIED 2026-08-26

- `origin/main` fetched; local main up to date at `1aa83281` = the PR #367 merge commit. No
  template file has changed after `1aa8328` (main HEAD *is* that commit), so current-main
  template content is exactly the PR #367 / approved lineage.
- All five templates (`recovery.html`, `confirm_signup.html`, `magic_link.html`,
  `change_email.html`, `invite_user.html`) verified to contain the PR #367 mobile-safe logo
  treatment: exactly one `height="24"` + `style="height: 24px; max-width: 100%; display:
  inline-block;"`, **zero** `height="36"` residue, logo path
  `{{ .SiteURL }}/agentflow-logo-full.png` unchanged.
- GoTrue variables intact per file: all five carry `{{ .ConfirmationURL }}` (×3) and
  `{{ .SiteURL }}`; `change_email.html` additionally carries `{{ .Email }}` and `{{ .NewEmail }}`.
- `docs/auth-email-templates.md` §4 confirms the Management API mapping used below.
- Newest WORK_LOG entries reviewed: no conflicting `[IN PROGRESS]` work touches the Auth
  templates. The stale side-branch `claude/agentflow-pr-367-rollout-oa7sb2` (commit `43ac289`,
  BLOCKED-state entry) is deliberately NOT merged or used; this plan starts from current main.

## 3. Exact production fields to change (the ONLY ten)

PATCH `https://api.supabase.com/v1/projects/jncvvsvckxhqgqvkppmj/config/auth` with ONLY:

| Field | Value |
| --- | --- |
| `mailer_subjects_recovery` | `Reset your AgentFlow password` |
| `mailer_templates_recovery_content` | full contents of `supabase/templates/auth/recovery.html` |
| `mailer_subjects_confirmation` | `Confirm your AgentFlow email` |
| `mailer_templates_confirmation_content` | full contents of `supabase/templates/auth/confirm_signup.html` |
| `mailer_subjects_magic_link` | `Your AgentFlow sign-in link` |
| `mailer_templates_magic_link_content` | full contents of `supabase/templates/auth/magic_link.html` |
| `mailer_subjects_email_change` | `Confirm your new AgentFlow email` |
| `mailer_templates_email_change_content` | full contents of `supabase/templates/auth/change_email.html` |
| `mailer_subjects_invite` | `You've been invited to join AgentFlow` |
| `mailer_templates_invite_content` | full contents of `supabase/templates/auth/invite_user.html` |

Nothing else: no SMTP, sender, Resend, providers, Site URL, redirect URLs, token expiry,
password/JWT/captcha/MFA settings, no user records, no schema/RLS/data, no Edge Function
deploys, no secrets, no Vercel/Twilio, no customer/agency branding.

## 4. Procedure (when access is available)

1. **Rollback snapshot:** GET the same `/config/auth` endpoint; save the complete pre-change
   response securely (never printing tokens). This is the rollback artifact.
2. **PATCH** only the ten fields in §3, template bodies read verbatim from the repo files
   (no manual reconstruction, no logo-line-only patching).
3. **Verify:** GET again; five subjects match exactly; five HTML bodies match current-main files
   exactly (normalized comparison only if Supabase normalizes whitespace, with proof that only
   whitespace differs); each live template has `height="24"`, `max-width: 100%`, the stable logo
   path, its GoTrue variables, and zero `height="36"`; diff before/after snapshots to prove no
   non-template field changed.
4. **Edge Functions read-only re-check** (no redeploys if matching): `invite-user` v222
   verify_jwt=false · `send-email-previews` v23 false · `send-invite-email` v226 false ·
   `send-welcome-email` v252 false · `create-user` v53 **true** · `invite-to-agency-group` v22
   false — all ACTIVE.
5. **No real email test** — a live Forgot Password send is separate, Chris-authorized QA only.
6. **Closeout:** prepend WORK_LOG entry (rollout COMPLETE), set this plan's status to
   `COMPLETE — PRODUCTION AUTH EMAIL ROLLOUT VERIFIED`, run `npx tsc --noEmit`, confirm
   docs-only diff, push docs branch, open PR (no merge without Chris).

## 5. Scope confirmation

This plan does not expand the approved scope: the only production mutation is the ten Auth
config fields in §3. The repo diff is documentation-only (`WORK_LOG.md`,
`implementation_plan.md`).

## 6. BLOCKER — why nothing was mutated

This Cloud Agent run has **no legitimate Supabase production access of any kind**:

- The Supabase MCP integration reports `needsAuth` (unauthenticated) — zero tools available.
- No `SUPABASE_ACCESS_TOKEN` (or any Supabase secret) is injected into the VM environment.
- No Supabase CLI installation or CLI login token exists on the VM.
- No Supabase Dashboard session/credentials are available for a browser path.

Per the HOTFIX Blockers Protocol, the blocker is documented in `WORK_LOG.md` and execution
stopped. **No workaround was attempted; production was neither read nor written.**

**To unblock (either works):**
1. Add a Supabase Personal Access Token as the `SUPABASE_ACCESS_TOKEN` secret in the Cursor
   Dashboard (Cloud Agents → Secrets), or
2. Authenticate the Supabase MCP integration in Cursor, then re-run this task. §2 is already
   verified; execution resumes at §4 step 1.
