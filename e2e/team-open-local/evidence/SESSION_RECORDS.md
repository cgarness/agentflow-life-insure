# Session records: transcribed, not re-run

These outputs were printed by commands during the rev 7 local verification on 2026-09-24. They are
transcribed **verbatim** from the session's tool output, because they were not saved as files at the time.
The exceptions are marked:
- *(excerpt)*: `…` marks omitted text, and command lines may be abbreviated.
- *(excerpt, annotated)*: text in parentheses was added for this document.
- `<redacted-…>`: a local default credential was removed.
- **During publication** (R5 only): a comparison recomputed during publication on already-recorded data;
  labelled where it appears. Nothing in this file comes from a re-run of the stack, the app or the tests.

## R1. Egress policy and image sourcing

`curl "$HTTPS_PROXY/__agentproxy/status"` → `recentRelayFailures` *(excerpt)*:
```
2026-09-24T15:32:29.391Z  d2glxqk2uabbnd.cloudfront.net:443  gateway answered 403 to CONNECT (policy denial or upstream failure)
2026-09-24T15:33:15.305Z  pkg-containers.githubusercontent.com:443  gateway answered 403 to CONNECT (policy denial or upstream failure)
```

Docker Hub (allowed host) repeatedly returned:
```
Error response from daemon: error from registry: You have reached your unauthenticated pull rate limit. https://www.docker.com/increase-rate-limit
```

Pull outcomes (from `docker.io` after retries):
- `supabase/postgres:17.6.1.095` OK (try 1);
- `supabase/realtime:v2.78.18` OK;
- `supabase/postgres-meta:v0.96.1` OK;
- `supabase/gotrue:v2.188.1` OK (try 2);
- `kong:2.8.1` OK (try 1);
- `postgrest/postgrest:v14.7`: 429 on every try; **never pulled**;
- `supabase/storage-api:v1.44.11` OK (try 7).

PostgREST substitute (**not independently checksum-verified**) *(excerpt)*:
```
curl -sSL -o postgrest.tar.xz https://github.com/PostgREST/postgrest/releases/download/v14.7/postgrest-v14.7-linux-static-x86-64.tar.xz   → exit 0
curl … postgrest-v14.7-linux-static-x86-64.tar.xz.sha256                                                                                → "Not Found"
sha256sum postgrest.tar.xz → 3fb8d83b10b964d0258cf47d3b1775d8c38e4b8fae791f9efb0e7550973c6960
GitHub API release lookup → no asset digest returned
./postgrest --version     → PostgREST 14.7
docker build (FROM scratch; COPY postgrest /bin/postgrest; USER 1000; CMD ["postgrest"]) -t postgrest/postgrest:v14.7
```
The only integrity assurance was the TLS download from github.com / release-assets.githubusercontent.com.
The locally computed sha256 identifies the file; it was **not compared with an independently published
value**. The image was deleted at teardown.

## R2. Realtime could not start (kernel without IPv6)

*(excerpt)*
```
** (MatchError) … {:listen_error, RealtimeWeb.Endpoint.HTTP, :eafnosupport} …
ls /proc/sys/net/ipv6 → No such file or directory
```
Setting `[realtime] ip_version = "IPv4"` did not help. `[realtime] enabled = false` was set in the
disposable workspace config. **Realtime was not running; Realtime-driven behaviour was NOT tested.**

## R3. Isolation proofs

After `isolation.sh apply`:
```
-A DOCKER-USER ! -i br-abf72604415e -o br-abf72604415e -m conntrack --ctstate NEW -m comment --comment agentflow-localverify -j DROP
-A DOCKER-USER -i br-abf72604415e ! -o br-abf72604415e -m conntrack --ctstate NEW -m comment --comment agentflow-localverify -j DROP
-A INPUT ! -i lo -p tcp -m multiport --dports 54321,54322 -m comment --comment agentflow-localverify -j DROP
-A INPUT -i br-abf72604415e -m conntrack --ctstate NEW -m comment --comment agentflow-localverify -j DROP
```

Probes during the **first** stack start (bridge `br-1f5b69d70791`). The same four rules had been applied.
The stack was later restarted to add storage-api, which created bridge `br-abf72604415e`, and the rules were
re-applied there. These probe lines come from three separate commands *(excerpt, annotated)*:
```
loopback auth health 200
egress-blocked          (DB container → 1.1.1.1:443)
host-input-blocked      (DB container → 172.18.0.1:2024)
```
On the final bridge, the egress probe was repeated by `isolation.sh verify` (below). The host-input probe
was not repeated. Loopback reachability on the final stack is shown by the scenarios themselves.

**Full `isolation.sh verify` output** on the final stack, after migrations and the reference bootstrap and
before fixtures. It used the original (pre-hardening) script. The command piped the output through
`grep -v Terminated`, and the DB password in `DB_URL` (the local default) is redacted here:
```
== published ports (must be 127.0.0.1 or unreachable externally)
supabase_db_agentflow-localverify	0.0.0.0:54322->5432/tcp
supabase_pg_meta_agentflow-localverify	8080/tcp
supabase_storage_agentflow-localverify	5000/tcp
supabase_rest_agentflow-localverify	3000/tcp
supabase_auth_agentflow-localverify	9999/tcp
supabase_kong_agentflow-localverify	8001/tcp, 8088/tcp, 8443-8444/tcp, 0.0.0.0:54321->8000/tcp
== supabase status (API/DB/Auth/Realtime/Functions derive from API_URL)
API_URL = http://127.0.0.1:54321
DB_URL = postgresql://postgres:<redacted-local-default>@127.0.0.1:54322/postgres
GRAPHQL_URL = http://127.0.0.1:54321/graphql/v1
REST_URL = http://127.0.0.1:54321/rest/v1
STORAGE_S3_URL = http://127.0.0.1:54321/storage/v1/s3
== production ref absent from workspace config and env
absent: OK
== DB-side outbound HTTP + schedulers (expect empty config, no jobs, empty queue)
cron.job rows=2
net.http_request_queue rows=0
net._http_response rows=0
workflow config url=<empty>
twilio provisioning url=<empty>
== container egress probe (must fail)
egress blocked: OK
```
**Caveats on this output:**
- The published ports show `0.0.0.0` bindings. Loopback-only reachability comes from the tagged `INPUT` and
  `DOCKER-USER` rules above, not from the binding.
- Both files existed at that point, so the original script's production-ref grep was reliable here. The
  hardened script also fails when a file is missing.

`isolation.sh verify` after the final scenario run, before teardown. The command itself piped the output
through `grep -E "OK|FAIL|rows="` *(excerpt)*:
```
absent: OK
cron.job rows=2
net.http_request_queue rows=0
net._http_response rows=0
egress blocked: OK
```

`cron.job` contents:
```
inbound-notify-sweep|*/2 * * * *|SELECT public.sweep_inbound_notifications(100)
inbound-route-attempt-sweep|*/2 * * * *|SELECT public.sweep_inbound_route_attempts()
```
Both functions: `does_http = f`.

Functions in `public` / `private` whose source contains `net.http_(post|get)`:
```
private.workflow_dispatch_event
public.handle_new_organization_provisioning
```
During fixture load *(excerpt: one representative line of each kind; the triggers warn once per org and per
lead)*:
```
psql:<stdin>:20: WARNING:  Twilio subaccount provisioning skipped for org a1000000-0000-4000-8000-000000000001: private.twilio_provisioning_config not populated
psql:<stdin>:68: WARNING:  workflow_on_lead_created dispatch failed (lead a1000000-0000-4000-8000-0000000001a4): null value in column "url" of relation "http_request_queue" violates not-null constraint
```
The second warning is the swallowing wrapper (AGENT_RULES #10). No request was queued.

End state before teardown:
```
net queue|0
net responses|0
orgs|LV Main Test Org, LV Second Test Org
auth users|4
```

Teardown: several commands in one invocation, with annotations added here *(excerpt, annotated)*:
```
Stopped supabase local development setup.
removed agentflow-localverify rules
0   (iptables rules tagged agentflow-localverify remaining)
0   (containers named *localverify*)
0   (volumes named *localverify*)
removed locally-built postgrest image
dockerd stopped
```

## R4. RLS baseline

SQL as each user, with the claims GoTrue mints (`sub`, `role`, `app_metadata` from `auth.users`) under
`SET LOCAL ROLE authenticated`:
```
== agent1
org|a1000000-0000-4000-8000-000000000001|Agent
leads visible|1|Pat
campaign_leads visible|5|Olga,Oliver,Owen,Pat,Tessa
campaigns visible|LV Open Pool,LV Personal (Agent One),LV Team Campaign
== agent2
org|a1000000-0000-4000-8000-000000000001|Agent
leads visible|1|Owen
campaign_leads visible|4|Olga,Oliver,Owen,Tessa
campaigns visible|LV Open Pool,LV Team Campaign
== agentb
org|b1000000-0000-4000-8000-000000000001|Agent
leads visible|1|Bianca
campaign_leads visible|1|Bianca
campaigns visible|LV Org B Open Pool
== admin
org|a1000000-0000-4000-8000-000000000001|Admin
leads visible|5|Olga,Oliver,Owen,Pat,Tessa
campaign_leads visible|5|Olga,Oliver,Owen,Pat,Tessa
campaigns visible|LV Open Pool,LV Personal (Agent One),LV Team Campaign
```

An earlier attempt, **without** `app_metadata` in the claims, failed with *(excerpt)*:
```
ERROR:  stack depth limit exceeded … PL/pgSQL function get_org_id() line 17 at SQL statement …
```
This is the source of observation O4 in the report.

## R5. Personal comparison (S10 feature vs clean main)

**During the session**, the comparison command read the **raw** `evidence.json` files of:
- an **intermediate** feature-branch run of S05–S11 (raw sha256 `39c14d2e63cb1892…`, not published; it ran
  before the consolidated final run);
- the base run (raw sha256 `c5c794200bcfbec4…`, published as derived `base-S10/`).

It printed:
```
feature==base (first 700 chars, times normalised): True
```

**During publication**, the comparison was recomputed on the **published** excerpts: `final-run/` (raw
`ada0c77a0f2d6ee3…`) against `base-S10/`. The scenario rows carry these excerpts verbatim; the sanitizer only
redacts. This is a recomputation on recorded data, not a re-run:
```
lengths final/base: 681 681
line diff: '-12:24 PM EDT' / '+12:19 PM EDT'   (the only differing line)
```
All three raw S10 excerpts (intermediate, final, base) are 681 characters and differ from each other only in
the lead-local clock line.

**Scope:**
- Each `card excerpt` is `<main>`.innerText sliced to 700 characters. At 681 characters, each is the
  **complete** `<main>` innerText: header stats, campaign badge, lead card with fields and notes, Conversation
  History and composer, Hang Up/Skip, the Dispositions panel and Save / Save & Next.
- **Not compared:** content outside `<main>` (sidebar, top bar), form-field values and placeholders (not part
  of innerText), and visual rendering (the screenshots were not diffed).

## R6. Synthetic user ids (from the bootstrap output; used to read DB rows)

```
"admin":  "4def2ed9-6a63-491b-91b6-40e30a316c9b"
"agent1": "43b21d0a-9fca-43a4-a2e6-b0297be6cdf5"
"agent2": "0e39865a-0534-4a34-921e-1dcb78f1237a"
"agentb": "6e7ff725-1162-4eb0-8883-84dcd42c27c0"
```
Later resets re-ran `bootstrap.mjs`, whose `ensureUser` finds existing users, so these ids held for every
scenario. S09's win row `agent_id` `43b21d0a-…` is therefore Agent One.

## R7. Key and locality checks run inline during setup (before `local-env.mjs` existed)

After `supabase start`, an inline command wrote the disposable `lv.env.json` and printed:
```
API_URL http://127.0.0.1:54321 anon iss supabase-demo role anon
```
It then counted production-ref occurrences in the disposable files:
```
…/lv/lv.env.json:0
…/lv/status.json:0
```
`bootstrap.mjs` separately checks the service key's issuer (`supabase-demo`) on every run.
