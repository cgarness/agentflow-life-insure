import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDeletion, sha256 } from "../../scripts/delete-google-mailbox-data";
const request={project_ref:"abcdefghijklmnopqrst",id:"99999999-9999-4999-8999-999999999999",organization_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",user_id:"11111111-1111-4111-8111-111111111111",mailbox:"synthetic@example.test",received_at:"2026-01-01T00:00:00Z",verified_at:"2026-01-02T00:00:00Z",due_at:"2026-01-20T00:00:00Z",authority_ref:"verified-ticket",operator_ref:"operator",ledger_ref:"restricted-durable-destination",holds_reviewed:true};
const manifest={version:1,messages:["message-id"],notifications:[],activities:[],gaps:{unknown_mailbox:0},oversized:false};
let files:Record<string,string>,events:string[],env:Record<string,string>,ledgerFails:boolean,review:string;
const base=["--request","/private/request.json","--manifest","/private/manifest.json"];
beforeEach(()=>{
  events=[];ledgerFails=false;review=JSON.stringify({request,manifest},null,2)+"\n";
  files={"/private/request.json":JSON.stringify(request),"/private/manifest.json":review};
  env={SUPABASE_URL:"https://abcdefghijklmnopqrst.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"synthetic-server-key",GOOGLE_DELETION_LEDGER_READY:"true"};
  vi.stubGlobal("Deno",{env:{get:(key:string)=>env[key]},readTextFile:async(path:string)=>files[path],stat:async()=>({isDirectory:true}),writeTextFile:async(path:string,text:string,options:{createNew:boolean,mode:number})=>{expect(options).toEqual({createNew:true,mode:0o600});if(files[path]) throw Error("exists");files[path]=text;},open:async()=>{if(ledgerFails)throw Error("unavailable ledger");return {write:async(bytes:Uint8Array)=>{events.push("ledger-write");return bytes.length;},sync:async()=>{events.push("ledger-sync");},close:()=>{}};}});
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
    const path=new URL(String(input)).pathname;events.push(path);
    const data=path.endsWith("google_mailbox_deletion_manifest")?manifest:path.endsWith("begin_google_mailbox_deletion")?"pending":{status:"live_deleted",messages:1,notifications:0,activities:0};
    return new Response(JSON.stringify(data),{status:200,headers:{"Content-Type":"application/json"}});
  }));
});
afterEach(()=>vi.unstubAllGlobals());
describe("Gmail erasure operator safety",()=>{
  it("defaults to read-only inventory and writes a private review file",async()=>{
    delete files["/private/manifest.json"];expect(await runDeletion(base)).toMatchObject({mode:"dry_run",executable:true,messages:1});
    expect(events).toEqual(["/rest/v1/rpc/google_mailbox_deletion_manifest"]);
  });
  it("requires exact project before making any request",async()=>{
    env.SUPABASE_URL="https://differentprojectabcd.supabase.co";await expect(runDeletion(base)).rejects.toThrow("Project");expect(events).toEqual([]);
  });
  it("rejects a tampered or unapproved manifest before mutation",async()=>{
    await expect(runDeletion([...base,"--execute","--approved-sha256","0".repeat(64),"--ledger-dir","/durable"])).rejects.toThrow("hash");expect(events).toEqual([]);
  });
  it("writes and flushes the durable ledger before beginning deletion",async()=>{
    const result=await runDeletion([...base,"--execute","--approved-sha256",await sha256(review),"--ledger-dir","/durable"]);
    expect(result.status).toBe("live_deleted");expect(events.slice(0,3)).toEqual(["ledger-write","ledger-sync","/rest/v1/rpc/begin_google_mailbox_deletion"]);
  });
  it("does not begin deletion if the external ledger cannot be written",async()=>{
    ledgerFails=true;await expect(runDeletion([...base,"--execute","--approved-sha256",await sha256(review),"--ledger-dir","/durable"])).rejects.toThrow("ledger");expect(events).toEqual([]);
  });
  it("requires durable-ledger attestation for execution",async()=>{
    delete env.GOOGLE_DELETION_LEDGER_READY;await expect(runDeletion([...base,"--execute","--approved-sha256",await sha256(review),"--ledger-dir","/durable"])).rejects.toThrow("ledger");expect(events).toEqual([]);
  });
});
