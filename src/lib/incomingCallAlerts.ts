/**
 * Desktop notifications for inbound WebRTC calls.
 * Incoming ring audio is handled by the Twilio Voice SDK (no custom browser ringtone).
 */

const PREFS_KEY = "agentflow_incoming_call_alerts_v1";
const AUDIO_PRIMED_KEY = "agentflow_incoming_audio_primed";

export type IncomingCallAlertsPrefs = {
  /** User clicked "Enable" (one-time setup). */
  optIn: boolean;
  ringtone: boolean;
  desktop: boolean;
};

const defaultPrefs: IncomingCallAlertsPrefs = {
  optIn: false,
  ringtone: true,
  desktop: true,
};

export function loadIncomingCallAlertsPrefs(): IncomingCallAlertsPrefs {
  if (typeof window === "undefined") return defaultPrefs;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaultPrefs;
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      optIn: Boolean(p.optIn),
      ringtone: p.ringtone !== false,
      desktop: p.desktop !== false,
    };
  } catch {
    return defaultPrefs;
  }
}

export function saveIncomingCallAlertsPrefs(patch: Partial<IncomingCallAlertsPrefs>): IncomingCallAlertsPrefs {
  const next = { ...loadIncomingCallAlertsPrefs(), ...patch };
  if (typeof window !== "undefined") {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  }
  return next;
}

export function isIncomingAudioPrimed(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(AUDIO_PRIMED_KEY) === "1";
}

function markAudioPrimed(): void {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(AUDIO_PRIMED_KEY, "1");
  }
}

let sharedAudioContext: AudioContext | null = null;

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AC();
  }
  return sharedAudioContext;
}

/** Unlock AudioContext + satisfy autoplay policy (call from a click handler). */
export async function primeIncomingCallAudio(): Promise<boolean> {
  try {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return false;
    if (ctx.state === "suspended") await ctx.resume();
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const silent = ctx.createBufferSource();
    silent.buffer = buffer;
    silent.connect(ctx.destination);
    silent.start(0);
    markAudioPrimed();
    return true;
  } catch {
    return false;
  }
}

export function getDesktopNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function enableIncomingCallAlertsFromUserGesture(): Promise<{
  audioPrimed: boolean;
  notificationPermission: NotificationPermission | "unsupported";
}> {
  const audioPrimed = await primeIncomingCallAudio();

  let notificationPermission: NotificationPermission | "unsupported" = "unsupported";
  if (typeof window !== "undefined" && typeof Notification !== "undefined") {
    notificationPermission = Notification.permission;
    if (notificationPermission === "default") {
      notificationPermission = await Notification.requestPermission();
    }
  }

  saveIncomingCallAlertsPrefs({ optIn: true, ringtone: true, desktop: true });

  return { audioPrimed, notificationPermission };
}

let lastNotification: Notification | null = null;

export function closeIncomingDesktopNotification(): void {
  try {
    lastNotification?.close();
  } catch {
    /* ignore */
  }
  lastNotification = null;
}

export function showIncomingDesktopNotification(title: string, body: string): void {
  const prefs = loadIncomingCallAlertsPrefs();
  if (!prefs.optIn || !prefs.desktop) return;
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  closeIncomingDesktopNotification();

  try {
    lastNotification = new Notification(title, {
      body,
      tag: "agentflow-inbound-call",
      requireInteraction: true,
      icon: `${window.location.origin}/placeholder.svg`,
    });
    lastNotification.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      closeIncomingDesktopNotification();
    };
  } catch (e) {
    console.warn("[incomingCallAlerts] Notification failed:", e);
  }
}

/** Legacy Telnyx-era hook — Twilio Voice.js plays inbound ringtone; no custom browser audio. */
export function startIncomingRingtone(): void {}

/** Legacy hook — no custom audio to stop. */
export function stopIncomingRingtone(): void {}
