import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Menu, X } from "lucide-react";
import { primaryButton } from "./styles";

export default function HomepageNav() {
  const [open, setOpen] = useState(false);
  const nav = [
    { label: "Features", href: "#features" },
    { label: "Dialer", href: "#dialer" },
    { label: "Leaderboard", href: "#leaderboard" },
    { label: "FAQ", href: "#faq" },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#060c17]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-5 sm:px-8">
        <a href="#top" aria-label="AgentFlow homepage preview" className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
          <img src="/agentflow-logo-full-on-dark.png" alt="AgentFlow" width="156" height="24" className="h-6 w-auto max-w-[156px] object-contain" />
        </a>
        <nav aria-label="Homepage sections" className="hidden items-center gap-7 xl:flex">
          {nav.map((item) => <a key={item.href} href={item.href} className="text-sm text-slate-300 transition hover:text-white">{item.label}</a>)}
          <a href="#access" className="text-sm text-slate-300 transition hover:text-white">Access & plans</a>
        </nav>
        <div className="hidden items-center gap-3 xl:flex">
          <Link to="/login" className="px-3 py-2 text-sm font-semibold text-slate-300 hover:text-white">Log in</Link>
          <Link to="/signup" className={primaryButton + " min-h-10 px-5"}>Get started <ArrowRight size={16} /></Link>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="homepage-v2-mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen(!open)}
          className="rounded-lg border border-white/15 p-2 text-white xl:hidden"
        >{open ? <X size={21} /> : <Menu size={21} />}</button>
      </div>
      {open && (
        <nav id="homepage-v2-mobile-nav" aria-label="Mobile homepage navigation" className="border-t border-white/10 bg-[#081324] px-6 pb-6 pt-3 xl:hidden">
          {nav.map((item) => <a key={item.href} href={item.href} onClick={() => setOpen(false)} className="block py-3 text-sm text-white">{item.label}</a>)}
          <a href="#access" onClick={() => setOpen(false)} className="block py-3 text-sm text-white">Access & plans</a>
          <Link to="/login" onClick={() => setOpen(false)} className="block py-3 text-sm text-white">Log in</Link>
          <Link to="/signup" onClick={() => setOpen(false)} className={primaryButton + " mt-3 w-full"}>Get started <ArrowRight size={16} /></Link>
        </nav>
      )}
    </header>
  );
}
