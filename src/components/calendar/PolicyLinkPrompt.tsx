import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { LINK_REASON_TEXT, LinkTransportError, fetchPolicyAppointmentLinks, linkPolicyAppointment } from "@/lib/policyAppointmentLinks";

/**
 * After a held sales appointment (D4 §4): link a sale of the same client to it (source outcome_entry). Lists only
 * policies the server returns without an effective link. Mounted from the outcome flow (protected AppointmentModal).
 */
export function PolicyLinkPrompt({ clientId, appointmentId, occurrenceStart }: { clientId: string; appointmentId: string; occurrenceStart: string }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [done, setDone] = useState<Set<string>>(new Set());
  const links = useQuery({ queryKey: ["policy-appointment-links", clientId, "prompt"], retry: false,
                           queryFn: ({ signal }) => fetchPolicyAppointmentLinks(clientId, signal) });
  if (!links.isSuccess) return null;
  const open = links.data.policies.filter((p) => p.link === null && !done.has(p.win_id));
  if (open.length === 0) return null;
  const link = async (winId: string) => {
    try {
      const result = await linkPolicyAppointment(requestId, winId, { kind: "appointment", appointmentId, occurrenceStart }, "outcome_entry");
      if (result.status === "rejected") toast.error(`Not linked: ${LINK_REASON_TEXT[result.reason ?? ""] ?? "it could not be linked"}.`);
      else { setDone((d) => new Set(d).add(winId)); toast.success("Sale linked to this appointment"); }
    } catch (error) {
      toast.error(error instanceof LinkTransportError ? "The link couldn't be confirmed. Try again." : "The link couldn't be saved.");
    }
  };
  return (
    <div className="space-y-1 text-xs" aria-label="Link a sale to this appointment">
      <p className="text-muted-foreground">Was a policy sold at this appointment?</p>
      {open.map((p) => <button key={p.win_id} type="button" className="mr-1 rounded bg-muted px-1.5 py-0.5" onClick={() => void link(p.win_id)}>
        {[p.carrier, p.policy_type, p.sold_date].filter(Boolean).join(" · ")}</button>)}
    </div>
  );
}
