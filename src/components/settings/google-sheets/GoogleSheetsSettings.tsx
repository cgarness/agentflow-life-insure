import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useGoogleSheets } from "@/hooks/useGoogleSheets";
import { OAUTH_RETURN_MESSAGES } from "@/lib/google-sheets/api";
import { mappingV2FlagOn } from "@/lib/google-sheets/mappingGate";
import type { SheetSourceRow } from "@/lib/google-sheets/schema";
import GoogleConnectionCard from "./GoogleConnectionCard";
import SheetSourceList from "./SheetSourceList";
import AddSheetDialog from "./AddSheetDialog";
import AddSheetDialogV2, { UnavailableNotice } from "./AddSheetDialogV2";
import SheetReviewDialog, { type ReviewOverride } from "./SheetReviewDialog";
import SheetIdentityReviewDialog from "./SheetIdentityReviewDialog";

const flagOn = () => import.meta.env.VITE_GOOGLE_SHEETS_ENABLED === "true";

const Notice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-sm text-muted-foreground">{children}</p>
);

/** Settings → Google Sheets. New rows in a connected tab become leads for the signed-in agent. */
const GoogleSheetsSettings: React.FC = () => {
  const { isImpersonating, realProfile } = useAuth();
  const gs = useGoogleSheets();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<SheetSourceRow | "new" | null>(null);
  const [review, setReview] = useState<{ source: SheetSourceRow; override?: ReviewOverride } | null>(null);
  const [identityReview, setIdentityReview] = useState<SheetSourceRow | null>(null);
  const { refresh } = gs;

  // OAuth return: show the outcome, strip the flag, then re-read saved status from the server.
  useEffect(() => {
    const result = params.get("sheets");
    if (!result) return;
    const m = OAUTH_RETURN_MESSAGES[result] ?? OAUTH_RETURN_MESSAGES.error;
    (m.ok ? toast.success : toast.error)(m.text);
    const next = new URLSearchParams(params);
    next.delete("sheets");
    setParams(next, { replace: true });
    refresh();
  }, [params, setParams, refresh]);

  // A new identity never sees the previous identity's dialogs.
  useEffect(() => { setEditing(null); setReview(null); setIdentityReview(null); }, [gs.identityKey]);

  if (isImpersonating) return <Notice>Google Sheets isn't available during View As.</Notice>;
  if (!flagOn()) return <Notice>Google Sheets is not available yet.</Notice>;
  if (!gs.ready || gs.status.isLoading) return <Skeleton className="h-24 w-full" />;
  if (gs.status.isError || !gs.status.data) {
    return (
      <div className="flex items-center gap-2 text-xs text-destructive">
        <AlertTriangle className="w-4 h-4" /> Couldn't load Google Sheets.
        <Button size="sm" variant="outline" onClick={() => refresh()}>Retry</Button>
      </div>
    );
  }
  const status = gs.status.data;
  if (!status.enabled) return <Notice>Google Sheets is not available yet.</Notice>;
  const connected = status.connection?.status === "connected";

  return (
    <div className="space-y-4">
      {!status.eligible && <Notice>Your role can't import from Google Sheets.</Notice>}
      <GoogleConnectionCard status={status} canConnect={status.eligible} onChanged={refresh} />
      {status.eligible && (connected || (gs.sources.data?.length ?? 0) > 0) && (
        <SheetSourceList
          sources={gs.sources.data ?? []}
          loading={gs.sources.isLoading}
          loadError={gs.sources.isError}
          connection={status.connection}
          realtime={status.realtime}
          canAdd={connected}
          onAdd={() => setEditing("new")}
          onEdit={(s) => setEditing(s)}
          onReview={(s) => setReview({ source: s })}
          onIdentityReview={(s) => setIdentityReview(s)}
          onChanged={refresh}
        />
      )}
      {editing && gs.identityKey && (mappingV2FlagOn() ? (
        // Mapping v2 build: the dialog itself falls back to the legacy editor unless the server supports v2.
        <AddSheetDialogV2
          key={`${gs.identityKey}:v2:${editing === "new" ? "new" : editing.id}`}
          source={editing === "new" ? null : editing}
          context={gs.context}
          viewer={{ id: realProfile?.id ?? null, canManageAgency: realProfile?.role === "Admin" || realProfile?.is_super_admin === true,
                    isImpersonating, organizationId: realProfile?.organization_id ?? null }}
          onClose={() => setEditing(null)}
          onSaved={refresh}
          onNeedsReview={(source, override) => { setEditing(null); setReview({ source, override }); }}
        />
      ) : editing !== "new" && editing.mapping?.v === 2 ? (
        <UnavailableNotice key={`${gs.identityKey}:v2-off:${editing.id}`} onClose={() => setEditing(null)} />
      ) : (
        <AddSheetDialog
          key={`${gs.identityKey}:${editing === "new" ? "new" : editing.id}`}
          source={editing === "new" ? null : editing}
          context={gs.context.data ?? null}
          onClose={() => setEditing(null)}
          onSaved={refresh}
          onNeedsReview={(source, override) => { setEditing(null); setReview({ source, override }); }}
        />
      ))}
      {review && gs.identityKey && (
        <SheetReviewDialog
          key={`${gs.identityKey}:review:${review.source.id}`}
          source={review.source}
          override={review.override}
          onClose={() => setReview(null)}
          onDone={refresh}
        />
      )}
      {identityReview && gs.identityKey && (
        <SheetIdentityReviewDialog
          key={`${gs.identityKey}:identity:${identityReview.id}`}
          source={identityReview}
          onClose={() => setIdentityReview(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
};

export default GoogleSheetsSettings;
