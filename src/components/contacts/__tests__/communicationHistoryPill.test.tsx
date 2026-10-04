import React, { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PhoneOutgoing } from "lucide-react";
import { CommunicationHistoryPill } from "../conversation-history/CommunicationHistoryPill";
import { CallHistoryItem } from "../conversation-history/CallHistoryItem";
import { EmailHistoryItem } from "../conversation-history/EmailHistoryItem";
import { buildCallItem, buildEmailItem } from "../conversation-history/conversationTypes";

vi.mock("@/contexts/BrandingContext", () => ({ useBranding: () => ({
  formatDateTime: (date: Date, options?: { hideDate?: boolean }) => options?.hideDate ? "10:30 AM" : date.toISOString(),
}) }));
vi.mock("@/lib/supabase-contacts", () => ({ normalizeDispositionValue: (value: string) => value.trim().toLowerCase() }));
const media = vi.hoisted(() => ({ mounted: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/components/ui/RecordingPlayer", () => ({ RecordingPlayer: ({ callId }: { callId: string }) => {
  useEffect(() => { media.mounted(callId); return () => media.cleanup(callId); }, [callId]);
  return <div>Recording for {callId}</div>;
} }));
vi.mock("@/components/voicemail/VoicemailPlayer", () => ({ VoicemailPlayer: ({ voicemailId }: { voicemailId: string }) => <div>Voicemail for {voicemailId}</div> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function Pill({ outbound = true, timestampKnown = true }: { outbound?: boolean; timestampKnown?: boolean }) {
  return <CommunicationHistoryPill outbound={outbound} label="Outbound Call" detailsLabel="Call details" icon={PhoneOutgoing}
    iconClassName="text-emerald-600" summary={<span>No Answer</span>} timestampMs={Date.parse("2026-10-03T10:30:00Z")} timestampKnown={timestampKnown}>
    <p>Full persisted details</p>
  </CommunicationHistoryPill>;
}

describe("communication info popover", () => {
  it("opens labelled details, closes on Escape and returns focus to the trigger", async () => {
    render(<Pill />);
    const trigger = screen.getByRole("button", { name: "Call details" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Full persisted details")).toBeNull();
    trigger.focus(); fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Call details" });
    expect(within(dialog).getByText("Full persisted details")).toBeVisible();
    expect(trigger).toHaveAttribute("aria-controls", dialog.id);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Full persisted details")).toBeNull());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("dismisses on outside pointer interaction", async () => {
    render(<><button>Outside</button><Pill /></>);
    fireEvent.click(screen.getByRole("button", { name: "Call details" }));
    await screen.findByRole("dialog");
    // Radix installs the document pointer listener on the next event-loop tick.
    await new Promise(resolve => setTimeout(resolve, 0));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }), { pointerType: "mouse" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps unknown dates neutral", () => {
    render(<Pill timestampKnown={false} />);
    expect(screen.getByLabelText("Date not recorded")).not.toHaveAttribute("datetime");
    expect(screen.queryByText("10:30 AM")).toBeNull();
  });

  it("unmounts recording content on close and on contact removal", async () => {
    const item = buildCallItem({ id: "recorded", direction: "outbound", recording_storage_path: "private-path", duration: 42 });
    const view = render(<CallHistoryItem item={item} />);
    expect(media.mounted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Call details" }));
    await waitFor(() => expect(media.mounted).toHaveBeenCalledWith("recorded"));
    fireEvent.click(screen.getByRole("button", { name: "Close call details" }));
    await waitFor(() => expect(media.cleanup).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Call details" }));
    await waitFor(() => expect(media.mounted).toHaveBeenCalledTimes(2));
    view.unmount();
    expect(media.cleanup).toHaveBeenCalledTimes(2);
  });

  it("keeps missed/forwarded truth inline and all attribution and voicemail in details", async () => {
    const item = buildCallItem({ id: "inbound", direction: "inbound", status: "completed", is_missed: true,
      outcome: "forwarded_answered", missed_reason: "forwarded_to_mobile", disposition_name: "Appointment Set",
      routed_agent_ids: ["agent"], answered_by_agent_id: "agent", voicemail_id: "vm", notes: "Persisted note", duration: 51,
    }, { profiles: new Map([["agent", "Original Agent"]]), campaigns: new Map() });
    render(<CallHistoryItem item={item} />);
    expect(screen.getByText(item.inboundOutcomeLabel!)).toBeVisible();
    expect(screen.queryByText("Original Agent")).toBeNull();
    expect(screen.queryByText("Voicemail for vm")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Call details" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("Original Agent").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Appointment Set")).toBeVisible();
    expect(within(dialog).getByText("0:51")).toBeVisible();
    expect(within(dialog).getByText("Persisted note")).toBeVisible();
    expect(within(dialog).getByText("Voicemail for vm")).toBeVisible();
  });

  it("shows the authoritative inbound answer label without substituting parent completion", () => {
    render(<CallHistoryItem item={buildCallItem({ id: "answered", direction: "inbound", status: "completed", agent_id: "agent" })} />);
    expect(screen.getByText("Answered in AgentFlow")).toBeVisible();
    expect(screen.queryByText("completed")).toBeNull();
  });

  it("keeps complete inbound email content and endpoints in the popover as escaped text", async () => {
    const item = buildEmailItem({ id: "mail", direction: "inbound", subject: "Full subject", body_text: "<script>neverRun()</script>\nEntire body",
      from_email: "sender@example.com", to_emails: ["agent@example.com"], cc_emails: ["cc@example.com"], delivery_status: "received" });
    render(<EmailHistoryItem item={item} />);
    expect(screen.getByText("Inbound Email")).toBeVisible();
    expect(screen.getByText("received")).toBeVisible();
    expect(screen.queryByText("Full subject")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Email details" }));
    const dialog = await screen.findByRole("dialog", { name: "Email details" });
    for (const text of ["Full subject", "<script>neverRun()</script>", "Entire body", "sender@example.com", "agent@example.com", "cc@example.com"]) {
      expect(within(dialog).getByText(text)).toBeVisible();
    }
    expect(dialog.querySelector("script")).toBeNull();
  });
});
