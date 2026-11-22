import {
  type AutomationGraph,
  availableBlocks,
  emptyGraph,
  previewGraph,
  stepSummary,
  stepTitle,
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
    const fragment of ["can't fill", "version", "cycle", "duration", "Connect"]
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

function taskGraph(trigger: string, triggerConfig: Record<string, unknown> = {}): AutomationGraph {
  const g = emptyGraph();
  g.nodes.push(
    { id: "start", type: trigger, version: 1, config: triggerConfig },
    {
      id: "task",
      type: "create_task",
      version: 1,
      config: { title: "Call {{first_name}}", task_type: "Follow Up", due_amount: 5, due_unit: "minutes" },
    },
  );
  g.edges.push({ id: "1", source: "start", target: "task" });
  return g;
}

Deno.test("step names and descriptions are optional bounded notes outside execution config", () => {
  const graph = taskGraph("lead_created");
  assert(validateGraph(graph).length === 0, "steps without details stay valid");
  graph.nodes[1].meta = { name: "Call the new lead", description: "Owner should call inside five minutes." };
  assert(validateGraph(graph).length === 0, "named step is valid");
  assert(stepTitle(graph.nodes[1]) === "Call the new lead", "custom name becomes the title");
  assert(
    stepSummary(graph.nodes[1]) === "Create task for assigned agent · Call {{first_name}} · due in 5 minutes",
    "block type and configured value stay identifiable under a custom name",
  );
  assert(!("name" in graph.nodes[1].config) && !("description" in graph.nodes[1].config), "details are not config");
  graph.nodes[1].meta = { name: "x".repeat(81) };
  assert(validateGraph(graph).some((i) => i.nodeId === "task" && i.message.includes("Step name")), "long name");
  graph.nodes[1].meta = { description: "y".repeat(501) };
  assert(validateGraph(graph).some((i) => i.message.includes("Description")), "long description");
  graph.nodes[1].meta = { name: "Line\nbreak" };
  assert(validateGraph(graph).some((i) => i.message.includes("Step name")), "name is a single line");
  graph.nodes[1].meta = { name: "ok", label: "x" } as unknown as { name: string };
  assert(validateGraph(graph).some((i) => i.message.includes("Step details")), "unknown detail keys are refused");
});

Deno.test("cards read their configuration without opening the step", () => {
  const wait = { id: "w", type: "wait", version: 1, config: { duration: 5, unit: "minutes" } };
  assert(stepTitle(wait) === "Wait 5 minutes" && stepSummary(wait) === "", "wait title carries the delay");
  assert(stepTitle({ ...wait, config: { duration: 1, unit: "hours" } }) === "Wait 1 hour", "singular unit");
  const campaign = {
    id: "c", type: "campaign_membership_created", version: 1,
    config: { campaign_id: "095168bb-3341-43c8-81b4-654183cdacca" },
  };
  assert(
    stepSummary(campaign, { campaign: () => "Final Expense Q4" }) === "Final Expense Q4",
    "selected campaign name",
  );
  assert(stepSummary(campaign) === "Selected campaign", "neutral wording while the name is loading");
  const sms = { id: "s", type: "send_sms", version: 2, config: { body: "Hi {{first_name}}" }, meta: { name: "Day one text" } };
  assert(stepTitle(sms) === "Day one text" && stepSummary(sms) === "Send SMS · Hi {{first_name}}", "named SMS step");
  const dispositions = {
    id: "d", type: "disposition_recorded", version: 1,
    config: { disposition_ids: ["a", "b", "c"] },
  };
  assert(
    stepSummary(dispositions, { disposition: (id) => ({ a: "No Answer", b: "Voicemail" } as Record<string, string>)[id] }) ===
      "No Answer, Voicemail +1 more",
    "disposition names",
  );
  const before = { id: "b", type: "wait_until_before_appointment", version: 1, config: { amount: 1, unit: "days" } };
  assert(stepSummary(before) === "1 day before the appointment", "appointment wait summary");
});

Deno.test("only choices valid at the insertion point are offered and enforced", () => {
  assert(availableBlocks(emptyGraph()).every((b) => b.category === "trigger"), "blank canvas offers triggers");
  assert(
    !availableBlocks(emptyGraph()).some((b) => b.type === "send_sms" && b.version === 1),
    "the picker offers only the latest version of a block",
  );
  const lead = availableBlocks(taskGraph("lead_created")).map((b) => b.type);
  assert(lead.includes("send_sms") && lead.includes("create_task") && lead.includes("wait"), "lead steps");
  assert(!lead.includes("wait_until_before_appointment"), "appointment wait needs an appointment trigger");
  const booked = availableBlocks(taskGraph("appointment_booked")).map((b) => b.type);
  assert(booked.includes("wait_until_before_appointment") && booked.includes("send_email"), "appointment steps");
  const sale = availableBlocks(taskGraph("sale_recorded")).map((b) => b.type);
  assert(sale.join(",") === "create_task,wait", "client servicing offers tasks and waits");
  const missed = availableBlocks(taskGraph("inbound_call_missed")).map((b) => b.type);
  assert(!missed.includes("send_sms") && missed.includes("create_task"), "missed calls create callbacks, not messages");

  const invalid = taskGraph("sale_recorded");
  invalid.nodes.push({ id: "sms", type: "send_sms", version: 2, config: { body: "Hello" } });
  invalid.edges.push({ id: "2", source: "task", target: "sms" });
  assert(
    validateGraph(invalid).some((i) => i.nodeId === "sms" && i.message.includes("not available after this trigger")),
    "changing the trigger flags steps it cannot run",
  );
});

Deno.test("new triggers require their selections and tasks validate their own fields", () => {
  assert(
    validateGraph(taskGraph("disposition_recorded")).some((i) => i.message === "Choose at least one disposition."),
    "disposition required",
  );
  assert(
    validateGraph(taskGraph("disposition_recorded", { disposition_ids: ["095168bb-3341-43c8-81b4-654183cdacca"] })).length === 0,
    "disposition chosen",
  );
  assert(
    validateGraph(taskGraph("appointment_outcome_recorded")).some((i) => i.message === "Choose at least one outcome."),
    "outcome required",
  );
  assert(validateGraph(taskGraph("appointment_outcome_recorded", { outcomes: ["no_show"] })).length === 0, "no-show");
  for (const trigger of ["appointment_booked", "inbound_call_missed", "sale_recorded", "policy_issuance_confirmed"]) {
    assert(validateGraph(taskGraph(trigger)).length === 0, trigger);
  }
  const graph = taskGraph("lead_created");
  graph.nodes[1].config = { title: " ", task_type: "Follow Up", due_amount: 5, due_unit: "minutes" };
  assert(validateGraph(graph).some((i) => i.message === "Task title is required."), "title required");
  graph.nodes[1].config = { title: "Call", task_type: "Call", due_amount: 5, due_unit: "minutes" };
  assert(validateGraph(graph).some((i) => i.message === "Choose a task type."), "task type from the CRM list");
  graph.nodes[1].config = { title: "Call", task_type: "Follow Up", due_amount: -1, due_unit: "minutes" };
  assert(validateGraph(graph).some((i) => i.message === "Choose when the task is due."), "due offset");
  graph.nodes[1].config = { title: "Call", task_type: "Follow Up", due_amount: 0, due_unit: "minutes" };
  assert(validateGraph(graph).length === 0, "a task may be due right away");
  graph.nodes[1].config = { title: "Call before {{appointment_time}}", task_type: "Follow Up", due_amount: 0, due_unit: "minutes" };
  assert(
    validateGraph(graph).some((i) => i.message.includes("Appointment time") && i.message.includes("does not provide")),
    "appointment fields need an appointment trigger",
  );
  const settings = taskGraph("lead_created");
  settings.settings = { reentry: "after_end", stop_on_reply: false, stop_on_booking: true, stop_on_contact: true };
  assert(validateGraph(settings).length === 0, "new stop rules and re-entry");
  settings.settings = { reentry: "sometimes", stop_on_reply: false } as unknown as AutomationGraph["settings"];
  assert(validateGraph(settings).some((i) => i.message.includes("re-entry")), "unknown re-entry");
});

Deno.test("appointment preview renders date and time and follows the wait rule", () => {
  const g = emptyGraph();
  g.nodes.push(
    { id: "start", type: "appointment_booked", version: 1, config: {} },
    { id: "wait", type: "wait_until_before_appointment", version: 1, config: { amount: 1, unit: "days" } },
    { id: "sms", type: "send_sms", version: 2, config: { body: "See you {{appointment_date}} at {{appointment_time}}" } },
  );
  g.edges.push({ id: "1", source: "start", target: "wait" }, { id: "2", source: "wait", target: "sms" });
  assert(validateGraph(g).length === 0, "valid reminder graph");
  const now = Date.parse("2026-11-30T12:00:00Z");
  const input = { phone: "+12025550123", timezone: "America/New_York", now };
  const future = previewGraph(g, { ...input, appointment_start: "2026-12-05T20:00:00Z" });
  assert(future.length === 3 && future[1].detail === "Wait until 1 day before the appointment", "waits");
  assert(
    future[2].detail.includes("See you Saturday, December 5 at 3:00 PM EST"),
    "date and time are written in the chosen zone: " + future[2].detail,
  );
  const late = previewGraph(g, { ...input, appointment_start: "2026-12-01T02:00:00Z" });
  assert(late.length === 2 && late[1].detail.includes("remaining steps are skipped"), "late booking skips by default");
  g.nodes[1].config.late = "continue";
  assert(previewGraph(g, { ...input, appointment_start: "2026-12-01T02:00:00Z" }).length === 3, "late booking may continue");
  const unzoned = previewGraph(g, { phone: "+12025550123", now, appointment_start: "2026-12-05T20:00:00Z" });
  assert(unzoned[2].detail.includes("Held"), "no time zone holds the message instead of sending a blank time");
});
