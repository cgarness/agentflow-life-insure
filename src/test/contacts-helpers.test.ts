import { describe, it, expect } from "vitest";
import { mockLeads, mockClients, mockRecruits, mockNotes, mockActivities, calcAging, getAgentName, getAgentInitials } from "@/lib/mock-data";

describe("Mock Data - Lead Data Integrity", () => {
  it("all mock leads have required fields", () => {
    mockLeads.forEach((lead) => {
      expect(lead.id).toBeTruthy();
      expect(lead.firstName).toBeTruthy();
      expect(lead.lastName).toBeTruthy();
      expect(lead.phone).toBeTruthy();
      expect(lead.email).toBeTruthy();
      expect(lead.state).toBeTruthy();
      expect(lead.status).toBeTruthy();
      expect(lead.leadSource).toBeTruthy();
      expect(typeof lead.leadScore).toBe("number");
      expect(lead.assignedAgentId).toBeTruthy();
      expect(lead.createdAt).toBeTruthy();
      expect(lead.updatedAt).toBeTruthy();
    });
  });

  it("lead statuses are valid values", () => {
    const validStatuses = ["New", "Contacted", "Interested", "Follow Up", "Hot", "Not Interested", "Closed Won", "Closed Lost"];
    mockLeads.forEach((lead) => {
      expect(validStatuses).toContain(lead.status);
    });
  });

  it("lead scores are in valid range (1-10)", () => {
    mockLeads.forEach((lead) => {
      expect(lead.leadScore).toBeGreaterThanOrEqual(1);
      expect(lead.leadScore).toBeLessThanOrEqual(10);
    });
  });

  it("lead sources are valid values", () => {
    const validSources = ["Facebook Ads", "Google Ads", "Direct Mail", "Referral", "Webinar"];
    mockLeads.forEach((lead) => {
      expect(validSources).toContain(lead.leadSource);
    });
  });

  it("mock leads have unique IDs", () => {
    const ids = mockLeads.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("mock leads have valid email format", () => {
    mockLeads.forEach((lead) => {
      expect(lead.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    });
  });
});

describe("Mock Data - Client Data Integrity", () => {
  it("all mock clients have required fields", () => {
    mockClients.forEach((client) => {
      expect(client.id).toBeTruthy();
      expect(client.firstName).toBeTruthy();
      expect(client.lastName).toBeTruthy();
      expect(client.email).toBeTruthy();
      expect(client.policyType).toBeTruthy();
      expect(client.carrier).toBeTruthy();
      expect(client.createdAt).toBeTruthy();
    });
  });

  it("client policy types are valid", () => {
    const validTypes = ["Term", "Whole Life", "IUL", "Final Expense"];
    mockClients.forEach((client) => {
      expect(validTypes).toContain(client.policyType);
    });
  });

  it("client premiums are formatted as currency strings", () => {
    mockClients.forEach((client) => {
      expect(client.premiumAmount).toMatch(/^\$/);
    });
  });

  it("client face amounts are formatted as currency strings", () => {
    mockClients.forEach((client) => {
      expect(client.faceAmount).toMatch(/^\$/);
    });
  });

  it("mock clients have unique IDs", () => {
    const ids = mockClients.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Mock Data - Recruit Data Integrity", () => {
  it("all mock recruits have required fields", () => {
    mockRecruits.forEach((recruit) => {
      expect(recruit.id).toBeTruthy();
      expect(recruit.firstName).toBeTruthy();
      expect(recruit.lastName).toBeTruthy();
      expect(recruit.email).toBeTruthy();
      expect(recruit.status).toBeTruthy();
      expect(recruit.assignedAgentId).toBeTruthy();
    });
  });

  it("recruit statuses are valid", () => {
    const validStatuses = ["Prospect", "Contacted", "Interview", "Licensed", "Active"];
    mockRecruits.forEach((recruit) => {
      expect(validStatuses).toContain(recruit.status);
    });
  });

  it("mock recruits have unique IDs", () => {
    const ids = mockRecruits.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Mock Data - Notes Data Integrity", () => {
  it("all mock notes have required fields", () => {
    mockNotes.forEach((note) => {
      expect(note.id).toBeTruthy();
      expect(note.contactId).toBeTruthy();
      expect(note.contactType).toBeTruthy();
      expect(note.note).toBeTruthy();
      expect(typeof note.pinned).toBe("boolean");
      expect(note.agentId).toBeTruthy();
      expect(note.agentName).toBeTruthy();
      expect(note.createdAt).toBeTruthy();
    });
  });

  it("note contact types are valid", () => {
    const validTypes = ["lead", "client", "recruit", "agent"];
    mockNotes.forEach((note) => {
      expect(validTypes).toContain(note.contactType);
    });
  });
});

describe("Mock Data - Activities Data Integrity", () => {
  it("all mock activities have required fields", () => {
    mockActivities.forEach((activity) => {
      expect(activity.id).toBeTruthy();
      expect(activity.contactId).toBeTruthy();
      expect(activity.contactType).toBeTruthy();
      expect(activity.type).toBeTruthy();
      expect(activity.description).toBeTruthy();
      expect(activity.agentId).toBeTruthy();
      expect(activity.createdAt).toBeTruthy();
    });
  });

  it("activity types are meaningful", () => {
    const validTypes = ["call", "note", "status", "email", "appointment"];
    mockActivities.forEach((activity) => {
      expect(validTypes).toContain(activity.type);
    });
  });
});

describe("Helper Functions", () => {
  describe("calcAging", () => {
    it("returns a large fallback value for undefined input", () => {
      // calcAging returns 999 when no lastContactedAt is provided
      expect(calcAging(undefined)).toBe(999);
    });

    it("returns 0 for today's date", () => {
      expect(calcAging(new Date().toISOString())).toBe(0);
    });

    it("returns correct days for past dates", () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
      const aging = calcAging(twoDaysAgo);
      expect(aging).toBeGreaterThanOrEqual(1);
      expect(aging).toBeLessThanOrEqual(3);
    });

    it("returns higher number for older dates", () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
      const aging = calcAging(tenDaysAgo);
      expect(aging).toBeGreaterThanOrEqual(9);
      expect(aging).toBeLessThanOrEqual(11);
    });
  });

  describe("getAgentName", () => {
    it("returns correct name for known agent IDs", () => {
      expect(getAgentName("u1")).toContain("Chris");
      expect(getAgentName("u2")).toContain("Sarah");
    });

    it("returns a fallback for unknown agent IDs", () => {
      const name = getAgentName("unknown-id");
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    });
  });

  describe("getAgentInitials", () => {
    it("returns initials for known agent IDs", () => {
      const initials = getAgentInitials("u1");
      expect(initials).toBeTruthy();
      expect(initials.length).toBeLessThanOrEqual(3);
    });

    it("returns fallback initials for unknown IDs", () => {
      const initials = getAgentInitials("unknown");
      expect(typeof initials).toBe("string");
    });
  });
});
