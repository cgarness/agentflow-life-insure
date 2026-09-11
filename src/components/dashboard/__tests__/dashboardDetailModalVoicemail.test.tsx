/**
 * Corrective pass, defect 7 — the dashboard "Missed Calls" drill-down selects `voicemail_id` and renders the
 * voicemail player from that id alone: an UNLINKED caller (no contact row) can be listened to, a missed call
 * without a voicemail gets no player.
 */
import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ selects: [] as string[] }));
const ROWS = [
  { id: "call-1", contact_name: null, contact_id: null, contact_type: null, contact_phone: "+15550001111", created_at: "2026-09-11T09:00:00Z", disposition_name: null, direction: "inbound", is_missed: true, missed_reason: "no_answer", outcome: "voicemail", agent_id: null, answered_by_agent_id: null, voicemail_id: "vm-1" },
  { id: "call-2", contact_name: "Linked Lead", contact_id: "lead-1", contact_type: "lead", contact_phone: "+15550002222", created_at: "2026-09-11T08:00:00Z", disposition_name: null, direction: "inbound", is_missed: true, missed_reason: "no_answer", outcome: "missed", agent_id: null, answered_by_agent_id: null, voicemail_id: null },
];

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("react-router-dom", () => ({ useNavigate: () => () => {} }));
vi.mock("framer-motion", () => ({
  motion: { div: (p: React.HTMLAttributes<HTMLDivElement>) => <div {...p} /> },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, profile: { id: "u1", organization_id: "org-1" }, realProfile: { id: "u1", organization_id: "org-1" } }) }));
vi.mock("@/components/voicemail/VoicemailPlayer", () => ({ VoicemailPlayer: ({ voicemailId }: { voicemailId: string }) => <div data-testid="vm-player" data-id={voicemailId} /> }));
vi.mock("@/lib/dashboard-contact-identity", async (orig) => ({ ...(await orig<Record<string, unknown>>()), resolveContactTypesByIds: async () => new Map() }));
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = (cols: string) => { db.selects.push(`${table}:${cols}`); return b; };
    b.eq = self; b.gte = self; b.lt = self; b.in = self; b.or = self; b.order = self; b.range = self; b.limit = self;
    b.then = (resolve: (v: unknown) => void) => resolve({ data: table === "calls" ? ROWS : [], error: null });
    return b;
  };
  return { supabase: { from: (table: string) => builder(table) } };
});

import DashboardDetailModal from "@/components/dashboard/DashboardDetailModal";

beforeEach(() => { db.selects = []; });
afterEach(cleanup);

describe("DashboardDetailModal — missed calls with voicemail", () => {
  it("selects voicemail_id and renders the player for an UNLINKED caller; a call without a voicemail gets none", async () => {
    render(<DashboardDetailModal isOpen onClose={() => {}} type="missed_calls" userId="u1" role="Admin" adminToggle="team" />);
    await waitFor(() => expect(screen.getAllByTestId("vm-player")).toHaveLength(1));
    expect(screen.getByTestId("vm-player").getAttribute("data-id")).toBe("vm-1");
    expect(screen.getByText("+15550001111")).toBeTruthy();        // the unlinked caller's row
    expect(screen.getByText("Linked Lead")).toBeTruthy();          // rendered, but no player
    const callsSelect = db.selects.find((s) => s.startsWith("calls:"));
    expect(callsSelect).toBeTruthy();
    expect(callsSelect).toMatch(/\bvoicemail_id\b/);
  });
});
