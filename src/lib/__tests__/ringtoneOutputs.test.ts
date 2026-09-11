// Inbound Calling v2 — D9 ringtone outputs (implementation_plan.md rev 3 §6.4): default = every
// output (speakers AND headset); a stale selection never silences the ring.
import { describe, expect, it } from "vitest";
import {
  applyRingtoneOutputs,
  computeRingtoneDeviceIds,
  listAudioOutputs,
  loadRingtoneOutputPref,
  saveRingtoneOutputPref,
  type RingtoneCapableDevice,
} from "@/lib/ringtoneOutputs";

function fakeDevice(ids: Array<[string, string]>, supported = true, failFirstSet = false) {
  const calls: string[][] = [];
  let first = true;
  const device: RingtoneCapableDevice = {
    audio: {
      isOutputSelectionSupported: supported,
      availableOutputDevices: new Map(ids.map(([id, label]) => [id, { deviceId: id, label }])),
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
  return { device, calls };
}

describe("computeRingtoneDeviceIds — D9", () => {
  it("'all' rings every available output", () => {
    expect(computeRingtoneDeviceIds(["default", "hs1"], { mode: "all" })).toEqual(["default", "hs1"]);
  });
  it("'selected' rings the intersection; an empty intersection (headset unplugged) falls back to ALL", () => {
    expect(computeRingtoneDeviceIds(["default", "hs1"], { mode: "selected", deviceIds: ["hs1"] })).toEqual(["hs1"]);
    expect(computeRingtoneDeviceIds(["default"], { mode: "selected", deviceIds: ["hs1"] })).toEqual(["default"]);
  });
});

describe("applyRingtoneOutputs", () => {
  it("applies both speakers and headset by default (registered hook)", async () => {
    const { device, calls } = fakeDevice([["default", "Speakers"], ["hs1", "Headset"]]);
    const r = await applyRingtoneOutputs(device, { mode: "all" });
    expect(r).toEqual({ supported: true, applied: ["default", "hs1"] });
    expect(calls).toEqual([["default", "hs1"]]);
  });
  it("unsupported browsers (Firefox/Safari) are reported, never thrown", async () => {
    const { device, calls } = fakeDevice([["default", "Speakers"]], false);
    expect(await applyRingtoneOutputs(device, { mode: "all" })).toEqual({ supported: false, applied: [] });
    expect(calls).toEqual([]);
    expect(await applyRingtoneOutputs(null)).toEqual({ supported: false, applied: [] });
  });
  it("a vanished sink id falls back to every available output", async () => {
    const { device, calls } = fakeDevice([["default", "Speakers"], ["hs1", "Headset"]], true, true);
    const r = await applyRingtoneOutputs(device, { mode: "selected", deviceIds: ["hs1"] });
    expect(r).toEqual({ supported: true, applied: ["default", "hs1"] });
    expect(calls).toEqual([["default", "hs1"]]);
  });
  it("lists labelled outputs with a readable fallback label", () => {
    const { device } = fakeDevice([["default", ""], ["abc", "USB Headset"]]);
    expect(listAudioOutputs(device)).toEqual([{ deviceId: "default", label: "Default output" }, { deviceId: "abc", label: "USB Headset" }]);
  });
});

describe("preference persistence is per browser and fail-safe", () => {
  it("round-trips through storage and defaults to 'all' on garbage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    saveRingtoneOutputPref({ mode: "selected", deviceIds: ["hs1"] }, storage);
    expect(loadRingtoneOutputPref(storage)).toEqual({ mode: "selected", deviceIds: ["hs1"] });
    store.set("agentflow_ringtone_outputs_v1", "{not json");
    expect(loadRingtoneOutputPref(storage)).toEqual({ mode: "all" });
    store.set("agentflow_ringtone_outputs_v1", JSON.stringify({ mode: "selected", deviceIds: [] }));
    expect(loadRingtoneOutputPref(storage)).toEqual({ mode: "all" });
    expect(loadRingtoneOutputPref(null)).toEqual({ mode: "all" });
  });
});
