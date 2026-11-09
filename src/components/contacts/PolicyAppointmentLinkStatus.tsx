import { Component, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { useClosingAppointmentCandidates } from "@/hooks/useClosingAppointmentCandidates";
import { LINK_REASON_TEXT, LinkTransportError, fetchPolicyAppointmentLinks, linkPolicyAppointment } from "@/lib/policyAppointmentLinks";

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

/**
 * The policy section's closing-appointment status (D4 §4): for a policy the server returns without an effective link,
 * "Closing appointment: Not recorded · Link" (source policy_entry). Renders nothing otherwise, on error and under View As.
 */
export function PolicyAppointmentLinkStatus(props: { clientId: string; leadId?: string | null }) {
  return <Boundary><Body {...props} /></Boundary>;
}

function Body({ clientId, leadId }: { clientId: string; leadId?: string | null }) {
  const { user, isImpersonating } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const key = ["policy-appointment-links", clientId, user?.id ?? null, organizationId ?? null];
  const links = useQuery({ queryKey: key, enabled: !!user?.id && !!organizationId && !isImpersonating, retry: false,
                           queryFn: ({ signal }) => fetchPolicyAppointmentLinks(clientId, signal) });
  if (!links.isSuccess) return null;
  const open = links.data.policies.filter((p) => p.link === null);
  if (open.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 text-xs" aria-label="Closing appointments">
      {open.map((p) => <OpenPolicy key={p.win_id} winId={p.win_id} soldDate={p.sold_date} label={[p.carrier, p.policy_type].filter(Boolean).join(" · ")}
        contactIds={[clientId, leadId]} onLinked={() => void queryClient.invalidateQueries({ queryKey: ["policy-appointment-links", clientId] })} />)}
    </div>
  );
}

function OpenPolicy({ winId, soldDate, label, contactIds, onLinked }: {
  winId: string; soldDate: string | null; label: string; contactIds: Array<string | null | undefined>; onLinked: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const candidates = useClosingAppointmentCandidates(picking ? contactIds : [], soldDate);
  const link = async (appointmentId: string, occurrenceStart: string) => {
    try {
      const result = await linkPolicyAppointment(requestId, winId, { kind: "appointment", appointmentId, occurrenceStart }, "policy_entry");
      if (result.status === "rejected") toast.error(`The closing appointment wasn't linked: ${LINK_REASON_TEXT[result.reason ?? ""] ?? "it could not be linked"}.`);
      else { toast.success("Closing appointment linked"); onLinked(); }
    } catch (error) {
      toast.error(error instanceof LinkTransportError ? "The link couldn't be confirmed. Try again." : "The link couldn't be saved.");
    }
  };
  return (
    <p className="text-muted-foreground">
      {label ? `${label}: ` : ""}Closing appointment: Not recorded ·{" "}
      <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setPicking(true)}>Link</button>
      {picking && candidates.isSuccess && (candidates.data.length === 0 ? <span> No held sales appointment in the 30 days before the sale.</span>
        : <span className="ml-1 inline-flex flex-wrap gap-1">{candidates.data.map((c) =>
            <button key={c.id} type="button" className="rounded bg-muted px-1.5" onClick={() => void link(c.id, c.startTime)}>
              {c.title} · {new Date(c.startTime).toLocaleDateString()}</button>)}</span>)}
    </p>
  );
}
