import { Component, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePolicySalePremiums } from "@/hooks/usePolicySalePremiums";
import { retrySaleCallLink } from "@/lib/saleCallLinkRetry";

const statusSchema = z.array(z.object({ win_id: z.string().uuid(), status: z.enum(["linked", "open_failure", "not_linked"]) }));

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

/**
 * "Call link not saved · Retry" for this client's sales whose producing-call link has an open failure (Reports V2
 * PKG-C, RL-21). Read on mount, and so after any reload, through get_policy_sale_call_link_status, which returns only
 * the sales the signed-in user may act on (the original seller or an Admin). Status only; nothing else is shown.
 */
export function PolicySaleCallLinkStatus({ clientId }: { clientId: string }) {
  return <Boundary><Body clientId={clientId} /></Boundary>;
}

function Body({ clientId }: { clientId: string }) {
  const { user } = useAuth();
  const premiums = usePolicySalePremiums(clientId);
  const winIds = (premiums.data?.policies ?? []).map((policy) => policy.win_id).sort();
  const queryClient = useQueryClient();
  const key = ["policy-sale-call-link-status", clientId, user?.id ?? null, winIds.join(",")];
  const status = useQuery({
    queryKey: key,
    enabled: premiums.enabled && winIds.length > 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_policy_sale_call_link_status", { p_win_ids: winIds });
      if (error) throw error;
      return statusSchema.parse(data ?? []);
    },
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const open = (status.data ?? []).filter((row) => row.status === "open_failure");
  if (open.length === 0) return null;
  const retry = async (winId: string) => {
    setBusy(winId); setFailed(null);
    const result = await retrySaleCallLink(winId);
    setBusy(null);
    if (result === "linked" || result === "already_linked" || result === "rejected" || result === "no_open_failure") {
      await queryClient.invalidateQueries({ queryKey: ["policy-sale-call-link-status", clientId] });
    } else {
      setFailed(winId);
    }
  };
  return (
    <div className="mt-2 space-y-1 text-xs" data-testid="sale-call-link-status">
      {open.map((row) => (
        <p key={row.win_id} className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
          <span>Call link not saved</span>
          <span aria-hidden>·</span>
          <button type="button" disabled={busy === row.win_id} onClick={() => void retry(row.win_id)}
            className="rounded text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
            {busy === row.win_id ? "Retrying…" : "Retry"}
          </button>
          {failed === row.win_id && <span role="status">Still not saved.</span>}
        </p>
      ))}
    </div>
  );
}
