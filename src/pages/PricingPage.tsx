import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, X as XIcon, ChevronDown, Star } from "lucide-react";
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
   FLOATING ORB
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
   PRICING DATA
   ────────────────────────────────────────────── */
const PLANS = [
  {
    name: "Starter",
    desc: "For solo agents and small teams getting started",
    monthly: 149,
    annual: 119,
    cta: "Get Started",
    ctaStyle: "outline" as const,
    features: [
      "Up to 3 agent seats",
      "Power dialer (preview mode)",
      "Contact management (leads, clients, recruits)",
      "Calendar & appointment scheduling",
      "Basic reporting (own stats only)",
      "Email support",
    ],
  },
  {
    name: "Professional",
    desc: "For growing teams that need the full toolkit",
    monthly: 299,
    annual: 239,
    cta: "Start Free Trial",
    ctaStyle: "primary" as const,
    popular: true,
    features: [
      "Everything in Starter, plus:",
      "All dialer modes (preview, progressive, predictive)",
      "AI Agents — up to 5 virtual agents",
      "Smart campaigns with lead pools",
      "Voicemail drop",
      "Leaderboard & team rankings",
      "Advanced reports & CSV/PDF export",
      "Role-based permissions",
      "DNC list management",
      "Priority email & chat support",
    ],
    extraFeatures: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  },
  {
    name: "Enterprise",
    desc: "For large agencies, IMOs, and call centers",
    custom: true,
    cta: "Contact Sales",
    ctaStyle: "outline" as const,
    features: [
      "Everything in Professional, plus:",
      "Unlimited agent seats",
      "Unlimited AI agents",
      "Custom integrations & API access",
      "Dedicated account manager",
      "SLA guarantee & uptime commitment",
      "SSO & advanced security",
      "Custom onboarding & training",
      "TCPA compliance tools",
    ],
    extraFeatures: [1, 2, 3, 4, 5, 6, 7, 8],
  },
];

/* ──────────────────────────────────────────────
   COMPARISON TABLE DATA
   ────────────────────────────────────────────── */
type CellValue = boolean | string;
interface FeatureRow {
  feature: string;
  starter: CellValue;
  professional: CellValue;
  enterprise: CellValue;
}
interface FeatureGroup {
  category: string;
  rows: FeatureRow[];
}

const COMPARISON: FeatureGroup[] = [
  {
    category: "Dialer",
    rows: [
      { feature: "Preview dialer", starter: true, professional: true, enterprise: true },
      { feature: "Progressive dialer", starter: false, professional: true, enterprise: true },
      { feature: "Predictive dialer", starter: false, professional: true, enterprise: true },
      { feature: "Voicemail drop", starter: false, professional: true, enterprise: true },
      { feature: "Manual dial", starter: true, professional: true, enterprise: true },
      { feature: "Call recording", starter: true, professional: true, enterprise: true },
    ],
  },
  {
    category: "Contacts & CRM",
    rows: [
      { feature: "Contact management", starter: true, professional: true, enterprise: true },
      { feature: "Leads, Clients, Recruits tabs", starter: true, professional: true, enterprise: true },
      { feature: "CSV bulk import", starter: false, professional: true, enterprise: true },
      { feature: "Duplicate detection", starter: false, professional: true, enterprise: true },
      { feature: "Contact merge", starter: false, professional: true, enterprise: true },
      { feature: "Custom fields", starter: false, professional: false, enterprise: true },
    ],
  },
  {
    category: "Campaigns",
    rows: [
      { feature: "Campaign creation", starter: false, professional: true, enterprise: true },
      { feature: "Open pool & assigned modes", starter: false, professional: true, enterprise: true },
      { feature: "Lead round-robin", starter: false, professional: true, enterprise: true },
      { feature: "Campaign analytics", starter: false, professional: true, enterprise: true },
    ],
  },
  {
    category: "AI Agents",
    rows: [
      { feature: "AI agent slots", starter: false, professional: "Up to 5", enterprise: "Unlimited" },
      { feature: "Voice agents", starter: false, professional: true, enterprise: true },
      { feature: "SMS agents", starter: false, professional: true, enterprise: true },
      { feature: "Email agents", starter: false, professional: true, enterprise: true },
      { feature: "Workflow builder", starter: false, professional: true, enterprise: true },
    ],
  },
  {
    category: "Reporting & Analytics",
    rows: [
      { feature: "Basic reports (own stats)", starter: true, professional: true, enterprise: true },
      { feature: "Team reports", starter: false, professional: true, enterprise: true },
      { feature: "Leaderboard", starter: false, professional: true, enterprise: true },
      { feature: "CSV & PDF export", starter: false, professional: true, enterprise: true },
      { feature: "Custom dashboards", starter: false, professional: false, enterprise: true },
    ],
  },
  {
    category: "Administration",
    rows: [
      { feature: "Role-based permissions", starter: "Basic", professional: "Full", enterprise: "Full" },
      { feature: "DNC list management", starter: false, professional: true, enterprise: true },
      { feature: "Company branding", starter: false, professional: true, enterprise: true },
      { feature: "SSO", starter: false, professional: false, enterprise: true },
      { feature: "API access", starter: false, professional: false, enterprise: true },
      { feature: "Dedicated account manager", starter: false, professional: false, enterprise: true },
    ],
  },
  {
    category: "Support",
    rows: [
      { feature: "Email support", starter: true, professional: true, enterprise: true },
      { feature: "Priority chat support", starter: false, professional: true, enterprise: true },
      { feature: "Phone support", starter: false, professional: false, enterprise: true },
      { feature: "Custom onboarding", starter: false, professional: false, enterprise: true },
      { feature: "SLA guarantee", starter: false, professional: false, enterprise: true },
    ],
  },
];

/* ──────────────────────────────────────────────
   FAQ DATA
   ────────────────────────────────────────────── */
const FAQS = [
  {
    q: "Is there really no per-minute charge for calls?",
    a: "Correct. All plans include unlimited calling with no per-minute fees. Your monthly price covers everything — dialer, recording, voicemail drop, and all call features.",
  },
  {
    q: "What happens when my 14-day trial ends?",
    a: "If you don't choose a plan, your account switches to a read-only mode. All your data is preserved for 30 days so you can pick up right where you left off.",
  },
  {
    q: "Can I switch plans later?",
    a: "Yes. You can upgrade or downgrade at any time. Upgrades take effect immediately. Downgrades take effect at the start of your next billing cycle.",
  },
  {
    q: "Is there a setup fee?",
    a: "No. There are no setup fees on any plan. Enterprise customers receive custom onboarding included in their contract.",
  },
  {
    q: "How does per-agent pricing work?",
    a: "You pay for each active agent seat on your account. Admin seats are included free. If an agent is deactivated, you stop being billed for that seat at the next cycle.",
  },
  {
    q: "Do you offer discounts for large teams?",
    a: "Yes. Teams with 10+ agents are eligible for volume discounts. Contact our sales team for a custom quote.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept all major credit cards (Visa, Mastercard, Amex) and ACH bank transfers for annual plans. Enterprise customers can pay via invoice.",
  },
  {
    q: "Can I cancel at any time?",
    a: "Yes. There are no long-term contracts on Starter or Professional plans. Cancel anytime from your account settings. Enterprise contracts have custom terms.",
  },
];

/* ══════════════════════════════════════════════
   PRICING PAGE
   ══════════════════════════════════════════════ */
const PricingPage: React.FC = () => {
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mobileAccordion, setMobileAccordion] = useState<number | null>(null);

  const renderCell = (val: CellValue) => {
    if (val === true) return <CheckCircle className="w-4 h-4 text-primary mx-auto" />;
    if (val === false) return <XIcon className="w-4 h-4 text-muted-foreground/30 mx-auto" />;
    return <span className="text-sm text-foreground">{val}</span>;
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden scroll-smooth">
      {/* Shimmer keyframe */}
      <style>{`@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}`}</style>

      <MarketingNav />

      {/* ════════════════════════════════════════
          SECTION 1 — HERO
         ════════════════════════════════════════ */}
      <section className="relative pt-32 pb-20 overflow-hidden">
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

        <motion.div
          className="relative z-10 text-center max-w-4xl mx-auto px-6"
          initial="hidden"
          animate="visible"
          variants={stagger}
        >
          <motion.div variants={fadeUp}>
            <ShimmerBadge>Simple, Transparent Pricing</ShimmerBadge>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="mt-6 text-3xl md:text-4xl font-extrabold leading-tight bg-gradient-to-r from-foreground via-primary to-foreground bg-clip-text text-transparent"
          >
            One Platform. One Price. No Surprises.
          </motion.h1>

          <motion.p variants={fadeUp} className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            No per-minute charges. No hidden fees. No long-term contracts. Just the tools your team needs to close more policies.
          </motion.p>

          {/* Billing Toggle */}
          <motion.div variants={fadeUp} className="mt-8 flex items-center justify-center gap-3">
            <div className="inline-flex items-center rounded-full bg-muted/30 border border-border/50 p-1">
              <button
                onClick={() => setBilling("monthly")}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                  billing === "monthly"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBilling("annual")}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                  billing === "annual"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Annual
                {billing === "annual" && (
                  <span className="text-xs bg-primary-foreground/20 text-primary-foreground rounded-full px-2 py-0.5">
                    Save 20%
                  </span>
                )}
              </button>
            </div>
            {billing === "monthly" && (
              <span className="text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5">Save 20% annually</span>
            )}
          </motion.div>
        </motion.div>
      </section>

      {/* ════════════════════════════════════════
          SECTION 2 — PRICING CARDS
         ════════════════════════════════════════ */}
      <Section>
        <motion.div
          className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={stagger}
        >
          {PLANS.map((plan, idx) => (
            <motion.div
              key={plan.name}
              variants={fadeUp}
              transition={{ delay: idx * 0.1 }}
              className={`relative rounded-2xl p-8 transition-all duration-300 hover:-translate-y-1 ${
                plan.popular
                  ? "bg-card/50 border-2 border-primary/50 shadow-lg shadow-primary/10 lg:scale-105"
                  : "bg-card/50 border border-border/50"
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-semibold px-4 py-1 rounded-full">
                  Most Popular
                </span>
              )}

              <div className="mb-6">
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">{plan.desc}</p>
              </div>

              <div className="mb-6">
                {plan.custom ? (
                  <>
                    <span className="text-5xl font-extrabold">Custom</span>
                    <p className="text-sm text-muted-foreground mt-1">Tailored to your organization</p>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="text-5xl font-extrabold">
                        ${billing === "monthly" ? plan.monthly : plan.annual}
                      </span>
                      <span className="text-base text-muted-foreground">/agent/mo</span>
                    </div>
                    {billing === "annual" && (
                      <p className="text-xs text-muted-foreground mt-1">
                        <span className="line-through">${plan.monthly}</span> billed annually
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className="border-t border-border/30 my-6" />

              <ul className="space-y-3 mb-8">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-3">
                    {plan.extraFeatures?.includes(i) ? (
                      <Star className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    )}
                    <span className="text-sm text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                to="/login"
                className={`block w-full h-12 rounded-xl text-center font-semibold flex items-center justify-center transition-all duration-200 ${
                  plan.ctaStyle === "primary"
                    ? "bg-primary text-primary-foreground hover:scale-105 shadow-[0_0_20px_hsl(var(--primary)/0.3)]"
                    : "border border-border text-foreground hover:bg-accent/50"
                }`}
              >
                {plan.cta}
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* ════════════════════════════════════════
          SECTION 3 — COMPARISON TABLE
         ════════════════════════════════════════ */}
      <Section>
        <motion.div
          className="text-center mb-12"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={fadeUp}
        >
          <h2 className="text-2xl font-bold">Compare Plans Side by Side</h2>
          <p className="mt-2 text-muted-foreground">See exactly what's included in each plan.</p>
        </motion.div>

        {/* Desktop Table */}
        <motion.div
          className="hidden lg:block max-w-5xl mx-auto rounded-2xl bg-card/30 border border-border/50 overflow-hidden"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={fadeUp}
        >
          {/* Header */}
          <div className="grid grid-cols-4 bg-muted/20 border-b border-border/50">
            <div className="py-4 px-6 text-sm font-semibold">Feature</div>
            <div className="py-4 px-6 text-sm font-semibold text-center">Starter</div>
            <div className="py-4 px-6 text-sm font-semibold text-center bg-primary/5">Professional</div>
            <div className="py-4 px-6 text-sm font-semibold text-center">Enterprise</div>
          </div>

          {COMPARISON.map((group) => (
            <React.Fragment key={group.category}>
              {/* Category Header */}
              <div className="bg-muted/10 py-2 px-6">
                <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">
                  {group.category}
                </span>
              </div>
              {/* Rows */}
              {group.rows.map((row, i) => (
                <div
                  key={row.feature}
                  className={`grid grid-cols-4 border-b border-border/20 ${i % 2 === 0 ? "" : "bg-muted/5"}`}
                >
                  <div className="py-3 px-6 text-sm text-muted-foreground">{row.feature}</div>
                  <div className="py-3 px-6 flex items-center justify-center">{renderCell(row.starter)}</div>
                  <div className="py-3 px-6 flex items-center justify-center bg-primary/5">
                    {renderCell(row.professional)}
                  </div>
                  <div className="py-3 px-6 flex items-center justify-center">{renderCell(row.enterprise)}</div>
                </div>
              ))}
            </React.Fragment>
          ))}
        </motion.div>

        {/* Mobile Accordion */}
        <div className="lg:hidden space-y-4 max-w-md mx-auto">
          {PLANS.map((plan, idx) => (
            <motion.div
              key={plan.name}
              initial="hidden"
              whileInView="visible"
              viewport={VP}
              variants={fadeUp}
              className="rounded-xl border border-border/50 overflow-hidden"
            >
              <button
                className="w-full flex items-center justify-between px-5 py-4 text-left font-medium hover:bg-muted/30 transition-colors"
                onClick={() => setMobileAccordion(mobileAccordion === idx ? null : idx)}
              >
                <span>{plan.name} Features</span>
                <ChevronDown
                  className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${
                    mobileAccordion === idx ? "rotate-180" : ""
                  }`}
                />
              </button>
              <AnimatePresence initial={false}>
                {mobileAccordion === idx && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <ul className="px-5 pb-4 space-y-2">
                      {plan.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ════════════════════════════════════════
          SECTION 4 — FAQ
         ════════════════════════════════════════ */}
      <Section id="faq">
        <motion.div
          className="text-center mb-12"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={fadeUp}
        >
          <h2 className="text-2xl font-bold">Pricing Questions</h2>
        </motion.div>

        <div className="max-w-3xl mx-auto space-y-3">
          {FAQS.map(({ q, a }, i) => (
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
                  className={`shrink-0 w-4 h-4 text-muted-foreground transition-transform duration-200 ${
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
          SECTION 5 — FINAL CTA
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
            Start Closing More Policies Today
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-lg text-muted-foreground">
            14-day free trial. No credit card required. Full access to Professional features.
          </motion.p>
          <motion.div variants={fadeUp} className="mt-8">
            <Link
              to="/login"
              className="inline-flex h-14 px-10 rounded-xl bg-primary text-primary-foreground text-lg font-semibold items-center hover:scale-105 shadow-[0_0_30px_hsl(var(--primary)/0.35)] transition-all duration-200"
            >
              Start Your Free Trial
            </Link>
          </motion.div>
          <motion.p variants={fadeUp} className="mt-5 text-sm text-muted-foreground">
            Questions?{" "}
            <Link to="/login" className="text-primary hover:underline">
              Talk to our team →
            </Link>
          </motion.p>
        </motion.div>
      </section>

      {/* ════════════════════════════════════════
          SECTION 6 — FOOTER
         ════════════════════════════════════════ */}
      <MarketingFooter />
    </div>
  );
};

export default PricingPage;
