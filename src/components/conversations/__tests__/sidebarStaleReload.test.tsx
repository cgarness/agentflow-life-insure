/**
 * ConversationsSidebar — a stale scope must never START a reload.
 *
 * THE DEFECT THIS PINS (present at 8a45e2c): the sidebar's realtime handler is a DEBOUNCED closure
 * captured by the subscription effect, so it is bound to the scope that was current when the
 * subscription was created. Effect cleanup clears the timer that exists at teardown — but a
 * callback already queued on the websocket can execute AFTER cleanup has run, and it then arms a
 * brand-new timer on the old closure's `timer` variable, which nothing will ever clear.
 *
 * Four hundred milliseconds later that timer calls the OLD `loadConversations`, bound to the OLD
 * scope. It bumps the SHARED `loadSeqRef`, so the new scope's still-in-flight response fails its
 * own sequence check and is thrown away — and because the state it does commit is keyed to the old
 * scope, the render-time match rejects it too. The sidebar is left on the loading skeleton with no
 * request outstanding and no way to recover short of a reload.
 *
 * Checking "is my scope still active?" only inside the reload is not enough either: the check must
 * happen when the event ARRIVES as well, or a stale event still occupies the shared debounce slot
 * and suppresses a legitimate reload for the live scope.
 */

import React from "react";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** The sidebar's realtime debounce (ConversationsSidebar REALTIME_DEBOUNCE_MS) plus headroom. */
const DEBOUNCE_WAIT_MS = 600;

const apiState = vi.hoisted(() => ({
  /** agentId -> rows returned for that scope. */
  rows: {} as Record<string, Record<string, unknown>[]>,
  /** agentIds whose request hangs until the test settles it. */
  defer: new Set<string>(),
  pending: [] as { agentId: string; resolve: (rows: Record<string, unknown>[]) => void }[],
  /** Every scope the loader was invoked for, in order. */
  calls: [] as string[],
}));

vi.mock("@/lib/supabase-messages", () => ({
  messagesSupabaseApi: {
    getRecentConversations: (scope: { agentIds?: string[] } | null) => {
      const agentId = scope?.agentIds?.[0] ?? "org";
      apiState.calls.push(agentId);
      if (apiState.defer.has(agentId)) {
        return new Promise<Record<string, unknown>[]>((resolve) => {
          apiState.pending.push({ agentId, resolve });
        });
      }
      return Promise.resolve(apiState.rows[agentId] ?? []);
    },
  },
}));

/** Records each channel's handlers so a queued callback can be fired after a scope switch. */
interface RecordedChannel { name: string; handlers: (() => void)[]; removed: boolean; api: unknown }
const channelState = vi.hoisted(() => ({ channels: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string) => {
      const entry: RecordedChannel = { name, handlers: [], removed: false, api: null };
      const api = {
        on(_event: string, _cfg: unknown, cb: () => void) { entry.handlers.push(cb); return api; },
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

import ConversationsSidebar from "@/components/conversations/ConversationsSidebar";
import type { ConversationScope } from "@/lib/conversationScope";

const channels = () => channelState.channels as RecordedChannel[];
const channelFor = (agentId: string) => channels().find((c) => c.name === `sidebar-realtime-viewer-${agentId}`);

function convo(contactId: string, name: string) {
  return {
    contact_id: contactId, contact_name: name, contact_type: "lead",
    contact_phone: "555", contact_email: "a@example.test",
    last_message: `msg-${name}`, last_message_at: "2026-08-20T00:00:00Z",
    channel: "sms", direction: "outbound",
  };
}

// Stable scope identities: the sidebar's load callback and subscription effect both depend on
// `scope`, so a fresh object per render would resubscribe on every render and muddy the test.
const SCOPE_A: ConversationScope = { kind: "agents", organizationId: ORG, agentIds: [AGENT_A] };
const SCOPE_B: ConversationScope = { kind: "agents", organizationId: ORG, agentIds: [AGENT_B] };
const SCOPES: Record<string, ConversationScope> = { [AGENT_A]: SCOPE_A, [AGENT_B]: SCOPE_B };

const view = (agentId: string) => (
  <ConversationsSidebar
    scope={SCOPES[agentId]}
    scopeKey={`viewer-${agentId}`}
    onSelectContact={() => {}}
  />
);

const isLoading = () => document.querySelector(".animate-pulse") !== null;

beforeEach(() => {
  channelState.channels = [];
  apiState.rows = {};
  apiState.defer = new Set();
  apiState.pending = [];
  apiState.calls = [];
});

afterEach(cleanup);

describe("a stale scope can never start a sidebar reload", () => {
  it("scope A's queued realtime callback cannot discard scope B's in-flight response", async () => {
    apiState.rows[AGENT_A] = [convo("c-a", "AgentA Contact")];
    apiState.defer.add(AGENT_B);

    const { rerender } = render(view(AGENT_A));
    await screen.findByText("AgentA Contact");

    // Captured while A is still the live scope — exactly what an in-flight websocket callback holds.
    const staleCallback = channelFor(AGENT_A)!.handlers[0];
    expect(staleCallback).toBeTypeOf("function");

    rerender(view(AGENT_B));
    await waitFor(() => expect(apiState.pending.some((p) => p.agentId === AGENT_B)).toBe(true));
    const liveB = apiState.pending.find((p) => p.agentId === AGENT_B)!;

    // A's subscription has already been torn down, and yet its callback still runs.
    expect(channelFor(AGENT_A)!.removed).toBe(true);
    await act(async () => {
      staleCallback();
      // Long enough for the sidebar's own debounce to fire, if anything was armed.
      await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT_MS));
    });

    // Nothing may have been issued for the dead scope.
    expect(apiState.calls.filter((id) => id === AGENT_A)).toHaveLength(1);

    // B's response now arrives and must still be accepted.
    await act(async () => { liveB.resolve([convo("c-b", "AgentB Contact")]); });

    expect(screen.queryByText("AgentB Contact")).toBeInTheDocument();
    expect(screen.queryByText("AgentA Contact")).not.toBeInTheDocument();
    expect(isLoading(), "sidebar is stuck on the loading skeleton").toBe(false);
  });

  it("a stale event arriving AFTER a live one does not swallow the live reload", async () => {
    // Pins the ARRIVAL-TIME check specifically. Ordering is the whole test: the live event must land
    // FIRST so it owns the shared debounce slot. Without the arrival check the stale event that
    // follows clears that pending timer and re-arms one for the dead scope, which is then rejected
    // at reload time — so the live reload never happens at all. Firing the stale event first proves
    // nothing, because the live event that follows simply re-arms the slot for itself.
    apiState.rows[AGENT_A] = [convo("c-a", "AgentA Contact")];
    apiState.rows[AGENT_B] = [convo("c-b", "AgentB Contact")];

    const { rerender } = render(view(AGENT_A));
    await screen.findByText("AgentA Contact");
    const staleCallback = channelFor(AGENT_A)!.handlers[0];

    rerender(view(AGENT_B));
    await screen.findByText("AgentB Contact");
    const callsBefore = apiState.calls.length;

    apiState.rows[AGENT_B] = [convo("c-b", "AgentB Contact"), convo("c-b2", "AgentB Second")];

    await act(async () => {
      channelFor(AGENT_B)!.handlers[0]();    // LIVE scope first — it owns the debounce slot
      staleCallback();                       // dead scope, same window
      await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT_MS));
    });

    expect(await screen.findByText("AgentB Second")).toBeInTheDocument();
    // Exactly one reload: the live one. The stale event neither added nor removed work.
    expect(apiState.calls.length - callsBefore).toBe(1);
    expect(apiState.calls.filter((id) => id === AGENT_A)).toHaveLength(1);
  });

  // NOTE, honestly: PASSES at 8a45e2c, and deleting the guard it targets breaks no test either —
  // effect cleanup already clears a normally-armed timer, so with the arrival-time guard in place
  // this path is unreachable. Kept as a guard on the entry point itself (see the comment on
  // `loadConversations`), and as the scenario a future caller would have to survive.
  it("a debounce timer armed while the scope was live is rejected once the scope changes", async () => {
    // Targets the START-OF-RELOAD check inside `loadConversations`. The event is legitimate when it
    // arrives — the arrival check passes — and the scope only changes while the timer is pending.
    apiState.rows[AGENT_A] = [convo("c-a", "AgentA Contact")];
    apiState.rows[AGENT_B] = [convo("c-b", "AgentB Contact")];

    const { rerender } = render(view(AGENT_A));
    await screen.findByText("AgentA Contact");
    const callsBefore = apiState.calls.length;

    // Armed while A is still live, so it clears the arrival check.
    await act(async () => { channelFor(AGENT_A)!.handlers[0](); });

    // The viewer switches before the debounce elapses.
    rerender(view(AGENT_B));
    await screen.findByText("AgentB Contact");

    await act(async () => { await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT_MS)); });

    // B loaded once for the switch; A's armed timer must have contributed nothing.
    expect(apiState.calls.slice(callsBefore).filter((id) => id === AGENT_A)).toEqual([]);
    expect(screen.queryByText("AgentB Contact")).toBeInTheDocument();
    expect(isLoading()).toBe(false);
  });

  // POSITIVE CONTROL, and the coalescing guard below. Both PASS at 8a45e2c. They exist so that a
  // guard which rejects too broadly, or a refactor that drops the debounce, fails here rather than
  // shipping as a silent no-op or a request storm.
  it("the LIVE scope's realtime callback still reloads normally", async () => {
    // The guard must reject stale scopes only — never the current one.
    apiState.rows[AGENT_A] = [convo("c-a", "AgentA Contact")];

    render(view(AGENT_A));
    await screen.findByText("AgentA Contact");

    apiState.rows[AGENT_A] = [convo("c-a", "AgentA Contact"), convo("c-a2", "AgentA Second")];
    await act(async () => {
      channelFor(AGENT_A)!.handlers[0]();
      await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT_MS));
    });

    expect(await screen.findByText("AgentA Second")).toBeInTheDocument();
    expect(apiState.calls.filter((id) => id === AGENT_A)).toHaveLength(2);
  });

  it("realtime bursts for the live scope are still coalesced into one reload", async () => {
    // The debounce is load-bearing: `messages` RLS is organization-wide, so every SMS anywhere in
    // the organization notifies every signed-in agent.
    apiState.rows[AGENT_A] = [convo("c-a", "AgentA Contact")];

    render(view(AGENT_A));
    await screen.findByText("AgentA Contact");
    const callsBefore = apiState.calls.length;

    await act(async () => {
      const cb = channelFor(AGENT_A)!.handlers[0];
      for (let i = 0; i < 12; i += 1) cb();
      await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT_MS));
    });

    expect(apiState.calls.length - callsBefore).toBe(1);
  });
});
