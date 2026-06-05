import React, { useMemo } from "react";
import { ClipboardList } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TrackerDashboard from "@/components/control-center/tracker/TrackerDashboard";
import TrackerSystemsTab from "@/components/control-center/tracker/TrackerSystemsTab";
import TrackerItemsTab from "@/components/control-center/tracker/TrackerItemsTab";
import TrackerIssuesTab from "@/components/control-center/tracker/TrackerIssuesTab";
import TrackerMarketingRealityTab from "@/components/control-center/tracker/TrackerMarketingRealityTab";
import TrackerTechnicalTruthTab from "@/components/control-center/tracker/TrackerTechnicalTruthTab";
import {
  useTrackerClaims,
  useTrackerIssues,
  useTrackerItems,
  useTrackerReferences,
  useTrackerSystems,
} from "@/hooks/useControlCenterTracker";
import {
  deriveCompletionPercent,
  TRACKER_ISSUE_OPEN_STATUSES,
} from "@/lib/control-center/trackerTypes";

const TAB_TRIGGER_CLASS =
  "data-[state=active]:bg-slate-800 data-[state=active]:text-slate-50 text-slate-400";

const ControlCenterTrackerPage: React.FC = () => {
  const systemsQ = useTrackerSystems();
  const itemsQ = useTrackerItems();
  const issuesQ = useTrackerIssues();
  const claimsQ = useTrackerClaims();
  const refsQ = useTrackerReferences();

  const systems = systemsQ.data ?? [];
  const items = itemsQ.data ?? [];
  const issues = issuesQ.data ?? [];
  const claims = claimsQ.data ?? [];
  const references = refsQ.data ?? [];

  const isLoading =
    systemsQ.isLoading ||
    itemsQ.isLoading ||
    issuesQ.isLoading ||
    claimsQ.isLoading ||
    refsQ.isLoading;

  const error =
    systemsQ.error || itemsQ.error || issuesQ.error || claimsQ.error || refsQ.error;

  const systemNameById = useMemo(
    () => new Map(systems.map((s) => [s.id, s.name] as const)),
    [systems],
  );

  const completionBySystem = useMemo(() => {
    const itemsBySystem = new Map<string, typeof items>();
    for (const item of items) {
      const list = itemsBySystem.get(item.system_id) ?? [];
      list.push(item);
      itemsBySystem.set(item.system_id, list);
    }
    const out = new Map<string, number>();
    for (const s of systems) {
      out.set(s.id, deriveCompletionPercent(itemsBySystem.get(s.id) ?? []));
    }
    return out;
  }, [systems, items]);

  const openIssuesBySystem = useMemo(() => {
    const out = new Map<string, number>();
    for (const i of issues) {
      if (!i.system_id) continue;
      if (!TRACKER_ISSUE_OPEN_STATUSES.includes(i.status)) continue;
      out.set(i.system_id, (out.get(i.system_id) ?? 0) + 1);
    }
    return out;
  }, [issues]);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-slate-800 flex items-center justify-center text-slate-200">
          <ClipboardList className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Tracker</h1>
          <p className="text-sm text-slate-400">
            Launch-readiness command center for AgentFlow — systems, items, issues, and marketing
            reality.
          </p>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-800 bg-rose-950/30 p-6 text-sm text-rose-200">
          Failed to load tracker data: {error instanceof Error ? error.message : "Unknown error"}.
          Try refreshing.
        </div>
      ) : isLoading ? (
        <div className="text-sm text-slate-500">Loading tracker…</div>
      ) : (
        <Tabs defaultValue="dashboard" className="space-y-2">
          <TabsList className="bg-slate-900 w-full justify-start overflow-x-auto h-auto flex-nowrap">
            <TabsTrigger value="dashboard" className={TAB_TRIGGER_CLASS}>
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="systems" className={TAB_TRIGGER_CLASS}>
              Systems
            </TabsTrigger>
            <TabsTrigger value="items" className={TAB_TRIGGER_CLASS}>
              Items
            </TabsTrigger>
            <TabsTrigger value="issues" className={TAB_TRIGGER_CLASS}>
              Issues
            </TabsTrigger>
            <TabsTrigger value="marketing" className={TAB_TRIGGER_CLASS}>
              Marketing Reality
            </TabsTrigger>
            <TabsTrigger value="technical" className={TAB_TRIGGER_CLASS}>
              Technical Truth
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            <TrackerDashboard systems={systems} items={items} issues={issues} claims={claims} />
          </TabsContent>
          <TabsContent value="systems">
            <TrackerSystemsTab
              systems={systems}
              items={items}
              completionBySystem={completionBySystem}
              openIssuesBySystem={openIssuesBySystem}
            />
          </TabsContent>
          <TabsContent value="items">
            <TrackerItemsTab systems={systems} items={items} systemNameById={systemNameById} />
          </TabsContent>
          <TabsContent value="issues">
            <TrackerIssuesTab
              systems={systems}
              items={items}
              issues={issues}
              systemNameById={systemNameById}
            />
          </TabsContent>
          <TabsContent value="marketing">
            <TrackerMarketingRealityTab systems={systems} claims={claims} />
          </TabsContent>
          <TabsContent value="technical">
            <TrackerTechnicalTruthTab
              systems={systems}
              items={items}
              issues={issues}
              claims={claims}
              references={references}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};

export default ControlCenterTrackerPage;
