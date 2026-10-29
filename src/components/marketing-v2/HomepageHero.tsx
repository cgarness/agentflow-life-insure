import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, CirclePlay, ShieldCheck } from "lucide-react";
import { Reveal, SectionEyebrow } from "./theme";
import { primaryButton, outlineButton } from "./styles";
import DemoShell from "./DemoShell";
import { MEDIA } from "./media";

export default function HomepageHero() {
  return (
        <section className="relative overflow-hidden pb-16 pt-16 sm:pb-24 sm:pt-20 lg:pb-28">
          <div aria-hidden="true" className="pointer-events-none absolute -right-48 -top-64 h-[660px] w-[760px] rounded-full bg-sky-500/[0.11] blur-[115px]" />
          <div aria-hidden="true" className="pointer-events-none absolute -left-60 top-40 h-[540px] w-[600px] rounded-full bg-blue-800/20 blur-[115px]" />
          <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <Reveal>
              <SectionEyebrow>Made for life insurance agents</SectionEyebrow>
              <h1 className="mt-7 max-w-3xl text-4xl font-black leading-[1.08] tracking-[-0.04em] sm:text-5xl lg:text-[3.1rem]">
                More conversations.<br />
                Less busywork.<br />
                <span className="bg-gradient-to-r from-sky-400 to-cyan-300 bg-clip-text text-transparent">One AgentFlow.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-slate-300 sm:text-lg">
                An insurance-focused CRM that brings your dialing, contacts, follow-ups, and team visibility into one organized workspace.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/signup" className={primaryButton}>Get started <ArrowRight size={17} /></Link>
                <a href="#dialer" className={outlineButton}><CirclePlay size={18} /> See AgentFlow in action</a>
              </div>
              <div className="mt-8 flex flex-wrap gap-4 text-xs text-slate-400">
                <span className="inline-flex items-center gap-2"><Check size={15} className="text-cyan-300" /> Built for life insurance</span>
                <span className="inline-flex items-center gap-2"><Check size={15} className="text-cyan-300" /> Designed for teams</span>
              </div>
            </Reveal>
            <Reveal>
              <div className="relative">
                <div aria-hidden="true" className="absolute -inset-4 rounded-[30px] bg-sky-500/15 blur-3xl" />
                <div className="relative overflow-hidden rounded-[24px] border border-sky-300/25 bg-[#0a1525] p-2 shadow-[0_35px_100px_rgba(0,0,0,0.5)] sm:p-3">
                  <div className="flex h-8 items-center justify-between px-2 pb-2 text-[10px] text-slate-400">
                    <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-cyan-400" /> AgentFlow workspace</span>
                    <span>Dashboard</span>
                  </div>
                  <DemoShell asset={MEDIA.dashboard} priority chrome={false} />
                </div>
                <div className="mt-4 inline-block rounded-2xl border border-white/15 bg-[#11243a]/95 px-4 py-3 shadow-xl">
                  <p className="flex items-center gap-2 text-xs font-semibold text-white"><ShieldCheck size={16} className="text-cyan-300" /> One connected workspace</p>
                  <p className="mt-1 text-[11px] text-slate-400">Dialing · Contacts · Reporting</p>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

  );
}
