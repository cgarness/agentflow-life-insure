import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WorkflowStatus } from "@/lib/workflow-types";
import { workflowEffects, type ReleaseControls } from "@/lib/automation-release";
import { switchBadge } from "./list/statusBadges";

interface Props {
  controls: ReleaseControls | null;
  status?: WorkflowStatus;
  trigger: string | null;
  review?: boolean;
  published?: boolean;
  onRefresh?: () => void;
}

/** The agency's two switches as they are now, and what they mean for this workflow. A failed lookup reads Unknown. */
export default function AutomationReleaseStatus({controls, status, trigger, review, published, onRefresh}: Props) {
  const title = review ? "Publish review controls" : "Workflow status";
  const switches = [
    {label: "Enrollment", badge: switchBadge(controls?.enrollment_enabled)},
    {label: "Message delivery", badge: switchBadge(controls?.dispatch_enabled)},
  ];
  return <section aria-label={title} className="space-y-2 rounded-lg border bg-card p-3 text-sm text-card-foreground">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">{review ? "After publishing" : title}</h3>
      {onRefresh && <Button type="button" size="sm" variant="ghost" className="h-11 md:h-9" onClick={onRefresh}>Refresh status</Button>}
    </div>
    {published && <p role="status" className="font-medium">Version published.</p>}
    <div className="flex flex-wrap gap-x-5 gap-y-1.5">
      {switches.map(item => <div key={item.label} className="flex items-center gap-1.5">
        {item.label}: <Badge variant={item.badge.tone}>{item.badge.label}</Badge>
      </div>)}
    </div>
    <p className="text-muted-foreground">{status ? workflowEffects(status, trigger, controls) : "Current workflow status could not be confirmed."}</p>
  </section>;
}
