import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { readReleaseControls, workflowEffects } from "@/lib/automation-release";
import { Plus, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { automationApi } from "@/lib/automation-api";
import { workflowFolderApi } from "@/lib/supabase-workflow-folders";
import WorkflowFolderTabs, { ALL_TAB, UNFILED_TAB } from "./WorkflowFolderTabs";
import { selectStyle } from "./AutomationBlockPanel";
import { block } from "./lib/draftGraph";

interface Props {
  org: string;
  session: number;
  scope: string;
  campaign: string | null;
  onCreate: () => void;
  onOpenWorkflow: (id: string) => void;
}

export default function WorkflowList({org, session, scope, campaign, onCreate, onOpenWorkflow}: Props) {
  const [folder, setFolder] = useState(ALL_TAB);
  const [error, setError] = useState("");
  const folders = useQuery({queryKey: ["automation-folders", scope], queryFn: () => workflowFolderApi.list(org)});
  const list = useInfiniteQuery({
    queryKey: ["automations", scope, campaign],
    initialPageParam: 0,
    queryFn: ({pageParam}) => automationApi.list(pageParam, campaign),
    getNextPageParam: (last, all) => last.length === 50 ? all.length * 50 : undefined,
  });
  if (list.isLoading) return <p role="status">Loading automations…</p>;
  if (list.isError) return <p role="alert">Automations could not be loaded. <Button variant="link" onClick={() => list.refetch()}>Retry</Button></p>;
  const rows = list.data?.pages.flat() ?? [];
  const filtered = rows.filter(row => folder === ALL_TAB || (folder === UNFILED_TAB ? !row.folder_id : row.folder_id === folder));
  const create = <Button onClick={onCreate}><Plus className="mr-2 h-4 w-4"/>Create automation</Button>;
  async function move(id: string, folderId: string) {
    try {
      await automationApi.folder("move",folderId || null,{workflow_id:id},session);
      await list.refetch(); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to move automation."); }
  }
  return <section className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">Automations</h1>{!!rows.length && create}
    </header>
    {!!(rows.length || folders.data?.length) && <WorkflowFolderTabs session={session} folders={folders.data ?? []} workflows={rows}
      activeFolderId={folder} onActiveChange={setFolder} onFoldersChanged={() => { folders.refetch(); list.refetch(); }}/>}
    {error && <p role="alert">{error}</p>}
    {filtered.length === 0 && <div className="grid justify-items-center gap-3 rounded-xl border border-dashed p-10 text-center">
      <Workflow aria-hidden className="h-7 w-7 text-muted-foreground"/>
      <p>{rows.length ? "No automations in this folder." : campaign ? "No automations for this campaign." : "Your agency has no automations yet."}</p>
      {!rows.length && create}
    </div>}
    <ul className="space-y-2">{filtered.map(row =>
      <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4" key={row.id}>
        <div><button className="text-left font-semibold hover:underline" onClick={() => onOpenWorkflow(row.id)}>{row.name}</button>
          <p className="text-sm text-muted-foreground">{block(row.trigger_type ?? "")?.label ?? row.trigger_type?.replace(/_/g," ") ?? "Choose trigger"} · {row.status}</p>
          {!row.is_legacy && <p className="text-sm">{workflowEffects(row.status,row.trigger_type,readReleaseControls(row.release_controls))}</p>}
          <p className="text-xs text-muted-foreground">{row.last_activity_at ? "Last activity " + new Date(row.last_activity_at).toLocaleString() : "No activity yet"}</p>
        </div>
        {!!folders.data?.length && <label className="text-xs">Folder<select className={selectStyle} value={row.folder_id ?? ""}
          onChange={e => move(row.id,e.target.value)}><option value="">Unfiled</option>
          {folders.data.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select></label>}
      </li>)}</ul>
    {list.hasNextPage && <Button disabled={list.isFetchingNextPage} variant="outline" onClick={() => list.fetchNextPage()}>Load more</Button>}
  </section>;
}
