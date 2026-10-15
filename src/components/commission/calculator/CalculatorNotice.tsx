import React from "react";
import { AlertCircle, Calculator, Loader2, Lock, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    return (
      <div role="status" className="flex min-h-[240px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading your agency&apos;s comp grid…
      </div>
    );
  }
  const notice = NOTICES[kind];
  const Icon = notice.icon ?? Calculator;
  return (
    <div className="flex min-h-[240px] items-center justify-center">
      <div className="max-w-md space-y-3 text-center">
        <Icon className="mx-auto h-9 w-9 text-muted-foreground" aria-hidden />
        <h2 className="text-base font-semibold text-foreground">{notice.title}</h2>
        <p className="text-sm text-muted-foreground">{notice.body}</p>
        {kind === "error" && onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
};

export default CalculatorNotice;
