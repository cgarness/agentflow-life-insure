/**
 * V2 simple labels in the agent modal: the goal labels match Settings ("Monthly Calls Goal",
 * "Monthly Appointments Goal"); the stored goal values are shown unchanged.
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isImpersonating: false }) }));
vi.mock("@/components/PermissionGate", () => ({ CommissionGate: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));
vi.mock("@/lib/supabase-notes", () => ({ notesSupabaseApi: { getByContact: async () => [] } }));
vi.mock("@/lib/supabase-activities", () => ({ activitiesSupabaseApi: { getByContact: async () => [] } }));
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  q.select = () => q; q.eq = () => q;
  q.single = () => Promise.resolve({ data: { id: "agent-1", monthly_call_goal: 300, monthly_policies_goal: 6, monthly_appointment_goal: 12, monthly_premium_goal: 5000 }, error: null });
  return { supabase: { from: () => q } };
});

import AgentModal from "@/components/contacts/AgentModal";
import type { User } from "@/lib/types";

afterEach(cleanup);

const agent = { id: "agent-1", firstName: "Avery", lastName: "Adams", email: "avery@example.test", role: "Agent", status: "Active",
  availabilityStatus: "Available", avatar: "", phone: "" } as unknown as User;

describe("AgentModal goal labels", () => {
  it("uses the Settings goal names and shows the stored goals unchanged", async () => {
    render(<AgentModal agent={agent} onClose={() => {}} />);
    const calls = await screen.findByText("Monthly Calls Goal");
    expect(await screen.findByText("300")).toBeInTheDocument();
    expect(calls.parentElement).toHaveTextContent("300");
    expect(screen.getByText("Monthly Appointments Goal").parentElement).toHaveTextContent("12");
    expect(screen.getByText("Monthly Policies Goal").parentElement).toHaveTextContent("6");
    expect(screen.queryByText(/Monthly Call Goal|Monthly Appt\. Goal/)).not.toBeInTheDocument();
  });
});
