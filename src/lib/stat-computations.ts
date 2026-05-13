import type {
  ReportCallSummary,
  ReportDispositionBreakdown,
  ReportCallVolumeTimeseries,
  AgentProfile,
} from "@/lib/reports-queries";
import { differenceInDays, format, getISOWeek, getISOWeekYear } from "date-fns";

export type StatCategory =
  | "volume"
  | "contact"
  | "appointment"
  | "conversion"
  | "pipeline"
  | "agent"
  | "efficiency";

export const STAT_CATEGORIES: Record<StatCategory, { label: string; color: string }> = {
  volume:      { label: "Volume",      color: "#378ADD" },
  contact:     { label: "Contact",     color: "#1D9E75" },
  appointment: { label: "Appointment", color: "#7F77DD" },
  conversion:  { label: "Conversion",  color: "#639922" },
  pipeline:    { label: "Pipeline",    color: "#D85A30" },
  agent:       { label: "Agent",       color: "#BA7517" },
  efficiency:  { label: "Efficiency",  color: "#888780" },
};

export interface StatTrend {
  value: number;
  label: string;
  isGoodUp: boolean;
}

export interface StatResult {
  id: string;
  label: string;
  category: StatCategory;
  value: string;
  subtitle?: string;
  noData?: boolean;
  comingSoon?: boolean;
  trend?: StatTrend;
  /** when true, render value at 16px instead of 22px (used for agent names) */
  smallValue?: boolean;
}

export interface StatDataSources {
  summary?: ReportCallSummary;
  compSummary?: ReportCallSummary;
  breakdown?: ReportDispositionBreakdown;
  compBreakdown?: ReportDispositionBreakdown;
  volume?: ReportCallVolumeTimeseries;
  sessions?: { duration_seconds?: number }[];
  agents?: AgentProfile[];
  activeLeadsCount?: number;
  dispositions?: {
    name: string;
    auto_add_to_dnc?: boolean;
    callback_scheduler?: boolean;
    appointment_scheduler?: boolean;
  }[];
  dateRange?: { from?: Date; to?: Date };
  comparing: boolean;
}

// ─── Formatters ────────────────────────────────────────────────────────────
const NO_DATA: Omit<StatResult, "id" | "label" | "category"> = { value: "—", noData: true };

const fmtPct = (n: number): string => {
  if (n === 0) return "0%";
  return `${n.toFixed(1)}%`;
};
const fmtCount = (n: number): string => {
  if (n >= 1000) return n.toLocaleString("en-US");
  return Math.round(n).toString();
};
const fmtDuration = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

// ─── Aggregation helpers (no string matching for classification) ───────────
const dispoFlagSet = (
  dispositions: StatDataSources["dispositions"],
  flag: "auto_add_to_dnc" | "callback_scheduler" | "appointment_scheduler",
): Set<string> => {
  if (!dispositions) return new Set();
  return new Set(
    dispositions.filter((d) => d[flag]).map((d) => d.name.toLowerCase()),
  );
};
const sumDispoByFlag = (
  bd: ReportDispositionBreakdown | undefined,
  flagSet: Set<string>,
): number => {
  if (!bd) return 0;
  return bd.by_disposition
    .filter((d) => flagSet.has(d.disposition_name.toLowerCase()))
    .reduce((a, c) => a + c.count, 0);
};

// ─── Compute helpers ───────────────────────────────────────────────────────
const safeDiv = (n: number, d: number): number | null => (d > 0 ? n / d : null);

const trend = (
  current: number,
  comp: number | undefined,
  comparing: boolean,
  isGoodUp = true,
): StatTrend | undefined => {
  if (!comparing || comp === undefined || comp === 0) return undefined;
  const pct = ((current - comp) / comp) * 100;
  return { value: pct, label: "vs prior", isGoodUp };
};

interface Aggregates {
  total: number;
  contacted: number;
  converted: number;
  appts: number;
  dnc: number;
  callbacks: number;
  totalDuration: number;
  avgDurationContacted: number;
}

const aggregate = (
  s: ReportCallSummary | undefined,
  bd: ReportDispositionBreakdown | undefined,
  dispositions: StatDataSources["dispositions"],
): Aggregates => {
  const apptSet = dispoFlagSet(dispositions, "appointment_scheduler");
  const dncSet = dispoFlagSet(dispositions, "auto_add_to_dnc");
  const cbSet = dispoFlagSet(dispositions, "callback_scheduler");
  return {
    total: s?.total_calls ?? 0,
    contacted: s?.contacted ?? 0,
    converted: s?.converted ?? 0,
    appts: sumDispoByFlag(bd, apptSet),
    dnc: sumDispoByFlag(bd, dncSet),
    callbacks: sumDispoByFlag(bd, cbSet),
    totalDuration: s?.total_duration_seconds ?? 0,
    avgDurationContacted: s?.avg_duration_seconds ?? 0,
  };
};

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fmtHour = (h: number): string => {
  const ampm = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ampm}`;
};

const agentName = (agents: AgentProfile[] | undefined, id: string): string => {
  const a = agents?.find((x) => x.id === id);
  if (!a) return id.slice(0, 8);
  const full = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim();
  return full || a.email || id.slice(0, 8);
};

// ─── Stat Definition Registry ──────────────────────────────────────────────
export interface StatDefinition {
  id: string;
  label: string;
  category: StatCategory;
  invertTrend?: boolean;
  comingSoon?: boolean;
}

export const STAT_DEFINITIONS: StatDefinition[] = [
  // Volume (blue)
  { id: "stat_total_dials",       label: "Total dials",        category: "volume" },
  { id: "stat_outbound",          label: "Outbound calls",     category: "volume" },
  { id: "stat_inbound",           label: "Inbound calls",      category: "volume" },
  { id: "stat_calls_today",       label: "Calls today",        category: "volume" },
  { id: "stat_calls_this_week",   label: "Calls this week",    category: "volume" },
  { id: "stat_calls_per_day",     label: "Calls per day",      category: "volume" },
  { id: "stat_calls_per_hour",    label: "Calls per hour",     category: "volume" },
  { id: "stat_session_time",      label: "Session time",       category: "volume" },
  { id: "stat_unique_leads",      label: "Unique leads dialed",category: "volume", comingSoon: true },
  { id: "stat_new_leads_dialed",  label: "New leads dialed",   category: "volume", comingSoon: true },
  { id: "stat_followup_calls",    label: "Follow-up calls",    category: "volume", comingSoon: true },
  { id: "stat_voicemails_left",   label: "Voicemails left",    category: "volume", comingSoon: true },

  // Contact (teal)
  { id: "stat_total_contacted",        label: "Total contacted",         category: "contact" },
  { id: "stat_contact_rate",           label: "Contact rate",            category: "contact" },
  { id: "stat_first_dial_contact",     label: "First dial contact rate", category: "contact", comingSoon: true },
  { id: "stat_followup_contact_rate",  label: "Follow-up contact rate",  category: "contact", comingSoon: true },
  { id: "stat_avg_dials_to_contact",   label: "Avg dials to contact",    category: "contact", comingSoon: true },
  { id: "stat_speed_to_contact",       label: "Speed to contact",        category: "contact", comingSoon: true },
  { id: "stat_dnc_count",              label: "DNC count",               category: "contact" },
  { id: "stat_dnc_rate",               label: "DNC rate",                category: "contact", invertTrend: true },
  { id: "stat_total_talk_time",        label: "Total talk time",         category: "contact" },
  { id: "stat_avg_duration_all",       label: "Avg call duration",       category: "contact" },
  { id: "stat_avg_talk_contacted",     label: "Avg talk time",           category: "contact" },
  { id: "stat_longest_call",           label: "Longest call",            category: "contact", comingSoon: true },
  { id: "stat_shortest_connected",     label: "Shortest connected",      category: "contact", comingSoon: true },
  { id: "stat_talk_time_ratio",        label: "Talk time ratio",         category: "contact" },

  // Appointment (purple)
  { id: "stat_appointments_set",   label: "Appointments set",   category: "appointment" },
  { id: "stat_appt_set_rate",      label: "Appt set rate",      category: "appointment" },
  { id: "stat_contacted_to_appt",  label: "Contacted to appt",  category: "appointment" },
  { id: "stat_appts_kept",         label: "Appointments kept",  category: "appointment", comingSoon: true },
  { id: "stat_appt_noshow_rate",   label: "Appt no-show rate",  category: "appointment", comingSoon: true, invertTrend: true },
  { id: "stat_avg_dials_to_appt",  label: "Avg dials to appt",  category: "appointment", comingSoon: true, invertTrend: true },

  // Conversion (green)
  { id: "stat_policies_sold",      label: "Policies sold",       category: "conversion" },
  { id: "stat_call_to_close",      label: "Call to close rate",  category: "conversion" },
  { id: "stat_contacted_to_close", label: "Contacted to close",  category: "conversion" },
  { id: "stat_appt_to_close",      label: "Appt to close rate",  category: "conversion" },
  { id: "stat_dials_per_sale",     label: "Dials per sale",      category: "conversion", invertTrend: true },
  { id: "stat_avg_days_to_close",  label: "Avg days to close",   category: "conversion", comingSoon: true, invertTrend: true },
  { id: "stat_best_closing_hour",  label: "Best closing hour",   category: "conversion" },
  { id: "stat_best_closing_day",   label: "Best closing day",    category: "conversion" },

  // Pipeline (coral)
  { id: "stat_active_leads",        label: "Active leads",        category: "pipeline" },
  { id: "stat_leads_contacted",     label: "Leads contacted",     category: "pipeline", comingSoon: true },
  { id: "stat_leads_converted",     label: "Leads converted",     category: "pipeline" },
  { id: "stat_callback_rate",       label: "Callback rate",       category: "pipeline" },
  { id: "stat_callbacks_completed", label: "Callbacks completed", category: "pipeline", comingSoon: true },
  { id: "stat_callback_conv_rate",  label: "Callback conv rate",  category: "pipeline", comingSoon: true },
  { id: "stat_not_interested_rate", label: "Not interested rate", category: "pipeline", invertTrend: true },
  { id: "stat_lead_exhaustion",     label: "Lead exhaustion rate",category: "pipeline", comingSoon: true, invertTrend: true },

  // Agent (amber)
  { id: "stat_top_performer",       label: "Top performer",    category: "agent" },
  { id: "stat_top_dialer",          label: "Top dialer",       category: "agent" },
  { id: "stat_best_contact_agent",  label: "Best contact rate",category: "agent" },
  { id: "stat_best_conv_agent",     label: "Best conv rate",   category: "agent" },
  { id: "stat_avg_calls_agent",     label: "Avg calls/agent",  category: "agent" },
  { id: "stat_avg_sales_agent",     label: "Avg sales/agent",  category: "agent" },
  { id: "stat_agents_active",       label: "Agents active",    category: "agent", comingSoon: true },

  // Efficiency (gray)
  { id: "stat_dials_per_contact",   label: "Dials per contact",   category: "efficiency", invertTrend: true },
  { id: "stat_dials_per_appt",      label: "Dials per appt",      category: "efficiency", invertTrend: true },
  { id: "stat_talk_mins_per_sale",  label: "Talk mins per sale",  category: "efficiency", invertTrend: true },
  { id: "stat_sessions_per_sale",   label: "Sessions per sale",   category: "efficiency", comingSoon: true, invertTrend: true },
  { id: "stat_cost_per_lead",       label: "Cost per lead",       category: "efficiency", comingSoon: true, invertTrend: true },
  { id: "stat_cost_per_appt",       label: "Cost per appt",       category: "efficiency", comingSoon: true, invertTrend: true },
  { id: "stat_cost_per_sale",       label: "Cost per sale",       category: "efficiency", comingSoon: true, invertTrend: true },
];

export const STAT_DEFINITION_MAP: Record<string, StatDefinition> = STAT_DEFINITIONS.reduce(
  (acc, def) => { acc[def.id] = def; return acc; },
  {} as Record<string, StatDefinition>,
);

// ─── Main computation ──────────────────────────────────────────────────────
export function computeAllStats(data: StatDataSources): Map<string, StatResult> {
  const result = new Map<string, StatResult>();
  const { summary, compSummary, breakdown, compBreakdown, volume, sessions, agents, activeLeadsCount, dispositions, dateRange, comparing } = data;

  const A = aggregate(summary, breakdown, dispositions);
  const C = aggregate(compSummary, compBreakdown, dispositions);

  // Session hours
  const totalSessionSeconds = (sessions ?? []).reduce((acc, s) => acc + (s.duration_seconds ?? 0), 0);
  const totalSessionHours = totalSessionSeconds / 3600;

  // Days in range
  let daysInRange = 1;
  if (dateRange?.from && dateRange?.to) {
    daysInRange = Math.max(1, differenceInDays(dateRange.to, dateRange.from) + 1);
  }

  // Active agents (with calls)
  const activeAgents = summary?.calls_by_agent?.filter((a) => a.total > 0) ?? [];
  const agentCount = activeAgents.length;

  const put = (id: string, partial: Partial<StatResult>) => {
    const def = STAT_DEFINITION_MAP[id];
    if (!def) return;
    result.set(id, {
      id,
      label: def.label,
      category: def.category,
      value: "—",
      comingSoon: def.comingSoon,
      noData: def.comingSoon ? false : partial.noData,
      ...partial,
    });
  };

  // Coming-soon stub for all flagged stats
  for (const def of STAT_DEFINITIONS) {
    if (def.comingSoon) put(def.id, { value: "—", comingSoon: true });
  }

  // ── VOLUME ────────────────────────────────────────────────────────────
  put("stat_total_dials", {
    value: fmtCount(A.total),
    trend: trend(A.total, comparing ? C.total : undefined, comparing),
  });
  put("stat_outbound", {
    value: fmtCount(summary?.outbound ?? 0),
    trend: trend(summary?.outbound ?? 0, compSummary?.outbound, comparing),
  });
  put("stat_inbound", {
    value: fmtCount(summary?.inbound ?? 0),
    trend: trend(summary?.inbound ?? 0, compSummary?.inbound, comparing),
  });

  // Calls today
  {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const byDate = volume?.by_date ?? [];
    const todayEntry = byDate.find((d) => d.date === todayStr);
    const inRange = !!(dateRange?.from && dateRange?.to && new Date() >= dateRange.from && new Date() <= dateRange.to);
    if (!inRange) put("stat_calls_today", { value: "—", noData: true });
    else put("stat_calls_today", { value: fmtCount(todayEntry?.total ?? 0) });
  }

  // Calls this week (ISO)
  {
    const now = new Date();
    const week = getISOWeek(now);
    const year = getISOWeekYear(now);
    const byDate = volume?.by_date ?? [];
    let weekTotal = 0;
    let anyMatch = false;
    for (const entry of byDate) {
      const d = new Date(entry.date + "T00:00:00");
      if (getISOWeek(d) === week && getISOWeekYear(d) === year) {
        weekTotal += entry.total;
        anyMatch = true;
      }
    }
    // If date range doesn't include any of current week, show —
    const rangeIncludesWeek = !!(dateRange?.from && dateRange?.to)
      && dateRange.to >= startOfWeekFor(year, week)
      && dateRange.from <= endOfWeekFor(year, week);
    if (!anyMatch && !rangeIncludesWeek) put("stat_calls_this_week", { value: "—", noData: true });
    else put("stat_calls_this_week", { value: fmtCount(weekTotal) });
  }

  put("stat_calls_per_day", {
    value: daysInRange > 0 ? fmtCount(A.total / daysInRange) : "—",
    noData: daysInRange === 0,
  });
  {
    const v = safeDiv(A.total, totalSessionHours);
    put("stat_calls_per_hour", v === null ? { value: "—", noData: true } : { value: fmtCount(v) });
  }
  put("stat_session_time", { value: totalSessionSeconds > 0 ? fmtDuration(totalSessionSeconds) : "—", noData: totalSessionSeconds === 0 });

  // ── CONTACT ────────────────────────────────────────────────────────────
  put("stat_total_contacted", {
    value: fmtCount(A.contacted),
    trend: trend(A.contacted, comparing ? C.contacted : undefined, comparing),
  });
  {
    const r = safeDiv(A.contacted, A.total);
    const cr = safeDiv(C.contacted, C.total);
    put("stat_contact_rate", r === null
      ? { value: "—", noData: true }
      : {
          value: fmtPct(r * 100),
          subtitle: `${fmtCount(A.contacted)} contacted`,
          trend: trend(r, comparing ? cr ?? undefined : undefined, comparing),
        });
  }
  put("stat_dnc_count", { value: fmtCount(A.dnc), trend: trend(A.dnc, comparing ? C.dnc : undefined, comparing, false) });
  {
    const r = safeDiv(A.dnc, A.total);
    const cr = safeDiv(C.dnc, C.total);
    put("stat_dnc_rate", r === null
      ? { value: "—", noData: true }
      : { value: fmtPct(r * 100), trend: trend(r, comparing ? cr ?? undefined : undefined, comparing, false) });
  }
  put("stat_total_talk_time", { value: A.totalDuration > 0 ? fmtDuration(A.totalDuration) : "—", noData: A.totalDuration === 0 });
  {
    const v = safeDiv(A.totalDuration, A.total);
    put("stat_avg_duration_all", v === null ? { value: "—", noData: true } : { value: fmtDuration(v) });
  }
  put("stat_avg_talk_contacted", {
    value: A.avgDurationContacted > 0 ? fmtDuration(A.avgDurationContacted) : "—",
    subtitle: "contacted only",
    noData: A.avgDurationContacted === 0,
  });
  {
    const r = safeDiv(A.totalDuration, totalSessionSeconds);
    put("stat_talk_time_ratio", r === null ? { value: "—", noData: true } : { value: fmtPct(r * 100) });
  }

  // ── APPOINTMENT ─────────────────────────────────────────────────────────
  put("stat_appointments_set", {
    value: fmtCount(A.appts),
    trend: trend(A.appts, comparing ? C.appts : undefined, comparing),
  });
  {
    const r = safeDiv(A.appts, A.total);
    const cr = safeDiv(C.appts, C.total);
    put("stat_appt_set_rate", r === null
      ? { value: "—", noData: true }
      : { value: fmtPct(r * 100), trend: trend(r, comparing ? cr ?? undefined : undefined, comparing) });
  }
  {
    const r = safeDiv(A.appts, A.contacted);
    const cr = safeDiv(C.appts, C.contacted);
    put("stat_contacted_to_appt", r === null
      ? { value: "—", noData: true }
      : { value: fmtPct(r * 100), trend: trend(r, comparing ? cr ?? undefined : undefined, comparing) });
  }

  // ── CONVERSION ──────────────────────────────────────────────────────────
  put("stat_policies_sold", {
    value: fmtCount(A.converted),
    trend: trend(A.converted, comparing ? C.converted : undefined, comparing),
  });
  {
    const r = safeDiv(A.converted, A.total);
    const cr = safeDiv(C.converted, C.total);
    put("stat_call_to_close", r === null
      ? { value: "—", noData: true }
      : { value: fmtPct(r * 100), trend: trend(r, comparing ? cr ?? undefined : undefined, comparing) });
  }
  {
    const r = safeDiv(A.converted, A.contacted);
    const cr = safeDiv(C.converted, C.contacted);
    put("stat_contacted_to_close", r === null
      ? { value: "—", noData: true }
      : { value: fmtPct(r * 100), trend: trend(r, comparing ? cr ?? undefined : undefined, comparing) });
  }
  {
    const r = safeDiv(A.converted, A.appts);
    const cr = safeDiv(C.converted, C.appts);
    put("stat_appt_to_close", r === null
      ? { value: "—", noData: true }
      : { value: fmtPct(r * 100), trend: trend(r, comparing ? cr ?? undefined : undefined, comparing) });
  }
  {
    const r = safeDiv(A.total, A.converted);
    const cr = safeDiv(C.total, C.converted);
    put("stat_dials_per_sale", r === null
      ? { value: "—", noData: true }
      : { value: fmtCount(r), trend: trend(r, comparing ? cr ?? undefined : undefined, comparing, false) });
  }
  {
    const byHour = volume?.by_hour ?? [];
    const best = byHour.reduce<{ hour: number; converted: number } | null>(
      (acc, e) => (e.converted > 0 && (!acc || e.converted > acc.converted) ? { hour: e.hour, converted: e.converted } : acc),
      null,
    );
    put("stat_best_closing_hour", best ? { value: fmtHour(best.hour), subtitle: `${fmtCount(best.converted)} sales` } : { value: "—", noData: true });
  }
  {
    const byDow = volume?.by_day_of_week ?? [];
    const best = byDow.reduce<{ dow: number; name?: string; converted: number } | null>(
      (acc, e) => (e.converted > 0 && (!acc || e.converted > acc.converted) ? { dow: e.dow, name: e.dow_name, converted: e.converted } : acc),
      null,
    );
    put("stat_best_closing_day", best
      ? { value: best.name ?? DOW[best.dow] ?? "—", subtitle: `${fmtCount(best.converted)} sales` }
      : { value: "—", noData: true });
  }

  // ── PIPELINE ────────────────────────────────────────────────────────────
  put("stat_active_leads", {
    value: activeLeadsCount !== undefined ? fmtCount(activeLeadsCount) : "—",
    noData: activeLeadsCount === undefined,
  });
  put("stat_leads_converted", {
    value: fmtCount(A.converted),
    trend: trend(A.converted, comparing ? C.converted : undefined, comparing),
  });
  {
    const r = safeDiv(A.callbacks, A.contacted);
    const cr = safeDiv(C.callbacks, C.contacted);
    put("stat_callback_rate", r === null
      ? { value: "—", noData: true }
      : { value: fmtPct(r * 100), trend: trend(r, comparing ? cr ?? undefined : undefined, comparing) });
  }
  {
    const ni = breakdown?.by_disposition.find((d) => d.disposition_name.toLowerCase() === "not interested");
    if (!ni) put("stat_not_interested_rate", { value: "—", noData: true });
    else {
      const r = safeDiv(ni.count, A.total);
      put("stat_not_interested_rate", r === null
        ? { value: "—", noData: true }
        : { value: fmtPct(r * 100), trend: undefined });
    }
  }

  // ── AGENT ──────────────────────────────────────────────────────────────
  const byAgent = summary?.calls_by_agent ?? [];
  const topConv = byAgent.reduce<typeof byAgent[number] | null>((acc, a) => (!acc || a.converted > acc.converted ? a : acc), null);
  put("stat_top_performer", topConv && topConv.converted > 0
    ? { value: agentName(agents, topConv.agent_id), subtitle: `${fmtCount(topConv.converted)} sales`, smallValue: true }
    : { value: "—", noData: true });

  const topDial = byAgent.reduce<typeof byAgent[number] | null>((acc, a) => (!acc || a.total > acc.total ? a : acc), null);
  put("stat_top_dialer", topDial && topDial.total > 0
    ? { value: agentName(agents, topDial.agent_id), subtitle: `${fmtCount(topDial.total)} calls`, smallValue: true }
    : { value: "—", noData: true });

  const bestContact = byAgent.reduce<{ id: string; rate: number } | null>((acc, a) => {
    if (a.total === 0) return acc;
    const r = a.contacted / a.total;
    return !acc || r > acc.rate ? { id: a.agent_id, rate: r } : acc;
  }, null);
  put("stat_best_contact_agent", bestContact
    ? { value: agentName(agents, bestContact.id), subtitle: fmtPct(bestContact.rate * 100), smallValue: true }
    : { value: "—", noData: true });

  const bestConv = byAgent.reduce<{ id: string; rate: number } | null>((acc, a) => {
    if (a.total === 0) return acc;
    const r = a.converted / a.total;
    return !acc || r > acc.rate ? { id: a.agent_id, rate: r } : acc;
  }, null);
  put("stat_best_conv_agent", bestConv && bestConv.rate > 0
    ? { value: agentName(agents, bestConv.id), subtitle: fmtPct(bestConv.rate * 100), smallValue: true }
    : { value: "—", noData: true });

  {
    const v = safeDiv(A.total, agentCount);
    put("stat_avg_calls_agent", v === null ? { value: "—", noData: true } : { value: fmtCount(v) });
  }
  {
    const v = safeDiv(A.converted, agentCount);
    put("stat_avg_sales_agent", v === null ? { value: "—", noData: true } : { value: fmtCount(v) });
  }

  // ── EFFICIENCY ─────────────────────────────────────────────────────────
  {
    const v = safeDiv(A.total, A.contacted);
    const cv = safeDiv(C.total, C.contacted);
    put("stat_dials_per_contact", v === null
      ? { value: "—", noData: true }
      : { value: fmtCount(v), trend: trend(v, comparing ? cv ?? undefined : undefined, comparing, false) });
  }
  {
    const v = safeDiv(A.total, A.appts);
    const cv = safeDiv(C.total, C.appts);
    put("stat_dials_per_appt", v === null
      ? { value: "—", noData: true }
      : { value: fmtCount(v), trend: trend(v, comparing ? cv ?? undefined : undefined, comparing, false) });
  }
  {
    const v = safeDiv(A.totalDuration / 60, A.converted);
    const cv = safeDiv(C.totalDuration / 60, C.converted);
    put("stat_talk_mins_per_sale", v === null
      ? { value: "—", noData: true }
      : { value: fmtCount(v), trend: trend(v, comparing ? cv ?? undefined : undefined, comparing, false) });
  }

  return result;
}

// Helpers for week-range checks
function startOfWeekFor(year: number, week: number): Date {
  // ISO week: week 1 contains Jan 4
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setDate(jan4.getDate() - (jan4Day - 1));
  const start = new Date(mondayWeek1);
  start.setDate(mondayWeek1.getDate() + (week - 1) * 7);
  return start;
}
function endOfWeekFor(year: number, week: number): Date {
  const s = startOfWeekFor(year, week);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
}
