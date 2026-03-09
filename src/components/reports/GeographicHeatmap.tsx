import React, { useMemo, useState, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip as RTooltip } from "recharts";
import ReportSection from "./ReportSection";
import { downloadCSV, isSoldDisposition } from "@/lib/reports-queries";

/* ────────────────── State mapping ────────────────── */

const STATE_ABBR_TO_NAME: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",
  KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",
  OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
  SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",
  VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
  DC:"District of Columbia",
};

const STATE_NAME_TO_ABBR: Record<string, string> = {};
Object.entries(STATE_ABBR_TO_NAME).forEach(([abbr, name]) => {
  STATE_NAME_TO_ABBR[name.toLowerCase()] = abbr;
});

function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (STATE_ABBR_TO_NAME[upper]) return upper;
  const fromName = STATE_NAME_TO_ABBR[trimmed.toLowerCase()];
  if (fromName) return fromName;
  return null;
}

/* ────────────────── Simplified US SVG paths ────────────────── */
// Using a compact representation of US state boundaries for the map.
// Each state is a path at 960x600 viewBox.

const US_STATE_PATHS: Record<string, string> = {
  AL: "M628,407 L632,457 L631,467 L624,469 L623,458 L614,465 L612,407Z",
  AK: "M113,491 L122,491 L127,498 L138,497 L147,500 L148,507 L141,512 L133,513 L126,510 L113,507Z",
  AZ: "M205,393 L261,393 L267,452 L231,468 L215,467 L196,454 L205,393Z",
  AR: "M563,393 L610,391 L612,407 L614,441 L564,444 L563,393Z",
  CA: "M112,283 L147,296 L165,340 L186,382 L196,454 L167,448 L139,403 L119,339 L108,307Z",
  CO: "M276,303 L371,303 L370,361 L275,362Z",
  CT: "M834,195 L852,189 L859,205 L844,214 L833,209Z",
  DE: "M793,277 L806,272 L810,290 L798,298Z",
  FL: "M644,458 L697,437 L728,438 L746,451 L739,487 L709,512 L688,519 L680,516 L671,496 L663,484 L652,470Z",
  GA: "M665,383 L709,383 L716,386 L728,438 L697,437 L644,458 L637,443 L632,413 L632,383Z",
  HI: "M258,497 L271,494 L275,500 L267,505 L258,503Z",
  ID: "M203,152 L243,160 L240,227 L228,256 L196,259 L194,218 L197,185Z",
  IL: "M591,257 L609,254 L615,265 L619,321 L615,347 L600,363 L585,361 L579,339 L582,285Z",
  IN: "M627,260 L656,258 L660,325 L648,348 L627,350 L619,321Z",
  IA: "M518,237 L588,232 L591,257 L582,285 L530,289 L515,280Z",
  KS: "M406,326 L510,324 L510,375 L405,377Z",
  KY: "M614,330 L693,315 L716,323 L702,345 L660,355 L630,360 L615,347Z",
  LA: "M563,444 L614,441 L612,467 L619,487 L607,498 L580,497 L565,479 L555,465Z",
  ME: "M852,100 L871,86 L885,101 L882,140 L862,160 L847,152 L844,130Z",
  MD: "M747,272 L793,260 L806,272 L798,298 L780,303 L760,296 L750,282Z",
  MA: "M840,186 L862,178 L875,182 L871,192 L847,195 L840,191Z",
  MI: "M608,150 L624,146 L648,152 L660,177 L658,210 L640,234 L627,232 L621,218 L608,171Z M573,164 L595,158 L605,172 L603,195 L586,208 L571,195Z",
  MN: "M480,110 L548,108 L553,155 L540,195 L520,205 L490,195 L478,160Z",
  MS: "M601,393 L631,391 L632,413 L632,457 L631,467 L612,467 L614,441 L601,441Z",
  MO: "M520,307 L585,305 L600,363 L585,385 L564,393 L530,393 L510,375Z",
  MT: "M232,110 L341,106 L345,170 L300,172 L270,166 L240,160Z",
  NE: "M370,264 L467,261 L474,299 L406,302 L370,302Z",
  NV: "M147,210 L203,220 L186,382 L165,340 L147,296Z",
  NH: "M847,125 L855,120 L862,140 L862,160 L852,172 L845,163 L844,130Z",
  NJ: "M800,225 L814,218 L817,248 L810,268 L798,268 L793,245Z",
  NM: "M262,393 L348,389 L352,453 L266,457Z",
  NY: "M738,158 L806,137 L825,156 L833,186 L814,206 L800,206 L784,215 L758,218 L746,200 L738,175Z",
  NC: "M667,349 L754,337 L778,349 L770,368 L732,380 L697,383 L665,383Z",
  ND: "M378,110 L472,108 L474,166 L378,168Z",
  OH: "M660,248 L700,238 L716,255 L715,298 L693,315 L660,325Z",
  OK: "M374,377 L405,377 L406,393 L476,389 L510,375 L520,393 L510,405 L432,414 L374,416Z",
  OR: "M108,145 L194,158 L203,152 L197,185 L194,218 L140,217 L108,195Z",
  PA: "M717,218 L793,205 L800,225 L793,260 L747,272 L720,270 L717,240Z",
  RI: "M855,196 L865,191 L866,203 L858,207Z",
  SC: "M697,383 L732,361 L748,370 L740,394 L716,405 L697,401Z",
  SD: "M378,168 L474,166 L476,230 L380,233Z",
  TN: "M610,357 L715,340 L716,362 L614,377Z",
  TX: "M348,389 L432,414 L510,405 L530,421 L533,470 L520,508 L490,537 L458,550 L428,540 L398,519 L376,495 L362,467 L352,453Z",
  UT: "M228,256 L276,252 L276,340 L230,345 L215,318Z",
  VT: "M832,125 L844,120 L847,152 L840,170 L832,163Z",
  VA: "M700,298 L775,283 L796,303 L778,330 L754,337 L716,323 L700,318Z",
  WA: "M108,75 L198,85 L203,125 L194,158 L108,145Z",
  WV: "M700,275 L729,270 L747,272 L750,282 L740,308 L715,320 L700,298Z",
  WI: "M545,130 L595,124 L608,150 L608,171 L603,195 L586,208 L563,215 L540,210 L540,195 L548,155Z",
  WY: "M253,180 L345,175 L348,252 L253,255Z",
  DC: "M776,290 L780,286 L783,292 L779,295Z",
};

type HeatMode = "volume" | "leads" | "conversion";

interface StateData {
  abbr: string;
  name: string;
  totalLeads: number;
  totalCalls: number;
  connectedCalls: number;
  policiesSold: number;
  answerRate: number;
  conversionRate: number;
  topDisposition: string;
}

interface Props {
  calls: any[];
  leads: any[];
  campaignLeads: any[];
  dispositions: any[];
  loading: boolean;
  onStateFilter: (state: string | null) => void;
  activeStateFilter: string | null;
}

const GeographicHeatmap: React.FC<Props> = ({ calls, leads, campaignLeads, dispositions, loading, onStateFilter, activeStateFilter }) => {
  const [mode, setMode] = useState<HeatMode>("volume");
  const [hoveredState, setHoveredState] = useState<string | null>(null);

  // Build state data maps
  const stateData = useMemo(() => {
    const map = new Map<string, StateData>();

    const init = (abbr: string) => {
      if (!map.has(abbr)) {
        map.set(abbr, {
          abbr, name: STATE_ABBR_TO_NAME[abbr] || abbr,
          totalLeads: 0, totalCalls: 0, connectedCalls: 0,
          policiesSold: 0, answerRate: 0, conversionRate: 0, topDisposition: "N/A",
        });
      }
      return map.get(abbr)!;
    };

    // Count leads per state
    for (const l of leads) {
      const st = normalizeState(l.state);
      if (st) init(st).totalLeads++;
    }

    // Build a contact_id → state lookup from leads
    const contactStateMap = new Map<string, string>();
    for (const l of leads) {
      const st = normalizeState(l.state);
      if (st && l.id) contactStateMap.set(l.id, st);
    }

    // Build campaign_lead_id → state lookup
    const clStateMap = new Map<string, string>();
    for (const cl of campaignLeads) {
      const st = normalizeState(cl.state);
      if (st && cl.id) clStateMap.set(cl.id, st);
    }

    // Disposition counts per state
    const dispCounts = new Map<string, Map<string, number>>();

    for (const c of calls) {
      let st = contactStateMap.get(c.contact_id);
      if (!st && c.campaign_lead_id) st = clStateMap.get(c.campaign_lead_id);
      if (!st) continue;

      const s = init(st);
      s.totalCalls++;
      if (c.duration > 0) s.connectedCalls++;
      if (isSoldDisposition(c.disposition_name)) s.policiesSold++;

      const dn = c.disposition_name || "Unknown";
      if (!dispCounts.has(st)) dispCounts.set(st, new Map());
      const dc = dispCounts.get(st)!;
      dc.set(dn, (dc.get(dn) || 0) + 1);
    }

    // Compute rates and top disposition
    for (const [abbr, s] of map) {
      s.answerRate = s.totalCalls > 0 ? Math.round((s.connectedCalls / s.totalCalls) * 100) : 0;
      s.conversionRate = s.totalCalls > 0 ? Math.round((s.policiesSold / s.totalCalls) * 100) : 0;
      const dc = dispCounts.get(abbr);
      if (dc) {
        let maxD = "", maxC = 0;
        for (const [d, cnt] of dc) { if (cnt > maxC) { maxD = d; maxC = cnt; } }
        s.topDisposition = maxD;
      }
    }

    return map;
  }, [calls, leads, campaignLeads]);

  // Max values for color scaling
  const { maxVolume, maxLeads, maxConversion } = useMemo(() => {
    let mv = 0, ml = 0, mc = 0;
    for (const s of stateData.values()) {
      if (s.totalCalls > mv) mv = s.totalCalls;
      if (s.totalLeads > ml) ml = s.totalLeads;
      if (s.conversionRate > mc) mc = s.conversionRate;
    }
    return { maxVolume: mv || 1, maxLeads: ml || 1, maxConversion: mc || 1 };
  }, [stateData]);

  const getColor = useCallback((abbr: string): string => {
    const s = stateData.get(abbr);
    if (!s) return "hsl(var(--muted))";

    if (mode === "volume") {
      const intensity = s.totalCalls / maxVolume;
      if (s.totalCalls === 0) return "hsl(var(--muted))";
      const l = 90 - intensity * 55;
      return `hsl(210, 70%, ${l}%)`;
    }
    if (mode === "leads") {
      const intensity = s.totalLeads / maxLeads;
      if (s.totalLeads === 0) return "hsl(var(--muted))";
      const l = 90 - intensity * 55;
      return `hsl(140, 60%, ${l}%)`;
    }
    // conversion
    if (s.totalCalls < 5) return "hsl(var(--muted) / 0.5)";
    const cr = s.conversionRate;
    if (cr < 5) return "hsl(0, 70%, 65%)";
    if (cr < 15) return "hsl(45, 80%, 55%)";
    return "hsl(130, 60%, 45%)";
  }, [stateData, mode, maxVolume, maxLeads]);

  // Top 5 states by current mode
  const top5 = useMemo(() => {
    const entries = Array.from(stateData.values()).filter(s => {
      if (mode === "volume") return s.totalCalls > 0;
      if (mode === "leads") return s.totalLeads > 0;
      return s.totalCalls >= 5;
    });
    entries.sort((a, b) => {
      if (mode === "volume") return b.totalCalls - a.totalCalls;
      if (mode === "leads") return b.totalLeads - a.totalLeads;
      return b.conversionRate - a.conversionRate;
    });
    return entries.slice(0, 5).map(s => ({
      abbr: s.abbr,
      name: s.name,
      value: mode === "volume" ? s.totalCalls : mode === "leads" ? s.totalLeads : s.conversionRate,
      label: mode === "conversion" ? `${s.conversionRate}%` : String(mode === "volume" ? s.totalCalls : s.totalLeads),
    }));
  }, [stateData, mode]);

  const top5Max = useMemo(() => Math.max(...top5.map(s => s.value), 1), [top5]);

  const handleExport = () => {
    const rows = Array.from(stateData.values()).map(s => [
      s.abbr, s.name, String(s.totalLeads), String(s.totalCalls),
      String(s.connectedCalls), `${s.answerRate}%`, String(s.policiesSold),
      `${s.conversionRate}%`, s.topDisposition,
    ]);
    downloadCSV("geographic-report", ["Abbr","State","Leads","Calls","Connected","Answer Rate","Sold","Conversion","Top Disposition"], rows);
  };

  const modeLabel = mode === "volume" ? "Call Volume" : mode === "leads" ? "Lead Density" : "Conversion Rate";

  if (loading) {
    return (
      <ReportSection title="Geographic Heatmap" defaultOpen={false}>
        <Skeleton className="h-[400px] w-full rounded-lg" />
      </ReportSection>
    );
  }

  const hoveredData = hoveredState ? stateData.get(hoveredState) : null;

  return (
    <ReportSection title="Geographic Heatmap" defaultOpen={false} badge="US Map" onExport={handleExport}>
      <Tabs value={mode} onValueChange={v => setMode(v as HeatMode)} className="mb-4">
        <TabsList className="h-8">
          <TabsTrigger value="volume" className="text-xs px-3 py-1">Call Volume</TabsTrigger>
          <TabsTrigger value="leads" className="text-xs px-3 py-1">Lead Density</TabsTrigger>
          <TabsTrigger value="conversion" className="text-xs px-3 py-1">Conversion Rate</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="relative">
        {/* Tooltip overlay */}
        {hoveredData && (
          <div className="absolute top-2 right-2 z-10 bg-popover border rounded-lg p-3 shadow-lg text-xs min-w-[200px] pointer-events-none">
            <p className="font-semibold text-foreground text-sm mb-1.5">{hoveredData.name}</p>
            <div className="space-y-1 text-muted-foreground">
              <div className="flex justify-between"><span>Total Leads</span><span className="text-foreground font-medium">{hoveredData.totalLeads}</span></div>
              <div className="flex justify-between"><span>Total Calls</span><span className="text-foreground font-medium">{hoveredData.totalCalls}</span></div>
              <div className="flex justify-between"><span>Connected</span><span className="text-foreground font-medium">{hoveredData.connectedCalls}</span></div>
              <div className="flex justify-between"><span>Answer Rate</span><span className="text-foreground font-medium">{hoveredData.answerRate}%</span></div>
              <div className="flex justify-between"><span>Policies Sold</span><span className="text-foreground font-medium">{hoveredData.policiesSold}</span></div>
              <div className="flex justify-between"><span>Conversion Rate</span><span className="text-foreground font-medium">{hoveredData.conversionRate}%</span></div>
              <div className="flex justify-between"><span>Top Disposition</span><span className="text-foreground font-medium truncate max-w-[100px]">{hoveredData.topDisposition}</span></div>
            </div>
          </div>
        )}

        {/* SVG US Map */}
        <svg viewBox="60 60 840 500" className="w-full h-auto max-h-[450px]" style={{ shapeRendering: "geometricPrecision" }}>
          {Object.entries(US_STATE_PATHS).map(([abbr, path]) => {
            const isActive = activeStateFilter === abbr;
            const isHovered = hoveredState === abbr;
            return (
              <path
                key={abbr}
                d={path}
                fill={isActive ? "hsl(var(--primary))" : getColor(abbr)}
                stroke="hsl(var(--border))"
                strokeWidth={isActive || isHovered ? 2 : 0.5}
                className="cursor-pointer transition-colors duration-150"
                opacity={activeStateFilter && !isActive ? 0.4 : 1}
                onMouseEnter={() => setHoveredState(abbr)}
                onMouseLeave={() => setHoveredState(null)}
                onClick={() => onStateFilter(activeStateFilter === abbr ? null : abbr)}
              />
            );
          })}
        </svg>

        {/* Color legend */}
        <div className="flex items-center justify-center gap-2 mt-2 text-[10px] text-muted-foreground">
          {mode === "volume" && (
            <>
              <span>0 calls</span>
              <div className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(to right, hsl(210,70%,90%), hsl(210,70%,35%))" }} />
              <span>{maxVolume} calls</span>
            </>
          )}
          {mode === "leads" && (
            <>
              <span>0 leads</span>
              <div className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(to right, hsl(140,60%,90%), hsl(140,60%,35%))" }} />
              <span>{maxLeads} leads</span>
            </>
          )}
          {mode === "conversion" && (
            <>
              <span className="text-destructive">&lt;5%</span>
              <div className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(to right, hsl(0,70%,65%), hsl(45,80%,55%), hsl(130,60%,45%))" }} />
              <span className="text-green-600">&gt;15%</span>
            </>
          )}
        </div>
      </div>

      {/* Top 5 summary */}
      {top5.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Top 5 States by {modeLabel}</p>
          <div className="space-y-1.5">
            {top5.map((s, i) => (
              <div key={s.abbr} className="flex items-center gap-2 text-xs">
                <span className="w-7 text-muted-foreground font-medium">{s.abbr}</span>
                <div className="flex-1 h-5 bg-accent rounded overflow-hidden relative">
                  <div
                    className="h-full rounded transition-all duration-300"
                    style={{
                      width: `${(s.value / top5Max) * 100}%`,
                      backgroundColor: mode === "volume" ? "hsl(210,70%,50%)" : mode === "leads" ? "hsl(140,60%,45%)" : "hsl(130,60%,45%)",
                    }}
                  />
                  <span className="absolute inset-y-0 left-2 flex items-center text-[10px] text-foreground font-medium">{s.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {stateData.size === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">No geographic data for this period</p>
      )}
    </ReportSection>
  );
};

export default GeographicHeatmap;
