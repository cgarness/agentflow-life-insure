import React from "react";
import { User, Megaphone, Phone } from "lucide-react";
import type { SearchResult } from "./GlobalSearch";

interface Props {
  result: SearchResult;
  active: boolean;
  onSelect: (result: SearchResult) => void;
}

const ICONS: Record<SearchResult["result_type"], React.ReactNode> = {
  lead:         <User className="w-3.5 h-3.5 text-primary" />,
  client:       <User className="w-3.5 h-3.5 text-emerald-500" />,
  recruit:      <User className="w-3.5 h-3.5 text-violet-500" />,
  campaign:     <Megaphone className="w-3.5 h-3.5 text-amber-500" />,
  conversation: <Phone className="w-3.5 h-3.5 text-sky-500" />,
};

const TYPE_LABEL: Record<SearchResult["result_type"], string> = {
  lead: "Lead", client: "Client", recruit: "Recruit",
  campaign: "Campaign", conversation: "Call",
};

const SearchResultItem: React.FC<Props> = ({ result, active, onSelect }) => (
  <button
    onMouseDown={(e) => { e.preventDefault(); onSelect(result); }}
    className={`w-full px-3 py-2 flex items-center gap-3 text-sm text-left transition-colors ${
      active ? "bg-accent" : "hover:bg-accent/60"
    }`}
  >
    <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
      {ICONS[result.result_type]}
    </div>
    <div className="min-w-0 flex-1">
      <p className="font-medium text-foreground truncate">{result.title}</p>
      <p className="text-xs text-muted-foreground truncate">
        {TYPE_LABEL[result.result_type]} · {result.subtitle}
      </p>
    </div>
  </button>
);

export default SearchResultItem;
