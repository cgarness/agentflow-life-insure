import { useState, useEffect, useRef } from "react";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Bot, Phone, MessageSquare, Users, Rocket, Trophy, GraduationCap,
  Play, ArrowRight, Sparkles, Zap, Shield, Star, ChevronRight,
  LayoutDashboard, Calendar, BarChart3, Settings, Target,
  PhoneCall, Brain, TrendingUp, Clock, CheckCircle2, Headphones,
  FileText, PieChart, Activity, Megaphone, BookOpen
} from "lucide-react";
import { Button } from "@/components/ui/button";

/* ───────────────────────── helpers ───────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  }),
};

const stagger = { visible: { transition: { staggerChildren: 0.06 } } };

function MagneticButton({ children, className = "", onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const handleMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({ x: (e.clientX - rect.left - rect.width / 2) * 0.15, y: (e.clientY - rect.top - rect.height / 2) * 0.15 });
  };
  return (
    <motion.button ref={ref} animate={{ x: pos.x, y: pos.y }} transition={{ type: "spring", stiffness: 200, damping: 15 }} onMouseMove={handleMove} onMouseLeave={() => setPos({ x: 0, y: 0 })} className={className} onClick={onClick}>
      {children}
    </motion.button>
  );
}

function Section({ children, id, className = "" }: { children: React.ReactNode; id?: string; className?: string }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.section ref={ref} id={id} initial="hidden" animate={isInView ? "visible" : "hidden"} variants={stagger} className={className}>
      {children}
    </motion.section>
  );
}

/* ───────────────────────── data ───────────────────────── */
const allFeatures = [
  {
    icon: LayoutDashboard, title: "Dashboard", desc: "Real-time command center for your entire agency.",
    detail: "Live KPIs, pipeline overview, activity feeds, and customizable widgets — all in one glance.",
    gradient: "from-blue-500/20 to-cyan-500/20", borderGlow: "group-hover:shadow-blue-500/20",
    size: "normal" as const,
    mockUI: (
      <div className="mt-4 space-y-2">
        <div className="flex gap-2">
          {[65, 42, 88, 55, 72, 90, 60].map((h, i) => (
            <div key={i} className="flex-1 bg-blue-500/20 rounded-sm" style={{ height: `${h * 0.4}px` }} />
          ))}
        </div>
        <div className="flex gap-2 text-[10px] text-white/20">
          <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
        </div>
      </div>
    ),
  },
  {
    icon: Phone, title: "Power Dialer", desc: "HD calling with live scripts & automatic logging.",
    detail: "Telnyx-powered VoIP with real-time script prompts, call recording, and one-click dispositions.",
    gradient: "from-emerald-500/20 to-teal-500/20", borderGlow: "group-hover:shadow-emerald-500/20",
    size: "hero" as const,
    mockUI: (
      <div className="mt-5 rounded-xl bg-black/50 border border-white/5 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <PhoneCall className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-xs text-white/60 font-medium">Calling John Smith</p>
            <p className="text-[10px] text-white/30">(555) 123-4567 · 02:34</p>
          </div>
          <div className="ml-auto flex gap-1">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] text-emerald-400">Live</span>
          </div>
        </div>
        <div className="space-y-1">
          {["Hi John, this is...", "I'm calling about your...", "Would Tuesday work for..."].map((l, i) => (
            <p key={i} className={`text-[10px] ${i === 0 ? "text-emerald-400/60" : "text-white/20"}`}>{l}</p>
          ))}
        </div>
      </div>
    ),
  },
  {
    icon: Users, title: "Smart CRM", desc: "Manage leads, clients & recruits in one place.",
    detail: "Advanced filtering, custom fields, bulk actions, and instant pipeline views for thousands of contacts.",
    gradient: "from-cyan-500/20 to-blue-500/20", borderGlow: "group-hover:shadow-cyan-500/20",
    size: "hero" as const,
    mockUI: (
      <div className="mt-5 rounded-xl bg-black/50 border border-white/5 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
          {["Leads", "Clients", "Recruits"].map((tab, i) => (
            <span key={tab} className={`text-[10px] px-2 py-0.5 rounded ${i === 0 ? "bg-cyan-500/20 text-cyan-400" : "text-white/30"}`}>{tab}</span>
          ))}
        </div>
        {[
          { name: "Sarah Johnson", status: "Hot Lead", color: "text-orange-400" },
          { name: "Mike Chen", status: "Contacted", color: "text-blue-400" },
          { name: "Lisa Park", status: "Qualified", color: "text-emerald-400" },
        ].map((r) => (
          <div key={r.name} className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.03]">
            <span className="text-[10px] text-white/50">{r.name}</span>
            <span className={`text-[9px] ${r.color}`}>{r.status}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: Bot, title: "AI Agents", desc: "24/7 autonomous outreach that never sleeps.",
    detail: "AI handles prospecting, follow-ups, and appointment setting around the clock — you just close.",
    gradient: "from-violet-500/20 to-indigo-500/20", borderGlow: "group-hover:shadow-violet-500/20",
    size: "hero" as const,
    mockUI: (
      <div className="mt-5 rounded-xl bg-black/50 border border-white/5 p-4 font-mono text-xs">
        <div className="flex gap-1.5 mb-3">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
        </div>
        <p className="text-white/30"><span className="text-violet-400">agentflow</span> <span className="text-white/20">→</span> Processing 247 leads...</p>
        <p className="mt-1 text-white/30"><span className="text-green-400">✓</span> 18 appointments booked</p>
        <p className="mt-1 text-white/30"><span className="text-green-400">✓</span> 4 policies ready to close</p>
        <p className="mt-1 text-white/30"><span className="text-cyan-400">⟳</span> Following up with 32 contacts...</p>
        <p className="mt-1 animate-pulse text-white/20">█</p>
      </div>
    ),
  },
  {
    icon: MessageSquare, title: "Conversations", desc: "Unified SMS, Email & Voice inbox.",
    detail: "Every conversation in one threaded view — never miss a follow-up or lose context again.",
    gradient: "from-teal-500/20 to-emerald-500/20", borderGlow: "group-hover:shadow-teal-500/20",
    size: "normal" as const,
    mockUI: (
      <div className="mt-4 space-y-2">
        {[
          { type: "SMS", msg: "Thanks for calling!", time: "2m" },
          { type: "Email", msg: "Policy docs attached", time: "1h" },
        ].map((m) => (
          <div key={m.type} className="flex items-center gap-2 rounded-lg bg-black/30 px-2 py-1.5">
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-400">{m.type}</span>
            <span className="text-[10px] text-white/30 flex-1 truncate">{m.msg}</span>
            <span className="text-[9px] text-white/15">{m.time}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: Calendar, title: "Calendar", desc: "Smart scheduling with Google Calendar sync.",
    detail: "Day, week, and month views with appointment types, reminders, and two-way Google sync.",
    gradient: "from-blue-500/20 to-indigo-500/20", borderGlow: "group-hover:shadow-blue-500/20",
    size: "normal" as const,
    mockUI: (
      <div className="mt-4 grid grid-cols-7 gap-0.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="text-center">
            <span className="text-[8px] text-white/20">{["M", "T", "W", "T", "F", "S", "S"][i]}</span>
            <div className={`mt-0.5 h-6 rounded-sm ${i === 2 ? "bg-blue-500/30 border border-blue-500/40" : i === 4 ? "bg-indigo-500/20" : "bg-white/[0.03]"}`} />
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: Rocket, title: "Campaigns", desc: "Multi-touch sequences on autopilot.",
    detail: "Drip campaigns across SMS, email, and voicemail drops with smart triggers and A/B testing.",
    gradient: "from-pink-500/20 to-rose-500/20", borderGlow: "group-hover:shadow-pink-500/20",
    size: "normal" as const,
    mockUI: (
      <div className="mt-4 flex items-center gap-2">
        {["Email", "Wait 2d", "SMS", "Wait 1d", "Call"].map((step, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`text-[9px] px-1.5 py-1 rounded ${i % 2 === 0 ? "bg-pink-500/15 text-pink-400/70 border border-pink-500/20" : "text-white/20"}`}>{step}</div>
            {i < 4 && <ChevronRight className="w-2.5 h-2.5 text-white/10" />}
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: Trophy, title: "Leaderboard", desc: "Gamify performance with live rankings.",
    detail: "Real-time leaderboards, achievement badges, and team competitions to drive motivation.",
    gradient: "from-yellow-500/20 to-amber-500/20", borderGlow: "group-hover:shadow-yellow-500/20",
    size: "normal" as const,
    mockUI: (
      <div className="mt-4 space-y-1.5">
        {[
          { rank: "1", name: "Alex M.", score: "142", medal: "🥇" },
          { rank: "2", name: "Sarah K.", score: "128", medal: "🥈" },
          { rank: "3", name: "Chris L.", score: "115", medal: "🥉" },
        ].map((p) => (
          <div key={p.rank} className="flex items-center gap-2 text-[10px]">
            <span>{p.medal}</span>
            <span className="text-white/40 flex-1">{p.name}</span>
            <span className="text-amber-400/60">{p.score} pts</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: BarChart3, title: "Reports", desc: "Deep analytics with exportable insights.",
    detail: "Custom date ranges, agent comparisons, conversion funnels, and PDF/CSV exports.",
    gradient: "from-indigo-500/20 to-blue-500/20", borderGlow: "group-hover:shadow-indigo-500/20",
    size: "normal" as const,
    mockUI: (
      <div className="mt-4">
        <div className="flex items-end gap-1 h-10">
          {[30, 50, 35, 70, 55, 80, 65, 90, 75, 60].map((h, i) => (
            <div key={i} className="flex-1 rounded-t-sm bg-gradient-to-t from-indigo-500/30 to-blue-500/10" style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[8px] text-white/15">Jan</span>
          <span className="text-[8px] text-white/15">Dec</span>
        </div>
      </div>
    ),
  },
  {
    icon: GraduationCap, title: "Training", desc: "Onboard agents with a world-class portal.",
    detail: "Video courses, quizzes, certification tracking, and structured learning paths for your team.",
    gradient: "from-purple-500/20 to-violet-500/20", borderGlow: "group-hover:shadow-purple-500/20",
    size: "normal" as const,
    mockUI: (
      <div className="mt-4 space-y-1.5">
        {[
          { name: "Sales Fundamentals", progress: 100 },
          { name: "Product Knowledge", progress: 68 },
          { name: "Objection Handling", progress: 25 },
        ].map((c) => (
          <div key={c.name} className="space-y-0.5">
            <div className="flex justify-between">
              <span className="text-[9px] text-white/30">{c.name}</span>
              <span className="text-[9px] text-purple-400/50">{c.progress}%</span>
            </div>
            <div className="h-1 rounded-full bg-white/5">
              <div className="h-full rounded-full bg-gradient-to-r from-purple-500/50 to-violet-500/50" style={{ width: `${c.progress}%` }} />
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: Settings, title: "Settings", desc: "Complete control over every detail.",
    detail: "Branding, permissions, phone configuration, dispositions, DNC management, and more.",
    gradient: "from-slate-500/20 to-zinc-500/20", borderGlow: "group-hover:shadow-slate-500/20",
    size: "normal" as const,
    mockUI: (
      <div className="mt-4 space-y-1.5">
        {["Company Branding", "User Management", "Phone Settings", "Dispositions"].map((s) => (
          <div key={s} className="flex items-center justify-between rounded-lg bg-black/20 px-2 py-1">
            <span className="text-[10px] text-white/30">{s}</span>
            <ChevronRight className="w-3 h-3 text-white/15" />
          </div>
        ))}
      </div>
    ),
  },
];

const platformTabs = [
  {
    id: "ai", label: "AI & Automation", icon: Brain,
    color: "from-violet-500 to-indigo-500",
    features: ["AI Agents handle outreach 24/7", "Smart lead scoring & prioritization", "Automated campaign sequences", "Intelligent appointment booking"],
    stat: "18x", statLabel: "more appointments booked",
  },
  {
    id: "comm", label: "Communication", icon: Headphones,
    color: "from-emerald-500 to-teal-500",
    features: ["HD VoIP with live call scripts", "Unified SMS & email inbox", "Call recording & transcription", "Voicemail drops & templates"],
    stat: "2.4M", statLabel: "calls made monthly",
  },
  {
    id: "mgmt", label: "Management", icon: Target,
    color: "from-blue-500 to-cyan-500",
    features: ["CRM with leads, clients & recruits", "Google Calendar 2-way sync", "Custom dispositions & workflows", "Role-based permissions"],
    stat: "50%", statLabel: "faster agent onboarding",
  },
  {
    id: "perf", label: "Performance", icon: TrendingUp,
    color: "from-amber-500 to-orange-500",
    features: ["Real-time leaderboards & badges", "Custom analytics dashboards", "Goal tracking & benchmarks", "Exportable reports (PDF/CSV)"],
    stat: "40%", statLabel: "increase in close rates",
  },
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
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Separate hero features (3 large) from normal features (8 standard)
  const heroFeatures = allFeatures.filter(f => f.size === "hero");
  const normalFeatures = allFeatures.filter(f => f.size === "normal");

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
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center justify-between">
          <a href="#hero" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">AgentFlow</span>
          </a>

          <div className="flex items-center gap-10 text-sm text-white/50">
            {[
              { label: "Features", href: "#features" },
              { label: "Platform", href: "#platform" },
              { label: "Testimonials", href: "#proof" },
            ].map((link) => (
              <a key={link.label} href={link.href} className="hover:text-white transition-colors duration-200">{link.label}</a>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Button variant="ghost" className="text-white/60 hover:text-white hover:bg-white/5" onClick={() => navigate("/login")}>
              Sign In
            </Button>
            <Button
              className="bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-400 hover:to-cyan-400 text-white border-0 shadow-lg shadow-indigo-500/25"
              onClick={() => navigate("/signup")}
            >
              Get Started <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        </div>
      </motion.nav>

      {/* ─── HERO ─── */}
      <Section id="hero" className="relative pt-44 pb-36 px-8">
        {/* mesh gradient bg */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[900px] h-[700px] rounded-full bg-indigo-600/12 blur-[140px]" />
          <div className="absolute top-1/3 left-1/4 w-[500px] h-[500px] rounded-full bg-cyan-600/8 blur-[120px]" />
          <div className="absolute top-1/2 right-1/4 w-[400px] h-[400px] rounded-full bg-emerald-600/6 blur-[100px]" />
        </div>

        <div className="relative max-w-6xl mx-auto text-center">
          {/* badges */}
          <motion.div variants={fadeUp} custom={0} className="flex justify-center gap-3 mb-8">
            {[
              { label: "v2.0 Now Live", icon: Sparkles },
              { label: "AI-Powered", icon: Bot },
              { label: "10k+ Agents Active", icon: Users },
            ].map(({ label, icon: Icon }) => (
              <span key={label} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-white/5 border border-white/10 text-white/60 backdrop-blur-sm">
                <Icon className="w-3 h-3 text-indigo-400" />
                {label}
              </span>
            ))}
          </motion.div>

          <motion.h1 variants={fadeUp} custom={1} className="text-7xl font-bold tracking-tight leading-[1.08] mb-6">
            <span className="bg-gradient-to-b from-white via-white/90 to-white/50 bg-clip-text text-transparent">
              The Complete AI Workforce
            </span>
            <br />
            <span className="bg-gradient-to-r from-indigo-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              for Modern Insurance Agents
            </span>
          </motion.h1>

          <motion.p variants={fadeUp} custom={2} className="text-xl text-white/45 max-w-2xl mx-auto mb-12 leading-relaxed">
            Automate your lead flow, master your calendar, and close more policies with AgentFlow's all-in-one AI ecosystem.
          </motion.p>

          <motion.div variants={fadeUp} custom={3} className="flex items-center justify-center gap-5">
            <MagneticButton
              className="relative px-9 py-4 rounded-xl font-semibold text-white bg-gradient-to-r from-indigo-500 to-cyan-500 shadow-2xl shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-shadow duration-300 group"
              onClick={() => navigate("/signup")}
            >
              <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-400 to-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <span className="relative flex items-center gap-2">
                Get Started for Free <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </MagneticButton>

            <MagneticButton className="flex items-center gap-2 px-7 py-4 rounded-xl font-medium text-white/60 hover:text-white border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all duration-300">
              <Play className="w-4 h-4" /> Watch the Demo
            </MagneticButton>
          </motion.div>

          {/* floating stat badges around hero */}
          <div className="relative mt-20">
            <motion.div variants={fadeUp} custom={5} className="absolute -left-4 top-8 z-10">
              <div className="px-4 py-3 rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-xl">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xs text-white/40">Close Rate</p>
                    <p className="text-sm font-bold text-emerald-400">+40%</p>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div variants={fadeUp} custom={6} className="absolute -right-4 top-16 z-10">
              <div className="px-4 py-3 rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-xl">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-xs text-white/40">Time Saved</p>
                    <p className="text-sm font-bold text-indigo-400">12h/week</p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* hero visual */}
            <motion.div variants={fadeUp} custom={4} className="relative mx-auto max-w-5xl">
              <div className="absolute -inset-4 bg-gradient-to-r from-indigo-500/15 via-cyan-500/10 to-emerald-500/15 rounded-2xl blur-xl" />
              <div className="relative rounded-2xl border border-white/10 bg-black/40 backdrop-blur-sm overflow-hidden aspect-[16/9]">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/40 via-black/20 to-cyan-950/40" />
                <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)", backgroundSize: "40px 40px" }} />
                {/* mock dashboard inside hero */}
                <div className="absolute inset-4 flex flex-col">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-500/50" />
                      <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                      <div className="w-3 h-3 rounded-full bg-green-500/50" />
                    </div>
                    <div className="flex-1 h-6 rounded-md bg-white/5 max-w-xs" />
                  </div>
                  <div className="flex flex-1 gap-3">
                    {/* sidebar mock */}
                    <div className="w-44 rounded-lg bg-white/[0.03] border border-white/5 p-3 space-y-2">
                      {["Dashboard", "Dialer", "Contacts", "Calendar", "AI Agents"].map((item, i) => (
                        <div key={item} className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[10px] ${i === 0 ? "bg-indigo-500/15 text-indigo-400" : "text-white/25"}`}>
                          <div className="w-3 h-3 rounded bg-white/10" />
                          {item}
                        </div>
                      ))}
                    </div>
                    {/* main content mock */}
                    <div className="flex-1 space-y-3">
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { label: "Total Leads", val: "2,847", color: "text-blue-400" },
                          { label: "Calls Today", val: "142", color: "text-emerald-400" },
                          { label: "Appointments", val: "28", color: "text-violet-400" },
                          { label: "Policies", val: "12", color: "text-amber-400" },
                        ].map((card) => (
                          <div key={card.label} className="rounded-lg bg-white/[0.03] border border-white/5 p-2.5">
                            <p className="text-[9px] text-white/25">{card.label}</p>
                            <p className={`text-sm font-bold ${card.color}`}>{card.val}</p>
                          </div>
                        ))}
                      </div>
                      <div className="flex-1 rounded-lg bg-white/[0.03] border border-white/5 p-3">
                        <div className="flex items-end gap-1 h-24">
                          {[40, 65, 45, 80, 55, 70, 90, 60, 75, 85, 50, 95].map((h, i) => (
                            <div key={i} className="flex-1 rounded-t-sm bg-gradient-to-t from-indigo-500/30 to-cyan-500/10" style={{ height: `${h}%` }} />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </Section>

      {/* ─── TRUSTED BY ─── */}
      <Section className="py-16 px-8 border-y border-white/5">
        <motion.p variants={fadeUp} custom={0} className="text-center text-xs text-white/25 uppercase tracking-[0.2em] mb-8">
          Trusted by leading agencies nationwide
        </motion.p>
        <div className="relative overflow-hidden max-w-5xl mx-auto">
          <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-[#030303] to-transparent z-10" />
          <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-[#030303] to-transparent z-10" />
          <motion.div
            animate={{ x: [0, -1200] }}
            transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
            className="flex gap-20 items-center whitespace-nowrap"
          >
            {[...trustedLogos, ...trustedLogos].map((logo, i) => (
              <span key={i} className="text-lg font-semibold text-white/[0.08] hover:text-white/15 transition-colors select-none">{logo}</span>
            ))}
          </motion.div>
        </div>
      </Section>

      {/* ─── FEATURES BENTO GRID ─── */}
      <Section id="features" className="py-36 px-8">
        <div className="max-w-7xl mx-auto">
          <motion.div variants={fadeUp} custom={0} className="text-center mb-20">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-white/5 border border-white/10 text-cyan-400 mb-5">
              <Sparkles className="w-3 h-3" /> Features
            </span>
            <h2 className="text-5xl font-bold tracking-tight bg-gradient-to-b from-white to-white/50 bg-clip-text text-transparent mb-5">
              Everything you need to dominate
            </h2>
            <p className="text-white/35 max-w-xl mx-auto text-lg">One platform, zero excuses. Every tool an insurance agent needs — unified and intelligent.</p>
          </motion.div>

          {/* Hero feature cards — 3 large */}
          <div className="grid grid-cols-3 gap-5 mb-5">
            {heroFeatures.map((f, i) => (
              <motion.div
                key={f.title}
                variants={fadeUp}
                custom={i}
                className={`group relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm p-7 hover:border-white/15 transition-all duration-500 overflow-hidden shadow-lg ${f.borderGlow} hover:shadow-xl`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${f.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                <div className="relative z-10">
                  <div className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 group-hover:bg-white/10 transition-colors">
                    <f.icon className="w-5 h-5 text-white/50 group-hover:text-white transition-colors" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-1.5">{f.title}</h3>
                  <p className="text-sm text-white/40 mb-1">{f.desc}</p>
                  <p className="text-sm text-white/20 group-hover:text-white/35 transition-colors">{f.detail}</p>
                  {f.mockUI}
                </div>
              </motion.div>
            ))}
          </div>

          {/* Normal feature cards — 4-column grid */}
          <div className="grid grid-cols-4 gap-5">
            {normalFeatures.map((f, i) => (
              <motion.div
                key={f.title}
                variants={fadeUp}
                custom={i + 3}
                className={`group relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm p-6 hover:border-white/15 transition-all duration-500 overflow-hidden ${f.borderGlow} hover:shadow-lg`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${f.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                <div className="relative z-10">
                  <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center mb-3 group-hover:bg-white/10 transition-colors">
                    <f.icon className="w-4 h-4 text-white/50 group-hover:text-white transition-colors" />
                  </div>
                  <h3 className="text-base font-semibold text-white mb-1">{f.title}</h3>
                  <p className="text-xs text-white/35">{f.desc}</p>
                  {f.mockUI}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ─── PLATFORM DEEP-DIVE ─── */}
      <Section id="platform" className="py-36 px-8">
        <div className="max-w-6xl mx-auto">
          <motion.div variants={fadeUp} custom={0} className="text-center mb-16">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-white/5 border border-white/10 text-indigo-400 mb-5">
              <Zap className="w-3 h-3" /> Platform
            </span>
            <h2 className="text-5xl font-bold tracking-tight bg-gradient-to-b from-white to-white/50 bg-clip-text text-transparent mb-5">
              Built for every workflow
            </h2>
            <p className="text-white/35 max-w-lg mx-auto text-lg">Four pillars powering the modern insurance agency.</p>
          </motion.div>

          {/* tabs */}
          <motion.div variants={fadeUp} custom={1} className="flex justify-center gap-2 mb-12">
            {platformTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium transition-all duration-300 ${
                  activeTab === t.id
                    ? "bg-white/10 text-white border border-white/15 shadow-lg"
                    : "text-white/35 hover:text-white/55 border border-transparent hover:bg-white/[0.03]"
                }`}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </motion.div>

          {/* tab content */}
          <AnimatePresence mode="wait">
            {platformTabs.map(
              (t) =>
                activeTab === t.id && (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.4 }}
                    className="relative rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden"
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br ${t.color} opacity-[0.05]`} />
                    <div className="relative grid grid-cols-2 gap-0">
                      {/* left: features list */}
                      <div className="p-12 border-r border-white/5">
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${t.color} flex items-center justify-center mb-6`}>
                          <t.icon className="w-6 h-6 text-white" />
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-2">{t.label}</h3>
                        <div className="space-y-3 mt-6">
                          {t.features.map((feat, i) => (
                            <div key={i} className="flex items-center gap-3">
                              <CheckCircle2 className="w-4 h-4 text-emerald-400/60 shrink-0" />
                              <span className="text-sm text-white/50">{feat}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {/* right: big stat + visual */}
                      <div className="p-12 flex flex-col items-center justify-center text-center">
                        <div className={`text-7xl font-black bg-gradient-to-r ${t.color} bg-clip-text text-transparent mb-3`}>
                          {t.stat}
                        </div>
                        <p className="text-white/40 text-lg">{t.statLabel}</p>
                        <div className="mt-8 flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10">
                          <Shield className="w-4 h-4 text-white/30" />
                          <span className="text-xs text-white/30">Enterprise-grade security</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )
            )}
          </AnimatePresence>
        </div>
      </Section>

      {/* ─── STATS ─── */}
      <Section className="py-24 px-8 border-y border-white/5">
        <div className="max-w-5xl mx-auto grid grid-cols-4 gap-12">
          {[
            { num: "10,000+", label: "Active Agents" },
            { num: "2.4M", label: "Calls Made" },
            { num: "98%", label: "Uptime SLA" },
            { num: "4.9/5", label: "User Rating" },
          ].map((s, i) => (
            <motion.div key={s.label} variants={fadeUp} custom={i} className="text-center">
              <div className="text-4xl font-bold bg-gradient-to-r from-indigo-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">{s.num}</div>
              <div className="text-sm text-white/30 mt-2">{s.label}</div>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ─── TESTIMONIALS ─── */}
      <Section id="proof" className="py-36 px-8">
        <div className="max-w-6xl mx-auto">
          <motion.div variants={fadeUp} custom={0} className="text-center mb-16">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-white/5 border border-white/10 text-emerald-400 mb-5">
              <Star className="w-3 h-3" /> Testimonials
            </span>
            <h2 className="text-5xl font-bold tracking-tight bg-gradient-to-b from-white to-white/50 bg-clip-text text-transparent">
              Loved by top producers
            </h2>
          </motion.div>

          <div className="grid grid-cols-3 gap-6">
            {[
              { name: "Sarah Chen", role: "Agency Owner · 45 agents", quote: "AgentFlow replaced 5 tools for us. Our close rate jumped 40% in the first 3 months. The AI agents alone pay for themselves.", avatar: "SC" },
              { name: "Marcus Williams", role: "Top Producer · $1.2M ARR", quote: "The AI agents book me 15+ appointments a week while I focus on closing. I've never been this productive in my career.", avatar: "MW" },
              { name: "Jennifer Park", role: "Team Lead · 12 agents", quote: "Onboarding new agents went from 2 weeks to 2 days with the Training Vault. The leaderboard keeps everyone motivated.", avatar: "JP" },
            ].map((t, i) => (
              <motion.div key={t.name} variants={fadeUp} custom={i} className="group rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 backdrop-blur-sm hover:border-white/10 transition-all duration-500">
                <div className="flex gap-1 mb-5">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-white/55 text-sm mb-8 leading-relaxed">"{t.quote}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-xs font-bold text-white">
                    {t.avatar}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{t.name}</p>
                    <p className="text-xs text-white/30">{t.role}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ─── CTA ─── */}
      <Section className="py-36 px-8">
        <div className="max-w-3xl mx-auto text-center relative">
          <div className="absolute inset-0 -m-24 rounded-full bg-indigo-600/8 blur-[120px] pointer-events-none" />
          <div className="absolute inset-0 -m-16 rounded-full bg-cyan-600/5 blur-[100px] pointer-events-none" />
          <motion.div variants={fadeUp} custom={0} className="relative">
            <h2 className="text-5xl font-bold tracking-tight bg-gradient-to-b from-white to-white/50 bg-clip-text text-transparent mb-6">
              Ready to transform your agency?
            </h2>
            <p className="text-white/35 mb-12 max-w-lg mx-auto text-lg">
              Join 10,000+ insurance agents already using AgentFlow to automate, grow, and win.
            </p>
            <div className="flex items-center justify-center gap-5">
              <MagneticButton
                className="px-10 py-4 rounded-xl font-semibold text-white bg-gradient-to-r from-indigo-500 to-cyan-500 shadow-2xl shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-shadow duration-300"
                onClick={() => navigate("/signup")}
              >
                <span className="flex items-center gap-2">
                  Start Free Trial <ArrowRight className="w-4 h-4" />
                </span>
              </MagneticButton>
              <MagneticButton className="flex items-center gap-2 px-7 py-4 rounded-xl font-medium text-white/50 hover:text-white border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all duration-300">
                <MessageSquare className="w-4 h-4" /> Talk to Sales
              </MagneticButton>
            </div>
          </motion.div>
        </div>
      </Section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-white/5 py-16 px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-5 gap-12">
            <div className="col-span-2">
              <div className="flex items-center gap-2.5 mb-5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-white" />
                </div>
                <span className="text-lg font-bold">AgentFlow</span>
              </div>
              <p className="text-sm text-white/25 max-w-xs leading-relaxed">
                The all-in-one AI-powered platform built exclusively for modern life insurance agents.
              </p>
            </div>
            {Object.entries(footerLinks).map(([title, links]) => (
              <div key={title}>
                <p className="text-sm font-semibold text-white/50 mb-4">{title}</p>
                <ul className="space-y-2.5">
                  {links.map((l) => (
                    <li key={l}>
                      <a href="#" className="text-sm text-white/20 hover:text-white/45 transition-colors">{l}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-16 pt-8 border-t border-white/5 flex items-center justify-between">
            <p className="text-xs text-white/15">© 2026 AgentFlow. All rights reserved.</p>
            <div className="flex gap-6">
              <a href="#" className="text-xs text-white/15 hover:text-white/35 transition-colors">Terms</a>
              <a href="#" className="text-xs text-white/15 hover:text-white/35 transition-colors">Privacy</a>
              <a href="#" className="text-xs text-white/15 hover:text-white/35 transition-colors">Cookies</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
