import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion";
import {
  Phone, TrendingUp, Calendar, Users, Megaphone, Bot, Trophy,
  MessageSquare, GraduationCap, Shield, Upload, Palette, Clock, Zap,
  CheckCircle, Play, ChevronRight, Sparkles, LayoutDashboard, Database,
  ArrowRight,
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

const glassVariant = {
  initial: { backdropFilter: "blur(0px)", backgroundColor: "rgba(255, 255, 255, 0)" },
  animate: { backdropFilter: "blur(12px)", backgroundColor: "rgba(255, 255, 255, 0.03)" },
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
      className="text-4xl md:text-5xl font-black mb-6 tracking-tight text-white"
    >
      {title}
    </motion.h2>
    <motion.p
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: 0.2 }}
      className="text-lg text-white/50 max-w-2xl mx-auto"
    >
      {desc}
    </motion.p>
  </div>
);

/* ══════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════ */
const LandingPageTest1: React.FC = () => {
  const { scrollYProgress } = useScroll();
  const y1 = useTransform(scrollYProgress, [0, 1], [0, -200]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, -500]);

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-primary/30 selection:text-white overflow-x-hidden">
      <MarketingNav />

      {/* ── HERO SECTION ── */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden">
        {/* Background elements */}
        <GlowOrb className="-top-20 -left-20 bg-primary" size="w-96 h-96" />
        <GlowOrb className="top-1/2 -right-40 bg-purple-600" size="w-[500px] h-[500px]" delay={2} />
        
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-0 w-full h-full opacity-20" 
            style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.05) 1px, transparent 0)', backgroundSize: '40px 40px' }} 
          />
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-md mb-8"
            >
              <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="text-sm font-medium text-white/80">FFL AgentFlow 2.0 is now live</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              className="text-5xl md:text-8xl font-black tracking-tighter mb-8 leading-[1.1] bg-gradient-to-b from-white to-white/40 bg-clip-text text-transparent"
            >
              The Future of <br />
              <span className="text-primary italic">Life Insurance Sales</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="text-lg md:text-xl text-white/60 mb-12 max-w-2xl mx-auto leading-relaxed"
            >
              Unleash the power of AI agents, hyper-speed dialing, and real-time intelligence. 
              FFL AgentFlow is the high-performance engine for modern insurance teams.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <Link
                to="/login"
                className="group relative h-14 px-10 rounded-2xl bg-primary text-black font-bold flex items-center justify-center gap-2 overflow-hidden hover:scale-105 transition-transform duration-300"
              >
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <span className="relative">Start Scaling Now</span>
                <ChevronRight className="relative group-hover:translate-x-1 transition-transform" />
              </Link>
              <button className="h-14 px-10 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md font-bold flex items-center justify-center gap-2 hover:bg-white/10 transition-colors duration-300">
                <Play size={18} fill="currentColor" /> Watch the Portal in Action
              </button>
            </motion.div>
          </div>

          {/* Hero Visual */}
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="mt-24 relative"
          >
            <div className="relative group p-1 rounded-[32px] bg-gradient-to-b from-primary/50 to-transparent shadow-[0_0_80px_rgba(var(--primary-rgb),0.2)]">
              <div className="rounded-[30px] overflow-hidden border border-white/10 bg-black">
                <img 
                  src="/test1/hero.png" 
                  alt="FFL AgentFlow Dashboard" 
                  className="w-full h-auto object-cover opacity-90 group-hover:opacity-100 transition-opacity duration-700"
                />
              </div>
              
              {/* Floating elements */}
              <motion.div 
                style={{ y: y1 }}
                className="absolute -top-12 -right-12 p-6 rounded-3xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl hidden lg:block"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center text-green-500">
                    <TrendingUp size={24} />
                  </div>
                  <div>
                    <p className="text-xs text-white/40 uppercase font-bold tracking-widest">Efficiency</p>
                    <p className="text-2xl font-black text-white">+42%</p>
                  </div>
                </div>
              </motion.div>

              <motion.div 
                style={{ y: y2 }}
                className="absolute top-1/2 -left-20 p-6 rounded-3xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl hidden lg:block"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                    <Phone size={24} />
                  </div>
                  <div>
                    <p className="text-xs text-white/40 uppercase font-bold tracking-widest">Daily Dials</p>
                    <p className="text-2xl font-black text-white">1,240+</p>
                  </div>
                </div>
              </motion.div>
            </div>
          </section>

      {/* ── LOGO MARQUEE ── */}
      <section className="py-20 border-y border-white/5 bg-white/[0.01]">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-xs font-bold uppercase tracking-[0.3em] text-white/30 mb-12">
            Trusted by the world's most aggressive agencies
          </p>
          <div className="flex flex-wrap justify-center items-center gap-12 md:gap-24 opacity-40 grayscale hover:grayscale-0 transition-all duration-500">
            {["Pacific Life", "Summit Financial", "Heritage", "Pinnacle", "Cornerstone"].map((brand) => (
              <span key={brand} className="text-2xl font-black tracking-tighter text-white">{brand}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── BENTO FEATURES ── */}
      <section className="py-32 relative">
        <GlowOrb className="top-1/4 left-1/2 -translate-x-1/2 bg-blue-600" size="w-[600px] h-[600px]" />
        
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <SectionHeading 
            badge="The Ecosystem"
            title="Engineered for Performance"
            desc="Every tool you need to scale your agency, built into one seamless, high-velocity environment."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Main Feature - Power Dialer */}
            <motion.div 
              variants={fadeInUp}
              className="md:col-span-2 group relative p-10 rounded-[40px] border border-white/10 bg-white/[0.02] overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-1/2 h-full opacity-30 group-hover:opacity-50 transition-opacity duration-700 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-l from-primary/20 to-transparent" />
              </div>
              
              <div className="relative z-10 max-w-md">
                <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center mb-8">
                  <Phone className="text-primary" size={28} />
                </div>
                <h3 className="text-3xl font-black mb-4">Hyper-Speed Power Dialer</h3>
                <p className="text-white/60 mb-8 leading-relaxed">
                  Eliminate wait times with our predictive engine. Preview leads, drop voicemails, and disposition calls in milliseconds.
                </p>
                <ul className="space-y-4 mb-8">
                  {[
                    "Predictive, Progressive & Preview modes",
                    "One-click voicemail drops",
                    "Automated disposition workflows"
                  ].map(item => (
                    <li key={item} className="flex items-center gap-3 text-sm font-medium text-white/80">
                      <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
                        <CheckCircle size={14} className="text-primary" />
                      </div>
                      {item}
                    </li>
                  ))}
                </ul>
                <button className="flex items-center gap-2 text-primary font-bold hover:gap-3 transition-all">
                  Explore the Dialer <ArrowRight size={18} />
                </button>
              </div>

              <div className="absolute -right-20 -bottom-20 w-[450px] rotate-[-5deg] group-hover:rotate-0 transition-transform duration-700 hidden lg:block">
                <img src="/test1/dialer.png" alt="Dialer UI" className="rounded-2xl border border-white/10 shadow-2xl" />
              </div>
            </motion.div>

            {/* AI Agents */}
            <FeatureCard 
              icon={Bot}
              title="Autonomous AI Agents"
              desc="Sarah doesn't sleep. Mike doesn't take breaks. Deploy AI that qualifies, books, and follows up on autopilot."
            />

            {/* Smart Campaigns */}
            <FeatureCard 
              icon={Megaphone}
              title="Smart Lead Routing"
              desc="Hyper-targeted lead distribution based on performance, availability, and specialty. Never waste a lead again."
            />

            {/* Leaderboard */}
            <motion.div 
              variants={fadeInUp}
              className="md:col-span-2 group relative p-10 rounded-[40px] border border-white/10 bg-white/[0.02] overflow-hidden"
            >
              <div className="flex flex-col lg:flex-row items-center gap-12">
                <div className="flex-1">
                  <div className="w-14 h-14 rounded-2xl bg-purple-500/20 flex items-center justify-center mb-8">
                    <Trophy className="text-purple-500" size={28} />
                  </div>
                  <h3 className="text-3xl font-black mb-4">Real-Time Performance</h3>
                  <p className="text-white/60 leading-relaxed mb-8">
                    Gamify your sales floor with live leaderboards, automated incentives, and deep behavioral analytics for every agent.
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                      <p className="text-2xl font-black">98%</p>
                      <p className="text-xs text-white/40 font-bold uppercase tracking-widest">Accuracy</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                      <p className="text-2xl font-black">2.4x</p>
                      <p className="text-xs text-white/40 font-bold uppercase tracking-widest">Growth</p>
                    </div>
                  </div>
                </div>
                <div className="flex-1 w-full max-w-sm">
                  <div className="p-6 rounded-3xl bg-black/40 border border-white/10 space-y-4">
                    {[
                      { name: "Maria S.", val: "84,200", color: "bg-primary" },
                      { name: "David P.", val: "72,150", color: "bg-blue-500" },
                      { name: "Rachel K.", val: "68,900", color: "bg-purple-500" },
                    ].map((agent, i) => (
                      <div key={i} className="space-y-2">
                        <div className="flex justify-between text-sm font-bold">
                          <span>{agent.name}</span>
                          <span className="text-white/40">${agent.val}</span>
                        </div>
                        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            whileInView={{ width: `${100 - (i * 15)}%` }}
                            className={`h-full ${agent.color}`}
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
      <section className="py-32 bg-white/[0.02]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row items-center gap-20">
            <div className="lg:w-1/2">
              <SectionHeading 
                center={false}
                badge="The Brain"
                title="AI Agents That Scale Your Conversations"
                desc="Deploy intelligent virtual agents that handle initial outreach, qualification, and appointment setting. Your human agents focus exclusively on closing."
              />
              <div className="space-y-6">
                {[
                  { title: "Natural Voice Synthesis", desc: "Agents that sound human, professional, and empathetic." },
                  { title: "Cross-Channel Sync", desc: "Seamless transition between SMS, Voice, and Email." },
                  { title: "Direct Calendar Booking", desc: "Integrates directly with your team's availability." }
                ].map((item, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="flex gap-4 p-4 rounded-2xl hover:bg-white/5 transition-colors"
                  >
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary mt-1 shrink-0">
                      <CheckCircle size={14} />
                    </div>
                    <div>
                      <h4 className="font-bold mb-1">{item.title}</h4>
                      <p className="text-sm text-white/50">{item.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
            <div className="lg:w-1/2 relative">
               <motion.div
                initial={{ opacity: 0, scale: 0.9, rotate: 2 }}
                whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
                className="relative z-10 rounded-3xl overflow-hidden border border-white/10 shadow-2xl"
               >
                 <img src="/test1/ai_agents.png" alt="AI Interface" className="w-full h-auto" />
               </motion.div>
               <div className="absolute -inset-4 bg-primary/20 blur-3xl opacity-20 -z-10" />
            </div>
          </div>
        </div>
      </section>

      {/* ── CTAs ── */}
      <section className="py-40 relative overflow-hidden">
        <div className="absolute inset-0 bg-primary opacity-5" />
        <div className="max-w-5xl mx-auto px-6 text-center relative z-10">
          <motion.h2 
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            className="text-4xl md:text-7xl font-black mb-10 tracking-tighter"
          >
            Stop Dialing. <br />
            <span className="text-primary italic">Start Closing.</span>
          </motion.h2>
          <p className="text-xl text-white/60 mb-12 max-w-2xl mx-auto">
            Join 500+ high-performance agencies that have moved to FFL AgentFlow. 
            No setup fees. No long-term contracts. Just results.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
            <Link
              to="/signup"
              className="h-16 px-12 rounded-2xl bg-white text-black font-black text-lg flex items-center justify-center hover:scale-105 transition-transform"
            >
              Get Started for Free
            </Link>
            <p className="text-white/40 font-bold uppercase tracking-widest text-xs">
              14-day trial • No credit card needed
            </p>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

export default LandingPageTest1;
