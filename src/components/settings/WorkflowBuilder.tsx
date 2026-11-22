import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { automationApi, useAutomationAccess } from "@/lib/automation-api";
import WorkflowList from "@/components/workflows/WorkflowList";
import LegacyWorkflow from "@/components/workflows/LegacyWorkflow";
import AutomationEditor from "@/components/workflows/AutomationEditor";
import { AutomationActivity } from "@/components/workflows/AutomationActivity";
import { canEditDraft } from "@/components/workflows/lib/draftGraph";
import { Button } from "@/components/ui/button";

interface Props { org: string; session: number; scope: string }

function Builder({org, session, scope}: Props) {
  const [params, setParams] = useSearchParams();
  const requested = params.get("workflow");
  const createdHere = useRef<string | null>(null);
  function open(id: string | null, replace = false) {
    const next = new URLSearchParams(params);
    if (id) next.set("workflow",id); else next.delete("workflow");
    setParams(next,{replace});
  }
  const local = requested === "new" || (requested !== null && requested === createdHere.current);
  const record = useQuery({
    queryKey:["automation-draft",scope,requested],
    queryFn: () => automationApi.load(requested!,org),
    enabled: !!requested && !local,
    staleTime: 0, retry: false,
  });
  if (!requested) return <WorkflowList org={org} session={session} scope={scope} campaign={params.get("campaign")}
    onCreate={() => { createdHere.current = null; open("new"); }} onOpenWorkflow={id => { createdHere.current = null; open(id); }}/>;
  if (!local && record.isError) return <p role="alert">Automation unavailable. <Button variant="link" onClick={() => open(null)}>Back to automations</Button></p>;
  if (!local && !record.data) return <p role="status">Loading automation…</p>;
  if (!local && record.data!.automation_graph === null) return <section className="space-y-4">
    <Button variant="outline" onClick={() => open(null)}>Back to automations</Button>
    <h1 className="text-xl font-semibold">{record.data!.name}</h1><LegacyWorkflow org={org} id={requested}/>
  </section>;
  if (!local && !canEditDraft(record.data!.automation_graph)) return <section className="space-y-4">
    <Button variant="outline" onClick={() => open(null)}>Back to automations</Button>
    <h1 className="text-xl font-semibold">{record.data!.name}</h1>
    <p>This graph contains an unsupported block, version or format. Its saved data is available for inspection.</p>
    <details><summary>Saved graph</summary><pre className="overflow-auto whitespace-pre-wrap break-all rounded border p-3">
      {JSON.stringify(record.data!.automation_graph,null,2)}</pre></details>
  </section>;
  return <AutomationEditor key={local ? "local" : requested} session={session} scope={scope}
    record={local ? undefined : record.data} onBack={() => { createdHere.current = null; open(null); }}
    onSaved={id => { if (requested === "new") { createdHere.current = id; open(id,true); } }}/>;
}

export default function WorkflowBuilder() {
  const {user, profile, isImpersonating, automationSignInRequired, automationSessionRevision: session} = useAuth();
  const access = useAutomationAccess();
  if (automationSignInRequired) return <p role="status">Sign in again to use Automations after the upgrade.</p>;
  if (access.isLoading) return <p role="status">Checking automation access…</p>;
  if (!access.data?.visible || session == null || !user || !profile?.organization_id)
    return <p role="status">Automations are unavailable for this session.</p>;
  if (isImpersonating || !access.data.can_author) return <AutomationActivity/>;
  const scope = [user.id,profile.organization_id,session].join("/");
  return <Builder key={scope} scope={scope} session={session} org={profile.organization_id}/>;
}
