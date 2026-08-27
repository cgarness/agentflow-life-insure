/**
 * The CALLER half of the server-authoritative "View As" repair.
 *
 * `startImpersonation` is now asynchronous and returns `Promise<boolean>` precisely so a caller
 * cannot route into a session that was refused. That guarantee lives entirely in the callers, and
 * it is easy to lose silently:
 *
 *   - dropping the `await` makes the returned Promise truthy, so `if (!activated)` is ALWAYS false
 *     and every refusal navigates anyway — and TypeScript does not complain, because `!somePromise`
 *     is perfectly legal;
 *   - navigating before the await resolves has the same effect.
 *
 * Neither mistake is visible in a type error or in any other suite, so it is pinned here.
 */

import React from "react";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const SUPER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TARGET_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const authState = vi.hoisted(() => ({
  /** What `startImpersonation` resolves to. */
  result: true,
  /** Arguments it was called with, in order. */
  calls: [] as unknown[],
  /** When true the activation hangs until `release()` is called. */
  defer: false,
  release: null as null | (() => void),
}));

const navState = vi.hoisted(() => ({ to: [] as string[] }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: SUPER_ID },
    startImpersonation: (target: unknown) => {
      authState.calls.push(target);
      if (authState.defer) {
        return new Promise<boolean>((resolve) => {
          authState.release = () => resolve(authState.result);
        });
      }
      return Promise.resolve(authState.result);
    },
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => (to: string) => { navState.to.push(to); },
}));

vi.mock("@/lib/supabase-users", () => ({
  usersSupabaseApi: {
    getAll: () => Promise.resolve([
      {
        id: TARGET_ID, email: "t@x.test", firstName: "Tara", lastName: "Target", role: "Agent",
        status: "Active", availabilityStatus: "Available", themePreference: "light",
        isSuperAdmin: false, lastLoginAt: null, createdAt: "2026-01-01T00:00:00Z",
        profile: { userId: TARGET_ID, organizationId: ORG, licensedStates: [], carriers: [] },
      },
    ]),
  },
}));

const toastCalls = vi.hoisted(() => ({ errors: [] as string[] }));
vi.mock("sonner", () => ({
  toast: { error: (m: string) => { toastCalls.errors.push(m); }, success: () => {} },
}));

import ViewAsModal from "@/components/layout/ViewAsModal";

beforeEach(() => {
  authState.result = true;
  authState.calls = [];
  authState.defer = false;
  authState.release = null;
  navState.to = [];
  toastCalls.errors = [];
});

afterEach(cleanup);

const openModal = () =>
  render(<ViewAsModal open onClose={() => {}} currentUserId={SUPER_ID} />);

describe("ViewAsModal passes a POINTER, never a profile", () => {
  it("hands startImpersonation the target's id and nothing else", async () => {
    openModal();
    fireEvent.click(await screen.findByText(/Tara Target/));

    await waitFor(() => expect(authState.calls).toHaveLength(1));
    // A bare id. Anything object-shaped here would put the caller's own claims back on the wire.
    expect(authState.calls[0]).toBe(TARGET_ID);
    expect(typeof authState.calls[0]).toBe("string");
  });
});

describe("ViewAsModal navigates only on a CONFIRMED activation", () => {
  it("navigates when the activation resolves true", async () => {
    authState.result = true;
    openModal();
    fireEvent.click(await screen.findByText(/Tara Target/));

    await waitFor(() => expect(navState.to).toEqual(["/dashboard"]));
    expect(toastCalls.errors).toEqual([]);
  });

  it("does NOT navigate when the activation resolves false", async () => {
    authState.result = false;
    openModal();
    fireEvent.click(await screen.findByText(/Tara Target/));

    await waitFor(() => expect(authState.calls).toHaveLength(1));
    // Flush anything the handler might still do after the await.
    await act(async () => { await Promise.resolve(); });

    expect(navState.to, "navigated into a session that was refused").toEqual([]);
    expect(toastCalls.errors.length).toBe(1);
  });

  it("does not navigate BEFORE the activation settles", async () => {
    // Catches an `await` that was dropped, or a navigate hoisted above it: either way the route
    // changes while the server round-trip is still outstanding.
    authState.defer = true;
    authState.result = false;
    openModal();
    fireEvent.click(await screen.findByText(/Tara Target/));

    await waitFor(() => expect(authState.release).toBeTypeOf("function"));
    expect(navState.to, "navigated while the activation was still in flight").toEqual([]);

    await act(async () => { authState.release!(); });
    expect(navState.to).toEqual([]);
  });

  it("blocks a second activation while one is in flight", async () => {
    authState.defer = true;
    authState.result = true;
    openModal();
    const row = await screen.findByText(/Tara Target/);

    fireEvent.click(row);
    await waitFor(() => expect(authState.release).toBeTypeOf("function"));
    fireEvent.click(row);
    fireEvent.click(row);

    expect(authState.calls).toHaveLength(1);

    await act(async () => { authState.release!(); });
    expect(navState.to).toEqual(["/dashboard"]);
  });
});
