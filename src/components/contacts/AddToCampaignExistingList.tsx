import React from "react";
import { Loader2, Search } from "lucide-react";
import type { AddToCampaignOption } from "@/components/contacts/addToCampaignOptions";
import type { AddToCampaignOptionsStatus } from "@/hooks/useAddToCampaignOptions";

interface AddToCampaignExistingListProps {
  status: AddToCampaignOptionsStatus;
  options: AddToCampaignOption[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

/** Search + campaign list for "Add to Existing". Loading, error and empty are distinct states. */
const AddToCampaignExistingList: React.FC<AddToCampaignExistingListProps> = ({
  status, options, searchQuery, onSearchChange, selectedId, onSelect, onRetry,
}) => {
  const query = searchQuery.trim().toLowerCase();
  const matches = query ? options.filter((c) => c.name.toLowerCase().includes(query)) : options;
  const message = (text: string) => <p className="text-sm text-muted-foreground text-center py-8">{text}</p>;

  let body: React.ReactNode;
  if (status === "loading") {
    body = (
      <div role="status" aria-label="Loading campaigns" className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  } else if (status === "error") {
    body = (
      <div role="alert" className="flex flex-col items-center gap-2 py-6 text-center">
        <p className="text-sm text-destructive">Campaigns couldn't be loaded.</p>
        <button
          type="button"
          onClick={onRetry}
          className="h-8 px-3 rounded-md bg-muted text-sm font-medium text-foreground hover:bg-accent transition-colors"
        >
          Retry
        </button>
      </div>
    );
  } else if (status === "unavailable") {
    body = message("Campaigns aren't available without an organization.");
  } else if (options.length === 0) {
    body = message("No active campaigns found");
  } else if (matches.length === 0) {
    body = message("No campaigns match your search.");
  } else {
    body = matches.map((c) => {
      const selected = selectedId === c.id;
      return (
        <button
          key={c.id}
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect(c.id)}
          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
            selected ? "bg-primary text-primary-foreground" : "hover:bg-accent text-foreground"
          }`}
        >
          <div className="font-medium">{c.name}</div>
          <div className={`text-xs ${selected ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
            {c.type} • {c.totalLeads} leads
          </div>
        </button>
      );
    });
  }

  return (
    <>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search campaigns..."
          aria-label="Search campaigns"
          className="w-full h-9 pl-9 pr-4 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
        />
      </div>
      <div aria-busy={status === "loading"} className="max-h-60 overflow-y-auto space-y-1 border rounded-lg p-1 bg-muted/30">
        {body}
      </div>
    </>
  );
};

export default AddToCampaignExistingList;
