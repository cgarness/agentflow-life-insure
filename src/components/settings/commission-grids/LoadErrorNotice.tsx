import React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LoadErrorNoticeProps {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}

/** A compact read error with Retry. Shown beside what is already loaded; it never replaces an open editor. */
const LoadErrorNotice: React.FC<LoadErrorNoticeProps> = ({ message, onRetry, retrying = false }) => (
  <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/[0.06] px-4 py-2.5 text-sm">
    <span className="flex items-center gap-2 text-foreground">
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden /> {message}
    </span>
    <Button size="sm" variant="outline" className="h-8 bg-background" disabled={retrying} onClick={onRetry}>
      {retrying && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />} Retry
    </Button>
  </div>
);

export default LoadErrorNotice;
