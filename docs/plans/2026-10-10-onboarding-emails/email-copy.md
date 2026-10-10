# Onboarding email copy — proposed (NOT live)

Companion to `implementation_plan.md` in this folder. Every email renders through the existing shared renderer (`supabase/functions/_shared/systemEmail.ts`): light shell, logo, hidden preheader, plain-text part, dynamic year. Nothing in this file is deployed or scheduled.

- **Sender:** `AgentFlow <team@fflagent.com>` (`SYSTEM_EMAIL_FROM`, invariant #21).
- **Personalization:** first name only (`there` when blank), escaped by the renderer.
- **Badge:** `New Agent Tips · N of 5` or `Agency Setup · N of 4`, so the reader knows why they got it and how many remain.
- **Footer links (every email):** `Unsubscribe from onboarding tips` → `https://www.fflagent.com/email/unsubscribe?token=<signed>` and `Privacy Policy` → `https://www.fflagent.com/privacy` (route verified in `src/App.tsx`).
- **Headers (every email):** `List-Unsubscribe: <https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/email-unsubscribe?token=<signed>>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- **Why each email names a manual path:** after sign-in the app always lands on `/dashboard` (`src/lib/safe-redirect.ts:18`, only `/accept-group-invite` is allowed as a return path), so a CTA deep link works only for a user who is already signed in. The gray note under each button gives the menu path.
- **Day 0** is the existing welcome email (`send-welcome-email`, `renderWelcomeEmail`). It is not duplicated, re-sent, or changed.

Rendered previews (desktop, mobile, plain text): https://claude.ai/artifact/X18LPg9HJF4NVdaHGNxqWp


## Agent series (Agents and Team Leaders)

### Day 1 — Get your dialer ready  (`agent_day01_dialer_ready`)

- **Subject:** Get your dialer ready before your first call
- **Preheader:** Three quick checks so your first dialing session starts on time.
- **Badge:** New Agent Tips · 1 of 5
- **Heading:** Get your dialer ready
- **Primary CTA:** “Open the Dialer →” → `https://www.fflagent.com/dialer`
- **CTA note:** Not signed in? Sign in first, then choose Dialer in the left menu.

Plain-text part exactly as rendered (HTML carries the same words; steps render as numbered/lettered rows):

```text
AGENTFLOW — LIFE INSURANCE CRM & POWER DIALER

Get your dialer ready

Hi Jordan, AgentFlow places calls right from your browser, so there's no phone app to install. A few quick checks now will make your first session smooth.

Why it matters: A blocked microphone or a missed setup step can cost you a live prospect. Set up once, and every session starts on time.

1. Allow your microphone — When your browser asks, choose Allow. AgentFlow can't place or answer calls without it.
2. Wait for Ready — Click the green Dialer button at the top of the screen. You're set when the panel shows Ready.
3. Start a campaign — Open Dialer, choose a campaign under Select a Campaign, and click Start Dialing. Don't see one? Ask your agency admin to add you.

Open the Dialer: https://www.fflagent.com/dialer

Not signed in? Sign in first, then choose Dialer in the left menu.

© 2026 AgentFlow Inc. All Rights Reserved.
Unsubscribe from onboarding tips: https://www.fflagent.com/email/unsubscribe?token=<signed>
Privacy Policy: https://www.fflagent.com/privacy
```

### Day 3 — Work your leads like a pro  (`agent_day03_work_leads`)

- **Subject:** Work your leads like a pro
- **Preheader:** Notes, stages, and follow-ups that keep every lead moving.
- **Badge:** New Agent Tips · 2 of 5
- **Heading:** Work your leads like a pro
- **Primary CTA:** “Open My Contacts →” → `https://www.fflagent.com/contacts`
- **CTA note:** Not signed in? Sign in first, then choose Contacts in the left menu.

Plain-text part exactly as rendered (HTML carries the same words; steps render as numbered/lettered rows):

```text
AGENTFLOW — LIFE INSURANCE CRM & POWER DIALER

Work your leads like a pro

Hi Jordan, every lead in AgentFlow has one record with their details, call history, notes, and tasks. Keeping it current takes seconds.

Why it matters: Many policies close on a follow-up call, not the first one. When your notes and stages are current, you always know where each conversation left off.

1. Open the full record — In Contacts, click a lead to see their details, Activity, Notes, and Tasks in one place.
2. Keep notes and stages current — After each conversation, note who the coverage is for, what they need, and when to call back. Then update the lead's stage.
3. Convert when you make a sale — Click Convert to turn the lead into a client and record the policy, including carrier, premium, and sold date.

Open My Contacts: https://www.fflagent.com/contacts

Not signed in? Sign in first, then choose Contacts in the left menu.

© 2026 AgentFlow Inc. All Rights Reserved.
Unsubscribe from onboarding tips: https://www.fflagent.com/email/unsubscribe?token=<signed>
Privacy Policy: https://www.fflagent.com/privacy
```

### Day 5 — Understanding your campaigns  (`agent_day05_campaigns`)

- **Subject:** How your campaigns decide who you call next
- **Preheader:** Personal, Team, and Open Pool campaigns, and what happens after each call.
- **Badge:** New Agent Tips · 3 of 5
- **Heading:** Understanding your campaigns
- **Primary CTA:** “Choose a Campaign →” → `https://www.fflagent.com/dialer`
- **CTA note:** Not signed in? Sign in first, then choose Dialer in the left menu.

Plain-text part exactly as rendered (HTML carries the same words; steps render as numbered/lettered rows):

```text
AGENTFLOW — LIFE INSURANCE CRM & POWER DIALER

Understanding your campaigns

Hi Jordan, a campaign is a list of leads you work in the Dialer. AgentFlow serves you the next lead, so you spend your time talking instead of searching.

Why it matters: When you know how the queue works, you can trust it. In shared campaigns, two agents never call the same lead at the same time.

P. Personal — Your own private list. Only you call these leads.
T. Team — Your admin assigns leads to specific agents. Each lead is held for one agent while it's on screen.
O. Open Pool — Everyone on the campaign works the same list. When you have a real conversation, the lead is assigned to you.

After each call, pick an outcome and click Save & Next. Leads you don't reach can come back later, based on the campaign's retry settings. Callbacks you schedule appear on your Dashboard under Callbacks.

Choose a Campaign: https://www.fflagent.com/dialer

Not signed in? Sign in first, then choose Dialer in the left menu.

© 2026 AgentFlow Inc. All Rights Reserved.
Unsubscribe from onboarding tips: https://www.fflagent.com/email/unsubscribe?token=<signed>
Privacy Policy: https://www.fflagent.com/privacy
```

### Day 8 — Know your numbers  (`agent_day08_numbers`)

- **Subject:** Know your numbers: what your dialer stats mean
- **Preheader:** Calls Made, Contacted, Contact Rate, and how to set your monthly goals.
- **Badge:** New Agent Tips · 4 of 5
- **Heading:** Know your numbers
- **Primary CTA:** “Set My Goals →” → `https://www.fflagent.com/settings?section=my-profile`
- **CTA note:** Not signed in? Sign in, then open Settings → My Profile → My Goals.

Plain-text part exactly as rendered (HTML carries the same words; steps render as numbered/lettered rows):

```text
AGENTFLOW — LIFE INSURANCE CRM & POWER DIALER

Know your numbers

Hi Jordan, while you dial, the stats bar at the top of the Dialer shows today's numbers for the campaign you're working.

Why it matters: Activity drives results. Watching your contact rate tells you when to change your call times or your opener, before a slow week becomes a slow month.

CM. Calls Made — Every call you've placed from this campaign today.
CT. Contacted — Calls over 45 seconds, plus calls ending in an outcome your agency counts as a real conversation.
CR. Contact Rate — Contacted calls divided by calls made.

Set your monthly goals in My Profile under My Goals, then track them on your Dashboard under Goal Progress. The Leaderboard shows how you compare today, this week, and this month.

Set My Goals: https://www.fflagent.com/settings?section=my-profile

Not signed in? Sign in, then open Settings → My Profile → My Goals.

© 2026 AgentFlow Inc. All Rights Reserved.
Unsubscribe from onboarding tips: https://www.fflagent.com/email/unsubscribe?token=<signed>
Privacy Policy: https://www.fflagent.com/privacy
```

### Day 14 — Build your daily routine  (`agent_day14_routine`)

- **Subject:** A simple daily routine for steady production
- **Preheader:** Start with follow-ups, protect your dialing time, and finish with your numbers.
- **Badge:** New Agent Tips · 5 of 5
- **Heading:** Build your daily routine
- **Primary CTA:** “Open My Dashboard →” → `https://www.fflagent.com/dashboard`
- **CTA note:** Not signed in? Sign in and you'll land on your Dashboard.

Plain-text part exactly as rendered (HTML carries the same words; steps render as numbered/lettered rows):

```text
AGENTFLOW — LIFE INSURANCE CRM & POWER DIALER

Build your daily routine

Hi Jordan, you've had two weeks in AgentFlow. A steady routine makes your production easier to predict. Here's a simple one built around the tools you already use.

Why it matters: Prospects who asked you to call back are your warmest leads. A routine makes sure they hear from you first, every day.

1. Start with your follow-ups — Open your Dashboard and work your Callbacks and today's Schedule first.
2. Protect your dialing time — Block time for the Dialer and turn on Auto-Dial so calls keep moving.
3. Finish with your numbers — Before you log off, check your stats and Goal Progress, and look in Conversations for new texts and emails.

This is the last email in your new agent series.

Open My Dashboard: https://www.fflagent.com/dashboard

Not signed in? Sign in and you'll land on your Dashboard.

© 2026 AgentFlow Inc. All Rights Reserved.
Unsubscribe from onboarding tips: https://www.fflagent.com/email/unsubscribe?token=<signed>
Privacy Policy: https://www.fflagent.com/privacy
```


## Agency admin series (Admins)

### Day 2 — Set up your agency  (`admin_day02_agency_setup`)

- **Subject:** Set up your agency in AgentFlow
- **Preheader:** Confirm your time zone, add your carriers, and review your dispositions.
- **Badge:** Agency Setup · 1 of 4
- **Heading:** Set up your agency
- **Primary CTA:** “Open Company Branding →” → `https://www.fflagent.com/settings?section=company-branding`
- **CTA note:** Not signed in? Sign in, then open Settings → Company Branding.

Plain-text part exactly as rendered (HTML carries the same words; steps render as numbered/lettered rows):

```text
AGENTFLOW — LIFE INSURANCE CRM & POWER DIALER

Set up your agency

Hi Jordan, a few agency settings shape how AgentFlow works for your whole team. Each one takes a couple of minutes.

Why it matters: Reports are calculated in your agency's time zone, agents need your carriers to record a sale, and your dispositions decide what counts as a real conversation.

1. Confirm your time zone — Settings → Company Branding. Reports use this time zone.
2. Add your carriers — Settings → Carriers. Agents choose a carrier when they convert a lead to a client.
3. Review your dispositions — Settings → Dispositions. Turn on Counts as Contacted for outcomes where the agent reached a real person.

Want to go further? Settings → Contact Flow is where you customize pipeline stages, custom fields, and lead sources.

Open Company Branding: https://www.fflagent.com/settings?section=company-branding

Not signed in? Sign in, then open Settings → Company Branding.

© 2026 AgentFlow Inc. All Rights Reserved.
Unsubscribe from onboarding tips: https://www.fflagent.com/email/unsubscribe?token=<signed>
Privacy Policy: https://www.fflagent.com/privacy
```

### Day 4 — Get your agents dialing  (`admin_day04_agents_dialing`)

- **Subject:** Get your agents dialing
- **Preheader:** Phone numbers, team invitations, and your first campaign.
- **Badge:** Agency Setup · 2 of 4
- **Heading:** Get your agents dialing
- **Primary CTA:** “Invite Your Team →” → `https://www.fflagent.com/settings?section=user-management`
- **CTA note:** Not signed in? Sign in, then open Settings → User Management.

Plain-text part exactly as rendered (HTML carries the same words; steps render as numbered/lettered rows):

```text
AGENTFLOW — LIFE INSURANCE CRM & POWER DIALER

Get your agents dialing

Hi Jordan, before their first session, your agents need a number to call from, an account, and leads in a campaign.

Why it matters: New agents lose momentum when they log in and can't dial. Having everything ready on day one lets them start calling right away.

1. Add phone numbers — Settings → Phone System → Phone Numbers → Purchase number. Agency numbers are shared by your team; Personal numbers belong to one agent.
2. Invite your team — Settings → User Management → Invite New Agent. Choose Agent, Team Leader, or Admin. Invitations expire after 7 days.
3. Create a campaign and add leads — Campaigns → New Campaign, then import a CSV and assign leads to an agent or spread them with Round Robin.

Planning to text leads? Texting needs an approved A2P registration, so start early under Settings → Phone System → A2P Registration.

Invite Your Team: https://www.fflagent.com/settings?section=user-management

Not signed in? Sign in, then open Settings → User Management.

© 2026 AgentFlow Inc. All Rights Reserved.
Unsubscribe from onboarding tips: https://www.fflagent.com/email/unsubscribe?token=<signed>
Privacy Policy: https://www.fflagent.com/privacy
```

### Day 7 — Manage your team's performance  (`admin_day07_team_performance`)

- **Subject:** See how your team is performing
- **Preheader:** Reports, goals for every agent, and the Leaderboard on a big screen.
- **Badge:** Agency Setup · 3 of 4
- **Heading:** Manage your team's performance
- **Primary CTA:** “Open Reports →” → `https://www.fflagent.com/reports`
- **CTA note:** Not signed in? Sign in, then choose Reports in the left menu.

Plain-text part exactly as rendered (HTML carries the same words; steps render as numbered/lettered rows):

```text
AGENTFLOW — LIFE INSURANCE CRM & POWER DIALER

Manage your team's performance

Hi Jordan, once your agents are dialing, AgentFlow records their activity automatically: calls, conversations, appointments, and policies.

Why it matters: Coaching works best on facts. Seeing who is dialing, who is connecting, and who is closing shows you where each agent needs help.

1. Check Reports — Switch between Agency, Team, and Personal views, filter by agent, and export to CSV.
2. Set goals for each agent — Settings → User Management, open an agent, then Goals. Agents track their progress on their Dashboard.
3. Put the Leaderboard on a screen — Open Leaderboard and choose Full Screen Display Mode to show today's standings in your office.

Reports are hidden from agents by default. You can change that under Settings → Permissions.

Open Reports: https://www.fflagent.com/reports

Not signed in? Sign in, then choose Reports in the left menu.

© 2026 AgentFlow Inc. All Rights Reserved.
Unsubscribe from onboarding tips: https://www.fflagent.com/email/unsubscribe?token=<signed>
Privacy Policy: https://www.fflagent.com/privacy
```

### Day 12 — Build a high-performing agency  (`admin_day12_high_performing`)

- **Subject:** Build a high-performing agency
- **Preheader:** Shared scripts, training, and automation that keep your team consistent.
- **Badge:** Agency Setup · 4 of 4
- **Heading:** Build a high-performing agency
- **Primary CTA:** “Add Call Scripts →” → `https://www.fflagent.com/settings?section=call-scripts`
- **CTA note:** Not signed in? Sign in, then open Settings → Call Scripts.

Plain-text part exactly as rendered (HTML carries the same words; steps render as numbered/lettered rows):

```text
AGENTFLOW — LIFE INSURANCE CRM & POWER DIALER

Build a high-performing agency

Hi Jordan, the strongest agencies give every agent the same playbook. AgentFlow lets you keep yours in one place.

Why it matters: Shared scripts and consistent follow-up help new agents ramp up faster and keep your compliance language the same on every call.

1. Add call scripts — Settings → Call Scripts. Active scripts appear in the Scripts tab while agents dial.
2. Build your training library — Open Training and click Add Resource to share training material with your team.
3. Automate routine follow-up — Settings → Workflow Builder. For example, send an email or update a lead's stage when an agent picks a disposition.

This is the last email in your agency setup series.

Add Call Scripts: https://www.fflagent.com/settings?section=call-scripts

Not signed in? Sign in, then open Settings → Call Scripts.

© 2026 AgentFlow Inc. All Rights Reserved.
Unsubscribe from onboarding tips: https://www.fflagent.com/email/unsubscribe?token=<signed>
Privacy Policy: https://www.fflagent.com/privacy
```

