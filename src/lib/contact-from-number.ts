import type { ContactNumberAffinity, ContactNumberOption, SenderChoice } from "./number-affinity";

const guarded = (mode?: string) => mode === "enforced" || mode === "guard_only";
export const stickyFromEnabled = (data?: ContactNumberAffinity) => !!data &&
  [data.voice_mode, data.sms_mode].some(guarded);

export const LOCAL_PRESENCE_OPTION = "local-presence";

export function hasUnassignedContactNumbers(data?: ContactNumberAffinity) {
  return !!data && data.voice_mode !== "guard_only" && data.sms_mode !== "guard_only" &&
    (data.history === "new" || data.history === "reconciled") &&
    data.voice.state === "unassigned" && data.sms.state === "unassigned";
}

const saved = (sender?: SenderChoice) => !!sender?.number &&
  (sender.state === "established" || sender.state === "reserved");

export function contactAssignment(data?: ContactNumberAffinity) {
  const voice = guarded(data?.voice_mode) && saved(data?.voice) ? data!.voice : null;
  const sms = guarded(data?.sms_mode) && saved(data?.sms) ? data!.sms : null;
  const split = !!voice && !!sms && (voice.id !== sms.id || voice.number !== sms.number);
  const review = data?.history === "needs_review" ||
    (guarded(data?.voice_mode) && data?.voice?.state === "needs_review") ||
    (guarded(data?.sms_mode) && data?.sms?.state === "needs_review");
  return { voice, sms, split, review, number: split ? null : (sms ?? voice)?.number ?? null,
    pending: sms?.state === "reserved" };
}

export function initialContactFrom(data?: ContactNumberAffinity, options: ContactNumberOption[] = []) {
  const unassigned = hasUnassignedContactNumbers(data);
  if (!data || (!stickyFromEnabled(data) && !unassigned)) return null;
  const assignment = contactAssignment(data);
  if (assignment.split || data.history === "needs_review") return null;
  // SMS prepares its own first sender. Use that preview so ordinary first sends still found pins.
  const sender = assignment.sms ?? assignment.voice ?? (
    (unassigned || guarded(data.sms_mode)) && data.sms.state !== "needs_review" ? data.sms :
      guarded(data.voice_mode) && data.voice.state !== "needs_review" ? data.voice : null
  );
  if (!sender?.number) return null;
  const option = options.find(row => row.id === sender.id);
  return { ...sender, readiness: sender.id === data.sms.id ? data.sms.readiness : option?.readiness ?? "unavailable",
    voice_readiness: sender.id === data.voice.id
    ? data.voice.readiness : option?.voice_readiness ?? "unavailable" } satisfies ContactNumberOption;
}

export function contactFromReadiness(data: ContactNumberAffinity | undefined,
  choice: ContactNumberOption | null, temporary: boolean) {
  if (!data || !choice?.id || !choice.number) return { call: "unavailable", sms: "unavailable" };
  const callReview = data.history === "needs_review" || (guarded(data.voice_mode) && data.voice.state === "needs_review");
  const smsReview = data.history === "needs_review" || (guarded(data.sms_mode) && data.sms.state === "needs_review");
  return {
    // The ordinary preview preserves the established-pin daily-cap exception; options do not.
    call: !temporary && callReview ? "needs_review" : !temporary && choice.id === data.voice.id ? data.voice.readiness : choice.voice_readiness,
    sms: !temporary && smsReview ? "needs_review" : !temporary && choice.id === data.sms.id ? data.sms.readiness : choice.readiness,
  };
}

export function contactNumberRevision(data?: ContactNumberAffinity) {
  return JSON.stringify([data?.generation, data?.history, data?.voice_mode, data?.sms_mode,
    data?.voice?.state === "unassigned" ? null : data?.voice?.id, data?.voice?.state, data?.voice?.version,
    data?.sms?.state === "unassigned" ? null : data?.sms?.id, data?.sms?.state, data?.sms?.version]);
}
