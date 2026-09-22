import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
let db: PGlite;
const uid = "11111111-1111-1111-1111-111111111111";
const other = "22222222-2222-2222-2222-222222222222";
const org = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const cid = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const file = (p: string) => readFile(p, "utf8");
async function scalar(sql: string, params: unknown[] = []) { const result = await db.query<Record<string, unknown>>(sql, params); return Object.values(result.rows[0])[0]; }
async function denied(sql: string, params: unknown[] = [], message?: string) {
  await db.exec("SAVEPOINT expected_denial");
  await expect(db.query(sql, params)).rejects.toThrow(message);
  await db.exec("ROLLBACK TO SAVEPOINT expected_denial");
}
async function state(user = uid, kind = "email", claim = true) {
  const id = await scalar("select public.begin_google_oauth($1,$2,$3,$4)", [user, kind, crypto.randomUUID(), "https://www.fflagent.com/settings"]);
  if (claim) await db.query("update public.email_oauth_states set used_at=now() where id=$1", [id]);
  return id;
}
const complete = (id: unknown, account = "google-owner", email = "owner@example.test", refresh: string | null = "encrypted-refresh") => db.query("select public.complete_google_oauth($1,$2,$3,'Owner','encrypted-access',$4,now()+interval '1 hour','scopes')", [id, account, email, refresh]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(await file("supabase/tests/google_oauth_fixture.sql"));
  expect(await scalar("select has_column_privilege('authenticated','public.user_email_connections','access_token_encrypted','SELECT')")).toBe(true);
  await db.exec(await file("supabase/migrations/20260921224443_google_oauth_production.sql"));
  await db.exec(await file("supabase/migrations/20260921230744_google_oauth_credential_lockdown.sql"));
  await db.exec(await file("supabase/migrations/20260922055909_google_data_deletion_requests.sql"));
  await db.exec(await file("supabase/tests/google_oauth_access.sql"));
});
afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec("BEGIN"); });
afterEach(async () => { await db.exec("ROLLBACK"); });
describe("Google production migration", () => {
  it.each(["Agent", "Admin", "Super Admin", "Team Leader"])("denies credential SELECT/UPDATE for %s while permitting intended metadata", async role => {
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.org',$2,true),set_config('request.jwt.claim.role',$3,true)", [uid,org,role]);
    await db.exec("SET LOCAL ROLE authenticated");
    expect((await db.query("select id,status from public.user_email_connections")).rows).toHaveLength(1);
    await denied("select access_token_encrypted from public.user_email_connections");
    await denied("update public.user_email_connections set refresh_token_encrypted='injected'");
    await denied("select access_token from public.calendar_integrations");
    await denied("select * from public.email_oauth_states");
    await denied("select public.disconnect_google_oauth($1,'all',null)", [uid]);
  });
  it("keeps other agents and other organizations out of owner metadata", async () => {
    for (const [user, organization] of [[other,org],["44444444-4444-4444-4444-444444444444","bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"]]) {
      await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.org',$2,true),set_config('request.jwt.claim.role','Agent',true)", [user,organization]);
      await db.exec("SET LOCAL ROLE authenticated");
      expect((await db.query("select id,status from public.user_email_connections")).rows).toHaveLength(0);
      await db.exec("RESET ROLE");
    }
  });
  it("denies anonymous credentials, metadata and lifecycle RPCs", async () => {
    await db.exec("SET LOCAL ROLE anon");
    await denied("select id from public.user_email_connections");
    await denied("select access_token from public.calendar_integrations");
    await denied("select public.begin_google_oauth($1,'email','x','https://www.fflagent.com/settings')",[uid]);
  });
  it("completes only a claimed, unexpired state and prevents replay", async () => {
    await db.exec("SET LOCAL ROLE service_role");
    const id = await state(uid,"email",false);
    await denied("select public.complete_google_oauth($1,'g','e@example.test',null,'a','r',now()+interval '1 hour','s')",[id],"invalid_or_expired_state");
    await db.query("update public.email_oauth_states set used_at=now() where id=$1",[id]);
    await complete(id);
    await denied("select public.complete_google_oauth($1,'g','e@example.test',null,'a','r',now()+interval '1 hour','s')",[id],"invalid_or_expired_state");
  });
  it("rejects organization changes and expired states", async () => {
    const id = await state();
    await db.query("update public.profiles set organization_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id=$1",[uid]);
    await denied("select public.complete_google_oauth($1,'g','e@example.test',null,'a','r',now()+interval '1 hour','s')",[id],"organization_changed");
    await db.query("update public.profiles set organization_id=$1 where id=$2",[org,uid]);
    await db.query("update public.email_oauth_states set expires_at=now()-interval '1 minute' where id=$1",[id]);
    await denied("select public.complete_google_oauth($1,'g','e@example.test',null,'a','r',now()+interval '1 hour','s')",[id],"invalid_or_expired_state");
  });
  it("preserves a refresh token only for the same stable Google account", async () => {
    await complete(await state());
    const id=await state(); await complete(id,"google-owner","owner@example.test",null);
    expect(await scalar("select refresh_token_encrypted from public.user_email_connections where id=$1",[cid])).toBe("encrypted-refresh");
    const changed=await state();
    await denied("select public.complete_google_oauth($1,'different','new@example.test',null,'a',null,now()+interval '1 hour','s')",[changed],"offline_access_required");
  });
  it("prevents two pending callbacks from overwriting one another", async () => {
    const first=await state(); const second=await state();
    await complete(first);
    await denied("select public.complete_google_oauth($1,'different','new@example.test',null,'a','r',now()+interval '1 hour','s')",[second],"connection_changed");
  });
  it("disconnect invalidates pending callbacks and stale credential updates", async () => {
    const generation=await scalar("select connection_generation from public.user_email_connections where id=$1",[cid]);
    const pending=await state();
    await db.query("select public.disconnect_google_oauth($1,'email',$2)",[uid,cid]);
    await denied("select public.complete_google_oauth($1,'g','e@example.test',null,'a','r',now()+interval '1 hour','s')",[pending],"invalid_or_expired_state");
    const write=await db.query("update public.user_email_connections set access_token_encrypted='stale' where id=$1 and connection_generation=$2 and status='connected' returning id",[cid,generation]);
    expect(write.rows).toHaveLength(0);
    expect(await scalar("select access_token_encrypted from public.user_email_connections where id=$1",[cid])).toBe("");
    await denied("select public.advance_google_email_cursor($1,$2,'123')",[cid,generation],"connection_changed");
  });
  it("cannot disconnect another user's connection", async () => {
    await denied("select public.disconnect_google_oauth($1,'email',$2)",[other,cid],"connection_not_found");
    expect(await scalar("select status from public.user_email_connections where id=$1",[cid])).toBe("connected");
  });
  it("keeps Calendar and email local disconnect separate, and all-access removal clears both", async () => {
    await db.query("select public.disconnect_google_oauth($1,'email',$2)",[uid,cid]);
    expect(await scalar("select sync_enabled from public.calendar_integrations where user_id=$1",[uid])).toBe(true);
    const secrets = await scalar("select public.disconnect_google_oauth($1,'all',null)",[uid]);
    expect(Array.isArray(secrets)).toBe(true);
    expect(await scalar("select access_token from public.calendar_integrations where user_id=$1",[uid])).toBeNull();
  });
  it("stores duplicate Gmail IDs separately for separate mailboxes", async () => {
    await complete(await state());
    await complete(await state(other),"google-other","other@example.test");
    const rows=(await db.query<{id:string;connection_generation:string}>("select id,connection_generation from public.user_email_connections")).rows;
    const message={ external_message_id:"same-id",from_email:"contact@example.test",to_emails:[],cc_emails:[],subject:"synthetic",body_text:"synthetic",received_at:new Date().toISOString() };
    for(const row of rows) {
      const insert=await scalar("select public.persist_google_email_message($1,$2,$3)",[row.id,row.connection_generation,JSON.stringify(message)]);
      expect(insert).toBeTruthy();
      expect(await scalar("select public.persist_google_email_message($1,$2,$3)",[row.id,row.connection_generation,JSON.stringify(message)])).toBeNull();
    }
    expect(await scalar("select count(*)::int from public.contact_emails")).toBe(2);
  });
  it("keeps historical mailbox identity and resets cursors when switching accounts", async () => {
    await complete(await state());
    const generation=await scalar("select connection_generation from public.user_email_connections where id=$1",[cid]);
    const message={external_message_id:"old-id",from_email:"sender@example.test",to_emails:[],cc_emails:[],received_at:new Date().toISOString()};
    await db.query("select public.persist_google_email_message($1,$2,$3)",[cid,generation,JSON.stringify(message)]);
    await db.query("select public.advance_google_email_cursor($1,$2,'old-cursor')",[cid,generation]);
    await complete(await state(),"new-google-account","new@example.test","new-refresh");
    expect(await scalar("select source_account_email from public.contact_emails")).toBe("owner@example.test");
    expect(await scalar("select connection_id from public.contact_emails")).toBeNull();
    expect(await scalar("select count(*)::int from public.email_sync_cursors")).toBe(0);
    await denied("select public.advance_google_email_cursor($1,$2,'stale')",[cid,generation],"connection_changed");
    await denied("select public.advance_google_email_cursor($1,null,'stale')",[cid],"connection_changed");
  });
  it("completes Calendar independently and preserves only the same account's refresh grant", async () => {
    await complete(await state(uid,"calendar"));
    expect(await scalar("select provider_account_email from public.calendar_integrations where user_id=$1",[uid])).toBe("owner@example.test");
    await complete(await state(uid,"calendar"),"google-owner","owner@example.test",null);
    expect(await scalar("select refresh_token from public.calendar_integrations where user_id=$1",[uid])).toBe("encrypted-refresh");
    const id=await state(uid,"calendar");
    await denied("select public.complete_google_oauth($1,'different','new@example.test',null,'a',null,now()+interval '1 hour','s')",[id],"offline_access_required");
  });
  it("credential conversion uses token and generation compare-and-swap and is service-only", async () => {
    const row=(await db.query<{connection_generation:string;access_token_encrypted:string;refresh_token_encrypted:string}>("select connection_generation,access_token_encrypted,refresh_token_encrypted from public.user_email_connections where id=$1",[cid])).rows[0];
    const sql="select public.migrate_google_credential('email',$1,$2,$3,$4,'encrypted-a','encrypted-r')";
    const params=[cid,row.connection_generation,row.access_token_encrypted,row.refresh_token_encrypted];
    await db.exec("SET LOCAL ROLE authenticated");await denied(sql,params);await db.exec("RESET ROLE");
    await db.exec("SET LOCAL ROLE service_role");
    expect(await scalar(sql,params)).toBe(true);
    expect(await scalar(sql,params)).toBe(false);
    await db.query("select public.disconnect_google_oauth($1,'email',$2)",[uid,cid]);
    expect(await scalar(sql,[cid,row.connection_generation,"","encrypted-r"])).toBe(false);
    expect(await scalar("select access_token_encrypted from public.user_email_connections where id=$1",[cid])).toBe("");
  });
});
