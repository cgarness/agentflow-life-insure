import { useRef, useState } from "react";
import type { RoomCall } from "@/lib/inbounds/contracts";
import { wrapSchema } from "@/lib/inbounds/contracts";
import { persistDisposition } from "@/lib/dialer-disposition";
import { bookingTimes } from "@/lib/appointmentPersistence";
import { isConvertedDisposition } from "@/lib/report-utils";
import { supabase } from "@/integrations/supabase/client";
import { rowToLead } from "@/lib/supabase-contacts";
import { clientsSupabaseApi } from "@/lib/supabase-clients";
import { hasClientPolicyEvidence } from "@/lib/policyIdentity";
import type { Lead } from "@/lib/types";
import type { useFloatingDialerDispositions } from "@/hooks/useFloatingDialerDispositions";
type Config = ReturnType<typeof useFloatingDialerDispositions>;
export function useRoomDisposition(
  call: RoomCall,
  org: string,
  config: Config,
  onSaved: () => Promise<void>,
) {
  const [selected, setSelected] = useState(""),
    [notes, setNotes] = useState(""),
    [dueAt, setDueAt] = useState(""),
    [title, setTitle] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const [lead, setLead] = useState<Lead | null>(null),
    [policy, setPolicy] = useState<{ id: string; primary: boolean } | null>(
      null,
    );
  const busy = useRef(false),
    converted = useRef<string>(),
    visit = useRef({ call: call.id, version: config.version, selected }),
    saleVersion = useRef<object | null>(null);
  visit.current = { call: call.id, version: config.version, selected };
  const disp = config.dispositions.find((d) => d.id === selected);
  const save = async (clientId?: string) => {
    if (busy.current) return;
    const own = visit.current;
    const current = () =>
      visit.current.call === own.call &&
      visit.current.version === own.version &&
      visit.current.selected === own.selected &&
      config.isCurrent();
    setError("");
    try {
      wrapSchema.parse({ dispositionId: selected, notes, dueAt });
      if (!call.ended_at || !config.isCurrent() || !disp)
        throw Error("Wait for the call to finish and outcomes to load.");
      if (
        (disp.require_notes || disp.min_note_chars > 0) &&
        notes.trim().length < Math.max(1, disp.min_note_chars)
      )
        throw Error(
          `Enter at least ${Math.max(1, disp.min_note_chars)} characters of notes.`,
        );
      if (
        (disp.callback_scheduler || disp.appointment_scheduler) &&
        (!dueAt ||
          !Number.isFinite(Date.parse(dueAt)) ||
          Date.parse(dueAt) <= Date.now())
      )
        throw Error("Choose a future date and time.");
      if (disp.appointment_scheduler && !title.trim())
        throw Error("Enter an appointment title.");
      busy.current = true;
      setSaving(true);
      const converting = isConvertedDisposition(disp, config.pipelineStages);
      if (clientId) converted.current = clientId;
      if (converting && !converted.current) {
        if (call.contact_type === "client" && call.contact_id) {
          const c = await clientsSupabaseApi.getById(call.contact_id);
          if (current()) {
            saleVersion.current = config.version;
            setPolicy({
              id: c.id,
              primary: !c.primaryPolicyId && !hasClientPolicyEvidence(c),
            });
          }
          return;
        }
        if (call.contact_type !== "lead" || !call.contact_id)
          throw Error("Add caller details below before recording a sale.");
        const { data, error: e } = await supabase
          .from("leads")
          .select("*")
          .eq("id", call.contact_id)
          .eq("organization_id", org)
          .maybeSingle();
        if (e || !data) throw Error("Could not load the lead. Retry.");
        if (current()) {
          saleVersion.current = config.version;
          setLead(rowToLead(data));
        }
        return;
      }
      const appointment = disp.appointment_scheduler
        ? {
            title: title.trim(),
            notes,
            status: "Scheduled",
            ...bookingTimes(dueAt.slice(0, 10), dueAt.slice(11, 16)),
          }
        : null;
      const result = await persistDisposition({
        operationId: call.id,
        callId: call.id,
        campaignLeadId: null,
        dispositionId: disp.id,
        notes: notes.trim(),
        releaseLock: false,
        convertedClientId: converting ? converted.current : null,
        callbackDueAt: disp.callback_scheduler
          ? new Date(dueAt).toISOString()
          : null,
        callbackNote: disp.callback_scheduler ? notes.trim() : null,
        appointment,
      });
      if (result.call_id !== call.id)
        throw Error(
          "Disposition confirmation did not match this call. Refresh status before retrying.",
        );
      await onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Disposition was not saved. Retry.",
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const completeSale = (id: string) => {
    converted.current = id;
    setLead(null);
    setPolicy(null);
    if (saleVersion.current === config.version && config.isCurrent())
      void save(id);
    else
      setError(
        "Policy saved. Reload outcomes, then save the call disposition.",
      );
  };
  return {
    completeSale,
    selected,
    setSelected,
    notes,
    setNotes,
    dueAt,
    setDueAt,
    title,
    setTitle,
    error,
    saving,
    lead,
    setLead,
    policy,
    setPolicy,
    converted,
    disp,
    save,
  };
}
