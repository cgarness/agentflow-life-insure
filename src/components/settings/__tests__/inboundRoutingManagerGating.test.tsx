/**
 * Corrective pass, defect 6 — the legacy routing controls are RETIRED exactly when Inbound Calling v2 is the
 * active engine: the strategy radios and the fallback fieldset are disabled, the notice is shown, and a save
 * never writes the retired fields (routing strategy, fallback chain, fallback action, forwarding number) —
 * while business hours, after-hours SMS and the organization greeting still save.
 */
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  engine: "v2" as "v2" | "legacy",
  writes: [] as Array<{ table: string; op: string; payload: unknown }>,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("framer-motion", () => ({ motion: { div: (p: React.HTMLAttributes<HTMLDivElement>) => <div {...p} /> } }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));
vi.mock("@/components/settings/inbound-routing/InboundV2Section", () => ({ InboundV2Section: () => <div data-testid="v2-section" /> }));
vi.mock("@/components/settings/inbound-routing/FallbackChainSection", () => ({ FallbackChainSection: () => <div data-testid="fallback-chain" /> }));
vi.mock("@/integrations/supabase/client", () => {
  const rowFor = (table: string): { data: unknown; count?: number } => {
    if (table === "inbound_routing_settings") {
      return { data: { id: "rt-1", routing_engine: db.engine, routing_mode: "assigned", auto_create_lead: true, after_hours_sms_enabled: false, after_hours_sms: "", voicemail_enabled: true, fallback_action: "voicemail", voicemail_greeting_text: "Hi", voicemail_greeting_url: "", forwarding_number: "", inbound_fallback_chain: ["last_agent"] } };
    }
    if (table === "agent_state_licenses") return { data: null, count: 0 };
    return { data: [] };
  };
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = self; b.eq = self; b.order = self;
    b.upsert = (payload: unknown) => { db.writes.push({ table, op: "upsert", payload }); return b; };
    b.update = (payload: unknown) => { db.writes.push({ table, op: "update", payload }); return b; };
    b.insert = (payload: unknown) => { db.writes.push({ table, op: "insert", payload }); return b; };
    b.maybeSingle = async () => ({ data: rowFor(table).data, error: null });
    b.then = (resolve: (v: unknown) => void) => resolve({ ...rowFor(table), error: null });
    return b;
  };
  return { supabase: { from: (table: string) => builder(table) } };
});

import InboundRoutingManager from "@/components/settings/InboundRoutingManager";

beforeEach(() => { db.engine = "v2"; db.writes = []; });
afterEach(cleanup);

const rendered = async () => {
  render(<InboundRoutingManager />);
  await waitFor(() => expect(screen.getByRole("button", { name: /save changes/i })).toBeTruthy());
};
const radios = () => screen.getAllByRole("radio");
const settingsWrite = () => db.writes.find((w) => w.table === "inbound_routing_settings")?.payload as Record<string, unknown> | undefined;

describe("InboundRoutingManager — legacy controls retire with the ACTIVE engine", () => {
  it("v2 active: notice shown, strategy radios and fallback fieldset disabled, retired fields never written on save", async () => {
    await rendered();
    expect(screen.getByTestId("legacy-controls-retired")).toBeTruthy();
    expect((screen.getByTestId("legacy-routing-controls") as HTMLFieldSetElement).disabled).toBe(true);
    expect(radios().length).toBeGreaterThan(0);
    for (const r of radios()) expect((r as HTMLButtonElement).disabled || r.getAttribute("aria-disabled") === "true" || r.getAttribute("data-disabled") !== null).toBe(true);

    // the organization voicemail greeting is NOT retired: v2 plays it (group voicemail, agent fallback)
    const greeting = screen.getByTestId("v2-org-greeting") as HTMLTextAreaElement;
    expect(greeting.disabled).toBe(false);
    fireEvent.change(greeting, { target: { value: "Thanks for calling — leave a message." } });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(settingsWrite()).toBeTruthy());
    const payload = settingsWrite()!;
    expect(payload).toHaveProperty("voicemail_greeting_text", "Thanks for calling — leave a message.");
    for (const retired of ["routing_mode", "fallback_action", "forwarding_number", "inbound_fallback_chain"]) expect(payload).not.toHaveProperty(retired);
    for (const live of ["after_hours_sms_enabled", "after_hours_sms", "auto_create_lead", "voicemail_greeting_text", "voicemail_enabled"]) expect(payload).toHaveProperty(live);
    expect(db.writes.some((w) => w.table === "business_hours" && w.op === "upsert")).toBe(true);
  });

  it("legacy active: no notice, controls enabled, the strategy IS written on save", async () => {
    db.engine = "legacy";
    await rendered();
    expect(screen.queryByTestId("legacy-controls-retired")).toBeNull();
    expect(screen.queryByTestId("v2-org-greeting-card")).toBeNull();
    expect((screen.getByTestId("legacy-routing-controls") as HTMLFieldSetElement).disabled).toBe(false);
    for (const r of radios()) expect((r as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(settingsWrite()).toBeTruthy());
    expect(settingsWrite()).toHaveProperty("routing_mode", "assigned");
    expect(settingsWrite()).toHaveProperty("inbound_fallback_chain");
  });
});
