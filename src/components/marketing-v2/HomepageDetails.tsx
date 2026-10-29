import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BarChart3, CalendarCheck2, ChevronDown, MessageSquareText, PhoneCall, Trophy, Users } from "lucide-react";
import { Reveal, SectionEyebrow } from "./theme";
import { primaryButton, outlineButton } from "./styles";

const capabilityCards = [
  { Icon: PhoneCall, name: "Power dialer", desc: "Call from your lead workflow without constantly switching tabs." },
  { Icon: Users, name: "Lead & client management", desc: "Keep contact details, notes, activity, and policy context organized." },
  { Icon: MessageSquareText, name: "Conversations", desc: "Handle text and email conversations from one place." },
  { Icon: Trophy, name: "Leaderboards", desc: "Give teams a clear view of production and progress." },
  { Icon: CalendarCheck2, name: "Calendar", desc: "Keep appointments and follow-ups visible." },
  { Icon: BarChart3, name: "Campaign reporting", desc: "Understand activity and results from your campaigns." },
];

function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  const entries = [
    { q: "Who is AgentFlow designed for?", a: "AgentFlow is designed specifically for life insurance agents, team leaders, and agencies that want their calling, contacts, campaigns, and reporting in one workspace." },
    { q: "How does dialing work?", a: "Agents review a lead and start each call from their browser, then record the outcome. Contact context and call history stay alongside the workflow." },
    { q: "How do I get started?", a: "Create an account to begin setup, or follow your agency invitation if you have one. Confirm pricing and workspace access with your agency administrator before signing up." },
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {entries.map((entry, i) => (
        <div key={entry.q} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
          <button type="button" aria-expanded={open === i} aria-controls={`homepage-v2-answer-${i}`} id={`homepage-v2-question-${i}`} onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-sm font-semibold text-white sm:text-base">
            {entry.q}<ChevronDown className={"shrink-0 text-slate-400 transition-transform " + (open === i ? "rotate-180" : "")} size={18} />
          </button>
          <p hidden={open !== i} id={`homepage-v2-answer-${i}`} aria-labelledby={`homepage-v2-question-${i}`} className="px-6 pb-5 text-sm leading-7 text-slate-400">{entry.a}</p>
        </div>
      ))}
    </div>
  );
}

export function HomepageDetails() {
  return <>
        <section className="border-y border-white/10 bg-white/[0.018] py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <Reveal className="mx-auto max-w-2xl text-center">
              <SectionEyebrow>One system for the work you do</SectionEyebrow>
              <h2 className="mt-6 text-3xl font-extrabold tracking-tight sm:text-4xl">Less switching. More clarity.</h2>
              <p className="mt-4 text-base leading-8 text-slate-400">The tools that matter to life insurance agents, all organized around a connected workflow.</p>
            </Reveal>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {capabilityCards.map(({ Icon, name, desc }) => (
                <Reveal key={name}>
                  <div className="h-full rounded-2xl border border-white/10 bg-[#0b1728] p-6 transition-colors motion-safe:transition-transform motion-safe:hover:-translate-y-1 hover:border-sky-400/30">
                    <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300"><Icon size={21} /></div>
                    <h3 className="text-base font-bold text-white">{name}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-400">{desc}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-20 sm:px-8 lg:py-28">
          <Reveal className="mb-12 text-center">
            <SectionEyebrow>Frequently asked questions</SectionEyebrow>
            <h2 className="mt-6 text-3xl font-extrabold tracking-tight sm:text-4xl">Get to know AgentFlow.</h2>
          </Reveal>
          <FAQ />
        </section>

        <section id="access" className="scroll-mt-24 px-5 pb-20 sm:px-8">
          <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[28px] border border-sky-400/25 bg-gradient-to-r from-[#102a50] via-[#0c3c62] to-[#122449] px-6 py-12 text-center sm:px-12 sm:py-16">
            <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-24 h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl" />
            <div className="relative">
              <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Ready to see what AgentFlow can do?</h2>
              <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-200">Create an account to begin setup. Use your agency invitation if one was provided.</p>
              <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                <Link to="/signup" className={primaryButton}>Get started <ArrowRight size={17} /></Link>
                <Link to="/login" className={outlineButton}>Log in</Link>
              </div>
              <p className="mt-5 text-xs leading-6 text-slate-300">Plan prices and trial terms are not confirmed in this private preview. Confirm current terms with your agency before signing up.</p>
            </div>
          </div>
        </section>
  </>;
}

export function HomepageFooter() {
  return (
      <footer className="border-t border-white/10 bg-[#040811] px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <img src="/agentflow-logo-full-on-dark.png" alt="AgentFlow" width="130" height="20" loading="lazy" className="h-5 w-auto" />
            <p className="mt-3 text-xs text-slate-400">Built for life insurance agencies.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-5 text-xs text-slate-400">
            <a href="#access" className="hover:text-white">Access & plans</a>
            <Link to="/privacy" className="hover:text-white">Privacy</Link>
            <Link to="/terms" className="hover:text-white">Terms</Link>
            <Link to="/login" className="hover:text-white">Log in</Link>
          </nav>
        </div>
      </footer>
  );
}
