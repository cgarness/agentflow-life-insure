import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCampaignOptions, useChannelOptions, useSourceOptions } from "./useAutomationOptions";
import { blocks, graphBlock, type AutomationNode } from "../../../supabase/functions/_shared/automations/graph";
import { block } from "./lib/draftGraph";

export const selectStyle = "mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground";
interface Props {
  node: AutomationNode;
  onChange: (node: AutomationNode) => void;
  scope: string;
}

export default function AutomationBlockPanel({node, onChange, scope}: Props) {
  const {type, config} = node;
  const registration = graphBlock(node);
  const editor = registration?.editor;
  const isTrigger = registration?.category === "trigger";
  const isChannel = editor === "sms" || editor === "email";
  const value = (key: string) => typeof config[key] === "string" ? config[key] as string : "";
  const campaigns = useCampaignOptions(scope,value("campaign_id"),editor === "campaign");
  const sources = useSourceOptions(scope,value("lead_source"),isTrigger);
  const options = useChannelOptions(scope,isChannel ? editor : undefined,value("sender_id"),value("template_id"));
  function update(patch: Record<string, unknown>) {
    const next = {...config, ...patch};
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    onChange({...node, config: next});
  }
  const available = options.templates;
  const selectedTemplate = available.find(t => t.id === config.template_id);
  return <section aria-label="Configure block" className="space-y-4 rounded-xl border bg-card p-4 text-sm">
    <h3 className="font-semibold">{registration?.label}</h3>
    {isTrigger && <>
      <label className="block">Trigger<select aria-label="Trigger" className={selectStyle} value={type} onChange={e =>
        onChange({...node, type: e.target.value, version: block(e.target.value)!.version, config: {}})}>
        {blocks.filter(entry => entry.category === "trigger").map(entry => <option key={entry.type} value={entry.type}>{entry.label}</option>)}
      </select></label>
      {editor === "campaign" && <label className="block">Campaign<select aria-label="Campaign" className={selectStyle}
        value={config.any_campaign ? "any" : value("campaign_id")} onChange={e => update({
          any_campaign: e.target.value === "any" ? true : undefined,
          campaign_id: e.target.value && e.target.value !== "any" ? e.target.value : undefined,
        })}>
        <option value="">Choose a campaign</option><option value="any">Any campaign I can manage</option>
        {campaigns.items.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>}
      {editor === "campaign" && campaigns.hasNextPage && <Button variant="link" disabled={campaigns.isFetchingNextPage} onClick={() => campaigns.fetchNextPage()}>Load more campaigns</Button>}
      <label className="block">Lead source<select aria-label="Lead source" className={selectStyle} value={value("lead_source")}
        onChange={e => update({lead_source: e.target.value || undefined})}>
        <option value="">All sources</option>
        {sources.items.map(name => <option key={name}>{name}</option>)}
      </select></label>
      {sources.hasNextPage && <Button variant="link" disabled={sources.isFetchingNextPage} onClick={() => sources.fetchNextPage()}>Load more sources</Button>}
      <p className="text-muted-foreground">{editor === "lead" ? "Matches a lead when its creation is committed." :
        "Matches a new membership when a lead is added to the selected campaign scope."}</p>
    </>}
    {editor === "emailCondition" && <p>At this step, contacts with an email take the Yes path. Contacts without one take the No path. Empty paths end here.</p>}
    {editor === "wait" && <div className="flex flex-wrap gap-2">
      <label>Duration<Input type="number" min="1" step="1" value={typeof config.duration === "number" ? config.duration : ""}
        onChange={e => update({duration: e.target.value ? Number(e.target.value) : undefined})}/></label>
      <label>Unit<select aria-label="Unit" className={selectStyle} value={value("unit")} onChange={e => update({unit: e.target.value || undefined})}>
        <option value="">Choose unit</option>{["minutes","hours","days"].map(unit => <option key={unit}>{unit}</option>)}
      </select></label>
    </div>}
    {isChannel && <>
      <label className="block">Agency template<select aria-label="Agency template" className={selectStyle} value={value("template_id")} onChange={e => {
        const template = available.find(t => t.id === e.target.value);
        update(template ? {template_id: template.id, body: template.content, ...(editor === "sms" && {purpose: template.sms_purpose ?? undefined}), ...(editor === "email" && {subject: template.subject ?? ""})}
          : {template_id: undefined});
      }}><option value="">Write my own</option>{available.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      {editor === "sms" ? <>
        <label className="block">SMS purpose<select aria-label="SMS purpose" className={selectStyle} value={value("purpose")} onChange={e => update({purpose: e.target.value || undefined})}>
          <option value="">Choose purpose</option><option value="informational" disabled={selectedTemplate?.sms_purpose === "marketing"}>Informational</option><option value="marketing">Marketing</option>
        </select></label>
        <p className="text-muted-foreground">The agency’s registered texting policy selects the eligible sender and preserves the contact’s sticky number.</p>
      </> : <>
        <label className="block">Email sender<select aria-label="Email sender" className={selectStyle} value={value("sender_id")} onChange={e => update({sender_id: e.target.value || undefined})}>
          <option value="">Choose sender and reply address</option>{options.senders.map(s =>
            <option key={s.id} value={s.id}>{s.from_email} · Reply to {s.reply_to}</option>)}
        </select></label>
        <label className="block">Subject<Input value={value("subject")} onChange={e => update({subject: e.target.value})}/></label>
      </>}
      {options.hasNextPage && <Button variant="link" disabled={options.isFetchingNextPage} onClick={() => options.fetchNextPage()}>Load more channel options</Button>}
      <label className="block">Message body<Textarea value={value("body")} onChange={e => update({body: e.target.value})}/></label>
      <p className="text-xs text-muted-foreground">Merge fields: {"{{first_name}}, {{last_name}}, {{email}}, {{phone}}"}</p>
    </>}
    {(campaigns.isError || sources.isError || options.isError) && <p role="alert">Agency options could not be loaded. Reopen this block to retry.</p>}
  </section>;
}
