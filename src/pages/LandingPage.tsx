import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, TrendingUp, Calendar, Users, Megaphone, Bot, Trophy,
  MessageSquare, GraduationCap, Shield, Upload, Palette, Clock, Zap,
  CheckCircle, ChevronDown, Play,
} from "lucide-react";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

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
const VP = { once: true, margin: "-100px" as const };

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

/* ══════════════════════════════════════════════
   LANDING PAGE
   ══════════════════════════════════════════════ */
const LandingPage: React.FC = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden scroll-smooth">
      {/* ── SHIMMER KEYFRAME (injected once) ── */}
      <style>{`@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}`}</style>

      {/* ════════════════════════════════════════
          SECTION 1 — STICKY NAVBAR
         ════════════════════════════════════════ */}
      <MarketingNav />

      {/* ════════════════════════════════════════
          SECTION 2 — HERO
         ════════════════════════════════════════ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center pt-24 md:pt-28 overflow-hidden">
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
              bg: "bg-primary/10",
              title: "360° Contact Management",
              desc: "Leads, clients, recruits, and agents — all in one place. Full activity timeline, call logs, notes, appointment history, and local time display for every contact.",
            },
            {
              Icon: Calendar,
              bg: "bg-accent/10",
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
              transition={{ delay: i * 0.05 }}
              className="rounded-2xl bg-card/50 border border-border/50 p-6 hover:border-primary/30 hover:-translate-y-1 transition-all duration-300"
            >
              <div className={`inline-flex p-3 rounded-xl ${bg} mb-4`}>
                <Icon size={22} className="text-foreground" />
              </div>
              <h3 className="font-semibold text-lg mb-2">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* ════════════════════════════════════════
          SECTION 5 — PRODUCT SHOWCASE (3 ROWS)
         ════════════════════════════════════════ */}
      {/* Row 1 — Dialer */}
      <Section>
        <div className="flex flex-col lg:flex-row items-center gap-12">
          {/* Text */}
          <motion.div
            className="lg:w-1/2 space-y-5"
            initial="hidden"
            whileInView="visible"
            viewport={VP}
            variants={stagger}
          >
            <motion.span variants={fadeUp} className="text-xs font-semibold tracking-widest text-primary uppercase">
              Dialer
            </motion.span>
            <motion.h3 variants={fadeUp} className="text-2xl font-bold">
              Call Smarter, Not Harder
            </motion.h3>
            <motion.p variants={fadeUp} className="text-muted-foreground leading-relaxed">
              Preview each lead before dialing. Drop pre-recorded voicemails with one click. Log dispositions
              instantly. AgentFlow's power dialer eliminates busywork so your agents can focus on conversations
              that close.
            </motion.p>
            <motion.ul variants={stagger} className="space-y-2">
              {[
                "Preview, progressive & predictive modes",
                "One-click voicemail drop",
                "Auto-disposition after every call",
                "Live call transfer to team leaders",
              ].map((t) => (
                <motion.li key={t} variants={fadeUp} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle size={16} className="text-primary shrink-0" /> {t}
                </motion.li>
              ))}
            </motion.ul>
          </motion.div>

          {/* Visual */}
          <motion.div
            className="lg:w-1/2"
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            viewport={VP}
          >
            <div className="rounded-2xl border border-border/50 bg-card/50 p-6 text-center">
              <p className="text-sm text-muted-foreground mb-4">James Morrison</p>
              <div className="w-20 h-20 mx-auto rounded-full bg-primary flex items-center justify-center mb-4">
                <Phone size={32} className="text-primary-foreground" />
              </div>
              <p className="text-xl font-mono mb-4">02:34</p>
              <div className="flex flex-wrap justify-center gap-2">
                {["Interested", "Not Home", "DNC", "Callback"].map((d) => (
                  <span key={d} className="text-xs rounded-full border border-border px-3 py-1 text-muted-foreground">
                    {d}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </Section>

      {/* Row 2 — AI Agents */}
      <Section>
        <div className="flex flex-col lg:flex-row-reverse items-center gap-12">
          {/* Text */}
          <motion.div
            className="lg:w-1/2 space-y-5"
            initial="hidden"
            whileInView="visible"
            viewport={VP}
            variants={stagger}
          >
            <motion.span variants={fadeUp} className="text-xs font-semibold tracking-widest text-primary uppercase">
              AI Agents
            </motion.span>
            <motion.h3 variants={fadeUp} className="text-2xl font-bold">
              Your Virtual Sales Team, Always On
            </motion.h3>
            <motion.p variants={fadeUp} className="text-muted-foreground leading-relaxed">
              Build AI agents with custom identities, instructions, and multi-step workflows. Sarah books
              appointments via voice. Mike qualifies leads over SMS. They work your campaigns around the clock
              while your human agents focus on high-value conversations.
            </motion.p>
            <motion.ul variants={stagger} className="space-y-2">
              {[
                "Custom voice, SMS & email agents",
                "Visual workflow builder",
                "Campaign auto-assignment",
                "Full conversation logging",
              ].map((t) => (
                <motion.li key={t} variants={fadeUp} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle size={16} className="text-primary shrink-0" /> {t}
                </motion.li>
              ))}
            </motion.ul>
          </motion.div>

          {/* Visual */}
          <motion.div
            className="lg:w-1/2"
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            viewport={VP}
          >
            <div className="rounded-2xl border border-border/50 bg-card/50 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center font-semibold text-primary">
                  S
                </div>
                <div>
                  <p className="font-medium text-sm">Sarah</p>
                  <span className="text-xs text-primary">● Active</span>
                </div>
              </div>
              <div className="space-y-3">
                {["New Lead", "Send SMS", "Book Appointment"].map((s, i) => (
                  <React.Fragment key={s}>
                    <div className="rounded-lg bg-muted/20 px-4 py-2 text-sm text-muted-foreground">{s}</div>
                    {i < 2 && <div className="w-0.5 h-4 bg-border mx-auto" />}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </Section>

      {/* Row 3 — Analytics */}
      <Section>
        <div className="flex flex-col lg:flex-row items-center gap-12">
          {/* Text */}
          <motion.div
            className="lg:w-1/2 space-y-5"
            initial="hidden"
            whileInView="visible"
            viewport={VP}
            variants={stagger}
          >
            <motion.span variants={fadeUp} className="text-xs font-semibold tracking-widest text-primary uppercase">
              Analytics
            </motion.span>
            <motion.h3 variants={fadeUp} className="text-2xl font-bold">
              See Everything. Miss Nothing.
            </motion.h3>
            <motion.p variants={fadeUp} className="text-muted-foreground leading-relaxed">
              Track every call, policy, and appointment across your entire team. Real-time leaderboards drive
              healthy competition. Exportable reports give leadership the data they need to make smart decisions.
            </motion.p>
            <motion.ul variants={stagger} className="space-y-2">
              {[
                "Real-time agent leaderboards",
                "Conversion & talk-time tracking",
                "CSV & PDF report exports",
                "Role-based data access",
              ].map((t) => (
                <motion.li key={t} variants={fadeUp} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle size={16} className="text-primary shrink-0" /> {t}
                </motion.li>
              ))}
            </motion.ul>
          </motion.div>

          {/* Visual */}
          <motion.div
            className="lg:w-1/2"
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            viewport={VP}
          >
            <div className="rounded-2xl border border-border/50 bg-card/50 p-6 space-y-3">
              {[
                { rank: 1, name: "Maria S.", pct: 90 },
                { rank: 2, name: "David P.", pct: 75 },
                { rank: 3, name: "Rachel K.", pct: 60 },
              ].map(({ rank, name, pct }) => (
                <div key={rank} className="flex items-center gap-3">
                  <span className="w-6 text-center font-bold text-sm">{rank}</span>
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary">
                    {name.charAt(0)}
                  </div>
                  <span className="text-sm font-medium w-20">{name}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted/20 overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  {rank === 1 && <Trophy size={16} className="text-primary" />}
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
        <motion.div
          className="text-center mb-10"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={fadeUp}
        >
          <h2 className="text-2xl font-bold">And That's Just the Start</h2>
          <p className="mt-2 text-muted-foreground">
            AgentFlow is packed with tools designed specifically for life insurance sales teams.
          </p>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={stagger}
        >
          {[
            { Icon: MessageSquare, label: "Conversations Hub" },
            { Icon: GraduationCap, label: "Training Center" },
            { Icon: Shield, label: "Role-Based Permissions" },
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
        <motion.div
          className="text-center mb-14"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={fadeUp}
        >
          <h2 className="text-3xl font-bold">Simple, Transparent Pricing</h2>
          <p className="mt-2 text-muted-foreground">
            No per-minute charges. No hidden fees. Just one plan that scales with your team.
          </p>
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
              desc: "For solo agents getting started",
              features: ["Up to 2 agents", "Power dialer", "Contact management", "Calendar", "Basic reports"],
              cta: "Get Started",
              highlight: false,
            },
            {
              name: "Professional",
              price: "$99",
              sub: "/mo per agent",
              desc: "For growing teams that need more",
              features: [
                "Everything in Starter, plus:",
                "AI Agents (up to 3)",
                "Smart campaigns",
                "Leaderboard",
                "Advanced reports",
                "CSV import/export",
              ],
              cta: "Start Free Trial",
              highlight: true,
            },
            {
              name: "Enterprise",
              price: "Custom",
              sub: "",
              desc: "For large agencies and IMOs",
              features: [
                "Everything in Professional, plus:",
                "Unlimited AI agents",
                "Custom integrations",
                "Dedicated support",
                "SLA guarantee",
                "SSO & advanced security",
              ],
              cta: "Contact Sales",
              highlight: false,
            },
          ].map((plan, i) => (
            <motion.div
              key={plan.name}
              variants={fadeUp}
              transition={{ delay: i * 0.1 }}
              className={`relative rounded-2xl p-8 bg-card border transition-all duration-300 hover:-translate-y-1 ${
                plan.highlight ? "border-primary scale-105 shadow-lg shadow-primary/10" : "border-border"
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-semibold rounded-full px-4 py-1">
                  Most Popular
                </span>
              )}
              <h3 className="font-semibold text-lg">{plan.name}</h3>
              <p className="text-sm text-muted-foreground mb-4">{plan.desc}</p>
              <div className="flex items-baseline gap-1 mb-6">
                <span className="text-4xl font-extrabold">{plan.price}</span>
                <span className="text-muted-foreground text-sm">{plan.sub}</span>
              </div>
              <ul className="space-y-2 mb-8">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle size={14} className="text-primary shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              <Link
                to="/login"
                className={`block w-full text-center py-3 rounded-xl font-semibold transition-all duration-200 ${
                  plan.highlight
                    ? "bg-primary text-primary-foreground hover:scale-105 shadow-[0_0_16px_hsl(var(--primary)/0.3)]"
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
          className="text-3xl font-bold text-center mb-12"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={fadeUp}
        >
          Hear From Agencies Like Yours
        </motion.h2>

        <motion.div
          className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-5xl mx-auto"
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
              role: "Agency Director, Summit Financial Group",
            },
            {
              quote:
                "The AI agents are a game-changer. We book 30% more appointments without adding headcount.",
              name: "David Park",
              role: "IMO Owner, Pacific Life Partners",
            },
            {
              quote:
                "Finally, a CRM that actually understands life insurance sales. The leaderboard keeps my team fired up every single day.",
              name: "Rachel Kim",
              role: "Team Leader, Heritage Benefits",
            },
          ].map(({ quote, name, role }, i) => (
            <motion.div
              key={name}
              variants={fadeUp}
              transition={{ delay: i * 0.1 }}
              className="rounded-2xl bg-card/50 border border-border/50 p-6"
            >
              <span className="text-4xl text-primary/20 font-serif leading-none">"</span>
              <p className="text-sm text-muted-foreground italic mb-6">{quote}</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary">
                  {name.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold text-sm">{name}</p>
                  <p className="text-xs text-muted-foreground">{role}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* ════════════════════════════════════════
          SECTION 9 — FAQ
         ════════════════════════════════════════ */}
      <Section id="faq">
        <motion.h2
          className="text-3xl font-bold text-center mb-10"
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
      <MarketingFooter />
    </div>
  );
};

export default LandingPage;
