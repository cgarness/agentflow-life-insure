/**
 * Incoming ring outputs — FIXED system behaviour, not a setting.
 *
 * An incoming call rings on EVERY available audio output (speakers AND headset). There is no user
 * control and no stored preference: the obsolete per-browser key written by earlier builds is read by
 * nothing and cleared best-effort whenever the ring is configured, so a value saved back then can
 * never narrow the ring again. Conversation (speaker) audio is never written here — outbound call
 * audio is untouched.
 *
 * SDK facts (Twilio Voice SDK 2.18.1, verified in node_modules): `device.audio.ringtoneDevices` is an
 * OutputDeviceCollection with `set(ids)`, `get()`, `test()`; `device.audio.availableOutputDevices` is a
 * Map<string, MediaDeviceInfo>; `device.audio.isOutputSelectionSupported` gates all of it (Chrome and
 * Edge support setSinkId; Firefox and Safari do not — there the browser's default output rings).
 */

/** Key written by builds that offered a per-browser output choice. Read by nothing; removed on sight. */
export const OBSOLETE_RINGTONE_OUTPUT_PREF_KEY = "agentflow_ringtone_outputs_v1";

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Best-effort removal of the obsolete output preference. Never throws; failure is irrelevant. */
export function clearObsoleteRingtoneOutputPref(storage: Pick<Storage, "removeItem"> | null = safeLocalStorage()): void {
  try {
    storage?.removeItem(OBSOLETE_RINGTONE_OUTPUT_PREF_KEY);
  } catch {
    /* a blocked or full store cannot affect ringing */
  }
}

/** Every available output, always. Empty/invalid ids are dropped. */
export function computeRingtoneDeviceIds(available: string[]): string[] {
  return available.filter((id) => typeof id === "string" && id.length > 0);
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

/**
 * Rings every available output. Called on every `registered` and on every `deviceChange`; takes no
 * preference, so nothing an agent's browser has stored can restrict it. Unsupported browsers are
 * reported (the browser default rings), and an id that vanishes between enumeration and `set()` is
 * retried against everything currently available so a call never rings silently.
 */
export async function applyRingtoneOutputs(device: RingtoneCapableDevice | null | undefined): Promise<ApplyRingtoneResult> {
  clearObsoleteRingtoneOutputPref();
  const audio = device?.audio;
  if (!audio || !audio.isOutputSelectionSupported) return { supported: false, applied: [] };
  const ids = computeRingtoneDeviceIds(listAudioOutputs(device).map((o) => o.deviceId));
  if (ids.length === 0) return { supported: true, applied: [] };
  try {
    await audio.ringtoneDevices.set(ids);
    return { supported: true, applied: ids };
  } catch {
    // an id that vanished between enumeration and set(): fall back to everything still available
    const all = computeRingtoneDeviceIds(listAudioOutputs(device).map((o) => o.deviceId));
    try {
      if (all.length > 0) await audio.ringtoneDevices.set(all);
      return { supported: true, applied: all };
    } catch {
      return { supported: true, applied: [] };
    }
  }
}

/**
 * Plays the SDK's test sound on the current ringtone outputs. Troubleshooting helper — no normal
 * user surface calls it (see ConnectionDiagnostics, which is internal/debug-only).
 */
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
