import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ReportRequestedScope, ReportScope } from "@/lib/reports-schemas";

const SCOPES: { value: ReportRequestedScope; label: string }[] = [
  { value: "personal", label: "Personal" },
  { value: "team", label: "Team" },
  { value: "agency", label: "Agency" },
];
interface Props {
  scope: ReportScope | null;
  onScope: (scope: ReportRequestedScope) => void;
  disabled?: boolean;
}

/** Server-authorized views, never client-side role guesses or agent filters. */
export default function ReportScopeTabs({ scope, onScope, disabled = false }: Props) {
  if (!scope) return null;
  const available = SCOPES.filter(({ value }) => scope.available_scopes.includes(value));
  const select = (value: string) => {
    const next = available.find((option) => option.value === value);
    if (!disabled && next && next.value !== scope.requested_scope) onScope(next.value);
  };
  return (
    <Tabs value={scope.requested_scope} onValueChange={select} activationMode="manual">
      <TabsList aria-label="Report scope" className="h-10 w-full sm:w-auto bg-muted/60 p-1">
        {available.map(({ value, label }) => (
          <TabsTrigger key={value} id={`report-scope-${value}`} aria-controls="reports-scope-panel"
            value={value} disabled={disabled} className="flex-1 px-5 text-sm font-medium sm:flex-none">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
