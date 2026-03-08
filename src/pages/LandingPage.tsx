import React, { useRef, useState } from "react";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import {
  Bot, Phone, Users, LayoutDashboard, MessageSquare, Calendar,
  Megaphone, Trophy, BarChart3, GraduationCap, Settings, Star,
  Zap, Shield, TrendingUp, Clock, ArrowRight, ChevronRight,
  Activity, Target, Headphones, Brain
} from "lucide-react";
import { Button } from "@/components/ui/button";
import AnimatedBackground from "@/components/AnimatedBackground";

/* ─── helpers ─── */
const ease = [0.22, 1, 0.36, 1] as const;

const Section: React.FC<{ children: React.ReactNode; className?: string; id?: string }> = ({ children, className = "", id }) => {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.section
      ref={ref}
      id={id}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.8, ease }}
      className={className}
    >
      {children}
    </motion.section>
  );
};

const GlowCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  glowColor?: string;
  delay?: number;
}> = ({ children, className = "", glowColor = "59,130,246", delay = 0 }) => {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30, scale: 0.97 }}
      animate={inView ? { opacity: 1, y: 0, scale: 1 } : {}}
      transition={{ duration: 0.7, ease, delay }}
      whileHover={{ boxShadow: `0 0 40px rgba(${glowColor},0.25), 0 0 80px rgba(${glowColor},0.1)` }}
      className={`bg-white/[0.03] border border-white/[0.08] backdrop-blur-xl rounded-2xl transition-all duration-500 ${className}`}
    >
      {children}
    </motion.div>
  );
};

/* ─── data ─── */
const features = [
  {
    icon: Bot, title: "AI Agents", desc: "Autonomous AI that qualifies leads, books appointments, and follows up — 24/7.",
    gradient: "from-violet-500 to-purple-600", glow: "139,92,246", hero: true,
    visual: (
      <div className="mt-4 rounded-lg bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-emerald-400/80 space-y-1">
        <div className="text-white/40">{">"} ai.qualify(lead_4829)</div>
        <div>✓ Health profile: eligible</div>
        <div>✓ Budget range: $80-120/mo</div>
        <div>✓ Best match: Whole Life — AAA Carrier</div>
        <div className="text-cyan-400/80">→ Booking appointment for Thu 2:30 PM…</div>
        <div className="h-1 w-3/4 rounded bg-gradient-to-r from-emerald-500 to-cyan-500 mt-2 animate-pulse" />
      </div>
    ),
  },
  {
    icon: Phone, title: "Power Dialer", desc: "80+ calls/hour with auto-dial, call recording, and real-time coaching.",
    gradient: "from-blue-500 to-cyan-500", glow: "59,130,246", hero: true,
    visual: (
      <div className="mt-4 space-y-2">
        {[75, 90, 60, 85, 45].map((h, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-8 text-[10px] text-white/40">{`${9 + i}:00`}</div>
            <div className="flex-1 h-3 rounded-full bg-white/[0.06] overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: `${h}%` }}
                transition={{ duration: 1, delay: i * 0.15 }}
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400"
              />
            </div>
            <div className="w-6 text-[10px] text-white/50">{h}</div>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: Users, title: "Smart CRM", desc: "Leads, clients, and recruits in one unified platform with smart scoring.",
    gradient: "from-emerald-500 to-teal-500", glow: "20,184,166", hero: true,
    visual: (
      <div className="mt-4 space-y-2">
        {["Sarah M. — Score: 92", "James K. — Score: 87", "Linda R. — Score: 78"].map((c, i) => (
          <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.04] border border-white/[0.06]">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-400 flex items-center justify-center text-[10px] font-bold text-white">
              {c[0]}
            </div>
            <span className="text-[11px] text-white/70">{c}</span>
            <div className="ml-auto w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
        ))}
      </div>
    ),
  },
  { icon: LayoutDashboard, title: "Dashboard", desc: "Real-time KPIs, production metrics, and goal tracking at a glance.", gradient: "from-orange-500 to-amber-500", glow: "245,158,11" },
  { icon: MessageSquare, title: "Conversations", desc: "Unified inbox for calls, SMS, and emails with AI-suggested replies.", gradient: "from-pink-500 to-rose-500", glow: "236,72,153" },
  { icon: Calendar, title: "Calendar", desc: "Smart scheduling with Google Calendar sync and automated reminders.", gradient: "from-sky-500 to-blue-500", glow: "14,165,233" },
  { icon: Megaphone, title: "Campaigns", desc: "Multi-channel outreach campaigns with A/B testing and auto follow-ups.", gradient: "from-red-500 to-orange-500", glow: "239,68,68" },
  { icon: Trophy, title: "Leaderboard", desc: "Gamified performance tracking to keep your team motivated and competing.", gradient: "from-yellow-500 to-amber-400", glow: "234,179,8" },
  { icon: BarChart3, title: "Reports", desc: "Deep analytics on calls, conversions, and revenue with exportable dashboards.", gradient: "from-indigo-500 to-violet-500", glow: "99,102,241" },
  { icon: GraduationCap, title: "Training", desc: "Onboard new agents faster with built-in training modules and scripts.", gradient: "from-lime-500 to-green-500", glow: "132,204,22" },
  { icon: Settings, title: "Settings", desc: "Full control over branding, permissions, dispositions, and integrations.", gradient: "from-slate-400 to-zinc-500", glow: "148,163,184" },
];

const pillars = [
  {
    label: "AI & Automation", icon: Brain, color: "text-violet-400",
    stats: [
      { value: "24/7", label: "AI Availability" },
      { value: "3x", label: "Faster Follow-up" },
      { value: "92%", label: "Qualification Accuracy" },
      { value: "40%", label: "Time Saved" },
    ],
    desc: "From lead qualification to appointment booking, AI handles the heavy lifting so agents can focus on closing.",
  },
  {
    label: "Communication", icon: Headphones, color: "text-blue-400",
    stats: [
      { value: "80+", label: "Calls/Hour" },
      { value: "99.8%", label: "Call Quality" },
      { value: "SMS + Email", label: "Multi-Channel" },
      { value: "<1s", label: "Connect Time" },
    ],
    desc: "Power dialer, SMS, and email — all in one unified communication hub with call recording and coaching.",
  },
  {
    label: "Management", icon: Target, color: "text-emerald-400",
    stats: [
      { value: "∞", label: "Contacts" },
      { value: "Custom", label: "Pipelines" },
      { value: "Auto", label: "Lead Scoring" },
      { value: "360°", label: "Contact View" },
    ],
    desc: "Leads, clients, and recruits unified with smart scoring, custom fields, and automated workflow management.",
  },
  {
    label: "Performance", icon: Activity, color: "text-amber-400",
    stats: [
      { value: "Real-time", label: "Analytics" },
      { value: "Gamified", label: "Leaderboards" },
      { value: "Custom", label: "Goal Setting" },
      { value: "Export", label: "Reports" },
    ],
    desc: "Track every metric that matters — from call volume to policy close rate — with gamified team competition.",
  },
];

const stats = [
  { value: "10M+", label: "Calls Made" },
  { value: "500K+", label: "Policies Sold" },
  { value: "99.9%", label: "Uptime" },
  { value: "47%", label: "Production Increase" },
];

const testimonials = [
  { name: "David Chen", role: "Agency Owner, Premier Life Group", stars: 5, quote: "AgentFlow transformed our agency. We went from 30 calls a day to 80+ per agent, and our close rate jumped 35%. The AI follow-up alone pays for itself ten times over." },
  { name: "Maria Santos", role: "Top Producer, Shield Insurance", stars: 5, quote: "The power dialer is insane. I'm making twice the calls in half the time. The CRM keeps everything organized so I never miss a follow-up. Best investment I've made." },
  { name: "Robert Williams", role: "Managing Director, Atlas Benefits", stars: 5, quote: "We onboarded 15 new agents last quarter. The built-in training and leaderboard features cut our ramp-up time by 60%. Our team is more productive than ever." },
];

const trustedBy = [
  "Mutual of Omaha", "Transamerica", "Americo", "National Life Group",
  "Globe Life", "Foresters", "AIG", "Lincoln Financial",
];

/* ─── page ─── */
const LandingPage: React.FC = () => {
  const [activePillar, setActivePillar] = useState(0);

  return (
    <div className="relative min-h-screen bg-[#020408] text-white overflow-x-hidden">
      <AnimatedBackground />

      {/* ── NAV ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#020408]/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
            AgentFlow
          </span>
          <div className="hidden md:flex items-center gap-8 text-sm text-white/60">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#platform" className="hover:text-white transition-colors">Platform</a>
            <a href="#testimonials" className="hover:text-white transition-colors">Testimonials</a>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login">
              <Button variant="ghost" className="text-white/70 hover:text-white hover:bg-white/[0.06]">
                Sign In
              </Button>
            </Link>
            <Link to="/signup">
              <Button className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white border-0 shadow-lg shadow-blue-500/20">
                Get Started <ArrowRight className="ml-1 w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-32 pb-20 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm mb-8">
              <Zap className="w-3.5 h-3.5" /> Built for Life Insurance Professionals
            </div>
            <h1 className="text-5xl md:text-7xl font-bold leading-[1.1] mb-6">
              <span className="bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-transparent">
                The CRM & Dialer That{" "}
              </span>
              <br />
              <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                Closes More Policies
              </span>
            </h1>
            <p className="text-lg md:text-xl text-white/50 max-w-2xl mx-auto mb-10 leading-relaxed">
              AI-powered dialer, smart CRM, and automated workflows designed exclusively
              for life insurance agents and agencies. More calls. More closes. More revenue.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3, ease }}
            className="flex items-center justify-center gap-4 mb-16"
          >
            <Link to="/signup">
              <Button size="lg" className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white border-0 px-8 h-12 text-base shadow-xl shadow-blue-500/25">
                Start Free Trial <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
            <a href="#features">
              <Button size="lg" variant="outline" className="border-white/10 text-white/70 hover:text-white hover:bg-white/[0.06] h-12 px-8 text-base bg-transparent">
                See Features
              </Button>
            </a>
          </motion.div>

          {/* Floating stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5, ease }}
            className="flex justify-center gap-6 flex-wrap"
          >
            {[
              { val: "+247%", label: "Contact Rate", color: "blue" },
              { val: "80+", label: "Calls/Hour", color: "cyan" },
              { val: "35%", label: "Higher Close Rate", color: "emerald" },
            ].map((s, i) => (
              <div key={i} className={`px-5 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm`}>
                <div className={`text-2xl font-bold bg-gradient-to-r from-${s.color}-400 to-${s.color}-300 bg-clip-text text-transparent`}>
                  {s.val}
                </div>
                <div className="text-xs text-white/40 mt-0.5">{s.label}</div>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Mock dashboard visual */}
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.7, ease }}
          className="max-w-5xl mx-auto mt-16"
        >
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-sm p-6 shadow-2xl shadow-blue-500/5">
            <div className="flex gap-1.5 mb-4">
              <div className="w-3 h-3 rounded-full bg-red-500/60" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
              <div className="w-3 h-3 rounded-full bg-green-500/60" />
            </div>
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: "Calls Today", val: "127", color: "from-blue-500 to-cyan-400" },
                { label: "Appointments", val: "18", color: "from-emerald-500 to-teal-400" },
                { label: "Policies Sold", val: "7", color: "from-violet-500 to-purple-400" },
                { label: "Revenue", val: "$12,450", color: "from-amber-500 to-orange-400" },
              ].map((w, i) => (
                <div key={i} className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4">
                  <div className="text-[11px] text-white/40 mb-1">{w.label}</div>
                  <div className={`text-2xl font-bold bg-gradient-to-r ${w.color} bg-clip-text text-transparent`}>{w.val}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4">
              <div className="col-span-2 rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 h-32">
                <div className="text-[11px] text-white/40 mb-3">Call Volume (Today)</div>
                <div className="flex items-end gap-1 h-16">
                  {[30, 45, 60, 55, 70, 80, 65, 90, 75, 85, 70, 60].map((h, i) => (
                    <motion.div
                      key={i}
                      initial={{ height: 0 }}
                      whileInView={{ height: `${h}%` }}
                      transition={{ duration: 0.6, delay: i * 0.05 }}
                      className="flex-1 rounded-t bg-gradient-to-t from-blue-600 to-cyan-400 opacity-80"
                    />
                  ))}
                </div>
              </div>
              <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 h-32">
                <div className="text-[11px] text-white/40 mb-3">Close Rate</div>
                <div className="flex items-center justify-center h-16">
                  <div className="relative w-16 h-16">
                    <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
                      <motion.circle
                        cx="18" cy="18" r="15.9" fill="none" stroke="url(#grad)" strokeWidth="3"
                        strokeDasharray="100" initial={{ strokeDashoffset: 100 }}
                        whileInView={{ strokeDashoffset: 28 }}
                        transition={{ duration: 1.5, delay: 0.3 }}
                        strokeLinecap="round"
                      />
                      <defs><linearGradient id="grad"><stop stopColor="#3B82F6" /><stop offset="1" stopColor="#06B6D4" /></linearGradient></defs>
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white/80">72%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── TRUSTED BY ── */}
      <Section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-sm text-white/30 mb-8 uppercase tracking-widest">Trusted by agents selling for</p>
          <div className="flex flex-wrap justify-center gap-x-10 gap-y-4">
            {trustedBy.map((name, i) => (
              <motion.span
                key={name}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                transition={{ delay: i * 0.08 }}
                viewport={{ once: true }}
                className="text-white/20 text-lg font-semibold hover:text-white/40 transition-colors"
              >
                {name}
              </motion.span>
            ))}
          </div>
        </div>
      </Section>

      {/* ── FEATURES BENTO ── */}
      <Section id="features" className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              <span className="bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
                Everything You Need to
              </span>{" "}
              <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                Dominate
              </span>
            </h2>
            <p className="text-white/40 text-lg max-w-xl mx-auto">
              11 powerful modules working together to make you the most productive agent in your market.
            </p>
          </div>

          {/* Hero cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
            {features.filter(f => f.hero).map((f, i) => (
              <GlowCard key={f.title} glowColor={f.glow} delay={i * 0.1} className="p-6">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${f.gradient} flex items-center justify-center mb-4`}>
                  <f.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-1">{f.title}</h3>
                <p className="text-sm text-white/40 leading-relaxed">{f.desc}</p>
                {f.visual}
              </GlowCard>
            ))}
          </div>

          {/* Standard cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {features.filter(f => !f.hero).map((f, i) => (
              <GlowCard key={f.title} glowColor={f.glow} delay={i * 0.06} className="p-5">
                <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${f.gradient} flex items-center justify-center mb-3`}>
                  <f.icon className="w-4 h-4 text-white" />
                </div>
                <h3 className="text-sm font-semibold text-white mb-1">{f.title}</h3>
                <p className="text-xs text-white/35 leading-relaxed">{f.desc}</p>
              </GlowCard>
            ))}
          </div>
        </div>
      </Section>

      {/* ── PLATFORM DEEP DIVE ── */}
      <Section id="platform" className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              <span className="bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
                Four Pillars of
              </span>{" "}
              <span className="bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                Production
              </span>
            </h2>
          </div>

          {/* Tabs */}
          <div className="flex justify-center gap-2 mb-10 flex-wrap">
            {pillars.map((p, i) => (
              <button
                key={p.label}
                onClick={() => setActivePillar(i)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
                  activePillar === i
                    ? "bg-white/[0.1] text-white border border-white/[0.15]"
                    : "text-white/40 hover:text-white/60 border border-transparent"
                }`}
              >
                <p.icon className={`w-4 h-4 ${activePillar === i ? p.color : ""}`} />
                {p.label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activePillar}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4, ease }}
            >
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-sm p-8">
                <p className="text-white/50 text-base mb-8 max-w-2xl">{pillars[activePillar].desc}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {pillars[activePillar].stats.map((s, i) => (
                    <motion.div
                      key={s.label}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.1 }}
                      className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-5 text-center"
                    >
                      <div className="text-2xl font-bold text-white mb-1">{s.value}</div>
                      <div className="text-xs text-white/40">{s.label}</div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </Section>

      {/* ── STATS BAR ── */}
      <Section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.6, ease }}
                className="text-center"
              >
                <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  {s.value}
                </div>
                <div className="text-sm text-white/40 mt-1">{s.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── TESTIMONIALS ── */}
      <Section id="testimonials" className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              <span className="bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
                Loved by
              </span>{" "}
              <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                Top Producers
              </span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t, i) => (
              <GlowCard key={t.name} glowColor="234,179,8" delay={i * 0.1} className="p-6">
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: t.stars }).map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-sm text-white/60 leading-relaxed mb-6">"{t.quote}"</p>
                <div>
                  <div className="text-sm font-semibold text-white">{t.name}</div>
                  <div className="text-xs text-white/35">{t.role}</div>
                </div>
              </GlowCard>
            ))}
          </div>
        </div>
      </Section>

      {/* ── FINAL CTA ── */}
      <Section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div
            className="rounded-2xl p-[1px] bg-gradient-to-r from-blue-500 via-cyan-500 to-emerald-500"
            animate={{ boxShadow: ["0 0 30px rgba(59,130,246,0.15)", "0 0 60px rgba(6,182,212,0.2)", "0 0 30px rgba(59,130,246,0.15)"] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <div className="rounded-2xl bg-[#020408] p-12">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                <span className="bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                  Ready to Transform Your Agency?
                </span>
              </h2>
              <p className="text-white/40 mb-8 max-w-lg mx-auto">
                Join thousands of life insurance professionals who are closing more policies with AgentFlow.
              </p>
              <Link to="/signup">
                <Button size="lg" className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white border-0 px-10 h-12 text-base shadow-xl shadow-blue-500/25">
                  Start Your Free Trial <ChevronRight className="ml-1 w-4 h-4" />
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </Section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/[0.06] py-16 px-6">
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-10">
          <div>
            <span className="text-lg font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              AgentFlow
            </span>
            <p className="text-sm text-white/30 mt-3 leading-relaxed">
              The all-in-one CRM & dialer platform for life insurance professionals.
            </p>
          </div>
          {[
            { title: "Product", links: ["Features", "Pricing", "Integrations", "API"] },
            { title: "Resources", links: ["Documentation", "Blog", "Support", "Webinars"] },
            { title: "Company", links: ["About", "Careers", "Contact", "Legal"] },
          ].map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold text-white/60 mb-4">{col.title}</h4>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link}>
                    <span className="text-sm text-white/25 hover:text-white/50 transition-colors cursor-pointer">
                      {link}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="max-w-6xl mx-auto mt-12 pt-6 border-t border-white/[0.06] flex items-center justify-between text-xs text-white/20">
          <span>© 2026 AgentFlow. All rights reserved.</span>
          <div className="flex gap-4">
            <span className="hover:text-white/40 cursor-pointer">Privacy</span>
            <span className="hover:text-white/40 cursor-pointer">Terms</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
