# Production `twilio-sms` timing evidence (Gate 0, read-only)

This file records what supports the plan's statement that the server takes about 4.5–5.1 s per manual SMS. It also records what that number does not cover. The data was read from Supabase logs only: no message content, phone number, contact or credential was read or recorded, and no SMS was sent.

## Edge execution time

| Item | Value |
|---|---|
| Source | Supabase Logs Explorer, production project, through the Supabase MCP `query_logs` tool (read-only) |
| Log source | `function_edge_logs` (one row per request the Edge gateway hands to a function) |
| Filter | `log_attributes['function_id']` = the `twilio-sms` function's ID, and `log_attributes['request.method'] = 'POST'` |
| Window | 2026-10-08T15:15Z → 2026-10-14T18:51Z, as 7 consecutive queries of at most 24 h each (the tool's limit). Queries ran 2026-10-14 18:51:15–18:51:31Z. The start is the live deployment's `updated_at` (2026-10-08T15:15:56Z, from `get_edge_function`), so the samples reflect the code that was live then. |
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

For the v38 send whose Edge request was logged at 2026-10-14T00:18:48.501Z, the `edge_logs` source shows the Supabase API calls the function made. The query filtered on a Deno client between 00:18:42Z and 00:18:50Z and excluded six paths that belong to the background consent worker.

- **19 sequential calls:** 1 Auth (`/auth/v1/user`), 15 PostgREST reads, and 3 dispatch RPCs (`sms_prepare_dispatch`, `sms_start_dispatch`, `sms_finish_dispatch`).
- **Upstream time (`response.origin_time`):** 3,542 ms summed across the 19 calls, 82–329 ms each.
- **Span:** first call logged at 00:18:44.012, last at 00:18:48.393.

`origin_time` excludes the hop between the Edge runtime and the API gateway, so 3,542 ms is a lower bound for the time spent in these calls. The Twilio request itself is not in Supabase logs. It falls between `sms_start_dispatch` and `sms_finish_dispatch` (about 0.3 s apart in log time). This is one send: it supports the plan's backend recommendation (§10, B0 instrumentation first), not a general breakdown.

## Not measured

| Quantity | Status |
|---|---|
| Browser round trip in production: click → `twilio-sms` response, including the network, TLS and the session read | **Not measured.** There is no client timing in production, and this task authorises no live send. It is at least the Edge execution time above. |
| Carrier or handset delivery | **Not measured.** The function returns once Twilio accepts the message (receipt status `queued`). No delivery callback was read. Delivery time is outside both numbers above. |
| Cold starts | Present, and small. Joining `function_logs` by `execution_id` (2026-10-13T15:15Z → 2026-10-14T15:15Z) shows a `Boot` event for each of the three log-version-38 successes: boot 35–52 ms and CPU time 52–64 ms, ending with `Shutdown` reason `EarlyDrop`. Almost all of the 4.5–5.1 s is spent waiting on I/O, not computing. The v37 sample was not joined. |

The browser fixture (plan §13) replaces the server with a fixed 1,500 ms fake receipt. Its timings are a synthetic comparison of the base and candidate UI, not production latencies.
