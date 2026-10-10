import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      const result = mocks.rpc(...args) ?? { data: null, error: null };
      return Object.assign(Promise.resolve(result), { maybeSingle: () => mocks.maybeSingle() });
    },
    functions: { invoke: (...args: unknown[]) => mocks.invoke(...args) },
  },
}));

import {
  fetchMyEmailSubscriptions,
  setMyOnboardingEmailOptOut,
  submitUnsubscribe,
  unsubscribeTokenSchema,
} from "../emailSubscriptions";

const TOKEN = "v1.eyJ1IjoiMDAwIn0.c2lnbmF0dXJl";

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.maybeSingle.mockReset();
  mocks.invoke.mockReset();
});

describe("unsubscribeTokenSchema", () => {
  it("accepts the signed token shape and rejects everything else", () => {
    expect(unsubscribeTokenSchema.safeParse(TOKEN).success).toBe(true);
    for (const bad of ["", "v1", "v2.a.b", "v1.a b.c", "javascript:alert(1)", `v1.${"a".repeat(600)}.b`]) {
      expect(unsubscribeTokenSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("fetchMyEmailSubscriptions", () => {
  it("calls only the caller-scoped RPC and validates the row", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { onboarding_program_enabled: true, onboarding_opted_out: false }, error: null });
    await expect(fetchMyEmailSubscriptions()).resolves.toEqual({ onboarding_program_enabled: true, onboarding_opted_out: false });
    expect(mocks.rpc).toHaveBeenCalledWith("get_my_email_subscriptions");
  });

  it("returns null for no row, and throws on an error or a malformed row (never a fake default)", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(fetchMyEmailSubscriptions()).resolves.toBeNull();
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(fetchMyEmailSubscriptions()).rejects.toThrow(/couldn't load/i);
    mocks.maybeSingle.mockResolvedValue({ data: { onboarding_program_enabled: "yes" }, error: null });
    await expect(fetchMyEmailSubscriptions()).rejects.toThrow(/couldn't read/i);
  });
});

describe("setMyOnboardingEmailOptOut", () => {
  it("sends only the boolean to the RPC and returns the stored state", async () => {
    mocks.rpc.mockReturnValue({ data: true, error: null });
    await expect(setMyOnboardingEmailOptOut({ optedOut: true })).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("set_my_onboarding_email_opt_out", { p_opted_out: true });
  });

  it("rejects non-boolean input before any request, and surfaces server errors", async () => {
    await expect(setMyOnboardingEmailOptOut({ optedOut: "true" as unknown as boolean })).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockReturnValue({ data: null, error: { message: "42501" } });
    await expect(setMyOnboardingEmailOptOut({ optedOut: false })).rejects.toThrow(/couldn't save/i);
  });
});

describe("submitUnsubscribe", () => {
  it("posts the token to email-unsubscribe and reports success only on {ok:true}", async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(submitUnsubscribe(TOKEN)).resolves.toBe("unsubscribed");
    expect(mocks.invoke).toHaveBeenCalledWith("email-unsubscribe", { body: { token: TOKEN } });
  });

  it("maps a malformed token, a 400 and other failures without calling or faking success", async () => {
    await expect(submitUnsubscribe("not-a-token")).resolves.toBe("invalid");
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.invoke.mockResolvedValue({ data: null, error: { context: { status: 400 } } });
    await expect(submitUnsubscribe(TOKEN)).resolves.toBe("invalid");
    mocks.invoke.mockResolvedValue({ data: null, error: { context: { status: 503 } } });
    await expect(submitUnsubscribe(TOKEN)).resolves.toBe("error");
    mocks.invoke.mockResolvedValue({ data: { ok: false }, error: null });
    await expect(submitUnsubscribe(TOKEN)).resolves.toBe("error");
    mocks.invoke.mockRejectedValue(new Error("offline"));
    await expect(submitUnsubscribe(TOKEN)).resolves.toBe("error");
  });
});
