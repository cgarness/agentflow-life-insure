# Google Sheets real-time sync — Privacy Policy / Terms copy (DRAFT, not released)

**Status.** Draft for review only. `src/content/legal.ts` is **unchanged** in this PR. Per D9, this copy ships in its
own reviewed release, with its own approval and a new "last updated" date.

**When it is needed.**
- **Not before the Gate E pilot.** The pilot runs only for Chris's own Pilot B tab (`AgentFlow Sheets Pilot B – Leads`,
  home org). It is the account owner's own spreadsheet, read under the same `drive.file` grant the policy already
  describes. The only new data is technical notification metadata (arrival time, outcome, channel state), which
  contains no spreadsheet content.
- **Required before Gate G** (any rollout beyond the pilot). After rollout, "about every five minutes" is no longer
  accurate: AgentFlow reacts to Google change notifications and asks Google for notifications about the selected
  spreadsheets.

## Current text (`src/content/legal.ts`, Privacy → "Google Sheets information", paragraph 2)

> For each spreadsheet tab you enable, AgentFlow checks for new rows in the background about every five minutes,
> including while you are signed out, until you pause or remove that sheet or disconnect Google Sheets. By default,
> only rows added after you enable a sheet become leads; the rows already in the sheet at that time are recorded so
> they are not imported. When you enable a sheet, you can instead choose to also import the rows already in it.

## Proposed replacement

> For each spreadsheet tab you enable, AgentFlow asks Google to notify it when that spreadsheet changes. It then
> checks the tab for new rows in the background, including while you are signed out, until you pause or remove that
> sheet or disconnect Google Sheets. AgentFlow also checks when you enable, resume or edit a sheet, and when you choose
> Sync now. Google decides when it sends change notifications. They can be delayed, often by a few minutes, and are
> not guaranteed, so new rows are usually imported within minutes but timing is not guaranteed. By default, only rows
> added after you enable a sheet become leads; the rows already in the sheet at that time are recorded so they are not
> imported. When you enable a sheet, you can instead choose to also import the rows already in it.

## Proposed addition (same section, after the paragraph above)

> To receive change notifications, AgentFlow registers a notification channel with Google for each spreadsheet you
> enable. A channel tells AgentFlow only that the spreadsheet changed, not what changed. AgentFlow renews these
> channels while a sheet is enabled and stops them when you pause or remove the sheet or disconnect Google Sheets.
> AgentFlow keeps limited technical records about notifications, such as when they arrived and whether they were
> processed, to operate and secure the feature. These records contain no spreadsheet content.

## Disconnect paragraph (Privacy → choices) — proposed

> You can disconnect Google Sheets in AgentFlow's Google Sheets settings. Disconnecting stops AgentFlow's change
> notifications for your sheets, deletes AgentFlow's saved Google Sheets authorization and stops checking all of your
> sheets. It does not revoke Google's authorization and does not disconnect Gmail or Calendar. Imported leads remain.

## Terms

No change is required. "Optional Google Sheets access supports creating leads from new rows in spreadsheets you
select" stays accurate. Do not add any instant or guaranteed-delivery promise.

## Review checklist (for the separate release)

- [ ] Copy matches the shipped behavior at the time of release (push mode `on`, maintenance cron scheduled).
- [ ] No "real-time", "instant" or "guaranteed" claim in user-facing legal copy.
- [ ] The Google OAuth consent screen and verification materials still match `openid email drive.file`.
- [ ] `legal.ts` "last updated" date and the header comment updated; legal page tests updated.
- [ ] Chris approves the exact text.
