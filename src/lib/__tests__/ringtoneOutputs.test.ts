// Incoming ring outputs are FIXED system behaviour (implementation_plan.md §19.3): every available
// output rings — speakers AND headset — with no user setting, and nothing an older build stored in
// the browser can narrow it. The two fail-safes are kept: an unsupported browser degrades to its own
// default output instead of throwing, and a device that disappears mid-configuration never leaves an
// incoming call ringing on nothing.
import { beforeEach, describe, expect, it } from "vitest";
import {
  OBSOLETE_RINGTONE_OUTPUT_PREF_KEY,
  applyRingtoneOutputs,
  clearObsoleteRingtoneOutputPref,
  computeRingtoneDeviceIds,
  listAudioOutputs,
  testRingtoneOutputs,
  type RingtoneCapableDevice,
} from "@/lib/ringtoneOutputs";

function fakeDevice(ids: Array<[string, string]>, supported = true, failFirstSet = false) {
  const calls: string[][] = [];
  const speakerCalls: unknown[] = [];
  let first = true;
  const device: RingtoneCapableDevice & { audio: { speakerDevices: { set: (v: unknown) => Promise<void> } } } = {
    audio: {
      isOutputSelectionSupported: supported,
      availableOutputDevices: new Map(ids.map(([id, label]) => [id, { deviceId: id, label }])),
      // conversation audio — ring configuration must never write it
      speakerDevices: { set: async (v: unknown) => { speakerCalls.push(v); } },
      ringtoneDevices: {
        set: async (v) => {
          const arr = Array.isArray(v) ? v : [v];
          if (failFirstSet && first) { first = false; throw new Error("unknown sink"); }
          calls.push(arr);
        },
        get: () => new Set(),
        test: async () => {},
      },
    },
  };
  return { device, calls, speakerCalls };
}

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* jsdom always has one */ }
});

describe("computeRingtoneDeviceIds — always every available output", () => {
  it("returns all available ids", () => {
    expect(computeRingtoneDeviceIds(["default", "hs1"])).toEqual(["default", "hs1"]);
  });
  it("drops empty / non-string ids", () => {
    expect(computeRingtoneDeviceIds(["default", "", null as unknown as string, "hs1"])).toEqual(["default", "hs1"]);
  });
  it("takes no preference argument at all (no way to narrow it)", () => {
    expect(computeRingtoneDeviceIds.length).toBe(1);
  });
});

describe("applyRingtoneOutputs — the fixed behaviour", () => {
  it("rings speakers AND headset, and never touches conversation audio", async () => {
    const { device, calls, speakerCalls } = fakeDevice([["default", "Speakers"], ["hs1", "Headset"]]);
    expect(await applyRingtoneOutputs(device)).toEqual({ supported: true, applied: ["default", "hs1"] });
    expect(calls).toEqual([["default", "hs1"]]);
    expect(speakerCalls).toEqual([]);
  });

  it("a LEGACY stored selection cannot restrict ringing", async () => {
    window.localStorage.setItem(OBSOLETE_RINGTONE_OUTPUT_PREF_KEY, JSON.stringify({ mode: "selected", deviceIds: ["hs1"] }));
    const { device, calls } = fakeDevice([["default", "Speakers"], ["hs1", "Headset"]]);
    const r = await applyRingtoneOutputs(device);
    expect(r).toEqual({ supported: true, applied: ["default", "hs1"] });
    expect(calls).toEqual([["default", "hs1"]]);
    // and the obsolete key does not survive
    expect(window.localStorage.getItem(OBSOLETE_RINGTONE_OUTPUT_PREF_KEY)).toBeNull();
  });

  it("unsupported browsers (Firefox/Safari) are reported, never thrown — the browser default rings", async () => {
    const { device, calls } = fakeDevice([["default", "Speakers"]], false);
    expect(await applyRingtoneOutputs(device)).toEqual({ supported: false, applied: [] });
    expect(calls).toEqual([]);
    expect(await applyRingtoneOutputs(null)).toEqual({ supported: false, applied: [] });
    expect(await applyRingtoneOutputs(undefined)).toEqual({ supported: false, applied: [] });
  });

  it("a sink that vanished mid-configuration falls back to every output still available", async () => {
    const { device, calls, speakerCalls } = fakeDevice([["default", "Speakers"], ["hs1", "Headset"]], true, true);
    const r = await applyRingtoneOutputs(device);
    expect(r).toEqual({ supported: true, applied: ["default", "hs1"] });
    expect(calls).toEqual([["default", "hs1"]]);
    expect(speakerCalls).toEqual([]);
  });

  it("an unplugged last output reports nothing applied rather than throwing", async () => {
    const { device, calls } = fakeDevice([]);
    expect(await applyRingtoneOutputs(device)).toEqual({ supported: true, applied: [] });
    expect(calls).toEqual([]);
  });

  it("lists labelled outputs with a readable fallback label", () => {
    const { device } = fakeDevice([["default", ""], ["abc", "USB Headset"]]);
    expect(listAudioOutputs(device)).toEqual([{ deviceId: "default", label: "Default output" }, { deviceId: "abc", label: "USB Headset" }]);
  });

  it("the test ring reports success/failure without throwing", async () => {
    const { device } = fakeDevice([["default", "Speakers"]]);
    expect(await testRingtoneOutputs(device)).toBe(true);
    expect(await testRingtoneOutputs(null)).toBe(false);
  });
});

describe("the obsolete per-browser preference is removed, not read", () => {
  it("clears the key and tolerates a storage that throws", () => {
    window.localStorage.setItem(OBSOLETE_RINGTONE_OUTPUT_PREF_KEY, '{"mode":"selected","deviceIds":["hs1"]}');
    clearObsoleteRingtoneOutputPref();
    expect(window.localStorage.getItem(OBSOLETE_RINGTONE_OUTPUT_PREF_KEY)).toBeNull();
    expect(() => clearObsoleteRingtoneOutputPref({ removeItem: () => { throw new Error("blocked"); } })).not.toThrow();
    expect(() => clearObsoleteRingtoneOutputPref(null)).not.toThrow();
  });

  it("exports no loader or saver for it", async () => {
    const mod = await import("@/lib/ringtoneOutputs");
    for (const gone of ["loadRingtoneOutputPref", "saveRingtoneOutputPref", "DEFAULT_RINGTONE_OUTPUT_PREF"]) {
      expect(gone in mod).toBe(false);
    }
  });
});
