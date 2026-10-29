import React from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { DASHBOARD_TONES, type DashboardTone } from "@/components/dashboard/ui/dashboardTones";

interface DashboardModalShellProps {
  open: boolean;
  onClose: () => void;
  tone: DashboardTone;
  icon: React.ElementType;
  title: string;
  description?: React.ReactNode;
  /** Filters, search and loaded-record notes. */
  toolbar?: React.ReactNode;
  /** Keeps the parent's scroll-triggered pagination. */
  onScroll?: React.UIEventHandler<HTMLDivElement>;
  footer: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The one Dashboard detail-modal frame (plan §4.2): a Radix dialog, so focus is
 * trapped and returned, Escape closes, and the title/description label it. Content
 * scrolls inside; header, toolbar and footer stay put. Full width on a phone.
 */
export const DashboardModalShell: React.FC<DashboardModalShellProps> = ({
  open,
  onClose,
  tone,
  icon: Icon,
  title,
  description,
  toolbar,
  onScroll,
  footer,
  children,
}) => (
  <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent
      className="flex max-h-[min(90dvh,780px)] w-[calc(100vw-1.5rem)] max-w-[760px] flex-col gap-0 overflow-hidden rounded-2xl border border-border bg-background p-0 shadow-2xl motion-reduce:!animate-none"
    >
      <DialogHeader className={cn("shrink-0 border-b px-4 py-4 pr-12 text-left sm:px-6 sm:py-5", DASHBOARD_TONES[tone].border, DASHBOARD_TONES[tone].band)}>
        <div className="flex items-center gap-3">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm", DASHBOARD_TONES[tone].chip)}>
            <Icon className="h-5 w-5 text-white" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-lg font-semibold tracking-tight">{title}</DialogTitle>
            {description ? (
              <DialogDescription className="mt-1 text-xs">{description}</DialogDescription>
            ) : (
              <DialogDescription className="sr-only">{title} details</DialogDescription>
            )}
          </div>
        </div>
      </DialogHeader>

      {toolbar && <div className="shrink-0 space-y-3 border-b border-border px-4 py-3 sm:px-6">{toolbar}</div>}

      <div onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto bg-muted/10 px-4 py-4 sm:px-6" aria-live="polite">
        {children}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-3 sm:px-6">
        {footer}
      </div>
    </DialogContent>
  </Dialog>
);

/** Initial load in progress. */
export const DashboardModalLoading: React.FC = () => (
  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
    <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading records...
  </div>
);

/** Initial load failed: never the empty message, always a way to try again. */
export const DashboardModalError: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <div className="flex flex-col items-center gap-3 py-12 text-center">
    <AlertTriangle className="h-6 w-6 text-amber-500" aria-hidden="true" />
    <p className="text-sm text-foreground">Couldn't load these records</p>
    <Button type="button" variant="outline" size="sm" onClick={onRetry}>
      <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Retry
    </Button>
  </div>
);

/** A successful read with nothing (or nothing matching the loaded filters). */
export const DashboardModalEmpty: React.FC<{ message: string; hint?: string }> = ({ message, hint }) => (
  <div className="py-12 text-center text-sm text-muted-foreground">
    {message}
    {hint && <p className="mt-2 text-xs">{hint}</p>}
  </div>
);

/** Footer for a paginated list: what is loaded, and Load more / Retry page / Close. */
export const DashboardModalPagerFooter: React.FC<{
  shown: number;
  loaded: number;
  hasMore: boolean;
  pageError: boolean;
  loadError: boolean;
  loading: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onClose: () => void;
}> = ({ shown, loaded, hasMore, pageError, loadError, loading, loadingMore, onLoadMore, onClose }) => (
  <>
    <span className="text-xs text-muted-foreground">Showing {shown} of {loaded} loaded</span>
    {(hasMore || pageError) && !loadError ? (
      <Button type="button" variant="outline" size="sm" onClick={onLoadMore} disabled={loading || loadingMore} className="rounded-lg">
        {loadingMore && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {pageError ? "Retry page" : "Load more"}
      </Button>
    ) : (
      <Button type="button" variant="outline" size="sm" onClick={onClose} className="rounded-lg">Close</Button>
    )}
  </>
);
