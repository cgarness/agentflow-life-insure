import { database } from "../a2p/registrationTestDb.ts";
import { activeTrustAdmin, manualTrustScope } from "./manualTrustScope.ts";
import { setupTrust } from "./setupTrust.ts";
import { runNumberSetup } from "./setupWorker.ts";
import type { SetupJob } from "./setupTypes.ts";

const sid = (type: string, char: string) => type + char.repeat(32);
const ac = sid("AC", "a"),
  bu = sid("BU", "b"),
  pn = sid("PN", "c"),
  bn = sid("BN", "d");
const job: SetupJob = {
  purchase_id: "purchase",
  kind: "trust",
  lease_token: "lease",
  organization_id: "agency",
  actor_id: "admin",
  account_sid: ac,
  phone_number_id: "number",
  phone_sid: pn,
  phone_number: "+14155550109",
  number_type: "local",
  attempts: 1,
};
function equal<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}; received ${actual}`);
  }
}
type Row = Record<string, unknown>;

function fixture() {
  const tables: Record<string, Row[]> = {
    organizations: [{
      id: "agency",
      status: "active",
      twilio_subaccount_status: "active",
    }],
    phone_settings: [{
      id: "settings",
      organization_id: "agency",
      trust_hub_profile_sid: bu,
    }],
    phone_number_setup_profiles: [{
      profile_sid: bu,
      account_sid: ac,
      organization_id: "agency",
    }],
    a2p_registrations: [],
    phone_numbers: [{
      id: "number",
      organization_id: "agency",
      twilio_sid: pn,
      phone_number: job.phone_number,
      status: "active",
    }],
  };
  const db = {
    from(table: string) {
      let rows = tables[table];
      const builder = {
        abortSignal() {
          return builder;
        },
        select() {
          return builder;
        },
        limit() {
          return builder;
        },
        eq(key: string, value: unknown) {
          rows = rows.filter((r) => r[key] === value);
          return builder;
        },
        neq(key: string, value: unknown) {
          rows = rows.filter((r) => r[key] !== value);
          return builder;
        },
        in(key: string, values: unknown[]) {
          rows = rows.filter((r) => values.includes(r[key]));
          return builder;
        },
        maybeSingle() {
          return { data: rows[0] ?? null, error: rows.length > 1 };
        },
      };
      return builder;
    },
  };
  const state = {
    status: "twilio-approved",
    profileAccount: ac,
    providerNumber: job.phone_number,
    brandProfile: bu,
    assignmentProfile: bu,
    assigned: false,
    lostAck: false,
    conflict: false,
    posts: 0,
    reads: 0,
    skipWrite: false,
  };
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    let data: unknown;
    let status = 200;
    if (url.pathname.endsWith("/BrandRegistrations/" + bn)) {
      data = {
        sid: bn,
        account_sid: ac,
        customer_profile_bundle_sid: state.brandProfile,
        mock: false,
      };
    } else if (url.pathname.endsWith("/CustomerProfiles/" + bu)) {
      data = {
        sid: bu,
        status: state.status,
        account_sid: state.profileAccount,
      };
    } else if (url.pathname.endsWith("/IncomingPhoneNumbers/" + pn + ".json")) {
      data = {
        sid: pn,
        phone_number: state.providerNumber,
        account_sid: ac,
        capabilities: { voice: true, sms: false },
      };
    } else if (url.pathname.endsWith("/ChannelEndpointAssignments")) {
      const assignment = {
        sid: sid("RA", "e"),
        customer_profile_sid: state.assignmentProfile,
        channel_endpoint_type: "phone-number",
        channel_endpoint_sid: pn,
        account_sid: ac,
      };
      if (init?.method === "POST") {
        state.posts++;
        equal(
          String(init.body),
          "ChannelEndpointSid=" + pn + "&ChannelEndpointType=phone-number",
        );
        if (!state.skipWrite && !state.conflict) state.assigned = true;
        if (state.lostAck) {
          throw new Error("synthetic provider timeout after commit");
        }
        if (state.conflict) status = 409;
        data = assignment;
      } else {
        equal(url.searchParams.get("ChannelEndpointSid"), pn);
        data = { results: state.assigned ? [assignment] : [] };
      }
    } else throw new Error("Unexpected provider path");
    state.reads++;
    return Promise.resolve(Response.json(data, { status }));
  };
  const run = () =>
    setupTrust(
      db,
      job,
      new AbortController().signal,
      () => ({ ok: true, creds: { accountSid: ac, authToken: "fixture" } }),
      fetcher,
    );
  return { tables, state, run, runDb: db };
}

Deno.test("purchase worker links exact voice-capable receipt with a protected pin even before any A2P registration", async () => {
  const f = fixture();
  f.state.status = "in-review";
  equal((await f.run()).code, "WAITING_TRUST_PROFILE");
  equal(f.state.posts, 0);
  f.state.status = "twilio-approved";
  equal((await f.run()).profileSid, bu);
  equal((await f.run()).code, "TRUST_LINKED");
  equal(f.state.posts, 1);
});

Deno.test("purchase worker accepts an existing agency's brand as independent profile proof", async () => {
  const f = fixture();
  f.tables.phone_number_setup_profiles.length = 0;
  equal((await f.run()).code, "TRUST_PROFILE_UNVERIFIED");
  f.tables.a2p_registrations.push({
    organization_id: "agency",
    account_sid: ac,
    brand_sid: bn,
    is_test: false,
  });
  f.state.brandProfile = sid("BU", "e");
  equal((await f.run()).code, "TRUST_PROFILE_UNVERIFIED");
  equal(f.state.posts, 0);
  f.state.brandProfile = bu;
  equal((await f.run()).code, "TRUST_LINKED");
});

Deno.test("purchase worker refuses another agency's profile or altered provider receipt", async () => {
  const f = fixture();
  f.tables.phone_settings.push({
    id: "other",
    organization_id: "another",
    trust_hub_profile_sid: bu,
  });
  equal((await f.run()).code, "TRUST_PROFILE_CONFLICT");
  f.tables.phone_settings.pop();
  f.tables.phone_number_setup_profiles[0].organization_id = "another";
  equal((await f.run()).code, "TRUST_PROFILE_CONFLICT");
  f.tables.phone_number_setup_profiles[0].organization_id = "agency";
  f.state.providerNumber = "+14155550100";
  equal((await f.run()).code, "NUMBER_SCOPE_CHANGED");
  f.state.providerNumber = job.phone_number;
  f.tables.phone_numbers[0].status = "released";
  equal((await f.run()).code, "NUMBER_SCOPE_CHANGED");
  equal(f.state.posts, 0);
});

Deno.test("purchase worker reconciles an interrupted assignment and requires actual provider membership", async () => {
  const f = fixture();
  f.state.lostAck = true;
  let interrupted = false;
  try {
    await f.run();
  } catch {
    interrupted = true;
  }
  equal(interrupted, true);
  f.state.lostAck = false;
  equal((await f.run()).code, "TRUST_LINKED");
  equal(f.state.posts, 1);
  f.state.assigned = false;
  f.state.conflict = true;
  equal((await f.run()).code, "TRUST_ASSIGNMENT_CONFLICT");
  f.state.conflict = false;
  f.state.skipWrite = true;
  equal((await f.run()).state, "retry");
  f.state.assigned = true;
  f.state.assignmentProfile = sid("BU", "e");
  equal((await f.run()).code, "TRUST_ASSIGNMENT_CONFLICT");
});

Deno.test("setup worker independently completes SMS after Trust retry, carrying the exact lease", async () => {
  const sms: SetupJob = { ...job, kind: "sms", lease_token: "sms-lease" };
  const queue = [job, sms];
  const completions: Row[] = [];
  const db = {
    from: fixture().runDb.from,
    rpc(name: string, args?: Row) {
      equal(
        ["phone_number_setup_claim", "phone_number_setup_finish"].includes(
          name,
        ),
        true,
      );
      const result = name === "phone_number_setup_claim"
        ? queue.splice(0, 1)
        : true;
      if (args) completions.push(args);
      return { abortSignal: () => ({ data: result, error: null }) };
    },
  };
  const stats = await runNumberSetup(db, {
    trust: () => Promise.reject(new Error("lost response")),
    sms: () => Promise.resolve({ state: "complete", code: "SMS_SUBMITTED" }),
  }, new AbortController().signal);
  equal(stats.processed, 2);
  equal(stats.retrying, 1);
  equal(completions.length, 2);
  equal(completions[0].p_code, "PROVIDER_RETRY");
  equal(completions[1].p_lease, "sms-lease");
  equal(completions[1].p_kind, "sms");
});

Deno.test("both jobs wait without provider traffic while either agency or telephony is suspended, then resume", async () => {
  const f = fixture();
  const kinds = ["trust", "sms"] as const;
  for (const key of ["status", "twilio_subaccount_status"]) {
    for (const active of [false, true]) {
      f.tables.organizations[0][key] = active ? "active" : "suspended";
      const queue = kinds.map((kind) => ({ ...job, kind }));
      const finishes: Row[] = [];
      const db = {
        from: f.runDb.from,
        rpc(name: string, args?: Row) {
          if (args) finishes.push(args);
          return {
            abortSignal: () => ({
              data: name === "phone_number_setup_claim"
                ? queue.splice(0, 1)
                : true,
              error: null,
            }),
          };
        },
      };
      let calls = 0;
      const processor = () => {
        calls++;
        return Promise.resolve({ state: "complete" as const, code: "fixture" });
      };
      await runNumberSetup(
        db,
        { trust: processor, sms: processor },
        new AbortController().signal,
      );
      equal(calls, active ? 2 : 0);
      equal(finishes.length, 2);
      for (const row of finishes) {
        equal(row.p_code, active ? "fixture" : "agency_suspended");
      }
    }
  }
});

Deno.test("manual Trust setup requires active administrators and resolves only legacy active numbers from the buying agency", async () => {
  equal(activeTrustAdmin({role:"Admin",status:"Active"}),true);
  equal(activeTrustAdmin({role:"Super Admin",status:"Active"}),true);
  equal(activeTrustAdmin({role:"Admin",status:"Inactive"}),false);
  equal(activeTrustAdmin({role:"Agent",status:"Active"}),false);
  const legacy=sid("PN","a"), managed=sid("PN","b"), foreign=sid("PN","c"), released=sid("PN","d");
  const numbers=[{id:"a",organization_id:"A",twilio_sid:legacy,phone_number:"+12025550121",status:"active"},
    {id:"b",organization_id:"A",twilio_sid:managed,phone_number:"+12025550122",status:"active"},
    {id:"c",organization_id:"B",twilio_sid:foreign,phone_number:"+12025550123",status:"active"},
    {id:"d",organization_id:"A",twilio_sid:released,phone_number:"+12025550124",status:"released"}];
  const seed=database({phone_numbers:numbers}), resolved: string[] = [];
  const client={...seed,rpc: async (_name:string, args:{p_org:string;p_number:string})=>{
    equal(args.p_org,"A"); resolved.push(args.p_number);
    return {data:{managed:args.p_number===numbers[1].phone_number,owned:true},error:null};
  }};
  const result=await manualTrustScope(client,"A",[legacy,managed,foreign,released,legacy]);
  equal(result.legacy.length,1);
  equal(result.legacy[0].id,"a");
  equal(result.excluded.length,3);
  equal(result.excluded[0].error?.includes("Phone Numbers"),true);
  equal(result.excluded[1].error,result.excluded[2].error);
  equal(resolved.length,2);
  await assertRejectsManual(() => manualTrustScope(client,"A",["invalid"]));
  await assertRejectsManual(() => manualTrustScope({...client,rpc:()=>({data:null,error:true})},"A",[legacy]));
});

async function assertRejectsManual(run:()=>Promise<unknown>) {
  try {await run();} catch {return;}
  throw new Error("Expected manual preflight to fail closed");
}
