/**
 * Same-render stale-data exposure.
 *
 * THE DEFECT THIS PINS: clearing state in a passive `useEffect` keyed on an identity is ONE COMMIT
 * TOO LATE. React's order is: render → commit DOM → layout effects → paint → passive effects. So on
 * the render where the viewer (or contact) identity changes, the PREVIOUS identity's data is still
 * in state, is rendered, and is painted — the passive effect that clears it only runs afterwards.
 *
 * A test that merely `waitFor`s the cleared/reloaded state cannot see this: by the time it asserts,
 * the passive effect has already run. So these tests install a RECORDER whose `useLayoutEffect`
 * (no dep array) snapshots `document.body.textContent` after EVERY commit, before any passive
 * effect. The recorder is a sibling of the component under test, and the DOM is fully committed
 * before any layout effect runs, so the log is an exact frame-by-frame transcript of what a user
 * could actually see.
 *
 * The fix under test is render-time identity matching: state is stored WITH the key it was loaded
 * for, and read back through a derived value, so a mismatched key yields empty on the very render
 * the identity changes.
 */

import React from "react";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONTACT_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONTACT_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** Frame-by-frame transcript of the committed DOM. */
const frames: string[] = [];

const Recorder: React.FC = () => {
  React.useLayoutEffect(() => {
    frames.push(document.body.textContent ?? "");
  });
  return null;
};

/** Every committed frame, including the one between the identity change and the passive effect. */
const framesContaining = (needle: string) => frames.filter((f) => f.includes(needle));

const apiState = vi.hoisted(() => ({
  conversations: {} as Record<string, Record<string, unknown>[]>,
  contacts: {} as Record<string, Record<string, unknown> | null>,
  contactError: null as string | null,
  contactDelayMs: 0,
}));

vi.mock("@/lib/supabase-messages", () => ({
  messagesSupabaseApi: {
    getRecentConversations: (scope: { agentIds?: string[] } | null) => {
      const key = scope?.agentIds?.[0] ?? "org";
      return Promise.resolve(apiState.conversations[key] ?? []);
    },
    resolveScopedContact: () => Promise.resolve(null),
    getConversationThread: () => Promise.resolve([]),
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    const rec = { eq: {} as Record<string, unknown> };
    const settle = async () => {
      if (apiState.contactDelayMs > 0) {
        await new Promise((r) => setTimeout(r, apiState.contactDelayMs));
      }
      if (apiState.contactError) return { data: null, error: { message: apiState.contactError } };
      const id = rec.eq.id as string;
      return { data: apiState.contacts[id] ?? null, error: null };
    };
    const b: Record<string, unknown> = {
      select() { return b; },
      eq(col: string, val: unknown) { rec.eq[col] = val; return b; },
      maybeSingle() { return settle(); },
      single() { return settle(); },
      order() { return b; },
      limit() { return b; },
      then(resolve: (v: unknown) => unknown) { return settle().then(resolve); },
    };
    void table;
    return b;
  }
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => {},
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    },
  };
});

vi.mock("react-router-dom", () => ({
  useNavigate: () => () => {},
}));

import ConversationsSidebar from "@/components/conversations/ConversationsSidebar";
import ContactBriefView from "@/components/conversations/ContactBriefView";
import type { ConversationScope } from "@/lib/conversationScope";

function convo(contactId: string, name: string) {
  return {
    contact_id: contactId, contact_name: name, contact_type: "lead",
    contact_phone: "555", contact_email: "a@example.test",
    last_message: `msg-${name}`, last_message_at: "2026-08-20T00:00:00Z",
    channel: "sms", direction: "outbound",
  };
}

const agentScope = (agentId: string): ConversationScope =>
  ({ kind: "agents", organizationId: ORG, agentIds: [agentId] });

beforeEach(() => {
  frames.length = 0;
  apiState.conversations = {};
  apiState.contacts = {};
  apiState.contactError = null;
  apiState.contactDelayMs = 0;
});

afterEach(cleanup);

describe("ConversationsSidebar — a new scope never renders the previous scope's rows", () => {
  it("Agent A's conversation appears in NO frame after the scope changes to Agent B", async () => {
    apiState.conversations[AGENT_A] = [convo(CONTACT_A, "AgentA Contact")];
    apiState.conversations[AGENT_B] = [convo(CONTACT_B, "AgentB Contact")];

    const view = (agentId: string) => (
      <>
        <ConversationsSidebar
          scope={agentScope(agentId)}
          scopeKey={`viewer-${agentId}`}
          onSelectContact={() => {}}
        />
        <Recorder />
      </>
    );

    const { rerender } = render(view(AGENT_A));
    await screen.findByText("AgentA Contact");

    const beforeSwitch = frames.length;
    rerender(view(AGENT_B));
    await screen.findByText("AgentB Contact");

    // Every frame committed from the switch onward — including the very first one, which is where
    // a passive-effect clear leaks the previous scope's row.
    const afterSwitch = frames.slice(beforeSwitch);
    expect(afterSwitch.length).toBeGreaterThan(0);
    expect(afterSwitch.filter((f) => f.includes("AgentA Contact"))).toEqual([]);
  });

  it("an unresolved scope renders nothing from the previous scope", async () => {
    apiState.conversations[AGENT_A] = [convo(CONTACT_A, "AgentA Contact")];

    const view = (scope: ConversationScope | null, key: string | null) => (
      <>
        <ConversationsSidebar scope={scope} scopeKey={key} onSelectContact={() => {}} />
        <Recorder />
      </>
    );

    const { rerender } = render(view(agentScope(AGENT_A), "viewer-a"));
    await screen.findByText("AgentA Contact");

    const beforeSwitch = frames.length;
    rerender(view(null, null)); // scope resolution restarted for a new viewer

    expect(frames.slice(beforeSwitch).filter((f) => f.includes("AgentA Contact"))).toEqual([]);
  });
});

describe("ContactBriefView — contact B never renders contact A's details", () => {
  const contactRow = (id: string, name: string) => ({
    id, first_name: name, last_name: "Person", phone: "5551230000",
    email: `${name.toLowerCase()}@example.test`, state: "TX", status: "New",
  });

  it("shows nothing of contact A in any frame after switching to contact B — including while loading", async () => {
    apiState.contacts[CONTACT_A] = contactRow(CONTACT_A, "Alpha");
    apiState.contacts[CONTACT_B] = contactRow(CONTACT_B, "Beta");

    const view = (id: string) => (
      <>
        <ContactBriefView contactId={id} contactType="lead" />
        <Recorder />
      </>
    );

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText(/Alpha/);

    const beforeSwitch = frames.length;
    apiState.contactDelayMs = 20; // make the loading window real
    rerender(view(CONTACT_B));
    await screen.findByText(/Beta/);

    const afterSwitch = frames.slice(beforeSwitch);
    expect(afterSwitch.length).toBeGreaterThan(0);
    expect(afterSwitch.filter((f) => f.includes("Alpha"))).toEqual([]);
    expect(afterSwitch.filter((f) => f.includes("alpha@example.test"))).toEqual([]);
  });

  it("a FAILING load for contact B never falls back to contact A's details", async () => {
    apiState.contacts[CONTACT_A] = contactRow(CONTACT_A, "Alpha");

    const view = (id: string) => (
      <>
        <ContactBriefView contactId={id} contactType="lead" />
        <Recorder />
      </>
    );

    const { rerender } = render(view(CONTACT_A));
    await screen.findByText(/Alpha/);

    const beforeSwitch = frames.length;
    apiState.contactError = "permission denied";
    rerender(view(CONTACT_B));

    await waitFor(() => expect(screen.queryByText(/Alpha/)).not.toBeInTheDocument());
    expect(frames.slice(beforeSwitch).filter((f) => f.includes("Alpha"))).toEqual([]);
  });

  it("changing only contactType also drops the previous row", async () => {
    apiState.contacts[CONTACT_A] = contactRow(CONTACT_A, "Alpha");

    const view = (type: "lead" | "client") => (
      <>
        <ContactBriefView contactId={CONTACT_A} contactType={type} />
        <Recorder />
      </>
    );

    const { rerender } = render(view("lead"));
    await screen.findByText(/Alpha/);

    const beforeSwitch = frames.length;
    apiState.contacts[CONTACT_A] = null; // not a client
    rerender(view("client"));

    await waitFor(() => expect(screen.queryByText(/Alpha/)).not.toBeInTheDocument());
    expect(frames.slice(beforeSwitch).filter((f) => f.includes("Alpha"))).toEqual([]);
  });
});
