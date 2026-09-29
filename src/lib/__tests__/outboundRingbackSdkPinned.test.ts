import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * SUPPLEMENTARY source pins for the outbound ringback fallback. The behavioural proof is
 * outboundRingbackIntegration.test.tsx + outboundRingback.test.ts; these pins make an SDK upgrade that
 * would silently change what `ringing(hasEarlyMedia)` or the "outgoing" sound mean fail CI.
 */
const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("outbound ringback — Voice SDK preconditions", () => {
  const sdk = read("node_modules/@twilio/voice-sdk/es5/twilio/call.js");

  it("@twilio/voice-sdk is still 2.18.1 (re-verify every pin below on any upgrade)", () => {
    const pkg = JSON.parse(read("node_modules/@twilio/voice-sdk/package.json")) as { version: string };
    expect(pkg.version).toBe("2.18.1");
  });

  it("`ringing` is typed and emitted with hasEarlyMedia = whether the carrier sent SDP (early media)", () => {
    const dts = read("node_modules/@twilio/voice-sdk/es5/twilio/call.d.ts");
    expect(dts).toContain("function ringingEvent(hasEarlyMedia: boolean): void;");
    const onRinging = sdk.slice(sdk.indexOf("_this._onRinging = function"), sdk.indexOf("_this._onRinging = function") + 700);
    expect(onRinging).toContain("var hasEarlyMedia = !!payload.sdp;");
    expect(onRinging).toContain("_this.emit('ringing', hasEarlyMedia);");
  });

  it("`ringing` may fire again while already ringing (so early media can arrive after ringing(false))", () => {
    const onRinging = sdk.slice(sdk.indexOf("_this._onRinging = function"), sdk.indexOf("_this._onRinging = function") + 700);
    expect(onRinging).toContain("_this._status !== Call.State.Connecting && _this._status !== Call.State.Ringing");
  });

  it("the SDK's `outgoing` sound is a one-shot chime on `accept` (after answer) — not a ringback", () => {
    const device = read("node_modules/@twilio/voice-sdk/es5/twilio/device.js");
    const acceptIdx = device.indexOf("call$1.once('accept', function () {");
    const playIdx = device.indexOf("_this._soundcache.get(Device.SoundName.Outgoing).play();");
    expect(acceptIdx).toBeGreaterThan(-1);
    expect(playIdx).toBeGreaterThan(acceptIdx);
    expect(playIdx).toBeLessThan(acceptIdx + 900);
    expect(device.split("SoundName.Outgoing).play()").length - 1).toBe(1);
    expect(device).toContain("outgoing: { filename: 'outgoing', maxDuration: 3000 }");
  });
});

describe("outbound ringback — app wiring pins", () => {
  it("the Device keeps the ringing state enabled and the post-answer outgoing chime off", () => {
    const voice = read("src/lib/twilio-voice.ts");
    expect(voice).toContain("enableRingingState: true,");
    expect(voice).toContain("device.audio?.outgoing(false);");
  });

  it("the provider hands the SDK's hasEarlyMedia to the ringback helper from the outbound ringing handler", () => {
    const ctx = read("src/contexts/TwilioContext.tsx");
    const idx = ctx.indexOf('call.on("ringing", (hasEarlyMedia: boolean) => {');
    expect(idx).toBeGreaterThan(-1);
    const handler = ctx.slice(idx, idx + 700);
    expect(handler).toContain("handleOutboundRinging(call, hasEarlyMedia);");
    expect(handler).toContain("callRef.current === call");
  });
});
