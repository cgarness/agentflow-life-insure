import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disconnectGoogleOAuth, finishGoogleOAuth, GMAIL_SCOPES, startGoogleOAuth } from "./google-oauth";
import { encodeToken, tokenContext } from "./google-token";
const user = "11111111-1111-1111-1111-111111111111";
const connection = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const vars: Record<string,string> = {
  SUPABASE_URL: "https://database.example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
  GOOGLE_CLIENT_ID: "synthetic-client", GOOGLE_CLIENT_SECRET: "synthetic-secret", EMAIL_GOOGLE_CALLBACK_URL: "https://callback.example.test/email",
  GOOGLE_REDIRECT_URI: "https://callback.example.test/calendar", GOOGLE_TOKEN_KEYS: JSON.stringify({ primary: Buffer.alloc(32,7).toString("base64") }), EMAIL_SYNC_CRON_SECRET: "synthetic-cron",
};
const reply = (data: unknown, status=200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const request = (body: unknown={}, authenticated=true) => new Request("https://edge.example.test/start", { method:"POST", headers: { "Content-Type":"application/json", ...(authenticated ? {Authorization:"Bearer synthetic-user-jwt"}:{}) }, body:JSON.stringify(body) });
let calls: Array<{ url: URL; method: string; body: Record<string,unknown> }>;
let scope: string; let revokedOK: boolean; let claimOK: boolean; let completeOK: boolean; let credentials: unknown[];
let handler: (req: Request) => Promise<Response>;
beforeEach(() => {
  calls=[]; scope=GMAIL_SCOPES.join(" "); revokedOK=true; claimOK=true; completeOK=true; credentials=[];
  vi.stubGlobal("Deno", { env:{get:(k:string)=>vars[k]}, serve:(fn:typeof handler)=>{handler=fn;} });
  vi.stubGlobal("fetch", vi.fn(async(input: RequestInfo|URL,init?: RequestInit) => {
    const url=new URL(String(input)); const method=init?.method||"GET";
    const body=typeof init?.body === "string" ? JSON.parse(init.body) : {};
    calls.push({url,method,body});
    if(url.pathname==="/auth/v1/user") return reply({id:user,email:"owner@example.test"});
    if(url.pathname==="/rest/v1/rpc/begin_google_oauth") return reply("state-id");
    if(url.pathname==="/rest/v1/email_oauth_states") {
      expect(url.searchParams.get("used_at")).toBe("is.null");
      expect(url.searchParams.get("expires_at")).toMatch(/^gt\./);
      return claimOK ? reply({id:"state-id",user_id:user,organization_id:"org",redirect_to:"https://www.fflagent.com/settings"}) : reply({code:"PGRST116",message:"No rows",details:"The result contains 0 rows"},406);
    }
    if(url.hostname==="oauth2.googleapis.com" && url.pathname==="/token") return reply({access_token:"synthetic-access",refresh_token:"synthetic-refresh",expires_in:3600,scope});
    if(url.pathname==="/oauth2/v2/userinfo") return reply({id:"google-account",email:"owner@example.test",verified_email:true,name:"Owner"});
    if(url.pathname==="/rest/v1/rpc/complete_google_oauth") return completeOK ? reply(connection) : reply({message:"connection_changed"},409);
    if(url.pathname==="/rest/v1/activity_logs") return new Response(null,{status:201});
    if(url.pathname==="/rest/v1/rpc/disconnect_google_oauth") return reply(credentials);
    if(url.hostname==="oauth2.googleapis.com" && url.pathname==="/revoke") return revokedOK ? new Response(null,{status:200}) : reply({error:"temporarily_unavailable"},503);
    throw new Error(`Unexpected mocked request ${url.pathname}`);
  }));
});
afterEach(()=>vi.unstubAllGlobals());
describe("Google OAuth Edge lifecycle",()=>{
  it("requires authentication before creating state",async()=>{
    expect((await startGoogleOAuth(request({},false),"email")).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it("uses the authenticated identity and exact callback",async()=>{
    const res=await startGoogleOAuth(request({user_id:"attacker",redirect_to:"https://www.fflagent.com/settings?arbitrary=1"}),"email");
    expect(res.status).toBe(200);
    const payload=await res.json(); const auth=new URL(payload.auth_url);
    expect(auth.searchParams.get("redirect_uri")).toBe(vars.EMAIL_GOOGLE_CALLBACK_URL);
    expect(auth.searchParams.get("access_type")).toBe("offline");
    const begin=calls.find(c=>c.url.pathname.endsWith("begin_google_oauth"))!;
    expect(begin.body.p_user_id).toBe(user);
    expect(begin.body.p_redirect).toBe("https://www.fflagent.com/settings?section=email-settings");
  });
  it("rejects an external return address before creating state",async()=>{
    expect((await startGoogleOAuth(request({redirect_to:"https://evil.test/settings"}),"email")).status).toBe(400);
    expect(calls.some(c=>c.url.pathname.includes("begin_google_oauth"))).toBe(false);
  });
  it("stores encrypted owner-bound credentials and returns a safe redirect",async()=>{
    const res=await finishGoogleOAuth(new Request("https://callback.example.test/email?state=synthetic&code=synthetic"),"email");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.fflagent.com/settings?section=email-settings&email_connected=1&email_provider=google");
    const write=calls.find(c=>c.url.pathname.endsWith("complete_google_oauth"))!;
    expect(String(write.body.p_access)).toMatch(/^gct\.v1\./);
    expect(JSON.stringify(write.body)).not.toContain("synthetic-access");
    expect(write.body.p_account_id).toBe("google-account");
  });
  it("does not exchange a denied or expired callback",async()=>{
    const denied=await finishGoogleOAuth(new Request("https://callback.example.test/email?state=s&error=access_denied"),"email");
    expect(denied.headers.get("location")).toContain("consent_denied");
    claimOK=false;
    const expired=await finishGoogleOAuth(new Request("https://callback.example.test/email?state=s&code=c"),"email");
    expect(expired.headers.get("location")).toContain("invalid_or_expired_state");
    expect(calls.some(c=>c.url.pathname==="/token")).toBe(false);
  });
  it("does not mark partial consent or a stale callback connected",async()=>{
    scope="openid";
    const partial=await finishGoogleOAuth(new Request("https://callback.example.test/email?state=s&code=c"),"email");
    expect(partial.headers.get("location")).toContain("required_permissions_missing");
    expect(calls.some(c=>c.url.pathname.endsWith("complete_google_oauth"))).toBe(false);
    scope=GMAIL_SCOPES.join(" ");completeOK=false;
    const stale=await finishGoogleOAuth(new Request("https://callback.example.test/email?state=s&code=c"),"email");
    expect(stale.headers.get("location")).toContain("connection_changed");
  });
  it("local disconnect never silently revokes Calendar authorization",async()=>{
    const res=await disconnectGoogleOAuth(request({connection_id:connection}),"email");
    expect((await res.json()).success).toBe(true);
    expect(calls.find(c=>c.url.pathname.endsWith("disconnect_google_oauth"))?.body.p_kind).toBe("email");
    expect(calls.some(c=>c.url.pathname==="/revoke")).toBe(false);
  });
  it("explicit removal revokes both connections without exposing credentials",async()=>{
    credentials=await Promise.all((["email","calendar"] as const).map(async kind=>({kind,refresh:await encodeToken("refresh",tokenContext(kind,user,"refresh"))})));
    const res=await disconnectGoogleOAuth(request({remove_all_google_access:true}),"email");
    const body=await res.json();
    expect(body.google_access_revoked).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/refresh|gct\./);
    expect(calls.filter(c=>c.url.pathname==="/revoke")).toHaveLength(2);
  });
  it("never claims revocation when no credential remains or Google failed",async()=>{
    let res=await disconnectGoogleOAuth(request({remove_all_google_access:true}),"email");
    expect((await res.json()).google_access_revoked).toBe(false);
    credentials=[{kind:"email",refresh:await encodeToken("refresh",tokenContext("email",user,"refresh"))}];revokedOK=false;
    res=await disconnectGoogleOAuth(request({remove_all_google_access:true}),"email");
    const body=await res.json();expect(body.google_access_revoked).toBe(false);expect(body.warning).toContain("Google Account");
  });
});
