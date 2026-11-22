import { useId } from "react";
import { useQueries } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { getAutomationChannelOptions, type EmailSender } from "@/lib/automation-channels";
import type { Issue, Option, SmsRequirement } from "@/lib/automation-api";
import { stepTitle, triggerNode, type AutomationGraph } from "../../../supabase/functions/_shared/automations/graph";
import { Problem } from "./inspector/Field";
import { orderedSteps } from "./lib/draftGraph";
import { audienceSentence, reentrySentence, stopRules } from "./review/audience";
import PreviewForm from "./review/PreviewForm";
import ReviewSteps from "./review/ReviewSteps";
import { useStepNames } from "./steps/useStepNames";

interface Props {
  graph: AutomationGraph;
  scope: string;
  mode: "preview" | "review";
  overlaps: Option[];
  issues: Issue[];
  onFix: (id: string) => void;
  /** Consent the server will pin for each text step at publish. Missing or null reads as Unknown. */
  requirements?: SmsRequirement[] | null;
}

/** Preview with test values, or the read-only summary an author checks before publishing a version. */
export default function AutomationReview({graph, scope, mode, overlaps, issues, onFix, requirements}: Props) {
  const id = useId();
  const trigger = triggerNode(graph);
  const names = useStepNames(scope, graph);
  const senderIds = [...new Set(graph.nodes.filter(node => node.type === "send_email" && typeof node.config.sender_id === "string" && node.config.sender_id)
    .map(node => node.config.sender_id as string))];
  const senders: Record<string, EmailSender> = Object.fromEntries(useQueries({queries: senderIds.map(senderId => ({
    queryKey: ["automation-sender", scope, senderId], queryFn: () => getAutomationChannelOptions({senderId}),
  }))}).flatMap(query => query.data?.senders ?? []).map(sender => [sender.id, sender]));
  const title = (nodeId: string | undefined) => {
    const node = graph.nodes.find(step => step.id === nodeId);
    return node ? stepTitle(node) : "";
  };
  const rules = [
    {label: "Audience", value: audienceSentence(trigger, names)},
    {label: "Re-entry", value: reentrySentence(graph.settings.reentry, trigger?.type)},
    ...stopRules(graph.settings).map(rule => ({label: rule.label, value: rule.on ? "On" : "Off"})),
  ];
  return <section className="space-y-4 rounded-lg border bg-card p-4 text-sm text-card-foreground">
    <h3 className="text-lg font-semibold">{mode === "preview" ? "Preview" : "Publish review"}</h3>
    <dl className="space-y-1.5">
      {rules.map(rule => <div key={rule.label} className="flex flex-wrap gap-x-2">
        <dt className="font-medium">{rule.label}</dt>
        <dd className="text-muted-foreground">{rule.value}</dd>
      </div>)}
    </dl>
    <p className="text-muted-foreground">A run can also be stopped by hand from Activity at any time.</p>
    {mode === "preview"
      ? <PreviewForm graph={graph} scope={scope} senders={senders}/>
      : <>
        <ReviewSteps steps={orderedSteps(graph)} names={names} senders={senders} requirements={requirements}/>
        <dl><div className="flex flex-wrap gap-x-2">
          <dt className="font-medium">Audience overlap</dt>
          <dd className="text-muted-foreground">
            {overlaps.length ? overlaps.map(overlap => overlap.name).join(", ") : "No other published automation has the same audience."}
          </dd>
        </div></dl>
      </>}
    {issues.length > 0 && <ul aria-label="Problems to fix" className="space-y-2 rounded-md bg-badge-error-surface p-3">
      {issues.map((issue, index) => <li key={index} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Problem id={id + "issue" + index}>
          {title(issue.node_id) && <span className="font-medium">{title(issue.node_id)}: </span>}{issue.message}
        </Problem>
        {issue.node_id && <Button type="button" size="sm" variant="outline" className="h-11 md:h-8" aria-describedby={id + "issue" + index}
          onClick={() => onFix(issue.node_id!)}>Edit block</Button>}
      </li>)}
    </ul>}
  </section>;
}
