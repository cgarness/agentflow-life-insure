import { useId } from "react";
import { Button } from "@/components/ui/button";
import { selectStyle } from "../../lib/fieldStyles";
import { useSenderOptions } from "../../useAutomationOptions";
import Field from "../Field";
import OptionsAlert from "../OptionsAlert";

interface Props {
  scope: string;
  value: string;
  onChange: (senderId: string | undefined) => void;
}

/** The verified agency address an email step sends from, with the inbox replies go to. */
export default function SenderField({scope, value, onChange}: Props) {
  const id = useId();
  const senders = useSenderOptions(scope, value, true);
  const listed = senders.items.some(sender => sender.id === value);
  return <Field id={id} label="Email sender">
    <select id={id} className={selectStyle} value={value} onChange={event => onChange(event.target.value || undefined)}>
      <option value="">Choose sender and reply address</option>
      {value && !listed && <option value={value}>{senders.missing ? "Sender no longer available" : "Saved sender"}</option>}
      {senders.items.map(sender => <option key={sender.id} value={sender.id}>{sender.from_email} · Reply to {sender.reply_to}</option>)}
    </select>
    {senders.hasNextPage && <Button type="button" variant="link" className="h-11 px-0 md:h-9" disabled={senders.isFetchingNextPage}
      onClick={() => { void senders.fetchNextPage(); }}>Load more senders</Button>}
    {senders.isError && <OptionsAlert what="Email senders" onRetry={() => { void senders.refetch(); }}/>}
    {senders.isSuccess && !senders.items.length && <p className="text-xs text-muted-foreground">Your agency has no verified email sender yet.</p>}
  </Field>;
}
