import { useState } from "react";
import { Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const EMOJI_GROUPS: { title: string; chars: string[] }[] = [
  {
    title: "Expressions",
    chars: ["😊", "😂", "🙏", "👍", "❤️", "🔥", "✅", "⭐", "💯", "🎉", "👋", "😎"],
  },
  {
    title: "Symbols",
    chars: ["📞", "📧", "📅", "💼", "🏠", "📄", "💰", "🎯", "⚡", "🔔"],
  },
];

interface EmojiPickerPopoverProps {
  onInsert: (emoji: string) => void;
}

export function EmojiPickerPopover({ onInsert }: EmojiPickerPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs">
          <Smile className="h-3.5 w-3.5 shrink-0" />
          Emoji
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="space-y-3">
          {EMOJI_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{group.title}</p>
              <div className="grid grid-cols-8 gap-1">
                {group.chars.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-accent"
                    onClick={() => {
                      onInsert(ch);
                      setOpen(false);
                    }}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
