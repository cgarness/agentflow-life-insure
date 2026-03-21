import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

// ---- Mock all external dependencies ----
// IMPORTANT: vi.mock factories are hoisted, so all data must be inline

vi.mock("@/integrations/supabase/client", () => {
  const chainable: any = {};
  chainable.select = vi.fn().mockReturnValue(chainable);
  chainable.eq = vi.fn().mockReturnValue(chainable);
  chainable.order = vi.fn().mockReturnValue(chainable);
  chainable.or = vi.fn().mockReturnValue(chainable);
  chainable.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  chainable.upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  chainable.then = (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve);
  return {
    supabase: {
      from: vi.fn().mockReturnValue(chainable),
      auth: {
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      },
    },
  };
});

vi.mock("@/lib/supabase-contacts", () => ({
  leadsSupabaseApi: {
    getAll: vi.fn().mockResolvedValue([
      {
        id: "l1", firstName: "John", lastName: "Martinez", phone: "(555) 123-4567",
        email: "john@test.com", state: "FL", status: "Hot", leadSource: "Facebook Ads",
        leadScore: 9, age: 42, assignedAgentId: "u1",
        lastContactedAt: new Date(Date.now() - 86400000).toISOString(),
        createdAt: "2025-01-15T10:00:00Z", updatedAt: new Date().toISOString(),
      },
      {
        id: "l2", firstName: "Sarah", lastName: "Williams", phone: "(555) 234-5678",
        email: "sarah@test.com", state: "TX", status: "New", leadSource: "Google Ads",
        leadScore: 7, age: 35, assignedAgentId: "u2",
        lastContactedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        createdAt: "2025-01-18T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]),
    create: vi.fn().mockResolvedValue({ id: "l-new", firstName: "Test", lastName: "Lead" }),
    update: vi.fn().mockResolvedValue({
      id: "l1", firstName: "John", lastName: "Martinez", phone: "(555) 123-4567",
      email: "john@test.com", state: "FL", status: "Hot", leadSource: "Facebook Ads",
      leadScore: 9, age: 42, assignedAgentId: "u1",
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    getSourceStats: vi.fn().mockResolvedValue([
      { source: "Facebook Ads", leads: 10, contacted: "80%", conversion: "20%", sold: 2 },
      { source: "Google Ads", leads: 5, contacted: "60%", conversion: "10%", sold: 1 },
    ]),
    import: vi.fn().mockResolvedValue({ imported: 5, duplicates: 1, errors: 0 }),
  },
}));

vi.mock("@/lib/supabase-clients", () => ({
  clientsSupabaseApi: {
    getAll: vi.fn().mockResolvedValue([
      {
        id: "c1", firstName: "Robert", lastName: "Chen", phone: "(555) 111-2222",
        email: "robert@test.com", policyType: "Term", carrier: "Mutual of Omaha",
        policyNumber: "MOO-001", faceAmount: "$500,000", premiumAmount: "$42/mo",
        issueDate: "2024-01-15", assignedAgentId: "u1",
        createdAt: "2024-01-15T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]),
    create: vi.fn().mockResolvedValue({ id: "c-new", firstName: "Test", lastName: "Client" }),
    update: vi.fn().mockResolvedValue({
      id: "c1", firstName: "Robert", lastName: "Chen",
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/supabase-recruits", () => ({
  recruitsSupabaseApi: {
    getAll: vi.fn().mockResolvedValue([
      {
        id: "r1", firstName: "Alex", lastName: "Turner", phone: "(555) 700-0001",
        email: "alex@test.com", status: "Prospect", assignedAgentId: "u1",
        createdAt: "2025-02-01T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]),
    create: vi.fn().mockResolvedValue({ id: "r-new", firstName: "Test", lastName: "Recruit" }),
    update: vi.fn().mockResolvedValue({ id: "r1", firstName: "Alex", lastName: "Turner" }),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/supabase-notes", () => ({
  notesSupabaseApi: {
    getByContact: vi.fn().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue({ id: "n-new", note: "Test note" }),
    togglePin: vi.fn().mockRejectedValue(new Error("Not supported")),
  },
}));

vi.mock("@/lib/supabase-leads", () => ({
  importLeadsToSupabase: vi.fn().mockResolvedValue({ imported: 0, duplicates: 0, errors: 0, importedLeadIds: [] }),
}));

vi.mock("@/lib/mock-api", () => ({
  pipelineApi: {
    getLeadStages: vi.fn().mockResolvedValue([
      { name: "New", color: "#3B82F6" },
      { name: "Hot", color: "#F97316" },
      { name: "Contacted", color: "#A855F7" },
    ]),
    getRecruitStages: vi.fn().mockResolvedValue([
      { name: "Prospect", color: "#6B7280" },
      { name: "Interview", color: "#EAB308" },
    ]),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn().mockReturnValue({
    user: { id: "u1", email: "chris@agentflow.com" },
    profile: { id: "u1", first_name: "Chris", last_name: "Garcia", role: "Admin" },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: vi.fn().mockReturnValue({
    branding: { dateFormat: "MM/dd/yyyy", timeFormat: "12h" },
    isLoading: false,
    formatDate: (d: any) => d ? new Date(d).toLocaleDateString() : "",
    formatDateTime: (d: any) => d ? new Date(d).toLocaleString() : "",
    formatTime: (d: any) => d ? new Date(d).toLocaleTimeString() : "",
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock the detail modal components to keep tests focused on page logic
vi.mock("@/components/contacts/ContactModal", () => ({
  default: ({ lead, onClose }: any) =>
    lead ? (
      <div data-testid="contact-modal">
        <span>Contact Modal: {lead.firstName} {lead.lastName}</span>
        <button onClick={onClose}>Close Modal</button>
      </div>
    ) : null,
}));

vi.mock("@/components/contacts/ClientModal", () => ({
  default: ({ client, onClose }: any) =>
    client ? (
      <div data-testid="client-modal">
        <span>Client Modal: {client.firstName} {client.lastName}</span>
        <button onClick={onClose}>Close Modal</button>
      </div>
    ) : null,
}));

vi.mock("@/components/contacts/RecruitModal", () => ({
  default: ({ recruit, onClose }: any) =>
    recruit ? (
      <div data-testid="recruit-modal">
        <span>Recruit Modal: {recruit.firstName} {recruit.lastName}</span>
        <button onClick={onClose}>Close Modal</button>
      </div>
    ) : null,
}));

vi.mock("@/components/contacts/AgentModal", () => ({
  default: ({ agent, onClose }: any) =>
    agent ? (
      <div data-testid="agent-modal">
        <span>Agent Modal: {agent.firstName} {agent.lastName}</span>
        <button onClick={onClose}>Close Modal</button>
      </div>
    ) : null,
}));

vi.mock("@/components/contacts/ImportLeadsModal", () => ({
  default: ({ open, onClose }: any) =>
    open ? (
      <div data-testid="import-modal">
        <span>Import Leads Modal</span>
        <button onClick={onClose}>Close Import</button>
      </div>
    ) : null,
}));

vi.mock("@/components/contacts/AddToCampaignModal", () => ({
  default: ({ open, onClose }: any) =>
    open ? (
      <div data-testid="campaign-modal">
        <span>Add To Campaign Modal</span>
        <button onClick={onClose}>Close Campaign</button>
      </div>
    ) : null,
}));

// Import after all mocks
import Contacts from "@/pages/Contacts";
import { leadsSupabaseApi } from "@/lib/supabase-contacts";
import { clientsSupabaseApi } from "@/lib/supabase-clients";
import { recruitsSupabaseApi } from "@/lib/supabase-recruits";

function renderContacts(initialPath = "/contacts?tab=Leads") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Contacts />
    </MemoryRouter>
  );
}

describe("Contacts Page - Rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mocked return values since clearAllMocks clears them
    vi.mocked(leadsSupabaseApi.getAll).mockResolvedValue([
      {
        id: "l1", firstName: "John", lastName: "Martinez", phone: "(555) 123-4567",
        email: "john@test.com", state: "FL", status: "Hot", leadSource: "Facebook Ads",
        leadScore: 9, age: 42, assignedAgentId: "u1",
        lastContactedAt: new Date(Date.now() - 86400000).toISOString(),
        createdAt: "2025-01-15T10:00:00Z", updatedAt: new Date().toISOString(),
      },
      {
        id: "l2", firstName: "Sarah", lastName: "Williams", phone: "(555) 234-5678",
        email: "sarah@test.com", state: "TX", status: "New", leadSource: "Google Ads",
        leadScore: 7, age: 35, assignedAgentId: "u2",
        lastContactedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        createdAt: "2025-01-18T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(leadsSupabaseApi.getSourceStats).mockResolvedValue([
      { source: "Facebook Ads", leads: 10, contacted: "80%", conversion: "20%", sold: 2 },
    ]);
    vi.mocked(clientsSupabaseApi.getAll).mockResolvedValue([
      {
        id: "c1", firstName: "Robert", lastName: "Chen", phone: "(555) 111-2222",
        email: "robert@test.com", policyType: "Term", carrier: "Mutual of Omaha",
        policyNumber: "MOO-001", faceAmount: "$500,000", premiumAmount: "$42/mo",
        issueDate: "2024-01-15", assignedAgentId: "u1",
        createdAt: "2024-01-15T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(recruitsSupabaseApi.getAll).mockResolvedValue([
      {
        id: "r1", firstName: "Alex", lastName: "Turner", phone: "(555) 700-0001",
        email: "alex@test.com", status: "Prospect", assignedAgentId: "u1",
        createdAt: "2025-02-01T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]);
  });

  it("renders the page with tab buttons", async () => {
    renderContacts();

    await waitFor(() => {
      expect(screen.getByText("Leads")).toBeInTheDocument();
      expect(screen.getByText("Clients")).toBeInTheDocument();
      expect(screen.getByText("Recruits")).toBeInTheDocument();
      expect(screen.getByText("Agents")).toBeInTheDocument();
    });
  });

  it("fetches and displays lead data on load", async () => {
    renderContacts();

    await waitFor(() => {
      expect(leadsSupabaseApi.getAll).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("John Martinez")).toBeInTheDocument();
      expect(screen.getByText("Sarah Williams")).toBeInTheDocument();
    });
  });

  it("fetches client and recruit data on load", async () => {
    renderContacts();

    await waitFor(() => {
      expect(clientsSupabaseApi.getAll).toHaveBeenCalled();
      expect(recruitsSupabaseApi.getAll).toHaveBeenCalled();
    });
  });

  it("displays lead details correctly", async () => {
    renderContacts();

    await waitFor(() => {
      expect(screen.getByText("(555) 123-4567")).toBeInTheDocument();
      // These values may appear in multiple places (table rows + filters/headers)
      expect(screen.getAllByText("Hot").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Facebook Ads").length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("Contacts Page - Tab Switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(leadsSupabaseApi.getAll).mockResolvedValue([
      {
        id: "l1", firstName: "John", lastName: "Martinez", phone: "(555) 123-4567",
        email: "john@test.com", state: "FL", status: "Hot", leadSource: "Facebook Ads",
        leadScore: 9, age: 42, assignedAgentId: "u1",
        createdAt: "2025-01-15T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(leadsSupabaseApi.getSourceStats).mockResolvedValue([]);
    vi.mocked(clientsSupabaseApi.getAll).mockResolvedValue([
      {
        id: "c1", firstName: "Robert", lastName: "Chen", phone: "(555) 111-2222",
        email: "robert@test.com", policyType: "Term", carrier: "Mutual of Omaha",
        policyNumber: "MOO-001", faceAmount: "$500,000", premiumAmount: "$42/mo",
        issueDate: "2024-01-15", assignedAgentId: "u1",
        createdAt: "2024-01-15T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(recruitsSupabaseApi.getAll).mockResolvedValue([
      {
        id: "r1", firstName: "Alex", lastName: "Turner", phone: "(555) 700-0001",
        email: "alex@test.com", status: "Prospect", assignedAgentId: "u1",
        createdAt: "2025-02-01T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]);
  });

  it("switches to Clients tab and shows client data", async () => {
    renderContacts();

    await waitFor(() => {
      expect(screen.getByText("John Martinez")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Clients"));

    await waitFor(() => {
      expect(screen.getByText("Robert Chen")).toBeInTheDocument();
    });
  });

  it("switches to Recruits tab and shows recruit data", async () => {
    renderContacts();

    await waitFor(() => {
      expect(screen.getByText("John Martinez")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Recruits"));

    await waitFor(() => {
      expect(screen.getByText("Alex Turner")).toBeInTheDocument();
    });
  });

  it("switches to Agents tab and shows agent data", async () => {
    renderContacts();

    await waitFor(() => {
      expect(screen.getByText("John Martinez")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Agents"));

    await waitFor(() => {
      expect(screen.getByText("Chris Garcia")).toBeInTheDocument();
    });
  });

  it("can navigate directly to Clients tab via URL", async () => {
    renderContacts("/contacts?tab=Clients");

    await waitFor(() => {
      expect(screen.getByText("Robert Chen")).toBeInTheDocument();
    });
  });
});

describe("Contacts Page - Search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(leadsSupabaseApi.getAll).mockResolvedValue([
      {
        id: "l1", firstName: "John", lastName: "Martinez", phone: "(555) 123-4567",
        email: "john@test.com", state: "FL", status: "Hot", leadSource: "Facebook Ads",
        leadScore: 9, age: 42, assignedAgentId: "u1",
        createdAt: "2025-01-15T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(leadsSupabaseApi.getSourceStats).mockResolvedValue([]);
    vi.mocked(clientsSupabaseApi.getAll).mockResolvedValue([]);
    vi.mocked(recruitsSupabaseApi.getAll).mockResolvedValue([]);
  });

  it("renders a search input", async () => {
    renderContacts();

    await waitFor(() => {
      const searchInput = screen.getByPlaceholderText(/search/i);
      expect(searchInput).toBeInTheDocument();
    });
  });

  it("typing in search triggers a re-fetch", async () => {
    renderContacts();

    await waitFor(() => {
      expect(screen.getByText("John Martinez")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "john" } });

    await waitFor(() => {
      expect(leadsSupabaseApi.getAll).toHaveBeenCalledWith(
        expect.objectContaining({ search: "john" })
      );
    });
  });
});

describe("Contacts Page - Add Contact Modal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(leadsSupabaseApi.getAll).mockResolvedValue([
      {
        id: "l1", firstName: "John", lastName: "Martinez", phone: "(555) 123-4567",
        email: "john@test.com", state: "FL", status: "Hot", leadSource: "Facebook Ads",
        leadScore: 9, age: 42, assignedAgentId: "u1",
        createdAt: "2025-01-15T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(leadsSupabaseApi.getSourceStats).mockResolvedValue([]);
    vi.mocked(leadsSupabaseApi.create).mockResolvedValue({
      id: "l-new", firstName: "Test", lastName: "Lead", phone: "(555) 999-9999",
      email: "test@test.com", state: "FL", status: "New", leadSource: "Facebook Ads",
      leadScore: 5, assignedAgentId: "u1", createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(clientsSupabaseApi.getAll).mockResolvedValue([]);
    vi.mocked(recruitsSupabaseApi.getAll).mockResolvedValue([]);
  });

  it("opens add modal when Add Lead button is clicked", async () => {
    renderContacts();

    await waitFor(() => {
      expect(screen.getByText("John Martinez")).toBeInTheDocument();
    });

    const addButton = screen.getByText(/Add Lead/i);
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(screen.getByText(/Add New Lead/i)).toBeInTheDocument();
    });
  });

  it("add form has required fields", async () => {
    renderContacts();

    await waitFor(() => {
      expect(screen.getByText("John Martinez")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Add Lead/i));

    await waitFor(() => {
      expect(screen.getByText("First Name *")).toBeInTheDocument();
      expect(screen.getByText("Last Name *")).toBeInTheDocument();
      expect(screen.getByText("Phone *")).toBeInTheDocument();
      expect(screen.getByText("Email *")).toBeInTheDocument();
    });
  });

  it("add form shows lead-specific fields", async () => {
    renderContacts();

    await waitFor(() => {
      expect(screen.getByText("John Martinez")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Add Lead/i));

    await waitFor(() => {
      // "State" appears in table column too, so use getAllByText
      expect(screen.getAllByText("State").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Lead Source")).toBeInTheDocument();
      expect(screen.getByText("Date of Birth")).toBeInTheDocument();
      expect(screen.getByText("Health Status")).toBeInTheDocument();
      expect(screen.getByText("Best Time to Call")).toBeInTheDocument();
    });
  });

  it("cancel button closes the add modal", async () => {
    renderContacts();

    await waitFor(() => {
      expect(screen.getByText("John Martinez")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Add Lead/i));

    await waitFor(() => {
      expect(screen.getByText("Add New Lead")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => {
      expect(screen.queryByText("Add New Lead")).not.toBeInTheDocument();
    });
  });
});

describe("Contacts Page - Contact Modal Opening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(leadsSupabaseApi.getAll).mockResolvedValue([
      {
        id: "l1", firstName: "John", lastName: "Martinez", phone: "(555) 123-4567",
        email: "john@test.com", state: "FL", status: "Hot", leadSource: "Facebook Ads",
        leadScore: 9, age: 42, assignedAgentId: "u1",
        createdAt: "2025-01-15T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(leadsSupabaseApi.getSourceStats).mockResolvedValue([]);
    vi.mocked(clientsSupabaseApi.getAll).mockResolvedValue([
      {
        id: "c1", firstName: "Robert", lastName: "Chen", phone: "(555) 111-2222",
        email: "robert@test.com", policyType: "Term", carrier: "Mutual of Omaha",
        policyNumber: "MOO-001", faceAmount: "$500,000", premiumAmount: "$42/mo",
        issueDate: "2024-01-15", assignedAgentId: "u1",
        createdAt: "2024-01-15T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(recruitsSupabaseApi.getAll).mockResolvedValue([
      {
        id: "r1", firstName: "Alex", lastName: "Turner", phone: "(555) 700-0001",
        email: "alex@test.com", status: "Prospect", assignedAgentId: "u1",
        createdAt: "2025-02-01T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]);
  });

  it("clicking a lead name opens the contact detail modal", async () => {
    renderContacts();

    await waitFor(() => {
      expect(screen.getByText("John Martinez")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("John Martinez"));

    await waitFor(() => {
      expect(screen.getByTestId("contact-modal")).toBeInTheDocument();
      expect(screen.getByText("Contact Modal: John Martinez")).toBeInTheDocument();
    });
  });

  it("clicking a client name opens the client modal", async () => {
    renderContacts("/contacts?tab=Clients");

    await waitFor(() => {
      expect(screen.getByText("Robert Chen")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Robert Chen"));

    await waitFor(() => {
      expect(screen.getByTestId("client-modal")).toBeInTheDocument();
    });
  });

  it("clicking a recruit name opens the recruit modal", async () => {
    renderContacts("/contacts?tab=Recruits");

    await waitFor(() => {
      expect(screen.getByText("Alex Turner")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Alex Turner"));

    await waitFor(() => {
      expect(screen.getByTestId("recruit-modal")).toBeInTheDocument();
    });
  });
});

describe("Contacts Page - Bulk Selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(leadsSupabaseApi.getAll).mockResolvedValue([
      {
        id: "l1", firstName: "John", lastName: "Martinez", phone: "(555) 123-4567",
        email: "john@test.com", state: "FL", status: "Hot", leadSource: "Facebook Ads",
        leadScore: 9, age: 42, assignedAgentId: "u1",
        createdAt: "2025-01-15T10:00:00Z", updatedAt: new Date().toISOString(),
      },
      {
        id: "l2", firstName: "Sarah", lastName: "Williams", phone: "(555) 234-5678",
        email: "sarah@test.com", state: "TX", status: "New", leadSource: "Google Ads",
        leadScore: 7, age: 35, assignedAgentId: "u2",
        createdAt: "2025-01-18T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(leadsSupabaseApi.getSourceStats).mockResolvedValue([]);
    vi.mocked(clientsSupabaseApi.getAll).mockResolvedValue([]);
    vi.mocked(recruitsSupabaseApi.getAll).mockResolvedValue([]);
  });

  it("renders checkboxes for selecting contacts", async () => {
    renderContacts();

    await waitFor(() => {
      expect(screen.getByText("John Martinez")).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
  });

  it("select-all checkbox selects all leads", async () => {
    renderContacts();

    await waitFor(() => {
      expect(screen.getByText("John Martinez")).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]); // select-all

    await waitFor(() => {
      const selectedText = screen.queryByText(/2 selected/i) || screen.queryByText(/selected/i);
      expect(selectedText).toBeInTheDocument();
    });
  });
});

describe("Contacts Page - Client Tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(leadsSupabaseApi.getAll).mockResolvedValue([]);
    vi.mocked(leadsSupabaseApi.getSourceStats).mockResolvedValue([]);
    vi.mocked(clientsSupabaseApi.getAll).mockResolvedValue([
      {
        id: "c1", firstName: "Robert", lastName: "Chen", phone: "(555) 111-2222",
        email: "robert@test.com", policyType: "Term", carrier: "Mutual of Omaha",
        policyNumber: "MOO-001", faceAmount: "$500,000", premiumAmount: "$42/mo",
        issueDate: "2024-01-15", assignedAgentId: "u1",
        createdAt: "2024-01-15T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(recruitsSupabaseApi.getAll).mockResolvedValue([]);
  });

  it("shows client-specific column headers", async () => {
    renderContacts("/contacts?tab=Clients");

    await waitFor(() => {
      expect(screen.getByText("Robert Chen")).toBeInTheDocument();
    });

    expect(screen.getByText("Policy Type")).toBeInTheDocument();
    expect(screen.getByText("Carrier")).toBeInTheDocument();
    expect(screen.getByText("Premium")).toBeInTheDocument();
  });

  it("displays client policy and carrier info", async () => {
    renderContacts("/contacts?tab=Clients");

    await waitFor(() => {
      expect(screen.getByText("Robert Chen")).toBeInTheDocument();
      expect(screen.getByText("Term")).toBeInTheDocument();
      expect(screen.getByText("Mutual of Omaha")).toBeInTheDocument();
    });
  });

  it("Add Client button opens client-specific form", async () => {
    renderContacts("/contacts?tab=Clients");

    await waitFor(() => {
      expect(screen.getByText("Robert Chen")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Add Client/i));

    await waitFor(() => {
      expect(screen.getByText("Add New Client")).toBeInTheDocument();
      expect(screen.getByText("Policy Type *")).toBeInTheDocument();
      expect(screen.getByText("Carrier *")).toBeInTheDocument();
    });
  });
});

describe("Contacts Page - Recruit Tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(leadsSupabaseApi.getAll).mockResolvedValue([]);
    vi.mocked(leadsSupabaseApi.getSourceStats).mockResolvedValue([]);
    vi.mocked(clientsSupabaseApi.getAll).mockResolvedValue([]);
    vi.mocked(recruitsSupabaseApi.getAll).mockResolvedValue([
      {
        id: "r1", firstName: "Alex", lastName: "Turner", phone: "(555) 700-0001",
        email: "alex@test.com", status: "Prospect", assignedAgentId: "u1",
        createdAt: "2025-02-01T10:00:00Z", updatedAt: new Date().toISOString(),
      },
    ]);
  });

  it("shows recruit data correctly", async () => {
    renderContacts("/contacts?tab=Recruits");

    await waitFor(() => {
      expect(screen.getByText("Alex Turner")).toBeInTheDocument();
      expect(screen.getByText("Prospect")).toBeInTheDocument();
    });
  });

  it("Add Recruit button opens recruit form", async () => {
    renderContacts("/contacts?tab=Recruits");

    await waitFor(() => {
      expect(screen.getByText("Alex Turner")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Add Recruit/i));

    await waitFor(() => {
      expect(screen.getByText("Add New Recruit")).toBeInTheDocument();
    });
  });
});

describe("Contacts Page - Persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(leadsSupabaseApi.getAll).mockResolvedValue([]);
    vi.mocked(leadsSupabaseApi.getSourceStats).mockResolvedValue([]);
    vi.mocked(clientsSupabaseApi.getAll).mockResolvedValue([]);
    vi.mocked(recruitsSupabaseApi.getAll).mockResolvedValue([]);
  });

  it("loads data from Supabase APIs on mount", async () => {
    renderContacts();

    await waitFor(() => {
      expect(leadsSupabaseApi.getAll).toHaveBeenCalled();
      expect(clientsSupabaseApi.getAll).toHaveBeenCalled();
      expect(recruitsSupabaseApi.getAll).toHaveBeenCalled();
      expect(leadsSupabaseApi.getSourceStats).toHaveBeenCalled();
    });
  });

  it("loads column visibility preferences from Supabase", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    renderContacts();

    await waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith("user_preferences");
    });
  });
});
