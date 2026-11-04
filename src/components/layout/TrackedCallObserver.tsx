import { useActiveInboundCallRow } from "@/hooks/useActiveInboundCallRow";

/**
 * Null-rendering, session-wide host of the inbound call capture (Reports V2 PKG-C, RL-20): a call answered while no
 * sale modal is open is still offered afterwards. Mounted once in AppLayout next to FloatingDialer and, like it,
 * never under "View As".
 */
export default function TrackedCallObserver() {
  useActiveInboundCallRow();
  return null;
}
