import { useId, useRef, useState, type Ref } from "react";
import { Ban, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebounce } from "@/hooks/useDebounce";
import { useMinWidth } from "@/hooks/useMinWidth";
import type { SavedMessage } from "@/lib/automation-api";
import { useSavedMessages, type MessageChannel } from "../useAutomationOptions";
import OptionsAlert from "./OptionsAlert";
import { savedMessageBlocker, savedMessageCopy } from "./savedMessages";
import { arrowNavigation } from "./stepConfig";

interface Props {
  scope: string;
  channel: MessageChannel;
  /** The workflow's trigger type. A saved message that needs other fields cannot be chosen. */
  trigger: string | undefined;
  buttonRef?: Ref<HTMLButtonElement>;
  onChoose: (message: SavedMessage) => void;
}

function MessageRow({message, trigger, onChoose}: {message: SavedMessage; trigger: string | undefined; onChoose: () => void}) {
  const id = useId();
  const blocker = savedMessageBlocker(message, trigger);
  const copy = savedMessageCopy(message);
  return <button type="button" disabled={!!blocker} aria-labelledby={id + "-name"} aria-describedby={id + "-detail"} onClick={onChoose}
    className="flex min-h-11 w-full flex-col gap-0.5 rounded-sm px-2 py-2 text-left text-sm transition-colors duration-150 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:hover:bg-transparent">
    <span id={id + "-name"} className={blocker ? "font-medium text-muted-foreground" : "font-medium text-foreground"}>{message.name}</span>
    <span id={id + "-detail"} className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      {message.type === "email" && copy.subject && <span className="truncate">Subject: {copy.subject}</span>}
      <span className="line-clamp-2 whitespace-pre-wrap">{copy.body}</span>
      {blocker && <span className="flex items-start gap-1 text-foreground">
        <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true"/>{blocker}
      </span>}
    </span>
  </button>;
}

/** Optional starting point for a message: the saved messages this author can read for the channel. */
export default function SavedMessageMenu({scope, channel, trigger, buttonRef, onChoose}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const term = useDebounce(search.trim(), 250);
  const desktop = useMinWidth(768);
  const content = useRef<HTMLDivElement>(null);
  const messages = useSavedMessages(scope, channel, term, open);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button ref={buttonRef} type="button" variant="outline" size="sm" className="h-11 gap-1 px-3 md:h-8">
        Use saved message<ChevronDown aria-hidden="true"/>
      </Button>
    </PopoverTrigger>
    <PopoverContent ref={content} align="end" aria-label="Saved messages" className="w-[min(22rem,calc(100vw-2rem))] p-0"
      onKeyDown={arrowNavigation}
      onOpenAutoFocus={event => {
        // On a phone the list matters more than the keyboard that a focused search box would raise.
        if (desktop) return;
        event.preventDefault();
        content.current?.focus();
      }}>
      <div className="border-b p-2">
        <Input type="search" aria-label="Search saved messages" placeholder="Search saved messages" maxLength={200}
          value={search} onChange={event => setSearch(event.target.value)}/>
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto p-1">
        {messages.isError ? <OptionsAlert what="Saved messages" onRetry={() => { void messages.refetch(); }}/>
          : messages.isPending ? <p role="status" className="px-2 py-3 text-sm text-muted-foreground">Loading saved messages…</p>
          : !messages.items.length ? <p className="px-2 py-3 text-sm text-muted-foreground">
            {term ? "No saved messages match your search." : channel === "sms" ? "No saved text messages yet." : "No saved email messages yet."}
          </p>
          : <ul>{messages.items.map(message => <li key={message.id}>
            <MessageRow message={message} trigger={trigger} onChoose={() => { setOpen(false); setSearch(""); onChoose(message); }}/>
          </li>)}</ul>}
        {messages.hasNextPage && <Button type="button" variant="ghost" size="sm" className="h-11 w-full md:h-9"
          disabled={messages.isFetchingNextPage} onClick={() => { void messages.fetchNextPage(); }}>
          {messages.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>}
      </div>
    </PopoverContent>
  </Popover>;
}
