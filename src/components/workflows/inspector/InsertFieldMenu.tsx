import { useRef, useState } from "react";
import { Braces, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fieldsForTrigger, fieldToken } from "../../../../supabase/functions/_shared/automations/fields";
import { arrowNavigation } from "./stepConfig";

interface Props {
  /** The workflow's trigger type. It decides which fields can be filled. */
  trigger: string | undefined;
  /** ID of the label of the field this menu inserts into, read out as the button's description. */
  describedBy?: string;
  onInsert: (token: string) => void;
  /** Called after the menu closes following an insertion, so focus can go back to the field. */
  onInserted?: () => void;
}

/** Friendly field names for one text field. Choosing one inserts its token at the cursor. */
export default function InsertFieldMenu({trigger, describedBy, onInsert, onInserted}: Props) {
  const [open, setOpen] = useState(false);
  const inserted = useRef(false);
  const fields = fieldsForTrigger(trigger);
  const groups = [...new Set(fields.map(field => field.group))];
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant="ghost" size="sm" aria-describedby={describedBy}
        className="h-11 gap-1 px-2 text-muted-foreground hover:text-foreground md:h-8">
        <Braces aria-hidden="true"/>Insert field<ChevronDown aria-hidden="true"/>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" aria-label="Insert field" className="w-64 p-1" onKeyDown={arrowNavigation}
      onCloseAutoFocus={event => {
        if (!inserted.current) return;
        inserted.current = false;
        event.preventDefault();
        onInserted?.();
      }}>
      {groups.map(group => <div key={group} role="group" aria-label={group}>
        <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground" aria-hidden="true">{group}</p>
        {fields.filter(field => field.group === group).map(field => <button key={field.token} type="button"
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm px-2 text-left text-sm transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9"
          onClick={() => { inserted.current = true; onInsert(fieldToken(field.token)); setOpen(false); }}>
          <span>{field.label}</span>
          <span className="truncate text-xs text-muted-foreground" aria-hidden="true">{field.sample}</span>
        </button>)}
      </div>)}
    </PopoverContent>
  </Popover>;
}
