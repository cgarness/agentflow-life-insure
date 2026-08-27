/**
 * A failed send must not destroy the message the user typed.
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

const sendState = vi.hoisted(() => ({
  /** Session returned by supabase.auth.getSession(). */
  accessToken: "token" as string | null,
  callerNumber: "+15550001111" as string | null,
  /** Email connections returned to the page. */
  connections: [] as Record<string, unknown>[],
  /** Result of emailSupabaseApi.sendContactEmail. */
  emailResult: { success: true } as Record<string, unknown>,
  emailThrows: null as string | null,
  /** Result body of the twilio-sms fetch. */
  smsResult: { success: true } as Record<string, unknown>,
  smsThrows: null as string | null,
  /** Contacts as the sidebar reports them. */
  contacts: [] as Record<string, unknown>[],
  /** Contact ids whose thread load hangs until released. */
  threadDefer: new Set<string>(),
  threadPending: [] as { contactId: string; resolve: () => void }[],
  threadCalls: [] as string[],
}));

const toastState = vi.hoisted(() => ({ errors: [] as string[], successes: [] as string[] }));

vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => { toastState.errors.push(String(m)); },
    success: (m: string) => { toastState.successes.push(String(m)); },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: AGENT },
    profile: { id: AGENT, organization_id: ORG, role: "Agent" },
    isImpersonating: false,
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
    getMyConnections: () => Promise.resolve(sendState.connections),
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
  const res = Promise.resolve({ data: [], error: null });
  const b: Record<string, unknown> = new Proxy({}, {
    get: (_t, p) => (p === "then" ? (res as never as { then: never }).then.bind(res) : () => b),
  });
  return {
    supabase: {
      from: () => b,
      rpc: () => b,
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => {},
      auth: {
        getSession: () => Promise.resolve({
          data: { session: sendState.accessToken ? { access_token: sendState.accessToken } : null },
        }),
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
vi.mock("@/components/conversations/ContactBriefView", () => ({ default: () => null }));
vi.mock("@/components/ui/RecordingPlayer", () => ({ RecordingPlayer: () => null }));
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(""), () => {}],
  useNavigate: () => () => {},
}));

import Conversations from "@/pages/Conversations";

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
  sendState.smsResult = { success: true };
  sendState.smsThrows = null;
  sendState.contacts = [convo(CONTACT_A, "Alpha")];
  sendState.threadDefer = new Set();
  sendState.threadPending = [];
  sendState.threadCalls = [];
  toastState.errors = [];
  toastState.successes = [];
  if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
  }
  vi.stubGlobal("fetch", () => {
    if (sendState.smsThrows) return Promise.reject(new Error(sendState.smsThrows));
    return Promise.resolve({ json: () => Promise.resolve(sendState.smsResult) } as Response);
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Render the page and open contact `name`'s thread. */
async function openThread(name = "Alpha") {
  render(<Conversations />);
  fireEvent.click(await screen.findByText(name));
  await waitFor(() => expect(composer() ?? emailBody()).toBeTruthy());
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

describe("a failed SMS send keeps the draft", () => {
  it("expired session", async () => {
    sendState.accessToken = null;
    await openThread();
    await typeSms(DRAFT);
    await clickSend();

    expect(composer().value, "the draft was destroyed by a failed send").toBe(DRAFT);
    expect(toastState.errors.join(" ")).toMatch(/session expired/i);
  });

  it("contact has no phone number", async () => {
    sendState.contacts = [convo(CONTACT_A, "Alpha", { contact_phone: null })];
    await openThread();
    await typeSms(DRAFT);
    await clickSend();

    expect(composer().value).toBe(DRAFT);
    expect(toastState.errors.join(" ")).toMatch(/no phone number/i);
  });

  it("no caller ID selected", async () => {
    sendState.callerNumber = null;
    await openThread();
    await typeSms(DRAFT);
    await clickSend();

    expect(composer().value).toBe(DRAFT);
    expect(toastState.errors.join(" ")).toMatch(/caller id/i);
  });

  it("the provider reports failure", async () => {
    sendState.smsResult = { success: false, error: "carrier rejected" };
    await openThread();
    await typeSms(DRAFT);
    await clickSend();

    expect(composer().value).toBe(DRAFT);
    expect(toastState.errors.join(" ")).toMatch(/carrier rejected/i);
  });

  it("the request throws", async () => {
    sendState.smsThrows = "network down";
    await openThread();
    await typeSms(DRAFT);
    await clickSend();

    expect(composer().value).toBe(DRAFT);
    expect(toastState.errors.join(" ")).toMatch(/network down/i);
  });

  it("a failed send does NOT refresh the thread", async () => {
    // A refresh after a failure is wasted work that also implies to the reader that something
    // landed. The reload belongs to the success path only.
    sendState.smsResult = { success: false, error: "carrier rejected" };
    await openThread();
    const before = sendState.threadCalls.length;
    await typeSms(DRAFT);
    await clickSend();

    expect(sendState.threadCalls.length - before).toBe(0);
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

// POSITIVE CONTROLS. Both PASS at b38253e — the old code cleared unconditionally, so it "passed"
// the success case for the wrong reason. They are here so a fix that simply stops clearing (and
// therefore never clears) fails loudly instead of shipping.
describe("a SUCCESSFUL send clears the composer and refreshes", () => {
  it("SMS success clears the draft and reloads the thread", async () => {
    await openThread();
    const before = sendState.threadCalls.length;
    await typeSms(DRAFT);
    await clickSend();

    expect(composer().value).toBe("");
    expect(toastState.errors).toEqual([]);
    expect(sendState.threadCalls.length - before, "success must refresh the thread").toBe(1);
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
  });
});

// NON-REGRESSION GUARDS. Both PASS at b38253e — the contact-switch guard added in the previous
// pass already covered this. They are kept so the new boolean gate cannot reintroduce the leak.
describe("a send that completes after a contact switch cannot touch the new contact", () => {
  it("a FAILED send for A leaves B's fresh draft alone", async () => {
    sendState.contacts = [convo(CONTACT_A, "Alpha"), convo(CONTACT_B, "Beta")];
    sendState.smsThrows = "network down";
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
