# Production `twilio-sms` timing evidence (Gate 0, read-only)

This file records what supports the plan's statement that the server takes about 4.5–5.1 s per manual SMS. It also records what that number does not cover. The data was read from Supabase logs only: no message content, phone number, contact or credential was read or recorded, and no SMS was sent.

## Edge execution time

| Item | Value |
|---|---|
| Source | Supabase Logs Explorer, production project, through the Supabase MCP `query_logs` tool (read-only) |
| Log source | `function_edge_logs` (one row per request the Edge gateway hands to a function) |
| Filter | `log_attributes['function_id']` = the `twilio-sms` function's ID, and `log_attributes['request.method'] = 'POST'` |
| Window | 2026-10-08T15:15Z → 2026-10-14T18:51Z, as 7 consecutive queries of at most 24 h each (the tool's limit; the last covers about 3.6 h). Queries ran 2026-10-14 18:51:15–18:51:31Z. The start is the current deployment's `updated_at` (2026-10-08T15:15:56Z, from `get_edge_function`). Whether every sample ran that deployment's code was not established (see the version note below). |
| Retention | Older logs exist: `select count(*), min(timestamp), max(timestamp) from logs where source = 'function_edge_logs'` returned 1,767 rows for 2026-09-29, 1,344 for the 24 h from 2026-10-06T18:00Z, and 3,180 for the 24 h from 2026-10-07T18:00Z (all functions). The window starts at the deployment, not at the retention limit. |
| Metric | `log_attributes['execution_time_ms']`: the time the Edge runtime spent on the request, from the gateway handing it over to the function's response |
| Sample | 6 POSTs in total, 4 of them HTTP 200 |

Results:

| HTTP status | Log `version` | Count | `execution_time_ms` | When (UTC) |
|---|---|---|---|---|
| 200 | 37 | 1 | 4,462 | 2026-10-08 18:09 |
| 200 | 38 | 3 | 4,518 · 5,143 · 4,622 (unordered) | 2026-10-13 20:32 → 2026-10-14 00:18 |
| 503 | 37 | 1 | 2,806 | 2026-10-08 16:45 |
| 401 | 37 | 1 | 283 | 2026-10-08 15:16 |

So: **4 successful sends, Edge execution time 4,462–5,143 ms.** Four samples show the order of magnitude, not a distribution. The log's `version` attribute reads 37 for the first three rows and 38 for the last three. How that attribute maps to the dashboard's version number (live: v38) was not established.

Query (one per 24-h window; the function ID is replaced by a placeholder here):

```sql
select log_attributes['response.status_code'] as status,
       log_attributes['version'] as fn_version,
       count(*) as n,
       groupArray(toFloat64OrNull(log_attributes['execution_time_ms'])) as exec_ms,
       min(timestamp) as first_ts, max(timestamp) as last_ts
from logs
where source = 'function_edge_logs'
  and log_attributes['function_id'] = '<twilio-sms function_id>'
  and log_attributes['request.method'] = 'POST'
group by status, fn_version
order by n desc
```

## Where the time goes: one trace

For the log-version-38 send whose Edge request was logged at 2026-10-14T00:18:48.501Z, the `edge_logs` source shows the Supabase API calls the function made. The query filtered on a Deno client between 00:18:42Z and 00:18:50Z and excluded six paths that belong to the background consent worker.

- **19 sequential calls:** 1 Auth (`/auth/v1/user`), 15 PostgREST reads, and 3 dispatch RPCs (`sms_prepare_dispatch`, `sms_start_dispatch`, `sms_finish_dispatch`).
- **Upstream time (`response.origin_time`):** 3,542 ms summed across the 19 calls, 82–329 ms each.
- **Span:** first call logged at 00:18:44.012, last at 00:18:48.393.

Per-call timeline (logged time UTC, method, path, `origin_time` ms):

| Logged | Call | origin ms |
|---|---|---|
| 00:18:44.012 | GET /auth/v1/user | 329 |
| 00:18:44.372 | GET /rest/v1/profiles | 238 |
| 00:18:44.633 | GET /rest/v1/sms_agency_policies | 240 |
| 00:18:44.900 | GET /rest/v1/leads | 248 |
| 00:18:45.166 | GET /rest/v1/a2p_registrations | 259 |
| 00:18:45.447 | GET /rest/v1/a2p_numbers | 84 |
| 00:18:45.552 | GET /rest/v1/phone_numbers | 250 |
| 00:18:45.820 | GET /rest/v1/sms_agency_policies | 285 |
| 00:18:46.118 | GET /rest/v1/phone_numbers | 264 |
| 00:18:46.399 | GET /rest/v1/a2p_accounts | 82 |
| 00:18:46.496 | GET /rest/v1/a2p_registrations | 261 |
| 00:18:46.777 | GET /rest/v1/phone_numbers | 234 |
| 00:18:47.026 | GET /rest/v1/a2p_numbers | 234 |
| 00:18:47.625 | GET /rest/v1/profiles | 84 |
| 00:18:47.738 | POST /rest/v1/rpc/sms_prepare_dispatch | 91 |
| 00:18:47.848 | GET /rest/v1/leads | 95 |
| 00:18:47.967 | GET /rest/v1/clients | 87 |
| 00:18:48.075 | POST /rest/v1/rpc/sms_start_dispatch | 84 |
| 00:18:48.393 | POST /rest/v1/rpc/sms_finish_dispatch | 93 |

**Inferred gaps, not measured.** Two gaps appear if each logged time is taken as the call's start:
- 00:18:47.026 + 234 ms → 00:18:47.625 leaves about 365 ms. Reading the code attributes it to credentials plus two Twilio sender checks.
- 00:18:48.075 + 84 ms → 00:18:48.393 leaves about 234 ms. The code places the Twilio send there.

Trace query (`edge_logs`):

```sql
select timestamp, log_attributes['request.method'] as method, log_attributes['request.path'] as path,
       log_attributes['response.status_code'] as status, log_attributes['response.origin_time'] as origin_ms,
       log_attributes['request.sb.jwt.authorization.payload.role'] as auth_role
from logs
where source = 'edge_logs'
  and (lower(log_attributes['request.headers.x_client_info']) like '%deno%'
       or lower(log_attributes['request.headers.user_agent']) like '%deno%')
  and (log_attributes['request.path'] like '/rest/v1/%' or log_attributes['request.path'] like '/auth/v1/%')
  and log_attributes['request.path'] not in ('/rest/v1/sms_bridge_nonces', '/rest/v1/sms_suppressions',
      '/rest/v1/rpc/sms_claim_confirmations', '/rest/v1/a2p_event_inbox', '/rest/v1/rpc/commit_a2p_snapshot',
      '/rest/v1/a2p_email_outbox')
order by timestamp
-- window 2026-10-14T00:18:42Z → 00:18:50Z
```

`origin_time` excludes the hop between the Edge runtime and the API gateway, so 3,542 ms is a lower bound for the time spent in these calls. The Twilio request itself is not in Supabase logs. It falls between `sms_start_dispatch` and `sms_finish_dispatch` (about 0.3 s apart in log time). This is one send: it supports the plan's backend recommendation (§10, B0 instrumentation first), not a general breakdown.

## Not measured

| Quantity | Status |
|---|---|
| Browser round trip in production: click → `twilio-sms` response, including the network, TLS and the session read | **Not measured.** There is no client timing in production, and this task authorises no live send. It is at least the Edge execution time above. |
| Carrier or handset delivery | **Not measured.** The function returns once Twilio accepts the message (receipt status `queued`). No delivery callback was read. Delivery time is outside both numbers above. |
| Cold starts | Present, and small. Joining `function_logs` by `execution_id` (2026-10-13T15:15Z → 2026-10-14T15:15Z) shows a `Boot` event for each of the three log-version-38 successes: boot 35–52 ms and CPU time 52–64 ms, ending with `Shutdown` reason `EarlyDrop`. Almost all of the 4.5–5.1 s is spent waiting on I/O, not computing. The log-version-37 sample was not joined. |

The browser fixture (plan §13) replaces the server with a fixed 1,500 ms fake receipt. Its timings are a synthetic comparison of the base and candidate UI, not production latencies.
