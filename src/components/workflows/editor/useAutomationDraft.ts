import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { automationApi, type DraftRecord, type Issue, type Option, type SmsRequirement } from "@/lib/automation-api";
import { readReleaseControls, sameReleaseControls, type ReleaseControls } from "@/lib/automation-release";
import { emptyGraph, graphBlock, validateGraph, type AutomationGraph } from "../../../../supabase/functions/_shared/automations/graph";

const nameSchema = z.string().trim().max(100, "Use 100 characters or fewer.");
export type EditorMode = "edit" | "preview" | "review" | "activity";
export interface Notice { text: string; tone: "status" | "error" }
interface Input {
  record?: DraftRecord;
  session: number;
  scope: string;
  onSaved: (id: string) => void;
}

/**
 * The draft an author is working on and its three explicit steps: save the draft, save and review it,
 * publish a version. Nothing is written until the author asks for one of them.
 */
export function useAutomationDraft({record, session, scope, onSaved}: Input) {
  const [id] = useState(() => record?.id ?? crypto.randomUUID());
  const [revision, setRevision] = useState(record?.automation_revision ?? 0);
  const [name, setName] = useState(record?.automation_draft_name ?? record?.name ?? "");
  const [graph, setGraph] = useState<AutomationGraph>(() => record?.automation_graph ?? emptyGraph());
  const cache = useQueryClient();
  const statusKey = ["automation-status", scope, id];
  const live = useQuery({queryKey: statusKey, queryFn: () => automationApi.status(id), enabled: revision > 0,
    retry: false, refetchOnWindowFocus: "always"});
  const snapshot = live.isError ? null : live.data;
  const status = snapshot?.status;
  const [reviewed, setReviewed] = useState<ReleaseControls | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("edit");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [overlap, setOverlap] = useState<Option[]>([]);
  const [requirements, setRequirements] = useState<SmsRequirement[] | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const localIssues: Issue[] = validateGraph(graph).map(issue => ({node_id: issue.nodeId, message: issue.message}));
  // Saved problems stay visible. The open step also shows what is still missing as the author fills it in.
  const inlineIssues = [...issues];
  for (const issue of localIssues) {
    if (issue.node_id === selected && !inlineIssues.some(other => other.node_id === selected && other.message === issue.message)) {
      inlineIssues.push(issue);
    }
  }
  const readOnly = (revision > 0 && (!status || status === "archived")) || graph.format !== 1 || graph.nodes.some(node => !graphBlock(node));
  const revisionMatches = snapshot?.revision === revision;
  const reviewMatches = sameReleaseControls(reviewed, snapshot?.controls ?? null);

  function touch() { setDirty(true); setNotice(null); setPublished(false); setIssues([]); setMode("edit"); }
  function edit(next: AutomationGraph) {
    if (readOnly || pending.current) return;
    setGraph(next); touch();
  }
  function rename(next: string) {
    if (readOnly || pending.current) return;
    setName(next); touch();
  }
  function select(nodeId: string | null) { setSelected(nodeId); if (nodeId) setMode("edit"); }

  async function act(job: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice(null);
    try { await job(); }
    catch (error) {
      setNotice({tone: "error", text: error instanceof Error ? error.message : "Request failed. Reopen the draft to refresh its revision."});
    }
    finally { pending.current = false; setBusy(false); }
  }
  async function save() {
    const checked = nameSchema.safeParse(name);
    if (!checked.success) throw new Error(checked.error.issues[0].message);
    if (readOnly) throw new Error("This format is available for inspection.");
    if (!dirty && revision > 0) return;
    const saved = await automationApi.save(id, checked.data, graph, revision, session);
    if (!mounted.current) throw new Error("The editor session changed.");
    setRevision(saved.revision); setDirty(false); onSaved(id);
  }
  const saveDraft = () => act(async () => {
    await save();
    setIssues(await automationApi.validate(id));
    setNotice({tone: "status", text: "Draft saved."});
  });
  const review = () => act(async () => {
    if (localIssues.length) {
      setIssues(localIssues); setMode("edit");
      setNotice({tone: "error", text: "Resolve the highlighted steps before publishing."});
      return;
    }
    await save();
    const [errors, matches, latest, needs] = await Promise.all([
      automationApi.validate(id), automationApi.overlap(id), live.refetch(),
      // The consent each text will need is a review aid. A failed lookup shows as Unknown and never blocks the review.
      Promise.resolve().then(() => automationApi.smsRequirements(id)).catch(() => null),
    ]);
    setReviewed(latest.isSuccess ? latest.data.controls : null);
    setIssues(errors); setOverlap(matches); setRequirements(needs); setMode("review");
  });
  const canPublish = mode === "review" && !dirty && !issues.length && !readOnly && !!reviewed && reviewMatches && revisionMatches;
  const publish = () => act(async () => {
    if (!canPublish || !reviewed) return;
    try {
      const result = await automationApi.publish(id, revision, session, reviewed);
      const controls = readReleaseControls(result.release_controls);
      cache.setQueryData(statusKey, {id, status: result.status, revision: result.revision, trigger_type: result.trigger_type, controls});
      setRevision(result.revision); setMode("edit"); setPublished(true);
      void live.refetch();
    } catch (error) {
      setReviewed(null); await live.refetch(); throw error;
    }
  });
  const lifecycle = (operation: "pause" | "resume" | "archive") => act(async () => {
    await automationApi.lifecycle(id, operation, session);
    setRevision(current => current + 1);
    await live.refetch();
    setMode("edit"); setPublished(false);
    setNotice({tone: "status", text: "Automation updated."});
  });

  return {
    id, name, graph, revision, dirty, busy, mode, selected, notice, published, readOnly, status, snapshot,
    statusPending: live.isPending, issues, inlineIssues, localIssues, overlap, requirements, canPublish, revisionMatches, reviewMatches,
    edit, rename, select, setMode, saveDraft, review, publish, lifecycle, refreshStatus: () => { void live.refetch(); },
  };
}
export type AutomationDraft = ReturnType<typeof useAutomationDraft>;
