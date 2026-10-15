/**
 * A failed send must not destroy the message the user typed.
 *
 * 2026-10-14 (instant SMS): an SMS now starts synchronously — the composer clears and a pending
 * bubble shows the text at once. A PROVEN refusal returns the text to the untouched composer; an
 * outcome that may have sent stays visible in the bubble as "Not confirmed" and is never restored
 * for a resend. Email keeps the boolean contract below unchanged.
 *
 * THE DEFECT THIS PINS (present at b38253e). `Conversations.handleSendMessage` reports nothing:
 * every failure path is `toast.error(...); return;` (expired session, no email address, no
 * connected mailbox, no phone number, no caller ID) or a `catch` that swallows a throw, and the
 * function then resolves `undefined` exactly as a success does. `ConversationThread.handleSend`
 * awaits it and unconditionally clears the composer, so the user watches their message vanish and
 * is told only that something went wrong — with nothing left to retry, and no copy of the text.
 *
 * The contract is now explicit: `onSendMessage` resolves `true` ONLY after a confirmed provider
 * success. The composer is cleared and the thread refreshed on `true`, and on nothing else.
 *
 * These tests drive the REAL page and the REAL ConversationThread, so the whole chain — page
 * handler, boolean, composer — is exercised rather than a stub of it.
 */

import React from "react";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const AGENT = "00000000-0000-4000-8000-000000000001";
const CONTACT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTACT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MESSAGE_ID = "6f2c1a8e-7d3b-4c5a-9e1f-0a2b3c4d5e6f";
const RECEIPT = { success: true, message_id: MESSAGE_ID, provider_message_id: "SM1", status: "queued" };
const PROVEN_REFUSAL = { success: false, code: "PHONE", error: "carrier rejected" };

const sendState = vi.hoisted(() => ({
  /** Session returned by supabase.auth.getSession(). */
  accessToken: "token" as string | null,
  callerNumber: "+15550001111" as string | null,
  /** Email connections returned to the page. */
  connections: [] as Record<string, unknown>[],
  /** Result of emailSupabaseApi.sendContactEmail. */
  emailResult: { success: true } as Record<string, unknown>,
  emailThrows: null as string | null,
  /** Result body and HTTP status of the twilio-sms fetch. */
  smsResult: {} as Record<string, unknown>,
  smsStatus: 200,
  smsThrows: null as string | null,
  /** The saved `messages` row the targeted read returns (null = not visible yet). */
  savedRow: null as Record<string, unknown> | null,
  messageReads: [] as Record<string, unknown>[],
  smsRequests: [] as Record<string, unknown>[],
  /** Contacts as the sidebar reports them. */
  contacts: [] as Record<string, unknown>[],
  /** Contact ids whose thread load hangs until released. */
  threadDefer: new Set<string>(),
  threadPending: [] as { contactId: string; resolve: () => void }[],
  threadCalls: [] as string[],
  /** Whether the page is rendered under a Super Admin "View As". */
  isImpersonating: false,
  /**
   * Every REAL-OPERATOR credential the send path reaches for, in order.
   *
   * The refusal has to come BEFORE these, not after: a guard placed after the reads would still
   * have fetched the operator's connected mailboxes and session token while impersonating.
   */
  credentialReads: [] as string[],
  /** The `onSendMessage` the page hands the thread, captured from the real prop contract. */
  lastOnSend: null as null | ((t: string, c: "sms" | "email", s?: string) => Promise<boolean>),
  lastOnSubmitSms: null as null | ((t: string, origin: { sinkId: string | null; clear: () => number }) => boolean),
}));

const toastState = vi.hoisted(() => ({ errors: [] as string[], successes: [] as string[], warnings: [] as string[] }));

vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => { toastState.errors.push(String(m)); },
    success: (m: string) => { toastState.successes.push(String(m)); },
    warning: (m: string) => { toastState.warnings.push(String(m)); },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: AGENT },
    profile: { id: AGENT, organization_id: ORG, role: "Agent" },
    isImpersonating: sendState.isImpersonating,
    isBuildingOrganization: false,
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: ORG, role: "Agent", isSuperAdmin: false }),
}));
vi.mock("@/contexts/TwilioContext", () => ({
  useTwilio: () => ({ selectedCallerNumber: sendState.callerNumber }),
}));
vi.mock("@/lib/supabase-email", () => ({
  emailSupabaseApi: {
    getMyConnections: () => {
      sendState.credentialReads.push("email-connections");
      return Promise.resolve(sendState.connections);
    },
    sendContactEmail: () => {
      if (sendState.emailThrows) return Promise.reject(new Error(sendState.emailThrows));
      return Promise.resolve(sendState.emailResult);
    },
  },
}));
vi.mock("@/lib/supabase-users", () => ({
  usersSupabaseApi: { getAgentScopeIds: () => Promise.resolve([AGENT]) },
}));
vi.mock("@/integrations/supabase/client", () => {
  // A chainable builder: list reads resolve to no rows; the targeted `messages` read resolves to
  // the saved row, recording its filters.
  const builder = (table: string) => {
    const filters: Record<string, unknown> = { table };
    const chain: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      maybeSingle: () => {
        sendState.messageReads.push({ ...filters });
        return Promise.resolve({ data: table === "messages" ? sendState.savedRow : null, error: null });
      },
      eq: (column: string, value: unknown) => { filters[column] = value; return chain; },
    };
    for (const m of ["select", "or", "in", "order", "limit", "not", "is", "neq", "gte", "lt"]) chain[m] = () => chain;
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: () => builder("rpc"),
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => {},
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getSession: () => {
          sendState.credentialReads.push("session");
          return Promise.resolve({
            data: { session: sendState.accessToken ? { access_token: sendState.accessToken, user: {id:AGENT} } : null },
          });
        },
      },
    },
  };
});
vi.mock("@/lib/supabase-messages", async (orig) => {
  const actual = await orig<typeof import("@/lib/supabase-messages")>();
  return {
    ...actual,
    messagesSupabaseApi: {
      getRecentConversations: () => Promise.resolve(sendState.contacts),
      resolveScopedContact: () => Promise.resolve(null),
      getConversationThread: (contactId: string) => {
        sendState.threadCalls.push(contactId);
        if (sendState.threadDefer.has(contactId)) {
          return new Promise<unknown[]>((resolve) => {
            sendState.threadPending.push({ contactId, resolve: () => resolve([]) });
          });
        }
        return Promise.resolve([]);
      },
    },
  };
});
vi.mock("@/components/conversations/ConversationThread", async (orig) => {
  // A PASSTHROUGH, not a stub: the real component still renders, so the composer-vs-notice
  // assertions exercise the real contract. This only records the handler the page passes down,
  // which is the actual send boundary.
  const actual = (await orig()) as { default: React.ComponentType<Record<string, unknown>> };
  const Real = actual.default;
  return {
    default: (props: Record<string, unknown>) => {
      sendState.lastOnSend = props.onSendMessage as typeof sendState.lastOnSend;
      sendState.lastOnSubmitSms = props.onSubmitSms as typeof sendState.lastOnSubmitSms;
      return React.createElement(Real, props);
    },
  };
});
vi.mock("@/components/conversations/ContactBriefView", () => ({ default: () => null }));
vi.mock("@/components/ui/RecordingPlayer", () => ({ RecordingPlayer: () => null }));
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(""), () => {}],
  useNavigate: () => () => {},
}));

import Conversations from "@/pages/Conversations";
import { PendingSmsAuthorityBridge } from "@/components/messaging/PendingSmsAuthorityBridge";
import { pendingSmsStore } from "@/lib/sms-send/pendingSmsStore";

const convo = (contactId: string, name: string, over: Record<string, unknown> = {}) => ({
  contact_id: contactId, contact_name: name, contact_type: "lead",
  contact_phone: "555-0100", contact_email: `${name}@example.test`,
  last_message: "hi", last_message_at: "2026-08-20T00:00:00Z",
  channel: "sms", direction: "outbound", ...over,
});

const composer = () => document.querySelector('input[placeholder="Type SMS message…"]') as HTMLInputElement;
const emailBody = () => document.querySelector('textarea[placeholder="Type EMAIL message…"]') as HTMLTextAreaElement;
const subject = () => document.querySelector('input[placeholder="Subject"]') as HTMLInputElement;
const sendButton = () => screen.getByRole("button", { name: /^send$/i });
const emailTab = () => screen.getByRole("button", { name: /^email$/i });

beforeEach(() => {
  sendState.accessToken = "token";
  sendState.callerNumber = "+15550001111";
  sendState.connections = [{ id: "conn-1", status: "connected", provider_account_email: "me@x.test" }];
  sendState.emailResult = { success: true };
  sendState.emailThrows = null;
  sendState.smsResult = RECEIPT;
  sendState.smsStatus = 200;
  sendState.smsThrows = null;
  sendState.smsRequests = [];
  sendState.savedRow = {
    id: MESSAGE_ID, direction: "outbound", body: DRAFT, from_number: "+15550001111", to_number: "+15550100",
    status: "queued", sent_at: "2026-10-14T15:00:00Z", created_at: "2026-10-14T15:00:00Z",
    contact_id: null, lead_id: CONTACT_A, contact_type: "lead", created_by: AGENT, organization_id: ORG, provider_message_id: "SM1",
  };
  sendState.messageReads = [];
  sendState.contacts = [convo(CONTACT_A, "Alpha")];
  sendState.threadDefer = new Set();
  sendState.threadPending = [];
  sendState.threadCalls = [];
  sendState.isImpersonating = false;
  sendState.credentialReads = [];
  sendState.lastOnSend = null;
  sendState.lastOnSubmitSms = null;
  toastState.errors = [];
  toastState.successes = [];
  toastState.warnings = [];
  pendingSmsStore.reset();
  if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
  }
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    sendState.credentialReads.push("twilio-sms");
    sendState.smsRequests.push(JSON.parse(String(init.body)));
    if (sendState.smsThrows) return Promise.reject(new Error(sendState.smsThrows));
    return Promise.resolve({
      status: sendState.smsStatus,
      text: () => Promise.resolve(JSON.stringify(sendState.smsResult)),
    } as Response);
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** The page as the app mounts it: the authority bridge binds the real identity once. */
const page = () => (
  <>
    <PendingSmsAuthorityBridge />
    <Conversations />
  </>
);

/** Render the page and open contact `name`'s thread. */
async function openThread(name = "Alpha") {
  render(page());
  fireEvent.click(await screen.findByText(name));
  await waitFor(() => expect(composer() ?? emailBody()).toBeTruthy());
}

/** Open a thread under "View As", where the composer is replaced by the read-only notice. */
async function openThreadReadOnly(name = "Alpha") {
  render(page());
  fireEvent.click(await screen.findByText(name));
  await screen.findByTestId("thread-readonly-notice");
}

async function typeSms(text: string) {
  fireEvent.change(composer(), { target: { value: text } });
  expect(composer().value).toBe(text);
}

async function clickSend() {
  await act(async () => {
    fireEvent.click(sendButton());
    await new Promise((r) => setTimeout(r, 0));
  });
}

const DRAFT = "PLEASE-DO-NOT-LOSE-THIS";

const pending = () => screen.queryByTestId("pending-sms");
const pendingStatus = () => pending()?.querySelector('[role="status"]')?.textContent ?? "";

describe("a PROVEN failure returns the SMS draft", () => {
  it("expired session", async () => {
    sendState.accessToken = null;
    await openThread();
    await typeSms(DRAFT);
    await clickSend();

    expect(composer().value, "the draft was destroyed by a failed send").toBe(DRAFT);
    expect(toastState.errors.join(" ")).toMatch(/session expired/i);
    expect(sendState.smsRequests).toHaveLength(0);
  });

  it("contact has no phone number", async () => {
    sendState.contacts = [convo(CONTACT_A, "Alpha", { contact_phone: null })];
    await openThread();
    await typeSms(DRAFT);
    await clickSend();

    expect(composer().value).toBe(DRAFT);
    expect(toastState.errors.join(" ")).toMatch(/no phone number/i);
  });

  it("the server proves it did not send (an exact pre-send refusal)", async () => {
    sendState.smsResult = PROVEN_REFUSAL;
    sendState.smsStatus = 409;
    await openThread();
    await typeSms(DRAFT);
    await clickSend();

    expect(composer().value).toBe(DRAFT);
    expect(pending(), "a restored draft leaves no failed bubble behind").toBeNull();
    expect(toastState.errors.join(" ")).toMatch(/carrier rejected/i);
  });

  it("a proven refusal does NOT refresh the thread", async () => {
    // A refresh after a refusal is wasted work that also implies to the reader that something landed.
    sendState.smsResult = PROVEN_REFUSAL;
    sendState.smsStatus = 409;
    await openThread();
    const before = sendState.threadCalls.length;
    await typeSms(DRAFT);
    await clickSend();

    expect(sendState.threadCalls.length - before).toBe(0);
  });
});

describe("an UNCONFIRMED failure keeps the text visible but never offers it for a resend", () => {
  // The old contract restored the draft after ANY failure, which invited a second send of a text
  // the provider may already have accepted. Now the text stays on screen in its bubble.
  it("an unrecognised failure body is Not confirmed, not restored", async () => {
    sendState.smsResult = { success: false, error: "carrier rejected" };
    await openThread();
    await typeSms(DRAFT);
    await clickSend();

    expect(composer().value).toBe("");
    expect(pending()).toHaveTextContent(DRAFT);
    expect(pendingStatus()).toMatch(/not confirmed/i);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(toastState.errors.join(" ")).toMatch(/carrier rejected/i);
  });

  it("the request throws after dispatch", async () => {
    sendState.smsThrows = "network down";
    await openThread();
    await typeSms(DRAFT);
    await clickSend();

    expect(composer().value).toBe("");
    expect(pending()).toHaveTextContent(DRAFT);
    expect(pendingStatus()).toMatch(/not confirmed/i);
    expect(toastState.errors.join(" ")).toMatch(/connection dropped/i);
  });

  it("a non-Error throw still reports a message", async () => {
    // `err.message` on a non-Error is undefined, and `toast.error(undefined)` tells the user
    // nothing — the one thing a failed send must not do.
    vi.stubGlobal("fetch", () => Promise.reject("a bare string, not an Error"));
    await openThread();
    await typeSms(DRAFT);
    await clickSend();

    expect(toastState.errors).toHaveLength(1);
    expect(toastState.errors[0], "a non-Error failure toasted nothing readable").toBeTruthy();
    expect(String(toastState.errors[0])).not.toBe("undefined");
  });

  it("refreshes the thread once, quietly, to show whatever was saved", async () => {
    sendState.smsResult = { success: false, code: "SEND_UNCERTAIN", error: "Delivery could not be confirmed." };
    sendState.smsStatus = 503;
    await openThread();
    const before = sendState.threadCalls.length;
    await typeSms(DRAFT);
    await clickSend();

    expect(sendState.threadCalls.length - before).toBe(1);
    expect(screen.queryByText("No messages yet")).toBeNull();
    expect(pending()).toHaveTextContent(DRAFT);
  });
});

describe("a failed EMAIL send keeps the draft and the subject", () => {
  async function openEmail() {
    await openThread();
    fireEvent.click(emailTab());
    await waitFor(() => expect(emailBody()).toBeTruthy());
    fireEvent.change(subject(), { target: { value: "SUBJECT-KEEP-ME" } });
    fireEvent.change(emailBody(), { target: { value: DRAFT } });
  }

  it("contact has no email address", async () => {
    sendState.contacts = [convo(CONTACT_A, "Alpha", { contact_email: null })];
    await openEmail();
    await clickSend();

    expect(emailBody().value).toBe(DRAFT);
    expect(subject().value).toBe("SUBJECT-KEEP-ME");
    expect(toastState.errors.join(" ")).toMatch(/no email address/i);
  });

  it("no connected mailbox", async () => {
    sendState.connections = [];
    await openEmail();
    await clickSend();

    expect(emailBody().value).toBe(DRAFT);
    expect(subject().value).toBe("SUBJECT-KEEP-ME");
    expect(toastState.errors.join(" ")).toMatch(/no connected email/i);
  });

  it("the provider reports failure", async () => {
    sendState.emailResult = { success: false, error: "mailbox full" };
    await openEmail();
    await clickSend();

    expect(emailBody().value).toBe(DRAFT);
    expect(subject().value).toBe("SUBJECT-KEEP-ME");
    expect(toastState.errors.join(" ")).toMatch(/mailbox full/i);
  });

  it("the request throws", async () => {
    sendState.emailThrows = "smtp exploded";
    await openEmail();
    await clickSend();

    expect(emailBody().value).toBe(DRAFT);
    expect(toastState.errors.join(" ")).toMatch(/smtp exploded/i);
  });

  it("expired session", async () => {
    sendState.accessToken = null;
    await openEmail();
    await clickSend();

    expect(emailBody().value).toBe(DRAFT);
    expect(subject().value).toBe("SUBJECT-KEEP-ME");
  });
});

// POSITIVE CONTROLS. A fix that simply stops clearing (and therefore never clears) fails here.
describe("a SUCCESSFUL send clears the composer", () => {
  it("SMS: clears at once, shows one saved message, and does not reload the whole thread", async () => {
    await openThread();
    const before = sendState.threadCalls.length;
    await typeSms(DRAFT);
    // fireEvent commits React's work synchronously; the request's promises have not run yet.
    fireEvent.click(sendButton());
    expect(composer().value).toBe("");
    expect(pending()).toHaveTextContent(DRAFT);
    expect(pendingStatus()).toMatch(/sending/i);
    expect(sendState.smsRequests, "the bubble is on screen before anything was sent").toHaveLength(0);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(screen.getAllByText(DRAFT), "exactly one copy of the sent text").toHaveLength(1);
    expect(pending(), "the saved row replaced the pending bubble").toBeNull();
    expect(sendState.messageReads).toEqual([{ table: "messages", id: MESSAGE_ID, organization_id: ORG }]);
    expect(sendState.threadCalls.length - before, "no full reload after a send").toBe(0);
    expect(toastState.errors).toEqual([]);
    expect(toastState.successes, "no SMS success toast").toEqual([]);
  });

  it("email success clears the body and the subject", async () => {
    await openThread();
    fireEvent.click(emailTab());
    await waitFor(() => expect(emailBody()).toBeTruthy());
    fireEvent.change(subject(), { target: { value: "SUBJECT-KEEP-ME" } });
    fireEvent.change(emailBody(), { target: { value: DRAFT } });

    await clickSend();

    expect(emailBody().value).toBe("");
    expect(subject().value).toBe("");
    expect(toastState.errors).toEqual([]);
    expect(toastState.successes).toEqual(["Email sent"]);
  });
});

// NON-REGRESSION GUARDS. Both PASS at b38253e — the contact-switch guard added in the previous
// pass already covered this. They are kept so the new boolean gate cannot reintroduce the leak.
describe("a send that completes after a contact switch cannot touch the new contact", () => {
  it("a FAILED send for A leaves B's fresh draft alone", async () => {
    sendState.contacts = [convo(CONTACT_A, "Alpha"), convo(CONTACT_B, "Beta")];
    // A proven refusal is the case that restores text, so it is the one that could leak into B.
    sendState.smsResult = PROVEN_REFUSAL;
    sendState.smsStatus = 409;
    await openThread("Alpha");
    await typeSms("DRAFT-FOR-ALPHA");

    fireEvent.click(sendButton());
    // Switch while A's send is still resolving.
    fireEvent.click(screen.getByText("Beta"));
    await waitFor(() => expect(composer()).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "DRAFT-FOR-BETA" } });

    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    expect(composer().value, "A's failed send disturbed B's composer").toBe("DRAFT-FOR-BETA");
  });

  it("a SUCCESSFUL send for A does not clear B's fresh draft", async () => {
    sendState.contacts = [convo(CONTACT_A, "Alpha"), convo(CONTACT_B, "Beta")];
    await openThread("Alpha");
    await typeSms("DRAFT-FOR-ALPHA");

    fireEvent.click(sendButton());
    fireEvent.click(screen.getByText("Beta"));
    await waitFor(() => expect(composer()).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "DRAFT-FOR-BETA" } });

    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    expect(composer().value, "A's successful send wiped B's composer").toBe("DRAFT-FOR-BETA");
  });
});


// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("View As is READ-ONLY in Conversations", () => {
  /**
   * THE DEFECT. Repairing the impersonation payload made Conversations usable under "View As" — and
   * the composer came with it. Every credential `handleSendMessage` needs belongs to the REAL
   * operator: `supabase.auth.getSession()` returns the operator's token, `getMyConnections()` their
   * mailboxes, `selectedCallerNumber` whatever number they last picked in their own dialer. A send
   * would deliver a message from the operator's address or phone number to a contact belonging to
   * the viewed agent — invisible in that agent's own history and uninterpretable to the recipient.
   *
   * Reads stay available: the sidebar and thread are effective-viewer scoped already.
   */
  it("renders no composer, so there is nothing to send", async () => {
    sendState.isImpersonating = true;
    await openThreadReadOnly();

    expect(screen.getByTestId("thread-readonly-notice")).toBeTruthy();
    expect(composer(), "the SMS composer rendered under View As").toBeFalsy();
    expect(screen.queryByRole("button", { name: /^send$/i }), "a Send button rendered under View As").toBeNull();
  });

  it("still renders the thread — reads are not withheld", async () => {
    sendState.isImpersonating = true;
    await openThreadReadOnly();

    // The whole point of supporting this surface. A fail-closed guard that also broke reading
    // would be a regression, not a fix.
    expect(sendState.threadCalls).toContain(CONTACT_A);
  });

  it("reads NONE of the operator's sending credentials", async () => {
    sendState.isImpersonating = true;
    await openThreadReadOnly();

    expect(
      sendState.credentialReads,
      "the page reached for the real operator's credentials while impersonating",
    ).toEqual([]);
  });

  it("direct send handler calls refuse BEFORE touching session, mailbox or Twilio", async () => {
    // The composer is gone, but the handlers are the actual boundary — a future surface that calls
    // them must be refused too, and refused before any credential is read.
    sendState.isImpersonating = true;
    await openThreadReadOnly();
    sendState.credentialReads = [];

    const sentEmail = await act(async () => sendState.lastOnSend!("hello", "email"));
    const clear = vi.fn(() => 0);
    const startedSms = sendState.lastOnSubmitSms!("hello", { sinkId: null, clear });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(sentEmail, "an impersonated email reported success").toBe(false);
    expect(startedSms, "an impersonated SMS started").toBe(false);
    expect(clear, "the composer was cleared for a refused send").not.toHaveBeenCalled();
    expect(sendState.credentialReads, "a credential was read before the refusal").toEqual([]);
    expect(toastState.errors.filter((m) => /read-only/i.test(m))).toHaveLength(2);
    expect(pendingSmsStore.getSnapshot()).toEqual([]);
  });
});

describe("manual SMS request contract", () => {
  it("sends without website enrollment, a purpose, or a selected voice number", async () => {
    sendState.callerNumber = null;
    await openThread();
    expect(screen.queryByLabelText("Text purpose")).toBeNull();
    expect(screen.queryByText(/Informational:|Marketing:|Choose a text purpose|Refresh/)).toBeNull();
    await typeSms(DRAFT);
    await clickSend();
    expect(composer().value).toBe("");
    expect(sendState.smsRequests).toHaveLength(1);
    expect(sendState.smsRequests[0]).toMatchObject({ body: DRAFT, contact_id: CONTACT_A, contact_type: "lead", actor_id: AGENT, organization_id: ORG, view_as: false });
    expect(sendState.smsRequests[0]).not.toHaveProperty("purpose");
    expect(sendState.smsRequests[0]).not.toHaveProperty("from");
    expect(sendState.smsRequests[0].request_id).toEqual(expect.any(String));
  });

  it("passes the selected voice number as a sender preference without changing it", async () => {
    await openThread();
    await typeSms(DRAFT);
    await clickSend();
    expect(sendState.smsRequests[0].from).toBe("+15550001111");
    expect(sendState.callerNumber).toBe("+15550001111");
  });

  it("a proven refusal returns the draft, and resending it reuses the same request ID", async () => {
    sendState.smsResult = PROVEN_REFUSAL;
    sendState.smsStatus = 409;
    await openThread();
    await typeSms(DRAFT);
    await clickSend();
    expect(composer().value).toBe(DRAFT);
    await clickSend();
    expect(composer().value).toBe(DRAFT);
    expect(sendState.smsRequests).toHaveLength(2);
    expect(sendState.smsRequests[1].request_id).toBe(sendState.smsRequests[0].request_id);
    expect(toastState.errors).toEqual(["carrier rejected", "carrier rejected"]);
  });

  it("a suppressed recipient is Not confirmed; retyping the same text keeps its request ID", async () => {
    // SMS_STATE also covers post-attempt persistence failures, so it never proves non-sending.
    sendState.smsResult = { success: false, code: "SMS_STATE", error: "Recipient opted out" };
    sendState.smsStatus = 409;
    await openThread();
    await typeSms(DRAFT);
    await clickSend();
    expect(composer().value).toBe("");
    expect(pendingStatus()).toMatch(/not confirmed/i);
    await typeSms(DRAFT);
    await clickSend();
    expect(sendState.smsRequests).toHaveLength(2);
    expect(sendState.smsRequests[1].request_id).toBe(sendState.smsRequests[0].request_id);
  });

  it("identical text after a confirmed send is a new message with a new request ID", async () => {
    await openThread();
    await typeSms(DRAFT);
    await clickSend();
    const SECOND = "7f2c1a8e-7d3b-4c5a-9e1f-0a2b3c4d5e6f";
    sendState.smsResult = { ...RECEIPT, message_id: SECOND };
    sendState.savedRow = { ...sendState.savedRow, id: SECOND };
    await typeSms(DRAFT);
    await clickSend();
    expect(screen.getAllByText(DRAFT), "two intentional texts are two messages").toHaveLength(2);
    expect(sendState.smsRequests).toHaveLength(2);
    expect(sendState.smsRequests[1].request_id).not.toBe(sendState.smsRequests[0].request_id);
  });

  it("rejects a second send while the first request is still in flight", async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    await openThread();
    await typeSms(DRAFT);
    const origin = () => ({ sinkId: null, clear: () => 0 });
    let first!: boolean;
    await act(async () => { first = sendState.lastOnSubmitSms!(DRAFT, origin()); });
    const second = sendState.lastOnSubmitSms!(DRAFT, origin());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sendButton(), "Send stays unavailable for this contact while its text is in flight").toBeDisabled();
    await act(async () => {
      finish({ status: 200, text: async () => JSON.stringify(RECEIPT) } as Response);
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("a double click and Enter+click dispatch once", async () => {
    await openThread();
    await typeSms(DRAFT);
    await act(async () => {
      fireEvent.keyDown(composer(), { key: "Enter" });
      fireEvent.click(sendButton());
      fireEvent.click(sendButton());
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(sendState.smsRequests).toHaveLength(1);
  });
});

describe("ordinary sending is unchanged", () => {
  // POSITIVE CONTROLS — pass at b29dc9f. The read-only guard must be invisible without View As.
  it("renders the composer and sends", async () => {
    await openThread();
    await typeSms(DRAFT);
    await clickSend();

    expect(composer().value, "a successful send did not clear the composer").toBe("");
    expect(toastState.successes, "manual SMS has no success toast").toEqual([]);
    expect(sendState.credentialReads).toContain("session");
    expect(sendState.credentialReads).toContain("twilio-sms");
  });

  it("no read-only notice is rendered", async () => {
    await openThread();
    expect(screen.queryByTestId("thread-readonly-notice")).toBeNull();
  });
});
