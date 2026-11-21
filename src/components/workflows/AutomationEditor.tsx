import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { automationApi, type DraftRecord, type Option, type Issue } from "@/lib/automation-api";
import { emptyGraph, graphBlock, validateGraph, type AutomationGraph } from "../../../supabase/functions/_shared/automations/graph";
import WorkflowCanvas from "./WorkflowCanvas";
import OrderedWorkflowSteps from "./OrderedWorkflowSteps";
import AutomationBlockPanel, { selectStyle } from "./AutomationBlockPanel";
import AutomationReview from "./AutomationReview";
import { AutomationActivity } from "./AutomationActivity";
import { insertStep, newNode } from "./lib/draftGraph";

const nameSchema = z.string().trim().max(100, "Use 100 characters or fewer.");
type Mode = "edit" | "preview" | "review" | "activity";
interface Props {
  record?: DraftRecord;
  session: number;
  scope: string;
  onBack: () => void;
  onSaved: (id: string) => void;
}

export default function AutomationEditor({record, session, scope, onBack, onSaved}: Props) {
  const [id] = useState(() => record?.id ?? crypto.randomUUID());
  const [revision, setRevision] = useState(record?.automation_revision ?? 0);
  const [name, setName] = useState(record?.automation_draft_name ?? record?.name ?? "");
  const [graph, setGraph] = useState<AutomationGraph>(() => record?.automation_graph ?? emptyGraph());
  const [status, setStatus] = useState(record?.status ?? "draft");
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("edit");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [overlap, setOverlap] = useState<Option[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [dirty, setDirty] = useState(false);
  const node = graph.nodes.find(n => n.id === selected);
  const localIssues = validateGraph(graph).map(i => ({node_id: i.nodeId, message: i.message}));
  const inlineIssues = [...issues];
  for (const issue of localIssues) {
    if (issue.node_id === selected && !inlineIssues.some(other => other.node_id === selected && other.message === issue.message)) {
      inlineIssues.push(issue);
    }
  }
  const readOnly = status === "archived" || graph.format !== 1 || graph.nodes.some(n => !graphBlock(n));
  const edit = (next: AutomationGraph) => {
    if (readOnly || pending.current) return;
    setGraph(next); setDirty(true); setNotice(""); setIssues([]); setMode("edit");
  };
  const select = (nodeId: string) => { setSelected(nodeId); setMode("edit"); };
  async function act(job: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice("");
    try { await job(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Request failed. Reopen the draft to refresh its revision."); }
    finally { pending.current = false; setBusy(false); }
  }
  async function save() {
    const checked = nameSchema.safeParse(name);
    if (!checked.success) throw new Error(checked.error.issues[0].message);
    if (readOnly) throw new Error("This format is available for inspection.");
    if (!dirty && revision > 0) return revision;
    const saved = await automationApi.save(id, checked.data, graph, revision, session);
    if (!mounted.current) throw new Error("The editor session changed.");
    setRevision(saved.revision); setDirty(false); onSaved(id);
    return saved.revision;
  }
  const review = () => act(async () => {
    if (localIssues.length) { setIssues(localIssues); setMode("edit"); setNotice("Resolve the highlighted blocks before publishing."); return; }
    await save();
    const [errors, matches] = await Promise.all([automationApi.validate(id), automationApi.overlap(id)]);
    setIssues(errors); setOverlap(matches); setMode("review");
  });
  const publish = () => act(async () => {
    if (dirty || mode !== "review" || issues.length || readOnly) return;
    const result = await automationApi.publish(id,revision,session);
    setRevision(result.revision); setStatus(status === "paused" ? "paused" : "active");
    setNotice(status === "paused" ? "Published. This automation is paused." : "Published. New qualifying events can enter this version."); setMode("edit");
  });
  const lifecycle = (op: "pause" | "resume" | "archive") => act(async () => {
    if (op === "archive" && !window.confirm("Archive this automation and cancel its future steps?")) return;
    await automationApi.lifecycle(id,op,session);
    setRevision(current => current + 1);
    setStatus(op === "archive" ? "archived" : op === "pause" ? "paused" : "active");
    setMode("edit"); setNotice("Automation updated.");
  });
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={busy} onClick={onBack}>Back to automations</Button>
      <span className="rounded-full bg-muted px-3 py-1 text-xs capitalize">{revision === 0 ? "Unsaved" : status}</span>
      {dirty && revision > 0 && <span className="text-xs">Unsaved draft changes</span>}
    </div>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <label className="block text-sm font-medium">Automation name<Input value={name} disabled={readOnly} maxLength={100}
        onChange={e => { setName(e.target.value); setDirty(true); setMode("edit"); }}/></label>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setMode("edit")}>Edit draft</Button>
        <Button variant="outline" onClick={() => setMode("preview")}>Preview</Button>
        {!readOnly && <><Button variant="outline" onClick={() => act(async () => {
          await save();
          const errors = await automationApi.validate(id);
          setIssues(errors); setNotice("Draft saved.");
        })}>Save draft</Button><Button onClick={review}>Review &amp; publish</Button></>}
        {revision > 0 && <Button variant="outline" onClick={() => setMode("activity")}>Activity</Button>}
        {status === "active" && <Button variant="outline" onClick={() => lifecycle("pause")}>Pause</Button>}
        {status === "paused" && <Button variant="outline" onClick={() => lifecycle("resume")}>Resume</Button>}
        {revision > 0 && status !== "archived" && <Button variant="ghost" onClick={() => lifecycle("archive")}>Archive</Button>}
      </div>
      {notice && <p role="status" className="rounded-lg border p-3 text-sm">{notice}</p>}
      {mode === "activity" && <AutomationActivity workflowId={id}/>}
      {mode === "edit" && <fieldset disabled={readOnly} className="space-y-4">
        {readOnly && <p>This saved graph is read-only.</p>}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <div className="min-w-0 space-y-3">
            {!!graph.nodes.length && <WorkflowCanvas graph={graph} onSelect={select} selected={selected} onInsert={(parent, branch, type) => {
              const step = newNode(type); edit(insertStep(graph,parent,branch,step)); select(step.id);
            }}/>}
            <OrderedWorkflowSteps graph={graph} onChange={edit} onSelect={select} selected={selected} issues={inlineIssues}/>
          </div>
          {node && <AutomationBlockPanel node={node} scope={scope} onChange={updated => edit({
            ...graph, nodes: graph.nodes.map(n => n.id === updated.id ? updated : n),
          })}/>}
        </div>
        {issues.filter(i => !i.node_id).map((issue,i) => <p key={i} className="text-red-700 dark:text-red-300">{issue.message}</p>)}
        <div className="flex flex-wrap items-center gap-4 rounded-lg border p-4 text-sm">
          <label>Re-entry<select className={selectStyle} value={graph.settings.reentry} onChange={e => edit({...graph,
            settings:{...graph.settings,reentry:e.target.value as AutomationGraph["settings"]["reentry"]}})}>
            <option value="once">Once per contact</option><option value="after_completion">New event after completion</option>
          </select></label>
          <label><input type="checkbox" checked={graph.settings.stop_on_reply} onChange={e => edit({...graph,
            settings:{...graph.settings,stop_on_reply:e.target.checked}})}/> Stop on reply</label>
        </div>
      </fieldset>}
      {(mode === "preview" || mode === "review") && <AutomationReview graph={graph} scope={scope} mode={mode} overlaps={overlap}
        issues={mode === "review" ? issues : localIssues} onFix={select}/>}
      {mode === "review" && <Button disabled={!!issues.length || dirty || readOnly} onClick={publish}>Publish</Button>}
    </fieldset>
  </section>;
}
