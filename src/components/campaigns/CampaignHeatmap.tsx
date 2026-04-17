import React from "react";
import { useQuery } from "@tanstack/react-query";
import { getDay, getHours, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CampaignHeatmapProps {
  title: string;
  campaignId: string;
  filter: "all" | "answered";
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 8am..9pm

const formatHour = (h: number) => {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  if (h < 12) return `${h}a`;
  return `${h - 12}p`;
};

const bucket = (count: number): 0 | 1 | 2 | 3 | 4 => {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
};

const PRIMARY_SCALE: Record<number, string> = {
  0: "bg-muted/40",
  1: "bg-primary/20",
  2: "bg-primary/40",
  3: "bg-primary/70",
  4: "bg-primary",
};

const EMERALD_SCALE: Record<number, string> = {
  0: "bg-muted/40",
  1: "bg-emerald-500/20",
  2: "bg-emerald-500/40",
  3: "bg-emerald-500/70",
  4: "bg-emerald-500",
};

type HeatmapGrid = Record<number, Record<number, number>>;

export const CampaignHeatmap: React.FC<CampaignHeatmapProps> = ({
  title,
  campaignId,
  filter,
}) => {
  const scale = filter === "answered" ? EMERALD_SCALE : PRIMARY_SCALE;

  const { data, isLoading } = useQuery<HeatmapGrid>({
    queryKey: ["campaignHeatmap", campaignId, filter],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      let query = supabase
        .from("calls")
        .select("started_at, duration")
        .eq("campaign_id", campaignId)
        .not("started_at", "is", null);

      if (filter === "answered") {
        query = query.gt("duration", 45);
      }

      const { data: rows, error } = await query;
      if (error) throw error;

      const grid: HeatmapGrid = {};
      for (let d = 0; d < 7; d++) grid[d] = {};

      (rows || []).forEach((r) => {
        if (!r.started_at) return;
        const dt = parseISO(r.started_at);
        const jsDay = getDay(dt); // 0=Sun..6=Sat
        const monFirst = (jsDay + 6) % 7; // 0=Mon..6=Sun
        const h = getHours(dt);
        if (h < 8 || h > 21) return;
        grid[monFirst][h] = (grid[monFirst][h] || 0) + 1;
      });

      return grid;
    },
  });

  const totalCalls = data
    ? Object.values(data).reduce(
        (s, hours) => s + Object.values(hours).reduce((a, b) => a + b, 0),
        0,
      )
    : 0;

  const isEmpty = !isLoading && totalCalls === 0;

  return (
    <div className="bg-card rounded-xl border p-5">
      <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>

      <TooltipProvider delayDuration={100}>
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: "auto repeat(7, minmax(0, 1fr))" }}
        >
          <div />
          {DAYS.map((d) => (
            <div
              key={d}
              className="text-[10px] text-muted-foreground font-medium text-center"
            >
              {d}
            </div>
          ))}

          {HOURS.map((h) => (
            <React.Fragment key={h}>
              <div className="text-[10px] text-muted-foreground text-right pr-1 leading-5">
                {formatHour(h)}
              </div>
              {DAYS.map((day, dayIdx) => {
                const count = isLoading ? 0 : data?.[dayIdx]?.[h] || 0;
                const cls = isLoading ? "bg-muted/20" : scale[bucket(count)];
                return (
                  <Tooltip key={`${h}-${dayIdx}`}>
                    <TooltipTrigger asChild>
                      <div
                        className={`w-4 h-4 sm:w-5 sm:h-5 rounded-sm ${cls} transition-colors`}
                      />
                    </TooltipTrigger>
                    {!isLoading && (
                      <TooltipContent>
                        <p className="text-xs">
                          {day} {formatHour(h)} — {count} call
                          {count === 1 ? "" : "s"}
                        </p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </TooltipProvider>

      {isEmpty && (
        <p className="text-xs text-muted-foreground text-center mt-3">
          No call data yet
        </p>
      )}

      <div className="flex items-center justify-end gap-1 mt-3">
        <span className="text-[10px] text-muted-foreground">Less</span>
        {[0, 1, 2, 3, 4].map((b) => (
          <div key={b} className={`w-3 h-3 rounded-sm ${scale[b]}`} />
        ))}
        <span className="text-[10px] text-muted-foreground">More</span>
      </div>
    </div>
  );
};

export default CampaignHeatmap;
