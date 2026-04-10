import React, { useMemo } from "react";
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
  Award,
  TrendingUp,
  PhoneCall,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { startOfMonth, endOfMonth, startOfDay } from "date-fns";

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming"
};

const ACCENT_COLORS = [
  "from-cyan-400/20 to-cyan-500/5",
  "from-violet-400/20 to-violet-500/5",
  "from-emerald-400/20 to-emerald-500/5",
  "from-fuchsia-400/20 to-fuchsia-500/5",
  "from-blue-400/20 to-blue-500/5",
  "from-amber-400/20 to-amber-500/5",
  "from-rose-400/20 to-rose-500/5",
  "from-teal-400/20 to-teal-500/5",
];

const AgentProfile: React.FC = () => {
  const { profile, user } = useAuth();

  const firstName = profile?.first_name || "Agent";
  const lastName = profile?.last_name || "Profile";
  const initials = `${firstName[0] || "A"}${lastName[0] || "P"}`;
  const email = profile?.email || user?.email || "Not provided";
  const phone = profile?.phone || "Not provided";
  const role = profile?.role || "Agent";
  const residentState = profile?.resident_state || null;
  const npn = profile?.npn || null;
  const commissionLevel = profile?.commission_level || null;
  const licensedStates = useMemo(() => {
    const raw = profile?.licensed_states;
    if (!Array.isArray(raw)) return [];
    
    return (raw as any[]).map((item, i) => {
      // Handle new object structure: { state, licenseNumber }
      if (typeof item === 'object' && item !== null && 'state' in item) {
        const stateName = item.state;
        // Try to find code if it's stored as full name
        const code = Object.entries(STATE_NAMES).find(([k, v]) => v === stateName)?.[0] || stateName;
        return {
          code,
          state: stateName,
          licenseNumber: item.licenseNumber,
          accent: ACCENT_COLORS[i % ACCENT_COLORS.length],
        };
      }
      // Handle legacy string structure: "AL"
      const code = String(item);
      return {
        code,
        state: STATE_NAMES[code] || code,
        licenseNumber: null,
        accent: ACCENT_COLORS[i % ACCENT_COLORS.length],
      };
    });
  }, [profile?.licensed_states]);

  const carriers = useMemo(() => {
    const raw = profile?.carriers;
    if (!Array.isArray(raw)) return [];
    
    return (raw as any[]).map(item => {
      // Handle new object structure: { carrier, writingNumber }
      if (typeof item === 'object' && item !== null && 'carrier' in item) {
        return {
          name: item.carrier,
          writingNumber: item.writingNumber
        };
      }
      // Handle legacy string structure
      return {
        name: String(item),
        writingNumber: null
      };
    });
  }, [profile?.carriers]);

  const userId = user?.id;

  // Fetch real stats
  const now = new Date();
  const monthStart = startOfMonth(now).toISOString();
  const monthEnd = endOfMonth(now).toISOString();
  const todayStart = startOfDay(now).toISOString();

  const { data: stats } = useQuery({
    queryKey: ["agent-profile-stats", userId],
    enabled: !!userId,
    queryFn: async () => {
      const [callsRes, clientsRes, winsRes] = await Promise.all([
        supabase.from("calls").select("id, started_at, duration, disposition_name").eq("agent_id", userId!),
        supabase.from("clients").select("id, created_at").eq("assigned_agent_id", userId!),
        supabase.from("wins").select("id, created_at").eq("agent_id", userId!),
      ]);

      const calls = callsRes.data || [];
      const clients = clientsRes.data || [];
      const wins = winsRes.data || [];

      const totalCalls = calls.length;
      const todayCalls = calls.filter(c => c.started_at && c.started_at >= todayStart).length;
      const monthCalls = calls.filter(c => c.started_at && c.started_at >= monthStart && c.started_at <= monthEnd).length;
      const totalTalkTime = calls.reduce((sum, c) => sum + (c.duration || 0), 0);
      const totalClients = clients.length;
      const monthWins = wins.filter(w => w.created_at && w.created_at >= monthStart && w.created_at <= monthEnd).length;

      return { totalCalls, todayCalls, monthCalls, totalTalkTime, totalClients, monthWins };
    },
  });

  const formatTalkTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  };

  // Build dynamic badges
  const badges = useMemo(() => {
    const b: { label: string; cls: string }[] = [];
    if (licensedStates.length > 1) b.push({ label: "Multistate Licensed", cls: "border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-500" });
    if ((stats?.totalClients || 0) >= 10) b.push({ label: "Top Producer", cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-500" });
    if ((stats?.monthWins || 0) >= 3) b.push({ label: "Hot Streak", cls: "border-amber-400/40 bg-amber-400/10 text-amber-500" });
    if (carriers.length >= 3) b.push({ label: "Multi-Carrier", cls: "border-cyan-400/40 bg-cyan-400/10 text-cyan-500" });
    if (role === "Admin") b.push({ label: "Administrator", cls: "border-violet-400/40 bg-violet-400/10 text-violet-500" });
    if (role === "Team Leader") b.push({ label: "Team Leader", cls: "border-blue-400/40 bg-blue-400/10 text-blue-500" });
    if (b.length === 0) b.push({ label: role, cls: "border-cyan-400/40 bg-cyan-400/10 text-cyan-500" });
    return b;
  }, [licensedStates, stats, carriers, role]);

  const location = residentState
    ? `${STATE_NAMES[residentState] || residentState}`
    : "Not specified";

  return (
    <div className="min-h-full p-6 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Hero Card */}
        <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-card p-6 shadow-[0_0_45px_-24px_hsl(var(--primary))] md:p-7">
          <div className="pointer-events-none absolute -left-16 top-2 h-40 w-40 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -right-16 bottom-0 h-40 w-40 rounded-full bg-fuchsia-400/20 blur-3xl" />

          <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
            <div className="space-y-5">
              <div className="flex items-start gap-4">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt={`${firstName} ${lastName}`} className="h-16 w-16 rounded-2xl border border-primary/30 object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-lg font-semibold text-primary">
                    {profile ? initials : <UserRound className="h-8 w-8" />}
                  </div>
                )}
                <div>
                  <h1 className="text-2xl font-semibold text-foreground md:text-3xl">{firstName} {lastName}</h1>
                  <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <BriefcaseBusiness className="h-4 w-4" />
                    {role}
                    {commissionLevel && commissionLevel !== "0%" && (
                      <span className="text-xs text-primary">• {commissionLevel} commission</span>
                    )}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 text-sm sm:grid-cols-2">
                {npn && (
                  <p className="flex items-center gap-2 text-muted-foreground"><ShieldCheck className="h-4 w-4" />NPN: {npn}</p>
                )}
                <p className="flex items-center gap-2 text-muted-foreground"><Mail className="h-4 w-4" />{email}</p>
                <p className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4" />{phone}</p>
                <p className="flex items-center gap-2 text-muted-foreground"><MapPin className="h-4 w-4" />{location}</p>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="rounded-xl border border-primary/20 bg-background/40 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Performance</p>
              <div className="mt-3 space-y-2 text-sm text-foreground">
                <p className="flex items-center gap-2"><PhoneCall className="h-4 w-4 text-primary" />{stats?.todayCalls ?? "—"} calls today</p>
                <p className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" />{stats?.monthCalls ?? "—"} calls this month</p>
                <p className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" />{stats?.totalClients ?? "—"} total clients</p>
                <p className="flex items-center gap-2"><Award className="h-4 w-4 text-primary" />{stats?.monthWins ?? "—"} wins this month</p>
                <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" />{stats ? formatTalkTime(stats.totalTalkTime) : "—"} total talk time</p>
              </div>
            </div>
          </div>

          {/* Dynamic Badges */}
          <div className="relative mt-6 flex flex-wrap gap-2">
            {badges.map((b, i) => (
              <span key={i} className={`rounded-full border px-3 py-1 text-xs font-medium ${b.cls}`}>
                {b.label}
              </span>
            ))}
          </div>
        </section>

        {carriers.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Appointed Carriers</h2>
            <div className="flex flex-wrap gap-2">
              {carriers.map((c, i) => (
                <div key={i} className="inline-flex flex-col gap-1 rounded-lg border border-border bg-card p-3 shadow-sm min-w-[140px]">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <Building2 className="h-3.5 w-3.5 text-primary" />
                    {c.name}
                  </div>
                  {c.writingNumber && (
                    <p className="text-[10px] text-muted-foreground font-mono">ID: {c.writingNumber}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* State Licenses */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">State Licenses</h2>
            <span className="text-xs text-muted-foreground">{licensedStates.length} state{licensedStates.length !== 1 ? "s" : ""}</span>
          </div>

          {licensedStates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
              No licensed states on file. Update your profile in Settings to add them.
            </p>
          ) : (
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
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                      <BadgeCheck className="h-3 w-3" />
                      Licensed
                    </span>
                  </div>

                  <div className="relative mt-4 flex items-center justify-between">
                    <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">{license.code}</span>
                    {license.licenseNumber && (
                      <span className="text-[10px] text-muted-foreground font-mono">#{license.licenseNumber}</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AgentProfile;
