/**
 * Conversations page — effective-viewer scoping, "View As", deep links, stale responses, errors.
 *
 * Before this the page destructured `const { user } = useAuth()` and never referenced it: the
 * sidebar received NO viewer identity at all and `getRecentConversations()` took no parameters.
 * `?contactId=` was unvalidated and `?contactType=` was cast with a `|| 'lead'` default.
 *
 * The real `ConversationsSidebar` is rendered (only the thread and brief panes are stubbed), so
 * these assertions run through the actual list, error and retry paths.
 */

import React from "react";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = "11111111-1111-4111-8111-111111111111";
const SUPER_ADMIN = uid(900);
const AGENT = uid(1);
const CONTACT_IN_SCOPE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTACT_OUT_OF_SCOPE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const authState = vi.hoisted(() => ({
  userId: "00000000-0000-4000-8000-000000000900",
  profileId: "00000000-0000-4000-8000-000000000001",
  role: "Agent",
  isSuperAdmin: false,
  isImpersonating: false,
  organizationId: "11111111-1111-4111-8111-111111111111",
}));

const apiState = vi.hoisted(() => ({
  /** Every scope `getRecentConversations` was called with, in order. */
  scopeCalls: [] as unknown[],
  /** Scope ids the page asked the traversal for. */
  traversalCalls: [] as { viewerId: string; organizationId: string | null }[],
  traversalIds: [] as string[],
  traversalError: null as Error | null,
  conversations: [] as Record<string, unknown>[],
  conversationsError: null as Error | null,
  /** When set, getRecentConversations returns a promise the test resolves by hand. */
  deferred: null as { resolve: (rows: Record<string, unknown>[]) => void } | null,
  resolveContact: null as Record<string, unknown> | null,
}));

const routerState = vi.hoisted(() => ({ params: new URLSearchParams("") }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: authState.userId },
    profile: { id: authState.profileId, organization_id: authState.organizationId, role: authState.role },
    isImpersonating: authState.isImpersonating,
    isBuildingOrganization: false,
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({
    organizationId: authState.organizationId,
    role: authState.role,
    // Mirrors the real hook: `isSuperAdmin || isImpersonating` — TRUE for the whole View As session.
    isSuperAdmin: authState.isSuperAdmin || authState.isImpersonating,
  }),
}));
vi.mock("@/contexts/TwilioContext", () => ({ useTwilio: () => ({ selectedCallerNumber: "+15550001111" }) }));
vi.mock("@/lib/supabase-email", () => ({ emailSupabaseApi: { getMyConnections: () => Promise.resolve([]) } }));
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
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    },
  };
});
vi.mock("@/lib/supabase-users", () => ({
  usersSupabaseApi: {
    getAgentScopeIds: (p: { viewerId: string; organizationId: string | null }) => {
      apiState.traversalCalls.push(p);
      if (apiState.traversalError) return Promise.reject(apiState.traversalError);
      return Promise.resolve(apiState.traversalIds);
    },
  },
}));
vi.mock("@/lib/supabase-messages", async (orig) => {
  const actual = await orig<typeof import("@/lib/supabase-messages")>();
  return {
    ...actual,
    messagesSupabaseApi: {
      getRecentConversations: (scope: unknown) => {
        apiState.scopeCalls.push(scope);
        if (apiState.deferred) {
          return new Promise<Record<string, unknown>[]>((resolve) => {
            apiState.deferred = { resolve };
          });
        }
        if (apiState.conversationsError) return Promise.reject(apiState.conversationsError);
        return Promise.resolve(apiState.conversations);
      },
      resolveScopedContact: () => Promise.resolve(apiState.resolveContact),
      getConversationThread: () => Promise.resolve([]),
    },
  };
});
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [
    routerState.params,
    (next: unknown) => {
      // Mirrors react-router: the setter accepts a URLSearchParams, an init object, or an updater.
      const resolved = typeof next === "function"
        ? (next as (p: URLSearchParams) => unknown)(routerState.params)
        : next;
      routerState.params = resolved instanceof URLSearchParams
        ? resolved
        : new URLSearchParams(resolved as Record<string, string>);
    },
  ],
}));
vi.mock("@/components/conversations/ConversationThread", () => ({
  default: ({ contactId, contactType, contactName }: { contactId: string; contactType: string; contactName: string }) =>
    React.createElement("div", { "data-testid": "thread", "data-type": contactType, "data-name": contactName }, contactId),
}));
vi.mock("@/components/conversations/ContactBriefView", () => ({
  default: ({ contactType }: { contactType: string }) =>
    React.createElement("div", { "data-testid": "brief", "data-type": contactType }),
}));

import ConversationsPage from "@/pages/Conversations";

function convo(contactId: string, name: string, type = "lead") {
  return {
    contact_id: contactId, contact_name: name, contact_type: type,
    contact_phone: "555", contact_email: "a@example.test",
    last_message: `msg-${name}`, last_message_at: "2026-08-20T00:00:00Z",
    channel: "sms", direction: "outbound",
  };
}

beforeEach(() => {
  apiState.scopeCalls = [];
  apiState.traversalCalls = [];
  apiState.traversalIds = [AGENT];
  apiState.traversalError = null;
  apiState.conversations = [];
  apiState.conversationsError = null;
  apiState.deferred = null;
  apiState.resolveContact = null;
  authState.userId = SUPER_ADMIN;
  authState.profileId = AGENT;
  authState.role = "Agent";
  authState.isSuperAdmin = false;
  authState.isImpersonating = false;
  authState.organizationId = ORG;
  routerState.params = new URLSearchParams("");
});

afterEach(cleanup);

describe("the sidebar is scoped to the EFFECTIVE viewer", () => {
  it("an Agent gets an agent-scoped read seeded from profile.id, not user.id", async () => {
    render(<ConversationsPage />);
    await waitFor(() => expect(apiState.scopeCalls.length).toBeGreaterThan(0));

    expect(apiState.scopeCalls[0]).toEqual({ kind: "agents", organizationId: ORG, agentIds: [AGENT] });
    // The requirement is "Agent: own contacts" — pinned to self, so no traversal is even issued.
    expect(apiState.traversalCalls).toHaveLength(0);
  });

  it("a Team Leader gets the recursive downline from the traversal", async () => {
    authState.role = "Team Leader";
    apiState.traversalIds = [AGENT, uid(2), uid(3)];

    render(<ConversationsPage />);
    await waitFor(() => expect(apiState.scopeCalls.length).toBeGreaterThan(0));

    expect(apiState.traversalCalls[0]).toEqual({ viewerId: AGENT, organizationId: ORG });
    expect(apiState.scopeCalls[0]).toEqual({
      kind: "agents", organizationId: ORG, agentIds: [AGENT, uid(2), uid(3)],
    });
  });

  it("an Admin gets an organization scope", async () => {
    authState.role = "Admin";
    render(<ConversationsPage />);
    await waitFor(() => expect(apiState.scopeCalls.length).toBeGreaterThan(0));
    expect(apiState.scopeCalls[0]).toEqual({ kind: "org", organizationId: ORG });
  });

  it("a non-impersonating Super Admin gets their home organization", async () => {
    authState.role = "Super Admin";
    authState.isSuperAdmin = true;
    authState.profileId = SUPER_ADMIN;
    render(<ConversationsPage />);
    await waitFor(() => expect(apiState.scopeCalls.length).toBeGreaterThan(0));
    expect(apiState.scopeCalls[0]).toEqual({ kind: "org", organizationId: ORG });
  });
});

describe("the scope identity is stable across unrelated page re-renders", () => {
  // `resolveConversationScope` builds a FRESH object on every call, and `scope` is a dependency of
  // the sidebar's load callback and of its realtime-subscription effect. Page state that has
  // nothing to do with scoping — opening a conversation, a deep-link resolution — re-renders the
  // page, and an unmemoized `scope` prop would refetch the whole list and tear down and rebuild
  // the realtime channel every single time.
  //
  // (This is bounded, not an infinite loop: sidebar-internal state re-renders the sidebar, not the
  // page, so it cannot feed itself. It is still redundant network and subscription churn on every
  // click, which is why `scope` is memoized.)
  it("does not refetch when opening a conversation re-renders the page", async () => {
    apiState.conversations = [convo(CONTACT_IN_SCOPE, "Stable")];

    render(<ConversationsPage />);
    await screen.findByText("Stable");
    expect(apiState.scopeCalls).toHaveLength(1);

    // Click the row: this sets page state (selectedContact + search params) and re-renders the page.
    fireEvent.click(screen.getByText("Stable"));
    await screen.findByTestId("thread");
    await new Promise((r) => setTimeout(r, 30));

    expect(apiState.scopeCalls).toHaveLength(1);
  });

  it("loads exactly once on mount for a Team Leader", async () => {
    authState.role = "Team Leader";
    apiState.traversalIds = [AGENT, uid(2)];
    apiState.conversations = [convo(CONTACT_IN_SCOPE, "Stable TL")];

    render(<ConversationsPage />);
    await screen.findByText("Stable TL");
    await new Promise((r) => setTimeout(r, 30));

    expect(apiState.scopeCalls).toHaveLength(1);
    expect(apiState.traversalCalls).toHaveLength(1);
  });
});

describe("View As cannot widen the displayed results", () => {
  it("viewing as an Agent stays agent-scoped even though isSuperAdmin is true", async () => {
    // The real session is a Super Admin; the effective profile is an Agent.
    authState.userId = SUPER_ADMIN;
    authState.profileId = AGENT;
    authState.role = "Agent";
    authState.isImpersonating = true;
    authState.isSuperAdmin = true;

    render(<ConversationsPage />);
    await waitFor(() => expect(apiState.scopeCalls.length).toBeGreaterThan(0));

    // NOT { kind: "org" } — the org-wide branch must not be reachable via isSuperAdmin.
    expect(apiState.scopeCalls[0]).toEqual({ kind: "agents", organizationId: ORG, agentIds: [AGENT] });
    expect(JSON.stringify(apiState.scopeCalls[0])).not.toContain(SUPER_ADMIN);
  });
});

describe("scope resolution fails closed", () => {
  it("a failed traversal yields NO org-wide fallback and surfaces a retry", async () => {
    authState.role = "Team Leader";
    apiState.traversalError = new Error("traversal exploded");

    render(<ConversationsPage />);

    expect(await screen.findByText(/Couldn't load conversations/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    // Critically: it never asked for an organization-wide read.
    expect(apiState.scopeCalls.some((s) => (s as { kind?: string })?.kind === "org")).toBe(false);
  });
});

describe("conversation load failures are distinguishable from an empty inbox", () => {
  it("renders an error with Retry rather than 'No conversations found.'", async () => {
    apiState.conversationsError = new Error("permission denied for table messages");

    render(<ConversationsPage />);

    expect(await screen.findByText(/permission denied for table messages/i)).toBeInTheDocument();
    expect(screen.queryByText(/No conversations found/i)).not.toBeInTheDocument();
  });

  it("Retry re-issues the load", async () => {
    apiState.conversationsError = new Error("boom");
    render(<ConversationsPage />);
    await screen.findByText(/boom/i);
    const before = apiState.scopeCalls.length;

    apiState.conversationsError = null;
    apiState.conversations = [convo(CONTACT_IN_SCOPE, "Recovered")];
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(apiState.scopeCalls.length).toBeGreaterThan(before));
    expect(await screen.findByText("Recovered")).toBeInTheDocument();
  });

  it("a genuinely empty inbox still shows the empty state", async () => {
    apiState.conversations = [];
    render(<ConversationsPage />);
    expect(await screen.findByText(/No conversations found/i)).toBeInTheDocument();
  });
});

describe("deep links are validated against the same scope", () => {
  it("an out-of-scope contactId renders 'not available' and no thread", async () => {
    routerState.params = new URLSearchParams(`contactId=${CONTACT_OUT_OF_SCOPE}`);
    apiState.resolveContact = null; // resolver says: not in your scope

    render(<ConversationsPage />);

    expect(await screen.findByText(/Conversation not available/i)).toBeInTheDocument();
    expect(screen.queryByTestId("thread")).not.toBeInTheDocument();
    expect(screen.queryByTestId("brief")).not.toBeInTheDocument();
  });

  it("a non-UUID contactId is rejected before any resolution is attempted", async () => {
    routerState.params = new URLSearchParams("contactId=abc,or(organization_id.not.is.null)");

    render(<ConversationsPage />);
    await waitFor(() => expect(apiState.scopeCalls.length).toBeGreaterThan(0));

    expect(screen.queryByTestId("thread")).not.toBeInTheDocument();
    expect(await screen.findByText(/Your Unified Inbox/i)).toBeInTheDocument();
  });

  it("an in-scope contactId opens the thread with the RESOLVED type, ignoring ?contactType=", async () => {
    // The URL lies and says 'lead'; the contact is really a client.
    routerState.params = new URLSearchParams(`contactId=${CONTACT_IN_SCOPE}&contactType=lead`);
    apiState.resolveContact = {
      contact_id: CONTACT_IN_SCOPE, contact_name: "Real Client",
      contact_type: "client", contact_phone: "555", contact_email: "c@example.test",
    };

    render(<ConversationsPage />);

    const thread = await screen.findByTestId("thread");
    expect(thread).toHaveAttribute("data-type", "client");
    expect(thread).toHaveAttribute("data-name", "Real Client");
    expect(await screen.findByTestId("brief")).toHaveAttribute("data-type", "client");
  });
});

describe("a viewer change never renders the previous viewer's thread", () => {
  // Clearing `selectedContact` in a passive effect is one commit too late: on the render where the
  // viewer identity changes, the previous viewer's thread is still mounted and painted. The
  // recorder's layout effect runs after every commit and BEFORE any passive effect, so that frame
  // is visible here.
  const frames: string[] = [];
  const Recorder: React.FC = () => {
    React.useLayoutEffect(() => { frames.push(document.body.textContent ?? ""); });
    return null;
  };

  it("the previous viewer's open thread appears in NO frame after the switch", async () => {
    frames.length = 0;
    routerState.params = new URLSearchParams(`contactId=${CONTACT_IN_SCOPE}`);
    apiState.resolveContact = {
      contact_id: CONTACT_IN_SCOPE, contact_name: "Viewer A Thread",
      contact_type: "client", contact_phone: "555", contact_email: "a@example.test",
    };
    apiState.conversations = [convo(CONTACT_IN_SCOPE, "Viewer A Convo")];

    const tree = () => (<><ConversationsPage /><Recorder /></>);
    const { rerender } = render(tree());
    await screen.findByTestId("thread");
    await screen.findByText("Viewer A Convo");

    const before = frames.length;
    // View As switches the effective profile IN PLACE — no remount.
    authState.profileId = uid(7);
    apiState.traversalIds = [uid(7)];
    apiState.resolveContact = null;             // that contact is not in the new viewer's scope
    apiState.conversations = [convo(CONTACT_OUT_OF_SCOPE, "Viewer B Convo")];
    rerender(tree());

    await screen.findByText("Viewer B Convo");

    const after = frames.slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter((f) => f.includes("Viewer A Thread"))).toEqual([]);
    expect(after.filter((f) => f.includes("Viewer A Convo"))).toEqual([]);
  });
});

describe("a viewer change clears the list and rejects a stale response", () => {
  it("a slow load for the previous viewer cannot repaint the new one", async () => {
    apiState.deferred = { resolve: () => {} };
    const { rerender } = render(<ConversationsPage />);
    await waitFor(() => expect(apiState.scopeCalls.length).toBe(1));
    const stale = apiState.deferred;

    // Switch viewer IN PLACE (View As), then let the new load settle.
    apiState.deferred = null;
    authState.profileId = uid(7);
    apiState.traversalIds = [uid(7)];
    apiState.conversations = [convo(CONTACT_IN_SCOPE, "New Viewer Contact")];
    rerender(<ConversationsPage />);
    expect(await screen.findByText("New Viewer Contact")).toBeInTheDocument();

    // The previous viewer's response finally arrives — it must be discarded.
    stale?.resolve([convo(CONTACT_OUT_OF_SCOPE, "Previous Viewer Contact")]);

    await waitFor(() => expect(screen.queryByText("Previous Viewer Contact")).not.toBeInTheDocument());
    expect(screen.getByText("New Viewer Contact")).toBeInTheDocument();
  });
});
