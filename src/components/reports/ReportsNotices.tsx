import { ReportNotice, ReportPanelSkeleton } from "./ReportPanelState";

interface Props {
  scopeLoading: boolean;
  scopeError: string | null;
  /** The scope or a panel was refused because the agency time zone is not configured. */
  zoneRequired: boolean;
  onRetryScope: () => void;
  /** An explicit scope choice failed: offer the server default instead. */
  onDefaultScope?: () => void;
  /** A panel answered for other access, zone or filters (and not for a missing zone). */
  scopeDrift: boolean;
  /** Custom range with a start or end date still missing. */
  customRangeIncomplete: boolean;
}

/** Page-level states above the report. The copy is the established wording, moved verbatim from the page. */
export default function ReportsNotices(p: Props) {
  return (
    <>
      {p.scopeLoading && <ReportPanelSkeleton title="Loading your reports" />}
      {p.scopeError === "denied" && (
        <ReportNotice title="Reports" tone="denied" message="You don't have access to Reports."
          detail="Your role's report permissions don't allow viewing reports. Ask an admin if you need access." />
      )}
      {p.zoneRequired && (
        <ReportNotice title="Reports" tone="unavailable" message="The agency time zone must be configured before official Reports can be calculated."
          detail="An admin must choose and save the agency time zone in Settings → Company Branding. Report periods, day and hour buckets, the heatmap and exports are never calculated in a guessed time zone."
          onRetry={p.onRetryScope} />
      )}
      {p.scopeError !== null && p.scopeError !== "denied" && p.scopeError !== "configuration" && (
        <ReportNotice title="Reports" tone="error" message="Reports are temporarily unavailable."
          detail="Nothing is shown rather than numbers we can't stand behind." onRetry={p.onRetryScope} />
      )}
      {p.onDefaultScope && <button type="button" className="text-sm text-primary underline underline-offset-4" onClick={p.onDefaultScope}>Use default report scope</button>}
      {p.scopeDrift && (
        <ReportNotice title="Reports" tone="unavailable" message="Your report access changed while this page was open."
          detail="Reload to see reports for your current access." onRetry={p.onRetryScope} />
      )}
      {p.customRangeIncomplete && (
        <ReportNotice title="Custom range" tone="unavailable" message="Pick a start and end date to run the report." />
      )}
    </>
  );
}
