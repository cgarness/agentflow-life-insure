/**
 * Call Forwarding (implementation_plan.md §19.2) — the feature moved out of its own My Profile card
 * into Preferences. The storage contract is unchanged: self-owned `agent_inbound_settings`, keyed on
 * agent_id, scoped by the REAL operator's organization, hidden and inert under "View As". A stored
 * recorded-greeting link survives a save even though the field is no longer shown.
 */
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ isImpersonating: false }));
const agent = vi.hoisted(() => ({ engine: "v2" as string, activationPending: false }));
const db = vi.hoisted(() => ({
  row: {
    mobile_forward_number: "+15551234567",
    mobile_forward_enabled: true,
    voicemail_greeting_text: "Leave a message.",
    voicemail_greeting_url: "https://cdn.example.com/greeting.mp3",
  } as Record<string, unknown> | null,
  selects: [] as string[],
  upserts: [] as Array<{ table: string; payload: Record<string, unknown>; options: unknown }>,
  upsertError: null as { message: string } | null,
}));

const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1" },
    realProfile: { id: "u1", organization_id: "org-1" },
    isImpersonating: auth.isImpersonating,
  }),
}));
vi.mock("@/contexts/AgentStatusContext", () => ({
  useAgentStatus: () => ({ activationPending: agent.activationPending, engine: agent.engine }),
}));
vi.mock("@/contexts/UnsavedChangesContext", () => ({ useUnsavedChanges: () => ({ registerDirty: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = (cols: string) => { db.selects.push(cols); return builder; };
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({ data: db.row, error: null });
      builder.upsert = async (payload: Record<string, unknown>, options: unknown) => {
        db.upserts.push({ table, payload, options });
        return { error: db.upsertError };
      };
      return builder;
    },
  },
}));

import { ProfileCallForwardingSection } from "@/components/settings/profile/ProfileCallForwardingSection";

const loaded = async () => {
  render(<ProfileCallForwardingSection />);
  await waitFor(() => expect(screen.getByLabelText(/mobile number/i)).toBeTruthy());
};
const save = () => fireEvent.click(screen.getByRole("button", { name: /save call forwarding/i }));

beforeEach(() => {
  vi.clearAllMocks();
  auth.isImpersonating = false;
  agent.engine = "v2";
  agent.activationPending = false;
  db.row = {
    mobile_forward_number: "+15551234567",
    mobile_forward_enabled: true,
    voicemail_greeting_text: "Leave a message.",
    voicemail_greeting_url: "https://cdn.example.com/greeting.mp3",
  };
  db.selects = [];
  db.upserts = [];
  db.upsertError = null;
});
afterEach(cleanup);

describe("loading existing settings", () => {
  it("shows the stored number, toggle state and greeting", async () => {
    await loaded();
    expect((screen.getByLabelText(/mobile number/i) as HTMLInputElement).value).toBe("+15551234567");
    expect((screen.getByLabelText(/voicemail greeting/i) as HTMLTextAreaElement).value).toBe("Leave a message.");
    expect(screen.getByRole("switch", { name: /forward unanswered calls/i }).getAttribute("data-state")).toBe("checked");
    expect(db.selects[0]).toContain("mobile_forward_number");
  });

  it("an agent with no row yet starts empty and saves nothing until edited", async () => {
    db.row = null;
    render(<ProfileCallForwardingSection />);
    await waitFor(() => expect(screen.getByLabelText(/mobile number/i)).toBeTruthy());
    expect((screen.getByLabelText(/mobile number/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: /save call forwarding/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("persistence — same table, same columns, same keys", () => {
  it("a changed mobile number is normalised and written to agent_inbound_settings", async () => {
    await loaded();
    fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: "(555) 987-6543" } });
    save();
    await waitFor(() => expect(db.upserts).toHaveLength(1));
    const { table, payload, options } = db.upserts[0];
    expect(table).toBe("agent_inbound_settings");
    expect(options).toEqual({ onConflict: "agent_id" });
    expect(payload).toMatchObject({
      agent_id: "u1",
      organization_id: "org-1",
      mobile_forward_number: "+15559876543",
      mobile_forward_enabled: true,
    });
    expect(toastSuccess).toHaveBeenCalledWith("Call forwarding saved.");
  });

  it("the forwarding toggle persists", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("switch", { name: /forward unanswered calls/i }));
    save();
    await waitFor(() => expect(db.upserts).toHaveLength(1));
    expect(db.upserts[0].payload.mobile_forward_enabled).toBe(false);
  });

  it("the voicemail greeting persists, and a stored recorded-greeting link is carried through untouched", async () => {
    await loaded();
    fireEvent.change(screen.getByLabelText(/voicemail greeting/i), { target: { value: "  Hi, it's Chris.  " } });
    save();
    await waitFor(() => expect(db.upserts).toHaveLength(1));
    expect(db.upserts[0].payload.voicemail_greeting_text).toBe("Hi, it's Chris.");
    expect(db.upserts[0].payload.voicemail_greeting_url).toBe("https://cdn.example.com/greeting.mp3");
  });

  it("an emptied greeting is stored as NULL, and an absent link stays NULL", async () => {
    db.row = { mobile_forward_number: "+15551234567", mobile_forward_enabled: true, voicemail_greeting_text: "x", voicemail_greeting_url: null };
    await loaded();
    fireEvent.change(screen.getByLabelText(/voicemail greeting/i), { target: { value: "   " } });
    save();
    await waitFor(() => expect(db.upserts).toHaveLength(1));
    expect(db.upserts[0].payload.voicemail_greeting_text).toBeNull();
    expect(db.upserts[0].payload.voicemail_greeting_url).toBeNull();
  });

  it("a database rejection is surfaced, not swallowed", async () => {
    db.upsertError = { message: "That number is one of your agency's own numbers." };
    await loaded();
    fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: "5551112222" } });
    save();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toMatch(/agency's own numbers/i);
  });
});

describe("validation is inline and blocks the write", () => {
  it("an unusable number shows a field error and never reaches the database", async () => {
    await loaded();
    fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: "12345" } });
    save();
    await waitFor(() => expect(screen.getByTestId("call-forwarding-mobile-error").textContent).toMatch(/valid mobile number/i));
    expect(db.upserts).toHaveLength(0);
    // and it clears as soon as the agent corrects it
    fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: "555-111-2222" } });
    expect(screen.queryByTestId("call-forwarding-mobile-error")).toBeNull();
  });
});

describe("View As protections are unchanged", () => {
  it("renders nothing and touches no data while impersonating", async () => {
    auth.isImpersonating = true;
    const { container } = render(<ProfileCallForwardingSection />);
    expect(container.firstChild).toBeNull();
    expect(db.selects).toHaveLength(0);
    expect(db.upserts).toHaveLength(0);
  });
});

describe("activation messaging stays honest and non-technical", () => {
  it("an active agency shows no banner", async () => {
    await loaded();
    expect(screen.queryByTestId("call-forwarding-pending")).toBeNull();
  });

  it("a not-yet-activated agency is told plainly, with no engine wording", async () => {
    agent.engine = "legacy";
    agent.activationPending = true;
    await loaded();
    const banner = screen.getByTestId("call-forwarding-pending");
    expect(banner.getAttribute("data-engine")).toBe("legacy");
    expect(banner.textContent).toMatch(/isn't available for your agency yet/i);
    expect(banner.textContent).not.toMatch(/engine|routing|v2|twilio/i);
  });

  it("an unconfirmed state is never reported as 'not available'", async () => {
    agent.engine = "unknown";
    agent.activationPending = true;
    await loaded();
    const banner = screen.getByTestId("call-forwarding-pending");
    expect(banner.getAttribute("data-engine")).toBe("unknown");
    expect(banner.textContent).toMatch(/couldn't confirm/i);
    expect(banner.textContent).not.toMatch(/isn't available/i);
  });
});

describe("the surface is plain-language only", () => {
  it("shows no recorded-greeting link field and no engineering wording", async () => {
    await loaded();
    expect(screen.queryByLabelText(/url|https/i)).toBeNull();
    const text = document.body.textContent ?? "";
    for (const jargon of ["E.164", "routing engine", "Twilio", "registration", "presence", "Inbound Calling v2", "provider"]) {
      expect(text.toLowerCase()).not.toContain(jargon.toLowerCase());
    }
  });
});
