import React, { useCallback, useEffect, useState } from "react";
import { Mail, RefreshCcw, Unplug, ShieldCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { emailSupabaseApi, type UserEmailConnection } from "@/lib/supabase-email";
import { useSearchParams } from "react-router-dom";

function statusLabel(status: UserEmailConnection["status"]): string {
  if (status === "connected") return "Connected";
  if (status === "needs_reconnect") return "Needs reconnect";
  if (status === "sync_paused") return "Sync paused";
  return "Disconnected";
}

const EmailSetup: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [connections, setConnections] = useState<UserEmailConnection[]>([]);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await emailSupabaseApi.getMyConnections();
      setConnections(rows);
    } catch (err) {
      console.error(err);
      toast({ title: "Failed to load email connections", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    const connected = searchParams.get("email_connected");
    const provider = searchParams.get("email_provider");
    const error = searchParams.get("email_error");
    if (!connected && !error) return;
    if (connected === "1") {
      toast({
        title: "Inbox connected",
        description: provider ? `${provider} inbox is now connected.` : "Inbox connected successfully.",
      });
      void loadConnections();
    } else if (error) {
      toast({ title: "Email connect failed", description: error, variant: "destructive" });
    }
    const next = new URLSearchParams(searchParams);
    next.delete("email_connected");
    next.delete("email_provider");
    next.delete("email_error");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, loadConnections]);

  const onConnect = async (provider: "google" | "microsoft") => {
    try {
      const authUrl = await emailSupabaseApi.startConnect(provider);
      window.location.href = authUrl;
    } catch (err: any) {
      toast({ title: "Unable to start connect", description: err?.message ?? "Try again.", variant: "destructive" });
    }
  };

  const onDisconnect = async (connectionId: string) => {
    setBusyId(connectionId);
    try {
      await emailSupabaseApi.disconnect(connectionId);
      toast({ title: "Inbox disconnected" });
      await loadConnections();
    } catch (err: any) {
      toast({ title: "Disconnect failed", description: err?.message ?? "Try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Email Setup</h3>
          <p className="text-sm text-muted-foreground">
            Connect your own inbox so contact email send/receive can appear in conversation history.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void loadConnections()}>
          <RefreshCcw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Connect Inbox
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void onConnect("google")} className="gap-2">
              <Mail className="w-4 h-4" />
              Connect Google
            </Button>
            <Button variant="secondary" onClick={() => void onConnect("microsoft")} className="gap-2">
              <Mail className="w-4 h-4" />
              Connect Microsoft 365
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            MVP sync scope is new emails after connection. No backfill is included in this first release.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Connected Inboxes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Loading inbox connections...</p>}
          {!loading && connections.length === 0 && (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No inbox connected yet.
            </div>
          )}

          {!loading &&
            connections.map((connection) => (
              <div key={connection.id} className="rounded-lg border p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium capitalize">{connection.provider}</p>
                    <Badge variant={connection.status === "connected" ? "default" : "secondary"}>
                      {statusLabel(connection.status)}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{connection.provider_account_email}</p>
                  <p className="text-xs text-muted-foreground">
                    Last sync: {connection.last_sync_at ? new Date(connection.last_sync_at).toLocaleString() : "Never"}
                  </p>
                  {connection.last_error ? (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {connection.last_error}
                    </p>
                  ) : null}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={busyId === connection.id}
                  onClick={() => void onDisconnect(connection.id)}
                >
                  <Unplug className="w-4 h-4" />
                  Disconnect
                </Button>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default EmailSetup;

