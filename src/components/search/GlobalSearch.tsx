import React, { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Search, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDebounce } from "@/hooks/useDebounce";
import SearchResultsDropdown from "./SearchResultsDropdown";

export type SearchResult = {
  result_type: "lead" | "client" | "recruit" | "campaign" | "conversation";
  id: string;
  title: string;
  subtitle: string;
  match_field: string;
  relevance: number;
};

const querySchema = z.string().trim().min(2).max(100);

// BLOCKER NOTE: No /contacts/:id, /leads/:id, /clients/:id, or /recruits/:id route exists in App.tsx.
// Contact results navigate to /contacts?type=<type>&id=<id> as a v1 fallback.
// A dedicated detail route must be added before contact click-through is fully functional.
function buildRoute(result: SearchResult): string {
  if (result.result_type === "campaign") return `/campaigns/${result.id}`;
  if (result.result_type === "conversation") return `/conversations?call=${result.id}`;
  return `/contacts?type=${result.result_type}&id=${result.id}`;
}

const GlobalSearch: React.FC = () => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const debounced = useDebounce(query, 250);

  useEffect(() => {
    const parsed = querySchema.safeParse(debounced);
    if (!parsed.success) {
      setResults([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase.rpc("global_search", { search_query: parsed.data }).then(({ data, error }) => {
      if (cancelled) return;
      setLoading(false);
      if (!error && Array.isArray(data)) {
        setResults(data as SearchResult[]);
        setOpen(true);
        setActiveIdx(-1);
      }
    });
    return () => { cancelled = true; };
  }, [debounced]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = useCallback((result: SearchResult) => {
    navigate(buildRoute(result));
    setOpen(false);
    setQuery("");
    setResults([]);
  }, [navigate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      handleSelect(results[activeIdx]);
    }
  };

  const clearSearch = () => { setQuery(""); setOpen(false); setResults([]); };

  return (
    <div ref={containerRef} className="flex-1 max-w-lg mx-auto relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Search contacts, campaigns, conversations..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onKeyDown={handleKeyDown}
          className="w-full h-9 pl-9 pr-8 rounded-lg bg-muted text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 sidebar-transition"
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin pointer-events-none" />
        ) : query ? (
          <button onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </div>
      {open && (
        <SearchResultsDropdown
          results={results}
          query={query}
          activeIdx={activeIdx}
          onSelect={handleSelect}
        />
      )}
    </div>
  );
};

export default GlobalSearch;
