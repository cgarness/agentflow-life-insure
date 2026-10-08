/**
 * SMS readiness is an independent service boundary, covered by its hook tests.
 */
vi.mock("@/hooks/useSmsConsentStatus", () => ({ useSmsConsentStatus: () => ({ data: { enforced: false }, error: null, refetch: vi.fn() }) }));

/**
 * Conversation History call-disposition badge colors (2026-08-18 surgical fix).
 *
 * Regression pinned: CallHistoryItem rendered every disposition badge with
 * hardcoded neutral `bg-muted text-foreground/70`, ignoring the agency's
 * configured `dispositions.color` — so "Appointment Set" appeared gray.
 * The fix resolves the color via the org-scoped dispositionsSupabaseApi list
 * (trimmed, case-insensitive name match through normalizeDispositionValue) and
 * renders the badge with the existing getStatusColorStyle() treatment; unknown
 * legacy dispositions and non-disposition statuses stay neutral, and a failed
 * color fetch must never break Conversation History.
 *
 * Harness mirrors fullScreenContactViewConversation.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

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

      if (fn === 'get_contact_activity_page') return {data:{items:[],hasMore:false,nextCursor:null},error:null};
      const source = [...((tableData.calls ?? []) as Record<string,unknown>[]).map(payload=>({kind:'call',payload})),
        ...((tableData.messages ?? []) as Record<string,unknown>[]).map(payload=>({kind:'sms',payload})),
        ...([{id:"email-1",direction:"outbound",subject:"Quote follow-up",body_text:"Body",sent_at:"2026-08-10T12:00:00Z",from_email:"agent@agency.com",to_emails:["charlotte@example.com"],delivery_status:"sent"}] as Record<string,unknown>[]).map(payload=>({kind:'email',payload}))];
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
  dispositions: [] as Array<{ name: string; color: string }>,
  dispositionsError: false,
  getAllCalls: [] as string[],
}));

vi.mock("@/lib/supabase-dispositions", () => ({
  dispositionsSupabaseApi: {
    getAll: vi.fn(async (organizationId: string) => {
      h.getAllCalls.push(organizationId);
      if (h.dispositionsError) throw new Error("dispositions fetch failed");
      return h.dispositions;
    }),
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
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
    getMyConnections: vi.fn(async () => []),
    getContactEmails: vi.fn(async () => [
      {
        id: "email-1",
        direction: "outbound",
        subject: "Quote follow-up",
        body_text: "Body",
        sent_at: "2026-08-10T12:00:00Z",
        created_at: "2026-08-10T12:00:00Z",
        from_email: "agent@agency.com",
        to_emails: ["charlotte@example.com"],
        cc_emails: [],
        bcc_emails: [],
        delivery_status: "sent",
      },
    ]),
    sendContactEmail: vi.fn(async () => ({ success: true })),
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

import FullScreenContactView from "@/components/contacts/FullScreenContactView";

const CONTACT = {
  id: "11111111-1111-1111-1111-111111111111",
  firstName: "Charlotte",
  lastName: "Kearney",
  phone: "5125550123",
  email: "charlotte@example.com",
  state: "TX",
  status: "New",
  assignedAgentId: "user-1",
  userId: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function seedFixtures(appointmentSetName = "Appointment Set") {
  tableData["calls"] = [
    {
      id: "call-legacy",
      direction: "inbound",
      duration: 30,
      disposition_name: "Old Legacy Outcome",
      recording_url: "storage:org-1/legacy.mp3",
      started_at: "2026-08-10T11:00:00Z",
      created_at: "2026-08-10T11:00:00Z",
      ended_at: "2026-08-10T11:00:30Z",
      caller_id_used: "+15550000001",
      contact_phone: "+15125550123",
      status: "completed",
    },
    {
      id: "call-appt",
      direction: "outbound",
      duration: 120,
      disposition_name: appointmentSetName,
      recording_url: null,
      started_at: "2026-08-10T10:00:00Z",
      created_at: "2026-08-10T10:00:00Z",
      ended_at: "2026-08-10T10:02:00Z",
      caller_id_used: "+15550000001",
      contact_phone: "+15125550123",
      status: "completed",
    },
  ];
  tableData["messages"] = [
    {
      id: "sms-1",
      direction: "outbound",
      body: "Alpha outbound text",
      sent_at: "2026-08-10T11:30:00Z",
      created_at: "2026-08-10T11:30:00Z",
      from_number: "+15550000001",
      to_number: "+15125550123",
      status: "delivered",
    },
  ];
}

beforeEach(() => {
  for (const key of Object.keys(tableData)) delete tableData[key];
  h.dispositions = [];
  h.dispositionsError = false;
  h.getAllCalls = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderLoaded() {
  render(
    <FullScreenContactView
      contact={CONTACT}
      type="lead"
      onClose={vi.fn()}
      onUpdate={vi.fn(async () => {})}
      onDelete={vi.fn(async () => {})}
    />,
  );
  await screen.findByText("Alpha outbound text");
}

describe("agency-configured disposition text colors", () => {
  it("renders 'Appointment Set' with the configured #8B5CF6 text color and no nested pill", async () => {
    h.dispositions = [{ name: "Appointment Set", color: "#8B5CF6" }];
    seedFixtures();
    await renderLoaded();
    const badge = screen.getByText("Appointment Set");
    expect(badge).toHaveStyle({
      color: "#8B5CF6",
    });
    expect(badge.className).not.toContain("bg-muted");
    expect(badge).toHaveClass("!bg-transparent");
    expect(badge).not.toHaveClass("rounded-full");
    // Org-scoped, fetched once at the parent level — never per timeline item.
    expect(h.getAllCalls).toEqual(["org-1"]);
  });

  it("matches disposition names trimmed and case-insensitively", async () => {
    h.dispositions = [{ name: "  APPOINTMENT SET  ", color: "#8B5CF6" }];
    seedFixtures("appointment set");
    await renderLoaded();
    const badge = screen.getByText("appointment set");
    expect(badge).toHaveStyle({ color: "#8B5CF6" });
  });

  it("keeps an unknown/deleted legacy disposition neutral", async () => {
    h.dispositions = [{ name: "Appointment Set", color: "#8B5CF6" }];
    seedFixtures();
    await renderLoaded();
    const legacyBadge = screen.getByText("Old Legacy Outcome");
    expect(legacyBadge).toHaveClass("text-muted-foreground", "!bg-transparent");
    expect(legacyBadge.getAttribute("style")).toBeNull();
  });

  it("soft-fails a disposition-color fetch failure without breaking Conversation History", async () => {
    h.dispositionsError = true;
    seedFixtures();
    await renderLoaded();
    // Timeline fully renders; outcome text falls back to neutral; no load-error notice.
    expect(screen.getByText("Outbound Call")).toBeInTheDocument();
    expect(screen.getByText("Inbound Call")).toBeInTheDocument();
    expect(screen.getByText("Outbound Email")).toBeInTheDocument();
    const badge = screen.getByText("Appointment Set");
    expect(badge).toHaveClass("text-muted-foreground");
    expect(screen.queryByText(/Couldn't load conversation history/i)).toBeNull();
  });

  it("preserves SMS/email presentation and reveals call metadata and recording together", async () => {
    h.dispositions = [{ name: "Appointment Set", color: "#8B5CF6" }];
    seedFixtures();
    await renderLoaded();
    // SMS bubble stays iMessage blue; email keeps its full subject in the popover.
    expect(screen.getByText("Alpha outbound text").closest("div")?.className).toContain("bg-[#007AFF]");
    expect(screen.getByText("Outbound Email")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Email details" }));
    expect(screen.getByText("Quote follow-up")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close email details" }));
    // Details still expand with endpoint data (scoped to the panel — the
    // profile column also displays the contact's phone).
    const callDetails = screen.getAllByRole("button", { name: "Call details" });
    fireEvent.click(callDetails[0]);
    const panel = document.getElementById(callDetails[0].getAttribute("aria-controls")!)!;
    expect(within(panel).getByText("(512) 555-0123")).toBeInTheDocument();
    // The same disclosure mounts the unchanged RecordingPlayer contract.
    expect(await screen.findByTestId("recording-player")).toHaveTextContent("player:call-legacy");
  });
});
