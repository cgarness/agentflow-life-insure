import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, TrendingUp, Calendar, Users, Megaphone, Bot, Trophy, Settings,
  MessageSquare, GraduationCap, Shield, Upload, Palette, Clock, Zap,
  CheckCircle, ChevronDown, Play, Menu, X, Linkedin, Globe, Facebook,
} from "lucide-react";

/* ──────────────────────────────────────────────
   ANIMATION HELPERS
   ────────────────────────────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 },
};
const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};
const VP = { once: true, margin: "-100px" as any };

/* ──────────────────────────────────────────────
   AF LOGO COMPONENT
   ────────────────────────────────────────────── */
const AFLogo = ({ size = 36 }: { size?: number }) => (
  <div
    className="rounded-lg bg-primary flex items-center justify-center font-bold text-primary-foreground select-none"
    style={{ width: size, height: size, fontSize: size * 0.4 }}
  >
    AF
  </div>
);

/* ──────────────────────────────────────────────
   FLOATING ORBS
   ────────────────────────────────────────────── */
const Orb = ({ className, dur = 25 }: { className?: string; dur?: number }) => (
  <motion.div
    className={`absolute rounded-full blur-3xl pointer-events-none ${className}`}
    animate={{ x: [0, 40, -30, 0], y: [0, -30, 40, 0] }}
    transition={{ duration: dur, repeat: Infinity, ease: "linear" }}
  />
);

/* ──────────────────────────────────────────────
   SHIMMER BADGE
   ────────────────────────────────────────────── */
const ShimmerBadge = ({ children }: { children: React.ReactNode }) => (
  <span className="relative inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary overflow-hidden">
    <span className="relative z-10">{children}</span>
    <span className="absolute inset-0 -translate-x-full animate-[shimmer_3s_infinite] bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
  </span>
);

/* ──────────────────────────────────────────────
   SECTION WRAPPER
   ────────────────────────────────────────────── */
const Section = ({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <section id={id} className={`py-20 md:py-24 ${className}`}>
    <div className="max-w-7xl mx-auto px-6">{children}</div>
  </section>
);

/* ──────────────────────────────────────────────
   NAV LINKS DATA
   ────────────────────────────────────────────── */
const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "Testimonials", href: "#testimonials" },
  { label: "FAQ", href: "#faq" },
];

const scrollTo = (href: string) => {
  const el = document.querySelector(href);
  el?.scrollIntoView({ behavior: "smooth" });
};

/* ══════════════════════════════════════════════
   LANDING PAGE
   ══════════════════════════════════════════════ */
const LandingPage: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden scroll-smooth">
      {/* ── SHIMMER KEYFRAME (injected once) ── */}
      <style>{`@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}`}</style>

      {/* ════════════════════════════════════════
          SECTION 1 — STICKY NAVBAR
         ════════════════════════════════════════ */}
      <header className="fixed top-0 inset-x-0 z-50 backdrop-blur-xl bg-background/70 border-b border-border/40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Left – Logo */}
          <Link to="/landing" className="flex items-center gap-2.5">
            <AFLogo />
            <span className="font-bold text-lg text-foreground">AgentFlow</span>
          </Link>

          {/* Center – Desktop nav */}
          <nav className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map((l) => (
              <button
                key={l.href}
                onClick={() => scrollTo(l.href)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-200"
              >
                {l.label}
              </button>
            ))}
          </nav>

          {/* Right – CTA */}
          <div className="hidden md:flex items-center gap-4">
            <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Log In
            </Link>
            <Link
              to="/login"
              className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center shadow-[0_0_20px_hsl(var(--primary)/0.3)] hover:shadow-[0_0_30px_hsl(var(--primary)/0.45)] hover:scale-105 transition-all duration-200"
            >
              Start Free Trial
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button className="md:hidden text-foreground" onClick={() => setMobileMenuOpen(true)}>
            <Menu size={24} />
          </button>
        </div>

        {/* Mobile overlay */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-8"
            >
              <button
                className="absolute top-5 right-6 text-foreground"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X size={28} />
              </button>
              {NAV_LINKS.map((l) => (
                <button
                  key={l.href}
                  className="text-xl font-medium text-foreground"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setTimeout(() => scrollTo(l.href), 200);
                  }}
                >
                  {l.label}
                </button>
              ))}
              <Link
                to="/login"
                className="h-12 px-8 rounded-xl bg-primary text-primary-foreground text-base font-semibold flex items-center"
                onClick={() => setMobileMenuOpen(false)}
              >
                Start Free Trial
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* ════════════════════════════════════════
          SECTION 2 — HERO
         ════════════════════════════════════════ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center pt-16 overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.05)_0%,transparent_70%)]" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg,transparent,transparent 59px,hsl(var(--border)) 59px,hsl(var(--border)) 60px),repeating-linear-gradient(90deg,transparent,transparent 59px,hsl(var(--border)) 59px,hsl(var(--border)) 60px)",
          }}
        />
        <Orb className="w-[400px] h-[400px] bg-primary/10 -top-40 -left-40" dur={25} />
        <Orb className="w-[350px] h-[350px] bg-accent/10 top-1/3 -right-32" dur={30} />
        <Orb className="w-[300px] h-[300px] bg-primary/5 bottom-20 left-1/4" dur={22} />

        {/* Content */}
        <motion.div
          className="relative z-10 text-center max-w-4xl mx-auto px-6"
          initial="hidden"
          animate="visible"
          variants={stagger}
        >
          <motion.div variants={fadeUp} transition={{ duration: 0.6 }}>
            <ShimmerBadge>Built for Life Insurance Professionals</ShimmerBadge>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mt-6 text-3xl md:text-5xl font-extrabold leading-tight bg-gradient-to-r from-foreground via-primary to-foreground bg-clip-text text-transparent"
          >
            The All-in-One CRM That Closes More Policies
          </motion.h1>

          <motion.p
            variants={fadeUp}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto"
          >
            Power dialer. AI agents. Smart campaigns. Real-time leaderboards.
            Everything your team needs to prospect, connect, and convert — in one platform.
          </motion.p>

          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link
              to="/login"
              className="h-12 px-8 rounded-xl bg-primary text-primary-foreground text-base font-semibold flex items-center hover:scale-105 shadow-[0_0_24px_hsl(var(--primary)/0.3)] transition-all duration-200"
            >
              Start Free Trial
            </Link>
            <button className="h-12 px-8 rounded-xl border border-border text-foreground text-base font-semibold flex items-center gap-2 hover:bg-muted/50 transition-all duration-200">
              <Play size={18} /> Watch Demo
            </button>
          </motion.div>

          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-6 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground"
          >
            {["No credit card required", "14-day free trial", "Cancel anytime"].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <CheckCircle size={14} className="text-primary" /> {t}
              </span>
            ))}
          </motion.div>
        </motion.div>

        {/* Hero visual mock */}
        <motion.div
          className="relative z-10 mt-16 w-full max-w-5xl mx-auto px-6"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={VP}
        >
          <div className="rounded-2xl border border-border/50 bg-card/50 backdrop-blur shadow-2xl overflow-hidden">
            {/* Title bar */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
              <span className="w-3 h-3 rounded-full bg-destructive/60" />
              <span className="w-3 h-3 rounded-full bg-warning/60" />
              <span className="w-3 h-3 rounded-full bg-success/60" />
              <span className="flex-1 text-center text-xs text-muted-foreground">AgentFlow Dashboard</span>
            </div>

            <div className="flex">
              {/* Sidebar mock */}
              <div className="hidden sm:flex flex-col gap-2 p-3 w-44 border-r border-border/20 bg-muted/20">
                {[40, 36, 44, 32, 40, 28].map((w, i) => (
                  <div key={i} className="h-3 rounded bg-muted-foreground/10" style={{ width: `${w}%` }} />
                ))}
              </div>

              {/* Main area */}
              <div className="flex-1 p-4 md:p-6 space-y-5">
                {/* Stat cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { Icon: Phone, value: "1,247", label: "Calls Today" },
                    { Icon: TrendingUp, value: "89", label: "Policies This Month" },
                    { Icon: Calendar, value: "34", label: "Appointments" },
                    { Icon: Users, value: "12", label: "Active Agents" },
                  ].map(({ Icon, value, label }) => (
                    <div key={label} className="rounded-lg bg-muted/20 p-3 md:p-4">
                      <Icon size={16} className="text-primary mb-2" />
                      <div className="text-lg md:text-xl font-bold text-foreground">{value}</div>
                      <div className="text-[10px] md:text-xs text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>

                {/* Chart mock */}
                <div className="rounded-lg bg-muted/10 p-4 h-36 md:h-48 relative">
                  {[0.25, 0.5, 0.75].map((y) => (
                    <div
                      key={y}
                      className="absolute left-0 right-0 border-t border-border/10"
                      style={{ top: `${y * 100}%` }}
                    />
                  ))}
                  <svg viewBox="0 0 400 120" className="w-full h-full" preserveAspectRatio="none">
                    <polyline
                      points="0,90 50,70 100,80 150,40 200,55 250,30 300,45 350,20 400,35"
                      fill="none"
                      stroke="hsl(var(--primary))"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Fade-to-background overlay */}
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        </motion.div>
      </section>

      {/* ════════════════════════════════════════
          SECTION 3 — SOCIAL PROOF / LOGO BAR
         ════════════════════════════════════════ */}
      <Section>
        <p className="text-sm text-muted-foreground text-center mb-6">
          Trusted by agencies and IMOs nationwide
        </p>
        <div className="overflow-hidden relative group">
          <div className="flex gap-6 animate-[marquee_40s_linear_infinite] group-hover:[animation-play-state:paused] w-max">
            {[...Array(2)].flatMap((_, setIdx) =>
              [
                "Pacific Life Partners",
                "Summit Financial Group",
                "Cornerstone Insurance",
                "Heritage Benefits",
                "Pinnacle IMO",
                "BlueShield Advisors",
              ].map((name, i) => (
                <div
                  key={`${setIdx}-${i}`}
                  className="shrink-0 rounded-lg px-6 py-3 bg-muted/10 border border-border/30 font-semibold text-sm text-muted-foreground/60 whitespace-nowrap"
                >
                  {name}
                </div>
              ))
            )}
          </div>
        </div>
        <style>{`@keyframes marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}`}</style>
      </Section>

      {/* ════════════════════════════════════════
          SECTION 4 — FEATURE HIGHLIGHTS
         ════════════════════════════════════════ */}
      <Section id="features">
        <motion.div
          className="text-center mb-14"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={stagger}
        >
          <motion.h2 variants={fadeUp} className="text-3xl font-bold">
            Everything You Need to Sell Smarter
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-3 text-muted-foreground max-w-xl mx-auto">
            From first dial to signed policy — AgentFlow handles the entire workflow.
          </motion.p>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={stagger}
        >
          {[
            {
              Icon: Phone,
              bg: "bg-primary/10",
              title: "Power Dialer",
              desc: "Preview, progressive, and predictive dial modes. Click-to-call, voicemail drop, and automated disposition logging — all in one seamless session.",
            },
            {
              Icon: Megaphone,
              bg: "bg-accent/10",
              title: "Smart Campaigns",
              desc: "Build targeted outbound campaigns with lead pools, round-robin assignment, and real-time progress tracking. Open pool and assigned modes keep every agent busy.",
            },
            {
              Icon: Bot,
              bg: "bg-primary/10",
              title: "AI-Powered Agents",
              desc: "Deploy virtual agents that qualify leads, book appointments, and follow up via voice, SMS, and email — 24/7, on autopilot.",
            },
            {
              Icon: Users,
              bg: "bg-success/10",
              title: "360° Contact Management",
              desc: "Leads, clients, recruits, and agents — all in one place. Full activity timeline, call logs, notes, appointment history, and local time display for every contact.",
            },
            {
              Icon: Calendar,
              bg: "bg-warning/10",
              title: "Calendar & Scheduling",
              desc: "Day, week, and agenda views with drag-and-drop. One-click confirm via text or email, contact mini-cards, and two-way sync with your contacts.",
            },
            {
              Icon: Trophy,
              bg: "bg-destructive/10",
              title: "Leaderboard & Analytics",
              desc: "Real-time agent rankings, conversion tracking, talk-time stats, and exportable reports. Gamify performance and see who's crushing it.",
            },
          ].map(({ Icon, bg, title, desc }, i) => (
            <motion.div
              key={title}
              variants={fadeUp}
              transition={{ delay: i * 0.08 }}
              className="group rounded-2xl bg-card/50 border border-border/50 p-6 hover:border-primary/30 hover:-translate-y-1 transition-all duration-300"
            >
              <div className={`inline-flex p-3 rounded-xl ${bg} mb-4`}>
                <Icon size={22} className="text-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* ════════════════════════════════════════
          SECTION 5 — PRODUCT SHOWCASE (ALTERNATING)
         ════════════════════════════════════════ */}
      {/* Row 1 – Dialer */}
      <Section>
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
          <motion.div
            className="max-w-lg"
            initial="hidden"
            whileInView="visible"
            viewport={VP}
            variants={stagger}
          >
            <motion.span variants={fadeUp} className="text-xs font-semibold tracking-widest text-primary uppercase">
              DIALER
            </motion.span>
            <motion.h3 variants={fadeUp} className="mt-3 text-2xl font-bold">
              Call Smarter, Not Harder
            </motion.h3>
            <motion.p variants={fadeUp} className="mt-4 text-muted-foreground leading-relaxed">
              Preview each lead before dialing. Drop pre-recorded voicemails with one click. Log
              dispositions instantly. AgentFlow's power dialer eliminates busywork so your agents can
              focus on conversations that close.
            </motion.p>
            <motion.ul variants={fadeUp} className="mt-6 space-y-3">
              {[
                "Preview, progressive & predictive modes",
                "One-click voicemail drop",
                "Auto-disposition after every call",
                "Live call transfer to team leaders",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2 text-sm">
                  <CheckCircle size={16} className="text-primary mt-0.5 shrink-0" /> {t}
                </li>
              ))}
            </motion.ul>
          </motion.div>

          <motion.div
            className="flex-1 w-full max-w-md"
            initial={{ opacity: 0, x: 60 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7 }}
            viewport={VP}
          >
            <div className="rounded-2xl border border-border/50 bg-card/50 backdrop-blur p-6 shadow-xl">
              <p className="text-xs text-muted-foreground mb-1">Calling</p>
              <p className="text-lg font-semibold mb-6">James Morrison</p>
              <div className="flex justify-center mb-4">
                <span className="text-sm text-muted-foreground font-mono">02:34</span>
              </div>
              <div className="flex justify-center mb-8">
                <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center shadow-[0_0_30px_hsl(var(--primary)/0.4)]">
                  <Phone size={28} className="text-primary-foreground" />
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {["Interested", "Not Home", "DNC", "Callback"].map((d) => (
                  <span key={d} className="px-3 py-1.5 rounded-full bg-muted/30 text-xs font-medium text-muted-foreground">
                    {d}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </Section>

      {/* Row 2 – AI Agents */}
      <Section>
        <div className="flex flex-col lg:flex-row-reverse items-center gap-12 lg:gap-20">
          <motion.div
            className="max-w-lg"
            initial="hidden"
            whileInView="visible"
            viewport={VP}
            variants={stagger}
          >
            <motion.span variants={fadeUp} className="text-xs font-semibold tracking-widest text-primary uppercase">
              AI AGENTS
            </motion.span>
            <motion.h3 variants={fadeUp} className="mt-3 text-2xl font-bold">
              Your Virtual Sales Team, Always On
            </motion.h3>
            <motion.p variants={fadeUp} className="mt-4 text-muted-foreground leading-relaxed">
              Build AI agents with custom identities, instructions, and multi-step workflows. Sarah
              books appointments via voice. Mike qualifies leads over SMS. They work your campaigns
              around the clock while your human agents focus on high-value conversations.
            </motion.p>
            <motion.ul variants={fadeUp} className="mt-6 space-y-3">
              {[
                "Custom voice, SMS & email agents",
                "Visual workflow builder",
                "Campaign auto-assignment",
                "Full conversation logging",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2 text-sm">
                  <CheckCircle size={16} className="text-primary mt-0.5 shrink-0" /> {t}
                </li>
              ))}
            </motion.ul>
          </motion.div>

          <motion.div
            className="flex-1 w-full max-w-md"
            initial={{ opacity: 0, x: -60 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7 }}
            viewport={VP}
          >
            <div className="rounded-2xl border border-border/50 bg-card/50 backdrop-blur p-6 shadow-xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                  S
                </div>
                <div>
                  <p className="font-semibold text-sm">Sarah — AI Agent</p>
                  <span className="inline-flex items-center gap-1 text-[10px] text-success font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-success" /> Active
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { icon: Users, label: "New Lead Assigned" },
                  { icon: MessageSquare, label: "Send Intro SMS" },
                  { icon: Calendar, label: "Book Appointment" },
                ].map(({ icon: I, label }, i) => (
                  <React.Fragment key={label}>
                    <div className="flex items-center gap-3 rounded-lg bg-muted/20 px-4 py-3">
                      <I size={16} className="text-primary shrink-0" />
                      <span className="text-sm">{label}</span>
                    </div>
                    {i < 2 && (
                      <div className="flex justify-center">
                        <div className="w-px h-4 bg-border" />
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </Section>

      {/* Row 3 – Analytics */}
      <Section>
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
          <motion.div
            className="max-w-lg"
            initial="hidden"
            whileInView="visible"
            viewport={VP}
            variants={stagger}
          >
            <motion.span variants={fadeUp} className="text-xs font-semibold tracking-widest text-primary uppercase">
              ANALYTICS
            </motion.span>
            <motion.h3 variants={fadeUp} className="mt-3 text-2xl font-bold">
              See Everything. Miss Nothing.
            </motion.h3>
            <motion.p variants={fadeUp} className="mt-4 text-muted-foreground leading-relaxed">
              Track every call, policy, and appointment across your entire team. Real-time
              leaderboards drive healthy competition. Exportable reports give leadership the data they
              need to make smart decisions.
            </motion.p>
            <motion.ul variants={fadeUp} className="mt-6 space-y-3">
              {[
                "Real-time agent leaderboards",
                "Conversion & talk-time tracking",
                "CSV & PDF report exports",
                "Role-based data access",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2 text-sm">
                  <CheckCircle size={16} className="text-primary mt-0.5 shrink-0" /> {t}
                </li>
              ))}
            </motion.ul>
          </motion.div>

          <motion.div
            className="flex-1 w-full max-w-md"
            initial={{ opacity: 0, x: 60 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7 }}
            viewport={VP}
          >
            <div className="rounded-2xl border border-border/50 bg-card/50 backdrop-blur p-6 shadow-xl">
              <p className="text-xs text-muted-foreground mb-4 font-medium">Leaderboard — This Month</p>
              {[
                { rank: 1, name: "Sarah M.", pct: 90 },
                { rank: 2, name: "Mike R.", pct: 75 },
                { rank: 3, name: "Jessica C.", pct: 60 },
              ].map(({ rank, name, pct }) => (
                <div key={rank} className="flex items-center gap-3 mb-3 last:mb-0">
                  <span className="text-sm font-bold text-muted-foreground w-5 text-right">{rank}</span>
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                    {name[0]}
                  </div>
                  <span className="text-sm font-medium w-20 truncate">{name}</span>
                  <div className="flex-1 h-3 bg-muted/20 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  {rank === 1 && <Trophy size={14} className="text-warning shrink-0" />}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </Section>

      {/* ════════════════════════════════════════
          SECTION 6 — ADDITIONAL CAPABILITIES
         ════════════════════════════════════════ */}
      <Section>
        <motion.div className="text-center mb-12" initial="hidden" whileInView="visible" viewport={VP} variants={stagger}>
          <motion.h2 variants={fadeUp} className="text-2xl font-bold">And That's Just the Start</motion.h2>
          <motion.p variants={fadeUp} className="mt-3 text-muted-foreground">
            AgentFlow is packed with tools designed specifically for life insurance sales teams.
          </motion.p>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={stagger}
        >
          {[
            { Icon: MessageSquare, label: "Conversations Hub" },
            { Icon: GraduationCap, label: "Training Center" },
            { Icon: Settings, label: "Role-Based Permissions" },
            { Icon: Shield, label: "DNC List Manager" },
            { Icon: Upload, label: "CSV Bulk Import" },
            { Icon: Palette, label: "Company Branding" },
            { Icon: Clock, label: "Business Hours Config" },
            { Icon: Zap, label: "Automation Rules" },
          ].map(({ Icon, label }, i) => (
            <motion.div
              key={label}
              variants={fadeUp}
              transition={{ delay: i * 0.05 }}
              className="rounded-xl bg-card/30 border border-border/30 p-4 flex items-center gap-3"
            >
              <Icon size={20} className="text-muted-foreground shrink-0" />
              <span className="text-sm font-medium">{label}</span>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* ════════════════════════════════════════
          SECTION 7 — PRICING
         ════════════════════════════════════════ */}
      <Section id="pricing">
        <motion.div className="text-center mb-14" initial="hidden" whileInView="visible" viewport={VP} variants={stagger}>
          <motion.h2 variants={fadeUp} className="text-3xl font-bold">Simple, Transparent Pricing</motion.h2>
          <motion.p variants={fadeUp} className="mt-3 text-muted-foreground max-w-lg mx-auto">
            No per-minute charges. No hidden fees. Just one plan that scales with your team.
          </motion.p>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-5xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={stagger}
        >
          {[
            {
              name: "Starter",
              price: "$49",
              sub: "/mo per agent",
              tagline: "For solo agents getting started",
              features: ["Up to 2 agents", "Power dialer", "Contact management", "Calendar", "Basic reports"],
              cta: "Get Started",
              primary: false,
              popular: false,
            },
            {
              name: "Professional",
              price: "$99",
              sub: "/mo per agent",
              tagline: "For growing teams that need more",
              features: [
                "Everything in Starter, plus:",
                "AI Agents (up to 3)",
                "Smart campaigns",
                "Leaderboard",
                "Advanced reports",
                "CSV import/export",
              ],
              cta: "Start Free Trial",
              primary: true,
              popular: true,
            },
            {
              name: "Enterprise",
              price: "Custom",
              sub: "",
              tagline: "For large agencies and IMOs",
              features: [
                "Everything in Professional, plus:",
                "Unlimited AI agents",
                "Custom integrations",
                "Dedicated support",
                "SLA guarantee",
                "SSO & advanced security",
              ],
              cta: "Contact Sales",
              primary: false,
              popular: false,
            },
          ].map((plan) => (
            <motion.div
              key={plan.name}
              variants={fadeUp}
              className={`relative rounded-2xl bg-card border p-8 flex flex-col hover:-translate-y-1 transition-all duration-300 ${
                plan.popular
                  ? "border-primary scale-[1.03] shadow-[0_0_40px_hsl(var(--primary)/0.15)]"
                  : "border-border"
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-semibold px-4 py-1 rounded-full">
                  Most Popular
                </span>
              )}
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-bold">{plan.price}</span>
                {plan.sub && <span className="text-sm text-muted-foreground">{plan.sub}</span>}
              </div>
              <p className="text-sm text-muted-foreground mt-2">{plan.tagline}</p>
              <ul className="mt-6 space-y-3 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <CheckCircle size={14} className="text-primary mt-0.5 shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              <Link
                to="/login"
                className={`mt-8 h-11 rounded-xl flex items-center justify-center font-semibold text-sm transition-all duration-200 ${
                  plan.primary
                    ? "bg-primary text-primary-foreground shadow-[0_0_20px_hsl(var(--primary)/0.3)] hover:shadow-[0_0_30px_hsl(var(--primary)/0.45)] hover:scale-105"
                    : "border border-border text-foreground hover:bg-muted/50"
                }`}
              >
                {plan.cta}
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* ════════════════════════════════════════
          SECTION 8 — TESTIMONIALS
         ════════════════════════════════════════ */}
      <Section id="testimonials">
        <motion.h2
          className="text-3xl font-bold text-center mb-14"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={fadeUp}
        >
          Hear From Agencies Like Yours
        </motion.h2>

        <motion.div
          className="grid grid-cols-1 lg:grid-cols-3 gap-6"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={stagger}
        >
          {[
            {
              quote:
                "AgentFlow cut our lead response time in half. The power dialer alone pays for itself every month.",
              name: "Maria Santos",
              title: "Agency Director, Summit Financial Group",
              initials: "MS",
            },
            {
              quote:
                "The AI agents are a game-changer. We book 30% more appointments without adding headcount.",
              name: "David Park",
              title: "IMO Owner, Pacific Life Partners",
              initials: "DP",
            },
            {
              quote:
                "Finally, a CRM that actually understands life insurance sales. The leaderboard keeps my team fired up every single day.",
              name: "Rachel Kim",
              title: "Team Leader, Heritage Benefits",
              initials: "RK",
            },
          ].map(({ quote, name, title, initials }) => (
            <motion.div
              key={name}
              variants={fadeUp}
              className="rounded-2xl bg-card/50 border border-border/50 p-6"
            >
              <span className="text-4xl text-primary/20 font-serif leading-none">"</span>
              <p className="text-sm text-muted-foreground italic mt-2 leading-relaxed">{quote}</p>
              <div className="flex items-center gap-3 mt-6">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                  {initials}
                </div>
                <div>
                  <p className="text-sm font-semibold">{name}</p>
                  <p className="text-xs text-muted-foreground">{title}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* ════════════════════════════════════════
          SECTION 9 — FAQ ACCORDION
         ════════════════════════════════════════ */}
      <Section id="faq">
        <motion.h2
          className="text-3xl font-bold text-center mb-14"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={fadeUp}
        >
          Frequently Asked Questions
        </motion.h2>

        <div className="max-w-3xl mx-auto space-y-3">
          {[
            {
              q: "Is AgentFlow built specifically for life insurance?",
              a: "Yes. Every feature — from disposition categories to carrier tracking to policy management — is designed specifically for life insurance agents, team leaders, and IMOs.",
            },
            {
              q: "Can I import my existing leads?",
              a: "Absolutely. AgentFlow supports CSV bulk import with field mapping, duplicate detection, and import history tracking.",
            },
            {
              q: "How do the AI agents work?",
              a: "You create an AI agent with a name, personality, and instructions. Then you assign it to campaigns. It handles outreach via voice, SMS, or email, qualifies leads, and books appointments — all automatically.",
            },
            {
              q: "Is there a limit on calls?",
              a: "No per-minute charges and no call limits on any plan. Your team can dial as much as they need.",
            },
            {
              q: "Can I control what my agents see?",
              a: "Yes. AgentFlow has granular role-based permissions. Admins, Team Leaders, and Agents each have configurable page access, feature permissions, and data access scopes.",
            },
            {
              q: "How long does setup take?",
              a: "Most teams are up and running in under 30 minutes. Import your leads, configure your dispositions, and start dialing.",
            },
          ].map(({ q, a }, i) => (
            <motion.div
              key={i}
              initial="hidden"
              whileInView="visible"
              viewport={VP}
              variants={fadeUp}
              className="rounded-xl border border-border/50 overflow-hidden"
            >
              <button
                className="w-full flex items-center justify-between px-5 py-4 text-left font-medium text-sm hover:bg-muted/30 transition-colors"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                {q}
                <ChevronDown
                  size={18}
                  className={`shrink-0 text-muted-foreground transition-transform duration-200 ${
                    openFaq === i ? "rotate-180" : ""
                  }`}
                />
              </button>
              <AnimatePresence initial={false}>
                {openFaq === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <p className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed">{a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ════════════════════════════════════════
          SECTION 10 — FINAL CTA
         ════════════════════════════════════════ */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-accent/10" />
        <Orb className="w-[350px] h-[350px] bg-primary/10 -top-20 right-0" dur={28} />
        <Orb className="w-[300px] h-[300px] bg-accent/10 bottom-0 -left-20" dur={24} />

        <motion.div
          className="relative z-10 max-w-3xl mx-auto px-6 text-center"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={stagger}
        >
          <motion.h2
            variants={fadeUp}
            className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-foreground via-primary to-foreground bg-clip-text text-transparent"
          >
            Ready to Close More Policies?
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-lg text-muted-foreground">
            Join hundreds of agencies using AgentFlow to sell smarter.
          </motion.p>
          <motion.div variants={fadeUp} className="mt-8">
            <Link
              to="/login"
              className="inline-flex h-14 px-10 rounded-xl bg-primary text-primary-foreground text-lg font-semibold items-center hover:scale-105 shadow-[0_0_30px_hsl(var(--primary)/0.35)] transition-all duration-200"
            >
              Start Your Free Trial
            </Link>
          </motion.div>
          <motion.p variants={fadeUp} className="mt-5 text-sm text-muted-foreground flex items-center justify-center gap-4 flex-wrap">
            <span className="flex items-center gap-1.5"><CheckCircle size={14} className="text-primary" /> No credit card required</span>
            <span className="flex items-center gap-1.5"><CheckCircle size={14} className="text-primary" /> Setup in under 30 minutes</span>
          </motion.p>
        </motion.div>
      </section>

      {/* ════════════════════════════════════════
          SECTION 11 — FOOTER
         ════════════════════════════════════════ */}
      <footer className="bg-card/50 border-t border-border/50 py-12 px-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <AFLogo size={32} />
              <span className="font-bold text-lg">AgentFlow</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              The all-in-one CRM for life insurance professionals.
            </p>
            <div className="flex gap-3">
              {[Globe, Linkedin, Facebook].map((I, idx) => (
                <button key={idx} className="w-8 h-8 rounded-lg bg-muted/20 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                  <I size={16} />
                </button>
              ))}
            </div>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-semibold text-sm mb-4">Product</h4>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              {["Features", "Pricing", "AI Agents", "Integrations", "Changelog"].map((l) => (
                <li key={l}><button onClick={() => scrollTo("#features")} className="hover:text-foreground transition-colors">{l}</button></li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="font-semibold text-sm mb-4">Company</h4>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              {["About", "Blog", "Careers", "Contact", "Partners"].map((l) => (
                <li key={l}><span className="hover:text-foreground transition-colors cursor-pointer">{l}</span></li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold text-sm mb-4">Legal</h4>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              {["Privacy Policy", "Terms of Service", "Security", "TCPA Compliance", "DNC Policy"].map((l) => (
                <li key={l}><span className="hover:text-foreground transition-colors cursor-pointer">{l}</span></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="max-w-7xl mx-auto mt-10 pt-6 border-t border-border/30 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">© 2026 AgentFlow. All rights reserved.</p>
          <p className="text-xs text-muted-foreground">Made with ❤️ for life insurance agents</p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
