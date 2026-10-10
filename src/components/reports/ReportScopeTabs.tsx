import { Skeleton } from "@/components/ui/skeleton";
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
  /** The scope is still resolving: hold the bar's place without offering any tab. */
  loading?: boolean;
  /** The scope tabpanel exists, so the tabs may point at it. */
  panelRendered?: boolean;
}

/**
 * Server-authorized views, never client-side role guesses or agent filters. An unselected tab reads at 70%
 * foreground: the list's muted-foreground on its bg-muted/60 is 4.45:1, under the 4.5:1 text minimum.
 */
export default function ReportScopeTabs({ scope, onScope, disabled = false, loading = false, panelRendered = false }: Props) {
  if (!scope) return loading ? <Skeleton aria-hidden="true" data-report-scope-skeleton className="h-10 w-full rounded-lg sm:w-[232px]" /> : null;
  const available = SCOPES.filter(({ value }) => scope.available_scopes.includes(value));
  const select = (value: string) => {
    const next = available.find((option) => option.value === value);
    if (!disabled && next && next.value !== scope.requested_scope) onScope(next.value);
  };
  return (
    <Tabs value={scope.requested_scope} onValueChange={select} activationMode="manual">
      <TabsList aria-label="Report scope" className="h-10 w-full bg-muted/60 p-1 sm:w-auto">
        {available.map(({ value, label }) => (
          <TabsTrigger key={value} id={`report-scope-${value}`} aria-controls={panelRendered ? "reports-scope-panel" : undefined}
            value={value} disabled={disabled} className="flex-1 px-4 text-sm font-medium text-foreground/70 data-[state=active]:text-foreground sm:flex-none">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
