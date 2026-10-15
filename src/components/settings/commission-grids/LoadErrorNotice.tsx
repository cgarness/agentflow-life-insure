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
  <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
    <span className="flex items-center gap-2 text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {message}
    </span>
    <Button size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
      {retrying && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />} Retry
    </Button>
  </div>
);

export default LoadErrorNotice;
