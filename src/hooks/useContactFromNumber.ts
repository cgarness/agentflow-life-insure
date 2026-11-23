import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ContactCallerRoutingContext } from "@/contexts/ContactCallerRoutingContext";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { toE164Plus } from "@/utils/phoneUtils";
import { changeContactNumber, contactNumberOptions, type ContactNumberAffinity, type ContactNumberOption } from "@/lib/number-affinity";
import { contactFromReadiness, contactNumberRevision, hasUnassignedContactNumbers, initialContactFrom, LOCAL_PRESENCE_OPTION, stickyFromEnabled } from "@/lib/contact-from-number";
import type { useContactNumberAffinity } from "./useContactNumberAffinity";

type Model = ReturnType<typeof useContactNumberAffinity>;
type Props = { model: Model; phone?: string; canAssign: boolean; legacyNumber: string };
type Choice = { visit: string; generation: number; sender: ContactNumberOption; revision: string };
const noOptions: ContactNumberOption[] = [];
const confirmationSchema = z.object({ number: z.string().uuid(), assign: z.boolean() });

function useLocalContactCaller(scope: string, phone: string | undefined, options: ContactNumberOption[], enabled: boolean) {
  const routing = useContext(ContactCallerRoutingContext);
  // Options are polled. Hold the same candidate array across equivalent inventories so an
  // in-flight quick call survives a background refresh. Include IDs to catch replaced numbers.
  const inventory = useMemo(() => {
    const ready = options.flatMap(row => row.id && row.number && row.voice_readiness === "ready"
      ? [{ id: row.id, number: row.number }] : []);
    ready.sort((a, b) => a.id.localeCompare(b.id));
    return { key: JSON.stringify(ready), numbers: ready.map(row => row.number) };
  }, [options]);
  const pool = useRef(inventory);
  if (pool.current.key !== inventory.key) pool.current = inventory;
  const candidates = pool.current.numbers;
  const [result, setResult] = useState<{ scope: string; routing: typeof routing; candidates: string[]; number: string } | null>(null);
  useEffect(() => {
    if (!enabled || !routing || !phone || !candidates.length) return;
    let current = true;
    const finish = (number: string) => { if (current) setResult({ scope, routing, candidates, number }); };
    routing.resolveContactLocalCaller(phone, candidates).then(finish, () => finish(""));
    return () => { current = false; };
  }, [scope, routing, candidates, enabled, phone]);
  const resolved = enabled && result?.scope === scope && result.routing === routing && result.candidates === candidates;
  const local = resolved ? options.find(row => row.number === result.number && row.voice_readiness === "ready") : null;
  return { local, routing, checking: enabled && !!routing && candidates.length > 0 && !resolved };
}

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
  const [requested, setRequested] = useState<Choice | null>(null);
  const [saved, setSaved] = useState<{ visit: string; data: ContactNumberAffinity } | null>(null);
  const [failure, setFailure] = useState<{ visit: string; message: string } | null>(null);
  const [busyVisit, setBusyVisit] = useState<string | null>(null);
  const submitting = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);
  const preview = saved?.visit === visit && saved.data.generation > (model.data?.generation ?? -1) ? saved.data : model.data;
  const unassigned = hasUnassignedContactNumbers(preview);
  const enabled = unassigned || stickyFromEnabled(preview);
  const readOnly = !!isImpersonating || model.readOnly;
  const options = loaded?.visit === visit ? loaded.rows : noOptions;
  const latestSender = (candidate: ContactNumberOption) => {
    const fresh = options.find(row => row.id === candidate.id && row.number === candidate.number);
    return { ...candidate, readiness: fresh?.readiness ?? "unavailable",
      voice_readiness: fresh?.voice_readiness ?? "unavailable" };
  };
  const initial = initialContactFrom(preview, options);
  const revision = contactNumberRevision(preview);
  const temporary = choice?.visit === visit && choice.revision === revision;
  const automatic = unassigned && !temporary;
  const sender = temporary ? latestSender(choice.sender) : initial;
  const { local, routing, checking } = useLocalContactCaller(visit + revision, phone, options,
    automatic && !readOnly && !model.isPending && !model.isError);
  const callSender = automatic ? local : sender;
  const manualFirstUse = unassigned && temporary;
  const role = manualFirstUse && sender?.id && sender.number
    ? routing?.getContactCallerRole(sender.id, sender.number) : null;
  const pending = requested?.visit === visit && requested.revision === revision
    ? { ...requested, sender: latestSender(requested.sender) } : null;
  const pendingAgency = !!pending?.sender.id && !!pending.sender.number &&
    routing?.getContactCallerRole(pending.sender.id, pending.sender.number) === "agency";
  const canAssignPending = canAssign && !readOnly && pendingAgency;
  const assignableId = canAssignPending ? pending.sender.id : null;
  const busy = busyVisit === visit;
  const identity = JSON.stringify([visit, revision, callSender?.id, callSender?.number, !!temporary, role]);
  const current = useRef({ visit, identity, revision, assignableId, pending: !!pending, blocked: false });
  const disabled = readOnly || !!model.isPending || !!model.isError || !preview || busy ||
    (enabled && (loaded?.visit !== visit || !!loaded.error));
  const readiness = contactFromReadiness(preview, sender, !!temporary);
  if (automatic) {
    readiness.call = local?.voice_readiness ?? (checking ? "checking" : "unavailable");
    readiness.sms = preview?.sms.id && preview.sms.number ? preview.sms.readiness : "unavailable";
  } else if (manualFirstUse && !role) {
    readiness.call = "unavailable";
    readiness.sms = "unavailable";
  } else if (manualFirstUse && role === "personal" && preview?.sms_mode !== "enforced") {
    readiness.sms = "unavailable";
  }
  current.current = { visit, identity, revision, assignableId, pending: !!pending,
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
    if (unassigned && id === LOCAL_PRESENCE_OPTION) {
      setChoice(null);
      setFailure(null);
      return;
    }
    const next = options.find(row => row.id === id);
    if (!next?.id || (!automatic && next.id === sender?.id)) return;
    setFailure(null);
    if (unassigned) {
      setChoice({ visit, revision, generation: preview.generation, sender: next });
      return;
    }
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
    if (assign && current.current.assignableId !== pending.sender.id) {
      setFailure({ visit, message: canAssign ? "This number can only be used for this visit." : "You do not have permission to change this assignment." });
      return;
    }
    if (assign && (pending.sender.readiness !== "ready" || pending.sender.voice_readiness !== "ready")) {
      setFailure({ visit, message: "This number must be ready for calls and texts before it can be assigned." }); return;
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
        setChoice({ visit: owner, revision: pending.revision, generation: pending.generation, sender: pending.sender });
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
    if (!callSender?.id || !callSender.number) return null;
    const owner = identity;
    return { fromNumber: callSender.number, expectedCallerNumber: callSender.number,
      ...(temporary && (!unassigned || role === "personal") ? { oneCallNumberId: callSender.id } : {}),
      isSelectionCurrent: () => mounted.current && current.current.identity === owner &&
        !current.current.blocked && !current.current.pending };
  };
  const firstUse = manualFirstUse && role === "agency" && preview?.sms_mode === "enforced" && sender?.id
    ? { senderId: sender.id, generation: preview.generation } : null;
  const oneTextOverride = temporary && (!manualFirstUse || (preview?.sms_mode === "enforced" && role === "personal"));
  return { enabled, preview, sender, unassigned, automatic, temporary: !!temporary, options, initial, pending, busy, disabled,
    canAssign: canAssignPending, canCall, canText, readiness, select, cancel, confirm, captureCallSelection,
    error: failure?.visit === visit ? failure.message : loaded?.visit === visit ? loaded.error : undefined,
    retry: () => { setRetry(value => value + 1); void model.refetch(); },
    smsSelection: enabled ? { senderPreference: sender?.number ?? null, expectedSenderId: sender?.id ?? null,
      overrideSenderId: oneTextOverride ? sender?.id ?? null : null, ...(firstUse ? { firstUse } : {}) } : {
      senderPreference: model.sender?.number ?? (legacyNumber ? toE164Plus(legacyNumber) : null),
      expectedSenderId: model.sender?.id ?? null, overrideSenderId: model.override?.id ?? null },
  };
}
