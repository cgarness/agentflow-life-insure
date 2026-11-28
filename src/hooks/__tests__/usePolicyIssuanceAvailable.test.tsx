import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePolicyIssuanceAvailable } from "../usePolicyIssuanceAvailable";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({supabase: {rpc}}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const asked = () => rpc.mock.calls.filter(call => call[0] === "policy_issuance_available").length;

describe("usePolicyIssuanceAvailable", () => {
  it("is false until the server says the agency confirms issuance, then true, with one request per agency", async () => {
    rpc.mockResolvedValue({data: true, error: null});
    const first = renderHook(() => usePolicyIssuanceAvailable("pilot-agency"));
    expect(first.result.current).toBe(false);
    await waitFor(() => expect(first.result.current).toBe(true));
    const second = renderHook(() => usePolicyIssuanceAvailable("pilot-agency"));
    await waitFor(() => expect(second.result.current).toBe(true));
    expect(asked()).toBe(1);
  });

  it("stays false for an agency outside the pilot", async () => {
    rpc.mockResolvedValue({data: false, error: null});
    const view = renderHook(() => usePolicyIssuanceAvailable("other-agency"));
    await waitFor(() => expect(asked()).toBe(1));
    await new Promise(settle => setTimeout(settle, 0));
    expect(view.result.current).toBe(false);
  });

  it("treats a failed read as not available and asks again next time", async () => {
    rpc.mockResolvedValueOnce({data: null, error: {code: "57014", message: "canceling statement"}});
    const failed = renderHook(() => usePolicyIssuanceAvailable("flaky-agency"));
    await waitFor(() => expect(asked()).toBe(1));
    await new Promise(settle => setTimeout(settle, 0));
    expect(failed.result.current).toBe(false);
    rpc.mockResolvedValueOnce({data: true, error: null});
    const retried = renderHook(() => usePolicyIssuanceAvailable("flaky-agency"));
    await waitFor(() => expect(retried.result.current).toBe(true));
    expect(asked()).toBe(2);
  });

  it("is false without an agency and asks nothing", () => {
    const view = renderHook(() => usePolicyIssuanceAvailable(null));
    expect(view.result.current).toBe(false);
    expect(asked()).toBe(0);
  });
});
