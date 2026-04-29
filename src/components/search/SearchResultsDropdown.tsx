import React from "react";
import { Search } from "lucide-react";
import SearchResultItem from "./SearchResultItem";
import type { SearchResult } from "./GlobalSearch";

interface Props {
  results: SearchResult[];
  query: string;
  activeIdx: number;
  onSelect: (result: SearchResult) => void;
}

const CONTACT_TYPES = new Set<SearchResult["result_type"]>(["lead", "client", "recruit"]);

const SECTION_ORDER: Array<{ key: string; label: string; types: Set<SearchResult["result_type"]> }> = [
  { key: "contacts",      label: "Contacts",      types: CONTACT_TYPES },
  { key: "campaigns",     label: "Campaigns",     types: new Set(["campaign"]) },
  { key: "conversations", label: "Conversations", types: new Set(["conversation"]) },
];

const SearchResultsDropdown: React.FC<Props> = ({ results, query, activeIdx, onSelect }) => {
  if (results.length === 0) {
    return (
      <div className="absolute top-full mt-2 w-full bg-card border rounded-lg shadow-lg py-4 z-50 flex flex-col items-center text-muted-foreground gap-2">
        <Search className="w-5 h-5 opacity-40" />
        <p className="text-sm">No results for &ldquo;{query}&rdquo;</p>
      </div>
    );
  }

  let flatIdx = 0;

  return (
    <div className="absolute top-full mt-2 w-full bg-card border rounded-lg shadow-lg py-1 z-50 max-h-80 overflow-y-auto">
      {SECTION_ORDER.map(({ key, label, types }) => {
        const sectionItems = results.filter((r) => types.has(r.result_type));
        if (sectionItems.length === 0) return null;

        return (
          <div key={key}>
            <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-t first:border-t-0 mt-1 first:mt-0 pt-2">
              {label}
            </div>
            {sectionItems.map((result) => {
              const idx = flatIdx++;
              return (
                <SearchResultItem
                  key={result.id}
                  result={result}
                  active={activeIdx === idx}
                  onSelect={onSelect}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

export default SearchResultsDropdown;
