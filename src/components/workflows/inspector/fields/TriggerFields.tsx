import { useId } from "react";
import { Button } from "@/components/ui/button";
import { blocks, graphBlock } from "../../../../../supabase/functions/_shared/automations/graph";
import { block } from "../../lib/draftGraph";
import { selectStyle } from "../../lib/fieldStyles";
import { useCampaignOptions, useSourceOptions } from "../../useAutomationOptions";
import Field from "../Field";
import OptionsAlert from "../OptionsAlert";
import { patchConfig, textValue, type EditorProps } from "../stepConfig";
import EventTriggerFields from "./EventTriggerFields";

const ABOUT: Record<string, string> = {
  lead: "Starts when a new lead is saved.",
  campaign: "Starts when a lead is added to the campaign you choose.",
};

/** Settings for whichever trigger starts the workflow, including the choice of trigger itself. */
export default function TriggerFields(props: EditorProps) {
  const {node, scope, onChange} = props;
  const id = useId();
  const editor = graphBlock(node)?.editor;
  const takesSource = editor === "lead" || editor === "campaign";
  const campaigns = useCampaignOptions(scope, textValue(node, "campaign_id"), editor === "campaign");
  const sources = useSourceOptions(scope, textValue(node, "lead_source"), takesSource);
  return <>
    <Field id={id + "type"} label="Trigger" hint="Changing the trigger clears its settings. Steps the new trigger cannot run are flagged for you.">
      <select id={id + "type"} className={selectStyle} aria-describedby={id + "type-hint"} value={node.type}
        onChange={event => onChange({...node, type: event.target.value, version: block(event.target.value)!.version, config: {}})}>
        {blocks.filter(entry => entry.category === "trigger").map(entry => <option key={entry.type} value={entry.type}>{entry.label}</option>)}
      </select>
    </Field>
    {editor === "campaign" && <>
      {campaigns.isError && <OptionsAlert what="Campaigns" onRetry={() => { void campaigns.refetch(); }}/>}
      <Field id={id + "campaign"} label="Campaign">
        <select id={id + "campaign"} className={selectStyle} value={node.config.any_campaign ? "any" : textValue(node, "campaign_id")}
          onChange={event => onChange(patchConfig(node, {
            any_campaign: event.target.value === "any" ? true : undefined,
            campaign_id: event.target.value && event.target.value !== "any" ? event.target.value : undefined,
          }))}>
          <option value="">Choose a campaign</option>
          <option value="any">Any campaign I can manage</option>
          {campaigns.items.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
        </select>
      </Field>
      {campaigns.hasNextPage && <Button type="button" variant="link" className="h-11 px-0 md:h-9" disabled={campaigns.isFetchingNextPage}
        onClick={() => { void campaigns.fetchNextPage(); }}>Load more campaigns</Button>}
    </>}
    {takesSource && <>
      {sources.isError && <OptionsAlert what="Lead sources" onRetry={() => { void sources.refetch(); }}/>}
      <Field id={id + "source"} label="Lead source">
        <select id={id + "source"} className={selectStyle} value={textValue(node, "lead_source")}
          onChange={event => onChange(patchConfig(node, {lead_source: event.target.value || undefined}))}>
          <option value="">All sources</option>
          {sources.items.map(name => <option key={name}>{name}</option>)}
        </select>
      </Field>
      {sources.hasNextPage && <Button type="button" variant="link" className="h-11 px-0 md:h-9" disabled={sources.isFetchingNextPage}
        onClick={() => { void sources.fetchNextPage(); }}>Load more sources</Button>}
    </>}
    {editor && ABOUT[editor] ? <p className="text-muted-foreground">{ABOUT[editor]}</p> : <EventTriggerFields {...props}/>}
  </>;
}
