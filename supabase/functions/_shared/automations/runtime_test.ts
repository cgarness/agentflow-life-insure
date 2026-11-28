import { evaluateClaim, runAutomationClaim, sweepAutomationWork, type AutomationClaim } from "./runtime.ts";

function claim(type: string): AutomationClaim {
  return {
    organization_id: "agency", workflow_id: "workflow", version_id: "published",
    node_id: "step", run_id: "run", lease_token: "lease", contact_id: "person",
    contact_type: "lead", status: "queued", stop_on_reply: false,
    graph: { format: 1, nodes: [{ id: "step", type, version: 1, config: {} }], edges: [],
      settings: {reentry: "once", stop_on_reply: false} },
  };
}
const unused = (): never => { throw Error("Unexpected provider invocation"); };
function expect(actual: unknown, expected: unknown) {
  if (actual !== expected) throw Error(`Expected ${expected}, received ${actual}`);
}

Deno.test("versioned wait is persisted before it elapses without loading a contact", async () => {
  const run = claim("wait");
  expect((await evaluateClaim(run,unused,unused)).status,"wait");
  run.status = "waiting";
  expect((await evaluateClaim(run,unused,unused)).status,"elapsed");
});

Deno.test("contact has email branches on current scoped data and holds on unavailable data", async () => {
  const run = claim("contact_has_email");
  for (const [contact, status] of [
    [{email:"valid@example.test"},"yes"], [{email:null},"no"], [{email:"  "},"no"], [{}, "held"], [null,"held"],
  ] as const) {
    expect((await evaluateClaim(run,async () => contact,unused)).status,status);
  }
  expect((await evaluateClaim(run,async () => { throw Error("interrupted"); },unused)).status,"held");
});

Deno.test("one action executes exactly its configured channel and immutable copy", async () => {
  for (const channel of ["send_sms", "send_email"]) {
    const run = claim(channel);
    run.graph.nodes[0].config = { body: "Authored content" };
    let requests = 0;
    const outcome = await evaluateClaim(run,async () => ({email:"valid@example.test"}),async (type,config) => {
      expect(type,channel);
      expect(config.body, "Authored content");
      requests++;
      return {status:"accepted"};
    });
    expect(requests,1);
    expect(outcome.status,"accepted");
  }
});

Deno.test("future blocks and versions cannot invoke a provider", async () => {
  expect((await evaluateClaim(claim("future_action"),async () => ({}),unused)).status,"failed");
  const future = claim("send_sms");
  future.graph.nodes[0].version = 3;
  expect((await evaluateClaim(future,unused,unused)).status,"failed");
});

Deno.test("a crashed handoff awaits evidence for its original intent", async () => {
  const run = claim("send_email");
  run.uncertain_handoff = true;
  expect((await evaluateClaim(run,unused,unused)).status,"unknown");
});


Deno.test("an unavailable intake or claim service does not prevent receipt repairs", async () => {
  const requests: string[] = [];
  const db = { async rpc(name: string) {
    requests.push(name);
    if (name === "automation_process_events") throw Error("unavailable");
    if (name === "automation_claim_work") return {data: null, error: Error("unavailable")};
    return {data: 3, error: null};
  } };
  const result = await sweepAutomationWork(db as unknown as Parameters<typeof sweepAutomationWork>[0], unused);
  expect(requests.join(","),"automation_process_events,automation_claim_work,automation_repair_messages");
  expect(result.failed_stages.length,2);
  expect(result.enrolled,null);
  expect(result.repaired,3);
});


Deno.test("an immediately available backlog drains in bounded pages and reports claimed due lag", async () => {
  let pages = 0;
  let finished = 0;
  const db = { async rpc(name: string) {
    if (name === "automation_claim_work") {
      const due = claim("wait");
      due.due_lag_ms = ++pages * 300;
      return {data: [due], error: null};
    }
    if (name === "automation_finish_node") finished++;
    return {data: 0, error: null};
  } };
  const result = await sweepAutomationWork(db as unknown as Parameters<typeof sweepAutomationWork>[0], unused);
  expect(pages,4);
  expect(finished,4);
  expect(result.claimed,4);
  expect(result.max_due_lag_ms,1200);
  expect(result.failed_claims,0);
});


Deno.test("the published step version reaches the channel so purpose is taken from the right place", async () => {
  for (const version of [1, 2]) {
    const run = claim("send_sms");
    run.graph.nodes[0].version = version;
    run.graph.nodes[0].config = { body: "Authored content" };
    let seen = 0;
    await evaluateClaim(run, async () => ({phone: "+12025550123"}), async (_type, _config, _contact, published) => {
      seen = published;
      return {status: "accepted"};
    });
    expect(seen, version);
  }
});

Deno.test("messages go to leads only; other contacts and unmatched callers continue past the step", async () => {
  for (const kind of ["client", "recruit"] as const) {
    const run = claim("send_sms");
    run.contact_type = kind;
    const outcome = await evaluateClaim(run, async () => ({phone: "+12025550123"}), unused);
    expect(outcome.status, "skipped");
  }
  const unmatched = claim("send_email");
  unmatched.contact_id = null;
  unmatched.contact_type = null;
  expect((await evaluateClaim(unmatched, unused, unused)).status, "skipped");
});

Deno.test("an appointment wait is persisted like a wait and resolved by the database", async () => {
  const run = claim("wait_until_before_appointment");
  expect((await evaluateClaim(run,unused,unused)).status,"wait");
  run.status = "waiting";
  expect((await evaluateClaim(run,unused,unused)).status,"elapsed");
});

Deno.test("a task step never reaches a message provider and tolerates an unmatched caller", async () => {
  const run = claim("create_task");
  run.graph.nodes[0].config = { title: "Call {{first_name}}", task_type: "Follow Up", due_amount: 5, due_unit: "minutes" };
  let tasks = 0;
  const outcome = await evaluateClaim(run, async () => ({first_name: "Sam"}), unused, async (config, contact) => {
    tasks++;
    expect(config.title, "Call {{first_name}}");
    expect(contact?.first_name, "Sam");
    return {status: "created"};
  });
  expect(outcome.status, "created");
  expect(tasks, 1);
  const unmatched = claim("create_task");
  unmatched.contact_id = null;
  unmatched.contact_type = null;
  const queued = await evaluateClaim(unmatched, unused, unused, async (_config, contact) => {
    expect(contact, null);
    return {status: "created"};
  });
  expect(queued.status, "created");
  expect((await evaluateClaim(run, async () => { throw Error("interrupted"); }, unused, unused)).status, "held");
});

Deno.test("the worker renders task text, asks the database to create it once and reports the database outcome", async () => {
  const calls: Array<{name: string; args: Record<string, unknown>}> = [];
  const tables: string[] = [];
  function db(result: unknown, failCreate = false) {
    return {
      from(table: string) {
        tables.push(table);
        const query = { select: () => query, eq: () => query, maybeSingle: async () => ({data: {first_name: "Sam", last_name: "Lee"}, error: null}) };
        return query;
      },
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({name, args});
        if (name === "automation_create_task") return failCreate ? {data: null, error: Error("down")} : {data: result, error: null};
        return {data: true, error: null};
      },
    } as unknown as Parameters<typeof runAutomationClaim>[0];
  }
  const run = claim("create_task");
  run.contact_type = "client";
  run.context = { appointment_start: "2026-12-05T20:00:00Z", agency_timezone: "America/New_York" };
  run.graph.nodes[0].config = {
    title: " Call {{first_name}} {{last_name}} ", notes: "Meeting {{appointment_date}} at {{appointment_time}}",
    task_type: "Follow Up", due_amount: 5, due_unit: "minutes",
  };
  await runAutomationClaim(db({status: "created"}), run, unused);
  expect(tables.join(","), "clients");
  expect(calls.map((c) => c.name).join(","), "automation_create_task,automation_finish_node");
  expect(calls[0].args.p_title, "Call Sam Lee");
  expect(calls[0].args.p_notes, "Meeting Saturday, December 5 at 3:00 PM EST");
  expect(calls[0].args.p_run, "run");
  expect(calls[0].args.p_token, "lease");
  expect(calls[1].args.p_result, "created");

  calls.length = 0;
  await runAutomationClaim(db({status: "held", reason: "Contact has no active assigned agent"}), run, unused);
  expect(calls[1].args.p_result, "held");
  expect(calls[1].args.p_reason, "Contact has no active assigned agent");

  calls.length = 0;
  await runAutomationClaim(db(null, true), run, unused);
  expect(calls[1].args.p_result, "held");

  calls.length = 0;
  run.context = { appointment_start: "2026-12-05T20:00:00Z", agency_timezone: null };
  await runAutomationClaim(db({status: "created"}), run, unused);
  expect(calls.map((c) => c.name).join(","), "automation_finish_node");
  expect(calls[0].args.p_result, "held");
});

Deno.test("a message the final send check skips is finished as skipped with its reason, unchanged", async () => {
  for (const channel of ["send_sms", "send_email"]) {
    const calls: Array<{name: string; args: Record<string, unknown>}> = [];
    const db = {
      from() {
        const query = { select: () => query, eq: () => query, maybeSingle: async () => ({data: {phone: "+12025550123"}, error: null}) };
        return query;
      },
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({name, args});
        return {data: true, error: null};
      },
    } as unknown as Parameters<typeof runAutomationClaim>[0];
    const run = claim(channel);
    run.graph.nodes[0].config = { body: "Reminder" };
    await runAutomationClaim(db, run, async () => ({status: "skipped", reason: "Already sent for this appointment time"}));
    expect(calls.map((c) => c.name).join(","), "automation_finish_node");
    expect(calls[0].args.p_run, "run");
    expect(calls[0].args.p_token, "lease");
    expect(calls[0].args.p_result, "skipped");
    expect(calls[0].args.p_reason, "Already sent for this appointment time");
  }
});
