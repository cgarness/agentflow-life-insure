import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { toE164Plus } from "@/utils/phoneUtils";
import { changeContactNumber, contactNumberOptions, type ContactNumberAffinity, type ContactNumberOption } from "@/lib/number-affinity";
import { contactFromReadiness, contactNumberRevision, initialContactFrom, stickyFromEnabled } from "@/lib/contact-from-number";
import type { useContactNumberAffinity } from "./useContactNumberAffinity";

type Model = ReturnType<typeof useContactNumberAffinity>;
type Props = { model: Model; phone?: string; canAssign: boolean; legacyNumber: string };
type Choice = { visit: string; generation: number; sender: ContactNumberOption };
type Pending = Choice & { revision: string };
const confirmationSchema = z.object({ number: z.string().uuid(), assign: z.boolean() });

export function useContactFromNumber({ model, phone, canAssign, legacyNumber }: Props) {
  const { user, profile, isImpersonating } = useAuth();
  const scope = JSON.stringify([profile?.organization_id, user?.id, profile?.id,
    model.contactId, model.type, toE164Plus(phone ?? ""), !!isImpersonating]);
  const visitRef = useRef({ scope, sequence: 0 });
  if (visitRef.current.scope !== scope) visitRef.current = { scope, sequence: visitRef.current.sequence + 1 };
  const visit = `${scope}:${visitRef.current.sequence}`;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [loaded, setLoaded] = useState<{ visit: string; rows: ContactNumberOption[]; error?: string } | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [requested, setRequested] = useState<Pending | null>(null);
  const [saved, setSaved] = useState<{ visit: string; data: ContactNumberAffinity } | null>(null);
  const [failure, setFailure] = useState<{ visit: string; message: string } | null>(null);
  const [busyVisit, setBusyVisit] = useState<string | null>(null);
  const submitting = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);
  const preview = saved?.visit === visit && saved.data.generation > (model.data?.generation ?? -1) ? saved.data : model.data;
  const enabled = stickyFromEnabled(preview);
  const readOnly = !!isImpersonating || model.readOnly;
  const options = loaded?.visit === visit ? loaded.rows : [];
  const latestSender = (candidate: ContactNumberOption) => {
    const fresh = options.find(row => row.id === candidate.id);
    return { ...candidate, readiness: fresh?.readiness ?? "unavailable",
      voice_readiness: fresh?.voice_readiness ?? "unavailable" };
  };
  const initial = initialContactFrom(preview, options);
  const temporary = choice?.visit === visit && choice.generation === preview?.generation;
  const sender = temporary ? latestSender(choice.sender) : initial;
  const revision = contactNumberRevision(preview);
  const pending = requested?.visit === visit && requested.revision === revision
    ? { ...requested, sender: latestSender(requested.sender) } : null;
  const busy = busyVisit === visit;
  const identity = JSON.stringify([visit, preview?.generation, sender?.id, sender?.number, !!temporary]);
  const current = useRef({ visit, identity, revision, pending: !!pending, blocked: false });
  const disabled = readOnly || !!model.isPending || !!model.isError || !preview || busy ||
    (enabled && (loaded?.visit !== visit || !!loaded.error));
  const readiness = contactFromReadiness(preview, sender, !!temporary);
  current.current = { visit, identity, revision, pending: !!pending,
    blocked: disabled || (enabled && readiness.call !== "ready") };

  useEffect(() => {
    if (!enabled || readOnly || !model.contactId || !model.type) return;
    let cancelled = false;
    contactNumberOptions(model.contactId, model.type).then(rows => {
      if (!cancelled) setLoaded({ visit, rows });
    }).catch(() => {
      if (!cancelled) setLoaded({ visit, rows: [], error: "Available numbers could not be loaded." });
    });
    return () => { cancelled = true; };
  }, [visit, enabled, readOnly, model.contactId, model.type, preview?.generation, model.dataUpdatedAt, retry]);

  const select = (id: string) => {
    if (disabled || busy || !preview) return;
    const next = options.find(row => row.id === id);
    if (!next?.id || next.id === sender?.id) return;
    setFailure(null);
    if (next.id === initial?.id) { setChoice(null); setRequested(null); return; }
    setRequested({ visit, generation: preview.generation, sender: next, revision });
  };
  const cancel = () => { if (!busy) { setRequested(null); setFailure(null); } };
  const confirm = async (assign: boolean) => {
    if (!pending || submitting.current === visit || disabled || !model.contactId || !model.type) return;
    const input = confirmationSchema.safeParse({ number: pending.sender.id, assign });
    if (!input.success) { setFailure({ visit, message: "Choose an available number." }); return; }
    const owner = visit;
    const stillHere = () => mounted.current && current.current.visit === owner;
    if (current.current.revision !== pending.revision) return;
    if (assign && (!canAssign || pending.sender.readiness !== "ready" || pending.sender.voice_readiness !== "ready")) {
      setFailure({ visit, message: canAssign ? "This number must be ready for calls and texts before it can be assigned." : "You do not have permission to change this assignment." }); return;
    }
    submitting.current = owner; setBusyVisit(owner); setFailure(null);
    try {
      if (assign) {
        const updated = await changeContactNumber(model.contactId, model.type, "both", input.data.number,
          pending.generation, "Agent confirmed reassignment from the contact FROM selector.");
        if (!stillHere()) return;
        if (updated.voice.id !== input.data.number || updated.sms.id !== input.data.number ||
            updated.voice.state !== "established" || updated.sms.state !== "established") {
          throw new Error("The assignment could not be verified. Refresh the contact before continuing.");
        }
        setSaved({ visit: owner, data: updated }); setChoice(null); setRequested(null);
        await model.acceptPreview(updated);
        if (stillHere()) void model.refresh();
      } else {
        setChoice({ visit: owner, generation: pending.generation, sender: pending.sender });
        setRequested(null);
      }
    } catch (error) {
      if (stillHere()) setFailure({ visit: owner, message: error instanceof Error ? error.message : "Number change failed." });
    } finally {
      if (submitting.current === owner) submitting.current = null;
      if (stillHere()) setBusyVisit(null);
    }
  };
  const ready = !disabled && !pending;
  const canCall = ready && (!enabled || readiness.call === "ready");
  const canText = ready && (enabled ? readiness.sms === "ready" : model.canText);
  const captureCallSelection = () => {
    if (!canCall) return null;
    if (!enabled) return legacyNumber ? { fromNumber: legacyNumber } : {};
    if (!sender?.id || !sender.number) return null;
    const owner = identity;
    return { fromNumber: sender.number, expectedCallerNumber: sender.number,
      ...(temporary ? { oneCallNumberId: sender.id } : {}),
      isSelectionCurrent: () => mounted.current && current.current.identity === owner &&
        !current.current.blocked && !current.current.pending };
  };
  return { enabled, preview, sender, temporary: !!temporary, options, initial, pending, busy, disabled,
    canAssign: canAssign && !readOnly, canCall, canText, readiness, select, cancel, confirm, captureCallSelection,
    error: failure?.visit === visit ? failure.message : loaded?.visit === visit ? loaded.error : undefined,
    retry: () => { setRetry(value => value + 1); void model.refetch(); },
    smsSelection: enabled ? { senderPreference: sender?.number ?? null, expectedSenderId: sender?.id ?? null,
      overrideSenderId: temporary ? sender?.id ?? null : null } : {
      senderPreference: model.sender?.number ?? (legacyNumber ? toE164Plus(legacyNumber) : null),
      expectedSenderId: model.sender?.id ?? null, overrideSenderId: model.override?.id ?? null },
  };
}
