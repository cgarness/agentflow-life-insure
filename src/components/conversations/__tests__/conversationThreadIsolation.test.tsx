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
import { render, screen, cleanup, waitFor, act, fireEvent } from "@testing-library/react";
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

/**
 * A realtime mock that RECORDS what the component subscribed to and hands the test the registered
 * callbacks, so an already-queued callback can be fired after a contact switch — the only way to
 * reproduce a stale-START.
 */
interface RecordedHandler { table: string; filter?: string; cb: () => void }
interface RecordedChannel { name: string; handlers: RecordedHandler[]; removed: boolean; api: unknown }

const channelState = vi.hoisted(() => ({ channels: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string) => {
      const entry: RecordedChannel = { name, handlers: [], removed: false, api: null };
      const api = {
        on(_event: string, cfg: { table: string; filter?: string }, cb: () => void) {
          entry.handlers.push({ table: cfg.table, filter: cfg.filter, cb });
          return api;
        },
        subscribe() { return api; },
      };
      entry.api = api;
      channelState.channels.push(entry);
      return api;
    },
    removeChannel: (ch: unknown) => {
      const hit = (channelState.channels as RecordedChannel[]).find((c) => c.api === ch);
      if (hit) hit.removed = true;
    },
  },
}));

const channels = () => channelState.channels as RecordedChannel[];
/** The live (not yet torn down) channel for one contact. */
const channelFor = (contactId: string) =>
  channels().find((c) => c.name === `thread-${contactId}`);
/** One registered handler, selected by table and by the column its filter targets. */
const handlerFor = (contactId: string, table: string, column: string) =>
  channelFor(contactId)?.handlers.find((h) => h.table === table && h.filter?.startsWith(`${column}=`));

/**
 * Faithful to the real `MessageComposePanel` prop contract (see
 * src/components/messaging/MessageComposePanel.tsx): the panel is STATELESS — message text,
 * subject and the selected channel are all owned by `ConversationThread`. So every one of them is
 * exposed here, otherwise "the draft was cleared" cannot be asserted at all.
 */
vi.mock("@/components/messaging/MessageComposePanel", () => ({
  MessageComposePanel: ({
    messageText, onMessageChange, subjectText, onSubjectChange, channel, onChannelChange,
    onSendMessage,
  }: {
    messageText: string; onMessageChange: (v: string) => void;
    subjectText: string; onSubjectChange: (v: string) => void;
    channel: "sms" | "email"; onChannelChange: (c: "sms" | "email") => void;
    onSendMessage: () => void;
  }) =>
    React.createElement("div", null,
      React.createElement("textarea", {
        "data-testid": "composer",
        value: messageText,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onMessageChange(e.target.value),
      }),
      React.createElement("input", {
        "data-testid": "composer-subject",
        value: subjectText,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onSubjectChange(e.target.value),
      }),
      React.createElement("span", { "data-testid": "composer-channel" }, channel),
      React.createElement("button", {
        "data-testid": "composer-to-email",
        onClick: () => onChannelChange("email"),
      }, "email"),
      React.createElement("button", {
        "data-testid": "composer-send",
        onClick: () => onSendMessage(),
      }, "send"),
    ),
}));
vi.mock("@/components/ui/RecordingPlayer", () => ({ RecordingPlayer: () => null }));

import ConversationThread from "@/components/conversations/ConversationThread";

const sms = (id: string, body: string) => ({
  id, type: "sms", direction: "outbound", body, description: body,
  _ts: Date.parse("2026-08-20T00:00:00Z"), created_at: "2026-08-20T00:00:00Z",
});
const emailRow = (id: string, subject: string, body: string) => ({
  id, type: "email", direction: "inbound", subject, body_text: body, description: subject,
  _ts: Date.parse("2026-08-21T00:00:00Z"), created_at: "2026-08-21T00:00:00Z",
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
        // `true` = "the provider confirmed it". The component clears the composer and refreshes the
        // thread on that and nothing else, so a mock resolving `undefined` would silently skip the
        // entire post-send path and make the tests below pass without exercising it.
        onSendMessage={() => Promise.resolve(true)}
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
  channelState.channels = [];
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

  it("the composer still works after switching contacts", async () => {
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];
    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");

    rerender(view(CONTACT_B));
    await screen.findByText("BETA-BODY");

    // Still mounted and still writable for B.
    const composer = screen.getByTestId("composer") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "draft for B" } });
    expect((screen.getByTestId("composer") as HTMLTextAreaElement).value).toBe("draft for B");
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

describe("a stale contact can never START a request for itself", () => {
  // The sequence guard at 8a45e2c blocked an old request that FINISHED late, but not an old contact
  // that STARTED a new one. A realtime callback bound to contact A that was already queued when the
  // user switched to B would run `loadThread(A)`, bump the SHARED sequence, and thereby invalidate
  // B's still-in-flight request — leaving B on the spinner forever with no way to recover.
  it("A's queued realtime callback cannot discard B's in-flight response", async () => {
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];
    apiState.defer.add(CONTACT_B);

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");

    // Captured while A is still open — exactly what an in-flight websocket callback holds.
    const staleCallback = handlerFor(CONTACT_A, "messages", "lead_id")!.cb;
    expect(staleCallback).toBeTypeOf("function");

    rerender(view(CONTACT_B));
    await waitFor(() => expect(apiState.pending.some((p) => p.contactId === CONTACT_B)).toBe(true));
    const liveB = apiState.pending.find((p) => p.contactId === CONTACT_B)!;

    // A's callback fires AFTER the switch.
    await act(async () => { staleCallback(); });

    // It must not have started anything: a stale contact issues no request at all.
    expect(apiState.calls.filter((id) => id === CONTACT_A)).toHaveLength(1);

    // B's response now arrives and must still be accepted.
    await act(async () => { liveB.resolve([sms("b1", "BETA-BODY")]); });

    expect(screen.queryByText("BETA-BODY")).toBeInTheDocument();
    expect(screen.queryByText("ALPHA-BODY")).not.toBeInTheDocument();
  });

  it("a stale post-send refresh cannot discard the current contact's response either", async () => {
    // handleSend captures its contact before awaiting onSendMessage; if the user switches while the
    // send is in flight, the refresh that follows is bound to a contact that is no longer active.
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];
    apiState.defer.add(CONTACT_B);

    let releaseSend: () => void = () => {};
    // Resolves TRUE: the post-send refresh only happens on a confirmed send, and this test is about
    // that refresh being bound to the contact it was started for.
    const sendGate = new Promise<boolean>((r) => { releaseSend = () => r(true); });

    const tree = (contactId: string) => (
      <>
        <ConversationThread
          contactId={contactId}
          contactName={`Name-${contactId.slice(0, 4)}`}
          contactType="lead"
          onSendMessage={() => sendGate}
        />
        <Recorder />
      </>
    );

    const { rerender } = render(tree(CONTACT_A));
    await screen.findByText("ALPHA-BODY");

    fireEvent.change(screen.getByTestId("composer"), { target: { value: "hello" } });
    // Start the send; it hangs on `sendGate`.
    fireEvent.click(screen.getByTestId("composer-send"));

    rerender(tree(CONTACT_B));
    await waitFor(() => expect(apiState.pending.some((p) => p.contactId === CONTACT_B)).toBe(true));
    const liveB = apiState.pending.find((p) => p.contactId === CONTACT_B)!;

    // While A's send is still in flight the user starts a NEW draft for B.
    fireEvent.change(screen.getByTestId("composer"), { target: { value: "draft for BETA" } });

    // The send completes long after the user moved on.
    await act(async () => { releaseSend(); await Promise.resolve(); });

    // B's draft must survive: the composer clear belongs to the contact the send was FOR.
    expect((screen.getByTestId("composer") as HTMLTextAreaElement).value).toBe("draft for BETA");

    await act(async () => { liveB.resolve([sms("b1", "BETA-BODY")]); });

    expect(screen.queryByText("BETA-BODY")).toBeInTheDocument();
    expect(apiState.calls.filter((id) => id === CONTACT_A)).toHaveLength(1);
  });

  // POSITIVE CONTROL. Passes at 8a45e2c by construction — it exists so that a guard which rejects
  // too broadly (turning realtime refresh into a no-op) fails here instead of shipping silently.
  it("a stale event arriving AFTER a live one does not swallow the live reload", async () => {
    // Pins the ARRIVAL-TIME check in `scheduleReload`. Ordering is the whole test: the live event
    // must land FIRST so it owns the shared coalescing slot. Without the arrival check the stale
    // event that follows clears that pending timer and re-arms one for the dead contact, which
    // `loadThread` then rejects — so the live reload never happens at all.
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];
    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");
    const staleCallback = handlerFor(CONTACT_A, "messages", "lead_id")!.cb;

    rerender(view(CONTACT_B));
    await screen.findByText("BETA-BODY");
    const before = apiState.calls.length;

    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY"), sms("b2", "BETA-SECOND")];

    await act(async () => {
      handlerFor(CONTACT_B, "messages", "lead_id")!.cb();  // LIVE first — it owns the slot
      staleCallback();                                     // dead contact, same window
      await new Promise((r) => setTimeout(r, 120));
    });

    expect(await screen.findByText("BETA-SECOND")).toBeInTheDocument();
    expect(apiState.calls.length - before).toBe(1);
    expect(apiState.calls.filter((id) => id === CONTACT_A)).toHaveLength(1);
  });

  it("a coalescing timer armed while the contact was live is rejected once it changes", async () => {
    // Pins the START-OF-REQUEST check inside `loadThread`. The event is legitimate on arrival; only
    // the switch that happens while the timer is pending makes it stale.
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];
    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");
    const before = apiState.calls.length;

    await act(async () => { handlerFor(CONTACT_A, "messages", "lead_id")!.cb(); });

    rerender(view(CONTACT_B));
    await screen.findByText("BETA-BODY");
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });

    expect(apiState.calls.slice(before).filter((id) => id === CONTACT_A)).toEqual([]);
    expect(screen.queryByText("BETA-BODY")).toBeInTheDocument();
  });

  it("the ACTIVE contact's realtime callback still reloads normally", async () => {
    // The guard must reject stale contacts only — never the live one.
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];

    render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");

    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY"), sms("a2", "ALPHA-SECOND")];
    await act(async () => { handlerFor(CONTACT_A, "messages", "lead_id")!.cb(); });

    expect(await screen.findByText("ALPHA-SECOND")).toBeInTheDocument();
    expect(apiState.calls.filter((id) => id === CONTACT_A)).toHaveLength(2);
  });
});

describe("contact-specific composer state never crosses contacts", () => {
  // The previous test for this asserted only that a composer element still existed. Worse, its
  // mock of MessageComposePanel took `value`/`onChange`, props the real component does not have
  // (it takes messageText/onMessageChange/subjectText/onSubjectChange/channel/onChannelChange), so
  // the "draft" it typed was never bound to component state at all. It could not fail.
  it("an unsent SMS draft for A is NOT present when B opens", async () => {
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];
    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");

    fireEvent.change(screen.getByTestId("composer"), {
      target: { value: "PRIVATE-DRAFT-FOR-ALPHA" },
    });
    expect((screen.getByTestId("composer") as HTMLTextAreaElement).value).toBe("PRIVATE-DRAFT-FOR-ALPHA");

    rerender(view(CONTACT_B));
    await screen.findByText("BETA-BODY");

    // A message meant for one person must never be one click away from being sent to another.
    expect((screen.getByTestId("composer") as HTMLTextAreaElement).value).toBe("");
    expect(document.body.textContent).not.toContain("PRIVATE-DRAFT-FOR-ALPHA");
  });

  it("the draft is gone on the FIRST render after the switch, not after an effect", async () => {
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];
    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");
    fireEvent.change(screen.getByTestId("composer"), { target: { value: "PRIVATE-DRAFT-FOR-ALPHA" } });

    const before = frames.length;
    rerender(view(CONTACT_B));
    await screen.findByText("BETA-BODY");

    // A textarea's value is not part of `textContent`, so the frame recorder cannot see it. What the
    // recorder DOES establish is that commits happened; the value assertion then shows the draft was
    // gone by the time the switch settled. The render-time derivation (`activeComposer`) is what
    // makes that true on the very first of those commits rather than after a passive effect.
    expect(frames.length).toBeGreaterThan(before);
    expect((screen.getByTestId("composer") as HTMLTextAreaElement).value).toBe("");
  });

  it("an email subject drafted for A is NOT present when B opens", async () => {
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];
    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");
    fireEvent.change(screen.getByTestId("composer-subject"), {
      target: { value: "SUBJECT-FOR-ALPHA" },
    });

    rerender(view(CONTACT_B));
    await screen.findByText("BETA-BODY");

    expect((screen.getByTestId("composer-subject") as HTMLInputElement).value).toBe("");
  });

  it("the selected compose channel resets to the per-contact default", async () => {
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];
    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");
    fireEvent.click(screen.getByTestId("composer-to-email"));
    expect(screen.getByTestId("composer-channel").textContent).toBe("email");

    rerender(view(CONTACT_B));
    await screen.findByText("BETA-BODY");

    // B may not even have an email address; carrying A's channel over invites a failed send.
    expect(screen.getByTestId("composer-channel").textContent).toBe("sms");
  });

  it("an email expanded for A is collapsed again when B opens", async () => {
    // The expanded map is keyed by ROW id, so it survives a contact change unless it is reset too.
    // Two contacts can hold rows with the same id after a merge or a re-sync, and an inbox that
    // opens a message body the user never clicked is the same class of leak as a carried draft.
    apiState.threads[CONTACT_A] = [emailRow("e1", "ALPHA-SUBJECT", "ALPHA-EMAIL-BODY")];
    apiState.threads[CONTACT_B] = [emailRow("e1", "BETA-SUBJECT", "BETA-EMAIL-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-SUBJECT");

    fireEvent.click(screen.getByText("ALPHA-SUBJECT"));
    expect(screen.getByText("ALPHA-EMAIL-BODY")).toBeInTheDocument();

    const before = frames.length;
    rerender(view(CONTACT_B));
    await screen.findByText("BETA-SUBJECT");

    // Same row id, different contact: B's body must stay collapsed until B's user asks for it.
    expect(screen.queryByText("BETA-EMAIL-BODY")).not.toBeInTheDocument();
    expect(screen.queryByText("ALPHA-EMAIL-BODY")).not.toBeInTheDocument();
    // …and it was never committed even for one frame.
    // Stated honestly: the layout-effect reset is what this test actually pins — deleting the
    // render-time derivation for `expanded` breaks nothing, because `loaded` is keyed too, so B's
    // rows are not rendered at all until after the reset has run. The frame assertion is kept as
    // the guard that would catch it if `loaded` ever stopped being keyed.
    expect(frames.slice(before).filter((f) => f.includes("BETA-EMAIL-BODY"))).toEqual([]);
  });

  it("returning to A does not re-expand A's email", async () => {
    apiState.threads[CONTACT_A] = [emailRow("e1", "ALPHA-SUBJECT", "ALPHA-EMAIL-BODY")];
    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-SUBJECT");
    fireEvent.click(screen.getByText("ALPHA-SUBJECT"));
    expect(screen.getByText("ALPHA-EMAIL-BODY")).toBeInTheDocument();

    rerender(view(CONTACT_B));
    await screen.findByText("BETA-BODY");
    rerender(view(CONTACT_A));
    await screen.findByText("ALPHA-SUBJECT");

    expect(screen.queryByText("ALPHA-EMAIL-BODY")).not.toBeInTheDocument();
  });

  it("expanding still works for the contact that is open", async () => {
    // Positive control: the reset must not make the disclosure inert.
    apiState.threads[CONTACT_A] = [emailRow("e1", "ALPHA-SUBJECT", "ALPHA-EMAIL-BODY")];

    render(view(CONTACT_A));
    await screen.findByText("ALPHA-SUBJECT");

    expect(screen.queryByText("ALPHA-EMAIL-BODY")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("ALPHA-SUBJECT"));
    expect(screen.getByText("ALPHA-EMAIL-BODY")).toBeInTheDocument();
    fireEvent.click(screen.getByText("ALPHA-SUBJECT"));
    expect(screen.queryByText("ALPHA-EMAIL-BODY")).not.toBeInTheDocument();
  });

  it("returning to A does not resurrect A's old draft", async () => {
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];
    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");
    fireEvent.change(screen.getByTestId("composer"), { target: { value: "PRIVATE-DRAFT-FOR-ALPHA" } });

    rerender(view(CONTACT_B));
    await screen.findByText("BETA-BODY");
    rerender(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");

    expect((screen.getByTestId("composer") as HTMLTextAreaElement).value).toBe("");
  });
});

describe("the open thread subscribes to everything it reads", () => {
  // `getConversationThread` reads SMS with `.or(lead_id.eq.X, contact_id.eq.X)`, but the
  // subscription filtered on `lead_id` alone. A converted client's SMS carry `contact_id`, so a
  // brand-new inbound message never refreshed their open thread.
  it("registers a filtered handler for BOTH SMS link columns and for email", async () => {
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];

    render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");

    const registered = channelFor(CONTACT_A)!.handlers.map((h) => `${h.table}:${h.filter}`).sort();
    expect(registered).toEqual([
      `contact_emails:contact_id=eq.${CONTACT_A}`,
      `messages:contact_id=eq.${CONTACT_A}`,
      `messages:lead_id=eq.${CONTACT_A}`,
    ]);
  });

  // NOTE, honestly: this and the teardown guard below PASS at 8a45e2c. They are non-regression
  // guards on the counterpart risks of adding a second subscription, not proofs of the defect.
  it("every handler is FILTERED — an open thread never listens to the whole organization", async () => {
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];

    render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");

    for (const h of channelFor(CONTACT_A)!.handlers) {
      expect(h.filter, `${h.table} handler has no filter`).toBeTruthy();
      expect(h.filter).toContain(`=eq.${CONTACT_A}`);
    }
  });

  it("an SMS carrying only contact_id refreshes the thread", async () => {
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];

    render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");

    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY"), sms("a2", "CONVERTED-CLIENT-SMS")];
    await act(async () => { handlerFor(CONTACT_A, "messages", "contact_id")!.cb(); });

    expect(await screen.findByText("CONVERTED-CLIENT-SMS")).toBeInTheDocument();
  });

  it("a row matching BOTH SMS filters reloads the thread only once", async () => {
    // A converted contact carries lead_id AND contact_id, so both handlers fire for one row.
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];

    render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");
    const before = apiState.calls.length;

    await act(async () => {
      handlerFor(CONTACT_A, "messages", "lead_id")!.cb();
      handlerFor(CONTACT_A, "messages", "contact_id")!.cb();
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(apiState.calls.length - before, "duplicate reload for one row").toBe(1);
  });

  it("the previous contact's channel is torn down on switch", async () => {
    apiState.threads[CONTACT_A] = [sms("a1", "ALPHA-BODY")];
    apiState.threads[CONTACT_B] = [sms("b1", "BETA-BODY")];

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText("ALPHA-BODY");
    rerender(view(CONTACT_B));
    await screen.findByText("BETA-BODY");

    expect(channels().find((c) => c.name === `thread-${CONTACT_A}`)!.removed).toBe(true);
    expect(channels().find((c) => c.name === `thread-${CONTACT_B}`)!.removed).toBe(false);
  });
});
