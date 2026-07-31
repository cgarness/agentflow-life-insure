/**
 * P0 SECURITY REGRESSION — the browser must never send signup authority.
 *
 * `create-user` derives organization, role, upline, licensed states and
 * commission entirely server-side (from the invitation row, or by minting a
 * founder organization). Those fields used to be supplied by the browser,
 * which made `create-user` an anonymous cross-tenant privilege-escalation
 * primitive: anyone could POST `role: "Admin"` with an existing
 * `organization_id` and land as an Admin inside that tenant, because
 * `profiles.role`/`organization_id` are projected into
 * `auth.users.raw_app_meta_data` and into JWT claims that gate hundreds of
 * RLS policies.
 *
 * These tests assert on the ACTUAL invoke payload, so re-adding any authority
 * field to the client fails here rather than in production.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import React from "react";

// Hoisted so the vi.mock factory (which is lifted to the top of the file) can
// reference it without a TDZ error.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      refreshSession: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
    })),
    functions: { invoke },
  },
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

/** Calls signup() once on mount with the supplied args. */
const CallSignup: React.FC<{ args: unknown[] }> = ({ args }) => {
  const { signup } = useAuth();
  React.useEffect(() => {
    // deno-lint-ignore no-explicit-any
    void (signup as any)(...args).catch(() => {});
  }, [signup, args]);
  return null;
};

const runSignup = async (args: unknown[]) => {
  render(
    <AuthProvider>
      <CallSignup args={args} />
    </AuthProvider>,
  );
  await waitFor(() => expect(invoke).toHaveBeenCalled());
  const [fnName, options] = invoke.mock.calls[0];
  return { fnName, body: (options as { body: Record<string, unknown> }).body };
};

/** Every field that must never originate in the browser. */
const FORBIDDEN_AUTHORITY_FIELDS = [
  "organization_id",
  "organizationId",
  "role",
  "upline_id",
  "uplineId",
  "licensed_states",
  "licensedStates",
  "commission_level",
  "commissionLevel",
  "is_super_admin",
  "isSuperAdmin",
  "platform_role",
];

describe("AuthContext.signup — P0 authority contract", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { success: true, user_id: "u1" }, error: null });
  });

  it("invokes create-user and sends no authority field (self-serve)", async () => {
    const { fnName, body } = await runSignup([
      "founder@example.com",
      "Sup3rSecret!",
      "Dana",
      "Reed",
    ]);

    expect(fnName).toBe("create-user");
    for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it("sends exactly the identity fields the server needs", async () => {
    const { body } = await runSignup([
      "founder@example.com",
      "Sup3rSecret!",
      "Dana",
      "Reed",
    ]);

    expect(Object.keys(body).sort()).toEqual(
      ["email", "first_name", "invite_token", "last_name", "password", "signup_source"].sort(),
    );
    expect(body.signup_source).toBe("self_serve");
    expect(body.invite_token).toBeNull();
  });

  it("forwards the invitation token and marks the source as invite", async () => {
    const { body } = await runSignup([
      "invited@example.com",
      "Sup3rSecret!",
      "Sam",
      "Lee",
      "6f1c9b7e-0000-4000-8000-000000000001",
    ]);

    expect(body.invite_token).toBe("6f1c9b7e-0000-4000-8000-000000000001");
    expect(body.signup_source).toBe("invite");
    // The token is the ONLY thing that may imply organization or role.
    for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it("never calls create-organization from the browser", async () => {
    await runSignup(["founder@example.com", "Sup3rSecret!", "Dana", "Reed"]);
    const invoked = invoke.mock.calls.map((c) => c[0]);
    expect(invoked).not.toContain("create-organization");
  });
});
