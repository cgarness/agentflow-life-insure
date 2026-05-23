import React from "react";
import { Bold, Italic, Underline, List, ListOrdered, Heading, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MERGE_FIELDS } from "./callScriptConstants";

interface CallScriptToolbarProps {
  onWrap: (before: string, after: string) => void;
  onInsertMergeField: (field: string) => void;
}

export const CallScriptToolbar: React.FC<CallScriptToolbarProps> = ({ onWrap, onInsertMergeField }) => {
  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b flex-wrap bg-card w-full">
      <button onClick={() => onWrap("**", "**")} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Bold">
        <Bold className="w-4 h-4" />
      </button>
      <button onClick={() => onWrap("*", "*")} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Italic">
        <Italic className="w-4 h-4" />
      </button>
      <button onClick={() => onWrap("<u>", "</u>")} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Underline">
        <Underline className="w-4 h-4" />
      </button>
      <div className="w-px h-5 bg-border mx-1" />
      <button onClick={() => onWrap("\n- ", "")} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Bullet List">
        <List className="w-4 h-4" />
      </button>
      <button onClick={() => onWrap("\n1. ", "")} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Numbered List">
        <ListOrdered className="w-4 h-4" />
      </button>
      <div className="w-px h-5 bg-border mx-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground flex items-center gap-1" title="Heading">
            <Heading className="w-4 h-4" /> <ChevronDown className="w-3 h-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => onWrap("\n# ", "")}>H1</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onWrap("\n## ", "")}>H2</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onWrap("\n### ", "")}>H3</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="w-px h-5 bg-border mx-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="px-2 py-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground text-xs font-medium flex items-center gap-1">
            Merge Fields <ChevronDown className="w-3 h-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {MERGE_FIELDS.map((f) => (
            <DropdownMenuItem key={f} onClick={() => onInsertMergeField(f)} className="font-mono text-xs">
              {f}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
