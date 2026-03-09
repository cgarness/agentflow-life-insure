import React, { useMemo, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { parseISO } from "date-fns";
import { downloadCSV } from "@/lib/reports-queries";
import { Lightbulb } from "lucide-react";
import ReportSection from "./ReportSection";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 13 }, (_, i) => i + 8);

interface Props { calls: any[]; loading: boolean; }
type Tab = "volume" | "answer";

const CallingHeatmap: React.FC<Props> = ({ calls, loading }) => {
  const [tab, setTab] = useState<Tab>("volume");

  const { volumeGrid, answerGrid, maxVolume, bestSlots } = useMemo(() => {
    const volume: number[][] = Array.from({ length: 7 }, () => Array(13).fill(0));
    const answered: number[][] = Array.from({ length: 7 }, () => Array(13).fill(0));

    calls.forEach(c => {
      const d = parseISO(c.started_at);
      const day = d.getDay();
      const hour = d.getHours();
      if (hour >= 8 && hour <= 20) {
        volume[day][hour - 8]++;
        if ((c.duration || 0) > 0) answered[day][hour - 8]++;
      }
    });

    let maxV = 0;
    volume.forEach(row => row.forEach(v => { if (v > maxV) maxV = v; }));

    const answerGrid = volume.map((row, di) =>
      row.map((t, hi) => t > 0 ? Math.round(answered[di][hi] / t * 100) : -1)
    );

    // Best slots
    const slots: { day: number; hour: number; rate: number; count: number }[] = [];
    volume.forEach((row, di) => row.forEach((t, hi) => {
      if (t >= 5) {
        const rate = answerGrid[di][hi];
        if (rate > 0) slots.push({ day: di, hour: hi + 8, rate, count: t });
      }
    }));
    slots.sort((a, b) => b.rate - a.rate);

    return { volumeGrid: volume, answerGrid, maxVolume: maxV, bestSlots: slots.slice(0, 3) };
  }, [calls]);

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
    <ReportSection title="Calling Times Heatmap" onExport={handleExport}>
      <div className="flex items-center gap-1 mb-3">
        {(["volume", "answer"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-2.5 py-1 text-xs rounded-md ${t === tab ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}>
            {t === "volume" ? "Call Volume" : "Answer Rate"}
          </button>
        ))}
      </div>
      <TooltipProvider>
        <div className="overflow-x-auto">
          <div className="min-w-[500px]">
            <div className="flex mb-1 ml-10">
              {HOURS.map(h => <div key={h} className="flex-1 text-center text-[10px] text-muted-foreground">{h > 12 ? h - 12 : h}{h >= 12 ? "p" : "a"}</div>)}
            </div>
            {DAYS.map((day, di) => (
              <div key={day} className="flex items-center mb-0.5">
                <span className="w-10 text-xs text-muted-foreground shrink-0">{day}</span>
                <div className="flex flex-1 gap-0.5">
                  {HOURS.map((h, hi) => {
                    const val = grid[di][hi];
                    const colorClass = tab === "volume" ? getVolumeColor(val) : getAnswerColor(val);
                    return (
                      <Tooltip key={hi}>
                        <TooltipTrigger asChild>
                          <div className={`flex-1 aspect-square rounded-sm ${colorClass} flex items-center justify-center cursor-default`}>
                            {volumeGrid[di][hi] > 0 && <span className="text-[9px] font-medium text-foreground/70">{tab === "volume" ? val : `${val}%`}</span>}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          <p>{day} {fmtHour(h)}</p>
                          <p>Calls: {volumeGrid[di][hi]}</p>
                          <p>Answer rate: {answerGrid[di][hi] >= 0 ? `${answerGrid[di][hi]}%` : "N/A"}</p>
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
        <div className="mt-3 bg-primary/5 rounded-lg p-3 flex items-start gap-2">
          <Lightbulb className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-foreground">
            <span className="font-medium">Best calling windows: </span>
            {bestSlots.map((s, i) => (
              <span key={i}>{DAYS[s.day]} {fmtHour(s.hour)} ({s.rate}% answer rate){i < bestSlots.length - 1 ? ", " : ""}</span>
            ))}
          </p>
        </div>
      )}
    </ReportSection>
  );
};

export default CallingHeatmap;
