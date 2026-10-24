import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for google.picker that records what the module builds and lets each test fire the callback.
type Cb = (data: Record<string, unknown>) => void;
interface Fake { cb: Cb | null; mode: unknown; token: unknown; visible: number; disposed: number; buildThrows: boolean }
let fake: Fake;
type W = Window & { google?: unknown; gapi?: unknown };

function installPicker(actions: Record<string, string> = { PICKED: "picked", CANCEL: "cancel", ERROR: "error" }) {
  fake = { cb: null, mode: null, token: null, visible: 0, disposed: 0, buildThrows: false };
  (window as W).google = { picker: {
    ViewId: { SPREADSHEETS: "spreadsheets" }, DocsViewMode: { LIST: "list" }, Action: actions,
    Response: { ACTION: "action", DOCUMENTS: "docs" }, Document: { ID: "id", NAME: "name" },
    DocsView: function (this: Record<string, unknown>) {
      this.setMimeTypes = () => this;
      this.setMode = (m: unknown) => { fake.mode = m; return this; };
    },
    PickerBuilder: function (this: Record<string, unknown>) {
      for (const m of ["setAppId", "setDeveloperKey", "setOrigin", "addView"]) this[m] = () => this;
      this.setOAuthToken = (t: unknown) => { fake.token = t; return this; };
      this.setCallback = (f: Cb) => { fake.cb = f; return this; };
      this.build = () => {
        if (fake.buildThrows) throw new Error("bad config");
        return { setVisible: () => { fake.visible++; }, dispose: () => { fake.disposed++; } };
      };
    },
  } };
}

const load = async () => { vi.resetModules(); return import("../picker"); };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.stubEnv("VITE_GOOGLE_PICKER_API_KEY", "k");
  vi.stubEnv("VITE_GOOGLE_CLOUD_PROJECT_NUMBER", "123");
});
afterEach(() => {
  vi.unstubAllEnvs(); vi.useRealTimers();
  delete (window as W).google; delete (window as W).gapi;
  document.head.querySelectorAll("script").forEach((s) => s.remove());
});

describe("pickSpreadsheet outcomes", () => {
  it("PICKED resolves the file once, uses the list view and disposes the Picker", async () => {
    installPicker();
    const { pickSpreadsheet } = await load();
    const p = pickSpreadsheet("ya29.T");
    await flush();
    expect(fake.visible).toBe(1);
    expect(fake.token).toBe("ya29.T");
    expect(fake.mode).toBe("list");
    fake.cb!({ action: "loaded" });                       // informational: ignored
    fake.cb!({ action: "picked", docs: [{ id: "SHEET_1", name: "Leads" }] });
    fake.cb!({ action: "cancel" });                       // late second outcome: ignored
    await expect(p).resolves.toEqual({ id: "SHEET_1", name: "Leads" });
    expect(fake.disposed).toBe(1);
  });

  it("CANCEL resolves null and disposes", async () => {
    installPicker();
    const { pickSpreadsheet } = await load();
    const p = pickSpreadsheet("t");
    await flush();
    fake.cb!({ action: "cancel" });
    await expect(p).resolves.toBeNull();
    expect(fake.disposed).toBe(1);
  });

  it("ERROR rejects with picker_error and disposes", async () => {
    installPicker();
    const { pickSpreadsheet, PickerError } = await load();
    const p = pickSpreadsheet("t");
    await flush();
    fake.cb!({ action: "error" });
    await expect(p).rejects.toBeInstanceOf(PickerError);
    await expect(p).rejects.toMatchObject({ code: "picker_error" });
    expect(fake.disposed).toBe(1);
  });

  it("matches a Google error even without the ERROR enum, and never treats a missing action as one", async () => {
    installPicker({ PICKED: "picked", CANCEL: "cancel" });
    const { pickSpreadsheet } = await load();
    const p = pickSpreadsheet("t");
    await flush();
    fake.cb!({});
    expect(fake.disposed).toBe(0);
    fake.cb!({ action: "error" });
    await expect(p).rejects.toMatchObject({ code: "picker_error" });
  });

  it("an abort disposes the open Picker, resolves null, and ignores a late pick", async () => {
    installPicker();
    const { pickSpreadsheet } = await load();
    const ac = new AbortController();
    const p = pickSpreadsheet("t", ac.signal);
    await flush();
    ac.abort();
    fake.cb!({ action: "picked", docs: [{ id: "LATE", name: "x" }] });
    await expect(p).resolves.toBeNull();
    expect(fake.disposed).toBe(1);
  });

  it("an already-aborted signal never shows the Picker", async () => {
    installPicker();
    const { pickSpreadsheet } = await load();
    const ac = new AbortController(); ac.abort();
    await expect(pickSpreadsheet("t", ac.signal)).resolves.toBeNull();
    expect(fake.visible).toBe(0);
  });

  it("a Picker that fails to build rejects instead of hanging", async () => {
    installPicker();
    fake.buildThrows = true;
    const { pickSpreadsheet } = await load();
    await expect(pickSpreadsheet("t")).rejects.toMatchObject({ code: "picker_error" });
  });
});

describe("Picker loader", () => {
  const scripts = () => Array.from(document.head.querySelectorAll<HTMLScriptElement>("script[src='https://apis.google.com/js/api.js']"));

  it("a script error rejects load_failed, removes the script, and a retry starts fresh", async () => {
    const { preparePicker } = await load();
    const first = preparePicker();
    expect(scripts()).toHaveLength(1);
    scripts()[0].onerror!(new Event("error"));
    await expect(first).rejects.toMatchObject({ code: "load_failed" });
    expect(scripts()).toHaveLength(0);
    const second = preparePicker();
    expect(scripts()).toHaveLength(1);
    (window as W).gapi = { load: (_n: string, c: { callback: () => void }) => { installPicker(); c.callback(); } };
    scripts()[0].onload!(new Event("load"));
    await expect(second).resolves.toBeUndefined();
  });

  it("a load that never finishes rejects load_timeout within the budget", async () => {
    vi.useFakeTimers();
    const { preparePicker, PICKER_LOAD_TIMEOUT_MS } = await load();
    const p = preparePicker();
    const done = expect(p).rejects.toMatchObject({ code: "load_timeout" });
    vi.advanceTimersByTime(PICKER_LOAD_TIMEOUT_MS);
    await done;
    expect(scripts()).toHaveLength(0);
  });

  it("a gapi library error rejects load_failed; an existing gapi is reused without a new script", async () => {
    (window as W).gapi = { load: (_n: string, c: { onerror: () => void }) => c.onerror() };
    const { preparePicker } = await load();
    await expect(preparePicker()).rejects.toMatchObject({ code: "load_failed" });
    expect(scripts()).toHaveLength(0);
  });
});
