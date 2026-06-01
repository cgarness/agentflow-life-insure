# Implementation Plan — Light-Mode Email Template Redesign

**Owner:** Chris Garness | **Branch:** `claude/email-templates-light-mode-xSpVp` | **Date:** 2026-06-01
**Production project:** `jncvvsvckxhqgqvkppmj`

## Scope
Redesign the 3 transactional email HTML templates from dark glassmorphism to a unified
light-mode (white card on `#F1F5F9`) system that renders reliably across email clients.
**HTML template strings only** — no changes to logic, Resend client setup, payload parsing,
CORS headers, env reads, `generateLink`, or invitation-accept logic.

## Shared design system (all 3)
- Body bg `#F1F5F9`; white card `#FFFFFF`, max-width 560px, centered, radius 8px,
  border `1px solid #E2E8F0`, box-shadow `0 2px 8px rgba(0,0,0,0.06)`.
- 4px `#2563EB` accent bar at top of card.
- Logo `${logoUrl}` height 36px, centered on white.
- Tagline `LIFE INSURANCE CRM & POWER DIALER` — `#94A3B8`, 11px, letter-spacing 0.15em, weight 600.
- Hero: pill badge (`#EFF6FF`/`#1D4ED8`/border `#BFDBFE`, radius 999px, 11px/700/0.08em/uppercase),
  h1 26px/800/`#0F172A` (NO gradient text), body 15px/`#475569`/line-height 1.7.
- CTA: bg `#2563EB`, `#FFFFFF`, padding 14px 32px, radius 8px, 700/15px, inline-block,
  box-shadow `0 2px 6px rgba(37,99,235,0.4)`.
- Footer: border-top `1px solid #E2E8F0`, padding 24px 40px, bg `#F8FAFC`, 12px `#94A3B8`,
  `© 2026 AgentFlow Inc. All Rights Reserved.`
- Font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`.
- Safety: solid hex everywhere; no backdrop-filter, no gradients on body/card, no `-webkit-background-clip`,
  no CSS vars; styles inlined (plus a minimal `<style>` reset). Only sub-0.5 rgba used is in
  box-shadows (explicitly specified), never on backgrounds.

## Per-file changes (HTML string only)

### 1. `supabase/functions/send-invite-email/index.ts`
- Replace `const html = \`…\`` template literal with the light-mode invite layout.
- Pill `NEW INVITATION`; h1 `Join Our Agency`; body
  "Hi {{ .FirstName }}, you've been invited to join the team as a {{ .Role }}. Click the button below to create your account and get started."
- CTA `Accept Invitation →` → href `{{ .InviteURL }}`.
- Footer: tagline + copyright.
- Keep the three `.replace()` calls (`{{ .FirstName }}`, `{{ .Role }}`, `{{ .InviteURL }}`).
- Update subject → `You've been invited to join AgentFlow`.

### 2. `supabase/functions/send-welcome-email/index.ts`
- Replace `const html = \`…\`` template literal with the light-mode welcome layout.
- No pill; h1 `Welcome to AgentFlow, {{ .FirstName }}!`; body
  "Your workspace is ready. You're now set up to manage leads, run your dialer, and track your team — all in one place."
- 3 feature rows (each: border `#E2E8F0`, radius 8px, padding 16px, mb 12px, bg `#FAFAFA`),
  solid icon boxes: Power Dialer (`#EFF6FF` 📞), Lead Management (`#F0FDF4` 👥), Team Insights (`#FEF9C3` 📊).
  Icon/text use a `role="presentation"` table per row for reliable two-column alignment (Outlook-safe).
- CTA `Go to Dashboard →` → href `{{ .SiteURL }}`.
- Footer: tagline + copyright + Support | Privacy | Terms links (`#94A3B8`).
- Keep the two `.replace()` calls (`{{ .FirstName }}`, `{{ .SiteURL }}`).
- Update subject → `Welcome to AgentFlow — You're all set`.

### 3. `supabase/functions/create-user/index.ts` — `buildConfirmEmailHtml()` only
- Replace the returned template literal with the light-mode confirm layout.
- `<meta color-scheme>` → `light`.
- Header: logo + tagline; pill `VERIFY YOUR EMAIL`; h1 `You're almost in`; body
  "Hi {firstName} — confirm your email to activate your workspace. After that you can sign in and finish a quick setup for your agency."
- CTA `Confirm email →` → href `${actionLink}`; hint text (12px `#94A3B8`); fallback URL box
  (bg `#F8FAFC`, border `#E2E8F0`, radius 6px, label `BUTTON NOT WORKING?`, URL `#2563EB` mono 11px break-all).
- Footer. Keep `escapeHtml`, `${safeName}`, `${actionLink}`, the 3-arg signature, and the Resend call unchanged.

## Deploy & test
4. `deploy_edge_function` all 3 (project `jncvvsvckxhqgqvkppmj`): invite `verify_jwt:false`,
   welcome `verify_jwt:false`, create-user `verify_jwt:true`.
5. Live test sends to `cgarness.ffl@gmail.com`:
   - invoke `send-invite-email` `{email,firstName:Chris,role:Admin,inviteURL:…test-preview}`
   - invoke `send-welcome-email` `{email,firstName:Chris}`
   - confirm-email preview send (one-off, service-role) using `buildConfirmEmailHtml("Chris", "https://fflagent.com/dashboard", logoUrl)`
   - Confirm each returns `{ success: true }`.
6. Append WORK_LOG.md; write Context Snapshot.

## Non-goals / untouched
Logic, Resend client init, `from`/`to`, payload parsing, CORS, env reads, `generateLink`,
invitation-accept updates, any other Edge Functions, migrations, DB, frontend, Twilio.
