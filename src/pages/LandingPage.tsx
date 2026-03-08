import { useState, useEffect, useRef } from "react";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Bot, Phone, MessageSquare, Users, Rocket, Trophy, GraduationCap,
  Play, ArrowRight, Sparkles, Zap, Shield, Star, ChevronRight,
  Mail, MapPin, Globe, Check, Menu, X
} from "lucide-react";
import { Button } from "@/components/ui/button";

/* ───────────────────────── helpers ───────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  }),
};

const stagger = { visible: { transition: { staggerChildren: 0.08 } } };

function MagneticButton({ children, className = "", onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const handleMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - rect.width / 2) * 0.15;
    const y = (e.clientY - rect.top - rect.height / 2) * 0.15;
    setPos({ x, y });
  };

  return (
    <motion.button
      ref={ref}
      animate={{ x: pos.x, y: pos.y }}
      transition={{ type: "spring", stiffness: 200, damping: 15 }}
      onMouseMove={handleMove}
      onMouseLeave={() => setPos({ x: 0, y: 0 })}
      className={className}
      onClick={onClick}
    >
      {children}
    </motion.button>
  );
}

function Section({ children, id, className = "" }: { children: React.ReactNode; id?: string; className?: string }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.section
      ref={ref}
      id={id}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      variants={stagger}
      className={className}
    >
      {children}
    </motion.section>
  );
}

/* ───────────────────────── data ───────────────────────── */
const features = [
  {
    icon: Bot, title: "AI Agents", desc: "24/7 Voice & Chat outreach that never sleeps.",
    detail: "Autonomous AI agents handle prospecting, follow-ups, and appointment setting around the clock.",
    span: "md:col-span-2 md:row-span-2",
    gradient: "from-violet-500/20 to-indigo-500/20",
  },
  {
    icon: Phone, title: "The Dialer", desc: "HD calling with live scripts and Telnyx integration.",
    detail: "Crystal-clear VoIP with real-time script prompts and automatic call logging.",
    span: "md:col-span-1",
    gradient: "from-blue-500/20 to-cyan-500/20",
  },
  {
    icon: MessageSquare, title: "Omnichannel Inbox", desc: "Unified SMS, Email & Voice conversations.",
    detail: "Every conversation in one place — never miss a follow-up again.",
    span: "md:col-span-1",
    gradient: "from-emerald-500/20 to-teal-500/20",
  },
  {
    icon: Users, title: "Smart CRM", desc: "Manage thousands of leads with lightning-fast search.",
    detail: "Advanced filtering, custom fields, and instant pipeline views.",
    span: "md:col-span-1",
    gradient: "from-amber-500/20 to-orange-500/20",
  },
  {
    icon: Rocket, title: "Automated Campaigns", desc: "Multi-touch sequences on autopilot.",
    detail: "Drip campaigns across SMS, email, and voicemail drops.",
    span: "md:col-span-1",
    gradient: "from-pink-500/20 to-rose-500/20",
  },
  {
    icon: Trophy, title: "Leaderboards", desc: "Gamify your agency's performance in real-time.",
    detail: "Boost team morale with live rankings and achievement badges.",
    span: "md:col-span-1",
    gradient: "from-yellow-500/20 to-amber-500/20",
  },
  {
    icon: GraduationCap, title: "Training Vault", desc: "Onboard agents with a world-class portal.",
    detail: "Video courses, quizzes, and certification tracking for your entire team.",
    span: "md:col-span-1",
    gradient: "from-indigo-500/20 to-purple-500/20",
  },
];

const tabFeatures = [
  { id: "ai", label: "AI Agents", icon: Bot, color: "from-violet-500 to-indigo-500", visual: "Terminal-style AI interface processing leads in real-time" },
  { id: "crm", label: "Smart CRM", icon: Users, color: "from-blue-500 to-cyan-500", visual: "Lightning-fast contact management with advanced filtering" },
  { id: "dialer", label: "The Dialer", icon: Phone, color: "from-emerald-500 to-teal-500", visual: "HD calling interface with live script overlay" },
];

const trustedLogos = ["Prudential", "MetLife", "New York Life", "Northwestern Mutual", "MassMutual", "Transamerica", "Pacific Life", "Lincoln Financial"];

const footerLinks = {
  Product: ["Features", "Pricing", "Integrations", "Changelog", "API Docs"],
  Resources: ["Blog", "Help Center", "Webinars", "Case Studies", "Community"],
  Company: ["About", "Careers", "Press", "Contact", "Privacy Policy"],
};

/* ───────────────────────── component ───────────────────────── */
const LandingPage = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("ai");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-[#030303] text-white overflow-x-hidden selection:bg-indigo-500/30">
      {/* ─── NAV ─── */}
      <motion.nav
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? "bg-black/70 backdrop-blur-xl border-b border-white/5" : "bg-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="#hero" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">AgentFlow</span>
          </a>

          <div className="hidden md:flex items-center gap-8 text-sm text-white/60">
            {["Features", "Showcase", "Proof"].map((s) => (
              <a key={s} href={`#${s.toLowerCase()}`} className="hover:text-white transition-colors duration-200">
                {s}
              </a>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Button variant="ghost" className="text-white/70 hover:text-white hover:bg-white/5" onClick={() => navigate("/login")}>
              Sign In
            </Button>
            <Button
              className="bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white border-0 shadow-lg shadow-indigo-500/25"
              onClick={() => navigate("/signup")}
            >
              Get Started
            </Button>
          </div>

          <button className="md:hidden text-white/70" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X /> : <Menu />}
          </button>
        </div>

        {/* mobile menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="md:hidden bg-black/90 backdrop-blur-xl border-b border-white/5 overflow-hidden"
            >
              <div className="px-6 py-4 flex flex-col gap-4">
                {["Features", "Showcase", "Proof"].map((s) => (
                  <a key={s} href={`#${s.toLowerCase()}`} className="text-white/60 hover:text-white" onClick={() => setMobileMenuOpen(false)}>
                    {s}
                  </a>
                ))}
                <Button variant="ghost" className="justify-start text-white/70 hover:text-white hover:bg-white/5 px-0" onClick={() => navigate("/login")}>Sign In</Button>
                <Button className="bg-gradient-to-r from-indigo-500 to-violet-600 text-white border-0" onClick={() => navigate("/signup")}>Get Started</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>

      {/* ─── HERO ─── */}
      <Section id="hero" className="relative pt-32 pb-24 md:pt-44 md:pb-36 px-6">
        {/* mesh gradient bg */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-indigo-600/15 blur-[120px]" />
          <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] rounded-full bg-violet-600/10 blur-[100px]" />
          <div className="absolute top-1/2 right-1/4 w-[300px] h-[300px] rounded-full bg-blue-600/10 blur-[80px]" />
        </div>

        <div className="relative max-w-5xl mx-auto text-center">
          {/* badges */}
          <motion.div variants={fadeUp} custom={0} className="flex flex-wrap justify-center gap-3 mb-8">
            {[
              { label: "v2.0 Now Live", icon: Sparkles },
              { label: "AI-Powered", icon: Bot },
              { label: "10k+ Agents Active", icon: Users },
            ].map(({ label, icon: Icon }) => (
              <span key={label} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-white/5 border border-white/10 text-white/70 backdrop-blur-sm">
                <Icon className="w-3 h-3 text-indigo-400" />
                {label}
              </span>
            ))}
          </motion.div>

          <motion.h1 variants={fadeUp} custom={1} className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
            <span className="bg-gradient-to-b from-white via-white/90 to-white/50 bg-clip-text text-transparent">
              The Complete AI Workforce
            </span>
            <br />
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
              for Modern Insurance Agents
            </span>
          </motion.h1>

          <motion.p variants={fadeUp} custom={2} className="text-base sm:text-lg md:text-xl text-white/50 max-w-2xl mx-auto mb-10 leading-relaxed">
            Automate your lead flow, master your calendar, and close more policies with AgentFlow's all-in-one ecosystem.
          </motion.p>

          <motion.div variants={fadeUp} custom={3} className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <MagneticButton
              className="relative px-8 py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-600 shadow-2xl shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-shadow duration-300 group"
              onClick={() => navigate("/signup")}
            >
              <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-400 to-violet-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <span className="relative flex items-center gap-2">
                Get Started for Free <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </MagneticButton>

            <MagneticButton className="flex items-center gap-2 px-6 py-3.5 rounded-xl font-medium text-white/70 hover:text-white border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all duration-300">
              <Play className="w-4 h-4" /> Watch the Demo
            </MagneticButton>
          </motion.div>

          {/* hero visual placeholder */}
          <motion.div variants={fadeUp} custom={5} className="mt-16 md:mt-24 relative mx-auto max-w-4xl">
            <div className="absolute -inset-4 bg-gradient-to-r from-indigo-500/20 via-violet-500/20 to-purple-500/20 rounded-2xl blur-xl" />
            <div className="relative rounded-2xl border border-white/10 bg-black/40 backdrop-blur-sm overflow-hidden aspect-[16/9]">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/50 to-violet-950/50" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center mx-auto mb-4">
                    <Play className="w-7 h-7 text-white ml-0.5" />
                  </div>
                  <p className="text-white/40 text-sm">Platform Overview</p>
                </div>
              </div>
              {/* grid overlay */}
              <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)", backgroundSize: "40px 40px" }} />
            </div>
          </motion.div>
        </div>
      </Section>

      {/* ─── BENTO FEATURES ─── */}
      <Section id="features" className="py-24 md:py-36 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div variants={fadeUp} custom={0} className="text-center mb-16">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-white/5 border border-white/10 text-indigo-400 mb-4">
              <Sparkles className="w-3 h-3" /> Features
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
              Everything you need to dominate
            </h2>
            <p className="mt-4 text-white/40 max-w-xl mx-auto">One platform, zero excuses. Every tool an insurance agent needs, unified and intelligent.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                variants={fadeUp}
                custom={i}
                className={`group relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm p-6 hover:border-white/10 transition-all duration-500 overflow-hidden ${f.span}`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${f.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                <div className="relative z-10">
                  <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 group-hover:bg-white/10 transition-colors">
                    <f.icon className="w-5 h-5 text-white/60 group-hover:text-white transition-colors" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-1">{f.title}</h3>
                  <p className="text-sm text-white/40 mb-3">{f.desc}</p>
                  <p className="text-sm text-white/25 group-hover:text-white/40 transition-colors">{f.detail}</p>
                  
                  {/* large card gets a terminal placeholder */}
                  {f.span.includes("row-span-2") && (
                    <div className="mt-6 rounded-xl bg-black/40 border border-white/5 p-4 font-mono text-xs text-white/30">
                      <div className="flex gap-1.5 mb-3">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                        <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                      </div>
                      <p><span className="text-indigo-400">agentflow</span> <span className="text-white/50">→</span> Processing 247 new leads...</p>
                      <p className="mt-1"><span className="text-green-400">✓</span> 18 appointments booked autonomously</p>
                      <p className="mt-1"><span className="text-green-400">✓</span> 4 policies ready to close</p>
                      <p className="mt-1 animate-pulse">█</p>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ─── FEATURE TABS SHOWCASE ─── */}
      <Section id="showcase" className="py-24 md:py-36 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div variants={fadeUp} custom={0} className="text-center mb-12">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-white/5 border border-white/10 text-violet-400 mb-4">
              <Zap className="w-3 h-3" /> Showcase
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
              See it in action
            </h2>
          </motion.div>

          {/* tabs */}
          <motion.div variants={fadeUp} custom={1} className="flex justify-center gap-2 mb-10 flex-wrap">
            {tabFeatures.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
                  activeTab === t.id
                    ? "bg-white/10 text-white border border-white/10 shadow-lg"
                    : "text-white/40 hover:text-white/60 border border-transparent"
                }`}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </motion.div>

          {/* tab content */}
          <motion.div variants={fadeUp} custom={2}>
            <AnimatePresence mode="wait">
              {tabFeatures.map(
                (t) =>
                  activeTab === t.id && (
                    <motion.div
                      key={t.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ duration: 0.4 }}
                      className="relative rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden aspect-[16/9] max-w-4xl mx-auto"
                    >
                      <div className={`absolute inset-0 bg-gradient-to-br ${t.color} opacity-[0.07]`} />
                      <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)", backgroundSize: "32px 32px" }} />
                      <div className="absolute inset-0 flex items-center justify-center flex-col gap-4 px-6 text-center">
                        <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${t.color} flex items-center justify-center`}>
                          <t.icon className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-semibold text-white">{t.label}</h3>
                        <p className="text-white/40 max-w-md">{t.visual}</p>
                      </div>
                    </motion.div>
                  )
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </Section>

      {/* ─── STATS ─── */}
      <Section className="py-20 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { num: "10,000+", label: "Active Agents" },
            { num: "2.4M", label: "Calls Made" },
            { num: "98%", label: "Uptime SLA" },
            { num: "4.9/5", label: "User Rating" },
          ].map((s, i) => (
            <motion.div key={s.label} variants={fadeUp} custom={i} className="text-center">
              <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">{s.num}</div>
              <div className="text-sm text-white/40 mt-1">{s.label}</div>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ─── SOCIAL PROOF ─── */}
      <Section id="proof" className="py-24 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <motion.div variants={fadeUp} custom={0} className="text-center mb-12">
            <p className="text-sm text-white/30 uppercase tracking-widest">Trusted by leading agencies</p>
          </motion.div>

          {/* marquee */}
          <div className="relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-[#030303] to-transparent z-10" />
            <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-[#030303] to-transparent z-10" />
            <motion.div
              animate={{ x: [0, -1200] }}
              transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
              className="flex gap-16 items-center whitespace-nowrap"
            >
              {[...trustedLogos, ...trustedLogos].map((logo, i) => (
                <span key={i} className="text-xl font-semibold text-white/10 hover:text-white/20 transition-colors select-none">
                  {logo}
                </span>
              ))}
            </motion.div>
          </div>

          {/* testimonials */}
          <motion.div variants={fadeUp} custom={2} className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { name: "Sarah Chen", role: "Agency Owner", quote: "AgentFlow replaced 5 tools for us. Our close rate jumped 40% in 3 months." },
              { name: "Marcus Williams", role: "Top Producer", quote: "The AI agents book me 15+ appointments a week while I focus on closing." },
              { name: "Jennifer Lopez", role: "Team Lead", quote: "Onboarding new agents went from 2 weeks to 2 days with the Training Vault." },
            ].map((t, i) => (
              <motion.div key={t.name} variants={fadeUp} custom={i} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 backdrop-blur-sm">
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-indigo-400 text-indigo-400" />
                  ))}
                </div>
                <p className="text-white/60 text-sm mb-6 leading-relaxed">"{t.quote}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-xs font-bold text-white">
                    {t.name.split(" ").map((n) => n[0]).join("")}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{t.name}</p>
                    <p className="text-xs text-white/30">{t.role}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </Section>

      {/* ─── CTA ─── */}
      <Section className="py-24 md:py-36 px-6">
        <div className="max-w-3xl mx-auto text-center relative">
          <div className="absolute inset-0 -m-20 rounded-full bg-indigo-600/10 blur-[100px] pointer-events-none" />
          <motion.div variants={fadeUp} custom={0} className="relative">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent mb-6">
              Ready to transform your agency?
            </h2>
            <p className="text-white/40 mb-10 max-w-lg mx-auto">
              Join 10,000+ insurance agents already using AgentFlow to automate, grow, and win.
            </p>
            <MagneticButton
              className="px-10 py-4 rounded-xl font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-600 shadow-2xl shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-shadow duration-300"
              onClick={() => navigate("/signup")}
            >
              <span className="flex items-center gap-2">
                Start Free Trial <ArrowRight className="w-4 h-4" />
              </span>
            </MagneticButton>
          </motion.div>
        </div>
      </Section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-white/5 py-16 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
            <div className="col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-white" />
                </div>
                <span className="text-lg font-bold">AgentFlow</span>
              </div>
              <p className="text-sm text-white/30 max-w-xs leading-relaxed">
                The all-in-one AI-powered platform built exclusively for modern life insurance agents.
              </p>
            </div>
            {Object.entries(footerLinks).map(([title, links]) => (
              <div key={title}>
                <p className="text-sm font-semibold text-white/60 mb-4">{title}</p>
                <ul className="space-y-2.5">
                  {links.map((l) => (
                    <li key={l}>
                      <a href="#" className="text-sm text-white/25 hover:text-white/50 transition-colors">{l}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-16 pt-8 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-white/20">© 2026 AgentFlow. All rights reserved.</p>
            <div className="flex gap-6">
              <a href="#" className="text-xs text-white/20 hover:text-white/40 transition-colors">Terms</a>
              <a href="#" className="text-xs text-white/20 hover:text-white/40 transition-colors">Privacy</a>
              <a href="#" className="text-xs text-white/20 hover:text-white/40 transition-colors">Cookies</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
