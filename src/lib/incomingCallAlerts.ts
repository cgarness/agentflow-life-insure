/**
 * Desktop notifications + optional ringtone for inbound WebRTC calls.
 * Browsers require a user gesture before Notification.requestPermission() and reliable audio.
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
/** Repeating ring cadence — must not depend on AudioContext.resume() settling to schedule the next tick (some browsers drop the promise chain after suspend). */
let ringRepeatIntervalId: ReturnType<typeof setInterval> | null = null;
let ringStopRequested = false;

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

function playRingBurst(ctx: AudioContext): void {
  const duration = 1.9;
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.12, now + 0.04);
  master.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  master.connect(ctx.destination);

  const freqs = [440, 480];
  for (const hz of freqs) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(hz, now);
    osc.connect(master);
    osc.start(now);
    osc.stop(now + duration);
  }
}

function playIncomingRingBurst(ctx: AudioContext): void {
  if (ringStopRequested) return;
  const play = () => {
    if (ringStopRequested) return;
    try {
      playRingBurst(ctx);
    } catch {
      /* ignore */
    }
  };
  try {
    void ctx.resume().then(play, play);
  } catch {
    play();
  }
}

export function startIncomingRingtone(): void {
  const prefs = loadIncomingCallAlertsPrefs();
  if (!prefs.optIn || !prefs.ringtone) return;
  if (!isIncomingAudioPrimed()) return;

  stopIncomingRingtone();
  const ctx = getOrCreateAudioContext();
  if (!ctx) return;

  ringStopRequested = false;

  // First burst immediately; then repeat every ~6s (~2s tone + ~4s gap).
  playIncomingRingBurst(ctx);
  ringRepeatIntervalId = window.setInterval(() => {
    playIncomingRingBurst(ctx);
  }, 6000);
}

export function stopIncomingRingtone(): void {
  ringStopRequested = true;
  if (ringRepeatIntervalId !== null) {
    clearInterval(ringRepeatIntervalId);
    ringRepeatIntervalId = null;
  }
}
