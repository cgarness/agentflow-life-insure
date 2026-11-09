import { useCallback, useEffect, useRef, useState } from "react";
import { clearClosingAppointmentSelection, registerClosingAppointmentSelection } from "@/lib/appointmentLinkRetry";
import { NOT_RECORDED, closingAppointmentChoiceSchema, type ClosingAppointmentChoice } from "@/lib/policyAppointmentLinks";

/**
 * The closing-appointment choice of one sale entry (D-A1): default "Not recorded", never preselected, one link request
 * id per selection, registered under the modal's per-open sale request id. Cleared when the field unmounts unregistered
 * work would otherwise leak; a sale already saved keeps its in-flight delivery (that lives in appointmentLinkRetry).
 */
export function useClosingAppointmentLink(saleRequestId: string) {
  const [choice, setChoice] = useState<ClosingAppointmentChoice>(NOT_RECORDED);
  const linkRequestId = useRef<string>(crypto.randomUUID());
  useEffect(() => {
    setChoice(NOT_RECORDED);
    return () => clearClosingAppointmentSelection(saleRequestId);
  }, [saleRequestId]);
  const select = useCallback((next: ClosingAppointmentChoice) => {
    const parsed = closingAppointmentChoiceSchema.parse(next);
    linkRequestId.current = crypto.randomUUID();
    setChoice(parsed);
    registerClosingAppointmentSelection(saleRequestId, parsed, linkRequestId.current);
  }, [saleRequestId]);
  return { choice, select };
}
