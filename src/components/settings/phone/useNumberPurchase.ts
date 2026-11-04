import { useCallback, useEffect, useRef, useState } from "react";
import {
  NumberPurchaseError, purchasePhoneNumber, quotePhoneNumber, restorePendingPurchases,
  savePendingPurchases, searchPhoneNumbers,
  type AvailablePhoneNumber, type PurchaseCompletion, type PurchaseItem, type PurchaseOperation, type PurchaseScope,
} from "@/lib/phone-number-purchase";
import { numberSearchSchema } from "./numberSearchSchema";

type Filters = { numberType: "local" | "toll_free"; prefix: "prefer_800" | "800" | "888"; areaCode: string; state: string; locality: string };
type Busy = "search" | "quote" | "purchase" | "status" | null;
type State = {
  context: string; open: boolean; filters: Filters; numbers: AvailablePhoneNumber[]; items: PurchaseItem[];
  phase: "search" | "review"; busy: Busy; error: string | null; searched: boolean; blocked: boolean; clock: number;
};
const initial = (context: string, open: boolean): State => ({
  context, open, filters: { numberType: "local", prefix: "prefer_800", areaCode: "", state: "", locality: "" },
  numbers: [], items: [], phase: "search", busy: null, error: null, searched: false, blocked: false, clock: Date.now(),
});
const message = (error: unknown) => error instanceof NumberPurchaseError ? error.message : "The request could not be completed. Please check again.";
const protocolError = (error: unknown) => error instanceof NumberPurchaseError && error.code === "INCOMPATIBLE_PROTOCOL";
const unresolved = (item: PurchaseItem) => item.attempted && !["completed", "failed_before_purchase"].includes(item.operation?.state ?? "");
const needsQuote = (item: PurchaseItem) => !item.attempted || item.operation?.state === "failed_before_purchase";

export function useNumberPurchase({ scope, open, onCompleted }: {
  scope: PurchaseScope | null; open: boolean; onCompleted: (numbers: string[], counts?: PurchaseCompletion) => Promise<void>;
}) {
  const actorId = scope?.actor_id ?? "";
  const organizationId = scope?.organization_id ?? "";
  const context = `${actorId}:${organizationId}`;
  const [state, setState] = useState(() => initial(context, open));
  const current = useRef(state);
  const epoch = useRef(0);
  const sequence = useRef(0);
  const lock = useRef<{ id: number; busy: Busy } | null>(null);
  const latest = useRef({ context, open, scope, onCompleted });
  latest.current = { context, open, scope, onCompleted };
  const update = useCallback((change: (value: State) => State) => {
    current.current = change(current.current);
    setState(current.current);
  }, []);

  useEffect(() => {
    epoch.current += 1;
    lock.current = null;
    const items = open && actorId && organizationId
      ? restorePendingPurchases({ actor_id: actorId, organization_id: organizationId, view_as: false }) : [];
    update(() => ({ ...initial(`${actorId}:${organizationId}`, open), items, phase: items.length ? "review" : "search" }));
    return () => { epoch.current += 1; lock.current = null; };
  }, [actorId, organizationId, open, update]);

  const view = state.context === context && state.open === open ? state : initial(context, open);
  const expires = Math.min(...view.items.filter((item) => !item.attempted && item.quote).map((item) => Date.parse(item.quote!.expires_at)));
  useEffect(() => {
    if (!open || !Number.isFinite(expires) || expires <= Date.now()) return;
    const timer = setTimeout(() => update((value) => ({ ...value, clock: Date.now() })), expires - Date.now() + 5);
    return () => clearTimeout(timer);
  }, [expires, open, update]);

  const active = () => latest.current.open && !!latest.current.scope && current.current.context === latest.current.context;
  const start = (busy: Busy) => {
    if (!active() || lock.current) return null;
    const ticket = { id: ++sequence.current, epoch: epoch.current, context: latest.current.context, scope: latest.current.scope! };
    lock.current = { id: ticket.id, busy };
    update((value) => ({ ...value, busy, error: null }));
    return ticket;
  };
  type Ticket = NonNullable<ReturnType<typeof start>>;
  const valid = (ticket: Ticket) => active() && epoch.current === ticket.epoch && latest.current.context === ticket.context;
  const finish = (ticket: Ticket) => {
    if (valid(ticket) && lock.current?.id === ticket.id) {
      lock.current = null;
      update((value) => ({ ...value, busy: null }));
    }
  };
  const edit = (change: (value: State) => State) => {
    if (!active() || (lock.current && lock.current.busy !== "search")) return;
    epoch.current += 1;
    lock.current = null;
    update((value) => change({ ...value, busy: null, error: null }));
  };
  const setFilters = (patch: Partial<Filters>) => edit((value) => ({ ...value, filters: { ...value.filters, ...patch }, numbers: [], searched: false }));
  const add = (number: AvailablePhoneNumber) => edit((value) => ({ ...value, items: value.items.some((item) => item.number.phone_number === number.phone_number) ? value.items : [...value.items, { number, attempted: false }] }));
  const remove = (phone: string) => edit((value) => ({ ...value, items: value.items.filter((item) => item.number.phone_number !== phone || unresolved(item)) }));
  const clear = () => edit((value) => ({ ...value, items: value.items.filter(unresolved) }));
  const browse = () => edit((value) => ({ ...value, phase: "search" }));
  const close = () => {
    if (lock.current?.busy === "purchase" || lock.current?.busy === "status") return false;
    epoch.current += 1;
    lock.current = null;
    return true;
  };

  async function search() {
    if (!active()) return;
    const filters = numberSearchSchema.safeParse(current.current.filters);
    if (!filters.success) { update((value) => ({ ...value, error: filters.error.issues[0]?.message ?? "Check the search filters." })); return; }
    const ticket = start("search");
    if (!ticket) return;
    update((value) => ({ ...value, numbers: [], searched: false }));
    try {
      const numbers = await searchPhoneNumbers(ticket.scope, filters.data);
      if (valid(ticket)) update((value) => ({ ...value, numbers, searched: true, blocked: false }));
    } catch (error) {
      if (valid(ticket)) update((value) => ({ ...value, error: message(error), blocked: value.blocked || protocolError(error) }));
    } finally { finish(ticket); }
  }

  async function review() {
    if (current.current.blocked || !current.current.items.length) return;
    const ticket = start("quote");
    if (!ticket) return;
    const selected = current.current.items.filter(needsQuote);
    update((value) => ({ ...value, phase: "review" }));
    try {
      const quotes = await Promise.allSettled(selected.map(async (item) => ({
        number: item.number, quote: await quotePhoneNumber(ticket.scope, item.number), requestId: crypto.randomUUID(), attempted: false,
      } satisfies PurchaseItem)));
      if (!valid(ticket)) return;
      let blocked = false;
      const replacements = new Map<string, PurchaseItem>(selected.map((item, index) => {
        const result = quotes[index];
        if (result.status === "fulfilled") return [item.number.phone_number, result.value] as const;
        blocked ||= protocolError(result.reason);
        return [item.number.phone_number, { number: item.number, attempted: false, error: message(result.reason) }] as const;
      }));
      update((value) => ({ ...value, items: value.items.map((item) => replacements.get(item.number.phone_number) ?? item), blocked }));
    } finally { finish(ticket); }
  }

  const updateItem = (phone: string, change: (item: PurchaseItem) => PurchaseItem) => update((value) => ({ ...value, items: value.items.map((item) => item.number.phone_number === phone ? change(item) : item) }));
  const persistResult = (scopeForResult: PurchaseScope) => {
    try { savePendingPurchases(scopeForResult, current.current.items); } catch { /* The earlier attempt marker remains safe to check again. */ }
  };
  const applyOperation = (ticket: Ticket, item: PurchaseItem, operation: PurchaseOperation, completed: string[]) => {
    if (!valid(ticket)) return;
    if (operation.state === "completed" && item.operation?.state !== "completed") completed.push(item.number.phone_number);
    updateItem(item.number.phone_number, (value) => ({ ...value, operation, error: operation.state === "completed" ? undefined : value.error }));
    persistResult(ticket.scope);
  };
  const notifyCompleted = async (ticket: Ticket, numbers: string[]) => {
    if (!valid(ticket) || !numbers.length) return;
    try { await latest.current.onCompleted(numbers, {
      failedCount: current.current.items.filter((item) => item.operation?.state === "failed_before_purchase").length,
      pendingCount: current.current.items.filter(unresolved).length,
    }); }
    catch { if (valid(ticket)) update((value) => ({ ...value, error: "Purchase completed. Refresh Phone Numbers to see the updated list." })); }
  };

  async function checkStatus() {
    const ticket = start("status");
    if (!ticket) return;
    const completed: string[] = [];
    try {
      for (const item of current.current.items.filter(unresolved)) {
        if (!valid(ticket) || !item.quote || !item.requestId) break;
        try { applyOperation(ticket, item, await purchasePhoneNumber(ticket.scope, item.quote, item.requestId, "status"), completed); }
        catch (error) {
          if (!valid(ticket)) break;
          updateItem(item.number.phone_number, (value) => ({ ...value, error: message(error) }));
          if (protocolError(error)) update((value) => ({ ...value, blocked: true, error: message(error) }));
        }
      }
      await notifyCompleted(ticket, completed);
    } finally { finish(ticket); }
  }

  async function confirm() {
    const selected = current.current.items;
    const queue = selected.filter((item) => !item.attempted);
    if (current.current.blocked || current.current.phase !== "review" || selected.some(unresolved) || !queue.length) return;
    if (selected.some((item) => needsQuote(item) && (!item.quote || !item.requestId || item.attempted || Date.parse(item.quote.expires_at) <= Date.now()))) {
      update((value) => ({ ...value, error: "Review current prices before confirming this purchase." })); return;
    }
    const ticket = start("purchase");
    if (!ticket) return;
    const completed: string[] = [];
    try {
      for (const item of queue) {
        if (!valid(ticket)) break;
        if (Date.parse(item.quote!.expires_at) <= Date.now()) {
          updateItem(item.number.phone_number, (value) => ({ ...value, quote: undefined, error: "This price expired. Review current prices before purchasing." })); break;
        }
        const pending = { ...item, attempted: true, error: undefined, operation: { id: item.quote!.id, phone_number: item.number.phone_number, state: "purchasing" as const } };
        try {
          // Persist before the first paid request. Recovery only checks these same keys.
          savePendingPurchases(ticket.scope, current.current.items.map((value) => value.number.phone_number === item.number.phone_number ? pending : value));
        } catch {
          update((value) => ({ ...value, error: "The purchase could not be started safely. Refresh the page and try again." })); break;
        }
        updateItem(item.number.phone_number, () => pending);
        try {
          applyOperation(ticket, pending, await purchasePhoneNumber(ticket.scope, item.quote!, item.requestId!, "purchase"), completed);
        } catch (error) {
          if (!valid(ticket)) break;
          updateItem(item.number.phone_number, (value) => ({ ...value, operation: { ...pending.operation, state: "needs_review" }, error: message(error) }));
          if (protocolError(error)) update((value) => ({ ...value, blocked: true, error: message(error) }));
          else {
            update((value) => ({ ...value, busy: "status" }));
            try { applyOperation(ticket, pending, await purchasePhoneNumber(ticket.scope, item.quote!, item.requestId!, "status"), completed); }
            catch (statusError) {
              if (valid(ticket)) {
                updateItem(item.number.phone_number, (value) => ({ ...value, error: "Purchase status is not confirmed. Check status before continuing." }));
                if (protocolError(statusError)) update((value) => ({ ...value, blocked: true, error: message(statusError) }));
              }
            }
          }
        }
        if (!valid(ticket) || current.current.items.find((value) => value.number.phone_number === item.number.phone_number)?.operation?.state !== "completed") break;
      }
      await notifyCompleted(ticket, completed);
    } finally { finish(ticket); }
  }

  const unattempted = view.items.filter((item) => !item.attempted);
  const pending = view.items.some(unresolved);
  const pricesReady = view.items.every((item) => !needsQuote(item) || (!item.attempted && item.quote && item.requestId && Date.parse(item.quote.expires_at) > Date.now()));
  return {
    ...view, allowed: !!scope, pending, pricesReady,
    canConfirm: !!scope && !view.busy && !view.blocked && !pending && pricesReady && unattempted.length > 0,
    setFilters, add, remove, clear, browse, close, search, review, confirm, checkStatus,
  };
}
