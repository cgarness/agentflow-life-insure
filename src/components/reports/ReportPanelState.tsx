/**
 * ReportPanelState — the truthful wrapper every Reports panel renders through.
 *
 * loading → skeleton; error → "Couldn't load … This is not a zero." + Retry (no digits at all);
 * denied → permission message; ready → children. A panel's own "no data" message is rendered by the
 * child ONLY for a successful empty result, so an error can never read as an empty period.
 */
import React from "react";
import { AlertTriangle, Lock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { LoadState } from "@/hooks/useReportsData";

export const PANEL_SHELL =
  "bg-card rounded-xl border border-border/60 overflow-hidden shadow-sm";

interface NoticeProps {
  title: string;
  tone: "error" | "denied" | "unavailable";
  message: string;
  detail?: string;
  onRetry?: () => void;
}

export const ReportNotice: React.FC<NoticeProps> = ({ title, tone, message, detail, onRetry }) => {
  const Icon = tone === "denied" ? Lock : AlertTriangle;
  return (
    <div className={PANEL_SHELL} role={tone === "error" ? "alert" : "status"} data-report-state={tone}>
      <div className="px-6 py-4 border-b border-border/40">
        <h3 className="font-semibold text-foreground text-base tracking-tight">{title}</h3>
      </div>
      <div className="px-6 py-8 flex flex-col items-center text-center gap-3">
        <Icon aria-hidden="true" className={tone === "denied" ? "w-6 h-6 text-muted-foreground" : "w-6 h-6 text-warning"} />
        <p className="text-sm font-semibold text-foreground">{message}</p>
        {detail && <p className="text-xs text-muted-foreground max-w-md">{detail}</p>}
        {onRetry && (
          <Button variant="outline" size="sm" className="rounded-lg mt-1" onClick={onRetry}>
            <RotateCcw className="w-3.5 h-3.5 mr-2" />
            Try again
          </Button>
        )}
      </div>
    </div>
  );
};

export const ReportPanelSkeleton: React.FC<{ title: string }> = ({ title }) => (
  <div className={PANEL_SHELL} aria-busy="true" data-report-state="loading">
    <div className="px-6 py-4 border-b border-border/40">
      <h3 className="font-semibold text-foreground text-base tracking-tight">{title}</h3>
    </div>
    <div className="px-6 py-6 space-y-3">
      <Skeleton className="h-4 w-1/3 rounded" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  </div>
);

interface Props<T> {
  title: string;
  state: LoadState<T>;
  onRetry: () => void;
  children: (data: T) => React.ReactNode;
}

function ReportPanelState<T>({ title, state, onRetry, children }: Props<T>): React.ReactElement {
  if (state.status === "loading") return <ReportPanelSkeleton title={title} />;
  if (state.status === "error") {
    if (state.error.kind === "denied") {
      return <ReportNotice title={title} tone="denied" message={state.error.message} detail="Your role's report permissions don't include this view." />;
    }
    if (state.error.kind === "configuration") {
      return (
        <ReportNotice title={title} tone="unavailable" message={state.error.message}
          detail="An admin must choose and save it in Settings → Company Branding. Nothing is calculated in a guessed time zone." onRetry={onRetry} />
      );
    }
    return (
      <ReportNotice
        title={title}
        tone="error"
        message={`Couldn't load ${title.toLowerCase()}.`}
        detail={`${state.error.message} This is not a zero — the numbers are unknown until it loads.`}
        onRetry={onRetry}
      />
    );
  }
  return <>{children(state.data)}</>;
}

export default ReportPanelState;
