import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { contactKey, selectQueue, type DialerSelection, type QueueMember } from "@/lib/dialer-navigation";

/** Synchronous ownership survives rapid clicks; only an action can release its own token. */
export function useDialerNavigation<T extends QueueMember>(scope: string) {
  const [state, setState] = useState<DialerSelection<T>>({ queue: [], selectedId: null });
  const [busy, setBusy] = useState(false);
  const ref = useRef({ scope, selection: state, revision: 0, tokens: new Set<symbol>() });
  if (ref.current.scope !== scope) {
    ref.current = { scope, selection: { queue: [], selectedId: null }, revision: ref.current.revision + 1, tokens: new Set() };
  }
  const selection = ref.current.selection;
  const currentLeadIndex = selection.queue.findIndex(lead => lead.id === selection.selectedId);
  const currentLead = selection.queue[currentLeadIndex] ?? null;
  const commitQueue = useCallback((queue: T[], id: string | null) => {
    const next = selectQueue(queue, id);
    if (ref.current.selection.selectedId !== next.selectedId) ref.current.revision++;
    ref.current.selection = next;
    setState(next);
  }, []);
  const setLeadQueue = useCallback((update: SetStateAction<T[]>) => {
    const old = ref.current.selection;
    const queue = typeof update === "function" ? update(old.queue) : update;
    commitQueue(queue, old.selectedId);
  }, [commitQueue]);
  const setCurrentLeadIndex = useCallback((update: SetStateAction<number>) => {
    const { queue, selectedId } = ref.current.selection;
    const index = queue.findIndex(lead => lead.id === selectedId);
    const next = typeof update === "function" ? update(index) : update;
    commitQueue(queue, queue[next]?.id ?? null);
  }, [commitQueue]);
  const capture = useCallback(() => {
    const owner = ref.current;
    const revision = owner.revision;
    return () => ref.current === owner && owner.revision === revision;
  }, []);
  const begin = useCallback((exclusive = true) => {
    const owner = ref.current;
    if (exclusive && owner.tokens.size) return null;
    const token = Symbol("dialer-action");
    owner.tokens.add(token); setBusy(true);
    return {
      isCurrent: capture(),
      isScopeCurrent: () => ref.current === owner,
      finish: () => {
        owner.tokens.delete(token);
        if (ref.current === owner) setBusy(owner.tokens.size > 0);
      },
    };
  }, [capture]);
  const isBusy = useCallback(() => ref.current.tokens.size > 0, []);
  const getSelection = useCallback(() => ref.current.selection, []);
  useEffect(() => () => {
    // Invalidate asynchronous work on unmount, including outstanding microphone prompts.
    ref.current = { ...ref.current, revision: ref.current.revision + 1, tokens: new Set() };
  }, []);
  return { leadQueue: selection.queue, currentLead, currentLeadIndex, setLeadQueue,
    setCurrentLeadIndex, commitQueue, capture, begin, isBusy, getSelection,
    scopeIdentity: ref.current,
    isAdvancing: busy && ref.current.tokens.size > 0 };
}

/** URL changes are inputs once; queue/selection commits cannot replay an old URL. */
export function useDialerContactUrl<T extends QueueMember>(input: {
  scope: string; contact: string | null; lead: T | null; queue: T[]; loading: boolean;
  canSelect?: (lead: T) => boolean;
  blocked: () => boolean; select: (index: number) => void; write: (contact: string) => void;
}) {
  const seen = useRef<{ scope: string; contact: string | null; selected: string; initialized: boolean }>({
    scope: "", contact: null, selected: "", initialized: false,
  });
  useEffect(() => {
    if (input.loading || ((seen.current.scope !== input.scope || !seen.current.initialized) && !input.queue.length)) return;
    const actual = contactKey(input.lead);
    const previous = seen.current;
    const newScope = previous.scope !== input.scope;
    const external = !previous.initialized || input.contact !== previous.contact;
    const selectionChanged = !newScope && actual !== previous.selected;
    seen.current = { scope: input.scope, contact: input.contact, selected: actual, initialized: true };
    if (external && !selectionChanged && input.contact && input.contact !== actual && !input.blocked()) {
      const index = input.queue.findIndex(lead => (contactKey(lead) === input.contact || lead.id === input.contact) && input.canSelect?.(lead) !== false);
      if (index >= 0) { input.select(index); return; }
    }
    if ((input.contact ?? "") !== actual) {
      seen.current.contact = actual || null;
      input.write(actual);
    }
  }, [input]);
}
