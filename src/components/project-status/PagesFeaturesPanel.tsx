import React from "react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { matchesQuery } from "./InventorySearch";
import { DEFAULT_FEATURES, DEFAULT_PAGES } from "@/config/permissionDefaults";

interface PagesFeaturesPanelProps {
  search: string;
}

const PagesFeaturesPanel: React.FC<PagesFeaturesPanelProps> = ({ search }) => {
  const pages = DEFAULT_PAGES.filter((p) =>
    matchesQuery(p.name, search)
  );

  const categories = DEFAULT_FEATURES.map((cat) => ({
    ...cat,
    features: cat.features.filter((f) =>
      matchesQuery(`${cat.category} ${f.name} ${f.description}`, search)
    ),
  })).filter((c) => c.features.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-2">App pages ({pages.length})</h3>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left py-2 px-3 font-medium">Page</th>
                <th className="text-center py-2 px-3 font-medium">Agent</th>
                <th className="text-center py-2 px-3 font-medium">Team Leader</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.name} className="border-t border-border/50">
                  <td className="py-2 px-3">{p.name}</td>
                  <td className="text-center py-2 px-3">{p.agent ? "✓" : "—"}</td>
                  <td className="text-center py-2 px-3">{p.teamLeader ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-2">Permission features</h3>
        <Accordion type="multiple" className="w-full">
          {categories.map((cat) => (
            <AccordionItem key={cat.category} value={cat.category}>
              <AccordionTrigger>{cat.category} ({cat.features.length})</AccordionTrigger>
              <AccordionContent>
                <ul className="space-y-2 pl-1">
                  {cat.features.map((f) => (
                    <li key={f.name} className="text-sm">
                      <span className="font-medium">{f.name}</span>
                      <span className="text-muted-foreground"> — {f.description}</span>
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  );
};

export default PagesFeaturesPanel;
