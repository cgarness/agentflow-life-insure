import { useCallback, useEffect, useRef, useState } from "react";
import { fetchUserLayout, getDefaultLayout, resetUserLayout, saveUserLayout } from "@/lib/report-layout";
import { normalizeReportLayout, type ReportLayoutConfig, type SectionConfig } from "@/lib/report-layout-constants";

type LayoutStatus = "idle" | "loading" | "ready" | "error";
interface LayoutState {
  ownerKey: string | null;
  epoch: number;
  layout: ReportLayoutConfig;
  draft: ReportLayoutConfig;
  editMode: boolean;
  status: LayoutStatus;
  error: string | null;
  busy: boolean;
}
function initial(ownerKey: string | null, epoch: number, status: LayoutStatus = "idle"): LayoutState {
  return { ownerKey, epoch, layout: getDefaultLayout(), draft: getDefaultLayout(), editMode: false, status, error: null, busy: false };
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : "Could not update your report layout. Try again.";
}

/** Personal preferences are bound to the actual viewer, never the selected report scope/agent. */
export function useReportLayout(viewerId: string | null, orgId: string | null, enabled: boolean) {
  const ownerKey = viewerId && orgId ? `${viewerId}|${orgId}` : null;
  const identity = useRef({ ownerKey, epoch: 0, enabled });
  if (identity.current.ownerKey !== ownerKey) {
    identity.current = { ownerKey, epoch: identity.current.epoch + 1, enabled };
  } else identity.current.enabled = enabled;
  const epoch = identity.current.epoch;
  const [state, setState] = useState<LayoutState>(() => initial(ownerKey, epoch));
  const stateRef = useRef(state);
  stateRef.current = state;
  const mounted = useRef(true);
  const request = useRef(0);
  const operation = useRef<{ epoch: number; token: number } | null>(null);
  const operationSequence = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const isCurrent = useCallback(() => mounted.current && identity.current.ownerKey === ownerKey
    && identity.current.epoch === epoch, [ownerKey, epoch]);
  const load = useCallback(async (force = false) => {
    if (!viewerId || !orgId || !identity.current.enabled || !isCurrent()) return;
    if (operation.current?.epoch === epoch) return;
    const previous = stateRef.current;
    if (!force && previous.ownerKey === ownerKey && previous.epoch === epoch && previous.status === "ready") return;
    const token = ++request.current;
    setState(initial(ownerKey, epoch, "loading"));
    try {
      const layout = await fetchUserLayout({ userId: viewerId, orgId });
      if (!isCurrent() || token !== request.current) return;
      setState({ ...initial(ownerKey, epoch, "ready"), layout, draft: normalizeReportLayout(layout) });
    } catch (error) {
      if (!isCurrent() || token !== request.current) return;
      setState({ ...initial(ownerKey, epoch, "error"), error: message(error) });
    }
  }, [viewerId, orgId, ownerKey, epoch, isCurrent]);
  useEffect(() => { if (enabled && ownerKey) void load(); }, [enabled, ownerKey, load]);

  // Mask another owner's layout on the first render, before effects have run.
  const current = state.ownerKey === ownerKey && state.epoch === epoch
    ? state : initial(ownerKey, epoch, enabled && ownerKey ? "loading" : "idle");
  const canEdit = !!ownerKey && enabled && current.status === "ready" && !current.busy;
  const editable = () => isCurrent() && identity.current.enabled && stateRef.current.ownerKey === ownerKey
    && stateRef.current.epoch === epoch && stateRef.current.status === "ready" && operation.current?.epoch !== epoch;

  const beginEdit = () => {
    if (!editable()) return;
    setState((previous) => ({ ...previous, draft: normalizeReportLayout(previous.layout), editMode: true, error: null }));
  };
  const cancel = () => {
    if (!editable()) return;
    setState((previous) => ({ ...previous, draft: normalizeReportLayout(previous.layout), editMode: false, error: null }));
  };
  const setSections = (sections: SectionConfig[]) => {
    if (!editable()) return;
    setState((previous) => previous.editMode
      ? { ...previous, draft: normalizeReportLayout({ version: 4, sections }), error: null } : previous);
  };
  const persist = async (reset: boolean): Promise<boolean> => {
    if (!viewerId || !orgId || !editable() || !stateRef.current.editMode) return false;
    const token = ++operationSequence.current;
    operation.current = { epoch, token };
    const snapshot = normalizeReportLayout(stateRef.current.draft);
    setState((previous) => ({ ...previous, busy: true, error: null }));
    try {
      const owner = { userId: viewerId, orgId };
      const layout = reset ? await resetUserLayout(owner) : await saveUserLayout(owner, snapshot);
      if (!isCurrent()) return false;
      setState((previous) => ({ ...previous, layout, draft: normalizeReportLayout(layout), editMode: false, busy: false, error: null }));
      return true;
    } catch (error) {
      if (isCurrent()) setState((previous) => ({ ...previous, busy: false, error: message(error) }));
      return false;
    } finally {
      if (operation.current?.token === token) operation.current = null;
    }
  };
  const reload = () => {
    if (!current.editMode && !current.busy) void load(true);
  };
  return {
    layout: current.layout, draft: current.draft, editMode: current.editMode, status: current.status,
    error: current.error, busy: current.busy, canEdit,
    beginEdit, cancel, setSections, save: () => persist(false), reset: () => persist(true), reload,
  };
}
