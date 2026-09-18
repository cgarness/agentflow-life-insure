/**
 * Inbound Calling v2 — ringtone output selection (D9: the incoming ring plays on the default
 * speakers AND the headset). Pure helpers operate on ids; the SDK-facing helpers accept a
 * structurally-typed Device so they are unit-tested without the Twilio SDK.
 *
 * SDK facts (Twilio Voice SDK 2.18.1, verified in node_modules): `device.audio.ringtoneDevices` is an
 * OutputDeviceCollection with `set(ids)`, `get()`, `test()`; `device.audio.availableOutputDevices` is a
 * Map<string, MediaDeviceInfo>; `device.audio.isOutputSelectionSupported` gates all of it (Chrome and
 * Edge support setSinkId; Firefox and Safari do not — there the browser's default output rings).
 */

export const RINGTONE_OUTPUT_PREF_KEY = "agentflow_ringtone_outputs_v1";

export type RingtoneOutputPref =
  | { mode: "all" }
  | { mode: "selected"; deviceIds: string[] };

export const DEFAULT_RINGTONE_OUTPUT_PREF: RingtoneOutputPref = { mode: "all" };

export function loadRingtoneOutputPref(storage: Pick<Storage, "getItem"> | null = safeLocalStorage()): RingtoneOutputPref {
  try {
    const raw = storage?.getItem(RINGTONE_OUTPUT_PREF_KEY);
    if (!raw) return DEFAULT_RINGTONE_OUTPUT_PREF;
    const parsed = JSON.parse(raw) as { mode?: unknown; deviceIds?: unknown };
    if (parsed.mode === "selected" && Array.isArray(parsed.deviceIds)) {
      const ids = parsed.deviceIds.filter((v): v is string => typeof v === "string" && v.length > 0);
      return ids.length > 0 ? { mode: "selected", deviceIds: ids } : DEFAULT_RINGTONE_OUTPUT_PREF;
    }
    return DEFAULT_RINGTONE_OUTPUT_PREF;
  } catch {
    return DEFAULT_RINGTONE_OUTPUT_PREF;
  }
}

export function saveRingtoneOutputPref(pref: RingtoneOutputPref, storage: Pick<Storage, "setItem"> | null = safeLocalStorage()): void {
  try {
    storage?.setItem(RINGTONE_OUTPUT_PREF_KEY, JSON.stringify(pref));
  } catch {
    /* per-viewer convenience only */
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * D9: 'all' rings every available output; 'selected' rings the intersection of the saved ids with
 * what is currently plugged in — and if that intersection is EMPTY (headset unplugged) it falls back
 * to every output, so an incoming call is never silent because of a stale preference.
 */
export function computeRingtoneDeviceIds(available: string[], pref: RingtoneOutputPref): string[] {
  const all = available.filter((id) => typeof id === "string" && id.length > 0);
  if (pref.mode === "all") return all;
  const chosen = pref.deviceIds.filter((id) => all.includes(id));
  return chosen.length > 0 ? chosen : all;
}

/** Structural view of the SDK surface this module needs (Twilio Voice SDK 2.18.1 AudioHelper). */
export interface RingtoneCapableDevice {
  audio?: {
    isOutputSelectionSupported: boolean;
    availableOutputDevices: Map<string, { deviceId: string; label: string }>;
    ringtoneDevices: {
      set(ids: string | string[]): Promise<void>;
      get(): Set<{ deviceId: string; label: string }>;
      test(filePath?: string): Promise<void>;
    };
  } | null;
}

export interface AudioOutputOption {
  deviceId: string;
  label: string;
}

export function listAudioOutputs(device: RingtoneCapableDevice | null | undefined): AudioOutputOption[] {
  const map = device?.audio?.availableOutputDevices;
  if (!map) return [];
  const out: AudioOutputOption[] = [];
  map.forEach((info, id) => {
    const deviceId = info?.deviceId || id;
    if (!deviceId) return;
    out.push({ deviceId, label: (info?.label || "").trim() || (deviceId === "default" ? "Default output" : `Output ${out.length + 1}`) });
  });
  return out;
}

export type ApplyRingtoneResult =
  | { supported: false; applied: [] }
  | { supported: true; applied: string[] };

/** Applies the preference to the Device; called on every `registered` and whenever the preference changes. */
export async function applyRingtoneOutputs(
  device: RingtoneCapableDevice | null | undefined,
  pref: RingtoneOutputPref = loadRingtoneOutputPref(),
): Promise<ApplyRingtoneResult> {
  const audio = device?.audio;
  if (!audio || !audio.isOutputSelectionSupported) return { supported: false, applied: [] };
  const ids = computeRingtoneDeviceIds(listAudioOutputs(device).map((o) => o.deviceId), pref);
  if (ids.length === 0) return { supported: true, applied: [] };
  try {
    await audio.ringtoneDevices.set(ids);
    return { supported: true, applied: ids };
  } catch {
    // an id that vanished between enumeration and set(): fall back to everything available
    const all = listAudioOutputs(device).map((o) => o.deviceId);
    try {
      if (all.length > 0) await audio.ringtoneDevices.set(all);
      return { supported: true, applied: all };
    } catch {
      return { supported: true, applied: [] };
    }
  }
}

/** Plays the SDK's test sound on the CURRENT ringtone outputs (verifies routing without a live call). */
export async function testRingtoneOutputs(device: RingtoneCapableDevice | null | undefined): Promise<boolean> {
  const audio = device?.audio;
  if (!audio) return false;
  try {
    await audio.ringtoneDevices.test();
    return true;
  } catch {
    return false;
  }
}
