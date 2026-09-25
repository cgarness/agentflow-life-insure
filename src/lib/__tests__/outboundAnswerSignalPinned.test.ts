import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * SUPPLEMENTARY source pins for the Team/Open "answered" boundary (rev 5 §8.2). The behavioural
 * proof is teamOpenRevealIntegration.test.tsx; these pins make an SDK upgrade or TwiML change that
 * would silently alter what `accept` means fail CI. They do NOT prove Twilio's network behaviour.
 */
const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("outbound answer signal — preconditions", () => {
  it("@twilio/voice-sdk emits an outbound `accept` only after the signaling answer AND open media", () => {
    const pkg = JSON.parse(read("node_modules/@twilio/voice-sdk/package.json")) as { version: string };
    expect(pkg.version).toBe("2.18.1"); // re-verify the guard below on any upgrade
    const sdk = read("node_modules/@twilio/voice-sdk/es5/twilio/call.js");
    const fn = sdk.slice(sdk.indexOf("Call.prototype._maybeTransitionToOpen"), sdk.indexOf("Call.prototype._maybeTransitionToOpen") + 700);
    expect(fn).toMatch(/if \(this\._isAnswered\)/);
    expect(fn).toMatch(/this\._mediaHandler\.status === 'open'/);
    expect(fn).toMatch(/this\.emit\('accept', this\)/);
    // Outbound `_isAnswered` comes only from the signaling `answer` message; `ringing` never sets it.
    const onAnswer = sdk.slice(sdk.indexOf("_this._onAnswer = function"), sdk.indexOf("_this._onAnswer = function") + 900);
    expect(onAnswer).toContain("_this._isAnswered = true;");
    const onRinging = sdk.slice(sdk.indexOf("_this._onRinging = function"), sdk.indexOf("_this._onRinging = function") + 700);
    expect(onRinging).not.toContain("_isAnswered = true");
  });

  it("the outbound TwiML dials with answerOnBridge (the client leg is answered when the destination bridges)", () => {
    const hook = read("supabase/functions/twilio-voice-webhook/index.ts");
    expect(hook).toContain('<Dial answerOnBridge="true"');
    // Refusal / error paths return an empty <Response>; whether that answers the client leg first is UNRESOLVED.
    expect(hook).toContain("const EMPTY_TWIML = '<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>';");
  });

  it("the provider's outbound `active` state comes only from the Voice.js `accept` handler", () => {
    const ctx = read("src/contexts/TwilioContext.tsx");
    const activeSets = ctx.match(/setCallState\("active"\)/g) ?? [];
    expect(activeSets).toHaveLength(1);
    const acceptIdx = ctx.indexOf('call.on("accept", () => {');
    expect(acceptIdx).toBeGreaterThan(-1);
    expect(ctx.indexOf('setCallState("active")')).toBeGreaterThan(acceptIdx);
    expect(ctx.indexOf('setCallState("active")')).toBeLessThan(acceptIdx + 900);
  });
});
