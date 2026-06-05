import React, { useState } from "react";
import { Copy, Check, FileText, ExternalLink, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/control-center/EmptyState";
import {
  TRACKER_REFERENCE_KIND_LABELS,
  type TrackerIssue,
  type TrackerItem,
  type TrackerMarketingClaim,
  type TrackerReference,
  type TrackerSystem,
} from "@/lib/control-center/trackerTypes";
import { buildTrackerContextSnapshot } from "@/lib/control-center/trackerContextSnapshot";

interface Props {
  systems: TrackerSystem[];
  items: TrackerItem[];
  issues: TrackerIssue[];
  claims: TrackerMarketingClaim[];
  references: TrackerReference[];
}

function isExternal(value: string | null): boolean {
  return !!value && /^https?:\/\//i.test(value);
}

const TrackerTechnicalTruthTab: React.FC<Props> = ({
  systems,
  items,
  issues,
  claims,
  references,
}) => {
  const [copied, setCopied] = useState(false);

  const copyContext = async () => {
    const snapshot = buildTrackerContextSnapshot({ systems, items, issues, claims });
    try {
      await navigator.clipboard.writeText(snapshot);
      setCopied(true);
      toast.success("Context copied — paste into Claude / Cursor");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Clipboard unavailable. Select and copy manually.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-800/60 bg-amber-950/20 p-4 flex items-start gap-3">
        <Lock className="h-5 w-5 text-amber-300 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-sm font-semibold text-amber-100">Internal — sensitive architecture</h2>
          <p className="text-sm text-amber-200/80 mt-0.5">
            Platform-admin only. Do not share these invariants, references, or the exported context
            outside the AgentFlow core team.
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Architectural source of truth</h2>
            <p className="text-sm text-slate-400 mt-0.5">
              The authoritative invariants, schema gotchas, and dialer/telephony rules live in{" "}
              <code className="text-slate-300">AGENT_RULES.md</code> in the repository — not in this
              database. This tab is read-only by design.
            </p>
          </div>
          <Button
            onClick={copyContext}
            className="bg-indigo-600 hover:bg-indigo-500 text-white shrink-0"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 mr-1.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-1.5" />
                Copy context for Claude / Cursor
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          The export is a plain-text snapshot of current systems + statuses, open launch blockers,
          and marketing-reality warnings (derived live from the data on the other tabs).
        </p>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3">
          References
        </h2>
        {references.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-8 w-8" />}
            title="No references yet"
            description="Docs, migrations, RPCs, edge functions, and deploys linked to systems/items will appear here."
          />
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 divide-y divide-slate-800">
            {references.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-slate-800 rounded px-1.5 py-0.5">
                      {TRACKER_REFERENCE_KIND_LABELS[r.kind]}
                    </span>
                    <span className="text-sm font-medium text-slate-200 truncate">{r.label}</span>
                  </div>
                  {r.url_or_path && (
                    <div className="text-xs text-slate-500 font-mono mt-1 break-all">
                      {r.url_or_path}
                    </div>
                  )}
                  {r.notes && <p className="text-xs text-slate-400 mt-1">{r.notes}</p>}
                </div>
                {isExternal(r.url_or_path) && (
                  <a
                    href={r.url_or_path as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-slate-100 shrink-0"
                    aria-label={`Open ${r.label}`}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default TrackerTechnicalTruthTab;
