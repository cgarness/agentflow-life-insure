import {
  type AutomationGraph,
  emptyGraph,
  previewGraph,
  validateGraph,
} from "./graph.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw Error(message);
}

function authoredGraph(): AutomationGraph {
  const g = emptyGraph();
  g.nodes.push(
    {
      id: "start",
      type: "lead_created",
      version: 1,
      config: { lead_source: "Web" },
    },
    { id: "condition", type: "contact_has_email", version: 1, config: {} },
    {
      id: "email",
      type: "send_email",
      version: 1,
      config: {
        sender_id: "095168bb-3341-43c8-81b4-654183cdacca",
        subject: "For {{first_name}}",
        body: "Hi {{first_name}}",
      },
    },
    {
      id: "sms",
      type: "send_sms",
      version: 1,
      config: { purpose: "informational", body: "Hello {{first_name}}" },
    },
  );
  g.edges.push({ id: "1", source: "start", target: "condition" }, {
    id: "2",
    source: "condition",
    target: "email",
    branch: "yes",
  }, { id: "3", source: "condition", target: "sms", branch: "no" });
  return g;
}

Deno.test("preview follows both condition exits and renders only the chosen channel", () => {
  const graph = authoredGraph();
  assert(validateGraph(graph).length === 0, "valid graph");
  const contact = {
    lead_source: "Web",
    first_name: "Sam",
    phone: "+12025550123",
  };
  const yes = previewGraph(graph, {
    ...contact,
    email: "sam@example.invalid",
    email_senders: {
      "095168bb-3341-43c8-81b4-654183cdacca": {
        from_email: "agency@example.invalid",
        reply_to: "reply@example.invalid",
      },
    },
  });
  assert(
    yes.map((s) => s.nodeId).join(",") === "start,condition,email",
    "email exit",
  );
  assert(
    yes[2].detail.includes(
      "agency@example.invalid · Reply to reply@example.invalid · For Sam · Hi Sam",
    ),
    "rendered email",
  );
  const no = previewGraph(graph, contact);
  assert(
    no.map((s) => s.nodeId).join(",") === "start,condition,sms" &&
      no[2].detail.includes("Hello Sam"),
    "SMS exit",
  );
  assert(
    previewGraph(graph, { ...contact, lookup_failed: true }).length === 2,
    "failed lookup holds",
  );
  assert(
    previewGraph(graph, { ...contact, lead_source: "Other" }).length === 1,
    "nonmatching filter",
  );
  assert(
    previewGraph(graph, { ...contact, trigger: "campaign_membership_created" })
      .length === 1,
    "nonmatching trigger",
  );
});

Deno.test("graphs validate config, version, tokens, exits and reachability independently of UI", () => {
  const graph = authoredGraph();
  graph.nodes[2].config.body = "{{unapproved}}";
  graph.nodes[3].version = 10;
  graph.edges.push({ id: "4", source: "email", target: "condition" });
  graph.nodes.push({
    id: "loose",
    type: "wait",
    version: 1,
    config: { duration: 0, unit: "hours" },
  });
  const issues = validateGraph(graph);
  for (
    const fragment of ["merge field", "version", "cycle", "duration", "Connect"]
  ) {
    assert(issues.some((i) => i.message.includes(fragment)), fragment);
  }
});

Deno.test("an empty canvas contains no materialized trigger, action or message", () => {
  const graph = emptyGraph();
  assert(
    graph.nodes.length === 0 && graph.edges.length === 0,
    "inert blank graph",
  );
  assert(
    validateGraph(graph).length === 2,
    "trigger and action required only at publish",
  );
});
