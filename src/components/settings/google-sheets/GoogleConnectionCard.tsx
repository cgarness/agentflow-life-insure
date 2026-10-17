import React, { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { sheetsApi, startGoogleConnect, SheetsApiError } from "@/lib/google-sheets/api";
import type { ConnectionStatus } from "@/lib/google-sheets/schema";

interface Props { status: ConnectionStatus; canConnect: boolean; onChanged: () => void }

const GoogleConnectionCard: React.FC<Props> = ({ status, canConnect, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const conn = status.connection;
  const connected = conn?.status === "connected";
  const needsReconnect = conn?.status === "reconnect_required";

  const connect = async () => {
    setBusy(true);
    try { await startGoogleConnect(); }
    catch (e) { toast.error(e instanceof SheetsApiError ? e.message : "Couldn't connect Google. Try again."); setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true);
    try { await sheetsApi("disconnect"); toast.success("Google disconnected"); onChanged(); }
    catch (e) { toast.error(e instanceof SheetsApiError ? e.message : "Couldn't disconnect. Try again."); }
    finally { setBusy(false); setConfirming(false); }
  };

  return (
    <div className="rounded-lg border p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">Google account</p>
          {connected && <Badge variant="secondary">Connected</Badge>}
          {needsReconnect && <Badge variant="destructive">Reconnect</Badge>}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {conn?.google_email && (connected || needsReconnect) ? conn.google_email : "Not connected"}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {canConnect && !connected && (
          <Button size="sm" onClick={connect} disabled={busy}>{needsReconnect ? "Reconnect" : "Connect Google"}</Button>
        )}
        {(connected || needsReconnect) && (
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)} disabled={busy}>Disconnect</Button>
        )}
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Google?</AlertDialogTitle>
            <AlertDialogDescription>
              Sheets stop checking for new rows. Imported leads stay. Gmail and Calendar are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void disconnect(); }} disabled={busy}>Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default GoogleConnectionCard;
