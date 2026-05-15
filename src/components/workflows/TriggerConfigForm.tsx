import React, { useEffect, useState } from "react";
import { dispositionsSupabaseApi } from "@/lib/supabase-dispositions";
import { pipelineSupabaseApi, leadSourcesSupabaseApi, customFieldsSupabaseApi } from "@/lib/supabase-settings";
import { useOrganization } from "@/hooks/useOrganization";
import type { Disposition, PipelineStage, LeadSource, CustomField } from "@/lib/types";
import { type TriggerType } from "@/lib/workflow-types";
import { renderTriggerForm } from "./panels/triggerForms/forms";

interface Props {
  triggerType: TriggerType;
  config: Record<string, unknown>;
  onChange: (cfg: Record<string, unknown>) => void;
}

const TriggerConfigForm: React.FC<Props> = ({ triggerType, config, onChange }) => {
  const { organizationId } = useOrganization();
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [leadStages, setLeadStages] = useState<PipelineStage[]>([]);
  const [recruitStages, setRecruitStages] = useState<PipelineStage[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [dateFields, setDateFields] = useState<CustomField[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (triggerType === "disposition") {
          const d = await dispositionsSupabaseApi.getAll();
          if (alive) setDispositions(d);
        } else if (triggerType === "stage_change") {
          const [l, r] = await Promise.all([
            pipelineSupabaseApi.getLeadStages(),
            pipelineSupabaseApi.getRecruitStages(),
          ]);
          if (alive) { setLeadStages(l); setRecruitStages(r); }
        } else if (triggerType === "lead_created") {
          const s = await leadSourcesSupabaseApi.getAll();
          if (alive) setSources(s);
        } else if (triggerType === "custom_date_approaching") {
          const all = await customFieldsSupabaseApi.getAll(organizationId);
          if (alive) setDateFields(all.filter((f) => f.type === "Date" && f.active));
        }
      } catch {
        // soft-fail; user picks from empty list
      }
    })();
    return () => { alive = false; };
  }, [triggerType, organizationId]);

  return renderTriggerForm({
    triggerType,
    config,
    set: (patch) => onChange({ ...config, ...patch }),
    data: { dispositions, leadStages, recruitStages, sources, dateFields },
  });
};

export default TriggerConfigForm;
