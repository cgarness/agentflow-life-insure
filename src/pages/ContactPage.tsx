import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Building2, Users, Phone, Mail, MessageSquare, CheckCircle,
  ArrowRight, Shield, Clock, Headphones,
} from "lucide-react";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { toast } from "sonner";
import { formatAsYouType, normalizePhoneNumber } from "@/utils/phoneUtils";

/* ── ANIMATION HELPERS ── */
const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 },
};
const stagger = { visible: { transition: { staggerChildren: 0.1 } } };
const VP = { once: true, margin: "-100px" as const };

/* ── FLOATING ORB ── */
const Orb = ({ className, dur = 25 }: { className?: string; dur?: number }) => (
  <motion.div
    className={`absolute rounded-full blur-3xl pointer-events-none ${className}`}
    animate={{ x: [0, 40, -30, 0], y: [0, -30, 40, 0] }}
    transition={{ duration: dur, repeat: Infinity, ease: "linear" }}
  />
);

/* ── SHIMMER BADGE ── */
const ShimmerBadge = ({ children }: { children: React.ReactNode }) => (
  <span className="relative inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary overflow-hidden">
    <span className="relative z-10">{children}</span>
    <span className="absolute inset-0 -translate-x-full animate-[shimmer_3s_infinite] bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
  </span>
);

/* ── SECTION WRAPPER ── */
const Section = ({ id, children, className = "" }: { id?: string; children: React.ReactNode; className?: string }) => (
  <section id={id} className={`py-20 md:py-24 ${className}`}>
    <div className="max-w-7xl mx-auto px-6">{children}</div>
  </section>
);

/* ── FORM VALIDATION ── */
const MAX_NAME = 100;
const MAX_EMAIL = 255;
const MAX_COMPANY = 100;
const MAX_PHONE = 30;
const MAX_MESSAGE = 2000;

const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const TEAM_SIZE_OPTIONS = ["1-5 agents", "6-15 agents", "16-50 agents", "50+ agents"];

const BENEFITS = [
  { icon: Users, title: "Unlimited Agents", desc: "No seat caps — scale your team without limits." },
  { icon: Headphones, title: "Dedicated Support", desc: "A named account manager who knows your business." },
  { icon: Shield, title: "Enterprise Security", desc: "SSO, advanced permissions, SLA guarantees." },
  { icon: Clock, title: "Custom Onboarding", desc: "White-glove setup and training for your team." },
];

/* ══════════════════════════════════════════════
   CONTACT PAGE
   ══════════════════════════════════════════════ */
const ContactPage: React.FC = () => {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    company: "",
    phone: "",
    teamSize: "",
    message: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const set = (key: string, value: string) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = "First name is required";
    else if (form.firstName.length > MAX_NAME) e.firstName = `Max ${MAX_NAME} characters`;
    if (!form.lastName.trim()) e.lastName = "Last name is required";
    else if (form.lastName.length > MAX_NAME) e.lastName = `Max ${MAX_NAME} characters`;
    if (!form.email.trim()) e.email = "Email is required";
    else if (!validateEmail(form.email)) e.email = "Invalid email address";
    else if (form.email.length > MAX_EMAIL) e.email = `Max ${MAX_EMAIL} characters`;
    if (!form.company.trim()) e.company = "Company name is required";
    else if (form.company.length > MAX_COMPANY) e.company = `Max ${MAX_COMPANY} characters`;
    if (form.phone && form.phone.length > MAX_PHONE) e.phone = `Max ${MAX_PHONE} characters`;
    if (!form.teamSize) e.teamSize = "Please select a team size";
    if (form.message.length > MAX_MESSAGE) e.message = `Max ${MAX_MESSAGE} characters`;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitted(true);
    toast.success("Thanks! Our team will reach out within 1 business day.");
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <MarketingNav />

      {/* ── HERO ── */}
      <section className="relative pt-32 pb-16 md:pt-40 md:pb-20 overflow-hidden">
        <Orb className="w-[500px] h-[500px] bg-primary/10 -top-40 -right-40" dur={28} />
        <Orb className="w-[400px] h-[400px] bg-accent/10 bottom-0 -left-32" dur={22} />

        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(to right, hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--foreground)) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        <div className="relative max-w-7xl mx-auto px-6 text-center">
          <motion.div initial="hidden" animate="visible" variants={stagger}>
            <motion.div variants={fadeUp} className="flex justify-center mb-6">
              <ShimmerBadge>Enterprise Inquiries</ShimmerBadge>
            </motion.div>
            <motion.h1
              variants={fadeUp}
              className="text-3xl md:text-4xl lg:text-5xl font-extrabold bg-gradient-to-r from-foreground via-primary to-foreground bg-clip-text text-transparent leading-tight"
            >
              Let's Build Your Custom Plan
            </motion.h1>
            <motion.p variants={fadeUp} className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Tell us about your agency and we'll craft a tailored solution with dedicated support, custom integrations, and volume pricing.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* ── FORM + BENEFITS ── */}
      <Section>
        <div className="grid lg:grid-cols-5 gap-12 items-start">
          {/* FORM — 3 cols */}
          <motion.div
            className="lg:col-span-3 rounded-2xl bg-card/50 border border-border/50 p-6 md:p-8 backdrop-blur"
            initial="hidden"
            whileInView="visible"
            viewport={VP}
            variants={fadeUp}
          >
            {submitted ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-2xl font-bold mb-2">We've Got Your Request!</h3>
                <p className="text-muted-foreground mb-6">
                  A member of our Enterprise team will reach out within 1 business day.
                </p>
                <Link
                  to="/pricing"
                  className="inline-flex items-center gap-2 text-primary hover:underline font-medium"
                >
                  Back to Pricing <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                <h2 className="text-xl font-bold mb-1">Contact Our Sales Team</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  All fields marked with <span className="text-destructive">*</span> are required.
                </p>

                {/* Name row */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field
                    label="First Name"
                    required
                    value={form.firstName}
                    error={errors.firstName}
                    onChange={(v) => set("firstName", v)}
                    maxLength={MAX_NAME}
                  />
                  <Field
                    label="Last Name"
                    required
                    value={form.lastName}
                    error={errors.lastName}
                    onChange={(v) => set("lastName", v)}
                    maxLength={MAX_NAME}
                  />
                </div>

                <Field
                  label="Work Email"
                  required
                  type="email"
                  icon={<Mail className="w-4 h-4" />}
                  value={form.email}
                  error={errors.email}
                  onChange={(v) => set("email", v)}
                  maxLength={MAX_EMAIL}
                />

                <Field
                  label="Company / Agency Name"
                  required
                  icon={<Building2 className="w-4 h-4" />}
                  value={form.company}
                  error={errors.company}
                  onChange={(v) => set("company", v)}
                  maxLength={MAX_COMPANY}
                />

                <div className="grid sm:grid-cols-2 gap-4">
                  <Field
                    label="Phone Number"
                    type="tel"
                    icon={<Phone className="w-4 h-4" />}
                    value={form.phone}
                    error={errors.phone}
                    onChange={(v) => set("phone", v)}
                    maxLength={MAX_PHONE}
                  />
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      Team Size <span className="text-destructive">*</span>
                    </label>
                    <select
                      value={form.teamSize}
                      onChange={(e) => set("teamSize", e.target.value)}
                      className={`w-full h-10 rounded-lg bg-muted/30 border px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/50 transition-all ${
                        errors.teamSize ? "border-destructive" : "border-border/50"
                      }`}
                    >
                      <option value="">Select…</option>
                      {TEAM_SIZE_OPTIONS.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                    {errors.teamSize && <p className="text-xs text-destructive mt-1">{errors.teamSize}</p>}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Tell Us About Your Needs
                  </label>
                  <textarea
                    rows={4}
                    value={form.message}
                    onChange={(e) => set("message", e.target.value)}
                    maxLength={MAX_MESSAGE}
                    placeholder="What challenges are you looking to solve? Any specific features or integrations you need?"
                    className={`w-full rounded-lg bg-muted/30 border px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/50 resize-none transition-all ${
                      errors.message ? "border-destructive" : "border-border/50"
                    }`}
                  />
                  <div className="flex justify-between mt-1">
                    {errors.message && <p className="text-xs text-destructive">{errors.message}</p>}
                    <p className="text-xs text-muted-foreground ml-auto">
                      {form.message.length}/{MAX_MESSAGE}
                    </p>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold hover:scale-[1.02] shadow-[0_0_20px_hsl(var(--primary)/0.3)] transition-all duration-200 flex items-center justify-center gap-2"
                >
                  Submit Inquiry <ArrowRight className="w-4 h-4" />
                </button>

                <p className="text-xs text-muted-foreground text-center">
                  We'll respond within 1 business day. No spam, ever.
                </p>
              </form>
            )}
          </motion.div>

          {/* BENEFITS — 2 cols */}
          <motion.div
            className="lg:col-span-2 space-y-6"
            initial="hidden"
            whileInView="visible"
            viewport={VP}
            variants={stagger}
          >
            <motion.h3 variants={fadeUp} className="text-lg font-bold">
              Why Enterprise?
            </motion.h3>

            {BENEFITS.map((b, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                className="flex gap-4 rounded-xl bg-card/30 border border-border/30 p-4 hover:border-primary/30 transition-all duration-300"
              >
                <div className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <b.icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm">{b.title}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{b.desc}</p>
                </div>
              </motion.div>
            ))}

            <motion.div variants={fadeUp} className="rounded-xl bg-primary/5 border border-primary/20 p-5 mt-4">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Prefer to talk now?</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Schedule a 15-minute call with our Enterprise team to discuss your needs.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
              >
                Schedule a Call <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </Section>

      {/* ── CTA BANNER ── */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-accent/10" />
        <Orb className="w-[400px] h-[400px] bg-primary/10 top-0 right-0" dur={30} />

        <motion.div
          className="relative max-w-3xl mx-auto px-6 text-center"
          initial="hidden"
          whileInView="visible"
          viewport={VP}
          variants={stagger}
        >
          <motion.h2
            variants={fadeUp}
            className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-foreground via-primary to-foreground bg-clip-text text-transparent"
          >
            Not Sure Which Plan Is Right?
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-lg text-muted-foreground">
            Compare all plans side by side, or start a free 14-day trial of Professional.
          </motion.p>
          <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/pricing"
              className="inline-flex h-12 px-8 rounded-xl bg-primary text-primary-foreground font-semibold items-center hover:scale-105 shadow-[0_0_30px_hsl(var(--primary)/0.35)] transition-all duration-200"
            >
              View Pricing
            </Link>
            <Link
              to="/login"
              className="inline-flex h-12 px-8 rounded-xl border border-border text-foreground font-semibold items-center hover:bg-accent/50 transition-all duration-200"
            >
              Start Free Trial
            </Link>
          </motion.div>
        </motion.div>
      </section>

      <MarketingFooter />
    </div>
  );
};

/* ── REUSABLE FIELD COMPONENT ── */
interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  required?: boolean;
  type?: string;
  icon?: React.ReactNode;
  maxLength?: number;
}

const Field: React.FC<FieldProps> = ({ label, value, onChange, error, required, type = "text", icon, maxLength }) => (
  <div>
    <label className="block text-sm font-medium mb-1.5">
      {label} {required && <span className="text-destructive">*</span>}
    </label>
    <div className="relative">
      {icon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</div>
      )}
      <input
        type={type}
        value={type === "tel" ? formatAsYouType(value) : value}
        onChange={(e) => {
          const v = e.target.value;
          onChange(type === "tel" ? normalizePhoneNumber(v) : v);
        }}
        maxLength={maxLength}
        className={`w-full h-10 rounded-lg bg-muted/30 border text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/50 transition-all ${
          icon ? "pl-9 pr-3" : "px-3"
        } ${error ? "border-destructive" : "border-border/50"}`}
      />
    </div>
    {error && <p className="text-xs text-destructive mt-1">{error}</p>}
  </div>
);

export default ContactPage;
