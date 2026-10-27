import React, { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { sheetsApi, SheetsApiError } from "@/lib/google-sheets/api";
import type { ConnectionStatus, RealtimeStatus, SheetSourceRow as Row } from "@/lib/google-sheets/schema";
import { monitoringStatus, resultSummary, REVIEW_REASONS, reviewKind, sourceStatus, syncToast, type Tone } from "@/lib/google-sheets/status";

const BADGE_COLOR: Record<Tone, string> = {
  default: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  destructive: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  muted: "border-slate-500/25 bg-slate-500/10 text-slate-600 dark:text-slate-300",
};
const CARD_COLOR: Record<Tone, string> = {
  default: "border-blue-500/25 bg-blue-500/5",
  success: "border-emerald-500/25 bg-emerald-500/5",
  warning: "border-amber-500/25 bg-amber-500/5",
  destructive: "border-red-500/25 bg-red-500/5",
  muted: "border-border",
};
const DOT: Record<Tone, string> = {
  default: "bg-primary", success: "bg-emerald-500", warning: "bg-amber-500", destructive: "bg-destructive", muted: "bg-muted-foreground/60",
};

interface Props {
  source: Row;
  connection: ConnectionStatus["connection"];
  realtime?: RealtimeStatus | null;
  onEdit: (s: Row) => void;
  onReview: (s: Row) => void;
  onIdentityReview: (s: Row) => void;
  onChanged: () => void;
}

const SheetSourceRowItem: React.FC<Props> = ({ source: s, connection, realtime, onEdit, onReview, onIdentityReview, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const st = sourceStatus(s, connection);
  const connected = connection?.status === "connected";
  const live = connected ? monitoringStatus(s, realtime) : null;
  const kind = reviewKind(s.review_reason);
  const openReview = () => (kind === "identity" ? onIdentityReview(s) : kind === "structural" ? onReview(s) : onEdit(s));

  const act = async (action: "sync_now" | "pause" | "resume" | "remove", ok: string) => {
    setBusy(true);
    try {
      const res = await sheetsApi<{ imported?: number; status?: string }>(action, { source_id: s.id });
      if (action === "sync_now") {
        const t = syncToast(res);
        if (t.ok) toast.success(t.text); else toast.message(t.text);
      } else toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(e instanceof SheetsApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  return (
    <div className={`rounded-lg border p-3 flex items-start justify-between gap-3 ${CARD_COLOR[st.tone]}`}>
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground truncate">{s.display_name}</p>
          <Badge variant="outline" className={BADGE_COLOR[st.tone]}>{st.label}</Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate">{s.spreadsheet_name || "Spreadsheet"} → {s.sheet_title || "Tab"}</p>
        {live && (
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${DOT[live.tone]}`} aria-hidden="true" />
            {live.label}
          </p>
        )}
        {s.state !== "draft" && (
          <p className="text-xs text-muted-foreground">
            {s.last_success_at ? `Last successful sync ${formatDistanceToNow(new Date(s.last_success_at), { addSuffix: true })}` : "Not synced yet"}
            {" · "}{resultSummary(s.last_result)}
          </p>
        )}
        {s.health === "needs_review" && s.review_reason && (
          <p className="text-xs text-destructive">{REVIEW_REASONS[s.review_reason] ?? "Needs review."}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {s.state === "draft" && <Button size="sm" variant="outline" onClick={() => onEdit(s)} disabled={busy}>Finish setup</Button>}
        {s.state === "enabled" && s.health === "needs_review" && (
          <Button size="sm" variant="outline" onClick={openReview} disabled={busy}>Review</Button>
        )}
        {s.state === "enabled" && s.health !== "needs_review" && connected && (
          <Button size="sm" variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200" onClick={() => act("sync_now", "Checked")} disabled={busy}>Sync now</Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" aria-label={`More actions for ${s.display_name}`} disabled={busy}>
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {s.state !== "draft" && <DropdownMenuItem onSelect={() => onEdit(s)}>Edit mapping</DropdownMenuItem>}
            {s.state === "enabled" && <DropdownMenuItem onSelect={() => act("pause", "Paused")}>Pause</DropdownMenuItem>}
            {(s.state === "paused" || (s.state === "enabled" && (s.health === "access_lost" || s.health === "error"))) && (
              <DropdownMenuItem onSelect={() => act("resume", "Resumed")}>Resume</DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-destructive" onSelect={() => setConfirmRemove(true)}>Remove</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {s.display_name}?</AlertDialogTitle>
            <AlertDialogDescription>New rows stop importing. Leads already imported stay.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void act("remove", "Removed"); }} disabled={busy}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SheetSourceRowItem;
