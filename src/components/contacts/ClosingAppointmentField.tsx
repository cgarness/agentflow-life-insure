import { Component, useId, type ReactNode } from "react";
import { useClosingAppointmentCandidates } from "@/hooks/useClosingAppointmentCandidates";
import { useClosingAppointmentLink } from "@/hooks/useClosingAppointmentLink";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Optional "Closing appointment" on a sale entry (D4 §4, D-A1). Shown only when held Sales Appointment candidates loaded
 * and exist; hidden while loading and on a load failure. Never preselected, never required, never blocks a sale.
 */
type FieldProps = { saleRequestId: string; contactIds: Array<string | null | undefined>; soldDate: string | null | undefined; disabled?: boolean };

/** A closing-appointment problem (or a host without a query client) never affects the sale form: it renders nothing. */
class FieldBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

export function ClosingAppointmentField(props: FieldProps) {
  return <FieldBoundary><FieldBody {...props} /></FieldBoundary>;
}

function FieldBody({ saleRequestId, contactIds, soldDate, disabled }: FieldProps) {
  const id = useId();
  const candidates = useClosingAppointmentCandidates(contactIds, soldDate);
  const { choice, select } = useClosingAppointmentLink(saleRequestId);
  if (!candidates.isSuccess || candidates.data.length === 0) return null;
  const value = choice.kind === "appointment" ? choice.appointmentId : choice.kind;
  return (
    <label htmlFor={id} className="block text-sm">Closing appointment (optional)
      <select id={id} className="mt-1 w-full rounded border bg-background p-2" value={value} disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          const c = candidates.data.find((x) => x.id === v);
          select(v === "none" ? { kind: "none" } : c ? { kind: "appointment", appointmentId: c.id, occurrenceStart: c.startTime } : { kind: "not_recorded" });
        }}>
        <option value="not_recorded">Not recorded</option>
        <option value="none">No closing appointment</option>
        {candidates.data.map((c) => <option key={c.id} value={c.id}>{c.title} · {when(c.startTime)}</option>)}
      </select>
    </label>
  );
}
