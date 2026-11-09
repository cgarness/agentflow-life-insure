import React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export interface ReportExportItem { label: string; ready: boolean; onSelect: () => void }

/**
 * Toolbar Export menu (D6 §4.9): the KPI files (Report summary, Journey, Sales appointments). Each item is enabled
 * only while its panel is current for this request; the trigger keeps the name "Export".
 */
const ReportExportMenu: React.FC<{ items: ReportExportItem[]; className: string; labelClassName: string }> = ({ items, className, labelClassName }) => {
  const any = items.some(i => i.ready);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={className} disabled={!any}
          title={any ? "Export a report on screen" : "Export is available once the report has loaded"}>
          <Download aria-hidden="true" /><span className={labelClassName}>Export</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {items.map(i => (
          <DropdownMenuItem key={i.label} disabled={!i.ready} onSelect={i.onSelect}>{i.label} CSV</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ReportExportMenu;
