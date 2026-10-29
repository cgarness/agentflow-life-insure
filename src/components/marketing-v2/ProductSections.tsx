import React from "react";
import { ClipboardCheck, Headphones, MessageSquareText, Trophy } from "lucide-react";
import { CheckPoint, Reveal, SectionEyebrow } from "./theme";
import DemoShell from "./DemoShell";
import { MEDIA } from "./media";
import { SampleConversation, SampleLeaderboard } from "./Illustrations";

export default function ProductSections() {
  return <>
        <section id="features" className="border-y border-white/10 bg-white/[0.018] py-8">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-5 sm:px-8 lg:grid-cols-4">
            {[
              { Icon: Headphones, text: "Built for high-volume calling" },
              { Icon: ClipboardCheck, text: "Structured lead workflows" },
              { Icon: MessageSquareText, text: "Two-way communication" },
              { Icon: Trophy, text: "Team performance visibility" },
            ].map(({ Icon, text }) => (
              <div key={text} className="flex items-center gap-3 py-2">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300"><Icon size={19} /></span>
                <span className="text-xs font-medium leading-5 text-slate-300 sm:text-sm">{text}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="dialer" className="mx-auto grid max-w-7xl scroll-mt-24 items-center gap-10 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:py-28">
          <Reveal>
            <SectionEyebrow>01 / Power dialer</SectionEyebrow>
            <h2 className="mt-6 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">From lead list to real conversations.</h2>
            <p className="mt-5 max-w-lg text-base leading-8 text-slate-400">Your agents can preview contact details, place calls, and record outcomes without jumping between disconnected tools.</p>
            <ul className="mt-6 space-y-3">
              <CheckPoint>Access lead context before calling</CheckPoint>
              <CheckPoint>Keep dispositions and call history organized</CheckPoint>
              <CheckPoint>Move smoothly into the next follow-up</CheckPoint>
            </ul>
            <p className="mt-6 text-xs text-slate-500">Preview each lead. Start the call. Record the outcome.</p>
          </Reveal>
          <Reveal className="lg:order-last">
            <DemoShell asset={MEDIA.dialer} />
          </Reveal>
        </section>

        <section id="leaderboard" className="scroll-mt-24 border-y border-white/10 bg-[#0a1525]">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:py-28">
            <Reveal className="lg:order-first">
              <DemoShell asset={MEDIA.leaderboard}><SampleLeaderboard /></DemoShell>
            </Reveal>
            <Reveal>
              <SectionEyebrow>02 / Live leaderboard</SectionEyebrow>
              <h2 className="mt-6 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">Turn production into motivation.</h2>
              <p className="mt-5 max-w-lg text-base leading-8 text-slate-400">Give agents a clear view of where they stand. Put annualized premium front and center, with rankings and recognition that encourage momentum.</p>
              <ul className="mt-6 space-y-3">
                <CheckPoint>AP-focused performance visibility</CheckPoint>
                <CheckPoint>Rankings designed for agency teams</CheckPoint>
                <CheckPoint>Recognize progress, not just activity</CheckPoint>
              </ul>
              <p className="mt-6 text-xs text-slate-500">Annualized premium (AP) reflects policy production, not take-home commissions.</p>
            </Reveal>
          </div>
        </section>

        <section id="conversations" className="mx-auto grid max-w-7xl scroll-mt-24 items-center gap-10 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:py-28">
          <Reveal>
            <SectionEyebrow>03 / Conversations</SectionEyebrow>
            <h2 className="mt-6 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">Keep the follow-up moving.</h2>
            <p className="mt-5 max-w-lg text-base leading-8 text-slate-400">A lead responds. Your agent sees the thread, follows up, and keeps track of the relationship from one workspace.</p>
            <ul className="mt-6 space-y-3">
              <CheckPoint>Keep text and email conversations together</CheckPoint>
              <CheckPoint>See contact history and follow-up context</CheckPoint>
              <CheckPoint>Work alongside your calendar and lead tools</CheckPoint>
            </ul>
          </Reveal>
          <Reveal>
            <DemoShell asset={MEDIA.conversations}><SampleConversation /></DemoShell>
          </Reveal>
        </section>

  </>;
}
