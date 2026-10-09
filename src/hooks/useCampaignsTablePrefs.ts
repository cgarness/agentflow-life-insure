import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeColumnLayout, type ColumnLayout } from "@/lib/campaigns-table/columns";
import {
  CampaignsPrefsError,
  CampaignsPrefsSupersededError,
  layoutFromSettings,
  readPrefsRow,
  writeColumnLayout,
} from "@/lib/campaigns-table/prefs";

type PrefsStatus = "idle" | "loading" | "ready" | "error";
interface PrefsState {
  ownerKey: string | null;
  epoch: number;
  saved: ColumnLayout;
  /** Non-null while the Columns editor is open. */
  draft: ColumnLayout | null;
  status: PrefsStatus;
  error: string | null;
  busy: boolean;
}

function initial(ownerKey: string | null, epoch: number, status: PrefsStatus): PrefsState {
  return { ownerKey, epoch, saved: normalizeColumnLayout(null), draft: null, status, error: null, busy: false };
}
function message(error: unknown): string {
  return error instanceof CampaignsPrefsError ? error.message : "Couldn't save columns. Try again.";
}

/**
 * Column preferences for the REAL signed-in user in the current organization.
 * Loading only reads; writes happen solely on explicit Save / Reset. Every async result is
 * bound to the owner + epoch it started under, and `enabled` (false during View As) is
 * re-checked immediately before a write is sent.
 */
export function useCampaignsTablePrefs(userId: string | null, orgId: string | null, enabled: boolean) {
  const ownerKey = userId && orgId ? `${userId}|${orgId}` : null;
  const identity = useRef({ ownerKey, epoch: 0, enabled });
  if (identity.current.ownerKey !== ownerKey) identity.current = { ownerKey, epoch: identity.current.epoch + 1, enabled };
  else identity.current.enabled = enabled;
  const epoch = identity.current.epoch;

  const [state, setState] = useState<PrefsState>(() => initial(ownerKey, epoch, "idle"));
  const stateRef = useRef(state);
  stateRef.current = state;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const isCurrent = useCallback(
    () => mounted.current && identity.current.enabled && identity.current.ownerKey === ownerKey && identity.current.epoch === epoch,
    [ownerKey, epoch],
  );

  const loadToken = useRef(0);
  const load = useCallback((signal?: AbortSignal) => {
    if (!userId || !orgId || !isCurrent()) return;
    const token = ++loadToken.current;
    setState(initial(ownerKey, epoch, "loading"));
    readPrefsRow(userId, signal)
      .then((row) => {
        if (!isCurrent() || token !== loadToken.current) return;
        setState({ ...initial(ownerKey, epoch, "ready"), saved: layoutFromSettings(row.settings, orgId) });
      })
      .catch((error) => {
        if (signal?.aborted || !isCurrent() || token !== loadToken.current) return;
        setState({ ...initial(ownerKey, epoch, "error"), error: message(error instanceof CampaignsPrefsError ? error : new CampaignsPrefsError("read", error)) });
      });
  }, [userId, orgId, ownerKey, epoch, isCurrent]);

  useEffect(() => {
    if (!enabled || !ownerKey) return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [enabled, ownerKey, load]);

  // Another owner's state is masked on the very first render after a switch.
  const current = state.ownerKey === ownerKey && state.epoch === epoch
    ? state : initial(ownerKey, epoch, enabled && ownerKey ? "loading" : "idle");
  const canEdit = enabled && !!ownerKey && current.status === "ready" && !current.busy;

  const editable = () => isCurrent() && stateRef.current.ownerKey === ownerKey && stateRef.current.epoch === epoch
    && stateRef.current.status === "ready" && !stateRef.current.busy;

  const beginEdit = () => {
    if (!editable()) return;
    setState((p) => ({ ...p, draft: normalizeColumnLayout(p.saved), error: null }));
  };
  const cancel = () => {
    if (!editable()) return;
    setState((p) => ({ ...p, draft: null, error: null }));
  };
  const setDraft = (layout: ColumnLayout) => {
    if (!editable()) return;
    setState((p) => (p.draft ? { ...p, draft: normalizeColumnLayout(layout), error: null } : p));
  };

  const persist = async (reset: boolean): Promise<boolean> => {
    const draft = stateRef.current.draft;
    if (!userId || !orgId || !editable() || !draft) return false;
    setState((p) => ({ ...p, busy: true, error: null }));
    try {
      const saved = await writeColumnLayout({ userId, orgId, layout: reset ? null : normalizeColumnLayout(draft), isCurrent });
      if (!isCurrent()) return false;
      setState((p) => ({ ...p, saved, draft: null, busy: false, error: null }));
      return true;
    } catch (error) {
      if (error instanceof CampaignsPrefsSupersededError || !isCurrent()) return false;
      setState((p) => ({ ...p, busy: false, error: message(error) }));
      return false;
    }
  };

  return {
    /** What the table renders: the live draft while editing, otherwise the saved layout. */
    layout: current.draft ?? current.saved,
    draft: current.draft,
    status: current.status,
    error: current.error,
    busy: current.busy,
    canEdit,
    beginEdit,
    cancel,
    setDraft,
    save: () => persist(false),
    reset: () => persist(true),
    reload: () => { if (!current.draft && !current.busy) load(); },
  };
}
