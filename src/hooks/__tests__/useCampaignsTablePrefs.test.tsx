/**
 * useCampaignsTablePrefs — owner-bound Campaigns table column preferences.
 *
 * Pins: loading only READS (writeColumnLayout is never called on mount / re-render / settle);
 * loading → ready with the org's layout from settings; a failed read is an error state that
 * cannot be edited; View As (enabled=false) neither reads nor writes; the draft is separate from
 * the saved layout; Save sends the normalized draft and commits only an acknowledged result;
 * a failure keeps the draft and reports; Reset sends layout null; an identity switch masks the
 * previous owner's layout on the very first render, and late reads / saves from the previous
 * owner are never committed.
 *
 * Transport is mocked at the prefs I/O boundary (readPrefsRow / writeColumnLayout); the error
 * classes and layoutFromSettings are the real production exports.
 */
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeColumnLayout, type ColumnLayout } from "@/lib/campaigns-table/columns";
import type { PrefsRow } from "@/lib/campaigns-table/prefs";

interface WriteParams {
  userId: string;
  orgId: string;
  layout: ColumnLayout | null;
  isCurrent: () => boolean;
}
interface PendingRead {
  userId: string;
  signal: AbortSignal | undefined;
  resolve: (row: PrefsRow) => void;
  reject: (error: unknown) => void;
}
interface PendingWrite {
  params: WriteParams;
  resolve: (layout: ColumnLayout) => void;
  reject: (error: unknown) => void;
}

const h = vi.hoisted(() => ({
  reads: [] as PendingRead[],
  writes: [] as PendingWrite[],
  read: vi.fn(),
  write: vi.fn(),
  transport: vi.fn(),
}));

// Any direct transport use from the hook would be a bug: the hook goes through prefs.ts only.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => { h.transport("from", ...args); throw new Error("unexpected supabase.from"); },
    rpc: (...args: unknown[]) => { h.transport("rpc", ...args); throw new Error("unexpected supabase.rpc"); },
  },
}));
vi.mock("@/lib/campaigns-table/prefs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/campaigns-table/prefs")>();
  return { ...actual, readPrefsRow: h.read, writeColumnLayout: h.write };
});

import { CampaignsPrefsError, CampaignsPrefsSupersededError, layoutFromSettings } from "@/lib/campaigns-table/prefs";
import { useCampaignsTablePrefs } from "@/hooks/useCampaignsTablePrefs";

const DEFAULTS = normalizeColumnLayout(null);
const A_LAYOUT = normalizeColumnLayout({
  order: ["tags", "agents", "status", "progress", "converted", "contacted", "created", "last_dialed"],
  hidden: ["status"],
});
const B_LAYOUT = normalizeColumnLayout({
  order: ["last_dialed", "created", "status", "progress", "agents", "converted", "contacted", "tags"],
  hidden: [],
});

function settingsWith(orgId: string, layout: ColumnLayout): Record<string, unknown> {
  return {
    theme: "dark",
    campaigns_table: {
      v: 1,
      orgs: {
        [orgId]: { order: [...layout.order], hidden: [...layout.hidden] },
        "org-other": { order: ["status"], hidden: ["status"] },
      },
    },
  };
}
function rowWith(orgId: string, layout: ColumnLayout): PrefsRow {
  return { exists: true, settings: settingsWith(orgId, layout), updatedAt: "2026-10-01T00:00:00.123456+00:00" };
}

async function resolveRead(index: number, row: PrefsRow) {
  const p = h.reads[index];
  if (!p) throw new Error(`No read #${index}`);
  await act(async () => { p.resolve(row); });
}
async function rejectRead(index: number, error: unknown) {
  const p = h.reads[index];
  if (!p) throw new Error(`No read #${index}`);
  await act(async () => { p.reject(error); });
}
async function resolveWrite(index: number, layout: ColumnLayout) {
  const p = h.writes[index];
  if (!p) throw new Error(`No write #${index}`);
  await act(async () => { p.resolve(layout); });
}
async function rejectWrite(index: number, error: unknown) {
  const p = h.writes[index];
  if (!p) throw new Error(`No write #${index}`);
  await act(async () => { p.reject(error); });
}

interface Props {
  userId: string | null;
  orgId: string | null;
  enabled: boolean;
}
interface Snapshot extends Props {
  layout: ColumnLayout;
  draft: ColumnLayout | null;
  status: string;
  canEdit: boolean;
}
const PROPS: Props = { userId: "user-1", orgId: "org-1", enabled: true };
let renders: Snapshot[] = [];

function setup(initialProps: Props = PROPS) {
  return renderHook(
    (p: Props) => {
      const r = useCampaignsTablePrefs(p.userId, p.orgId, p.enabled);
      renders.push({ ...p, layout: r.layout, draft: r.draft, status: r.status, canEdit: r.canEdit });
      return r;
    },
    { initialProps, wrapper: queryWrapper() },
  );
}
/** Fresh TanStack cache per hook instance (the hook caches each owner's last confirmed layout). */
function queryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
async function setupReady(layout: ColumnLayout = A_LAYOUT, props: Props = PROPS) {
  const hook = setup(props);
  await resolveRead(h.reads.length - 1, rowWith(props.orgId ?? "", layout));
  return hook;
}

beforeEach(() => {
  renders = [];
  h.reads = [];
  h.writes = [];
  h.transport.mockReset();
  h.read.mockReset().mockImplementation(
    (userId: string, signal?: AbortSignal) =>
      new Promise<PrefsRow>((resolve, reject) => { h.reads.push({ userId, signal, resolve, reject }); }),
  );
  h.write.mockReset().mockImplementation(
    (params: WriteParams) =>
      new Promise<ColumnLayout>((resolve, reject) => { h.writes.push({ params, resolve, reject }); }),
  );
});

describe("useCampaignsTablePrefs — load", () => {
  it("only reads on mount, re-render and settle; never writes", async () => {
    const { result, rerender } = setup();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.read).toHaveBeenCalledWith("user-1", expect.any(AbortSignal));
    rerender(PROPS);
    rerender({ ...PROPS });
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.write).not.toHaveBeenCalled();

    // Even a missing row is never seeded with defaults.
    await resolveRead(0, { exists: false, settings: {}, updatedAt: null });
    rerender({ ...PROPS });
    expect(result.current.status).toBe("ready");
    expect(result.current.layout).toEqual(DEFAULTS);
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.write).not.toHaveBeenCalled();
    expect(h.transport).not.toHaveBeenCalled();
  });

  it("goes loading → ready with this organization's layout from settings", async () => {
    const { result } = setup();
    expect(result.current.status).toBe("loading");
    expect(result.current.layout).toEqual(DEFAULTS);
    expect(result.current.canEdit).toBe(false);
    // Nothing before the read settles ever shows anything but defaults.
    expect(renders.every((r) => (r.status === "idle" || r.status === "loading") && JSON.stringify(r.layout) === JSON.stringify(DEFAULTS))).toBe(true);

    const row = rowWith("org-1", A_LAYOUT);
    await resolveRead(0, row);
    expect(result.current.status).toBe("ready");
    expect(result.current.layout).toEqual(layoutFromSettings(row.settings, "org-1"));
    expect(result.current.layout).toEqual(A_LAYOUT);
    expect(result.current.draft).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
    expect(result.current.canEdit).toBe(true);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("uses defaults when settings have no entry for this organization", async () => {
    const { result } = setup();
    await resolveRead(0, rowWith("org-elsewhere", A_LAYOUT));
    expect(result.current.status).toBe("ready");
    expect(result.current.layout).toEqual(DEFAULTS);
  });

  it("a failed read is an error state: not editable, nothing written; reload retries the read", async () => {
    const { result } = setup();
    await rejectRead(0, new CampaignsPrefsError("read", { message: "boom" }));
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Couldn't load saved columns.");
    expect(result.current.canEdit).toBe(false);
    expect(result.current.layout).toEqual(DEFAULTS);

    act(() => result.current.beginEdit());
    expect(result.current.draft).toBeNull();
    let saved: boolean | undefined;
    await act(async () => { saved = await result.current.save(); });
    expect(saved).toBe(false);
    expect(h.write).not.toHaveBeenCalled();

    act(() => result.current.reload());
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("loading");
    await resolveRead(1, rowWith("org-1", A_LAYOUT));
    expect(result.current.status).toBe("ready");
    expect(result.current.layout).toEqual(A_LAYOUT);
    expect(result.current.canEdit).toBe(true);
  });

  it("wraps an unknown read failure as the read error message (raw provider text never shown)", async () => {
    const { result } = setup();
    await rejectRead(0, new Error("PGRST116 internal details"));
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Couldn't load saved columns.");
  });
});

describe("useCampaignsTablePrefs — View As (enabled = false)", () => {
  it("never reads or writes, cannot edit, and save/reset resolve false", async () => {
    const { result } = setup({ ...PROPS, enabled: false });
    expect(h.read).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    expect(result.current.canEdit).toBe(false);
    expect(result.current.layout).toEqual(DEFAULTS);

    act(() => result.current.beginEdit());
    expect(result.current.draft).toBeNull();
    let saved: boolean | undefined;
    let reset: boolean | undefined;
    await act(async () => { saved = await result.current.save(); });
    await act(async () => { reset = await result.current.reset(); });
    expect(saved).toBe(false);
    expect(reset).toBe(false);
    act(() => result.current.reload());
    expect(h.read).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
  });

  it("starting View As after load stops editing; ending it reads again", async () => {
    const { result, rerender } = await setupReady();
    expect(result.current.canEdit).toBe(true);
    rerender({ ...PROPS, enabled: false });
    expect(result.current.canEdit).toBe(false);
    act(() => result.current.beginEdit());
    expect(result.current.draft).toBeNull();
    let saved: boolean | undefined;
    await act(async () => { saved = await result.current.save(); });
    expect(saved).toBe(false);
    expect(h.write).not.toHaveBeenCalled();

    rerender(PROPS);
    expect(h.read).toHaveBeenCalledTimes(2);
    await resolveRead(1, rowWith("org-1", B_LAYOUT));
    expect(result.current.layout).toEqual(B_LAYOUT);
    expect(result.current.canEdit).toBe(true);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("the isCurrent guard handed to a write turns false as soon as View As starts", async () => {
    const { result, rerender } = await setupReady();
    act(() => result.current.beginEdit());
    act(() => { void result.current.save(); });
    const { isCurrent } = h.writes[0].params;
    expect(isCurrent()).toBe(true);
    rerender({ ...PROPS, enabled: false });
    expect(isCurrent()).toBe(false);
  });
});

describe("useCampaignsTablePrefs — draft editing", () => {
  it("beginEdit copies the saved layout; setDraft normalizes and previews; cancel restores saved; nothing is written", async () => {
    const { result } = await setupReady();

    // setDraft without an open editor is ignored.
    act(() => result.current.setDraft(B_LAYOUT));
    expect(result.current.draft).toBeNull();
    expect(result.current.layout).toEqual(A_LAYOUT);

    act(() => result.current.beginEdit());
    expect(result.current.draft).toEqual(A_LAYOUT);
    expect(result.current.layout).toEqual(A_LAYOUT);

    const partial = { order: ["agents", "status"], hidden: [] } as unknown as ColumnLayout;
    act(() => result.current.setDraft(partial));
    expect(result.current.draft).toEqual(normalizeColumnLayout(partial));
    expect(result.current.layout).toEqual(normalizeColumnLayout(partial));

    act(() => result.current.cancel());
    expect(result.current.draft).toBeNull();
    expect(result.current.layout).toEqual(A_LAYOUT);
    expect(h.write).not.toHaveBeenCalled();
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it("reload is a no-op while editing", async () => {
    const { result } = await setupReady();
    act(() => result.current.beginEdit());
    act(() => result.current.reload());
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(result.current.draft).toEqual(A_LAYOUT);
  });
});

describe("useCampaignsTablePrefs — save / reset", () => {
  it("save sends the normalized draft, is busy until acknowledged, then commits saved and clears the draft", async () => {
    const { result } = await setupReady();
    act(() => result.current.beginEdit());
    const edited = { order: ["contacted", "status"], hidden: ["status"] } as unknown as ColumnLayout;
    act(() => result.current.setDraft(edited));

    let completion!: Promise<boolean>;
    act(() => { completion = result.current.save(); });
    expect(h.write).toHaveBeenCalledTimes(1);
    const params = h.writes[0].params;
    expect(params).toEqual({
      userId: "user-1",
      orgId: "org-1",
      layout: normalizeColumnLayout(edited),
      isCurrent: expect.any(Function),
    });
    expect(params.isCurrent()).toBe(true);
    expect(result.current.busy).toBe(true);
    expect(result.current.canEdit).toBe(false);
    // Still previewing the draft; nothing committed yet.
    expect(result.current.layout).toEqual(normalizeColumnLayout(edited));

    // A second save while busy sends nothing.
    let second: boolean | undefined;
    await act(async () => { second = await result.current.save(); });
    expect(second).toBe(false);
    expect(h.write).toHaveBeenCalledTimes(1);

    const acknowledged = normalizeColumnLayout(edited);
    await resolveWrite(0, acknowledged);
    expect(await completion).toBe(true);
    expect(result.current.draft).toBeNull();
    expect(result.current.layout).toEqual(acknowledged);
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe("ready");
    expect(result.current.canEdit).toBe(true);
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it("save without an open draft sends nothing", async () => {
    const { result } = await setupReady();
    let saved: boolean | undefined;
    await act(async () => { saved = await result.current.save(); });
    expect(saved).toBe(false);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("a failed save keeps the draft and shows the error; a retry can then succeed", async () => {
    const { result } = await setupReady();
    act(() => result.current.beginEdit());
    act(() => result.current.setDraft(B_LAYOUT));

    let completion!: Promise<boolean>;
    act(() => { completion = result.current.save(); });
    await rejectWrite(0, new CampaignsPrefsError("conflict"));
    expect(await completion).toBe(false);
    expect(result.current.draft).toEqual(B_LAYOUT);
    expect(result.current.layout).toEqual(B_LAYOUT);
    expect(result.current.error).toBe("Your columns changed elsewhere. Try again.");
    expect(result.current.busy).toBe(false);
    expect(result.current.canEdit).toBe(true);

    act(() => { completion = result.current.save(); });
    await rejectWrite(1, new Error("raw network text"));
    expect(await completion).toBe(false);
    expect(result.current.error).toBe("Couldn't save columns. Try again.");
    expect(result.current.draft).toEqual(B_LAYOUT);

    act(() => { completion = result.current.save(); });
    expect(result.current.error).toBeNull();
    await resolveWrite(2, B_LAYOUT);
    expect(await completion).toBe(true);
    expect(result.current.layout).toEqual(B_LAYOUT);
    expect(result.current.draft).toBeNull();
  });

  it("reset sends layout null and commits the returned defaults", async () => {
    const { result } = await setupReady();
    act(() => result.current.beginEdit());
    act(() => result.current.setDraft(B_LAYOUT));

    let completion!: Promise<boolean>;
    act(() => { completion = result.current.reset(); });
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(h.writes[0].params).toEqual({ userId: "user-1", orgId: "org-1", layout: null, isCurrent: expect.any(Function) });

    await resolveWrite(0, DEFAULTS);
    expect(await completion).toBe(true);
    expect(result.current.layout).toEqual(DEFAULTS);
    expect(result.current.draft).toBeNull();
  });
});

describe("useCampaignsTablePrefs — identity switch", () => {
  it.each<[string, Props]>([
    ["user", { ...PROPS, userId: "user-2" }],
    ["organization", { ...PROPS, orgId: "org-2" }],
  ])("masks the previous owner's layout and draft on the very first render after a %s switch", async (_label, next) => {
    const { result, rerender } = await setupReady(A_LAYOUT);
    act(() => result.current.beginEdit());
    act(() => result.current.setDraft(B_LAYOUT));
    expect(result.current.layout).toEqual(B_LAYOUT);

    const before = renders.length;
    rerender(next);
    const first = renders[before];
    expect(first).toMatchObject({ userId: next.userId, orgId: next.orgId });
    expect(first.layout).toEqual(DEFAULTS);
    expect(first.draft).toBeNull();
    expect(first.status).toBe("loading");
    expect(first.canEdit).toBe(false);
    for (const snap of renders.slice(before)) {
      expect(snap.layout).toEqual(DEFAULTS);
      expect(snap.draft).toBeNull();
    }
    // The previous owner's read was aborted and the new owner's read started.
    expect(h.reads[0].signal?.aborted).toBe(true);
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.read).toHaveBeenLastCalledWith(next.userId, expect.any(AbortSignal));
    expect(h.write).not.toHaveBeenCalled();
  });

  it("discards a late read result from the previous owner (including after switching back)", async () => {
    const { result, rerender } = setup();
    rerender({ ...PROPS, userId: "user-2" });
    expect(h.reads.map((r) => r.userId)).toEqual(["user-1", "user-2"]);

    await resolveRead(0, rowWith("org-1", A_LAYOUT));
    expect(result.current.status).toBe("loading");
    expect(result.current.layout).toEqual(DEFAULTS);

    // A → B → A: the first A read belongs to an earlier epoch and is still discarded.
    rerender(PROPS);
    expect(h.reads.map((r) => r.userId)).toEqual(["user-1", "user-2", "user-1"]);
    await resolveRead(1, rowWith("org-1", B_LAYOUT));
    expect(result.current.status).toBe("loading");
    expect(result.current.layout).toEqual(DEFAULTS);

    await resolveRead(2, rowWith("org-1", B_LAYOUT));
    expect(result.current.status).toBe("ready");
    expect(result.current.layout).toEqual(B_LAYOUT);
    // The discarded A_LAYOUT read never reached any render.
    expect(renders.some((r) => JSON.stringify(r.layout) === JSON.stringify(A_LAYOUT))).toBe(false);
    expect(renders.filter((r) => r.status === "ready").every((r) => r.userId === "user-1")).toBe(true);
  });

  it("discards a late read failure from the previous owner", async () => {
    const { result, rerender } = setup();
    rerender({ ...PROPS, userId: "user-2" });
    await rejectRead(0, new CampaignsPrefsError("read"));
    expect(result.current.status).toBe("loading");
    expect(result.current.error).toBeNull();
    await resolveRead(1, rowWith("org-1", B_LAYOUT));
    expect(result.current.status).toBe("ready");
    expect(result.current.layout).toEqual(B_LAYOUT);
  });

  it("discards a late save result from the previous owner; it never reaches the new owner's state", async () => {
    const { result, rerender } = await setupReady(A_LAYOUT);
    act(() => result.current.beginEdit());
    act(() => result.current.setDraft(B_LAYOUT));
    let completion!: Promise<boolean>;
    act(() => { completion = result.current.save(); });
    const { isCurrent } = h.writes[0].params;

    rerender({ ...PROPS, userId: "user-2" });
    expect(isCurrent()).toBe(false);
    await resolveRead(1, rowWith("org-1", DEFAULTS));
    expect(result.current.status).toBe("ready");

    await resolveWrite(0, B_LAYOUT);
    expect(await completion).toBe(false);
    expect(result.current.layout).toEqual(DEFAULTS);
    expect(result.current.draft).toBeNull();
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.canEdit).toBe(true);
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it("discards a late save failure (or supersession) from the previous owner", async () => {
    const { result, rerender } = await setupReady(A_LAYOUT);
    act(() => result.current.beginEdit());
    let first!: Promise<boolean>;
    act(() => { first = result.current.save(); });
    rerender({ ...PROPS, orgId: "org-2" });
    await resolveRead(1, rowWith("org-2", B_LAYOUT));

    await rejectWrite(0, new CampaignsPrefsSupersededError());
    expect(await first).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.layout).toEqual(B_LAYOUT);

    // A different failure kind after the switch is also dropped.
    rerender(PROPS);
    await resolveRead(2, rowWith("org-1", A_LAYOUT));
    act(() => result.current.beginEdit());
    let second!: Promise<boolean>;
    act(() => { second = result.current.save(); });
    rerender({ ...PROPS, userId: "user-3" });
    await rejectWrite(1, new CampaignsPrefsError("write"));
    expect(await second).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe("loading");
    expect(result.current.layout).toEqual(DEFAULTS);
  });

  it("signing out (no user) shows idle defaults and drops the previous owner's state", async () => {
    const { result, rerender } = await setupReady(A_LAYOUT);
    rerender({ ...PROPS, userId: null });
    expect(result.current.status).toBe("idle");
    expect(result.current.layout).toEqual(DEFAULTS);
    expect(result.current.canEdit).toBe(false);
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it("ignores results that arrive after unmount", async () => {
    const { result, unmount } = setup();
    unmount();
    await resolveRead(0, rowWith("org-1", A_LAYOUT));
    expect(result.current.status).toBe("loading");
    expect(h.write).not.toHaveBeenCalled();
  });
});
