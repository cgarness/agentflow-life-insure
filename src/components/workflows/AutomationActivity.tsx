import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Props = { workflowId?: string; contactId?: string; contactType?: string };
type Run = {
  run_id: string;
  workflow_name: string;
  version_id: string;
  contact_name: string | null;
  contact_id: string;
  contact_type: string;
  node_id: string | null;
  status: string;
  node_type: string;
  node_label: string | null;
  due_at: string | null;
  version_revision: number;
  message_status: string | null;
  step_reason: string | null;
  reason: string | null;
  updated_at: string;
  can_stop: boolean;
};

export function AutomationActivity({ workflowId, contactId, contactType }: Props) {
  const { profile, impersonatedUser, automationSessionRevision } = useAuth();
  const key = JSON.stringify([
    profile?.organization_id,
    profile?.id,
    impersonatedUser?.id,
    automationSessionRevision,
    workflowId,
    contactId,
    contactType,
  ]);
  const [result, setResult] = useState<{ key: string; runs?: Run[]; hasMore?: boolean; error?: string }>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const load = useCallback(async (cursor?: Run) => {
    const serial = ++request.current;
    if (automationSessionRevision == null || !profile?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("automation_activity", {
        p_session_revision: automationSessionRevision,
        p_viewer_id: profile.id,
        p_workflow: workflowId ?? null,
        p_contact: contactId ?? null,
        p_type: contactType ?? null,
        p_before_at: cursor?.updated_at ?? null,
        p_before_run: cursor?.run_id ?? null,
      });
      if (error) throw error;
      if (serial !== request.current) return;
      const page = (data ?? []) as unknown as Run[];
      setResult(previous => ({
        key,
        runs: cursor && previous?.key === key ? [...(previous.runs ?? []), ...page] : page,
        hasMore: page.length === 100,
      }));
    } catch {
      if (serial === request.current) {
        setResult({ key, error: "Automation activity could not be loaded." });
      }
    } finally {
      if (serial === request.current) setLoading(false);
    }
  }, [key, profile?.id, automationSessionRevision, workflowId, contactId, contactType]);

  useEffect(() => {
    void load();
    return () => {
      ++request.current;
    };
  }, [load]);
  async function stop(run: Run) {
    if (impersonatedUser || !run.can_stop || busy || automationSessionRevision == null) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("automation_stop_run", {
        p_run: run.run_id,
        p_session_revision: automationSessionRevision,
      });
      if (error) throw error;
      await load();
    } catch {
      setResult({ key, error: "Could not stop this run. Refresh to see its current status." });
    } finally {
      setBusy(false);
    }
  }

  const visible = result?.key === key ? result : undefined;
  const rows = visible?.runs ?? [];
  const oldest = rows[rows.length - 1];
  return (
    <section aria-label="Automation activity" className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Automation activity</h3>
        <Button type="button" size="sm" variant="ghost" onClick={() => void load()}>Refresh</Button>
      </div>
      {!visible && <p role="status">Loading activity…</p>}
      {visible?.error && <p role="alert">{visible.error}</p>}
      {visible?.runs?.length === 0 && (
        <p className="text-sm text-muted-foreground">No automation activity.</p>
      )}
      <ul className="space-y-3">
        {rows.map((run) => (
          <li key={run.run_id} className="rounded-md border p-3">
            <strong>{run.workflow_name}</strong>
            <p className="text-sm">{run.contact_name ?? run.contact_id} · {run.status}</p>
            <p className="break-all text-xs text-muted-foreground">
              Version {run.version_revision} ·{" "}
              {run.node_label || run.node_type?.replace(/_/g, " ") || run.node_id}
            </p>
            <p className="text-xs">{new Date(run.updated_at).toLocaleString()}</p>
            {run.status === "waiting" && run.due_at && (
              <p className="text-sm">Due {new Date(run.due_at).toLocaleString()}</p>
            )}
            {run.message_status && (
              <p className="text-sm">Message {run.message_status.replace(/_/g, " ")}</p>
            )}
            {(run.reason || run.step_reason) && (
              <p className="text-sm">{run.reason || run.step_reason}</p>
            )}
            {run.can_stop && !impersonatedUser && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => stop(run)}
              >
                Stop this run
              </Button>
            )}
          </li>
        ))}
      </ul>
      {visible?.hasMore && oldest && (
        <Button type="button" variant="outline" disabled={loading}
          onClick={() => void load(oldest)}>
          Load older activity
        </Button>
      )}
    </section>
  );
}
