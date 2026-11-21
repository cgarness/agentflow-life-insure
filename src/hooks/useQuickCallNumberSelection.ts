import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { QuickCallDetail, QuickCallContactType } from "@/lib/quick-call";
import { normalizePhoneNumber } from "@/utils/phoneUtils";

type Contact = { id: string; type?: QuickCallContactType; phone: string };
type Scope = {
  actorId: string | null;
  organizationId: string | null;
  isImpersonating: boolean;
  contact: Contact | null;
  open: boolean;
};
type Selection = {
  authority: string;
  recipient: string;
  expectedCallerNumber: string;
  oneCallNumberId?: string;
  isSelectionCurrent?: () => boolean;
};
export type QuickCallNumberAttempt = {
  expectedCallerNumber: string;
  oneCallNumberId?: string;
  isAttemptCurrent: () => boolean;
};

const recipientKey = (contact: Contact | null) => contact?.id
  ? JSON.stringify([contact.id, contact.type ?? "lead", normalizePhoneNumber(contact.phone)]) : null;

/** Keeps a contact's FROM out of global voice preferences and captures immutable call intent. */
export function useQuickCallNumberSelection(scope: Scope) {
  const authority = JSON.stringify([scope.actorId, scope.organizationId, scope.isImpersonating]);
  const recipient = recipientKey(scope.contact);
  const allowed = !!scope.actorId && !!scope.organizationId && !scope.isImpersonating;
  const [stored, setStored] = useState<Selection | null>(null);
  const selection = allowed && scope.open && stored?.authority === authority && stored.recipient === recipient ? stored : null;
  const live = useRef({ authority, recipient, allowed, open: scope.open });
  live.current = { authority, recipient, allowed, open: scope.open };
  const current = useRef(selection);
  current.current = selection;

  const clear = useCallback(() => { current.current = null; setStored(null); }, []);
  useLayoutEffect(() => { if (stored && !selection) clear(); }, [stored, selection, clear]);
  useLayoutEffect(() => () => { current.current = null; }, []);

  const capture = useCallback((detail: QuickCallDetail) => {
    const target = recipientKey({ id: detail.contactId, type: detail.type, phone: detail.phone });
    if (!live.current.allowed || !target || !normalizePhoneNumber(detail.expectedCallerNumber ?? "")) {
      clear();
      return false;
    }
    const next: Selection = {
      authority: live.current.authority, recipient: target,
      expectedCallerNumber: detail.expectedCallerNumber!, oneCallNumberId: detail.oneCallNumberId,
      isSelectionCurrent: detail.isSelectionCurrent,
    };
    // Invalidate an older in-flight action immediately, before the event's state update paints.
    current.current = next;
    setStored(next);
    return true;
  }, [clear]);

  const captureAttempt = useCallback((phone: string, contactId?: string | null): QuickCallNumberAttempt | null => {
    const value = current.current;
    if (!value || recipientKey({ id: contactId ?? "", type: scope.contact?.type, phone }) !== value.recipient) return null;
    const isAttemptCurrent = () => {
      const now = live.current;
      if (current.current !== value || !now.allowed || !now.open || now.authority !== value.authority || now.recipient !== value.recipient) return false;
      try { return value.isSelectionCurrent?.() !== false; } catch { return false; }
    };
    return { expectedCallerNumber: value.expectedCallerNumber, oneCallNumberId: value.oneCallNumberId, isAttemptCurrent };
  }, [scope.contact?.type]);

  return { selection, capture, captureAttempt, clear };
}
