// Onboarding email series — copy and rendering. Every email renders through the ONE shared system
// renderer (_shared/systemEmail.ts, invariant #21): same light shell, logo, preheader, plain-text part
// and dynamic year as the welcome email. Only the user's first name is interpolated, always escaped.
// Copy is reviewed in docs/plans/2026-10-10-onboarding-emails/email-copy.md; templates.test.ts holds
// the two equal. No promise in this copy may describe unfinished functionality.

import {
  escapeHtml,
  featureRow,
  paragraph,
  type RenderedSystemEmail,
  renderSystemEmail,
  resolveSiteUrl,
  sanitizeHeaderText,
  strongText,
} from "../systemEmail.ts";
import { findStep, PRIVACY_PATH, SEQUENCE_LABEL, SEQUENCE_LENGTH } from "./catalog.ts";

export interface OnboardingEmailStepCopy {
  marker: string;
  title: string;
  text: string;
}

export interface OnboardingEmailCopy {
  subject: string;
  preheader: string;
  heading: string;
  /** Follows "Hi {first name}, " in the first paragraph. */
  intro: string;
  /** Follows "Why it matters: ". */
  why: string;
  steps: OnboardingEmailStepCopy[];
  extra?: string;
  closing?: string;
  ctaLabel: string;
  ctaNote: string;
}

export const ONBOARDING_EMAIL_COPY: Readonly<Record<string, OnboardingEmailCopy>> = Object.freeze({
  agent_day01_dialer_ready: {
    subject: "Get your dialer ready before your first call",
    preheader: "Three quick checks so your first dialing session starts on time.",
    heading: "Get your dialer ready",
    intro: "AgentFlow places calls right from your browser, so there's no phone app to install. A few quick checks now will make your first session smooth.",
    why: "A blocked microphone or a missed setup step can cost you a live prospect. Set up once, and every session starts on time.",
    steps: [
      { marker: "1", title: "Allow your microphone", text: "When your browser asks, choose Allow. AgentFlow can't place or answer calls without it." },
      { marker: "2", title: "Wait for Ready", text: "Click the green Dialer button at the top of the screen. You're set when the panel shows Ready." },
      { marker: "3", title: "Start a campaign", text: "Open Dialer, choose a campaign under Select a Campaign, and click Start Dialing. Don't see one? Ask your agency admin to add you." },
    ],
    ctaLabel: "Open the Dialer",
    ctaNote: "Not signed in? Sign in first, then choose Dialer in the left menu.",
  },
  agent_day03_work_leads: {
    subject: "Work your leads like a pro",
    preheader: "Notes, stages, and follow-ups that keep every lead moving.",
    heading: "Work your leads like a pro",
    intro: "every lead in AgentFlow has one record with their details, call history, notes, and tasks. Keeping it current takes seconds.",
    why: "Many policies close on a follow-up call, not the first one. When your notes and stages are current, you always know where each conversation left off.",
    steps: [
      { marker: "1", title: "Open the full record", text: "In Contacts, click a lead to see their details, Activity, Notes, and Tasks in one place." },
      { marker: "2", title: "Keep notes and stages current", text: "After each conversation, note who the coverage is for, what they need, and when to call back. Then update the lead's stage." },
      { marker: "3", title: "Convert when you make a sale", text: "Click Convert to turn the lead into a client and record the policy, including carrier, premium, and sold date." },
    ],
    ctaLabel: "Open My Contacts",
    ctaNote: "Not signed in? Sign in first, then choose Contacts in the left menu.",
  },
  agent_day05_campaigns: {
    subject: "How your campaigns decide who you call next",
    preheader: "Personal, Team, and Open Pool campaigns, and what happens after each call.",
    heading: "Understanding your campaigns",
    intro: "a campaign is a list of leads you work in the Dialer. AgentFlow serves you the next lead, so you spend your time talking instead of searching.",
    why: "When you know how the queue works, you can trust it. In shared campaigns, two agents never call the same lead at the same time.",
    steps: [
      { marker: "P", title: "Personal", text: "Your own private list. Only you call these leads." },
      { marker: "T", title: "Team", text: "Your admin assigns leads to specific agents. Each lead is held for one agent while it's on screen." },
      { marker: "O", title: "Open Pool", text: "Everyone on the campaign works the same list. When you have a real conversation, the lead is assigned to you." },
    ],
    extra: "After each call, pick an outcome and click Save & Next. Leads you don't reach can come back later, based on the campaign's retry settings. Callbacks you schedule appear on your Dashboard under Callbacks.",
    ctaLabel: "Choose a Campaign",
    ctaNote: "Not signed in? Sign in first, then choose Dialer in the left menu.",
  },
  agent_day08_numbers: {
    subject: "Know your numbers: what your dialer stats mean",
    preheader: "Calls Made, Contacted, Contact Rate, and how to set your monthly goals.",
    heading: "Know your numbers",
    intro: "while you dial, the stats bar at the top of the Dialer shows today's numbers for the campaign you're working.",
    why: "Activity drives results. Watching your contact rate tells you when to change your call times or your opener, before a slow week becomes a slow month.",
    steps: [
      { marker: "CM", title: "Calls Made", text: "Every call you've placed from this campaign today." },
      { marker: "CT", title: "Contacted", text: "Calls over 45 seconds, plus calls ending in an outcome your agency counts as a real conversation." },
      { marker: "CR", title: "Contact Rate", text: "Contacted calls divided by calls made." },
    ],
    extra: "Set your monthly goals in My Profile under My Goals, then track them on your Dashboard under Goal Progress. The Leaderboard shows how you compare today, this week, and this month.",
    ctaLabel: "Set My Goals",
    ctaNote: "Not signed in? Sign in, then open Settings → My Profile → My Goals.",
  },
  agent_day14_routine: {
    subject: "A simple daily routine for steady production",
    preheader: "Start with follow-ups, protect your dialing time, and finish with your numbers.",
    heading: "Build your daily routine",
    intro: "you've had two weeks in AgentFlow. A steady routine makes your production easier to predict. Here's a simple one built around the tools you already use.",
    why: "Prospects who asked you to call back are your warmest leads. A routine makes sure they hear from you first, every day.",
    steps: [
      { marker: "1", title: "Start with your follow-ups", text: "Open your Dashboard and work your Callbacks and today's Schedule first." },
      { marker: "2", title: "Protect your dialing time", text: "Block time for the Dialer and turn on Auto-Dial so calls keep moving." },
      { marker: "3", title: "Finish with your numbers", text: "Before you log off, check your stats and Goal Progress, and look in Conversations for new texts and emails." },
    ],
    closing: "This is the last email in your new agent series.",
    ctaLabel: "Open My Dashboard",
    ctaNote: "Not signed in? Sign in and you'll land on your Dashboard.",
  },
  admin_day02_agency_setup: {
    subject: "Set up your agency in AgentFlow",
    preheader: "Confirm your time zone, add your carriers, and review your dispositions.",
    heading: "Set up your agency",
    intro: "a few agency settings shape how AgentFlow works for your whole team. Each one takes a couple of minutes.",
    why: "Reports are calculated in your agency's time zone, agents need your carriers to record a sale, and your dispositions decide what counts as a real conversation.",
    steps: [
      { marker: "1", title: "Confirm your time zone", text: "Settings → Company Branding. Reports use this time zone." },
      { marker: "2", title: "Add your carriers", text: "Settings → Carriers. Agents choose a carrier when they convert a lead to a client." },
      { marker: "3", title: "Review your dispositions", text: "Settings → Dispositions. Turn on Counts as Contacted for outcomes where the agent reached a real person." },
    ],
    extra: "Want to go further? Settings → Contact Flow is where you customize pipeline stages, custom fields, and lead sources.",
    ctaLabel: "Open Company Branding",
    ctaNote: "Not signed in? Sign in, then open Settings → Company Branding.",
  },
  admin_day04_agents_dialing: {
    subject: "Get your agents dialing",
    preheader: "Phone numbers, team invitations, and your first campaign.",
    heading: "Get your agents dialing",
    intro: "before their first session, your agents need a number to call from, an account, and leads in a campaign.",
    why: "New agents lose momentum when they log in and can't dial. Having everything ready on day one lets them start calling right away.",
    steps: [
      { marker: "1", title: "Add phone numbers", text: "Settings → Phone System → Phone Numbers → Purchase number. Agency numbers are shared by your team; Personal numbers belong to one agent." },
      { marker: "2", title: "Invite your team", text: "Settings → User Management → Invite New Agent. Choose Agent, Team Leader, or Admin. Invitations expire after 7 days." },
      { marker: "3", title: "Create a campaign and add leads", text: "Campaigns → New Campaign, then import a CSV and assign leads to an agent or spread them with Round Robin." },
    ],
    extra: "Planning to text leads? Texting needs an approved A2P registration, so start early under Settings → Phone System → A2P Registration.",
    ctaLabel: "Invite Your Team",
    ctaNote: "Not signed in? Sign in, then open Settings → User Management.",
  },
  admin_day07_team_performance: {
    subject: "See how your team is performing",
    preheader: "Reports, goals for every agent, and the Leaderboard on a big screen.",
    heading: "Manage your team's performance",
    intro: "once your agents are dialing, AgentFlow records their activity automatically: calls, conversations, appointments, and policies.",
    why: "Coaching works best on facts. Seeing who is dialing, who is connecting, and who is closing shows you where each agent needs help.",
    steps: [
      { marker: "1", title: "Check Reports", text: "Switch between Agency, Team, and Personal views, filter by agent, and export to CSV." },
      { marker: "2", title: "Set goals for each agent", text: "Settings → User Management, open an agent, then Goals. Agents track their progress on their Dashboard." },
      { marker: "3", title: "Put the Leaderboard on a screen", text: "Open Leaderboard and choose Full Screen Display Mode to show today's standings in your office." },
    ],
    extra: "Reports are hidden from agents by default. You can change that under Settings → Permissions.",
    ctaLabel: "Open Reports",
    ctaNote: "Not signed in? Sign in, then choose Reports in the left menu.",
  },
  admin_day12_high_performing: {
    subject: "Build a high-performing agency",
    preheader: "Shared scripts, training, and automation that keep your team consistent.",
    heading: "Build a high-performing agency",
    intro: "the strongest agencies give every agent the same playbook. AgentFlow lets you keep yours in one place.",
    why: "Shared scripts and consistent follow-up help new agents ramp up faster and keep your compliance language the same on every call.",
    steps: [
      { marker: "1", title: "Add call scripts", text: "Settings → Call Scripts. Active scripts appear in the Scripts tab while agents dial." },
      { marker: "2", title: "Build your training library", text: "Open Training and click Add Resource to share training material with your team." },
      { marker: "3", title: "Automate routine follow-up", text: "Settings → Workflow Builder. For example, send an email or update a lead's stage when an agent picks a disposition." },
    ],
    closing: "This is the last email in your agency setup series.",
    ctaLabel: "Add Call Scripts",
    ctaNote: "Not signed in? Sign in, then open Settings → Call Scripts.",
  },});

export interface RenderedOnboardingEmail extends RenderedSystemEmail {
  subject: string;
}

export interface RenderOnboardingEmailParams {
  stepKey: string;
  firstName: string | null | undefined;
  /** Signed footer link to the public confirm page; built by the worker, never by a caller. */
  unsubscribeUrl: string;
}

const MAX_NAME_LENGTH = 60;

export function displayFirstName(firstName: string | null | undefined): string {
  const clean = sanitizeHeaderText(firstName ?? "").slice(0, MAX_NAME_LENGTH).trim();
  return clean || "there";
}

export function renderOnboardingEmail(params: RenderOnboardingEmailParams): RenderedOnboardingEmail {
  const step = findStep(params.stepKey);
  const copy = ONBOARDING_EMAIL_COPY[params.stepKey];
  if (!step || !copy) {
    throw new Error(`onboardingEmail: unknown step ${params.stepKey}`);
  }
  const siteUrl = resolveSiteUrl();
  const name = displayFirstName(params.firstName);

  const bodyHtml = [
    paragraph(`Hi ${strongText(escapeHtml(name))}, ${escapeHtml(copy.intro)}`),
    paragraph(`${strongText("Why it matters:")} ${escapeHtml(copy.why)}`),
    ...copy.steps.map((s) => featureRow(s.marker, s.title, s.text)),
    ...(copy.extra ? [paragraph(escapeHtml(copy.extra))] : []),
    ...(copy.closing ? [paragraph(escapeHtml(copy.closing))] : []),
  ].join("\n");

  const bodyText = [
    `Hi ${name}, ${copy.intro}`,
    "",
    `Why it matters: ${copy.why}`,
    "",
    ...copy.steps.map((s) => `${s.marker}. ${s.title} — ${s.text}`),
    ...(copy.extra ? ["", copy.extra] : []),
    ...(copy.closing ? ["", copy.closing] : []),
  ];

  const { html, text } = renderSystemEmail({
    title: copy.heading,
    preheader: copy.preheader,
    badge: `${SEQUENCE_LABEL[step.sequenceKey]} · ${step.position} of ${SEQUENCE_LENGTH[step.sequenceKey]}`,
    heading: copy.heading,
    bodyHtml,
    bodyText,
    cta: { label: `${copy.ctaLabel} →`, url: `${siteUrl}${step.ctaPath}` },
    ctaNote: copy.ctaNote,
    footerLinks: [
      { label: "Unsubscribe from onboarding tips", url: params.unsubscribeUrl },
      { label: "Privacy Policy", url: `${siteUrl}${PRIVACY_PATH}` },
    ],
  });

  return { subject: sanitizeHeaderText(copy.subject), html, text };
}
