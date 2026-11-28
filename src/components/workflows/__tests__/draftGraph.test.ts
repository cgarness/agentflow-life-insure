import { describe, expect, it } from "vitest";
import { emptyGraph, type AutomationGraph } from "../../../../supabase/functions/_shared/automations/graph";
import { canEditDraft, insertStep, moveStep, newNode, orderedSteps, removeStep, replaceStep } from "../lib/draftGraph";

const uuid = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12,"0");

describe("editing a stable versioned graph", () => {
  it("starts empty and preserves both stable action IDs through reorder and remove", () => {
    const blank = emptyGraph();
    expect(blank.nodes).toEqual([]);
    const trigger = newNode("lead_created"), sms = newNode("send_sms"), email = newNode("send_email");
    let graph = {...blank, nodes: [trigger]};
    graph = insertStep(graph,trigger.id,undefined,sms);
    graph = insertStep(graph,sms.id,undefined,email);
    const ids = graph.edges.map(e => e.id);
    graph = moveStep(graph,email.id,"up");
    expect(orderedSteps(graph).map(s => s.node.id)).toEqual([trigger.id,email.id,sms.id]);
    expect(graph.edges.map(e => e.id)).toEqual(ids);
    graph = removeStep(graph,email.id);
    expect(graph.nodes.map(n => n.id)).toEqual([trigger.id,sms.id]);
    expect(graph.edges).toEqual([{id:ids[0],source:trigger.id,target:sms.id}]);
    expect(blank.nodes).toEqual([]);
  });

  it("inserts on a branch, labels its ordered path and keeps the other branch intact", () => {
    const start = newNode("campaign_membership_created"), condition = newNode("contact_has_email");
    const yes = newNode("send_email"), no = newNode("send_sms"), wait = newNode("wait");
    let graph = {...emptyGraph(), nodes:[start]};
    graph = insertStep(graph,start.id,undefined,condition);
    graph = insertStep(graph,condition.id,"yes",yes);
    graph = insertStep(graph,condition.id,"no",no);
    graph = insertStep(graph,condition.id,"yes",wait);
    expect(orderedSteps(graph).map(s => [s.node.id,s.path])).toEqual([
      [start.id,""],[condition.id,""],[wait.id,"Yes"],[yes.id,"Yes"],[no.id,"No"],
    ]);
    expect(orderedSteps(graph).map(s => s.depth)).toEqual([0,0,1,1,1]);
    expect(removeStep(graph,condition.id)).toBe(graph);
    expect(moveStep(graph,no.id,"up")).toBe(graph);
    expect(graph.edges.filter(e => e.source === condition.id).map(e => e.branch).sort()).toEqual(["no","yes"]);
  });

  it("creates the newest version of a block", () => {
    expect(newNode("send_sms")).toMatchObject({type:"send_sms",version:2,config:{}});
    expect(newNode("send_sms")).not.toHaveProperty("meta");
  });
});

describe("the strict draft envelope", () => {
  const original = (): AutomationGraph => ({format:1, nodes:[
    {id:uuid(1),type:"lead_created",version:1,config:{}},
    {id:uuid(2),type:"send_sms",version:1,config:{body:"Hello",purpose:"informational"}},
    {id:uuid(3),type:"wait",version:1,config:{duration:5,unit:"minutes"}},
  ], edges:[{id:uuid(10),source:uuid(1),target:uuid(2)},{id:uuid(11),source:uuid(2),target:uuid(3),branch:null}],
  settings:{reentry:"once",stop_on_reply:false}});

  const current = (): AutomationGraph => ({format:1, nodes:[
    {id:uuid(1),type:"appointment_booked",version:1,config:{},meta:{name:"New booking",description:"Starts the reminder run."}},
    {id:uuid(2),type:"wait_until_before_appointment",version:1,config:{amount:1,unit:"days",late:"skip"},meta:{}},
    {id:uuid(3),type:"send_sms",version:2,config:{body:"See you {{appointment_date}}"},meta:{name:"Day-before text"}},
    {id:uuid(4),type:"create_task",version:1,config:{title:"Confirm",task_type:"Follow Up",due_amount:0,due_unit:"minutes"}},
  ], edges:[{id:uuid(10),source:uuid(1),target:uuid(2)},{id:uuid(11),source:uuid(2),target:uuid(3)},{id:uuid(12),source:uuid(3),target:uuid(4)}],
  settings:{reentry:"after_end",stop_on_reply:true,stop_on_booking:true,stop_on_contact:false}});

  it("round-trips a graph saved before step details and the newer settings existed", () => {
    const saved = original();
    const wire = JSON.parse(JSON.stringify(saved));
    expect(canEditDraft(wire)).toBe(true);
    const moved = moveStep(wire,uuid(3),"up");
    expect(orderedSteps(moved).map(s => s.node.type)).toEqual(["lead_created","wait","send_sms"]);
    // Editing an older graph adds none of the newer keys, so earlier clients can still open it.
    expect(JSON.parse(JSON.stringify(moveStep(moved,uuid(3),"down")))).toEqual(JSON.parse(JSON.stringify(saved)));
    expect(moved.nodes.some(node => "meta" in node)).toBe(false);
    expect(Object.keys(moved.settings).sort()).toEqual(["reentry","stop_on_reply"]);
  });

  it("round-trips step details, the newer blocks and every run setting", () => {
    const saved = current();
    const wire = JSON.parse(JSON.stringify(saved));
    expect(canEditDraft(wire)).toBe(true);
    expect(wire).toEqual(saved);
    expect(canEditDraft({...saved,settings:{reentry:"after_completion",stop_on_reply:false}})).toBe(true);
  });

  it.each([
    ["an unknown graph key", (g: Record<string,unknown>) => ({...g,layout:{}})],
    ["an unknown step key", (g: AutomationGraph) => ({...g,nodes:[{...g.nodes[0],label:"x"},...g.nodes.slice(1)]})],
    ["an unknown step detail", (g: AutomationGraph) => ({...g,nodes:[{...g.nodes[0],meta:{name:"x",color:"red"}},...g.nodes.slice(1)]})],
    ["a step name that is not text", (g: AutomationGraph) => ({...g,nodes:[{...g.nodes[0],meta:{name:7}},...g.nodes.slice(1)]})],
    ["step details that are not an object", (g: AutomationGraph) => ({...g,nodes:[{...g.nodes[0],meta:null},...g.nodes.slice(1)]})],
    ["an unknown edge key", (g: AutomationGraph) => ({...g,edges:[{...g.edges[0],label:"x"},...g.edges.slice(1)]})],
    ["an unknown setting", (g: AutomationGraph) => ({...g,settings:{...g.settings,stop_on_sale:true}})],
    ["a run setting that is not on or off", (g: AutomationGraph) => ({...g,settings:{...g.settings,stop_on_booking:"yes"}})],
    ["an unknown re-entry rule", (g: AutomationGraph) => ({...g,settings:{...g.settings,reentry:"always"}})],
    ["an unknown block", (g: AutomationGraph) => ({...g,nodes:[...g.nodes,{id:uuid(9),type:"send_fax",version:1,config:{}}]})],
    ["an unknown block version", (g: AutomationGraph) => ({...g,nodes:[...g.nodes,{id:uuid(9),type:"wait",version:9,config:{}}]})],
    ["a newer format", (g: AutomationGraph) => ({...g,format:2})],
  ])("keeps a graph with %s for inspection only", (_, change) => {
    expect(canEditDraft(change(current() as never))).toBe(false);
  });
});

describe("step details through edits", () => {
  it("keeps names, descriptions and ids when steps are inserted, reordered and removed", () => {
    const trigger = {...newNode("lead_created"), meta:{name:"Web leads"}};
    const sms = {...newNode("send_sms"), config:{body:"Hi"}, meta:{name:"Day one text",description:"Sent right away."}};
    const wait = {...newNode("wait"), config:{duration:5,unit:"minutes"}};
    const task = {...newNode("create_task"), meta:{description:"Owner follows up."}};
    let graph: AutomationGraph = {...emptyGraph(), nodes:[trigger]};
    graph = insertStep(graph,trigger.id,undefined,sms);
    graph = insertStep(graph,sms.id,undefined,wait);
    graph = insertStep(graph,wait.id,undefined,task);
    expect(graph.nodes).toEqual([trigger,sms,wait,task]);

    const moved = moveStep(graph,sms.id,"down");
    expect(orderedSteps(moved).map(s => s.node.id)).toEqual([trigger.id,wait.id,sms.id,task.id]);
    // A reorder rewrites edges only: every step object, with its details, is the one the author edited.
    expect(moved.nodes).toBe(graph.nodes);
    expect(orderedSteps(moved).map(s => s.node.meta)).toEqual([trigger.meta,undefined,sms.meta,task.meta]);
    expect(moveStep(moved,sms.id,"up").edges).toEqual(graph.edges);
    // The trigger is never a reorder neighbour.
    expect(moveStep(graph,sms.id,"up")).toBe(graph);

    const removed = removeStep(moved,wait.id);
    expect(removed.nodes).toEqual([trigger,sms,task]);
    expect(orderedSteps(removed).map(s => s.node.id)).toEqual([trigger.id,sms.id,task.id]);
  });

  it("replaces one step in place without touching its id, its neighbours or the edges", () => {
    const trigger = newNode("lead_created"), sms = {...newNode("send_sms"), meta:{name:"First text"}};
    const graph = insertStep({...emptyGraph(), nodes:[trigger]},trigger.id,undefined,sms);
    const edited = replaceStep(graph,{...sms,config:{body:"Hello"},meta:{name:"Welcome text"}});
    expect(edited.nodes[0]).toBe(trigger);
    expect(edited.nodes[1]).toEqual({...sms,config:{body:"Hello"},meta:{name:"Welcome text"}});
    expect(edited.edges).toBe(graph.edges);
    expect(graph.nodes[1].meta).toEqual({name:"First text"});
  });
});
