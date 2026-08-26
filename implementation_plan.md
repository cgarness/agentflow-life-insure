# Implementation Plan — AgentFlow system-email logo cache bust (immutable v2 asset)

**Date:** 2026-08-26
**Status:** ✅ **IMPLEMENTED IN REPO — APPROVED BY CHRIS 2026-08-26 · NOTHING DEPLOYED**
*(Chris approved §3 as planned and confirmed the filename `agentflow-logo-email-v2.png`. All 12 files
in §3 are done; all four §7 gates pass; fail-first demonstrated for both new suites. **No production
mutation of any kind: no Edge Function deploy, no Auth-template PATCH, no Vercel action, no Supabase
read or write.** The §6 rollout A→B→C→D→E→F remains gated on Chris's separate explicit approval.)*
**Branch:** `claude/agentflow-logo-cache-bust-5zpme5` (currently identical to `origin/main` @ `2102ba7`)
**Production project:** `jncvvsvckxhqgqvkppmj` (AGENTFLOW CRM)
**Supersedes:** the PR #367 closeout plan (COMPLETE, merged as PR #368 @ `2102ba7`). That work is
finished; this is a new, separate change.

> Per AGENT_RULES §8 the §2 inventory was completed read-only **before** approval, and the §3 change
> was made **only after** Chris approved it. **Zero backend/production commands have been run at any
> point** — no Supabase read or write, no Edge Function deploy, no Auth-config PATCH, no Vercel
> action. The only things executed were repo searches, the §7 gates, and `git commit`/`git push` to
> this branch. The one production fact in this plan that could not be read from the repo — the live
> Edge Function state in §2.3(b) — was supplied by Chris from his own live verification.

---

## 1. Objective

Give AgentFlow system email a **new immutable asset URL** so no future email render can resolve to a
bitmap an image proxy cached against the old, overwritten-in-place stable URL
`https://www.fflagent.com/agentflow-logo-full.png`.

Approach: a new email-only filename — `public/agentflow-logo-email-v2.png` — carrying a **byte-identical
copy** of the currently approved corrected artwork. No regeneration, no reinterpretation, no
customer/agency branding change, no carrier-logo change, no font reconstruction.

---

## 2. Diagnosis — inventory COMPLETE, and it confirms the repo half of the premise

Verified directly and independently re-verified by a five-lens sweep plus two adversarial critics.
Every claim below carries a file:line.

### 2.1 Confirmed exactly as stated in the request

| Claim to verify | Result |
| --- | --- |
| `_shared/systemEmail.ts` resolves the logo to `/agentflow-logo-full.png` | ✅ `systemEmail.ts:18` — ``return `${siteUrl ?? resolveSiteUrl()}/agentflow-logo-full.png`;`` Sole call site `:128`; sole `<img>` emission `:196`. |
| Five `supabase/templates/auth/*.html` use `{{ .SiteURL }}/agentflow-logo-full.png` | ✅ All five, **byte-identical line 26** in every file. One `<img>` per file. |
| The six functions all use the shared renderer | ✅ `create-user:48-49`, `invite-user:4-5`, `send-invite-email:12-13`, `send-welcome-email:13-14`, `invite-to-agency-group:4-5`, `send-email-previews:9-15` — all import `_shared/systemEmail.ts` / `_shared/systemEmailTemplates.ts`. None hand-rolls HTML. |
| No other active AgentFlow-owned transactional email path embeds an old/legacy logo | ✅ **Proven, not assumed** — see §2.2. |

### 2.2 How "no other path" was established (the negative, with evidence)

- `grep -rn "\.png\|<img" supabase/functions --include=*.ts` outside `_shared/` → **zero hits**.
  `systemEmail.ts:196` is the only `<img>` in the entire functions tree.
- Every outbound-mail transport enumerated. Unique external mail hosts across all 58 deployable
  functions: `api.resend.com`, `gmail.googleapis.com`, `graph.microsoft.com`. Zero nodemailer, SMTP,
  SendGrid, Mailgun, Postmark, SES.
- **Excluded by invariant #21 and correctly so** — `workflow-executor` (`index.ts:531-586`,
  tenant-authored HTML passthrough, own `WORKFLOW_EMAIL_FROM`; embeds no AgentFlow logo) and
  `email-send-contact-message` (`index.ts:197`, user's own Gmail; the MIME body at `:187-194` is
  `text/plain` only — no HTML part, so no image at all).
- Ruled out with reasons: `email-sync-incremental` (inbound ingest; its `text/html` hit at `:136`
  parses received MIME), `email-connect-start` / `email-connect-callback` / `email-disconnect`
  (no send), `google-calendar-sync-appointment` (Google sends, AgentFlow renders no body),
  `accept-invite` (`email_confirm: true` confirms without mailing), `daily-briefing`, `daily-tip`
  (zero mail keywords), `_shared/notifications.ts` (in-app only).
- **Legacy asset resolved:** `confirmation_template.txt` (named in the archived 2026-05-16 audit)
  **no longer exists** — it was `send-welcome-email/confirmation_template.txt`, deleted in `f7a208f`
  (2026-07-30 unification), an ancestor of HEAD. Absent from the working tree, index and HEAD tree.
- No other email template anywhere: an exhaustive `find` over `supabase/` for `.html`/`.txt`/`.mjml`
  returns **only** those five files. `supabase/templates/` has no sibling of `auth/`.
- `supabase/migrations/` (12 files), `supabase/migrations_archive/` (266 files, including three
  welcome-email migrations) and `supabase/seed.sql` all swept: **zero** email HTML, **zero** logo URLs.
- No CSS `url()` logo reference in any email surface — the single `<img>` per file is the complete
  emission set. No PWA manifest, no service worker, no dynamic OG tags anywhere in the repo.
- `resolveLogoUrl` is imported by **nothing** outside the shared renderer and its own test
  (3 files total). The one-line change has **no non-email side effect**.

### 2.3 Corrections to the stated premise — please read

**(a) A pure URL-keyed proxy cache does not by itself explain the divergence.** Forgot Password
(hosted `recovery.html`) and the six Resend-sent emails reference the **identical** URL. If a proxy
were serving a stale bitmap for that URL, both would be wrong together, not divergent. The
consistent explanation is the one the request itself already states: proxy copies are effectively
per-message — an already-delivered email keeps the bitmap fetched when it was first rendered, while
a freshly sent Forgot Password fetched the corrected file. **The proposed fix is still correct and
still the right move** — a brand-new URL cannot collide with any existing cache entry. But it makes
the acceptance criterion strict: **judge only newly sent emails**, never a re-open of an existing one.

**(b) Production Edge Function state — VERIFIED LIVE, and it is already current.** Chris verified
against live Supabase on 2026-08-26: the deployed `invite-user` bundle contains **`height="24"`** and
**`max-width: 100%`**, i.e. **the PR #367 system-email resize is already in production.** Current
state, all ACTIVE:

| Function | Version | `verify_jwt` |
| --- | --- | --- |
| `invite-user` | v222 | `false` |
| `send-email-previews` | v23 | `false` |
| `send-invite-email` | v226 | `false` |
| `send-welcome-email` | v252 | `false` |
| `create-user` | v53 | **`true`** |
| `invite-to-agency-group` | v22 | `false` |

**Consequence: the §6D redeploy ships exactly ONE change — the new immutable logo URL
`/agentflow-logo-email-v2.png`.** No markup change, no resize, no other behavioural delta.

> **Correction, recorded deliberately.** An earlier revision of this plan claimed these functions had
> never been redeployed since PR #367 and that their bundles still emitted `height="36"`. **That was
> wrong.** It was inferred from the #368 entry's "no redeploys performed" — which described only
> that pass — rather than from the live bundles. The live bundle is authoritative and the claim is
> withdrawn. Do not re-derive deploy state from version numbers or from what a prior WORK_LOG pass
> did not do; read the deployed function.

The deployed bundles also carry the unified renderer (the 2026-07-31 release took them v220→v221,
v224→v225, v51→v52, v250→v251, v20→v21), so no deployed function embeds a pre-unification
apex-domain `https://fflagent.com/...` URL. That alternative hypothesis is refuted.

**(c) "Immutable" is a filename convention here, not an enforced header.** The repo has no `headers`
block (no `vercel.json` headers, no `_headers`, no `netlify.toml`), so v2 is served with the same
Vercel default as v1. The protection is the *new name*, plus the parity test in §5. Adding
long-lived cache headers would change caching for the whole site and is out of scope for this fix.

---

## 3. Files to touch — the complete list (12)

**New (1)**

| # | File | Change |
| --- | --- | --- |
| 1 | `public/agentflow-logo-email-v2.png` | **Byte-identical `cp`** of `public/agentflow-logo-full.png` — sha256 `828945b2c0ce68772f2fe033bc4101d3cea0c57030efce5c65b637f2cd23b119`, 1551×120, 8-bit RGBA, 50.74% fully transparent (verified by full IDAT inflate). No optimizer pass — the file carries a `bKGD` chunk and a byte-copy must stay a byte-copy. |

**Code (1)**

| # | File | Change |
| --- | --- | --- |
| 2 | `supabase/functions/_shared/systemEmail.ts` | **Line 18 only** — path literal `/agentflow-logo-full.png` → `/agentflow-logo-email-v2.png`. Signature, `resolveSiteUrl()`, `assertHttpsUrl()` guard, and the `<img>` markup at `:196` all unchanged. |

**Hosted Auth templates (5)** — line 26 only in each, `{{ .SiteURL }}/agentflow-logo-full.png` → `{{ .SiteURL }}/agentflow-logo-email-v2.png`. `height="24"`, `max-width: 100%`, `display: inline-block`, `alt="AgentFlow"` and every GoTrue variable preserved byte-exact.

| # | File |
| --- | --- |
| 3 | `supabase/templates/auth/recovery.html` |
| 4 | `supabase/templates/auth/confirm_signup.html` |
| 5 | `supabase/templates/auth/magic_link.html` |
| 6 | `supabase/templates/auth/change_email.html` |
| 7 | `supabase/templates/auth/invite_user.html` |

**Tests (2)** — see §5.

| # | File | Change |
| --- | --- | --- |
| 8 | `supabase/functions/_shared/systemEmail.test.ts` | Update the 4 pinned literals (`:214`, `:217`, `:397`, `:401`); add negative assertions that the old path is gone; add the **missing** `height="24"` / `max-width: 100%` assertions (currently zero coverage anywhere). |
| 9 | `src/lib/__tests__/systemEmailLogoAsset.test.ts` **(NEW)** | Vitest guard covering the renderer, all five Auth templates, the asset itself, and the browser consumers that must **not** change. |

**Docs (3)**

| # | File | Change |
| --- | --- | --- |
| 10 | `AGENT_RULES.md` | **Line 162** — invariant #21 currently asserts ``The email logo is `${siteUrl}/agentflow-logo-full.png`.`` That becomes false. Amend to state the split (platform/UI keeps `agentflow-logo-full.png`; **email is pinned to `agentflow-logo-email-v2.png` and must never be overwritten in place**). Required by AGENT_RULES §9 in the same commit. |
| 11 | `implementation_plan.md` | This file. |
| 12 | `WORK_LOG.md` | New entry, **prepended** (newest-first). Existing `agentflow-logo-full` occurrences are history and will not be rewritten. |

### 3.1 Explicitly NOT touched

`src/components/marketing/MarketingNav.tsx` · `index.html` (og:image / twitter:image) ·
`src/components/shared/Logo.tsx` · every other `public/` asset · `docs/auth-email-templates.md`
(it never names the logo file, so it needs no edit — its three stale line refs are noted in §8) ·
`systemEmailTemplates.ts` / `systemEmailAuth.ts` (no logo state) · `workflow-executor` ·
`email-send-contact-message` · `BrandingContext` · `company_settings` · uploaded org logos ·
agency/customer colours · carrier logos · any migration · any RLS/schema/data · telephony · dialer.

### 3.2 ⚠️ Mechanical hazard — do NOT sed the bare stem

`MarketingNav.tsx:49` reads `"/agentflow-logo-full-on-dark.png"`, which **contains** the substring
`agentflow-logo-full`. A repo-wide `sed s/agentflow-logo-full/agentflow-logo-email-v2/g` would
silently rewrite it to a file that will never exist and 404 the dark-mode marketing nav. **Every edit
anchors on the full literal `agentflow-logo-full.png` (including the `.png`) and is applied
per-file, never repo-wide.** Test #9 asserts both MarketingNav references survive intact.

---

## 4. Exact diff shape

```diff
# supabase/functions/_shared/systemEmail.ts:18
-  return `${siteUrl ?? resolveSiteUrl()}/agentflow-logo-full.png`;
+  return `${siteUrl ?? resolveSiteUrl()}/agentflow-logo-email-v2.png`;
```

```diff
# each of the five supabase/templates/auth/*.html, line 26
-          <img src="{{ .SiteURL }}/agentflow-logo-full.png" alt="AgentFlow" height="24" style="height: 24px; max-width: 100%; display: inline-block;">
+          <img src="{{ .SiteURL }}/agentflow-logo-email-v2.png" alt="AgentFlow" height="24" style="height: 24px; max-width: 100%; display: inline-block;">
```

Everything else on those lines is byte-preserved.

---

## 5. Test plan

**#8 — `systemEmail.test.ts` (Deno).** Update `:214`, `:217`, `:397`, `:401` to the v2 URL; add a
negative assertion that no rendered email contains `agentflow-logo-full.png`; and **close the
coverage gap the audit found** — nothing anywhere currently asserts `height`/`max-width`, so the
PR #367 mobile-safe treatment is entirely untested. Add assertions that the emitted `<img>` carries
`height="24"` and `max-width: 100%`.

**#9 — `src/lib/__tests__/systemEmailLogoAsset.test.ts` (NEW, vitest).** This is the suite that
actually gets run (see §7 note on CI). Reads files from disk, following the existing
`Logo.test.tsx` idiom. Asserts:

1. `systemEmail.ts` builds `/agentflow-logo-email-v2.png` and contains **zero** `agentflow-logo-full.png`.
2. All five Auth templates use `{{ .SiteURL }}/agentflow-logo-email-v2.png`; **zero** occurrences of
   the old path across the whole `supabase/templates/auth/` tree.
3. Each template preserves exactly one `height="24"` and one `max-width: 100%`, and zero `height="36"`.
4. **GoTrue variables byte-exact per file** — `{{ .ConfirmationURL }}` ×3 and `{{ .SiteURL }}` ×1 in
   all five, plus `{{ .Email }}` ×1 and `{{ .NewEmail }}` ×1 in `change_email.html`; and no new
   template action is introduced.
5. **Artwork parity:** `sha256(public/agentflow-logo-email-v2.png) === sha256(public/agentflow-logo-full.png)`
   — so a future artwork correction that forgets the email copy fails loudly instead of drifting.
6. The v2 PNG is 1551×120 RGBA with genuine transparency (alpha minimum 0).
7. **Browser consumers unchanged** (the §3.2 sed guard): `MarketingNav.tsx` still references both
   `/agentflow-logo-full.png` and `/agentflow-logo-full-on-dark.png`, and `index.html`'s OG/Twitter
   image tags still point at `/agentflow-logo-full.png`.

---

## 6. Deployment boundary — NOTHING is deployed during implementation

Merging the repo change deploys **only the static asset** (Vercel auto-builds `main`). It does not
touch the Edge Functions and does not touch the hosted Auth templates. Each step below needs Chris's
**separate explicit approval**.

### ⚠️ 6.0 Ordering is a HARD gate, and the failure mode is worse than a 404

`vercel.json` rewrites `/(.*)` → `/index.html`. Vercel applies rewrites **after** the filesystem
check, so a real file in `public/` wins — but a **missing** file does not 404. It returns
**HTTP 200 with `Content-Type: text/html`** (the SPA shell). If the functions or templates ship
before the asset is live, Gmail/Apple/Outlook image proxies will fetch and **cache that HTML body
against the brand-new URL** — recreating exactly the failure this change exists to fix, permanently,
on a URL that has already been spent. `assertHttpsUrl` validates scheme only and cannot catch it.

**Therefore step B must be positively verified before D–E**, not merely assumed.

> I could not verify the live headers from this container — the agent egress proxy returns 403 for
> `www.fflagent.com` — so the `curl` below must be run from an unrestricted network.

### A. Merge / deploy the static asset FIRST
Merge to `main`; wait for the Vercel deployment to reach **READY**. The asset ships with the merge;
nothing else does.

### B. Positively verify the NEW URL returns the actual PNG, not the SPA fallback
`curl -sSI https://www.fflagent.com/agentflow-logo-email-v2.png` and **assert `HTTP/2 200` +
`Content-Type: image/png`**. A `text/html` content-type is the `vercel.json` rewrite serving
`index.html` — the asset is NOT live. **Stop; do not proceed to C–F.** Repeat against whatever origin
§8 shows `PUBLIC_SITE_URL` and the GoTrue `site_url` actually resolve to, if either differs from
`www.fflagent.com`.

### C. Retrieve current live versions + full function code for rollback
For each of the six functions, pull the deployed body and version (`get_edge_function`) and keep it
as the rollback artifact. Expected going in: `invite-user` v222 · `send-email-previews` v23 ·
`send-invite-email` v226 · `send-welcome-email` v252 · `create-user` v53 ·
`invite-to-agency-group` v22, all ACTIVE (§2.3b). Deploy from current `main`, never from a
reconstruction.

### D. Redeploy the six system-email functions, preserving `verify_jwt` exactly
`invite-user` (false) · `send-email-previews` (false) · `send-invite-email` (false) ·
`send-welcome-email` (false) · `create-user` (**true**) · `invite-to-agency-group` (false).
**This deploy ships exactly one change: the new logo URL `/agentflow-logo-email-v2.png`.** The
`height="24"` / `max-width: 100%` treatment is already live (§2.3b) and is unchanged by this deploy.

### E. PATCH the five hosted Auth templates — separate approval
Only `mailer_templates_{recovery,confirmation,magic_link,email_change,invite}_content`, bodies read
**verbatim** from the repo files. The five `mailer_subjects_*` need no change. Capture a
`GET /config/auth` rollback snapshot first; diff before/after to prove exactly five keys moved.
`docs/auth-email-templates.md:145-153` is a hard gate — the PR #368 approval does **not** cover this.
Until E runs, the repo and production hold different template bodies and no CI check detects it.

### F. Test with NEWLY generated emails
Trigger a fresh send of each affected type (`send-email-previews` is the right harness for the four
Resend templates; a real Forgot Password covers `recovery.html`) and confirm the header image
resolves from `/agentflow-logo-email-v2.png`. **Emails already sitting in a mailbox are NOT a valid
acceptance test** — see §9.

### G. Out of bounds, unconditionally
SMTP · sender · providers · Site URL · redirect URLs · JWT · MFA · password config · RLS · schema ·
production data · Vercel settings · Twilio · any migration.

---

## 7. Verification gates (pristine baselines already captured)

| Gate | Baseline @ `2102ba7` | After | Delta |
| --- | --- | --- | --- |
| `npx tsc --noEmit` | **exit 0** | **exit 0** | — |
| `deno test --allow-env --allow-read supabase/functions/_shared/` | **80 passed / 0 failed** | **83 passed / 0 failed** | **+3, 0 regressions** |
| `npm test` (vitest, dummy `VITE_SUPABASE_*`) | **134 files / 1879 passed / 12 skipped / 0 failed** | **135 files / 1902 passed / 12 skipped / 0 failed** | **+1 file, +23 tests, 0 regressions** |
| `npm run build` | **success** | **success** | — |

**Fail-first, genuinely demonstrated** (new tests dropped into a pristine `git worktree` at `2102ba7`,
every source file there untouched baseline):
- `systemEmailLogoAsset.test.ts` → **14 failed / 9 passed**, failing on the absent v2 asset and the
  old path in the renderer and all five templates. The 9 that passed are the intended
  non-regression guards (GoTrue variables, browser consumers, template file set) — correct before
  and after.
- `systemEmail.test.ts` → **4 failed / 37 passed**, with the literal
  `actual: "https://app.example.com/agentflow-logo-full.png"` vs
  `expected: "…/agentflow-logo-email-v2.png"`. The new mobile-safe-height test passes on baseline,
  as it should — it guards markup #367 already landed.

Plus, before handoff:
- `grep -rn "agentflow-logo-full\.png"` proving **zero** hits in active AgentFlow system-email
  rendering or hosted Auth templates, and that the surviving hits are exactly the intended browser
  consumers (`MarketingNav.tsx:49-50`, `index.html:22-23`), history (`WORK_LOG.md`, archived audits)
  and the amended `AGENT_RULES.md:162`.
- Per-template GoTrue variable counts re-confirmed unchanged.
- `WORK_LOG.md` entry prepended; context snapshot delivered.

> **Environment note, stated honestly.** No CI workflow runs vitest or `deno test` — the only two
> GitHub workflows are the S1 plan check and the manually-dispatched SQL suite. These gates are run
> by hand. `deno` is not preinstalled here and `deno.land`/`jsr.io` are proxy-blocked, so the Deno
> suite is run via a scratchpad-only assertion shim that reproduces the std surface; it reproduces
> the historical 80/80 exactly. The shim lives outside the repo and is never committed, and the repo
> test files are executed **unmodified**.

---

## 8. Open questions — need a read-only production check at rollout (not repo-answerable)

1. **What is the hosted GoTrue `site_url`?** `{{ .SiteURL }}` is a dashboard setting, *not*
   `FALLBACK_SITE_URL`/`PUBLIC_SITE_URL`. `supabase/config.toml` has no `[auth]` section, and PR #368
   deliberately excluded Site URL from its PATCH, so its value is recorded nowhere in the repo.
   Read `site_url` from `GET /v1/projects/jncvvsvckxhqgqvkppmj/config/auth` and confirm the v2 asset
   is reachable at that origin.
2. **What is `PUBLIC_SITE_URL` in the production Edge secrets?** Same question for the Edge path.
   There is no `.env`/`.env.example` in the repo.
3. **Trailing slash.** `systemEmail.ts:14` strips trailing slashes; the Go templates concatenate raw.
   If the hosted Site URL ends in `/`, Auth emails request `host//agentflow-logo-email-v2.png` — a
   different proxy cache key. Confirm no trailing slash.
4. **Two production functions have no source in this repo** — `spam-check-cron` and
   `daily-call-limit-reset` (`supabase/ops/cron_definitions.md:25-27`, dashboard-created). Confirm
   read-only that neither emits branded AgentFlow email. Unverifiable from here — flagged, not assumed clean.
5. **GoTrue's sixth template (`reauthentication`)** has no repo file. No AgentFlow flow calls
   `supabase.auth.reauthenticate()` (`ProfilePasswordCard.tsx:77` uses `signInWithPassword`), so
   nothing sends it today — but if a custom body was ever set on the hosted project it would keep the
   legacy URL. Check during step E.
6. *(Housekeeping, out of scope)* `docs/auth-email-templates.md` carries three stale line refs
   (`AuthContext.tsx:257`→ actually `:240`, `supabase-users.ts:317`→ `:530`,
   `create-user/index.ts:106`→ `:322`). Noted for a separate pass; not touched here.

---

## 9. Acceptance

New emails sent **after** step D (and step E for password reset) render the corrected wordmark from
`/agentflow-logo-email-v2.png`. Emails already sitting in a mailbox may keep the old artwork
indefinitely — that is expected and is not a defect.

---

## 10. Approval record

| # | Question | Answer (Chris, 2026-08-26) |
| --- | --- | --- |
| 1 | Proceed with the 12-file change in §3, as diffed in §4? | ✅ **Approved as planned** |
| 2 | Filename `agentflow-logo-email-v2.png`? | ✅ **Confirmed** |
| 3 | Byte-identical copy of the current artwork (no regeneration)? | ✅ **Confirmed** |
| 4 | Production Edge Function state | ✅ **Corrected by Chris from live Supabase** — the #367 resize is already deployed; the §6D redeploy ships **only** the new logo URL (§2.3b) |

**⛔ Still gated — nothing below has been done.** The §6 rollout **A → B → C → D → E → F** requires
Chris's separate explicit approval. Do not merge, deploy, PATCH Auth config, or send a test email.
