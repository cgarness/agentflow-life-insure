import React, { useCallback, useEffect, useState } from "react";
import { RefreshCcw, Unplug, ShieldCheck, AlertTriangle } from "lucide-react";
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

function providerLabel(provider: UserEmailConnection["provider"]): string {
  if (provider === "google") return "Gmail";
  if (provider === "microsoft") return "Outlook";
  return provider;
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
            <Button
              variant="outline"
              onClick={() => void onConnect("google")}
              className="h-10 gap-2 border-[#DADCE0] bg-white px-4 text-[#3C4043] hover:bg-[#F8F9FA] hover:text-[#202124]"
            >
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.4 3.63v3.02h3.88c2.27-2.09 3.56-5.16 3.56-8.68z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.93l-3.88-3.02c-1.08.72-2.46 1.14-4.05 1.14-3.11 0-5.75-2.1-6.7-4.92H1.3v3.1A12 12 0 0 0 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.3 14.27A7.21 7.21 0 0 1 4.93 12c0-.79.14-1.56.37-2.27V6.63H1.3A12 12 0 0 0 0 12c0 1.93.46 3.75 1.3 5.37l4-3.1z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.77c1.76 0 3.33.6 4.57 1.78l3.42-3.42C17.95 1.3 15.24 0 12 0A12 12 0 0 0 1.3 6.63l4 3.1c.94-2.83 3.59-4.96 6.7-4.96z"
                />
              </svg>
              Connect Gmail
            </Button>
            <Button
              onClick={() => void onConnect("microsoft")}
              className="h-10 gap-2 bg-[#0078D4] px-4 text-white hover:bg-[#106EBE]"
            >
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24">
                <path fill="#fff" d="M2 3h9v9H2zM13 3h9v9h-9zM2 14h9v9H2zM13 14h9v9h-9z" />
              </svg>
              Connect Outlook
            </Button>
          </div>
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
                    <p className="text-sm font-medium">{providerLabel(connection.provider)}</p>
                    <Badge
                      variant="secondary"
                      className={
                        connection.status === "connected"
                          ? "border border-emerald-200 bg-emerald-100 text-emerald-800"
                          : undefined
                      }
                    >
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
                  className="gap-2 hover:border-destructive hover:bg-destructive hover:text-destructive-foreground"
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

