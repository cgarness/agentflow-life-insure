import React, { useMemo, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCSV, ReportCallVolumeTimeseries } from "@/lib/reports-queries";
import { Lightbulb } from "lucide-react";
import ReportSection from "./ReportSection";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 13 }, (_, i) => i + 8);

interface Props { volume?: ReportCallVolumeTimeseries; loading: boolean; }
type Tab = "volume" | "answer";

const CallingHeatmap: React.FC<Props> = ({ volume, loading }) => {
  const [tab, setTab] = useState<Tab>("volume");

  const { volumeGrid, answerGrid, maxVolume, bestSlots } = useMemo(() => {
    const vGrid: number[][] = Array.from({ length: 7 }, () => Array(13).fill(0));
    const aGrid: number[][] = Array.from({ length: 7 }, () => Array(13).fill(0));
    const slots: { day: number; hour: number; rate: number; count: number }[] = [];

    if (!volume) {
      return { volumeGrid: vGrid, answerGrid: aGrid, maxVolume: 0, bestSlots: slots };
    }

    const totalCalls = volume.by_hour.reduce((s, h) => s + h.total, 0);

    let maxV = 0;

    // Use independence assumption to reconstruct the 2D joint distribution
    // V_dh = (V_d * V_h) / V_total
    for (let di = 0; di < 7; di++) {
      const dData = volume.by_day_of_week.find(d => d.dow === di) || { total: 0, contacted: 0 };
      for (let hi = 0; hi < 13; hi++) {
        const hData = volume.by_hour.find(h => h.hour === hi + 8) || { total: 0, contacted: 0 };
        
        const estVol = totalCalls > 0 ? (dData.total * hData.total) / totalCalls : 0;
        const estConn = totalCalls > 0 ? (dData.contacted * hData.contacted) / totalCalls : 0; // Rough approx
        
        const v = Math.round(estVol);
        vGrid[di][hi] = v;
        aGrid[di][hi] = v > 0 ? Math.round((estConn / estVol) * 100) : -1;

        if (v > maxV) maxV = v;

        if (v >= 5 && aGrid[di][hi] > 0) {
          slots.push({ day: di, hour: hi + 8, rate: aGrid[di][hi], count: v });
        }
      }
    }

    slots.sort((a, b) => b.rate - a.rate);

    return { volumeGrid: vGrid, answerGrid: aGrid, maxVolume: maxV, bestSlots: slots.slice(0, 3) };
  }, [volume]);

  const getVolumeColor = (v: number) => {
    if (v === 0) return "bg-accent";
    const i = maxVolume > 0 ? v / maxVolume : 0;
    if (i < 0.25) return "bg-primary/20";
    if (i < 0.5) return "bg-primary/40";
    if (i < 0.75) return "bg-primary/60";
    return "bg-primary/90";
  };

  const getAnswerColor = (rate: number) => {
    if (rate < 0) return "bg-accent";
    if (rate < 30) return "bg-destructive/60";
    if (rate < 50) return "bg-warning/60";
    if (rate < 70) return "bg-warning/40";
    return "bg-success/60";
  };

  const fmtHour = (h: number) => `${h > 12 ? h - 12 : h}${h >= 12 ? "PM" : "AM"}`;

  const handleExport = () => {
    const headers = ["Day/Hour", ...HOURS.map(h => fmtHour(h))];
    const grid = tab === "volume" ? volumeGrid : answerGrid;
    downloadCSV(`calling-heatmap-${tab}`, headers, DAYS.map((d, di) => [d, ...grid[di].map(v => tab === "answer" && v < 0 ? "N/A" : String(v))]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-[280px]" /></div>;

  const grid = tab === "volume" ? volumeGrid : answerGrid;

  return (
    <ReportSection title="Calling Times Heatmap" badge="Activity" onExport={handleExport}>
      <div className="flex items-center gap-1.5 mb-5 p-1 bg-slate-100/50 dark:bg-slate-800/50 rounded-xl w-fit">
        {(["volume", "answer"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${t === tab ? "bg-white dark:bg-slate-950 text-primary shadow-sm ring-1 ring-slate-200 dark:ring-slate-800" : "text-muted-foreground hover:text-foreground"}`}>
            {t === "volume" ? "Call Volume" : "Contact Rate"}
          </button>
        ))}
      </div>
      <TooltipProvider>
        <div className="overflow-x-auto pb-2">
          <div className="min-w-[500px]">
            <div className="flex mb-2 ml-10">
              {HOURS.map(h => <div key={h} className="flex-1 text-center text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">{h > 12 ? h - 12 : h}{h >= 12 ? "pm" : "am"}</div>)}
            </div>
            {DAYS.map((day, di) => (
              <div key={day} className="flex items-center mb-1">
                <span className="w-10 text-[11px] font-bold text-muted-foreground uppercase shrink-0">{day}</span>
                <div className="flex flex-1 gap-1">
                  {HOURS.map((h, hi) => {
                    const val = grid[di][hi];
                    const colorClass = tab === "volume" ? getVolumeColor(val) : getAnswerColor(val);
                    return (
                      <Tooltip key={hi}>
                        <TooltipTrigger asChild>
                          <div className={`flex-1 aspect-square rounded-[3px] ${colorClass} flex items-center justify-center cursor-default transition-transform hover:scale-110 hover:z-10`}>
                            {volumeGrid[di][hi] > 0 && <span className="text-[9px] font-black text-foreground/50">{tab === "volume" ? val : `${val}%`}</span>}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs font-bold border-primary/20 bg-background/95 backdrop-blur-sm">
                          <p>{day} {fmtHour(h)}</p>
                          <div className="mt-1 space-y-0.5">
                            <p className="text-primary">Calls: {volumeGrid[di][hi]}</p>
                            <p className="text-emerald-500">Contact rate: {answerGrid[di][hi] >= 0 ? `${answerGrid[di][hi]}%` : "N/A"}</p>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </TooltipProvider>

      {bestSlots.length > 0 && (
        <div className="mt-5 bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/10 rounded-2xl p-4 flex items-start gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-xl">
            <Lightbulb className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-1">Peak Performance Windows</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Based on historical data, your agents should prioritize dialing during:
              <span className="block mt-1 font-bold text-foreground">
                {bestSlots.map((s, i) => (
                  <span key={i} className="inline-flex items-center">
                    {DAYS[s.day]}s @ {fmtHour(s.hour)}
                    <span className="mx-1.5 opacity-30">•</span>
                  </span>
                ))}
              </span>
            </p>
          </div>
        </div>
      )}
    </ReportSection>
  );
};

export default CallingHeatmap;
