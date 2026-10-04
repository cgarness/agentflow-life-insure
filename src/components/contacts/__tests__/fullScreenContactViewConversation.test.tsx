/**
 * Conversation History (center column) — filters, channel visuals, inline endpoint
 * details, persisted email subject (2026-08-17 build).
 *
 * Root cause pinned by the filter tests: the previous comparison was
 * `item._type === convoFilter.toLowerCase()` with display labels as state, so
 * "Calls".toLowerCase() === "calls" never matched call rows (`_type: "call"`)
 * and the Calls filter always rendered the empty state. SMS/Email lowercase to
 * exact matches, so those two tests double as reproduction checks for the rest
 * of the report.
 *
 * Harness mirrors fullScreenContactViewQuickCall.test.tsx (established FSCV
 * mock pattern); MessageComposePanel is the REAL shared component so the
 * optimistic-email test exercises the actual compose path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";

const tableData: Record<string, unknown> = {};

function makeQuery(table: string) {
  const result = { data: tableData[table] ?? null, error: null };
  const query: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of ["select", "eq", "in", "or", "not", "order", "limit", "gte", "lt", "neq", "is"]) {
    query[method] = () => query;
  }
  query.maybeSingle = () => Promise.resolve(result);
  query.single = () => Promise.resolve(result);
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeQuery(table),
    rpc: (fn: string, args: {p_filter?:string}) => ({abortSignal: async () => {
      if (h.emailsError) return { data: null, error: {message:"Unavailable"} };
      if (fn === 'get_contact_activity_page') return {data:{items:[],hasMore:false,nextCursor:null},error:null};
      const source = [...((tableData.calls ?? []) as Record<string,unknown>[]).map(payload=>({kind:'call',payload})),
        ...((tableData.messages ?? []) as Record<string,unknown>[]).map(payload=>({kind:'sms',payload})),
        ...(h.emails as Record<string,unknown>[]).map(payload=>({kind:'email',payload}))];
      const items=source.filter(x=>!args.p_filter||args.p_filter==='all'||x.kind===args.p_filter).map(x=>({...x,event_key:`${x.kind}:${x.payload.id}`,event_time:x.payload.started_at||x.payload.sent_at||x.payload.received_at||x.payload.created_at})).sort((a,b)=>Date.parse(String(b.event_time))-Date.parse(String(a.event_time)));
      return {data:{items,hasMore:false,nextCursor:null},error:null};
    }}),
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
  },
}));

const h = vi.hoisted(() => ({
  errorToasts: [] as string[],
  emails: [] as Array<Record<string, unknown>>,
  emailsError: false,
  connections: [] as Array<Record<string, unknown>>,
  sentEmails: [] as Array<Record<string, unknown>>,
  sendEmailResult: { success: true } as Record<string, unknown>,
}));

vi.mock("sonner", () => ({
  toast: { error: (msg: string) => h.errorToasts.push(msg), success: vi.fn() },
}));

vi.mock("@/lib/supabase-notes", () => ({ notesSupabaseApi: { getByContact: vi.fn(async () => []) } }));
vi.mock("@/lib/supabase-activities", () => ({
  activitiesSupabaseApi: { getByContact: vi.fn(async () => []), add: vi.fn(async () => ({ id: "a1" })) },
}));
vi.mock("@/lib/supabase-settings", () => ({
  pipelineSupabaseApi: { getLeadStages: vi.fn(async () => []), getRecruitStages: vi.fn(async () => []) },
  customFieldsSupabaseApi: { getAll: vi.fn(async () => []) },
  leadSourcesSupabaseApi: { getAll: vi.fn(async () => []) },
}));
vi.mock("@/lib/supabase-email", () => ({
  emailSupabaseApi: {
    getMyConnections: vi.fn(async () => h.connections),
    getContactEmails: vi.fn(async () => {
      if (h.emailsError) throw new Error("contact_emails fetch failed");
      return h.emails;
    }),
    sendContactEmail: vi.fn(async (payload: Record<string, unknown>) => {
      h.sentEmails.push(payload);
      if(h.sendEmailResult.success) h.emails.push({...payload,id:'saved-email',direction:'outbound',from_email:payload.from_email,to_emails:[payload.to_email],sent_at:new Date().toISOString(),delivery_status:'sent'});
      return h.sendEmailResult;
    }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, profile: { id: "user-1", first_name: "Alexa", last_name: "Segura" } }),
}));
vi.mock("@/contexts/CalendarContext", () => ({ useCalendar: () => ({ addAppointment: vi.fn() }) }));
vi.mock("@/contexts/SidebarContext", () => ({ useSidebarContext: () => ({ collapsed: false }) }));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({
    formatDate: (v: unknown) => String(v),
    formatDateTime: (v: unknown) => String(v),
    branding: { companyName: "AgentFlow" },
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ hasContactsPermission: () => true }) }));
vi.mock("@/components/calendar/AppointmentModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/followups/ContactFollowUpsCard", () => ({ ContactFollowUpsCard: () => null }));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/messaging/MessageTemplatesPickerModal", () => ({ MessageTemplatesPickerModal: () => null }));
vi.mock("./TasksPanel", () => ({ TasksPanel: () => null }));
vi.mock("@/components/ui/RecordingPlayer", () => ({
  RecordingPlayer: ({ callId }: { callId: string }) => <div data-testid="recording-player">{`player:${callId}`}</div>,
}));
vi.mock("@/components/voicemail/VoicemailPlayer", () => ({
  VoicemailPlayer: ({ voicemailId }: { voicemailId: string }) => <div data-testid="voicemail-player">{`voicemail:${voicemailId}`}</div>,
}));

import FullScreenContactView from "@/components/contacts/FullScreenContactView";

const CONTACT = {
  id: "11111111-1111-1111-1111-111111111111",
  firstName: "Charlotte",
  lastName: "Kearney",
  phone: "5125550123",
  email: "charlotte@example.com",
  state: "TX",
  status: "New",
  leadSource: "Facebook Ads",
  assignedAgentId: "user-1",
  userId: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

/** Newest-first (as the real desc queries return them). Chronological ascending:
 *  call-1 10:00 → sms-1 11:00 → sms-2 11:30 (created_at fallback) → email-1 12:00 → call-2 13:00 */
function seedMixedFixtures() {
  tableData["calls"] = [
    {
      id: "call-2",
      direction: "inbound",
      duration: 45,
      disposition_name: null,
      recording_url: "storage:org-1/20260810/call-2.mp3",
      started_at: "2026-08-10T13:00:00Z",
      created_at: "2026-08-10T13:00:00Z",
      ended_at: "2026-08-10T13:00:45Z",
      caller_id_used: "+15550000002",
      contact_phone: "+15125550123",
      status: "completed",
    },
    {
      id: "call-1",
      direction: "outbound",
      duration: 125,
      disposition_name: "Interested",
      recording_url: null,
      started_at: "2026-08-10T10:00:00Z",
      created_at: "2026-08-10T10:00:00Z",
      ended_at: "2026-08-10T10:02:05Z",
      caller_id_used: "+15550000001",
      contact_phone: "+15125550123",
      status: "completed",
    },
  ];
  tableData["messages"] = [
    {
      id: "sms-2",
      direction: "inbound",
      body: "Bravo inbound text",
      sent_at: null,
      created_at: "2026-08-10T11:30:00Z",
      from_number: "+15125550123",
      to_number: null,
      status: null,
    },
    {
      id: "sms-1",
      direction: "outbound",
      body: "Alpha outbound text",
      sent_at: "2026-08-10T11:00:00Z",
      created_at: "2026-08-10T11:00:00Z",
      from_number: "+15550000001",
      to_number: "+15125550123",
      status: "delivered",
    },
  ];
  h.emails = [
    {
      id: "email-1",
      direction: "outbound",
      subject: "Policy options for Charlotte",
      body_text: "Email body alpha",
      body_html: null,
      sent_at: "2026-08-10T12:00:00Z",
      received_at: null,
      created_at: "2026-08-10T12:00:00Z",
      from_email: "agent@agency.com",
      to_emails: ["charlotte@example.com"],
      cc_emails: ["cc@agency.com"],
      bcc_emails: [],
      delivery_status: "sent",
      provider_error: null,
    },
  ];
}

beforeEach(() => {
  for (const key of Object.keys(tableData)) delete tableData[key];
  h.errorToasts = [];
  h.emails = [];
  h.emailsError = false;
  h.connections = [];
  h.sentEmails = [];
  h.sendEmailResult = { success: true };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderView(contact: Record<string, unknown> = CONTACT) {
  return render(
    <FullScreenContactView
      contact={contact}
      type="lead"
      onClose={vi.fn()}
      onUpdate={vi.fn(async () => {})}
      onDelete={vi.fn(async () => {})}
    />,
  );
}

async function renderLoaded() {
  const utils = renderView();
  await screen.findByText("Alpha outbound text");
  return utils;
}

const filterButton = (label: string) => screen.getByRole("button", { name: label });

describe("A. filters use canonical identifiers", () => {
  it("All shows calls, SMS, and email together", async () => {
    seedMixedFixtures();
    await renderLoaded();
    expect(await screen.findByText("Outbound Call")).toBeInTheDocument();
    expect(screen.getByText("Inbound Call")).toBeInTheDocument();
    expect(await screen.findByText("Alpha outbound text")).toBeInTheDocument();
    expect(screen.getByText("Bravo inbound text")).toBeInTheDocument();
    expect(await screen.findByText("Policy options for Charlotte")).toBeInTheDocument();
  });

  it("Calls shows only calls (the reported broken filter)", async () => {
    seedMixedFixtures();
    await renderLoaded();
    fireEvent.click(filterButton("Calls"));
    expect(await screen.findByText("Outbound Call")).toBeInTheDocument();
    expect(screen.getByText("Inbound Call")).toBeInTheDocument();
    expect(screen.queryByText("Alpha outbound text")).toBeNull();
    expect(screen.queryByText("Policy options for Charlotte")).toBeNull();
    expect(screen.queryByText("No activity yet")).toBeNull();
  });

  it("SMS shows only SMS", async () => {
    seedMixedFixtures();
    await renderLoaded();
    fireEvent.click(filterButton("SMS"));
    expect(await screen.findByText("Alpha outbound text")).toBeInTheDocument();
    expect(screen.getByText("Bravo inbound text")).toBeInTheDocument();
    expect(screen.queryByText("Outbound Call")).toBeNull();
    expect(screen.queryByText("Policy options for Charlotte")).toBeNull();
  });

  it("Email shows only email", async () => {
    seedMixedFixtures();
    await renderLoaded();
    fireEvent.click(filterButton("Email"));
    expect(await screen.findByText("Policy options for Charlotte")).toBeInTheDocument();
    expect(screen.queryByText("Outbound Call")).toBeNull();
    expect(screen.queryByText("Alpha outbound text")).toBeNull();
  });

  it("keeps chronological order (newest first in DOM) and never renders Invalid Date for null sent_at", async () => {
    seedMixedFixtures();
    await renderLoaded();
    // DOM order is newest-first (flex-col-reverse over an ascending sort).
    const sequence = [
      screen.getByText("Inbound Call"), // 13:00
      screen.getByText("Policy options for Charlotte"), // 12:00
      screen.getByText("Bravo inbound text"), // 11:30 via created_at fallback
      screen.getByText("Alpha outbound text"), // 11:00
      screen.getByText("Outbound Call"), // 10:00
    ];
    for (let i = 0; i < sequence.length - 1; i++) {
      expect(
        sequence[i].compareDocumentPosition(sequence[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it("shows a per-channel empty state for each filtered channel", async () => {
    tableData["calls"] = [];
    tableData["messages"] = [];
    h.emails = [];
    renderView();
    await screen.findByText("No activity yet");
    fireEvent.click(filterButton("Calls"));
    expect(await screen.findByText("No calls yet")).toBeInTheDocument();
    fireEvent.click(filterButton("SMS"));
    expect(await screen.findByText("No text messages yet")).toBeInTheDocument();
    fireEvent.click(filterButton("Email"));
    expect(await screen.findByText("No emails yet")).toBeInTheDocument();
    fireEvent.click(filterButton("All"));
    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
  });

  it("clears the previous contact's items when switching contacts (preservation pin)", async () => {
    seedMixedFixtures();
    const { rerender } = renderView();
    await screen.findByText("Alpha outbound text");
    tableData["calls"] = [];
    tableData["messages"] = [];
    h.emails = [];
    rerender(
      <FullScreenContactView
        contact={{ ...CONTACT, id: "22222222-2222-2222-2222-222222222222", firstName: "Devon" }}
        type="lead"
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => {})}
        onDelete={vi.fn(async () => {})}
      />,
    );
    expect(screen.queryByText("Alpha outbound text")).toBeNull();
    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
    expect(screen.queryByText("Outbound Call")).toBeNull();
  });

  it("shows the one-line load-error notice instead of an eternal skeleton when a source fails", async () => {
    seedMixedFixtures();
    h.emailsError = true;
    renderView();
    await screen.findByText(/Couldn't load conversation history/i);
    expect(screen.queryByText("No activity yet")).toBeNull();
  });
});

describe("B/C. inline endpoint details", () => {
  it("SMS details show actual From/To/direction/status and toggle aria-expanded", async () => {
    seedMixedFixtures();
    await renderLoaded();
    const buttons = screen.getAllByRole("button", { name: "SMS details" });
    expect(buttons.length).toBe(2);
    expect(buttons[1].getAttribute("aria-expanded")).toBe("false");

    // sms-1 (outbound, delivered) — DOM is newest-first so it is the second SMS.
    fireEvent.click(buttons[1]);
    expect(buttons[1].getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(buttons[1].getAttribute("aria-controls")!)!;
    expect(panel).toBeTruthy();
    expect(within(panel).getByText("(555) 000-0001")).toBeInTheDocument();
    expect(within(panel).getByText("(512) 555-0123")).toBeInTheDocument();
    expect(within(panel).getByText("Outbound")).toBeInTheDocument();
    expect(within(panel).getByText("delivered")).toBeInTheDocument();

    fireEvent.click(buttons[1]);
    expect(buttons[1].getAttribute("aria-expanded")).toBe("false");
  });

  it("missing SMS metadata renders '—', never Invalid Date or undefined", async () => {
    seedMixedFixtures();
    await renderLoaded();
    const buttons = screen.getAllByRole("button", { name: "SMS details" });
    // sms-2 (inbound, null to_number/status) is newest-first → first SMS details button.
    fireEvent.click(buttons[0]);
    const panel = document.getElementById(buttons[0].getAttribute("aria-controls")!)!;
    expect(within(panel).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(within(panel).queryByText(/undefined/)).toBeNull();
    expect(within(panel).queryByText(/Invalid Date/)).toBeNull();
  });

  it("call details show the customer and AgentFlow numbers, timestamps, status, disposition", async () => {
    seedMixedFixtures();
    await renderLoaded();
    const buttons = screen.getAllByRole("button", { name: "Call details" });
    expect(buttons.length).toBe(2);
    // call-1 (outbound, disposition Interested) is oldest → last details button.
    fireEvent.click(buttons[1]);
    const panel = document.getElementById(buttons[1].getAttribute("aria-controls")!)!;
    expect(within(panel).getByText("(512) 555-0123")).toBeInTheDocument(); // contact_phone
    expect(within(panel).getByText("(555) 000-0001")).toBeInTheDocument(); // caller_id_used
    expect(within(panel).getByText("Outbound")).toBeInTheDocument();
    expect(within(panel).getByText("completed")).toBeInTheDocument();
    expect(within(panel).getByText("Interested")).toBeInTheDocument();
    expect(within(panel).getByText("2:05")).toBeInTheDocument();
    // No raw identifiers in the panel.
    expect(within(panel).queryByText(/call-1/)).toBeNull();
  });

  it("email details show actual From/To and CC only when present (no BCC row for empty bcc)", async () => {
    seedMixedFixtures();
    await renderLoaded();
    const button = screen.getByRole("button", { name: "Email details" });
    fireEvent.click(button);
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(within(panel).getByText("agent@agency.com")).toBeInTheDocument();
    expect(within(panel).getByText("charlotte@example.com")).toBeInTheDocument();
    expect(within(panel).getByText("cc@agency.com")).toBeInTheDocument();
    expect(within(panel).queryByText("BCC")).toBeNull();
    expect(within(panel).getByText("sent")).toBeInTheDocument();
  });
});

describe("B. channel visuals / recording preservation", () => {
  it("reveals recording, voicemail and metadata through call details, then unmounts playback when collapsed", async () => {
    seedMixedFixtures();
    (tableData.calls as Record<string, unknown>[])[0].voicemail_id = "voicemail-2";
    await renderLoaded();
    expect(screen.queryByTestId("recording-player")).toBeNull();
    expect(screen.queryByTestId("voicemail-player")).toBeNull();
    const details = screen.getAllByRole("button", { name: "Call details" })[0]; // newest call-2
    fireEvent.click(details);
    expect(await screen.findByTestId("recording-player")).toHaveTextContent("player:call-2");
    expect(screen.getByTestId("voicemail-player")).toHaveTextContent("voicemail:voicemail-2");
    expect(details).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(details.getAttribute("aria-controls")!)!;
    expect(within(panel).getByText("Contact number")).toBeInTheDocument();
    fireEvent.click(details);
    expect(details).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("recording-player")).toBeNull();
    expect(screen.queryByTestId("voicemail-player")).toBeNull();
  });

  it("only SMS renders chat bubbles; calls and emails render neutral cards", async () => {
    seedMixedFixtures();
    await renderLoaded();
    const outboundSms = screen.getByText("Alpha outbound text").closest("div");
    expect(outboundSms?.className).toContain("bg-[#007AFF]");
    const callTitle = screen.getByText("Outbound Call");
    expect(callTitle.closest(".bg-\\[\\#007AFF\\]")).toBeNull();
    const emailSubject = screen.getByText("Policy options for Charlotte");
    expect(emailSubject.closest(".bg-\\[\\#007AFF\\]")).toBeNull();
  });
});

describe("D. persisted email subject", () => {
  it("a newly sent email immediately shows its real subject with known From/To details", async () => {
    seedMixedFixtures();
    h.connections = [
      {
        id: "conn-1",
        provider: "google",
        provider_account_email: "agent@agency.com",
        provider_account_name: "Alexa",
        status: "connected",
        last_sync_at: null,
        last_error: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "email" })); // compose channel pill (lowercase)
    fireEvent.change(screen.getByPlaceholderText("Subject"), { target: { value: "Rate quote follow-up" } });
    fireEvent.change(screen.getByPlaceholderText("Type EMAIL message…"), {
      target: { value: "Following up on our call" },
    });
    fireEvent.click(screen.getByTitle("Send Email"));

    await waitFor(() => expect(h.sentEmails.length).toBe(1));
    expect(h.sentEmails[0].subject).toBe("Rate quote follow-up");

    // The persisted timeline item must carry the subject that was actually sent.
    expect(await screen.findByText("Rate quote follow-up")).toBeInTheDocument();
    // One expansion reveals both the persisted body and endpoint metadata.
    expect(screen.queryByText("Following up on our call")).toBeNull();
    const detailButtons = screen.getAllByRole("button", { name: "Email details" });
    const newestEmailDetails = detailButtons[0]; // newest-first DOM
    fireEvent.click(newestEmailDetails);
    const panel = document.getElementById(newestEmailDetails.getAttribute("aria-controls")!)!;
    expect(within(panel).getByText("Following up on our call")).toBeInTheDocument();
    expect(within(panel).getByText("agent@agency.com")).toBeInTheDocument();
    expect(within(panel).getByText("charlotte@example.com")).toBeInTheDocument();
    expect(h.errorToasts).toHaveLength(0);
  });
});
