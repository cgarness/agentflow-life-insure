import { Button } from "@/components/ui/button";
import type { WorkflowStatus } from "@/lib/workflow-types";
import { workflowEffects, type ReleaseControls } from "@/lib/automation-release";

interface Props {
  controls: ReleaseControls | null;
  status?: WorkflowStatus;
  trigger: string | null;
  review?: boolean;
  published?: boolean;
  onRefresh?: () => void;
}

export default function AutomationReleaseStatus({controls,status,trigger,review,published,onRefresh}: Props) {
  const title = review ? "Publish review controls" : "Workflow status";
  const switchLabel = (enabled?: boolean) => enabled == null ? "Unavailable" : enabled ? "On" : "Off";
  return <section aria-label={title} className="space-y-2 rounded-lg border bg-card p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">{review ? "After publishing" : title}</h3>
      {onRefresh && <Button size="sm" variant="ghost" onClick={onRefresh}>Refresh status</Button>}
    </div>
    {published && <p role="status">Version published.</p>}
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <span>Agency enrollment: {switchLabel(controls?.enrollment_enabled)}</span>
      <span>Provider dispatch: {switchLabel(controls?.dispatch_enabled)}</span>
    </div>
    <p>{status ? workflowEffects(status,trigger,controls) : "Current workflow status could not be confirmed."}</p>
  </section>;
}
