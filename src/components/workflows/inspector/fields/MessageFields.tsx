import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SavedMessage } from "@/lib/automation-api";
import { triggerNode } from "../../../../../supabase/functions/_shared/automations/graph";
import { savedMessageKey, useSavedMessage } from "../../useAutomationOptions";
import PersonalizedField from "../PersonalizedField";
import ReplaceMessageDialog from "../ReplaceMessageDialog";
import SavedMessageMenu from "../SavedMessageMenu";
import { savedMessageCopy } from "../savedMessages";
import { currentSms, patchConfig, textValue, type EditorProps } from "../stepConfig";
import SenderField from "./SenderField";

const PURPOSES = ["informational", "marketing"];

/** Text and email steps open on the wording itself. Saved messages and fields are optional helpers. */
export default function MessageFields({graph, node, scope, issues, onChange}: EditorProps) {
  const email = node.type === "send_email";
  const channel = email ? "email" : "sms";
  const trigger = triggerNode(graph)?.type;
  const body = textValue(node, "body"), subject = textValue(node, "subject"), savedId = textValue(node, "template_id");
  const cache = useQueryClient();
  const saved = useSavedMessage(scope, channel, savedId).data;
  const [asking, setAsking] = useState<SavedMessage | null>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const origin = saved ? savedMessageCopy(saved) : null;
  const edited = !!origin && (body !== origin.body || (email && subject !== origin.subject));

  // Any change made here leaves a text step on the current definition, which has no author-chosen purpose.
  const change = (patch: Record<string, unknown>) => onChange(patchConfig(currentSms(node), patch));

  function applySaved(message: SavedMessage) {
    const copy = savedMessageCopy(message);
    cache.setQueryData(savedMessageKey(scope, channel, message.id), message);
    change({body: copy.body, ...(email && {subject: copy.subject}), template_id: message.id});
  }
  function choose(message: SavedMessage) {
    const copy = savedMessageCopy(message);
    const written = Boolean(body.trim() || (email && subject.trim()));
    const same = body === copy.body && (!email || subject === copy.subject);
    if (written && !same) setAsking(message); else applySaved(message);
  }

  return <>
    {email && <SenderField scope={scope} value={textValue(node, "sender_id")} onChange={sender_id => change({sender_id})}/>}
    {email && <PersonalizedField label="Subject" value={subject} maxLength={200} trigger={trigger} issues={issues}
      onChange={value => change({subject: value})}/>}
    <PersonalizedField label="Message" multiline value={body} maxLength={email ? 20000 : 1600} trigger={trigger} issues={issues}
      className={email ? "min-h-[12rem] text-base md:text-sm" : "min-h-[8rem] text-base md:text-sm"}
      onChange={value => change({body: value})}
      tools={<SavedMessageMenu scope={scope} channel={channel} trigger={trigger} buttonRef={menu} onChoose={choose}/>}/>
    {savedId && <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <p className="flex flex-wrap items-center gap-2">
        {saved ? "Started from “" + saved.name + "”" : "Started from a saved message"}
        {edited && <Badge variant="neutral">Edited</Badge>}
      </p>
      <Button type="button" variant="link" size="sm" className="h-11 px-0 text-xs md:h-8" onClick={() => change({template_id: undefined})}>
        Clear saved message
      </Button>
    </div>}
    {!email && <p className="text-xs text-muted-foreground">
      A saved message used unchanged keeps its own consent type. Any other wording needs the contact's marketing consent.
      The requirement is set when you publish, and your agency's texting rules choose the sender.
    </p>}
    {!email && node.version === 1 && !PURPOSES.includes(String(node.config.purpose)) && <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-3 text-xs">
      <p>This step was written in an earlier version of the builder.</p>
      <Button type="button" variant="outline" size="sm" className="h-11 md:h-8" onClick={() => change({})}>Update step</Button>
    </div>}
    <ReplaceMessageDialog message={asking} onReplace={applySaved} onClose={() => setAsking(null)} onClosed={() => menu.current?.focus()}/>
  </>;
}
