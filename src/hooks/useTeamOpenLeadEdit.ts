import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { leadsSupabaseApi } from "@/lib/supabase-contacts";
import type { ResolvedLeadField } from "@/lib/dialerLeadFields";
import type { Lead } from "@/lib/types";
import type { TeamOpenContext } from "@/hooks/useTeamOpenMasterLead";
import {
  buildTeamOpenSavePlan,
  leadToMasterRow,
  mergeCustomFieldsBag,
  planHasChanges,
  planTouchesCustom,
  seedTeamOpenDraft,
  type SnapshotColumn,
  type TeamOpenDraft,
} from "@/lib/teamOpenLeadEdit";

/**
 * useTeamOpenLeadEdit — the Team / Open Pool inline-edit session (Personal keeps `saveInlineEdit`).
 *
 * The session is bound to ONE visit (`TeamOpenContext`, compared by identity — see
 * useTeamOpenMasterLead). A → B → A is three visits, so a draft or save from the first A visit can
 * never surface on, or complete onto, the second. Master-read refreshes do NOT end the session
 * (request generations are separate from the visit).
 *   - The draft is masked in the first render after the visit changes (derived, not effect-only).
 *   - A retained old Save does nothing (stale start).
 *   - The visit is re-checked after every awaited prerequisite and before each following write.
 *     A write already sent is never described as cancelled: committed or partial outcomes for a
 *     previous visit are reported in a toast and never painted onto the current lead.
 * Success is reported only after the canonical update resolved; a failure keeps the draft (#36).
 */
export interface TeamOpenSaved {
  context: TeamOpenContext;
  campaignLeadId: string;
  leadId: string;
  master: Record<string, unknown>;
  /** Snapshot values written to `campaign_leads` (null when none changed or that write failed). */
  snapshot: Partial<Record<SnapshotColumn, string>> | null;
}

interface Args {
  context: TeamOpenContext | null;
  fields: readonly ResolvedLeadField[];
  isEditing: boolean;
  setIsEditing: (v: boolean) => void;
  onSaved: (saved: TeamOpenSaved) => void;
}

const PARTIAL =
  "Contact saved, but this campaign's copy of the name/phone/email/state could not be updated. The dialer may show the old value until it refreshes.";

export function useTeamOpenLeadEdit({ context, fields, isEditing, setIsEditing, onSaved }: Args) {
  const [session, setSession] = useState<TeamOpenContext | null>(null);
  const [draft, setDraft] = useState<TeamOpenDraft>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const initialRef = useRef<TeamOpenDraft>({});
  const contextRef = useRef(context);
  const sessionRef = useRef<TeamOpenContext | null>(null);
  const saveSeqRef = useRef(0);
  const active = !!session && session === context; // first-render masking

  useLayoutEffect(() => { contextRef.current = context; }, [context]);
  useEffect(() => () => { contextRef.current = null; }, []);

  const clear = useCallback(() => {
    sessionRef.current = null;
    setSession(null);
    setDraft({});
    setErrors({});
    initialRef.current = {};
  }, []);

  // Visit change (lead change, A → B → A, lock loss, org/viewer change): drop the session.
  useEffect(() => {
    if (sessionRef.current && sessionRef.current !== context) {
      clear();
      setSaving(false);
      setIsEditing(false);
    }
  }, [context, clear, setIsEditing]);

  // Any existing dialer reset path sets isEditing=false — follow it.
  useEffect(() => {
    if (!isEditing && sessionRef.current) clear();
  }, [isEditing, clear]);

  const start = useCallback(() => {
    if (!context) return;
    const seeded = seedTeamOpenDraft(fields);
    initialRef.current = seeded;
    sessionRef.current = context;
    setSession(context);
    setDraft(seeded);
    setErrors({});
    setIsEditing(true);
  }, [context, fields, setIsEditing]);

  const cancel = useCallback(() => {
    clear();
    setIsEditing(false);
  }, [clear, setIsEditing]);

  const setField = useCallback((id: string, value: string) => {
    setDraft((d) => ({ ...d, [id]: value }));
    setErrors((e) => {
      if (!(id in e)) return e;
      const next = { ...e };
      delete next[id];
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    const ctx = sessionRef.current;
    // Stale START: only the live visit's session may save (a retained old callback does nothing).
    if (!ctx || ctx !== contextRef.current || ctx !== context || saving) return;
    const { leadId, campaignLeadId, organizationId } = ctx;
    const result = buildTeamOpenSavePlan(fields, initialRef.current, draft);
    if ("errors" in result) {
      setErrors(result.errors);
      toast.error("Please fix the highlighted fields.");
      return;
    }
    const { plan } = result;
    if (!planHasChanges(plan)) {
      cancel();
      return;
    }
    const seq = ++saveSeqRef.current;
    const stillCurrent = () => contextRef.current === ctx && sessionRef.current === ctx && saveSeqRef.current === seq;
    let committed = false;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...plan.standard };
      if (planTouchesCustom(plan)) {
        // Fresh, org-scoped read of the stored bag so keys this view never loaded survive.
        const { data, error } = await supabase
          .from("leads")
          .select("custom_fields")
          .eq("id", leadId)
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (error) throw new Error(`Could not read the current custom fields (${error.message}). Nothing was saved.`);
        if (!data) throw new Error("This contact is not available to you. Nothing was saved.");
        const merged = mergeCustomFieldsBag((data as { custom_fields?: unknown }).custom_fields, plan.customSet, plan.customUnset);
        if ("reason" in merged) throw new Error(merged.reason);
        payload.customFields = merged.bag;
      }
      if (!stillCurrent()) {
        // The contact changed while preparing: the write was never sent.
        toast.info("Not saved: the contact on screen changed before the save was sent. Nothing was written.");
        return;
      }
      const saved = await leadsSupabaseApi.update(leadId, payload as Partial<Lead>);
      committed = true;
      const master = leadToMasterRow(saved);

      let snapshot: TeamOpenSaved["snapshot"] = null;
      let snapshotFailed = false;
      let snapshotSkipped = false;
      if (plan.snapshotColumns.length && campaignLeadId !== leadId) {
        if (!stillCurrent()) {
          snapshotSkipped = true; // never start a follow-up write for a superseded visit
        } else {
          const values: Partial<Record<SnapshotColumn, string>> = {};
          for (const col of plan.snapshotColumns) values[col] = String(master[col] ?? "");
          // Verified write: a 0-row UPDATE (RLS) is a failure, never a silent success.
          const { data: row, error } = await supabase
            .from("campaign_leads")
            .update(values)
            .eq("id", campaignLeadId)
            .select("id, first_name, last_name, phone, email, state")
            .maybeSingle();
          if (error || !row) {
            snapshotFailed = true;
          } else {
            snapshot = {};
            for (const col of plan.snapshotColumns) snapshot[col] = String((row as Record<string, unknown>)[col] ?? "");
          }
        }
      }

      if (!stillCurrent()) {
        // Committed for a previous visit: report accurately, never paint onto the current lead.
        if (snapshotSkipped) toast.warning("Saved to the previous contact; its campaign copy was not updated because the contact on screen changed.");
        else if (snapshotFailed) toast.warning(`Previous contact: ${PARTIAL}`);
        else toast.success("Changes saved to the previous contact.");
        return;
      }
      onSaved({ context: ctx, campaignLeadId, leadId, master, snapshot });
      clear();
      setIsEditing(false);
      if (snapshotFailed) toast.warning(PARTIAL); // D-6: never retried blindly
      else toast.success("Contact updated");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const refused = /coerce the result to a single json object|0 rows|no rows/i.test(msg);
      const text = committed
        ? `The contact was saved, but a follow-up step failed: ${msg}`
        : refused
          ? "You don't have permission to edit this contact. Nothing was saved."
          : `Failed to update contact: ${msg}`;
      toast.error(stillCurrent() ? text : `Previous contact: ${text}`);
    } finally {
      if (saveSeqRef.current === seq) setSaving(false);
    }
  }, [context, fields, draft, saving, cancel, clear, onSaved, setIsEditing]);

  return {
    /** True only while the session belongs to the live visit. */
    active,
    draft: active ? draft : ({} as TeamOpenDraft),
    errors: active ? errors : {},
    saving: active && saving,
    start,
    cancel,
    setField,
    save,
  };
}
