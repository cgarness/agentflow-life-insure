import React from "react";
import { AlertCircle, Lock, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatePanel } from "@/components/commission/ui/CommissionSurface";

export type CalculatorNoticeKind = "loading" | "no_permission" | "no_access" | "not_configured" | "error";

const NOTICES: Record<Exclude<CalculatorNoticeKind, "loading">, { icon: typeof Lock; title: string; body: string }> = {
  no_permission: {
    icon: Lock,
    title: "Commission Calculator isn't available for your role",
    body: "Your agency's permissions don't include viewing your own commission percentage. Ask your admin if you need access.",
  },
  no_access: {
    icon: Lock,
    title: "Commission Calculator isn't available",
    body: "Your account isn't active in this agency right now. Ask your admin for help.",
  },
  not_configured: {
    icon: Settings2,
    title: "Your agency hasn't set up the Commission Calculator yet",
    body: "An agency admin chooses the comp grid it uses. Ask your admin to set it up.",
  },
  error: {
    icon: AlertCircle,
    title: "The calculator couldn't load",
    body: "Something went wrong while loading your agency's comp grid. Try again in a moment.",
  },
};

interface CalculatorNoticeProps {
  kind: CalculatorNoticeKind;
  onRetry?: () => void;
}

/** Distinct, compact page states: loading, no permission, no access, not configured, load error. */
const CalculatorNotice: React.FC<CalculatorNoticeProps> = ({ kind, onRetry }) => {
  if (kind === "loading") {
    // A skeleton of the workspace, so the page does not jump when the grid arrives.
    return (
      <div role="status" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <span className="sr-only">Loading your agency&apos;s comp grid…</span>
        <div className="space-y-5 rounded-xl border border-border/60 bg-card p-5 shadow-sm">
          <Skeleton className="h-8 w-48 rounded-lg" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className={i === 2 ? "h-10 sm:col-span-2" : "h-10"} />)}
          </div>
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  const notice = NOTICES[kind];
  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm">
      <StatePanel
        icon={notice.icon}
        tone={kind === "error" ? "destructive" : "muted"}
        title={<span className="text-base">{notice.title}</span>}
        body={notice.body}
        action={
          kind === "error" && onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : undefined
        }
      />
    </div>
  );
};

export default CalculatorNotice;
