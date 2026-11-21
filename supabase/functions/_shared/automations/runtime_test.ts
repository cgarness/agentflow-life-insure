import { evaluateClaim, sweepAutomationWork, type AutomationClaim } from "./runtime.ts";

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
  future.graph.nodes[0].version = 2;
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
