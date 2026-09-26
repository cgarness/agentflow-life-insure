import React, { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLeaderboardAvatars } from "@/hooks/useLeaderboardAvatars";
import { resetLeaderboardAvatarCache } from "@/lib/leaderboardAvatarCache";
import { resetLeaderboardRequestGates } from "@/lib/leaderboardRequestGate";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; columns: string; org: string; ids: string[]; signal: AbortSignal }>,
  hold: false,
  pending: [] as Array<(v: { data: Array<{ id: string; avatar_url: string }>; error: null }) => void>,
  auth: null as null | ((event: string, session: { user: { id: string } } | null) => void),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { onAuthStateChange: (callback: typeof h.auth) => {
    h.auth = callback; return { data: { subscription: { unsubscribe: () => { h.auth = null; } } } };
  } },
  from: (table: string) => {
    const read = { table, columns: "", org: "", ids: [] as string[], signal: new AbortController().signal };
    const q = {
      select: (columns: string) => { read.columns = columns; return q; },
      eq: (column: string, org: string) => { if (column !== "organization_id") throw Error(column); read.org = org; return q; },
      in: (column: string, ids: string[]) => { if (column !== "id") throw Error(column); read.ids = ids; return q; },
      abortSignal: (signal: AbortSignal) => { read.signal = signal; return q; },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        h.calls.push(read);
        const value = { data: read.ids.map(id => ({ id, avatar_url: `${read.org}:${id}` })), error: null as null };
        return (h.hold ? new Promise<typeof value>(r => h.pending.push(r)) : Promise.resolve(value)).then(resolve, reject);
      },
    }; return q;
  },
} }));

function Probe({ user = "user", org = "org", enabled = true, at = 1, ids = ["a"] }: {
  user?: string | null; org?: string | null; enabled?: boolean; at?: number | null; ids?: string[];
}) {
  const photos = useLeaderboardAvatars(user, org, ids, ids, enabled, at);
  return <output>{photos.get("a") ?? "initials"}</output>;
}
beforeEach(() => {
  h.calls.length = 0; h.pending.length = 0; h.hold = false;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
afterEach(() => { cleanup(); resetLeaderboardAvatarCache(); resetLeaderboardRequestGates(); });

describe("photo lifecycle and protected query", () => {
  it("loads only id/avatar under the explicit org and requested IDs, joining StrictMode consumers", async () => {
    render(<StrictMode><Probe /><Probe /></StrictMode>);
    await waitFor(() => expect(screen.getAllByText("org:a")).toHaveLength(2));
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ table: "profiles", columns: "id,avatar_url", org: "org", ids: ["a"] });
  });

  it("new arrays/refresh triggers reuse fresh photos across unmount and navigation", async () => {
    const view = render(<Probe />); await screen.findByText("org:a");
    view.rerender(<Probe at={2} ids={["a"]} />);
    view.unmount(); render(<Probe at={3} />);
    await screen.findByText("org:a"); expect(h.calls).toHaveLength(1);
  });

  it("maintenance and missing identity never start a photo query", async () => {
    const view = render(<Probe enabled={false} />);
    await act(async () => { await Promise.resolve(); });
    view.rerender(<Probe org={null} />);
    await act(async () => { await Promise.resolve(); });
    expect(h.calls).toHaveLength(0);
    expect(screen.getByText("initials")).toBeInTheDocument();
  });

  it("navigation through an unloaded roster preserves photos until the new standings arrive", async () => {
    const first = render(<Probe />); await screen.findByText("org:a"); first.unmount();
    const next = render(<Probe ids={[]} at={null} enabled={false} />);
    next.rerender(<Probe ids={["a"]} at={2} />);
    await screen.findByText("org:a"); expect(h.calls).toHaveLength(1);
    next.rerender(<Probe ids={[]} at={3} />); // Successful empty is genuinely empty.
    next.rerender(<Probe ids={["a"]} at={null} enabled={false} />);
    expect(screen.getByText("initials")).toBeInTheDocument();
  });

  it("waits through an offline mount, then loads current demand once", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    render(<Probe />); await act(async () => { await Promise.resolve(); });
    expect(h.calls).toHaveLength(0);
    await act(async () => {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("online"));
    });
    await screen.findByText("org:a"); expect(h.calls).toHaveLength(1);
  });

  it("an org switch immediately hides old photos and rejects a late old response", async () => {
    h.hold = true;
    const view = render(<Probe />); await waitFor(() => expect(h.calls).toHaveLength(1));
    h.hold = false;
    view.rerender(<Probe org="other" />);
    expect(screen.getByText("initials")).toBeInTheDocument();
    expect(h.calls[0].signal.aborted).toBe(true);
    await screen.findByText("other:a");
    await act(async () => { h.pending[0]({ data: [{ id: "a", avatar_url: "old-secret" }], error: null }); });
    expect(screen.queryByText("old-secret")).toBeNull();
    expect(screen.getByText("other:a")).toBeInTheDocument();
  });

  it("sign-out purges images even without changing the consumer's props", async () => {
    render(<Probe />); await screen.findByText("org:a");
    act(() => h.auth?.("SIGNED_OUT", null));
    expect(screen.getByText("initials")).toBeInTheDocument();
  });
});
