import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";

import { easing } from "./styles";

export function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.17 }}
      transition={{ duration: 0.65, ease: easing }}
    >
      {children}
    </motion.div>
  );
}

export function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-sky-300">
      <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />{children}
    </span>
  );
}

export function CheckPoint({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm leading-relaxed text-slate-300">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-cyan-300"><Check size={13} /></span>
      {children}
    </li>
  );
}
