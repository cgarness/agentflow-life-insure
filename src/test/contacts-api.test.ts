import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase client before importing modules
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockFrom = vi.fn();
const mockOrder = vi.fn();
const mockEq = vi.fn();
const mockOr = vi.fn();
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();

// Build a chainable query mock
function createChainableMock(resolvedData: any = null, resolvedError: any = null) {
  const result = { data: resolvedData, error: resolvedError };
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: vi.fn((cb: any) => cb(result)),
  };
  // Make the chain itself thenable (so await works)
  chain[Symbol.for("vitest:thenable")] = true;
  // Override to make the chain awaitable
  Object.defineProperty(chain, "then", {
    value: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    writable: true,
    configurable: true,
  });
  return chain;
}

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from: vi.fn(),
    },
  };
});

import { supabase } from "@/integrations/supabase/client";
const mockedSupabase = vi.mocked(supabase);

// ===== Test the row-to-model conversion logic =====

describe("Leads API - Data Transformation", () => {
  // We test the conversion logic by importing and calling leadsSupabaseApi

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getAll returns mapped Lead objects from Supabase rows", async () => {
    const mockRow = {
      id: "lead-1",
      first_name: "John",
      last_name: "Doe",
      phone: "(555) 123-4567",
      email: "john@test.com",
      state: "FL",
      status: "New",
      lead_source: "Facebook Ads",
      lead_score: 8,
      age: 42,
      date_of_birth: "1983-05-12",
      health_status: "Preferred",
      best_time_to_call: "Morning",
      spouse_info: null,
      notes: "Test notes",
      assigned_agent_id: "u1",
      last_contacted_at: "2025-01-15T10:00:00Z",
      custom_fields: null,
      created_at: "2025-01-15T10:00:00Z",
      updated_at: "2025-01-16T10:00:00Z",
    };

    const chain = createChainableMock([mockRow]);
    mockedSupabase.from = vi.fn().mockReturnValue(chain);

    const { leadsSupabaseApi } = await import("@/lib/supabase-contacts");
    const leads = await leadsSupabaseApi.getAll();

    expect(mockedSupabase.from).toHaveBeenCalledWith("leads");
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      id: "lead-1",
      firstName: "John",
      lastName: "Doe",
      phone: "(555) 123-4567",
      email: "john@test.com",
      state: "FL",
      status: "New",
      leadSource: "Facebook Ads",
      leadScore: 8,
      age: 42,
      dateOfBirth: "1983-05-12",
      healthStatus: "Preferred",
      bestTimeToCall: "Morning",
      assignedAgentId: "u1",
    });
  });

  it("getAll applies search filter correctly", async () => {
    const chain = createChainableMock([]);
    mockedSupabase.from = vi.fn().mockReturnValue(chain);

    const { leadsSupabaseApi } = await import("@/lib/supabase-contacts");
    await leadsSupabaseApi.getAll({ search: "john" });

    expect(chain.or).toHaveBeenCalledWith(
      expect.stringContaining("first_name.ilike.%john%")
    );
  });

  it("getAll applies status filter correctly", async () => {
    const chain = createChainableMock([]);
    mockedSupabase.from = vi.fn().mockReturnValue(chain);

    const { leadsSupabaseApi } = await import("@/lib/supabase-contacts");
    await leadsSupabaseApi.getAll({ status: "Hot" });

    expect(chain.eq).toHaveBeenCalledWith("status", "Hot");
  });

  it("getAll applies source filter correctly", async () => {
    const chain = createChainableMock([]);
    mockedSupabase.from = vi.fn().mockReturnValue(chain);

    const { leadsSupabaseApi } = await import("@/lib/supabase-contacts");
    await leadsSupabaseApi.getAll({ source: "Referral" });

    expect(chain.eq).toHaveBeenCalledWith("lead_source", "Referral");
  });

  it("getAll throws on error", async () => {
    const chain = createChainableMock(null, { message: "DB error" });
    mockedSupabase.from = vi.fn().mockReturnValue(chain);

    const { leadsSupabaseApi } = await import("@/lib/supabase-contacts");
    await expect(leadsSupabaseApi.getAll()).rejects.toThrow("DB error");
  });

  it("getById returns a lead with empty notes/activities/calls", async () => {
    const mockRow = {
      id: "lead-1",
      first_name: "Jane",
      last_name: "Smith",
      phone: "(555) 999-0000",
      email: "jane@test.com",
      state: "TX",
      status: "Contacted",
      lead_source: "Google Ads",
      lead_score: 6,
      age: null,
      date_of_birth: null,
      health_status: null,
      best_time_to_call: null,
      spouse_info: null,
      notes: null,
      assigned_agent_id: "u2",
      last_contacted_at: null,
      custom_fields: null,
      created_at: "2025-01-10T10:00:00Z",
      updated_at: "2025-01-11T10:00:00Z",
    };

    const chain = createChainableMock(null);
    chain.single = vi.fn().mockResolvedValue({ data: mockRow, error: null });
    // Override the chain so eq returns something with single
    chain.eq = vi.fn().mockReturnValue({ single: chain.single });
    chain.select = vi.fn().mockReturnValue(chain);
    mockedSupabase.from = vi.fn().mockReturnValue(chain);

    const { leadsSupabaseApi } = await import("@/lib/supabase-contacts");
    const result = await leadsSupabaseApi.getById("lead-1");

    expect(result.lead.firstName).toBe("Jane");
    expect(result.lead.lastName).toBe("Smith");
    expect(result.notes).toEqual([]);
    expect(result.activities).toEqual([]);
    expect(result.calls).toEqual([]);
  });

  it("create detects duplicates by phone or email", async () => {
    // First call: duplicate check returns existing record
    const dupChain = createChainableMock(null);
    const dupResult = {
      data: { id: "existing", first_name: "Existing", last_name: "Lead", phone: "(555) 111-1111" },
      error: null,
    };
    dupChain.select = vi.fn().mockReturnValue(dupChain);
    dupChain.or = vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue(dupResult) });
    mockedSupabase.from = vi.fn().mockReturnValue(dupChain);

    const { leadsSupabaseApi } = await import("@/lib/supabase-contacts");
    await expect(
      leadsSupabaseApi.create({
        firstName: "New",
        lastName: "Lead",
        phone: "(555) 111-1111",
        email: "new@test.com",
        state: "FL",
        status: "New",
        leadSource: "Facebook Ads",
        leadScore: 5,
        assignedAgentId: "u1",
      })
    ).rejects.toThrow("Duplicate detected");
  });

  it("update maps camelCase fields to snake_case columns", async () => {
    const updateChain = createChainableMock(null);
    const updatedRow = {
      id: "lead-1",
      first_name: "Updated",
      last_name: "Name",
      phone: "(555) 123-4567",
      email: "updated@test.com",
      state: "CA",
      status: "Hot",
      lead_source: "Referral",
      lead_score: 9,
      age: 45,
      date_of_birth: null,
      health_status: "Preferred",
      best_time_to_call: "Morning",
      spouse_info: null,
      notes: null,
      assigned_agent_id: "u1",
      last_contacted_at: null,
      custom_fields: null,
      created_at: "2025-01-15T10:00:00Z",
      updated_at: "2025-01-20T10:00:00Z",
    };
    updateChain.update = vi.fn().mockReturnValue(updateChain);
    updateChain.eq = vi.fn().mockReturnValue(updateChain);
    updateChain.select = vi.fn().mockReturnValue(updateChain);
    updateChain.single = vi.fn().mockResolvedValue({ data: updatedRow, error: null });
    mockedSupabase.from = vi.fn().mockReturnValue(updateChain);

    const { leadsSupabaseApi } = await import("@/lib/supabase-contacts");
    const result = await leadsSupabaseApi.update("lead-1", {
      firstName: "Updated",
      lastName: "Name",
      email: "updated@test.com",
      state: "CA",
      status: "Hot",
      leadSource: "Referral",
      leadScore: 9,
      healthStatus: "Preferred",
    });

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: "Updated",
        last_name: "Name",
        email: "updated@test.com",
        state: "CA",
        status: "Hot",
        lead_source: "Referral",
        lead_score: 9,
        health_status: "Preferred",
      })
    );
    expect(result.firstName).toBe("Updated");
  });

  it("delete calls supabase delete with correct id", async () => {
    const deleteChain = createChainableMock(null);
    deleteChain.delete = vi.fn().mockReturnValue(deleteChain);
    deleteChain.eq = vi.fn().mockReturnValue(
      Promise.resolve({ data: null, error: null })
    );
    mockedSupabase.from = vi.fn().mockReturnValue(deleteChain);

    const { leadsSupabaseApi } = await import("@/lib/supabase-contacts");
    await leadsSupabaseApi.delete("lead-1");

    expect(mockedSupabase.from).toHaveBeenCalledWith("leads");
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith("id", "lead-1");
  });
});

describe("Clients API - Data Transformation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getAll maps DB rows to Client objects with formatted premium", async () => {
    const mockRow = {
      id: "client-1",
      first_name: "Alice",
      last_name: "Wonder",
      phone: "(555) 222-3333",
      email: "alice@test.com",
      policy_type: "Whole Life",
      carrier: "Prudential",
      policy_number: "PRU-001",
      premium: 125.5,
      beneficiary_name: "Bob Wonder",
      beneficiary_relationship: "Spouse",
      beneficiary_phone: "(555) 222-4444",
      notes: "VIP client",
      assigned_agent_id: "u1",
      created_at: "2024-01-15T10:00:00Z",
      updated_at: "2024-06-01T10:00:00Z",
    };

    const chain = createChainableMock([mockRow]);
    mockedSupabase.from = vi.fn().mockReturnValue(chain);

    const { clientsSupabaseApi } = await import("@/lib/supabase-clients");
    const clients = await clientsSupabaseApi.getAll();

    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({
      id: "client-1",
      firstName: "Alice",
      lastName: "Wonder",
      policyType: "Whole Life",
      carrier: "Prudential",
      policyNumber: "PRU-001",
      premiumAmount: "$125.50",
      beneficiaryName: "Bob Wonder",
      beneficiaryRelationship: "Spouse",
    });
  });

  it("getAll applies search filter", async () => {
    const chain = createChainableMock([]);
    mockedSupabase.from = vi.fn().mockReturnValue(chain);

    const { clientsSupabaseApi } = await import("@/lib/supabase-clients");
    await clientsSupabaseApi.getAll("alice");

    expect(chain.or).toHaveBeenCalledWith(
      expect.stringContaining("first_name.ilike.%alice%")
    );
  });

  it("update parses premium string to number", async () => {
    const updateChain = createChainableMock(null);
    updateChain.update = vi.fn().mockReturnValue(updateChain);
    updateChain.eq = vi.fn().mockReturnValue(updateChain);
    updateChain.select = vi.fn().mockReturnValue(updateChain);
    updateChain.single = vi.fn().mockResolvedValue({
      data: {
        id: "client-1",
        first_name: "Alice",
        last_name: "Wonder",
        phone: "",
        email: "alice@test.com",
        policy_type: "Term",
        carrier: "Prudential",
        policy_number: "",
        premium: 150,
        beneficiary_name: "",
        beneficiary_relationship: "",
        beneficiary_phone: "",
        notes: "",
        assigned_agent_id: "u1",
        created_at: "2024-01-15T10:00:00Z",
        updated_at: "2024-06-01T10:00:00Z",
      },
      error: null,
    });
    mockedSupabase.from = vi.fn().mockReturnValue(updateChain);

    const { clientsSupabaseApi } = await import("@/lib/supabase-clients");
    await clientsSupabaseApi.update("client-1", { premiumAmount: "$150/mo" });

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ premium: 150 })
    );
  });

  it("delete calls supabase delete", async () => {
    const deleteChain = createChainableMock(null);
    deleteChain.delete = vi.fn().mockReturnValue(deleteChain);
    deleteChain.eq = vi.fn().mockResolvedValue({ data: null, error: null });
    mockedSupabase.from = vi.fn().mockReturnValue(deleteChain);

    const { clientsSupabaseApi } = await import("@/lib/supabase-clients");
    await clientsSupabaseApi.delete("client-1");

    expect(mockedSupabase.from).toHaveBeenCalledWith("clients");
    expect(deleteChain.delete).toHaveBeenCalled();
  });
});

describe("Recruits API - Data Transformation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getAll returns mapped Recruit objects", async () => {
    const mockRow = {
      id: "recruit-1",
      first_name: "Bob",
      last_name: "Builder",
      phone: "(555) 700-0001",
      email: "bob@test.com",
      status: "Interview",
      notes: "Promising candidate",
      assigned_agent_id: "u1",
      created_at: "2025-02-01T10:00:00Z",
      updated_at: "2025-02-05T10:00:00Z",
    };

    const chain = createChainableMock([mockRow]);
    mockedSupabase.from = vi.fn().mockReturnValue(chain);

    const { recruitsSupabaseApi } = await import("@/lib/supabase-recruits");
    const recruits = await recruitsSupabaseApi.getAll();

    expect(recruits).toHaveLength(1);
    expect(recruits[0]).toMatchObject({
      id: "recruit-1",
      firstName: "Bob",
      lastName: "Builder",
      phone: "(555) 700-0001",
      email: "bob@test.com",
      status: "Interview",
    });
  });

  it("create sends correct data structure", async () => {
    const createChain = createChainableMock(null);
    createChain.insert = vi.fn().mockReturnValue(createChain);
    createChain.select = vi.fn().mockReturnValue(createChain);
    createChain.single = vi.fn().mockResolvedValue({
      data: {
        id: "recruit-new",
        first_name: "New",
        last_name: "Recruit",
        phone: "(555) 700-0099",
        email: "new@test.com",
        status: "Prospect",
        notes: "",
        assigned_agent_id: "u1",
        created_at: "2025-03-01T10:00:00Z",
        updated_at: "2025-03-01T10:00:00Z",
      },
      error: null,
    });
    mockedSupabase.from = vi.fn().mockReturnValue(createChain);

    const { recruitsSupabaseApi } = await import("@/lib/supabase-recruits");
    const result = await recruitsSupabaseApi.create({
      firstName: "New",
      lastName: "Recruit",
      phone: "(555) 700-0099",
      email: "new@test.com",
      status: "Prospect",
      assignedAgentId: "u1",
    });

    expect(createChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: "New",
        last_name: "Recruit",
        phone: "(555) 700-0099",
        status: "Prospect",
      })
    );
    expect(result.firstName).toBe("New");
  });

  it("update maps fields correctly", async () => {
    const updateChain = createChainableMock(null);
    updateChain.update = vi.fn().mockReturnValue(updateChain);
    updateChain.eq = vi.fn().mockReturnValue(updateChain);
    updateChain.select = vi.fn().mockReturnValue(updateChain);
    updateChain.single = vi.fn().mockResolvedValue({
      data: {
        id: "recruit-1",
        first_name: "Bob",
        last_name: "Builder",
        phone: "(555) 700-0001",
        email: "bob@test.com",
        status: "Licensed",
        notes: "",
        assigned_agent_id: "u1",
        created_at: "2025-02-01T10:00:00Z",
        updated_at: "2025-03-01T10:00:00Z",
      },
      error: null,
    });
    mockedSupabase.from = vi.fn().mockReturnValue(updateChain);

    const { recruitsSupabaseApi } = await import("@/lib/supabase-recruits");
    const result = await recruitsSupabaseApi.update("recruit-1", { status: "Licensed" });

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "Licensed" })
    );
    expect(result.status).toBe("Licensed");
  });
});

describe("Notes API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getByContact returns mapped notes", async () => {
    const mockRow = {
      id: "note-1",
      contact_id: "lead-1",
      contact_type: "lead",
      content: "Interested in term life",
      author_id: "u1",
      author: null,
      created_at: "2025-01-15T10:00:00Z",
    };

    const chain = createChainableMock([mockRow]);
    mockedSupabase.from = vi.fn().mockReturnValue(chain);

    const { notesSupabaseApi } = await import("@/lib/supabase-notes");
    const notes = await notesSupabaseApi.getByContact("lead-1");

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: "note-1",
      contactId: "lead-1",
      contactType: "lead",
      note: "Interested in term life",
      pinned: false,
      agentId: "u1",
    });
  });

  it("add creates a note with correct parameters", async () => {
    const addChain = createChainableMock(null);
    addChain.insert = vi.fn().mockReturnValue(addChain);
    addChain.select = vi.fn().mockReturnValue(addChain);
    addChain.single = vi.fn().mockResolvedValue({
      data: {
        id: "note-new",
        contact_id: "lead-1",
        contact_type: "lead",
        content: "Follow up next week",
        author_id: "u1",
        author: null,
        created_at: "2025-03-01T10:00:00Z",
      },
      error: null,
    });
    mockedSupabase.from = vi.fn().mockReturnValue(addChain);

    const { notesSupabaseApi } = await import("@/lib/supabase-notes");
    const result = await notesSupabaseApi.add("lead-1", "lead", "Follow up next week", "u1");

    expect(addChain.insert).toHaveBeenCalledWith({
      contact_id: "lead-1",
      contact_type: "lead",
      content: "Follow up next week",
      author_id: "u1",
    });
    expect(result.note).toBe("Follow up next week");
  });

  it("togglePin throws not supported error", async () => {
    const { notesSupabaseApi } = await import("@/lib/supabase-notes");
    await expect(notesSupabaseApi.togglePin("note-1")).rejects.toThrow(
      "Pinning is not yet supported"
    );
  });
});

describe("Activities API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getByContact returns mapped activities", async () => {
    const mockRow = {
      id: "act-1",
      contact_id: "lead-1",
      contact_type: "lead",
      activity_type: "call",
      description: "Outbound call - 4:23 duration",
      agent_id: "u1",
      agent: null,
      metadata: { duration: 263 },
      created_at: "2025-01-15T10:00:00Z",
    };

    const chain = createChainableMock([mockRow]);
    mockedSupabase.from = vi.fn().mockReturnValue(chain);

    const { activitiesSupabaseApi } = await import("@/lib/supabase-activities");
    const activities = await activitiesSupabaseApi.getByContact("lead-1");

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      id: "act-1",
      contactId: "lead-1",
      contactType: "lead",
      type: "call",
      description: "Outbound call - 4:23 duration",
      metadata: { duration: 263 },
    });
  });

  it("add logs an activity with metadata", async () => {
    const addChain = createChainableMock(null);
    addChain.insert = vi.fn().mockReturnValue(addChain);
    addChain.select = vi.fn().mockReturnValue(addChain);
    addChain.single = vi.fn().mockResolvedValue({
      data: {
        id: "act-new",
        contact_id: "lead-1",
        contact_type: "lead",
        activity_type: "status",
        description: "Status changed to Hot",
        agent_id: "u1",
        agent: null,
        metadata: { oldStatus: "New", newStatus: "Hot" },
        created_at: "2025-03-01T10:00:00Z",
      },
      error: null,
    });
    mockedSupabase.from = vi.fn().mockReturnValue(addChain);

    const { activitiesSupabaseApi } = await import("@/lib/supabase-activities");
    const result = await activitiesSupabaseApi.add({
      contactId: "lead-1",
      contactType: "lead",
      type: "status",
      description: "Status changed to Hot",
      agentId: "u1",
      metadata: { oldStatus: "New", newStatus: "Hot" },
    });

    expect(addChain.insert).toHaveBeenCalledWith({
      contact_id: "lead-1",
      contact_type: "lead",
      activity_type: "status",
      description: "Status changed to Hot",
      agent_id: "u1",
      metadata: { oldStatus: "New", newStatus: "Hot" },
    });
    expect(result.type).toBe("status");
    expect(result.metadata).toEqual({ oldStatus: "New", newStatus: "Hot" });
  });
});
