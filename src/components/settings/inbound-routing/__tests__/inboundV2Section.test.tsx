// Corrective pass, defect 6 — the v2 administrator card reports the loaded engine to its parent WITHOUT
// letting the parent's callback identity drive its own data loading: a parent re-render (an inline
// arrow prop is a new function every render) must not refetch and must not discard an unsaved edit.
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ fromCalls: 0, engine: "v2" as "legacy" | "v2" }));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("framer-motion", () => ({ motion: { div: (p: React.HTMLAttributes<HTMLDivElement>) => <div {...p} /> } }));
vi.mock("@/integrations/supabase/client", () => {
  // Minimal thenable PostgREST-style builder: every chain resolves to the table's rows.
  const rows = (table: string): unknown => {
    if (table === "inbound_routing_settings") {
      return { routing_engine: db.engine, inbound_group_agent_ids: ["a1"], browser_ring_seconds: 20, mobile_ring_seconds: 20, voicemail_retention_days: 30 };
    }
    if (table === "profiles") return [{ id: "a1", first_name: "Ann", last_name: "A", twilio_client_identity: "agent_a1", status: "Active" }];
    return [];
  };
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = self; b.eq = self; b.order = self; b.update = self;
    b.maybeSingle = async () => ({ data: rows(table), error: null });
    b.then = (resolve: (v: unknown) => void) => resolve({ data: rows(table), error: null });
    return b;
  };
  return {
    supabase: {
      from: (table: string) => { db.fromCalls += 1; return builder(table); },
      rpc: async () => ({ data: null, error: null }),
    },
  };
});

import { InboundV2Section } from "@/components/settings/inbound-routing/InboundV2Section";

const onEngine = vi.fn();
const Parent: React.FC = () => {
  const [n, setN] = useState(0);
  return (
    <div>
      <button onClick={() => setN((x) => x + 1)}>rerender-parent</button>
      <span data-testid="parent-renders">{n}</span>
      {/* inline arrow on purpose: a fresh function identity on every parent render */}
      <InboundV2Section organizationId="org-1" onEngineChange={(engine) => onEngine(engine)} />
    </div>
  );
};

beforeEach(() => { db.fromCalls = 0; db.engine = "v2"; onEngine.mockReset(); });
afterEach(cleanup);

describe("InboundV2Section — engine report vs. its own loading", () => {
  it("reports the loaded engine once and keeps an unsaved edit across a parent re-render without refetching", async () => {
    render(<Parent />);
    const ring = (await screen.findByLabelText(/browser ring/i)) as HTMLInputElement;
    await waitFor(() => expect(ring.value).toBe("20"));
    await waitFor(() => expect(onEngine).toHaveBeenCalledWith("v2"));
    const loadsAfterMount = db.fromCalls;
    expect(loadsAfterMount).toBe(4); // one load = four reads

    fireEvent.change(ring, { target: { value: "25" } });
    expect(ring.value).toBe("25");

    fireEvent.click(screen.getByText("rerender-parent"));
    await waitFor(() => expect(screen.getByTestId("parent-renders").textContent).toBe("1"));
    fireEvent.click(screen.getByText("rerender-parent"));
    await waitFor(() => expect(screen.getByTestId("parent-renders").textContent).toBe("2"));

    // No refetch (which would have reset the field to the stored 20) and the draft survives.
    expect(db.fromCalls).toBe(loadsAfterMount);
    expect((screen.getByLabelText(/browser ring/i) as HTMLInputElement).value).toBe("25");
    expect(onEngine).toHaveBeenCalledTimes(1);
  });
});
