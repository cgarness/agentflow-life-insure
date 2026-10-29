import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { MessageSquareText, Trophy } from "lucide-react";
import { easing } from "./styles";

export function SampleLeaderboard() {
  const reduceMotion = useReducedMotion();
  const rows = [
    { rank: "01", name: "Agent A", amount: "$28,750", bar: "88%" },
    { rank: "02", name: "Agent B", amount: "$23,400", bar: "72%" },
    { rank: "03", name: "Agent C", amount: "$19,800", bar: "60%" },
    { rank: "04", name: "Agent D", amount: "$15,200", bar: "45%" },
  ];
  return (
    <div className="min-h-[260px] p-4 sm:p-7">
      <div className="mb-6 flex items-center justify-between">
        <div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-400">Agent leaderboard</p><h4 className="mt-1 text-lg font-bold text-white">Annualized premium</h4></div>
        <span className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-400">Illustrative data</span>
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.rank} className={"flex items-center gap-3 rounded-xl border px-3 py-3 " + (index === 0 ? "border-amber-400/30 bg-amber-400/10" : "border-white/10 bg-white/[0.025]")}>
            <span className={index === 0 ? "w-6 text-sm font-bold text-amber-300" : "w-6 text-sm font-semibold text-slate-400"}>{row.rank}</span>
            <div className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold " + (index === 0 ? "bg-amber-400/20 text-amber-200" : "bg-sky-400/10 text-sky-300")}>{row.name.slice(-1)}</div>
            <span className="w-16 shrink-0 text-xs font-semibold text-white sm:w-24 sm:text-sm">{row.name}</span>
            <div className="hidden h-2 flex-1 overflow-hidden rounded-full bg-white/10 sm:block">
              <motion.div
                className={index === 0 ? "h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300" : "h-full rounded-full bg-gradient-to-r from-sky-600 to-cyan-300"}
                initial={{ width: 0 }}
                whileInView={{ width: row.bar }}
                viewport={{ once: true }}
                transition={{ duration: reduceMotion ? 0 : 1.1, delay: reduceMotion ? 0 : index * 0.11, ease: easing }}
              />
            </div>
            <span className="ml-auto shrink-0 text-xs font-bold tabular-nums text-white sm:text-sm">{row.amount}</span>
            {index === 0 && <Trophy size={16} className="hidden text-amber-300 sm:block" />}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SampleConversation() {
  return (
    <div className="grid h-full min-h-[290px] grid-cols-[112px_1fr] text-xs sm:grid-cols-[165px_1fr]">
      <div className="border-r border-white/10 bg-[#0e1c2e] p-3 sm:p-4">
        <p className="mb-4 text-xs font-bold text-white">Conversations</p>
        {["Sample Lead", "Sample Client", "Another Lead"].map((name, index) => (
          <div key={name} className={"mb-2 rounded-lg p-2 " + (index === 0 ? "bg-sky-400/15 text-white" : "text-slate-400")}>
            <span className="block truncate font-semibold">{name}</span>
            <span className="mt-1 block truncate text-[10px] opacity-60">Example message</span>
          </div>
        ))}
      </div>
      <div className="relative flex flex-col gap-3 p-4 sm:p-5">
        <div className="border-b border-white/10 pb-3 text-sm font-semibold text-white">Sample Lead <span className="ml-2 text-[10px] font-normal text-slate-400">Demo conversation</span></div>
        <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-sm bg-sky-500 px-3 py-2.5 leading-relaxed text-white">
          Hi! Following up on your coverage request. Is there a convenient time to talk?
        </div>
        <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-white/10 bg-white/10 px-3 py-2.5 leading-relaxed text-slate-100">
          Tomorrow morning would be great.
        </div>
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-sky-500 px-3 py-2.5 leading-relaxed text-white">
          Perfect — I'll follow up then.
        </div>
        <div className="mt-auto flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2.5 text-slate-500"><MessageSquareText size={14} /> Reply to this conversation</div>
        <span className="absolute bottom-2 right-4 text-[9px] text-slate-500">Synthetic example</span>
      </div>
    </div>
  );
}
