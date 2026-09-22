import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
let db: PGlite;
const uid="11111111-1111-1111-1111-111111111111", other="22222222-2222-2222-2222-222222222222", outsider="44444444-4444-4444-4444-444444444444";
const org="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", otherOrg="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", cid="eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", mailbox="owner@example.test";
async function scalar(sql: string, args: unknown[] = []) { return Object.values((await db.query<Record<string,any>>(sql,args)).rows[0])[0]; }
async function denied(sql: string,args: unknown[] = [],message?: string) { await db.exec("SAVEPOINT denial"); await expect(db.query(sql,args)).rejects.toThrow(message); await db.exec("ROLLBACK TO SAVEPOINT denial"); }
const generation=()=>scalar("select connection_generation from public.user_email_connections where id=$1",[cid]);
const manifest=(email=mailbox,user=uid,agency=org)=>scalar("select public.google_mailbox_deletion_manifest($1,$2,$3)",[agency,user,email]);
const request=(email=mailbox)=>({id:crypto.randomUUID(),organization_id:org,user_id:uid,mailbox:email,received_at:"2026-01-01T00:00:00Z",verified_at:"2026-01-02T00:00:00Z",due_at:"2026-01-20T00:00:00Z",authority_ref:"verified-ticket",operator_ref:"operator",ledger_ref:"external-restricted-ledger",holds_reviewed:true});
const begin=(r:object,m:object)=>scalar("select public.begin_google_mailbox_deletion($1,$2)",[JSON.stringify(r),JSON.stringify(m)]);
const erase=(r:{id:string},m:object,limit=500)=>scalar("select public.erase_google_mailbox_batch($1,$2,$3)",[r.id,JSON.stringify(m),limit]);
const content=()=>({external_message_id:crypto.randomUUID(),from_email:"synthetic@example.test",to_emails:[mailbox],cc_emails:[],body_text:"SYNTHETIC CONTENT",subject:"SYNTHETIC SUBJECT",received_at:new Date().toISOString(),sent_at:new Date().toISOString(),delivery_status:"sent"});
async function inbound(connection=cid) { const gen=await scalar("select connection_generation from public.user_email_connections where id=$1",[connection]); return scalar("select public.persist_google_email_message($1,$2,$3)",[connection,gen,JSON.stringify(content())]); }
async function outbound() { return scalar("select public.persist_google_outbound_email($1,$2,$3,'Synthetic')",[cid,await generation(),JSON.stringify(content())]); }
async function notify(id:string,recipients=[other]) { return scalar("select public.persist_google_email_notifications($1,$2,$3,$4)",[cid,await generation(),id,JSON.stringify(recipients.map(user_id=>({user_id,body:"SYNTHETIC PREVIEW",metadata:{},action_url:"/contacts"})))]); }
async function reconnect(email=mailbox) { const state=await scalar("select public.begin_google_oauth($1,'email',$2,'https://www.fflagent.com/settings')",[uid,crypto.randomUUID()]); await db.query("update public.email_oauth_states set used_at=now() where id=$1",[state]); return scalar("select public.complete_google_oauth($1,'synthetic-account',$2,'Owner','access','refresh',now()+interval '1 hour','scopes')",[state,email]); }
beforeAll(async()=>{
  db=new PGlite();
  for(const path of ["supabase/tests/google_oauth_fixture.sql","supabase/migrations/20260921224443_google_oauth_production.sql","supabase/migrations/20260921230744_google_oauth_credential_lockdown.sql","supabase/migrations/20260922055909_google_data_deletion_requests.sql"]) await db.exec(await readFile(path,"utf8"));
});
afterAll(async()=>{await db?.close();}); beforeEach(async()=>{await db.exec("BEGIN");}); afterEach(async()=>{await db.exec("ROLLBACK");});
describe("Gmail erasure scope and lifecycle",()=>{
  it("inventories IDs and gaps without contents or mutation",async()=>{
    await outbound();const m=await manifest();expect(m.messages).toHaveLength(1);expect(m.activities).toHaveLength(1);
    expect(JSON.stringify(m)).not.toMatch(/SYNTHETIC|access|refresh/);
    expect(await scalar("select count(*)::int from public.google_mailbox_deletion_requests")).toBe(0);
    expect(await scalar("select status from public.user_email_connections where id=$1",[cid])).toBe("connected");
  });
  it("erases leadership previews and activities while preserving other users and agencies",async()=>{
    const mid=await inbound();await notify(mid);await outbound();
    for(const [u,o,e] of [[other,org,"other@example.test"],[outsider,otherOrg,"outside@example.test"]]) {
      const id=await scalar("insert into public.user_email_connections(user_id,organization_id,provider,provider_account_email,access_token_encrypted) values($1,$2,'google',$3,'synthetic') returning id",[u,o,e]);await inbound(id);
    }
    const m=await manifest(),r=request();await begin(r,m);const result=await erase(r,m);
    expect(result).toMatchObject({status:"live_deleted",messages:2,notifications:1,activities:1,other_copies:"pending_review"});
    expect(await scalar("select count(*)::int from public.contact_emails")).toBe(2);
    expect(await scalar("select count(*)::int from public.notifications")).toBe(0);
    expect(await scalar("select access_token from public.calendar_integrations where user_id=$1",[uid])).toBe("synthetic-calendar-access");
  });
  it("serializes bounded batches and is idempotent on retries",async()=>{
    await inbound();await outbound();const m=await manifest(),r=request();await begin(r,m);
    expect((await erase(r,m,1)).status).toBe("pending");expect(await begin(r,m)).toBe("pending");
    const done=await erase(r,m,1);expect(done.status).toBe("live_deleted");expect(await erase(r,m,1)).toEqual(done);
  });
  it("rejects a changed manifest before disconnecting",async()=>{
    const m=await manifest();await inbound();await denied("select public.begin_google_mailbox_deletion($1,$2)",[JSON.stringify(request()),JSON.stringify(m)],"manifest_changed");
    expect(await scalar("select status from public.user_email_connections where id=$1",[cid])).toBe("connected");
  });
  it("blocks pending callbacks, send/sync persistence, cursors and delayed notifications",async()=>{
    const state=await scalar("select public.begin_google_oauth($1,'email','pending-state','https://www.fflagent.com/settings')",[uid]);
    const mid=await inbound(),gen=await generation(),m=await manifest(),r=request();await begin(r,m);
    await denied("select public.complete_google_oauth($1,'g','owner@example.test',null,'a','r',now()+interval '1 hour','s')",[state],"invalid_or_expired_state");
    for(const sql of ["select public.check_google_mailbox($1,$2)","select public.persist_google_email_message($1,$2,'{}')","select public.persist_google_outbound_email($1,$2,'{}',null)","select public.advance_google_email_cursor($1,$2,'stale')"]) await denied(sql,[cid,gen],"connection_changed");
    await denied("select public.persist_google_email_notifications($1,$2,$3,'[]')",[cid,gen,mid],"connection_changed");
    await denied("select public.begin_google_oauth($1,'email','state','https://www.fflagent.com/settings')",[uid],"deletion_in_progress");
    await erase(r,m);
    await denied("insert into public.notifications(user_id,organization_id,type,event_key) values($1,$2,'inbound_email',$3)",[other,org,"inbound_email:"+mid],"google_message_provenance_required");
  });
  it("rejects obsolete direct message writes without a connection generation",async()=>{
    await denied("insert into public.contact_emails(organization_id,owner_user_id,connection_id,provider,direction,from_email,source_account_email) values($1,$2,$3,'google','inbound','sender@example.test',$4)",[org,uid,cid,mailbox],"connection_changed");
  });
  it("erases detached old mailbox history without disabling a replacement account",async()=>{
    await outbound();await reconnect("replacement@example.test");await inbound();
    const m=await manifest(),r=request();expect(m.messages).toHaveLength(1);await begin(r,m);await erase(r,m);
    expect(await scalar("select status from public.user_email_connections where id=$1",[cid])).toBe("connected");
    expect(await scalar("select source_account_email from public.contact_emails")).toBe("replacement@example.test");
  });
  it("requires new consent after completion and rejects old epochs even after reconnect",async()=>{
    const gen=await generation();await inbound();const m=await manifest(),r=request();await begin(r,m);await erase(r,m);await reconnect();await inbound();
    await denied("select public.persist_google_email_message($1,$2,'{}')",[cid,gen],"connection_changed");
    expect(await scalar("select count(*)::int from public.contact_emails")).toBe(1);
  });
  it("keeps ordinary disconnect history intact",async()=>{await outbound();await db.query("select public.disconnect_google_oauth($1,'email',$2)",[uid,cid]);expect(await scalar("select count(*)::int from public.contact_emails")).toBe(1);});
  it.each(["message","activity","notification"])("blocks erasure with ambiguous legacy %s provenance",async(kind)=>{
    // Simulate pre-migration records in this disposable fixture only.
    if(kind==="message") {await db.exec("ALTER TABLE public.contact_emails DISABLE TRIGGER guard_google_message_write");await db.query("insert into public.contact_emails(organization_id,owner_user_id,provider,direction,from_email,external_message_id) values($1,$2,'google','inbound','synthetic@example.test','legacy')",[org,uid]);}
    if(kind==="activity") {await db.exec("ALTER TABLE public.activity_logs DISABLE TRIGGER guard_google_activity_write");await db.query("insert into public.activity_logs(organization_id,user_id,action,metadata) values($1,$2,'email sent','{\"provider\":\"google\"}')",[org,uid]);}
    if(kind==="notification") {await db.exec("ALTER TABLE public.notifications DISABLE TRIGGER guard_google_notification_write");await db.query("insert into public.notifications(organization_id,user_id,type) values($1,$2,'inbound_email')",[org,other]);}
    await denied("select public.begin_google_mailbox_deletion($1,$2)",[JSON.stringify(request()),JSON.stringify(await manifest())],"manual_provenance_review_required");
  });
  it("rejects mismatched scope, reused request identity and unverified requests",async()=>{
    await denied("select public.google_mailbox_deletion_manifest($1,$2,$3)",[otherOrg,uid,mailbox],"invalid_deletion_scope");
    const r=request(),m=await manifest();await denied("select public.begin_google_mailbox_deletion($1,$2)",[JSON.stringify({...r,holds_reviewed:false}),JSON.stringify(m)],"verified_request_required");
    await begin(r,m);await denied("select public.begin_google_mailbox_deletion($1,$2)",[JSON.stringify({...r,mailbox:"wrong@example.test"}),JSON.stringify(m)],"request_scope_changed");
    await denied("select public.erase_google_mailbox_batch($1,$2,501)",[r.id,JSON.stringify(m)],"invalid_batch_limit");
  });
  it("prevents content mutation but permits CRM contact reassignment and read/dismiss",async()=>{
    const id=await inbound();await notify(id);await db.query("update public.contact_emails set contact_id=$1 where id=$2",[crypto.randomUUID(),id]);
    await db.exec("update public.notifications set read=true,dismissed_at=now()");
    await denied("update public.notifications set type='other'",[],"google_notification_content_is_immutable");
    await denied("update public.contact_emails set subject='changed' where id=$1",[id],"google_message_content_is_immutable");
  });
  it("rejects deleted profiles for OAuth, send and sync but permits verified erasure",async()=>{
    await inbound();await db.query("update public.profiles set status='Deleted' where id=$1",[uid]);
    await denied("select public.check_google_mailbox($1,$2)",[cid,await generation()],"account_unavailable");
    await denied("select public.begin_google_oauth($1,'email','state','https://www.fflagent.com/settings')",[uid],"account_unavailable");
    const r=request(),m=await manifest();await begin(r,m);expect((await erase(r,m)).status).toBe("live_deleted");
  });
  it("denies browser access to ledger and every new service function",async()=>{
    const functions=(await db.query<{name:string}>("select p.oid::regprocedure::text name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('assert_google_user_available','lock_google_mailbox','check_google_mailbox','guard_google_message_write','guard_google_derived_write','persist_google_email_notifications','persist_google_outbound_email','google_mailbox_deletion_manifest','begin_google_mailbox_deletion','erase_google_mailbox_batch')")).rows;
    for(const role of ["anon","authenticated"]) {for(const {name} of functions) expect(await scalar("select has_function_privilege($1,$2,'EXECUTE')",[role,name])).toBe(false);await db.exec(`SET LOCAL ROLE ${role}`);await denied("select * from public.google_mailbox_deletion_requests");await db.exec("RESET ROLE");}
    await db.exec("SET LOCAL ROLE service_role");expect(await manifest()).toHaveProperty("messages");
  });
  it("does not mistake a legacy source-mailbox backfill for proven provenance",async()=>{
    await db.exec("ALTER TABLE public.contact_emails DISABLE TRIGGER guard_google_message_write");
    await db.query("insert into public.contact_emails(organization_id,owner_user_id,provider,direction,from_email,source_account_email,external_message_id) values($1,$2,'google','inbound','synthetic@example.test',$3,'legacy')",[org,uid,mailbox]);
    const m=await manifest();expect(m.gaps.unverified_legacy_messages).toBe(1);
    await denied("select public.begin_google_mailbox_deletion($1,$2)",[JSON.stringify(request()),JSON.stringify(m)],"manual_provenance_review_required");
  });
  it("replays a restored synthetic mailbox under a newly reviewed request",async()=>{
    // Models the operator restore gate, not a hosted backup restore or automatic replay.
    const ledger=request();await inbound();const m=await manifest();await begin(ledger,m);await erase(ledger,m);
    await reconnect();await inbound();const replay={...ledger,id:crypto.randomUUID()};const restoredManifest=await manifest();
    await begin(replay,restoredManifest);expect((await erase(replay,restoredManifest)).status).toBe("live_deleted");
    expect(await scalar("select count(*)::int from public.contact_emails")).toBe(0);
  });
});
