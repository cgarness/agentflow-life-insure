import React, { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { parseISO } from "date-fns";
import { downloadCSV } from "@/lib/reports-queries";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 8AM to 8PM

interface Props {
  calls: any[];
  loading: boolean;
}

type Tab = "volume" | "answer";

const CallingHeatmap: React.FC<Props> = ({ calls, loading }) => {
  const [tab, setTab] = useState<Tab>("volume");

  const { volumeGrid, answerGrid, maxVolume } = useMemo(() => {
    const volume: number[][] = Array.from({ length: 7 }, () => Array(13).fill(0));
    const answered: number[][] = Array.from({ length: 7 }, () => Array(13).fill(0));
    const total: number[][] = Array.from({ length: 7 }, () => Array(13).fill(0));

    calls.forEach(c => {
      const d = parseISO(c.started_at);
      const day = d.getDay();
      const hour = d.getHours();
      if (hour >= 8 && hour <= 20) {
        const hi = hour - 8;
        volume[day][hi]++;
        total[day][hi]++;
        if ((c.duration || 0) > 0) answered[day][hi]++;
      }
    });

    let maxV = 0;
    volume.forEach(row => row.forEach(v => { if (v > maxV) maxV = v; }));

    const answerGrid = total.map((row, di) =>
      row.map((t, hi) => t > 0 ? Math.round(answered[di][hi] / t * 100) : -1)
    );

    return { volumeGrid: volume, answerGrid, maxVolume: maxV };
  }, [calls]);

  const getVolumeColor = (v: number) => {
    if (v === 0) return "bg-accent";
    const intensity = maxVolume > 0 ? v / maxVolume : 0;
    if (intensity < 0.25) return "bg-primary/20";
    if (intensity < 0.5) return "bg-primary/40";
    if (intensity < 0.75) return "bg-primary/60";
    return "bg-primary/90";
  };

  const getAnswerColor = (rate: number) => {
    if (rate < 0) return "bg-accent";
    if (rate < 30) return "bg-destructive/60";
    if (rate < 50) return "bg-warning/60";
    if (rate < 70) return "bg-warning/40";
    return "bg-success/60";
  };

  const handleExport = () => {
    const headers = ["Day/Hour", ...HOURS.map(h => `${h > 12 ? h - 12 : h}${h >= 12 ? "PM" : "AM"}`)];
    const grid = tab === "volume" ? volumeGrid : answerGrid;
    const rows = DAYS.map((d, di) => [d, ...grid[di].map(v => tab === "answer" && v < 0 ? "N/A" : String(v))]);
    downloadCSV(`calling-heatmap-${tab}`, headers, rows);
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-6 w-48 mb-4" /><Skeleton className="h-[250px]" /></div>;

  const grid = tab === "volume" ? volumeGrid : answerGrid;

  return (
    <div className="bg-card rounded-xl border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-foreground">Calling Times</h3>
        <div className="flex items-center gap-2">
          {(["volume", "answer"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-2.5 py-1 text-xs rounded-md capitalize ${t === tab ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}>
              {t === "volume" ? "Call Volume" : "Answer Rate"}
            </button>
          ))}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExport}><Download className="w-3.5 h-3.5" /></Button>
        </div>
      </div>
      <TooltipProvider>
        <div className="overflow-x-auto">
          <div className="min-w-[500px]">
            {/* Hour headers */}
            <div className="flex mb-1 ml-10">
              {HOURS.map(h => (
                <div key={h} className="flex-1 text-center text-[10px] text-muted-foreground">
                  {h > 12 ? h - 12 : h}{h >= 12 ? "p" : "a"}
                </div>
              ))}
            </div>
            {/* Grid rows */}
            {DAYS.map((day, di) => (
              <div key={day} className="flex items-center mb-0.5">
                <span className="w-10 text-xs text-muted-foreground shrink-0">{day}</span>
                <div className="flex flex-1 gap-0.5">
                  {HOURS.map((h, hi) => {
                    const val = grid[di][hi];
                    const colorClass = tab === "volume" ? getVolumeColor(val) : getAnswerColor(val);
                    const totalCalls = volumeGrid[di][hi];
                    const answerRate = answerGrid[di][hi];
                    return (
                      <Tooltip key={hi}>
                        <TooltipTrigger asChild>
                          <div className={`flex-1 aspect-square rounded-sm ${colorClass} flex items-center justify-center cursor-default`}>
                            {totalCalls > 0 && <span className="text-[9px] font-medium text-foreground/70">{tab === "volume" ? val : `${val}%`}</span>}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          <p>{day} {h > 12 ? h - 12 : h}:00 {h >= 12 ? "PM" : "AM"}</p>
                          <p>Calls: {totalCalls}</p>
                          <p>Answer rate: {answerRate >= 0 ? `${answerRate}%` : "N/A"}</p>
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
    </div>
  );
};

export default CallingHeatmap;
