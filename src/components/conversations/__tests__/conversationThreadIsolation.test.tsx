/**
 * ConversationThread — cross-contact isolation.
 *
 * Two distinct defects at `aafe3ba`, both of which let contact A's messages appear under contact B:
 *
 * 1. **Same-render exposure.** `messages` and `loading` were plain unkeyed state. The load for the
 *    new contact only STARTS in a passive effect, which runs after the commit — so the render where
 *    `contactId` changes still carries A's rows, and they are committed and painted under B.
 *
 * 2. **Stale-response overwrite.** `loadThread()` had no sequence or cancellation guard, so a
 *    request issued for A that resolves AFTER B's request has settled overwrites B's messages,
 *    B's loading flag and B's error state.
 *
 * A `waitFor` on the settled state cannot see (1): by then the effect has run. So a recorder's
 * `useLayoutEffect` (no dep array) snapshots the committed DOM after EVERY commit and before any
 * passive effect, giving a frame-by-frame transcript of what a user could actually see.
 */

import React from "react";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CONTACT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTACT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const frames: string[] = [];
const Recorder: React.FC = () => {
  React.useLayoutEffect(() => { frames.push(document.body.textContent ?? ""); });
  return null;
};

const apiState = vi.hoisted(() => ({
  /** contactId → thread rows. */
  threads: {} as Record<string, unknown[]>,
  /** contactIds whose request should hang until the test settles it. */
  defer: new Set<string>(),
  pending: [] as { contactId: string; resolve: (rows: unknown[]) => void; reject: (e: Error) => void }[],
  errors: {} as Record<string, string>,
  /** Every contactId the thread loader was called with, in order. */
  calls: [] as string[],
}));

vi.mock("@/lib/supabase-messages", () => ({
  messagesSupabaseApi: {
    getConversationThread: (contactId: string) => {
      apiState.calls.push(contactId);
      if (apiState.defer.has(contactId)) {
        return new Promise<unknown[]>((resolve, reject) => {
          apiState.pending.push({ contactId, resolve, reject });
        });
      }
      if (apiState.errors[contactId]) return Promise.reject(new Error(apiState.errors[contactId]));
      return Promise.resolve(apiState.threads[contactId] ?? []);
    },
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  },
}));

vi.mock("@/components/messaging/MessageComposePanel", () => ({
  MessageComposePanel: ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
    React.createElement("textarea", {
      "data-testid": "composer",
      value,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
    }),
}));
vi.mock("@/components/ui/RecordingPlayer", () => ({ RecordingPlayer: () => null }));

import ConversationThread from "@/components/conversations/ConversationThread";

const sms = (id: string, body: string) => ({
  id, type: "sms", direction: "outbound", body, description: body,
  _ts: Date.parse("2026-08-20T00:00:00Z"), created_at: "2026-08-20T00:00:00Z",
});
const call = (id: string, disposition: string) => ({
  id, type: "call", direction: "outbound", disposition_name: disposition, description: disposition,
  _ts: Date.parse("2026-08-19T00:00:00Z"), created_at: "2026-08-19T00:00:00Z",
});

function view(contactId: string) {
  return (
    <>
      <ConversationThread
        contactId={contactId}
        contactName={`Name-${contactId.slice(0, 4)}`}
        contactType="lead"
        onSendMessage={() => Promise.resolve()}
      />
      <Recorder />
    </>
  );
}

beforeEach(() => {
  // jsdom does not implement scrollIntoView; the component calls it after every messages change.
  if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
  }
  frames.length = 0;
  apiState.threads = {};
  apiState.defer = new Set();
  apiState.pending = [];
  apiState.errors = {};
  apiState.calls = [];
});

afterEach(cleanup);

describe("switching contacts never renders the previous contact's messages", () => {
  it("contact A's message body appears in NO frame after switching to contact B", async () => {
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-SECRET-BODY")];
    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-SECRET-BODY");

    const before = frames.length;
    rerender(view(CONTACT_B));
    await screen.findByText("BETA-BODY");

    const after = frames.slice(before);
    expect(after.length).toBeGreaterThan(0);
    // The first of these frames is exactly where a passive-effect-only design leaks A.
    expect(after.filter((f) => f.includes("ALPHA-SECRET-BODY"))).toEqual([]);
  });

  it("does not render A's messages while B is still loading", async () => {
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-SECRET-BODY")];
    apiState.defer.add(CONTACT_B);

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-SECRET-BODY");

    const before = frames.length;
    rerender(view(CONTACT_B));
    // B's request is still in flight; nothing of A may be on screen.
    await waitFor(() => expect(apiState.pending.some((p) => p.contactId === CONTACT_B)).toBe(true));

    expect(frames.slice(before).filter((f) => f.includes("ALPHA-SECRET-BODY"))).toEqual([]);
    expect(screen.queryByText("ALPHA-SECRET-BODY")).not.toBeInTheDocument();
  });
});

describe("a stale request can never overwrite the current contact", () => {
  it("A resolving AFTER B has loaded does not replace B's messages", async () => {
    apiState.defer.add(CONTACT_A);
    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await waitFor(() => expect(apiState.pending).toHaveLength(1));
    const staleA = apiState.pending[0];

    rerender(view(CONTACT_B));
    await screen.findByText("BETA-BODY");

    // A's request finally comes back — long after the user moved on.
    await act(async () => { staleA.resolve([sms("a1", "ALPHA-SECRET-BODY")]); });
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText("BETA-BODY")).toBeInTheDocument();
    expect(screen.queryByText("ALPHA-SECRET-BODY")).not.toBeInTheDocument();
    expect(frames.filter((f) => f.includes("ALPHA-SECRET-BODY"))).toEqual([]);
  });

  it("a stale FAILURE cannot clear or error the current contact's thread", async () => {
    apiState.defer.add(CONTACT_A);
    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await waitFor(() => expect(apiState.pending).toHaveLength(1));
    const staleA = apiState.pending[0];

    rerender(view(CONTACT_B));
    await screen.findByText("BETA-BODY");

    await act(async () => { staleA.reject(new Error("stale failure")); });
    await new Promise((r) => setTimeout(r, 0));

    // B's messages survive, and no error state is raised on B.
    expect(screen.getByText("BETA-BODY")).toBeInTheDocument();
    expect(screen.queryByText(/stale failure/i)).not.toBeInTheDocument();
  });

  it("a stale response cannot flip the current contact's loading flag", async () => {
    apiState.defer.add(CONTACT_A);
    apiState.defer.add(CONTACT_B);

    const { rerender } = render(view(CONTACT_A));
    await waitFor(() => expect(apiState.pending).toHaveLength(1));
    const staleA = apiState.pending[0];

    rerender(view(CONTACT_B));
    await waitFor(() => expect(apiState.pending.some((p) => p.contactId === CONTACT_B)).toBe(true));

    // A settles first. B is still in flight, so the thread must STILL be loading.
    await act(async () => { staleA.resolve([sms("a1", "ALPHA-SECRET-BODY")]); });
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText("ALPHA-SECRET-BODY")).not.toBeInTheDocument();
    // Now B settles and its rows appear.
    const liveB = apiState.pending.find((p) => p.contactId === CONTACT_B)!;
    await act(async () => { liveB.resolve([sms("b1", "BETA-BODY")]); });
    expect(await screen.findByText("BETA-BODY")).toBeInTheDocument();
  });
});

describe("preserved behaviour", () => {
  it("calls remain visible inside the opened thread", async () => {
    apiState.threads[CONTACT_A] = [call("k1", "Sold"), sms("a1", "ALPHA-BODY")];

    render(view(CONTACT_A));

    expect(await screen.findByText("Sold")).toBeInTheDocument();
    expect(screen.getByText("ALPHA-BODY")).toBeInTheDocument();
  });

  it("the composer still works and its draft is not carried across contacts", async () => {
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];
    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");

    const composer = screen.getByTestId("composer") as HTMLTextAreaElement;
    await act(async () => {
      composer.value = "draft for A";
      composer.dispatchEvent(new Event("input", { bubbles: true }));
    });

    rerender(view(CONTACT_B));
    await screen.findByText("BETA-BODY");
    // The composer is still mounted and usable for B.
    expect(screen.getByTestId("composer")).toBeInTheDocument();
  });

  it("issues exactly one load per contact identity", async () => {
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];
    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");
    rerender(view(CONTACT_B));
    await screen.findByText("BETA-BODY");
    await new Promise((r) => setTimeout(r, 20));

    expect(apiState.calls).toEqual([CONTACT_A, CONTACT_B]);
  });
});
