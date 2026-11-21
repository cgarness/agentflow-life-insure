import { describe, expect, it } from "vitest";
import { emptyGraph } from "../../../../supabase/functions/_shared/automations/graph";
import { insertStep, moveStep, newNode, orderedSteps, removeStep } from "../lib/draftGraph";

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
    expect(removeStep(graph,condition.id)).toBe(graph);
    expect(moveStep(graph,no.id,"up")).toBe(graph);
    expect(graph.edges.filter(e => e.source === condition.id).map(e => e.branch).sort()).toEqual(["no","yes"]);
  });
});
