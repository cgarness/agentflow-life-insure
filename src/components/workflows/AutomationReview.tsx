import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAutomationChannelOptions } from "@/lib/automation-channels";
import type { Option, Issue } from "@/lib/automation-api";
import { useCampaignOptions } from "./useAutomationOptions";
import { blocks, graphBlock, previewGraph, type AutomationGraph } from "../../../supabase/functions/_shared/automations/graph";
import { orderedSteps } from "./lib/draftGraph";
import { selectStyle } from "./AutomationBlockPanel";

interface Props {
  graph: AutomationGraph;
  scope: string;
  mode: "preview" | "review";
  overlaps: Option[];
  issues: Issue[];
  onFix: (id: string) => void;
}

export default function AutomationReview({graph, scope, mode, overlaps, issues, onFix}: Props) {
  const steps = orderedSteps(graph);
  const trigger = steps.find(s => graphBlock(s.node)?.category === "trigger")?.node;
  const triggerEditor = trigger && graphBlock(trigger)?.editor;
  const [sample, setSample] = useState<Record<string,string>>({});
  const [eligibility, setEligibility] = useState({sms_eligible: true, email_eligible: true, lookup_failed: false});
  const campaigns = useCampaignOptions(scope,String(trigger?.config.campaign_id ?? ""),triggerEditor === "campaign" || mode === "preview");
  const ids = [...new Set(steps.filter(s => graphBlock(s.node)?.editor === "email" && s.node.config.sender_id)
    .map(s => String(s.node.config.sender_id)))];
  const identities = useQueries({queries: ids.map(senderId => ({
    queryKey: ["automation-sender",scope,senderId], queryFn: () => getAutomationChannelOptions({senderId}),
  }))}).flatMap(query => query.data?.senders ?? []);
  const campaign = campaigns.items.find(c => c.id === trigger?.config.campaign_id)?.name;
  const sender = (id: unknown) => identities.find(s => s.id === id);
  const label = (id: string) => {
    const node = steps.find(s => s.node.id === id)?.node;
    return node && graphBlock(node)?.label;
  };
  const email_senders = Object.fromEntries(identities.map(identity => [identity.id, identity]));
  const example = {...sample, ...eligibility, email_senders, trigger: sample.trigger ?? trigger?.type};
  const output = mode === "preview" ? previewGraph(graph, example) : [];
  return <section className="space-y-4 rounded-xl border bg-card p-4 text-sm">
    <h3 className="text-lg font-semibold">{mode === "preview" ? "Synthetic preview" : "Publish review"}</h3>
    <p><strong>Audience</strong> · {triggerEditor === "campaign"
      ? "New memberships in " + (trigger.config.any_campaign ? "any campaign you can manage" : campaign ?? "the selected campaign")
      : trigger ? "Newly created agency leads" : "Choose a trigger"}
      {trigger?.config.lead_source ? " · Lead source: " + String(trigger.config.lead_source) : ""}</p>
    <p><strong>Re-entry</strong> · {graph.settings.reentry === "once" ? "Once per contact" : "New qualifying event after completion"}
      <br/><strong>Stop conditions</strong> · {graph.settings.stop_on_reply ? "Verified reply or manual stop" : "Manual stop"}</p>
    {mode === "preview" && <>
      <p>Enter synthetic values to evaluate this graph.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>Test event<select aria-label="Test event" className={selectStyle} value={example.trigger ?? ""} onChange={e => setSample({...sample,trigger:e.target.value})}>
          {blocks.filter(entry => entry.category === "trigger").map(entry => <option key={entry.type} value={entry.type}>{entry.label}</option>)}
        </select></label>
        <label>Test campaign<select aria-label="Test campaign" className={selectStyle} value={sample.campaign_id ?? ""} onChange={e => setSample({...sample,campaign_id:e.target.value})}>
          <option value="">None</option>{campaigns.items.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
        {campaigns.hasNextPage && <Button variant="link" disabled={campaigns.isFetchingNextPage} onClick={() => campaigns.fetchNextPage()}>Load more campaigns</Button>}
        {([["first_name","First name"],["last_name","Last name"],["email","Email"],["phone","Phone"],["lead_source","Lead source"]] as const)
          .map(([key,title]) => <label key={key}>{title}<Input value={sample[key] ?? ""} onChange={e => setSample({...sample,[key]:e.target.value})}/></label>)}
      </div>
      <div className="flex flex-wrap gap-4">
        {([["sms_eligible","sms","SMS sender and contact eligible"],["email_eligible","email","Email sender and contact eligible"],
          ["lookup_failed","emailCondition","Contact lookup unavailable"]] as const).filter(([,type]) => steps.some(s => graphBlock(s.node)?.editor === type))
          .map(([key,,title]) => <label key={key}><input type="checkbox" checked={eligibility[key]}
            onChange={e => setEligibility({...eligibility,[key]:e.target.checked})}/> {title}</label>)}
      </div>
      <ol aria-label="Preview results" className="space-y-2">{output.map((item,i) =>
        <li key={i} className="whitespace-pre-wrap rounded-md bg-muted p-2"><strong>{label(item.nodeId)}</strong> {item.detail}</li>)}</ol>
    </>}
    {mode === "review" && <>
      <ol className="space-y-2">{steps.map(({node, path}) => <li className="rounded-md bg-muted p-2" key={node.id}>
        <strong>{path && path + " · "}{graphBlock(node)?.label}</strong>
        {graphBlock(node)?.editor === "wait" && <p>{String(node.config.duration ?? "")} {String(node.config.unit ?? "")}</p>}
        {graphBlock(node)?.editor === "sms" && <p>{String(node.config.purpose ?? "")} SMS · Agency sender policy</p>}
        {graphBlock(node)?.editor === "email" && <p>{String(node.config.subject ?? "")}</p>}
        {typeof node.config.body === "string" && <p className="whitespace-pre-wrap">{node.config.body}</p>}
      </li>)}</ol>
      <p><strong>Audience overlap</strong> · {overlaps.length ? overlaps.map(o => o.name).join(", ") : "No other published audience matched."}</p>
    </>}
    {steps.filter(s => graphBlock(s.node)?.editor === "email").map(({node}) => {
      const identity = sender(node.config.sender_id);
      return <p key={node.id}><strong>Email identity</strong> · {identity ?
        identity.from_email + " · Reply to " + identity.reply_to : "An eligible sender and reply address are required."}</p>;
    })}
    {issues.map((issue,i) => <div className="text-red-700 dark:text-red-300" key={i}>{issue.message} {issue.node_id &&
      <Button size="sm" variant="link" onClick={() => onFix(issue.node_id!)}>Edit block</Button>}</div>)}
  </section>;
}
