/**
 * Conversations — instant manual SMS (2026-10-14), driven through the REAL page, thread, store and
 * sender with a fake transport. Realtime handlers are registered but never fired, as in production
 * (the `messages` table is not in the Realtime publication).
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const AGENT = "00000000-0000-4000-8000-000000000001";
const CONTACT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTACT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SAVED = "6f2c1a8e-7d3b-4c5a-9e1f-0a2b3c4d5e6f";

const s = vi.hoisted(() => ({
  isImpersonating: false,
  contacts: [] as Record<string, unknown>[],
  threads: {} as Record<string, unknown[]>,
  threadCalls: [] as string[],
  threadError: null as string | null,
  /** Contacts whose history read is held open until the test resolves or rejects it. */
  deferThreads: new Set<string>(),
  heldThreads: [] as { contactId: string; resolve: (rows: unknown[]) => void; reject: (e: Error) => void }[],
  realtimeHandlers: 0,
  realtimeFired: 0,
  /** Every twilio-sms POST, held until the test answers it. */
  posts: [] as { body: Record<string, unknown>; answer: (status: number, body: unknown) => void; fail: () => void }[],
  savedRow: null as Record<string, unknown> | null,
  errors: [] as string[],
  successes: [] as string[],
}));

vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => { s.errors.push(String(m)); },
    success: (m: string) => { s.successes.push(String(m)); },
    warning: (m: string) => { s.errors.push(String(m)); },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: AGENT },
    profile: s.isImpersonating
      ? { id: "00000000-0000-4000-8000-000000000099", organization_id: ORG, role: "Agent" }
      : { id: AGENT, organization_id: ORG, role: "Agent" },
    realProfile: { id: AGENT, organization_id: ORG, role: "Agent" },
    isImpersonating: s.isImpersonating,
    isBuildingOrganization: false,
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: ORG, role: "Agent", isSuperAdmin: false }) }));
vi.mock("@/contexts/TwilioContext", () => ({ useTwilio: () => ({ selectedCallerNumber: null }) }));
vi.mock("@/lib/supabase-email", () => ({ emailSupabaseApi: { getMyConnections: async () => [], sendContactEmail: async () => ({ success: true }) } }));
vi.mock("@/lib/supabase-users", () => ({ usersSupabaseApi: { getAgentScopeIds: async () => [AGENT] } }));
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const filters: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      eq: (column: string, value: unknown) => { filters[column] = value; return chain; },
      maybeSingle: async () => ({
        data: table === "messages" && s.savedRow && s.savedRow.id === filters.id ? s.savedRow : null,
        error: null,
      }),
    };
    for (const m of ["select", "or", "in", "order", "limit"]) chain[m] = () => chain;
    return chain;
  };
  return {
    supabase: {
      from: builder,
      channel: () => {
        const api = {
          on: (_e: string, _cfg: unknown, cb: () => void) => {
            s.realtimeHandlers += 1;
            void cb; // registered, never fired: Realtime is disabled for `messages`
            return api;
          },
          subscribe: () => api,
        };
        return api;
      },
      removeChannel: () => {},
      auth: {
        getSession: async () => ({ data: { session: { access_token: "token", user: { id: AGENT } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock("@/lib/supabase-messages", async (orig) => {
  const actual = await orig<typeof import("@/lib/supabase-messages")>();
  return {
    ...actual,
    messagesSupabaseApi: {
      getRecentConversations: async () => s.contacts,
      resolveScopedContact: async () => null,
      getConversationThread: async (contactId: string) => {
        s.threadCalls.push(contactId);
        if (s.deferThreads.has(contactId)) {
          return new Promise<unknown[]>((resolve, reject) => { s.heldThreads.push({ contactId, resolve, reject }); });
        }
        if (s.threadError) throw new Error(s.threadError);
        return s.threads[contactId] ?? [];
      },
    },
  };
});
vi.mock("@/components/conversations/ContactBriefView", () => ({ default: () => null }));
vi.mock("@/components/ui/RecordingPlayer", () => ({ RecordingPlayer: () => null }));
vi.mock("react-router-dom", () => ({ useSearchParams: () => [new URLSearchParams(""), () => {}], useNavigate: () => () => {} }));

import Conversations from "@/pages/Conversations";
import { PendingSmsAuthorityBridge } from "@/components/messaging/PendingSmsAuthorityBridge";
import { pendingSmsStore, smsScopeKey } from "@/lib/sms-send/pendingSmsStore";

const convo = (contactId: string, name: string) => ({
  contact_id: contactId, contact_name: name, contact_type: "lead", contact_phone: "5125550123",
  contact_email: null, last_message: "hi", last_message_at: "2026-10-01T00:00:00Z", channel: "sms", direction: "outbound",
});
const row = (id: string, body: string, iso: string, direction = "outbound") => ({
  id, type: "sms", direction, body, description: body, status: "queued", _ts: Date.parse(iso), sent_at: iso, created_at: iso,
});
const saved = (body: string) => ({
  id: SAVED, direction: "outbound", body, from_number: "+15550002222", to_number: "+15125550123", status: "queued",
  sent_at: "2026-10-14T15:00:00Z", created_at: "2026-10-14T15:00:00Z", contact_id: null, lead_id: CONTACT_A,
  contact_type: "lead", created_by: AGENT, organization_id: ORG, provider_message_id: "SM1",
});
const RECEIPT = { success: true, message_id: SAVED, provider_message_id: "SM1", status: "queued" };

const page = () => (<><PendingSmsAuthorityBridge /><Conversations /></>);
const composer = () => document.querySelector('input[placeholder="Type SMS message…"]') as HTMLInputElement;
const sendButton = () => screen.getByRole("button", { name: /^send$/i });
const bubbles = () => screen.queryAllByTestId("pending-sms");
const status = () => bubbles()[0]?.querySelector('[role="status"]')?.textContent ?? "";
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function open(name = "Alpha") {
  const view = render(page());
  fireEvent.click(await screen.findByText(name));
  await waitFor(() => expect(composer()).toBeTruthy());
  return view;
}

function send(text: string) {
  fireEvent.change(composer(), { target: { value: text } });
  fireEvent.click(sendButton());
}

beforeEach(() => {
  s.isImpersonating = false;
  s.contacts = [convo(CONTACT_A, "Alpha"), convo(CONTACT_B, "Beta")];
  s.threads = { [CONTACT_A]: [row("r1", "Earlier text", "2026-10-13T10:00:00Z")] };
  s.threadCalls = [];
  s.threadError = null;
  s.deferThreads = new Set();
  s.heldThreads = [];
  s.realtimeHandlers = 0;
  s.posts = [];
  s.savedRow = null;
  s.errors = [];
  s.successes = [];
  pendingSmsStore.reset();
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((resolve, reject) => {
    s.posts.push({
      body: JSON.parse(String(init.body)),
      answer: (code, body) => resolve({ status: code, text: async () => JSON.stringify(body) }),
      fail: () => reject(new TypeError("Failed to fetch")),
    });
  }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the pending bubble is immediate and truthful", () => {
  it("renders on the click, keeps typing open, and becomes the saved row without a reload", async () => {
    await open();
    const loads = s.threadCalls.length;
    send("On my way");
    expect(bubbles()).toHaveLength(1);
    expect(bubbles()[0]).toHaveTextContent("On my way");
    expect(status()).toBe("Sending…");
    expect(composer().value).toBe("");
    expect(sendButton()).toBeDisabled();
    fireEvent.change(composer(), { target: { value: "Next thought" } });
    expect(composer().value, "typing stays enabled while the text is in flight").toBe("Next thought");

    await settle();
    expect(s.posts).toHaveLength(1);
    s.savedRow = saved("On my way");
    await act(async () => { s.posts[0].answer(200, RECEIPT); await new Promise((r) => setTimeout(r, 0)); });

    expect(bubbles()).toHaveLength(0);
    expect(screen.getAllByText("On my way")).toHaveLength(1);
    expect(composer().value, "the newer draft survived the completion").toBe("Next thought");
    expect(s.threadCalls.length - loads).toBe(0);
    expect(s.successes).toEqual([]);
    expect(s.realtimeHandlers).toBeGreaterThan(0);
  });

  it("another tab's saved row that lands before the receipt shows beside the bubble, then merges by id", async () => {
    await open();
    send("Same words");
    await settle();
    // A quiet reload (as after focus or another tab's send) returns the saved row first.
    s.threads[CONTACT_A] = [row("r1", "Earlier text", "2026-10-13T10:00:00Z"), row(SAVED, "Same words", "2026-10-14T15:00:00Z")];
    await act(async () => {
      pendingSmsStore.emitScope(pendingSmsStore.getSnapshot()[0].scopeKey, "recovery");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getAllByText("Same words"), "no saved row is hidden").toHaveLength(2);
    expect(status()).toBe("Sending…");

    s.savedRow = saved("Same words");
    await act(async () => { s.posts[0].answer(200, RECEIPT); await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getAllByText("Same words")).toHaveLength(1);
    expect(bubbles()).toHaveLength(0);
  });
});

describe("failures never overwrite a newer draft", () => {
  it("a proven refusal with a newer SMS draft keeps the item; Edit appears once the composer is empty", async () => {
    await open();
    send("First text");
    await settle();
    fireEvent.change(composer(), { target: { value: "Newer draft" } });
    await act(async () => {
      s.posts[0].answer(409, { success: false, code: "PHONE", error: "This number can't receive texts." });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(composer().value).toBe("Newer draft");
    expect(status()).toMatch(/^Not sent/);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();

    fireEvent.change(composer(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(composer().value).toBe("First text");
    expect(bubbles()).toHaveLength(0);
  });

  it("failed SMS text never goes into an email draft", async () => {
    await open();
    send("Text body");
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /^email$/i }));
    await act(async () => {
      s.posts[0].answer(409, { success: false, code: "PHONE", error: "No." });
      await new Promise((r) => setTimeout(r, 0));
    });
    const emailBody = document.querySelector('textarea[placeholder="Type EMAIL message…"]') as HTMLTextAreaElement;
    expect(emailBody.value).toBe("");
    expect(screen.queryByRole("button", { name: "Edit" }), "Edit is offered only on an empty SMS composer").toBeNull();
  });
});

describe("identity and lifecycle", () => {
  it("a result after switching contacts stays with its contact and names it off screen", async () => {
    await open("Alpha");
    send("For Alpha");
    await settle();
    fireEvent.click(screen.getByText("Beta"));
    await waitFor(() => expect(s.threadCalls).toContain(CONTACT_B));
    fireEvent.change(composer(), { target: { value: "For Beta" } });
    await act(async () => {
      s.posts[0].answer(409, { success: false, code: "PHONE", error: "No." });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(bubbles(), "Alpha's send never renders under Beta").toHaveLength(0);
    expect(composer().value).toBe("For Beta");
    expect(s.errors).toEqual(["Text to Alpha not sent: No."]);

    fireEvent.click(screen.getByText("Alpha"));
    await waitFor(() => expect(status()).toMatch(/^Not sent/));
  });

  it("an uncertain result for a contact the agent has left never reloads the open thread", async () => {
    // The recovery reload is scoped to the sending contact. The open thread (Beta) must not reload,
    // and Beta's in-progress draft must survive. (Replaces the SMS variant of the isolation test's
    // stale post-send refresh, which now uses email because a confirmed SMS no longer reloads.)
    await open("Alpha");
    send("For Alpha");
    await settle();
    fireEvent.click(screen.getByText("Beta"));
    await waitFor(() => expect(s.threadCalls).toContain(CONTACT_B));
    fireEvent.change(composer(), { target: { value: "For Beta" } });
    const loads = s.threadCalls.length;
    await act(async () => {
      s.posts[0].answer(503, { success: false, code: "SEND_UNCERTAIN", error: "Delivery could not be confirmed." });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(s.threadCalls.length - loads, "no reload while another contact is open").toBe(0);
    expect(bubbles(), "Alpha's send never renders under Beta").toHaveLength(0);
    expect(composer().value).toBe("For Beta");
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toMatch(/Alpha/);

    fireEvent.click(screen.getByText("Alpha"));
    await waitFor(() => expect(status()).toMatch(/^Not confirmed/));
  });

  it("survives closing the page while in flight", async () => {
    const view = await open();
    send("Keep me");
    await settle();
    view.unmount();
    s.savedRow = saved("Keep me");
    await act(async () => { s.posts[0].answer(200, RECEIPT); await new Promise((r) => setTimeout(r, 0)); });
    s.threads[CONTACT_A] = [];
    await open();
    expect(await screen.findByText("Keep me")).toBeInTheDocument();
    expect(bubbles(), "shown as the saved row, not a pending one").toHaveLength(0);
  });

  it("View As before the POST: nothing is sent, nothing shows under the viewed agent", async () => {
    const view = await open();
    s.isImpersonating = true;
    send("Not as them");
    view.rerender(page());
    await settle();
    expect(s.posts).toHaveLength(0);
    expect(bubbles()).toHaveLength(0);
  });

  it("a dispatched send is not resent or reported after View As starts", async () => {
    const view = await open();
    send("Already out");
    await settle();
    s.isImpersonating = true;
    view.rerender(page());
    await act(async () => {
      s.posts[0].answer(409, { success: false, code: "PHONE", error: "No." });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(s.posts).toHaveLength(1);
    expect(s.errors).toEqual([]);
    expect(bubbles()).toHaveLength(0);
  });
});

describe("quiet reloads and scrolling", () => {
  function scroller() {
    const el = screen.getByText("Earlier text").closest(".overflow-y-auto") as HTMLElement;
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 5000 });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 500 });
    return el;
  }

  it("an uncertain outcome reloads once without a spinner and without moving a reader in history", async () => {
    s.threads[CONTACT_A] = Array.from({ length: 200 }, (_, i) => row(`h${i}`, i === 0 ? "Earlier text" : `History ${i}`, new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString()));
    await open();
    const el = scroller();
    send("Unsure");
    expect(el.scrollTop, "the agent's own send jumps to the newest").toBe(5000);
    el.scrollTop = 1000;
    fireEvent.scroll(el);
    await settle();
    const loads = s.threadCalls.length;
    await act(async () => {
      s.posts[0].answer(502, { success: false, code: "PROVIDER_REJECTED", error: "Provider unavailable." });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(s.threadCalls.length - loads).toBe(1);
    expect(screen.getByText("History 199")).toBeInTheDocument();
    expect(el.scrollTop).toBe(1000);
    expect(status()).toMatch(/^Not confirmed/);
  });

  it("a failed refresh keeps the rows and offers Retry", async () => {
    await open();
    s.threadError = "network down";
    send("Unsure");
    await settle();
    await act(async () => {
      s.posts[0].answer(503, { success: false, code: "SEND_UNCERTAIN", error: "Delivery could not be confirmed." });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText("Earlier text")).toBeInTheDocument();
    expect(screen.getByText(/couldn't refresh this conversation/i)).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load this conversation")).toBeNull();
  });
});

describe("while the first history load is still pending (2026-10-15 review)", () => {
  // The history read is a genuinely held Promise: nothing below resolves it until the test says so.
  const hold = (contactId: string) => { s.deferThreads.add(contactId); };
  const held = (contactId: string) => s.heldThreads.filter((h) => h.contactId === contactId);
  const answer = (status: number, body: unknown) =>
    act(async () => { s.posts[0].answer(status, body); await new Promise((r) => setTimeout(r, 0)); });

  it("shows the bubble on Send before history or the send resolves; the receipt reconciles it; history then shows one saved row", async () => {
    hold(CONTACT_A);
    await open("Alpha");
    expect(held(CONTACT_A), "the first history read is outstanding").toHaveLength(1);
    fireEvent.change(composer(), { target: { value: "Before history" } });
    expect(sendButton(), "Send is not gated on history").toBeEnabled();
    fireEvent.click(sendButton());

    // Nothing has resolved yet: not the history read, not the session read, not the POST.
    expect(s.posts).toHaveLength(0);
    expect(bubbles(), "the pending text is hidden behind the history spinner").toHaveLength(1);
    expect(bubbles()[0]).toHaveTextContent("Before history");
    expect(status()).toBe("Sending…");
    expect(composer().value).toBe("");
    expect(screen.getByText("Loading conversation…")).toBeInTheDocument();
    expect(screen.queryByText("No messages yet"), "unknown history is never shown as empty").toBeNull();

    await settle();
    expect(s.posts).toHaveLength(1);
    s.savedRow = saved("Before history");
    await answer(200, RECEIPT);
    // The receipt and the targeted read reconcile it while history is STILL pending.
    expect(held(CONTACT_A)).toHaveLength(1);
    expect(bubbles()).toHaveLength(0);
    expect(screen.getAllByText("Before history")).toHaveLength(1);
    expect(screen.getByText("Loading conversation…")).toBeInTheDocument();

    // History arrives holding the same message_id: exactly one saved row.
    await act(async () => {
      held(CONTACT_A)[0].resolve([
        row("r1", "Earlier text", "2026-10-13T10:00:00Z"),
        row(SAVED, "Before history", "2026-10-14T15:00:00Z"),
      ]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText("Earlier text")).toBeInTheDocument();
    expect(screen.getAllByText("Before history"), "one saved row, never two").toHaveLength(1);
    expect(screen.queryByText("Loading conversation…")).toBeNull();
  });

  it("a history failure never removes the pending text or its reconciled row", async () => {
    hold(CONTACT_A);
    await open("Alpha");
    send("Still mine");
    expect(bubbles(), "the pending text is hidden behind the history spinner").toHaveLength(1);

    await act(async () => {
      held(CONTACT_A)[0].reject(new Error("history down"));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(bubbles()).toHaveLength(1);
    expect(bubbles()[0]).toHaveTextContent("Still mine");
    expect(screen.getByText("Couldn't load this conversation")).toBeInTheDocument();
    expect(screen.queryByText("No messages yet")).toBeNull();

    s.savedRow = saved("Still mine");
    await answer(200, RECEIPT);
    expect(bubbles()).toHaveLength(0);
    expect(screen.getAllByText("Still mine"), "the reconciled row survives the failed history").toHaveLength(1);
    expect(screen.getByText("Couldn't load this conversation")).toBeInTheDocument();
  });

  it("reopening a contact shows its retained in-flight send before its history loads", async () => {
    await open("Alpha");
    send("Retained");
    await settle();
    expect(s.posts).toHaveLength(1);
    fireEvent.click(screen.getByText("Beta"));
    await waitFor(() => expect(s.threadCalls).toContain(CONTACT_B));
    expect(bubbles()).toHaveLength(0);

    hold(CONTACT_A);
    fireEvent.click(screen.getByText("Alpha"));
    // Alpha's history read is outstanding and the POST is unanswered.
    expect(held(CONTACT_A)).toHaveLength(1);
    expect(bubbles(), "the retained send is hidden behind the history spinner").toHaveLength(1);
    expect(bubbles()[0]).toHaveTextContent("Retained");
    expect(status()).toBe("Sending…");
  });

  it("reopening a contact shows its retained Not confirmed send before its history loads", async () => {
    await open("Alpha");
    send("Unsure one");
    await settle();
    fireEvent.click(screen.getByText("Beta"));
    await waitFor(() => expect(s.threadCalls).toContain(CONTACT_B));
    await answer(503, { success: false, code: "SEND_UNCERTAIN", error: "Delivery could not be confirmed." });

    hold(CONTACT_A);
    fireEvent.click(screen.getByText("Alpha"));
    expect(held(CONTACT_A)).toHaveLength(1);
    expect(bubbles(), "the retained send is hidden behind the history spinner").toHaveLength(1);
    expect(bubbles()[0]).toHaveTextContent("Unsure one");
    expect(status()).toMatch(/^Not confirmed/);
    expect(screen.queryByText("No messages yet")).toBeNull();
  });

  const bigSpinner = () => document.querySelector(".animate-spin.w-8");

  it("a reconciled row survives a later history failure, and Retry then loads history around it", async () => {
    hold(CONTACT_A);
    await open("Alpha");
    send("Saved first");
    await settle();
    s.savedRow = saved("Saved first");
    await answer(200, RECEIPT);
    expect(bubbles()).toHaveLength(0);
    expect(screen.getAllByText("Saved first")).toHaveLength(1);

    await act(async () => {
      held(CONTACT_A)[0].reject(new Error("history down"));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getAllByText("Saved first"), "the failure never removes the reconciled row").toHaveLength(1);
    expect(screen.getByText("Couldn't load this conversation")).toBeInTheDocument();
    expect(screen.queryByText("No messages yet")).toBeNull();

    s.deferThreads.delete(CONTACT_A);
    s.threads[CONTACT_A] = [row("r1", "Earlier text", "2026-10-13T10:00:00Z"), row(SAVED, "Saved first", "2026-10-14T15:00:00Z")];
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText("Earlier text")).toBeInTheDocument();
    expect(screen.getAllByText("Saved first"), "one saved row, never two").toHaveLength(1);
    expect(screen.queryByText("Couldn't load this conversation")).toBeNull();
  });

  it("a proven refusal while history is pending returns the draft and goes back to the spinner, never to an empty thread", async () => {
    hold(CONTACT_A);
    await open("Alpha");
    send("Refused text");
    expect(bubbles()).toHaveLength(1);
    expect(bigSpinner(), "the pending text replaces the first-load spinner").toBeNull();
    await settle();
    await answer(409, { success: false, code: "PHONE", error: "This number can't receive texts." });

    expect(bubbles()).toHaveLength(0);
    expect(composer().value, "the unsent text is back in the composer").toBe("Refused text");
    expect(bigSpinner(), "nothing to show yet: the first-load spinner again").not.toBeNull();
    expect(screen.queryByText("No messages yet"), "unknown history is never shown as empty").toBeNull();
    expect(held(CONTACT_A)).toHaveLength(1);
  });

  it("one send in flight while history is pending: no second dispatch, the newer draft is kept, nothing is resent on reopen", async () => {
    hold(CONTACT_A);
    await open("Alpha");
    send("Only once");
    expect(sendButton(), "one SMS in flight per contact").toBeDisabled();
    fireEvent.change(composer(), { target: { value: "Typed next" } });
    fireEvent.click(sendButton());
    fireEvent.keyDown(composer(), { key: "Enter" });
    await settle();
    expect(s.posts).toHaveLength(1);
    expect(bubbles()).toHaveLength(1);

    await act(async () => {
      held(CONTACT_A)[0].resolve([row("r1", "Earlier text", "2026-10-13T10:00:00Z")]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText("Earlier text")).toBeInTheDocument();
    expect(bubbles()).toHaveLength(1);
    expect(composer().value, "history arriving never touches the draft").toBe("Typed next");

    fireEvent.click(screen.getByText("Beta"));
    await waitFor(() => expect(s.threadCalls).toContain(CONTACT_B));
    hold(CONTACT_A);
    fireEvent.click(screen.getByText("Alpha"));
    expect(bubbles()).toHaveLength(1);
    await settle();
    expect(s.posts, "reopening never resends").toHaveLength(1);
  });

  it("the thread opens at the newest row when history arrives after the agent's own send; a reader is then left alone", async () => {
    hold(CONTACT_A);
    await open("Alpha");
    const el = bigSpinner()!.closest(".overflow-y-auto") as HTMLElement;
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 500 });
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 800 });
    send("Jump here");
    expect(el.scrollTop, "the agent's own send shows at the newest").toBe(800);
    await settle();

    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 9000 });
    await act(async () => {
      held(CONTACT_A)[0].resolve(Array.from({ length: 200 }, (_, i) =>
        row(`h${i}`, `History ${i}`, new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString())));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(el.scrollTop, "the first load still lands at the newest").toBe(9000);

    el.scrollTop = 1000;
    fireEvent.scroll(el);
    s.savedRow = saved("Jump here");
    await answer(200, RECEIPT);
    expect(bubbles()).toHaveLength(0);
    expect(el.scrollTop, "a reader in history is not moved by the receipt").toBe(1000);
  });

  it("the first-load status, and its failure with Retry, are pinned above this tab's rows instead of being scrolled away", async () => {
    // jsdom has no layout: this pins the structure; the browser fixture's evidence covers the rest.
    hold(CONTACT_A);
    await open("Alpha");
    send("Pinned");
    const line = () => screen.getByText("Loading conversation…").closest("[role=status]") as HTMLElement;
    expect(line().className).toMatch(/\bsticky\b/);
    expect(line().className).toMatch(/(^|\s)-top-6(\s|$)/);
    expect(line().compareDocumentPosition(bubbles()[0]) & Node.DOCUMENT_POSITION_FOLLOWING, "the line sits above the rows").toBeTruthy();

    await act(async () => {
      held(CONTACT_A)[0].reject(new Error("history down"));
      await new Promise((r) => setTimeout(r, 0));
    });
    const failure = screen.getByText("Couldn't load this conversation").closest("[role=status]") as HTMLElement;
    expect(failure.className, "the failure takes the same pinned place").toMatch(/\bsticky\b/);
    expect(failure).toHaveTextContent("history down");
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
    expect(bubbles()).toHaveLength(1);
    expect(bigSpinner()).toBeNull();
  });

  it("reopening a contact shows its retained reconciled row before its history loads, then exactly one row", async () => {
    await open("Alpha");
    send("Already saved");
    await settle();
    s.savedRow = saved("Already saved");
    await answer(200, RECEIPT);
    expect(bubbles()).toHaveLength(0);
    fireEvent.click(screen.getByText("Beta"));
    await waitFor(() => expect(s.threadCalls).toContain(CONTACT_B));
    expect(screen.queryByText("Already saved")).toBeNull();

    hold(CONTACT_A);
    fireEvent.click(screen.getByText("Alpha"));
    expect(held(CONTACT_A)).toHaveLength(1);
    expect(screen.getAllByText("Already saved"), "the reconciled row waits for nothing").toHaveLength(1);
    expect(bubbles()).toHaveLength(0);
    expect(screen.getByText("Loading conversation…")).toBeInTheDocument();

    await act(async () => {
      held(CONTACT_A)[0].resolve([row("r1", "Earlier text", "2026-10-13T10:00:00Z"), row(SAVED, "Already saved", "2026-10-14T15:00:00Z")]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText("Earlier text")).toBeInTheDocument();
    expect(screen.getAllByText("Already saved")).toHaveLength(1);
  });

  it("reopening a contact shows its accepted, not-yet-matched send before its history loads; history with its message_id merges it", async () => {
    await open("Alpha");
    send("Accepted one");
    await settle();
    // The targeted read finds a row that does not belong to this send: accepted, history pending.
    s.savedRow = { ...saved("Accepted one"), lead_id: CONTACT_B };
    await answer(200, RECEIPT);
    await waitFor(() => expect(status()).toMatch(/^Accepted · history pending/));
    fireEvent.click(screen.getByText("Beta"));
    await waitFor(() => expect(s.threadCalls).toContain(CONTACT_B));

    hold(CONTACT_A);
    fireEvent.click(screen.getByText("Alpha"));
    expect(held(CONTACT_A)).toHaveLength(1);
    expect(bubbles()).toHaveLength(1);
    expect(status()).toMatch(/^Accepted · history pending/);
    expect(screen.queryByText("No messages yet")).toBeNull();

    await act(async () => {
      held(CONTACT_A)[0].resolve([row(SAVED, "Accepted one", "2026-10-14T15:00:00Z")]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(bubbles()).toHaveLength(0);
    expect(screen.getAllByText("Accepted one"), "merged by message_id into one row").toHaveLength(1);
    expect(s.posts).toHaveLength(1);
  });

  it("an uncertain result on the open contact while its first read is held: the newer read wins, the held one is discarded", async () => {
    hold(CONTACT_A);
    await open("Alpha");
    send("Unsure now");
    await settle();
    await answer(503, { success: false, code: "SEND_UNCERTAIN", error: "Delivery could not be confirmed." });
    expect(status()).toMatch(/^Not confirmed/);
    expect(held(CONTACT_A), "the recovery reload started a second read").toHaveLength(2);

    await act(async () => {
      held(CONTACT_A)[0].resolve([row("old", "Stale history", "2026-10-12T10:00:00Z")]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByText("Stale history"), "a superseded read never lands").toBeNull();
    expect(screen.getByText("Loading conversation…")).toBeInTheDocument();
    expect(bubbles()).toHaveLength(1);

    await act(async () => {
      held(CONTACT_A)[1].resolve([row("r1", "Earlier text", "2026-10-13T10:00:00Z")]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText("Earlier text")).toBeInTheDocument();
    expect(status(), "never relabelled, never resent").toMatch(/^Not confirmed/);
    expect(s.posts).toHaveLength(1);
  });

  it("a Not sent bubble kept beside a newer draft while history is pending can be edited back into the composer", async () => {
    hold(CONTACT_A);
    await open("Alpha");
    send("First text");
    await settle();
    fireEvent.change(composer(), { target: { value: "Newer draft" } });
    await answer(409, { success: false, code: "PHONE", error: "This number can't receive texts." });
    expect(composer().value).toBe("Newer draft");
    expect(status()).toMatch(/^Not sent/);
    expect(bigSpinner()).toBeNull();

    fireEvent.change(composer(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(composer().value).toBe("First text");
    expect(bubbles()).toHaveLength(0);
    expect(bigSpinner(), "nothing to show yet: the first-load spinner again").not.toBeNull();
    expect(screen.queryByText("No messages yet")).toBeNull();
  });

  it("while B's first history read is held, A's retained send never shows under B", async () => {
    await open("Alpha");
    send("Only for Alpha");
    await settle();
    hold(CONTACT_B);
    fireEvent.click(screen.getByText("Beta"));
    expect(held(CONTACT_B)).toHaveLength(1);
    expect(bubbles()).toHaveLength(0);
    expect(screen.queryByText("Only for Alpha")).toBeNull();
    expect(bigSpinner(), "Beta has nothing to show yet").not.toBeNull();
    expect(screen.queryByText("No messages yet")).toBeNull();

    await act(async () => {
      held(CONTACT_B)[0].resolve([]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText("No messages yet"), "Beta's history is now known to be empty").toBeInTheDocument();
    expect(screen.queryByText("Only for Alpha")).toBeNull();
  });
});

describe("a failed refresh over a thread already loaded as empty (2026-10-15 approval)", () => {
  // The last successful read was empty, then a refresh failed: history is unknown again, so the
  // refresh error and its Retry must show — never "No messages yet". Retry is a history read only.
  const keyA = smsScopeKey({ organizationId: ORG, actorId: AGENT, viewerId: AGENT, contactType: "lead", contactId: CONTACT_A });
  const refreshError = () => screen.queryByText(/couldn't refresh this conversation/i);
  const retry = () => act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await new Promise((r) => setTimeout(r, 0));
  });

  it("an empty load, then a failed refresh: the error and Retry stay; a successful empty Retry restores the empty state", async () => {
    s.threads[CONTACT_A] = [];
    await open();
    expect(screen.getByText("No messages yet"), "a successful empty read is a genuine empty thread").toBeInTheDocument();

    const reads = s.threadCalls.length;
    s.threadError = "network down";
    await act(async () => {
      pendingSmsStore.emitScope(keyA, "recovery");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(s.threadCalls.length - reads).toBe(1);
    expect(screen.queryByText("No messages yet"), "the latest read failed: history is unknown").toBeNull();
    expect(refreshError()).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);

    await retry();
    expect(s.threadCalls.length - reads, "Retry is one history read").toBe(2);
    expect(refreshError(), "a second failure keeps the error").toBeInTheDocument();
    expect(screen.queryByText("No messages yet")).toBeNull();

    s.threadError = null;
    await retry();
    expect(s.threadCalls.length - reads).toBe(3);
    expect(refreshError()).toBeNull();
    expect(screen.getByText("No messages yet")).toBeInTheDocument();
    expect(s.posts, "no SMS is ever sent here").toHaveLength(0);
  });

  it("empty history, an uncertain send, a failed recovery read, then Dismiss: the error and Retry stay, Retry never resends, and the send and the draft survive", async () => {
    s.threads[CONTACT_A] = [];
    await open();
    send("Into the void");
    await settle();
    expect(s.posts).toHaveLength(1);
    s.threadError = "network down";
    const reads = s.threadCalls.length;
    await answer503();
    expect(s.threadCalls.length - reads, "the uncertain outcome's one recovery read").toBe(1);
    expect(status()).toMatch(/^Not confirmed/);
    const sent = pendingSmsStore.getSnapshot()[0];
    expect(sent.snapshot.requestId).toBe(s.posts[0].body.request_id);

    fireEvent.change(composer(), { target: { value: "Next draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(bubbles()).toHaveLength(0);
    expect(screen.queryByText("No messages yet"), "the latest read failed: history is unknown").toBeNull();
    expect(refreshError()).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);

    await retry();
    expect(s.threadCalls.length - reads, "Retry is one history read").toBe(2);
    expect(s.posts, "Retry never sends the text again").toHaveLength(1);
    expect(refreshError()).toBeInTheDocument();

    s.threadError = null;
    await retry();
    expect(s.threadCalls.length - reads).toBe(3);
    expect(s.posts, "still exactly one POST").toHaveLength(1);
    expect(refreshError()).toBeNull();
    expect(screen.getByText("No messages yet"), "the server holds no saved row for it").toBeInTheDocument();

    // Dismiss only hid the item: the unresolved send keeps its identity, and the draft is untouched.
    const kept = pendingSmsStore.getSnapshot().find((r) => r.localId === sent.localId);
    expect(kept?.snapshot.requestId).toBe(sent.snapshot.requestId);
    expect(kept?.state).toBe("uncertain");
    expect(kept?.hidden).toBe(true);
    expect(composer().value).toBe("Next draft");
  });

  async function answer503() {
    await act(async () => {
      s.posts[0].answer(503, { success: false, code: "SEND_UNCERTAIN", error: "Delivery could not be confirmed." });
      await new Promise((r) => setTimeout(r, 0));
    });
  }
});
