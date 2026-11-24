import { Badge } from "@/components/ui/badge";
import type { SmsRequirement } from "@/lib/automation-api";
import type { EmailSender } from "@/lib/automation-channels";
import { triggerContactKinds, type SummaryNames } from "../../../../supabase/functions/_shared/automations/blockRegistry";
import { graphBlock, stepSummary, stepTitle } from "../../../../supabase/functions/_shared/automations/graph";
import type { OrderedStep } from "../lib/draftGraph";

interface Props {
  steps: OrderedStep[];
  names: SummaryNames;
  /** Verified sender identities for the email steps, by sender ID. */
  senders: Record<string, EmailSender>;
  /** Consent the server will pin for each text step when this draft is published. */
  requirements?: SmsRequirement[] | null;
  /** The trigger, which decides whether a run can be for a client or recruit. */
  triggerType?: string;
}

const PURPOSES: Record<SmsRequirement["purpose"], string> = {
  marketing: "Requires marketing consent",
  informational: "Informational",
};
const BASES: Record<SmsRequirement["basis"], string> = {
  saved_message: "unchanged saved message",
  custom: "custom wording",
  author: "chosen by the author",
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The steps exactly as they will be published, with the wording and consent each message carries. */
export default function ReviewSteps({steps, names, senders, requirements, triggerType}: Props) {
  const others = triggerContactKinds(triggerType).some(kind => kind !== "lead");
  return <ol aria-label="Steps to publish" className="space-y-2">
    {steps.map(({node, path}) => {
      const block = graphBlock(node);
      const message = block?.editor === "sms" || block?.editor === "email";
      // A message step shows its full wording below, so the short summary would only repeat it.
      const summary = message ? (node.meta?.name?.trim() ? block.label : "") : stepSummary(node, names);
      const sender = senders[text(node.config.sender_id)];
      const requirement = requirements?.find(item => item.node_id === node.id);
      // A bordered card, not a muted one: the neutral badge shares the muted surface and would lose its shape.
      return <li key={node.id} className="space-y-1 rounded-md border bg-card p-3">
        <p className="font-medium">
          {path && <span className="font-normal text-muted-foreground">{path} · </span>}{stepTitle(node)}
        </p>
        {summary && <p className="text-muted-foreground">{summary}</p>}
        {block?.editor === "email" && <>
          <p className="text-muted-foreground">
            {sender ? "From " + sender.from_email + " · Reply to " + sender.reply_to : "An eligible sender and reply address are required."}
          </p>
          <p><span className="text-muted-foreground">Subject: </span>{text(node.config.subject)}</p>
        </>}
        {message && <p className="whitespace-pre-wrap">{text(node.config.body)}</p>}
        {message && others && <p className="text-xs text-muted-foreground">
          Texts and emails go to leads only. A client or recruit skips this step and the run continues.
        </p>}
        {block?.editor === "task" && text(node.config.notes) && <p className="whitespace-pre-wrap">
          <span className="text-muted-foreground">Notes: </span>{text(node.config.notes)}
        </p>}
        {block?.editor === "sms" && (requirement
          ? <Badge variant={requirement.purpose === "marketing" ? "info" : "neutral"}>
            {(PURPOSES[requirement.purpose] ?? "Consent required") + " · " + (BASES[requirement.basis] ?? "set at publish")}
          </Badge>
          : <p className="text-xs text-muted-foreground">Consent requirement: Unknown</p>)}
      </li>;
    })}
  </ol>;
}
