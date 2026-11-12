import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Accordion } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import type { CarrierDirectoryItem } from "@/lib/carrierResources";
import CarrierAccordionCard from "./CarrierAccordionCard";

export default function CarrierDirectory({ carriers }: { carriers: CarrierDirectoryItem[] }) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return carriers.filter((carrier) => carrier.name.toLocaleLowerCase().includes(query))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [carriers, search]);

  return (
    <div className="space-y-4">
      <div className="relative w-full sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          aria-label="Search carriers"
          placeholder="Search carriers"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setExpandedId("");
          }}
          className="bg-card pl-9"
        />
      </div>

      {filtered.length > 0 ? (
        <Accordion type="single" collapsible value={expandedId} onValueChange={setExpandedId} className="space-y-3">
          {filtered.map((carrier) => <CarrierAccordionCard key={carrier.id} carrier={carrier} />)}
        </Accordion>
      ) : (
        <div role="status" className="rounded-xl border border-border bg-card px-4 py-12 text-center">
          <p className="font-medium">{carriers.length === 0 ? "No carriers yet" : "No carriers found"}</p>
          {carriers.length === 0 && (
            <p className="mt-1 text-sm text-muted-foreground">Your agency’s carriers will appear here.</p>
          )}
        </div>
      )}
    </div>
  );
}
