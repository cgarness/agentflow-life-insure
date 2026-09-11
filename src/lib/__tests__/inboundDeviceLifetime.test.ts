// Inbound Calling v2 §6.1 — Device lifetime is PROVIDER-OWNED (D1). Static source contracts: no UI
// surface destroys the Device, identity loss is the one teardown trigger, an in-flight destroy is
// awaited by the next init, readiness is not faked after `unregistered`, presence generations are
// wired to the Device events, recovery is bounded and idle-only, and the modal is gone.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const ctx = read("../../contexts/TwilioContext.tsx");
const voice = read("../../lib/twilio-voice.ts");
const floating = read("../../components/layout/FloatingDialer.tsx");
const dialerPage = read("../../pages/DialerPage.tsx");
const auth = read("../../contexts/AuthContext.tsx");

describe("L1 — no UI surface tears the Device down", () => {
  it("FloatingDialer close does not destroy the client", () => {
    expect(floating.includes("twilioDestroy")).toBe(false);
    expect(floating.includes("destroyClient")).toBe(false);
  });
  it("ending a dialing session does not destroy the client", () => {
    expect(dialerPage.includes("twilioDestroy")).toBe(false);
    expect(dialerPage.includes("destroyClient")).toBe(false);
  });
  it("destroyClient is referenced only by the provider's own identity-loss / re-init paths", () => {
    const uses = [...ctx.matchAll(/destroyClient/g)].length;
    expect(uses).toBeGreaterThan(0);
    expect(ctx.includes("destroyClientRef.current();")).toBe(true);
    expect(ctx.includes("prev && prev !== authUserId")).toBe(true);
  });
});

describe("L2 — teardown/init ordering and readiness truth", () => {
  it("initTwilioDevice awaits an in-flight destroy (the `destroying` promise)", () => {
    expect(voice.includes("let destroying: Promise<void> | null")).toBe(true);
    const initIdx = voice.indexOf("export async function initTwilioDevice");
    const awaitIdx = voice.indexOf("await destroying", initIdx);
    expect(awaitIdx).toBeGreaterThan(initIdx);
    expect(voice.includes("export function isTwilioDeviceDestroying")).toBe(true);
  });
  it("`unregistered` clears readiness AND drops the Ready status (no stale Ready)", () => {
    const start = ctx.indexOf("onUnregistered: () => {");
    const body = ctx.slice(start, ctx.indexOf("onError:", start));
    expect(body.includes("twilioVoiceReadyRef.current = false")).toBe(true);
    expect(body.includes('prev === "ready" ? "connecting"')).toBe(true);
  });
  it("network recovery also re-initialises when the Device is not actually ready", () => {
    expect(ctx.includes('status === "error" || !deviceRef.current || !twilioVoiceReadyRef.current')).toBe(true);
  });
  it("idle-only bounded recovery: never during a live/dialing call, capped per window", () => {
    const start = ctx.indexOf("const scheduleIdleRecovery = useCallback");
    const body = ctx.slice(start, ctx.indexOf("}, []);", start));
    expect(body.includes('callStateRef.current !== "idle" || isDialingRef.current')).toBe(true);
    expect(body.includes("RECOVERY_MAX_ATTEMPTS")).toBe(true);
    expect(ctx.includes("const RECOVERY_MAX_ATTEMPTS = 3")).toBe(true);
  });
});

describe("L3 — presence generations and D9 outputs ride the Device events", () => {
  it("registered ⇒ new presence generation + ringtone outputs; unregistered/error close it; destroy closes it", () => {
    expect(ctx.includes("void getPhonePresence().onRegistered();")).toBe(true);
    expect(ctx.includes("void applyRingtoneOutputs(getTwilioDevice());")).toBe(true);
    expect(ctx.includes('getPhonePresence().onUnregistered("unregistered")')).toBe(true);
    expect(ctx.includes("getPhonePresence().onError(")).toBe(true);
    expect(ctx.includes('getPhonePresence().onUnregistered("destroy")')).toBe(true);
    expect(ctx.includes("installPhonePresenceWindowHooks(getPhonePresence())")).toBe(true);
  });
  it("logout flushes the presence keepalive BEFORE awaiting signOut", () => {
    const logoutIdx = auth.indexOf("const logout = useCallback(async () => {");
    const flushIdx = auth.indexOf("flushPhonePresenceOnLogout();", logoutIdx);
    const signOutIdx = auth.indexOf("await supabase.auth.signOut()", logoutIdx);
    expect(flushIdx).toBeGreaterThan(logoutIdx);
    expect(flushIdx).toBeLessThan(signOutIdx);
  });
  it("presence never touches availability_status and never re-inits the Device", () => {
    // code only — doc comments legitimately name the column they promise never to touch
    const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const presence = stripComments(read("../../lib/phonePresence.ts") + read("../../lib/phonePresenceClient.ts"));
    expect(presence.includes("availability_status")).toBe(false);
    expect(presence.includes("initTwilioDevice")).toBe(false);
  });
  it("P17: the ring is measured from Device incoming to cancel/answer/reject", () => {
    expect(ctx.includes("incomingRingStartedAtRef.current = Date.now()")).toBe(true);
    expect(ctx.includes('noteRingMeasurement("cancel")')).toBe(true);
    expect(ctx.includes('noteRingMeasurement("answered")')).toBe(true);
  });
});

describe("L4 — the browser owns no ringtone and the modal is gone", () => {
  it("incomingCallAlerts exposes no start/stop ringtone hooks; the SDK rings", () => {
    const alerts = read("../../lib/incomingCallAlerts.ts");
    expect(alerts.includes("export function startIncomingRingtone")).toBe(false);
    expect(alerts.includes("export function stopIncomingRingtone")).toBe(false);
    expect(ctx.includes("startIncomingRingtone")).toBe(false);
  });
  it("IncomingCallModal.tsx is deleted", () => {
    expect(existsSync(resolve(__dirname, "../../components/dialer/IncomingCallModal.tsx"))).toBe(false);
  });
});
