import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion";
import {
  Phone, TrendingUp, Calendar, Users, Megaphone, Bot, Trophy,
  MessageSquare, GraduationCap, Shield, Upload, Palette, Clock, Zap,
  CheckCircle, Play, ChevronRight, Sparkles, LayoutDashboard, Database,
  ArrowRight, Activity, BarChart3, Globe, Layers, Settings,
} from "lucide-react";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

/* ──────────────────────────────────────────────
   ANIMATION VARIANTS
   ────────────────────────────────────────────── */
const fadeInUp = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } },
};

const staggerContainer = {
  visible: { transition: { staggerChildren: 0.1 } },
};

/* ──────────────────────────────────────────────
   COMPONENTS
   ────────────────────────────────────────────── */

const GlowOrb = ({ className, color = "primary", size = "w-64 h-64", delay = 0 }) => (
  <motion.div
    className={`absolute rounded-full blur-[120px] opacity-20 pointer-events-none ${size} ${className} bg-${color}`}
    animate={{
      scale: [1, 1.2, 1],
      opacity: [0.15, 0.25, 0.15],
    }}
    transition={{
      duration: 8,
      repeat: Infinity,
      delay,
      ease: "easeInOut",
    }}
  />
);

const FeatureCard = ({ icon: Icon, title, desc, delay = 0 }) => (
  <motion.div
    variants={fadeInUp}
    className="group relative p-8 rounded-3xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] transition-all duration-500 overflow-hidden"
  >
    <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
    <div className="relative z-10">
      <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-500">
        <Icon className="text-primary" size={24} />
      </div>
      <h3 className="text-xl font-bold mb-3 text-white">{title}</h3>
      <p className="text-white/60 leading-relaxed">{desc}</p>
    </div>
  </motion.div>
);

const SectionHeading = ({ badge, title, desc, center = true }) => (
  <div className={`mb-16 ${center ? "text-center" : "text-left"}`}>
    <motion.span
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold tracking-widest uppercase mb-6"
    >
      <Sparkles size={14} /> {badge}
    </motion.span>
    <motion.h2
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: 0.1 }}
      className="text-4xl md:text-6xl font-black mb-6 tracking-tight text-white leading-tight"
    >
      {title}
    </motion.h2>
    <motion.p
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: 0.2 }}
      className="text-xl text-white/50 max-w-3xl mx-auto leading-relaxed"
    >
      {desc}
    </motion.p>
  </div>
);

const TechBadge = ({ children }) => (
  <span className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest text-white/40 group-hover:text-primary group-hover:border-primary/30 transition-colors">
    {children}
  </span>
);

/* ══════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════ */
const LandingPageTest1: React.FC = () => {
  const { scrollYProgress } = useScroll();
  const y1 = useTransform(scrollYProgress, [0, 1], [0, -200]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, -500]);
  const scale = useTransform(scrollYProgress, [0, 0.2], [1, 1.05]);

  return (
    <div className="min-h-screen bg-[#030303] text-white selection:bg-primary/30 selection:text-white overflow-x-hidden">
      <MarketingNav />

      {/* ── HERO SECTION ── */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden">
        {/* Background elements */}
        <GlowOrb className="-top-20 -left-20 bg-primary" size="w-96 h-96" />
        <GlowOrb className="top-1/2 -right-40 bg-purple-600" size="w-[500px] h-[500px]" delay={2} />
        
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-0 w-full h-full opacity-10" 
            style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.05) 1px, transparent 0)', backgroundSize: '60px 60px' }} 
          />
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-md mb-8"
            >
              <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="text-sm font-bold tracking-tight text-white/80 uppercase">Experience FFL AgentFlow 2.0</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              className="text-6xl md:text-[100px] font-black tracking-tighter mb-8 leading-[0.9] bg-gradient-to-b from-white to-white/40 bg-clip-text text-transparent"
            >
              CLOSE MORE. <br />
              <span className="text-primary italic">EFFORTLESSLY.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="text-xl md:text-2xl text-white/60 mb-12 max-w-3xl mx-auto leading-relaxed font-medium"
            >
              The first truly intelligent insurance portal. Harness the power of AI agents, 
              predictive dialing, and real-time behavioral analytics to dominate your market.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-6"
            >
              <Link
                to="/login"
                className="group relative h-16 px-12 rounded-2xl bg-primary text-black font-black text-lg flex items-center justify-center gap-3 overflow-hidden hover:scale-105 transition-all duration-300 shadow-[0_0_40px_rgba(var(--primary-rgb),0.3)]"
              >
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <span className="relative">Start Scaling</span>
                <ChevronRight className="relative group-hover:translate-x-1 transition-transform" />
              </Link>
              <button className="h-16 px-12 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md font-bold text-lg flex items-center justify-center gap-3 hover:bg-white/10 transition-all duration-300">
                <Play size={20} fill="currentColor" /> Watch Demo
              </button>
            </motion.div>
          </div>

          {/* Hero Visual - Real Dashboard */}
          <motion.div
            style={{ scale }}
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="mt-24 relative"
          >
            <div className="relative group p-1 rounded-[40px] bg-gradient-to-b from-primary/30 to-transparent shadow-[0_0_100px_rgba(var(--primary-rgb),0.15)]">
              <div className="rounded-[38px] overflow-hidden border border-white/10 bg-black/50 backdrop-blur-3xl">
                <img 
                  src="/test1/dashboard.png" 
                  alt="FFL AgentFlow Real Portal" 
                  className="w-full h-auto object-cover opacity-90 group-hover:opacity-100 transition-opacity duration-1000"
                />
              </div>
              
              {/* Floating Stat 1 */}
              <motion.div 
                style={{ y: y1 }}
                className="absolute -top-16 -right-8 p-6 rounded-[32px] bg-black/80 backdrop-blur-2xl border border-white/10 shadow-2xl hidden lg:block z-20"
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 flex items-center justify-center text-emerald-500">
                    <TrendingUp size={28} />
                  </div>
                  <div>
                    <p className="text-[10px] text-white/40 uppercase font-black tracking-[0.2em] mb-1">Live Efficiency</p>
                    <p className="text-3xl font-black text-white">+84%</p>
                  </div>
                </div>
              </motion.div>

              {/* Floating Stat 2 */}
              <motion.div 
                style={{ y: y2 }}
                className="absolute top-1/2 -left-24 p-6 rounded-[32px] bg-black/80 backdrop-blur-2xl border border-white/10 shadow-2xl hidden lg:block z-20"
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center text-primary">
                    <Phone size={28} />
                  </div>
                  <div>
                    <p className="text-[10px] text-white/40 uppercase font-black tracking-[0.2em] mb-1">Active Dials</p>
                    <p className="text-3xl font-black text-white">4,812</p>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── LOGO MARQUEE ── */}
      <section className="py-24 border-y border-white/5 bg-white/[0.01] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-[#030303] via-transparent to-[#030303] z-10 pointer-events-none" />
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-[10px] font-black uppercase tracking-[0.5em] text-white/20 mb-16">
            The standard for high-volume insurance agencies
          </p>
          <div className="flex flex-wrap justify-center items-center gap-16 md:gap-32 opacity-20 hover:opacity-60 transition-opacity duration-700">
            {["PACIFIC LIFE", "SUMMIT", "HERITAGE", "PINNACLE", "CORNERSTONE"].map((brand) => (
              <span key={brand} className="text-3xl font-black tracking-tighter text-white hover:text-primary transition-colors cursor-default">{brand}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── BENTO FEATURES ── */}
      <section className="py-40 relative">
        <GlowOrb className="top-1/4 left-1/2 -translate-x-1/2 bg-blue-600" size="w-[800px] h-[800px]" />
        
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <SectionHeading 
            badge="The Infrastructure"
            title="Everything. Built In."
            desc="Stop stitching tools together. FFL AgentFlow provides a unified technical stack designed for maximum conversion and zero friction."
          />

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
            {/* Feature 1: Power Dialer (Wide) */}
            <motion.div 
              variants={fadeInUp}
              className="md:col-span-8 group relative p-12 rounded-[48px] border border-white/10 bg-white/[0.02] overflow-hidden min-h-[500px]"
            >
              <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-primary/10 to-transparent pointer-events-none opacity-40 group-hover:opacity-100 transition-opacity duration-700" />
              
              <div className="relative z-10 max-w-lg">
                <div className="w-16 h-16 rounded-[24px] bg-primary/20 flex items-center justify-center mb-10 group-hover:scale-110 transition-transform">
                  <Phone className="text-primary" size={32} />
                </div>
                <h3 className="text-4xl font-black mb-6">High-Velocity Dialer</h3>
                <p className="text-xl text-white/50 mb-10 leading-relaxed font-medium">
                  Our predictive engine eliminates silence. Reach more leads per hour with multi-line dialing, local presence, and automated disposition logic.
                </p>
                <div className="flex flex-wrap gap-3 mb-10">
                  <TechBadge>Predictive Engine</TechBadge>
                  <TechBadge>Local Presence</TechBadge>
                  <TechBadge>TCPA Compliant</TechBadge>
                  <TechBadge>Instant CRM Sync</TechBadge>
                </div>
                <button className="flex items-center gap-3 text-primary text-lg font-black hover:gap-5 transition-all">
                  Launch the Dialer <ArrowRight size={20} />
                </button>
              </div>

              <div className="absolute right-[-10%] bottom-[-10%] w-[60%] rotate-[-4deg] group-hover:rotate-0 group-hover:scale-105 transition-all duration-1000 hidden lg:block">
                <img src="/test1/dialer.png" alt="Active Dialer UI" className="rounded-3xl border border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.8)]" />
              </div>
            </motion.div>

            {/* Feature 2: AI Agents (Small) */}
            <motion.div 
              variants={fadeInUp}
              className="md:col-span-4 group p-10 rounded-[48px] border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] transition-all duration-500 overflow-hidden"
            >
              <div className="w-16 h-16 rounded-[24px] bg-blue-500/20 flex items-center justify-center mb-10">
                <Bot className="text-blue-500" size={32} />
              </div>
              <h3 className="text-3xl font-black mb-4">AI Outreach</h3>
              <p className="text-white/50 mb-8 leading-relaxed font-medium">
                Autonomous agents that qualify leads via Voice, SMS, and Email 24/7.
              </p>
              <div className="space-y-4">
                {["Natural Voice Synthesis", "Calendar Integration", "Lead Nurture Loops"].map(item => (
                  <div key={item} className="flex items-center gap-3 text-sm font-bold text-white/80">
                    <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center">
                      <CheckCircle size={14} className="text-blue-500" />
                    </div>
                    {item}
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Feature 3: Smart CRM (Small) */}
            <motion.div 
              variants={fadeInUp}
              className="md:col-span-4 group p-10 rounded-[48px] border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] transition-all duration-500 overflow-hidden"
            >
              <div className="w-16 h-16 rounded-[24px] bg-emerald-500/20 flex items-center justify-center mb-10">
                <Users className="text-emerald-500" size={32} />
              </div>
              <h3 className="text-3xl font-black mb-4">Unified CRM</h3>
              <p className="text-white/50 mb-8 leading-relaxed font-medium">
                Deep lead intelligence with activity logs, recordings, and lifetime tracking.
              </p>
              <div className="space-y-4">
                {["Automated Lead Claim", "Smart Routing", "Bulk Operations"].map(item => (
                  <div key={item} className="flex items-center gap-3 text-sm font-bold text-white/80">
                    <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <CheckCircle size={14} className="text-emerald-500" />
                    </div>
                    {item}
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Feature 4: Real-time Stats (Wide) */}
            <motion.div 
              variants={fadeInUp}
              className="md:col-span-8 group relative p-12 rounded-[48px] border border-white/10 bg-white/[0.02] overflow-hidden min-h-[500px]"
            >
              <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-purple-500/10 to-transparent pointer-events-none opacity-40 group-hover:opacity-100 transition-opacity duration-700" />
              
              <div className="flex flex-col lg:flex-row items-center gap-16 h-full">
                <div className="flex-1">
                  <div className="w-16 h-16 rounded-[24px] bg-purple-500/20 flex items-center justify-center mb-10">
                    <Trophy className="text-purple-500" size={32} />
                  </div>
                  <h3 className="text-4xl font-black mb-6">Gamified Analytics</h3>
                  <p className="text-xl text-white/50 mb-10 leading-relaxed font-medium">
                    Transform your sales floor. Live leaderboards, sound alerts for sales, and deep ROI tracking for every lead source.
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-5 rounded-3xl bg-white/5 border border-white/5 group-hover:border-purple-500/30 transition-colors">
                      <p className="text-3xl font-black mb-1">$42k</p>
                      <p className="text-[10px] text-white/40 font-black uppercase tracking-widest">Avg Agency Lift</p>
                    </div>
                    <div className="p-5 rounded-3xl bg-white/5 border border-white/5 group-hover:border-purple-500/30 transition-colors">
                      <p className="text-3xl font-black mb-1">100%</p>
                      <p className="text-[10px] text-white/40 font-black uppercase tracking-widest">Transparency</p>
                    </div>
                  </div>
                </div>
                
                <div className="flex-1 w-full relative">
                  <div className="relative p-6 rounded-[32px] bg-black/60 border border-white/10 shadow-2xl space-y-6 overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-b from-purple-500/5 to-transparent pointer-events-none" />
                    {[
                      { name: "Maria S.", val: "84,200", color: "bg-primary", width: "95%" },
                      { name: "David P.", val: "72,150", color: "bg-blue-500", width: "82%" },
                      { name: "Rachel K.", val: "68,900", color: "bg-purple-500", width: "75%" },
                    ].map((agent, i) => (
                      <div key={i} className="space-y-3 relative z-10">
                        <div className="flex justify-between items-end">
                          <span className="text-sm font-black tracking-tight">{agent.name}</span>
                          <span className="text-lg font-black text-white/60">${agent.val}</span>
                        </div>
                        <div className="h-2.5 rounded-full bg-white/5 overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            whileInView={{ width: agent.width }}
                            transition={{ duration: 1, delay: 0.5 + (i * 0.2) }}
                            className={`h-full ${agent.color} shadow-[0_0_15px_rgba(var(--primary-rgb),0.5)]`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── SHOWCASE SECTION ── */}
      <section className="py-40 bg-white/[0.02] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/5 blur-[150px] -z-10" />
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row items-center gap-24">
            <div className="lg:w-1/2">
              <SectionHeading 
                center={false}
                badge="Virtual Workforce"
                title="AI Agents That Sound Human & Think Fast"
                desc="Deploy intelligent virtual agents like Maya and Dani to handle the heavy lifting. Our agents qualify intent, handle objections, and book appointments directly into your calendar."
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                {[
                  { icon: MessageSquare, title: "Smart SMS", desc: "Two-way conversational SMS for instant lead nurture." },
                  { icon: Globe, title: "Local Presence", desc: "Increase pick-up rates with local area code mapping." },
                  { icon: Layers, title: "Multi-Stack", desc: "Syncs with LeadVault, FEX, and custom lead sources." },
                  { icon: Shield, title: "Enterprise Grade", desc: "End-to-end encryption and TCPA compliance guardrails." }
                ].map((item, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="group"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-5 group-hover:bg-primary/20 group-hover:text-primary transition-all">
                      <item.icon size={24} />
                    </div>
                    <h4 className="text-lg font-black mb-2">{item.title}</h4>
                    <p className="text-sm text-white/40 leading-relaxed">{item.desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>
            
            <div className="lg:w-1/2 relative">
               <motion.div
                initial={{ opacity: 0, scale: 0.9, rotate: 2 }}
                whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                className="relative z-10 rounded-[40px] overflow-hidden border border-white/10 shadow-[0_0_100px_rgba(0,0,0,0.5)] bg-black"
               >
                 <img src="/test1/ai-agents.png" alt="Real AI Agents Interface" className="w-full h-auto opacity-90 hover:opacity-100 transition-opacity duration-700" />
               </motion.div>
               <div className="absolute -inset-10 bg-primary/20 blur-[120px] opacity-20 -z-10" />
               
               {/* Floating Overlay Card */}
               <motion.div 
                initial={{ opacity: 0, x: 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                className="absolute -bottom-10 -left-10 p-8 rounded-[32px] bg-black/90 backdrop-blur-2xl border border-white/10 shadow-2xl z-20 max-w-[280px]"
               >
                 <div className="flex items-center gap-3 mb-4">
                   <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />
                   <p className="text-xs font-black uppercase tracking-widest">Agent Active</p>
                 </div>
                 <p className="text-sm text-white/60 leading-relaxed font-medium">
                   "Hi John, this is Maya from FFL. I saw you were looking for coverage..."
                 </p>
               </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TECHNICAL BREAKDOWN ── */}
      <section className="py-40 relative">
        <div className="max-w-7xl mx-auto px-6">
          <SectionHeading 
            badge="The Technical Advantage"
            title="Engineered for Extreme Performance"
            desc="We didn't just build a wrapper. We built a high-performance engine for the insurance industry's most aggressive teams."
          />
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {[
              { label: "Latency", value: "<150ms", detail: "Global edge network", icon: Zap },
              { label: "Uptime", value: "99.99%", detail: "Enterprise stability", icon: Shield },
              { label: "Sync Speed", value: "Real-time", detail: "Instant CRM updates", icon: Clock },
              { label: "Security", value: "AES-256", detail: "Military-grade encryption", icon: Shield },
            ].map((item, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="p-8 rounded-[32px] border border-white/5 bg-white/[0.01] hover:bg-white/[0.03] transition-all group"
              >
                <item.icon className="text-primary/40 group-hover:text-primary transition-colors mb-6" size={24} />
                <p className="text-4xl font-black mb-2 tracking-tighter">{item.value}</p>
                <p className="text-xs font-black uppercase tracking-widest text-white/30 mb-2">{item.label}</p>
                <p className="text-xs text-white/20">{item.detail}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="py-40 relative overflow-hidden">
        <div className="absolute inset-0 bg-primary opacity-[0.03]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-primary/10 blur-[180px] -z-10" />
        
        <div className="max-w-5xl mx-auto px-6 text-center relative z-10">
          <motion.h2 
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            className="text-6xl md:text-[100px] font-black mb-12 tracking-tighter leading-[0.9]"
          >
            STOP DIALING. <br />
            <span className="text-primary italic">START CLOSING.</span>
          </motion.h2>
          <p className="text-2xl text-white/50 mb-16 max-w-3xl mx-auto font-medium leading-relaxed">
            Join 500+ high-performance agencies that have moved to FFL AgentFlow. 
            No setup fees. No long-term contracts. Just raw production.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-8">
            <Link
              to="/signup"
              className="h-20 px-16 rounded-[24px] bg-white text-black font-black text-xl flex items-center justify-center hover:scale-105 transition-all shadow-[0_20px_50px_rgba(255,255,255,0.1)]"
            >
              Get Started for Free
            </Link>
            <div className="flex flex-col items-center sm:items-start text-left">
              <p className="text-white/40 font-black uppercase tracking-widest text-xs mb-1">Risk Free Trial</p>
              <p className="text-sm text-white/20 font-bold">14-day trial • No credit card needed</p>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

export default LandingPageTest1;
