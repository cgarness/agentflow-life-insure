import React from "react";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRunAllHealthChecks } from "@/hooks/useControlCenterHealthChecks";
import type { ControlCenterHealthCheck } from "@/lib/control-center/types";

interface Props {
  checks: ControlCenterHealthCheck[];
}

const RunChecksButton: React.FC<Props> = ({ checks }) => {
  const mut = useRunAllHealthChecks();
  const enabledCount = checks.filter((c) => c.is_enabled).length;
  const disabled = mut.isPending || enabledCount === 0;

  const onClick = async () => {
    try {
      const result = await mut.mutateAsync(checks);
      toast.success(`Recorded ${result.ran} run(s) (stub — no live probes in v1)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Run failed";
      toast.error(msg);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              type="button"
              onClick={onClick}
              disabled={disabled}
              variant="secondary"
              className="bg-slate-800 hover:bg-slate-700 text-slate-100"
            >
              {mut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Run checks (stub)
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          v1 stub — records a run row and sets last_run_at. No live probes
          against Twilio / Supabase / Vercel yet.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default RunChecksButton;
