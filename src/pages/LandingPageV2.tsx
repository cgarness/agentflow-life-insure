import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight, BarChart3, CalendarCheck2, Check, ChevronDown,
  CirclePlay, ClipboardCheck, Headphones, LockKeyhole, Menu,
  MessageSquareText, PhoneCall, ShieldCheck, Trophy, Users, X,
} from "lucide-react";

/**
 * AgentFlow Homepage V2 — a review-only public-marketing concept.
 *
 * SECURITY / RELEASE:
 * - This route is behind SuperAdminRoute and is shipped only on the preview branch.
 * - The Vercel preview deployment must remain sign-in protected.
 * - The production homepage (/) is NOT changed.
 *
 * MEDIA:
 * - Work should capture short, consent-safe, synthetic-data recordings from the
 *   actual authenticated product and add them in public/marketing-v2/.
 * - Until then, the page uses existing repository screenshots and explicitly
 *   illustrative demo UI. Do not call those static references "real video".
 * - Do not add unapproved endorsements, invented customer counts, fabricated
 *   pricing, or footage containing client PII.
 *
 * When footage has been reviewed, set one or more paths below to the published
 * muted WebM/MP4 clip. The video is automatically played only in the viewport.
 */
const MEDIA: {
  dialer?: string;
  leaderboard?: string;
  conversations?: string;
} = {
  dialer: undefined,
  leaderboard: undefined,
  conversations: undefined,
};

const easing = [0.22, 1, 0.36, 1] as const;
const buttonBase = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#060c17]";
const primaryButton = buttonBase + " bg-sky-500 text-white shadow-[0_0_30px_rgba(14,165,233,0.22)] hover:bg-sky-400";
const outlineButton = buttonBase + " border border-white/20 bg-white/[0.04] text-white hover:border-sky-400/60 hover:bg-white/[0.08]";

function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
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

function TopNav() {
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
        <a href="#top" aria-label="AgentFlow homepage preview" className="shrink-0">
          <img src="/agentflow-logo-full-on-dark.png" alt="AgentFlow" className="h-6 w-auto object-contain" />
        </a>
        <nav aria-label="Homepage sections" className="hidden items-center gap-7 md:flex">
          {nav.map((item) => <a key={item.href} href={item.href} className="text-sm text-slate-300 transition hover:text-white">{item.label}</a>)}
          <Link to="/pricing" className="text-sm text-slate-300 transition hover:text-white">Pricing</Link>
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <Link to="/login" className="px-3 py-2 text-sm font-semibold text-slate-300 hover:text-white">Log in</Link>
          <Link to="/signup" className={primaryButton + " min-h-10 px-5"}>Get started <ArrowRight size={16} /></Link>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen(!open)}
          className="rounded-lg border border-white/15 p-2 text-white md:hidden"
        >{open ? <X size={21} /> : <Menu size={21} />}</button>
      </div>
      {open && (
        <nav aria-label="Mobile homepage navigation" className="border-t border-white/10 bg-[#081324] px-6 pb-6 pt-3 md:hidden">
          {nav.map((item) => <a key={item.href} href={item.href} onClick={() => setOpen(false)} className="block py-3 text-sm text-white">{item.label}</a>)}
          <Link to="/pricing" onClick={() => setOpen(false)} className="block py-3 text-sm text-white">Pricing</Link>
          <Link to="/signup" onClick={() => setOpen(false)} className={primaryButton + " mt-3 w-full"}>Get started <ArrowRight size={16} /></Link>
        </nav>
      )}
    </header>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-sky-300">
      <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />{children}
    </span>
  );
}

function CheckPoint({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm leading-relaxed text-slate-300">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-cyan-300"><Check size={13} /></span>
      {children}
    </li>
  );
}

function DemoShell({
  label, image, imageAlt, videoSrc, children,
}: {
  label: string;
  image?: string;
  imageAlt?: string;
  videoSrc?: string;
  children?: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [manualPause, setManualPause] = useState(false);
  const reduceMotion = useReducedMotion();
  const hasVideo = Boolean(videoSrc && !videoFailed);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.intersectionRatio >= 0.4),
      { threshold: [0, 0.4, 0.75] },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (visible && !reduceMotion && !manualPause) {
      void video.play().catch(() => { /* autoplay may be blocked by browser */ });
    } else {
      video.pause();
    }
  }, [visible, reduceMotion, manualPause, hasVideo]);

  const togglePlayback = () => {
    setManualPause((previous) => !previous);
  };

  return (
    <div ref={rootRef} className="overflow-hidden rounded-[22px] border border-white/15 bg-[#0a1525] shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
      <div className="flex h-10 items-center justify-between gap-4 border-b border-white/10 bg-[#101e30] px-4">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="h-2 w-2 rounded-full bg-slate-500/60" />
          <span className="h-2 w-2 rounded-full bg-slate-500/60" />
          <span className="h-2 w-2 rounded-full bg-slate-500/60" />
        </div>
        <span className="truncate text-[11px] font-medium text-slate-400">AgentFlow / {label}</span>
        <span className="h-2 w-8" />
      </div>
      <div className="relative min-h-[240px] overflow-hidden bg-[#0a1424]">
        {hasVideo ? (
          <>
            <video
              ref={videoRef}
              src={videoSrc}
              className="block h-full w-full object-cover"
              autoPlay={false}
              muted
              loop
              playsInline
              preload="metadata"
              poster={image}
              onError={() => setVideoFailed(true)}
              aria-label={label + " demonstration"}
            />
            <button
              type="button"
              onClick={togglePlayback}
              className="absolute bottom-3 right-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/15 bg-[#07101f]/85 px-3 text-xs text-white backdrop-blur-md"
              aria-label={manualPause ? "Play demonstration" : "Pause demonstration"}
            >
              <CirclePlay size={15} />{manualPause || reduceMotion ? "Play" : "Pause"} clip
            </button>
          </>
        ) : children ? children : image ? (
          <img src={image} alt={imageAlt || label + " product illustration"} loading="lazy" className="block h-auto w-full object-cover" />
        ) : null}
        {!hasVideo && (
          <span className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/10 bg-[#07101f]/90 px-2 py-1 text-[10px] font-medium tracking-wide text-slate-300">
            Preview image · replace with product recording
          </span>
        )}
      </div>
    </div>
  );
}

function SampleLeaderboard() {
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
                transition={{ duration: 1.1, delay: index * 0.11, ease: easing }}
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

function SampleConversation() {
  return (
    <div className="grid min-h-[290px] grid-cols-[112px_1fr] text-xs sm:grid-cols-[165px_1fr]">
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
    { q: "Can I see how the dialer works?", a: "The preview above illustrates the dialer workflow. We are preparing short recordings from the actual application so new visitors can see the interface before signing up." },
    { q: "Where can I find current plans?", a: "Visit the Pricing page for the current plans and availability. We are intentionally not displaying unverified pricing or trial promises in this preview." },
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {entries.map((entry, i) => (
        <div key={entry.q} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
          <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-sm font-semibold text-white sm:text-base">
            {entry.q}<ChevronDown className={"shrink-0 text-slate-400 transition-transform " + (open === i ? "rotate-180" : "")} size={18} />
          </button>
          {open === i && <p className="px-6 pb-5 text-sm leading-7 text-slate-400">{entry.a}</p>}
        </div>
      ))}
    </div>
  );
}

const LandingPageV2: React.FC = () => {
  useEffect(() => {
    const oldTitle = document.title;
    document.title = "AgentFlow | Private Homepage V2 Preview";
    const existing = document.querySelector('meta[name="robots"]');
    const prior = existing?.getAttribute("content");
    const robots = existing || document.createElement("meta");
    robots.setAttribute("name", "robots");
    robots.setAttribute("content", "noindex, nofollow, noarchive");
    if (!existing) document.head.appendChild(robots);
    return () => {
      document.title = oldTitle;
      if (!existing) robots.remove();
      else if (prior !== null && prior !== undefined) robots.setAttribute("content", prior);
    };
  }, []);

  return (
    <div id="top" className="min-h-screen scroll-smooth bg-[#060c17] text-white selection:bg-sky-600/50">
      <div className="relative z-[60] border-b border-sky-400/20 bg-sky-950 px-4 py-2 text-center text-[11px] font-medium text-sky-200">
        <LockKeyhole className="mr-2 inline-block align-[-2px]" size={13} />
        Private V2 preview — not the live AgentFlow homepage
      </div>
      <TopNav />

      <main>
        <section className="relative overflow-hidden pb-16 pt-16 sm:pb-24 sm:pt-20 lg:pb-28">
          <div aria-hidden="true" className="pointer-events-none absolute -right-48 -top-64 h-[660px] w-[760px] rounded-full bg-sky-500/[0.11] blur-[115px]" />
          <div aria-hidden="true" className="pointer-events-none absolute -left-60 top-40 h-[540px] w-[600px] rounded-full bg-blue-800/20 blur-[115px]" />
          <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <Reveal>
              <SectionEyebrow>Made for life insurance agents</SectionEyebrow>
              <h1 className="mt-7 max-w-3xl text-5xl font-black leading-[1.06] tracking-[-0.05em] sm:text-6xl lg:text-[4.4rem]">
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
                    <span>Interface preview</span>
                  </div>
                  <img src="/test1/dashboard.png" alt="AgentFlow dashboard concept showing an insurance sales workspace" className="w-full rounded-xl border border-white/5" />
                </div>
                <div className="absolute -bottom-5 right-4 rounded-2xl border border-white/15 bg-[#11243a]/95 px-4 py-3 shadow-xl backdrop-blur sm:right-8">
                  <p className="flex items-center gap-2 text-xs font-semibold text-white"><ShieldCheck size={16} className="text-cyan-300" /> One connected workspace</p>
                  <p className="mt-1 text-[11px] text-slate-400">Dialing · Contacts · Reporting</p>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

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
            <p className="mt-6 text-xs text-slate-500">Product demo footage will be captured from AgentFlow using synthetic leads.</p>
          </Reveal>
          <Reveal className="lg:order-last">
            <DemoShell label="Dialer" image="/test1/dialer.png" imageAlt="AgentFlow dialer interface preview" videoSrc={MEDIA.dialer} />
          </Reveal>
        </section>

        <section id="leaderboard" className="scroll-mt-24 border-y border-white/10 bg-[#0a1525]">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:py-28">
            <Reveal className="lg:order-first">
              <DemoShell label="Leaderboard" videoSrc={MEDIA.leaderboard}><SampleLeaderboard /></DemoShell>
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
              <p className="mt-6 text-xs text-slate-500">The ranking illustration uses synthetic values; the final loop will show the actual interface.</p>
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
            <DemoShell label="Conversations" videoSrc={MEDIA.conversations}><SampleConversation /></DemoShell>
          </Reveal>
        </section>

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
                  <div className="h-full rounded-2xl border border-white/10 bg-[#0b1728] p-6 transition hover:-translate-y-1 hover:border-sky-400/30">
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

        <section className="px-5 pb-20 sm:px-8">
          <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[28px] border border-sky-400/25 bg-gradient-to-r from-[#102a50] via-[#0c3c62] to-[#122449] px-6 py-12 text-center sm:px-12 sm:py-16">
            <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-24 h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl" />
            <div className="relative">
              <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Ready to see what AgentFlow can do?</h2>
              <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-200">Bring your calls, contacts, conversations, and team workflow together.</p>
              <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                <Link to="/signup" className={primaryButton}>Get started <ArrowRight size={17} /></Link>
                <Link to="/pricing" className={outlineButton}>View pricing</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#040811] px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <img src="/agentflow-logo-full-on-dark.png" alt="AgentFlow" className="h-5 w-auto" />
            <p className="mt-3 text-xs text-slate-500">Life-insurance-focused CRM and dialing.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-5 text-xs text-slate-400">
            <Link to="/pricing" className="hover:text-white">Pricing</Link>
            <Link to="/privacy" className="hover:text-white">Privacy</Link>
            <Link to="/terms" className="hover:text-white">Terms</Link>
            <Link to="/contact" className="hover:text-white">Contact</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
};

export default LandingPageV2;
