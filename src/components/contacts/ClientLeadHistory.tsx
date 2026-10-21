import type { LeadConversionHistory } from "@/lib/types";

/**
 * Read-only "Original lead" panel for a converted client: what the lead was when it became a client (source, status,
 * dates, who converted it) and any lead notes a conversion note replaced. Historical only — never the client's current
 * workflow state, never editable, and nothing renders for manual or historical clients without stored history.
 */
export function ClientLeadHistory({ history, resolveAgentName, formatDate }: {
  history: LeadConversionHistory | undefined;
  resolveAgentName: (agentId: string) => string;
  formatDate: (value: string) => string;
}) {
  if (!history) return null;
  const convertedBy = history.convertedBy ? resolveAgentName(history.convertedBy) || "Unknown user" : null;
  const rows: Array<[string, string | null]> = [
    ["Lead source", history.leadSource],
    ["Status at conversion", history.leadStatus],
    ["Lead created", history.leadCreatedAt ? formatDate(history.leadCreatedAt) : null],
    ["Converted", history.convertedAt ? formatDate(history.convertedAt) : null],
    ["Converted by", convertedBy],
  ];
  const shown = rows.filter((row): row is [string, string] => !!row[1]);

  return (
    <section aria-label="Original lead" className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Original lead</h3>
      {shown.length > 0 && (
        <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {shown.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[10px] text-muted-foreground leading-tight">{label}</dt>
              <dd className="truncate text-xs text-foreground" title={value}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {history.leadNotes && (
        <div className="mt-2">
          <p className="text-[10px] text-muted-foreground leading-tight">Original lead notes</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-foreground">{history.leadNotes}</p>
        </div>
      )}
      {history.hasPreservedCustomFields && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Some lead custom data could not be shown as client fields and is kept in this record&apos;s history.
        </p>
      )}
    </section>
  );
}
