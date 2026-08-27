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
const OTHER_USER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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

const listState = vi.hoisted(() => ({
  /** Rows returned by usersApi.getAll, keyed so a stale response can be distinguished. */
  rows: [] as Record<string, unknown>[],
  /** When set, the list request rejects. */
  error: null as string | null,
  /** When true the request hangs until `release()` is called. */
  defer: false,
  pending: [] as { rows: Record<string, unknown>[]; release: () => void }[],
  calls: 0,
}));

vi.mock("@/lib/supabase-users", () => ({
  usersSupabaseApi: {
    getAll: () => {
      listState.calls += 1;
      if (listState.error) return Promise.reject(new Error(listState.error));
      const rows = listState.rows;
      if (listState.defer) {
        return new Promise<Record<string, unknown>[]>((resolve) => {
          listState.pending.push({ rows, release: () => resolve(rows) });
        });
      }
      return Promise.resolve(rows);
    },
  },
}));

const userRow = (id: string, first: string) => ({
  id, email: `${first}@x.test`, firstName: first, lastName: "Target", role: "Agent",
  status: "Active", availabilityStatus: "Available", themePreference: "light",
  isSuperAdmin: false, lastLoginAt: null, createdAt: "2026-01-01T00:00:00Z",
  profile: { userId: id, organizationId: ORG, licensedStates: [], carriers: [] },
});

const toastCalls = vi.hoisted(() => ({ errors: [] as string[] }));
vi.mock("sonner", () => ({
  toast: { error: (m: string) => { toastCalls.errors.push(m); }, success: () => {} },
}));

import ViewAsModal from "@/components/layout/ViewAsModal";

beforeEach(() => {
  listState.rows = [userRow(TARGET_ID, "Tara")];
  listState.error = null;
  listState.defer = false;
  listState.pending = [];
  listState.calls = 0;
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

describe("ViewAsModal — a failed user-list load must not spin forever", () => {
  const spinner = () => document.querySelector(".animate-spin");

  it("a rejected list request stops spinning", async () => {
    // Asserted FIRST and on its own: this is the actual defect — no `.catch` at all, so `loading`
    // stayed true forever. A test that opened with `findByText(/couldn't load users/i)` would fail
    // at b38253e merely because a new string does not exist yet, which proves nothing.
    listState.error = "network down";
    openModal();

    await waitFor(() => expect(spinner(), "the modal is still spinning after a failed load").toBeNull());
    expect(screen.queryByText(/no users found/i), "a failed load rendered as an empty list").not.toBeInTheDocument();
  });

  it("a rejected list request settles into an inline error with Retry", async () => {
    listState.error = "network down";
    openModal();

    expect(await screen.findByText(/couldn't load users/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("Retry issues exactly one fresh request and recovers", async () => {
    listState.error = "network down";
    openModal();
    await screen.findByText(/couldn't load users/i);

    listState.error = null;
    const before = listState.calls;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByText(/Tara Target/)).toBeInTheDocument();
    expect(listState.calls - before, "Retry must issue exactly one request").toBe(1);
    expect(screen.queryByText(/couldn't load users/i)).not.toBeInTheDocument();
  });

  // POSITIVE CONTROL — PASSES at b38253e. The error state must not swallow a real empty result.
  it("a genuinely empty organization still reads as empty, not as an error", async () => {
    listState.rows = [];
    openModal();

    expect(await screen.findByText(/no users found/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load users/i)).not.toBeInTheDocument();
  });

  // NOTE, honestly: PASSES at b38253e, where the effect's `setLoading(true)` happened to hide the
  // rows behind the spinner. It is kept because the render-time key match is now what guarantees it,
  // and that guard IS mutation-pinned by the stale-response test below.
  it("changing currentUserId immediately hides the previous account's rows", async () => {
    listState.rows = [userRow(TARGET_ID, "Tara"), userRow(OTHER_USER_ID, "Otto")];
    const { rerender } = render(<ViewAsModal open onClose={() => {}} currentUserId={SUPER_ID} />);
    await screen.findByText(/Tara Target/);

    // Otto is now the signed-in Super Admin, so Otto must be excluded — and Tara's row must not be
    // painted from the previous viewer's response while the new one is still in flight.
    listState.defer = true;
    rerender(<ViewAsModal open onClose={() => {}} currentUserId={OTHER_USER_ID} />);

    expect(screen.queryByText(/Tara Target/), "the previous viewer's rows survived the switch").not.toBeInTheDocument();
  });

  it("a stale response from an earlier open cannot repaint the current modal", async () => {
    listState.rows = [userRow(TARGET_ID, "Tara")];
    listState.defer = true;
    const { rerender } = render(<ViewAsModal open onClose={() => {}} currentUserId={SUPER_ID} />);
    await waitFor(() => expect(listState.pending).toHaveLength(1));
    const staleRequest = listState.pending[0];

    // The modal closes and reopens for a different viewer; that request resolves first.
    listState.rows = [userRow(OTHER_USER_ID, "Otto")];
    listState.defer = false;
    rerender(<ViewAsModal open onClose={() => {}} currentUserId={SUPER_ID} />);
    rerender(<ViewAsModal open={false} onClose={() => {}} currentUserId={SUPER_ID} />);
    rerender(<ViewAsModal open onClose={() => {}} currentUserId={SUPER_ID} />);
    await screen.findByText(/Otto Target/);

    // The very first request finally comes back.
    await act(async () => { staleRequest.release(); await Promise.resolve(); });

    expect(screen.queryByText(/Tara Target/), "a stale list response repainted the modal").not.toBeInTheDocument();
    expect(screen.getByText(/Otto Target/)).toBeInTheDocument();
  });

  it("a hung activation does not permanently disable every row", async () => {
    // `activatingId` is cleared in a `finally`, which never runs if the promise never settles.
    // Closing and reopening must recover the modal rather than leaving every row disabled forever.
    authState.defer = true;
    const { rerender } = render(<ViewAsModal open onClose={() => {}} currentUserId={SUPER_ID} />);
    fireEvent.click(await screen.findByText(/Tara Target/));
    await waitFor(() => expect(authState.release).toBeTypeOf("function"));

    const rowButton = (await screen.findByText(/Tara Target/)).closest("button")!;
    expect(rowButton).toBeDisabled();

    rerender(<ViewAsModal open={false} onClose={() => {}} currentUserId={SUPER_ID} />);
    rerender(<ViewAsModal open onClose={() => {}} currentUserId={SUPER_ID} />);

    const reopened = (await screen.findByText(/Tara Target/)).closest("button")!;
    expect(reopened, "every row is still disabled after reopening").not.toBeDisabled();
  });

  it("reopening does not repaint the previous open's stale error or rows", async () => {
    // The list key must distinguish one OPEN from the next. Reusing it means the previous open's
    // committed state — an error with a Retry button, or a row for a user since deactivated — is
    // painted again while a fresh request is already in flight.
    listState.error = "network down";
    const { rerender } = render(<ViewAsModal open onClose={() => {}} currentUserId={SUPER_ID} />);
    await screen.findByText(/couldn't load users/i);

    listState.error = null;
    listState.defer = true;
    rerender(<ViewAsModal open={false} onClose={() => {}} currentUserId={SUPER_ID} />);
    rerender(<ViewAsModal open onClose={() => {}} currentUserId={SUPER_ID} />);

    // Reopened with a request outstanding: the previous failure must not still be on screen.
    expect(screen.queryByText(/couldn't load users/i), "a stale error was repainted on reopen").not.toBeInTheDocument();
    expect(spinner(), "the reopened modal should be loading").not.toBeNull();
  });

  it("closing and reopening after a failure retries rather than showing a stale error", async () => {
    listState.error = "network down";
    const { rerender } = render(<ViewAsModal open onClose={() => {}} currentUserId={SUPER_ID} />);
    await screen.findByText(/couldn't load users/i);

    listState.error = null;
    rerender(<ViewAsModal open={false} onClose={() => {}} currentUserId={SUPER_ID} />);
    rerender(<ViewAsModal open onClose={() => {}} currentUserId={SUPER_ID} />);

    expect(await screen.findByText(/Tara Target/)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load users/i)).not.toBeInTheDocument();
  });
});
