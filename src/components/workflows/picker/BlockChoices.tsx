import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { availableBlocks, type AutomationGraph } from "../../../../supabase/functions/_shared/automations/graph";
import type { BlockType } from "../lib/draftGraph";
import { GROUP_ORDER, blockVisual } from "../steps/blockMeta";
import StepGlyph from "../editor/StepGlyph";

interface Props {
  graph: AutomationGraph;
  onPick: (type: BlockType) => void;
}

/** Every word typed must appear in the label, the description or a keyword. */
function matches(query: string, text: string) {
  const haystack = text.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}

/** Searchable choices that are valid at this insertion point, grouped as Triggers, Actions, Timing, Conditions. */
export default function BlockChoices({graph, onPick}: Props) {
  const [query, setQuery] = useState("");
  const base = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const available = useMemo(() => availableBlocks(graph), [graph]);
  const found = available.filter(entry => matches(query, [entry.label, entry.description, ...entry.keywords].join(" ")));
  const groups = GROUP_ORDER.map(group => ({group, entries: found.filter(entry => entry.group === group)}))
    .filter(section => section.entries.length);
  const triggers = available.every(entry => entry.category === "trigger");
  const search = triggers ? "Search triggers" : "Search steps";

  // Arrow keys walk the choices. Enter in the search box moves to the first match instead of choosing it unseen.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const fromSearch = event.target === input.current;
    const moves = fromSearch ? ["ArrowDown", "Enter"] : ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!moves.includes(event.key)) return;
    const choices = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button[data-choice]") ?? []);
    if (!choices.length) return;
    event.preventDefault();
    const at = choices.indexOf(document.activeElement as HTMLButtonElement);
    const next = fromSearch || event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1
      : event.key === "ArrowUp" ? at - 1 : Math.min(at + 1, choices.length - 1);
    if (next < 0) input.current?.focus(); else choices[next].focus();
  }

  return <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
    <div className="relative border-b border-border p-2">
      <Search aria-hidden className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
      <Input ref={input} type="search" aria-label={search} placeholder={search} autoComplete="off" className="h-11 pl-9 md:h-10"
        value={query} onChange={event => setQuery(event.target.value)}/>
    </div>
    <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-1">
      {groups.map(({group, entries}) => <div key={group} role="group" aria-labelledby={base + group}>
        <div id={base + group} className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{group}</div>
        {entries.map(entry => <button key={entry.type} type="button" data-choice aria-labelledby={base + entry.type + "label"}
          aria-describedby={base + entry.type + "about"} onClick={() => onPick(entry.type)}
          className="flex min-h-11 w-full items-start gap-3 rounded-md p-2 text-left transition-colors duration-150 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <StepGlyph visual={blockVisual(entry.type, entry.category)}/>
          <span className="min-w-0">
            <span id={base + entry.type + "label"} className="block text-sm font-medium text-foreground">{entry.label}</span>
            <span id={base + entry.type + "about"} className="block text-xs text-muted-foreground">{entry.description}</span>
          </span>
        </button>)}
      </div>)}
      {!groups.length && <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">No matching steps</p>}
    </div>
  </div>;
}
