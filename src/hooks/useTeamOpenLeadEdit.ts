import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { leadsSupabaseApi } from "@/lib/supabase-contacts";
import type { ResolvedLeadField } from "@/lib/dialerLeadFields";
import type { Lead } from "@/lib/types";
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
 * The session is bound to `identityKey` (`campaign_leads.id:leads.id`). A lead change, lock loss or
 * any existing dialer reset (which clears `isEditing`) discards the draft, so a previous lead's
 * values can never be shown or saved onto another lead. A result from a save that no longer
 * matches the identity (or was superseded) is not applied to the UI. Success is reported only after
 * the canonical update resolved; a failure keeps edit mode and the draft (AGENT_RULES #36).
 */
export interface TeamOpenSaved {
  identityKey: string;
  master: Record<string, unknown>;
  /** Snapshot values written to `campaign_leads` (null when none changed or that write failed). */
  snapshot: Partial<Record<SnapshotColumn, string>> | null;
}

interface Args {
  identityKey: string | null;
  fields: readonly ResolvedLeadField[];
  leadId: string | null;
  campaignLeadId: string | null;
  organizationId: string | null;
  isEditing: boolean;
  setIsEditing: (v: boolean) => void;
  onSaved: (saved: TeamOpenSaved) => void;
}

export function useTeamOpenLeadEdit({
  identityKey,
  fields,
  leadId,
  campaignLeadId,
  organizationId,
  isEditing,
  setIsEditing,
  onSaved,
}: Args) {
  const [draft, setDraft] = useState<TeamOpenDraft>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const initialRef = useRef<TeamOpenDraft>({});
  const sessionKeyRef = useRef<string | null>(null);
  const identityRef = useRef(identityKey);
  identityRef.current = identityKey;
  const saveSeqRef = useRef(0);

  const clear = useCallback(() => {
    setDraft({});
    setErrors({});
    initialRef.current = {};
    sessionKeyRef.current = null;
  }, []);

  // Identity change (lead change, lock loss → different/no identity): drop the session at once.
  useEffect(() => {
    if (sessionKeyRef.current && sessionKeyRef.current !== identityKey) {
      clear();
      setSaving(false);
      setIsEditing(false);
    }
  }, [identityKey, clear, setIsEditing]);

  // Any existing dialer reset path sets isEditing=false — follow it.
  useEffect(() => {
    if (!isEditing && sessionKeyRef.current) clear();
  }, [isEditing, clear]);

  const start = useCallback(() => {
    if (!identityKey) return;
    const seeded = seedTeamOpenDraft(fields);
    initialRef.current = seeded;
    sessionKeyRef.current = identityKey;
    setDraft(seeded);
    setErrors({});
    setIsEditing(true);
  }, [identityKey, fields, setIsEditing]);

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
    const sessionKey = sessionKeyRef.current;
    if (!sessionKey || sessionKey !== identityRef.current || !leadId || !organizationId || saving) return;
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
    const stillCurrent = () => identityRef.current === sessionKey && saveSeqRef.current === seq;
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
      const saved = await leadsSupabaseApi.update(leadId, payload as Partial<Lead>);
      const master = leadToMasterRow(saved);

      let snapshot: TeamOpenSaved["snapshot"] = null;
      let snapshotFailed = false;
      if (plan.snapshotColumns.length && campaignLeadId && campaignLeadId !== leadId) {
        const values: Partial<Record<SnapshotColumn, string>> = {};
        for (const col of plan.snapshotColumns) values[col] = String(master[col] ?? "");
        const { error } = await supabase.from("campaign_leads").update(values).eq("id", campaignLeadId);
        if (error) snapshotFailed = true;
        else snapshot = values;
      }

      if (!stillCurrent()) {
        // Committed, but the card has moved on: never paint this result onto another lead.
        toast.success("Changes saved to the previous contact.");
        return;
      }
      onSaved({ identityKey: sessionKey, master, snapshot });
      clear();
      setIsEditing(false);
      if (snapshotFailed) {
        // D-6: the contact saved; only the campaign copy did not. Never retried blindly.
        toast.warning("Contact saved, but this campaign's copy of the name/phone/email/state could not be updated. The dialer may show the old value until it refreshes.");
      } else {
        toast.success("Contact updated");
      }
    } catch (err) {
      if (!stillCurrent()) return;
      const msg = err instanceof Error ? err.message : String(err);
      const refused = /coerce the result to a single json object|0 rows|no rows/i.test(msg);
      toast.error(
        refused
          ? "You don't have permission to edit this contact. Nothing was saved."
          : `Failed to update contact: ${msg}`,
      );
    } finally {
      if (saveSeqRef.current === seq) setSaving(false);
    }
  }, [fields, draft, leadId, campaignLeadId, organizationId, saving, cancel, clear, onSaved, setIsEditing]);

  return { draft, errors, saving, start, cancel, setField, save };
}
