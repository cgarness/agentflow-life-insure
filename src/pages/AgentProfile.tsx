import React from "react";
import {
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const licensedStates = [
  { state: "Florida", code: "FL", licenseNumber: "2A46791", status: "Active", line: "Life & Health", accent: "from-cyan-400/20 to-cyan-500/5" },
  { state: "Texas", code: "TX", licenseNumber: "19740388", status: "Active", line: "Life", accent: "from-violet-400/20 to-violet-500/5" },
  { state: "Georgia", code: "GA", licenseNumber: "LH-084621", status: "Active", line: "Life & Annuities", accent: "from-emerald-400/20 to-emerald-500/5" },
  { state: "North Carolina", code: "NC", licenseNumber: "2521990", status: "Renewal 2027", line: "Life & Health", accent: "from-fuchsia-400/20 to-fuchsia-500/5" },
  { state: "Arizona", code: "AZ", licenseNumber: "S1834722", status: "Active", line: "Life", accent: "from-blue-400/20 to-blue-500/5" },
  { state: "Ohio", code: "OH", licenseNumber: "12766549", status: "Active", line: "Life & Health", accent: "from-amber-400/20 to-amber-500/5" },
];

const AgentProfile: React.FC = () => {
  const { profile, user } = useAuth();

  const firstName = profile?.first_name || "Agent";
  const lastName = profile?.last_name || "Profile";
  const initials = `${firstName[0] || "A"}${lastName[0] || "P"}`;
  const email = profile?.email || user?.email || "Not provided";
  const phone = profile?.phone || "Not provided";

  return (
    <div className="min-h-full p-6 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-card p-6 shadow-[0_0_45px_-24px_hsl(var(--primary))] md:p-7">
          <div className="pointer-events-none absolute -left-16 top-2 h-40 w-40 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -right-16 bottom-0 h-40 w-40 rounded-full bg-fuchsia-400/20 blur-3xl" />

          <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
            <div className="space-y-5">
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-lg font-semibold text-primary">
                  {profile ? initials : <UserRound className="h-8 w-8" />}
                </div>
                <div>
                  <h1 className="text-2xl font-semibold text-foreground md:text-3xl">{firstName} {lastName}</h1>
                  <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <BriefcaseBusiness className="h-4 w-4" />
                    Senior Life Insurance Agent
                  </p>
                </div>
              </div>

              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <p className="flex items-center gap-2 text-muted-foreground"><Building2 className="h-4 w-4" />AgentFlow Brokerage</p>
                <p className="flex items-center gap-2 text-muted-foreground"><Mail className="h-4 w-4" />{email}</p>
                <p className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4" />{phone}</p>
                <p className="flex items-center gap-2 text-muted-foreground"><MapPin className="h-4 w-4" />Tampa, Florida</p>
              </div>
            </div>

            <div className="rounded-xl border border-primary/20 bg-background/40 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Profile Highlights</p>
              <div className="mt-3 space-y-2 text-sm text-foreground">
                <p className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" />Multistate licensed advisor</p>
                <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" />8+ years in life insurance</p>
                <p className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />Consistent top performer</p>
              </div>
            </div>
          </div>

          <div className="relative mt-6 flex flex-wrap gap-2">
            <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-500">Top Producer</span>
            <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-500">Client-First Advisor</span>
            <span className="rounded-full border border-fuchsia-400/40 bg-fuchsia-400/10 px-3 py-1 text-xs font-medium text-fuchsia-500">Multistate Licensed</span>
            <span className="rounded-full border border-violet-400/40 bg-violet-400/10 px-3 py-1 text-xs font-medium text-violet-500">Retention Leader</span>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">State Licenses</h2>
            <span className="text-xs text-muted-foreground">{licensedStates.length} active records</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {licensedStates.map((license) => (
              <article
                key={license.code}
                className="group relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_0_30px_-18px_hsl(var(--primary))]"
              >
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${license.accent} opacity-70`} />
                <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-primary/10 blur-xl transition-opacity group-hover:opacity-100" />

                <div className="relative flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{license.state}</p>
                    <p className="mt-1 text-xs text-muted-foreground">License #{license.licenseNumber}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                    <BadgeCheck className="h-3 w-3" />
                    {license.status}
                  </span>
                </div>

                <div className="relative mt-4 flex items-center justify-between">
                  <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">{license.code}</span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-500">
                    <Star className="h-3 w-3" />
                    {license.line}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AgentProfile;
