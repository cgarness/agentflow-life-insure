# Leaderboard latency: capacity diagnosis and approved resize record

## Status and authorization

Prepared September 26, 2026, after the authorized latency re-pause and record PR #389 (main `e16a3c0181819e80cf608a0efa8aede428321e7e`). **Current state: the approved Nano → Small resize is applied and healthy; production organization standings remain paused.** Confirmation was submitted once at 21:07:20.458 UTC after the renewed call-free check. Small / 2 GB and the unchanged paused/security contract were verified by 21:10:24 UTC. The bounded ten-minute comparison is complete; see the execution result below and [verification.md](verification.md#approved-small-resize-executed-september-26-utc).

AGENT_RULES #28 requires separate exact approval for production configuration changes. Chris separately approved only Nano → Small and bounded read-only verification while paused, then confirmed the maintenance window with a required fresh dialing check. That approval does not authorize another reopening, profile-data conversion, Storage/RLS change, or subsequent resize. The earlier preparation and deferral history is preserved below.

### Earlier approval and call-free deferral (17:09–17:11 UTC)

Chris approved this exact resize at **10:09:12 America/Los_Angeles / 17:09:12 UTC on September 26**. The cost, restart warning and bounded paused verification are authorized; no repeated approval of those items is needed.

At **17:10:39.949 UTC**, the fresh database preflight matched the paused definition `75eec092f7039c2c8cb0cca93e93d1ae`, original owner/ACL/config/STABLE/SECURITY DEFINER and recorded re-pause migration. The provider was ACTIVE_HEALTHY; the review still listed only Nano → Small at the approved cost. However, a recent outbound call was still `ringing` with no `ended_at`. A targeted read at **17:11:17 UTC** confirmed that Alexa's call began at **17:07:08.87 UTC / 10:07:08.87 PT**, was last updated at 17:07:24.111, and still lacked a terminal state. Four earlier Alexa calls in the preceding fifteen minutes had completed. Six database dialer sessions marked active had no heartbeat within three minutes (newest heartbeat 03:56:13 UTC), so the session table alone does not establish a call-free window.

The recent call may be stale, but there is no authoritative provider read available here to prove it ended. Under step 1 below, **defer the resize until a call-free window is established**. `Confirm changes` has not been pressed; no call/session has been altered or terminated. Keep this approval valid, obtain confirmation that agents have stopped dialing or a specific maintenance window, and rerun the fresh activity check immediately before applying. Do not interpret an old ringing timestamp or stale session heartbeat alone as permission to restart.

The pre-resize API sample **17:05:19.658–17:10:19.658 UTC** contained one expected standings POST 503 at **1,580 ms** and 196 other REST requests, all 2xx (including twelve OPTIONS). Ordinary GETs: 139 requests, p95 120.1 ms, max 1,034 ms. A database sample found zero lock waiters and thirteen client connections. This was a baseline only; no post-resize result existed at that earlier checkpoint.

### Execution result after the renewed window (21:07–21:20 UTC)

Chris confirmed the earlier call was real and asked us to wait, then said the system was ready and requested another dialing check. The former blocker was now completed. The final check at **21:07:03.673 UTC** found **zero recent nonterminal calls and zero unended active dialer sessions with a heartbeat inside three minutes**; the latest call had ended at 21:06:35.498 UTC. Old inbound ringing rows and stale sessions were not rewritten or treated as current activity. The paused RPC hash/security still matched; zero lock waiters, 22 client connections.

The final review listed only the approved Nano → Small change and unchanged +$5.15/month pre-tax estimate. Confirmation was pressed **once at 21:07:20.458 UTC**. Supabase reported RESIZING, then ACTIVE_HEALTHY; PostgreSQL's new start time was 21:09:57.156 UTC. By **21:10:24 UTC**, Infrastructure read back **t4g.small / Small / 2 GB**, $0.0206/hour, with the same 8 GB gp3 / 3,000 IOPS / 125 MB/s / spend cap / region. The tier's displayed connection ceiling changed automatically from 60 to 90; no pool setting was manually edited. PostgreSQL remained 17.6 (provider build 17.6.1.063). No second resize, reboot, customer-data mutation, migration or application deployment was performed.

**Basic resize verification passes.** The pause hash `75eec092f7039c2c8cb0cca93e93d1ae`, owner/ACL/config/STABLE/SECURITY DEFINER, anon denial and authenticated execute privilege are unchanged. Both existing guard/re-pause migrations remain recorded; Group is unchanged. Signed-in Dashboard initial reads and one bounded Refresh completed, and both the widget and Leaderboard displayed maintenance with the five-minute hold respected.

The comparison window was **21:10:24.926–21:20:24.926 UTC**. Its 1,033 non-leaderboard REST requests all returned 2xx, including 150 OPTIONS. Ordinary GET p95 was **212.25 ms / 345 ms** in the first/second five-minute halves (256 / 348 GETs), versus **1,703.15 ms** across 42 GETs in the 20:56:43.464–21:01:43.464 baseline. All three standings POSTs returned the expected maintenance 503 at **1,825 / 1,914 / 1,934 ms**. Zero lock waiters were observed after recovery, at the delayed midpoint SQL check and at the end. Sign-in delayed the midpoint SQL/browser observation to 21:18:09; the log comparison still uses the exact planned five-minute windows. This is not continuous monitoring or a load test.

The post-restart memory bars have no visible Swap segment, unlike the earlier Nano bars; this is visual chart evidence, not an exact paging-rate measurement. Final report headlines: memory commitment 1.64 GB, CPU 3.49%. Disk/network/pool/connection time series remained unavailable after one report refresh; SQL connection samples were 16 / 19 / 23. The planned restart interval was excluded from steady-state comparisons but **not hidden**: its gateway logs contained 74 HTTP 521s, eight 522s and two REST 503s; see the detailed verification record.

**Not a leaderboard capacity/reopening pass.** Traffic mix and counts differ, the standings aggregate stayed off, and only three maintenance responses were observed. The near-two-second maintenance path remains unexplained and the almost-6 MB inline avatar payload remains unchanged. Keep the pause. Next work is a narrowly scoped API-path timing investigation and a reviewed avatar-payload repair preserving photographs; any code/data/configuration change or exact guarded-paused → active transition requires its own approval. Do not bypass the pause to benchmark or replay the original forward script.

## Evidence and attribution limits

1. Signed-in Dashboard, Leaderboard periods/metrics and TV functioned correctly. Three successful standings HTTP responses exceeded two seconds, triggering the agreed stop rule. The exact tested re-pause was applied at 16:32:24 UTC. See [verification.md](verification.md).
2. After re-pause, two expected maintenance HTTP responses still took 2,800 / 3,294 ms; a separate authenticated-role invocation of the paused function returned PT503 in 3.397 ms inside PostgreSQL. These are unpaired requests, so they do not identify a specific slow component. The paused path cannot execute the standings aggregate.
3. The signed-in infrastructure page confirms **Nano, AWS t4g.nano, us-east-1, up to 0.5 GB RAM**. The observed 08:52–09:52 America/Los_Angeles database report shows a persistent large Swap segment, visually approximately 0.65–0.8 GB, alongside about 0.4 GB physical memory. This is a graph estimate, not an exact tooltip measurement. Memory commitment is 1.96 GB. CPU headline is 9.83%; overview CPU was 6%, with 21/60 connections. A separate database sample had nine idle PostgREST connections and no lock waiters. Pool and disk report series failed to load even after one refresh.
4. **Swap allocation is not paging rate.** These charts support investigating memory capacity but do not prove current swap-in/out activity or a causal connection to the three slow HTTP requests. A resize is a measured capacity intervention, not a promised cure.
5. A bounded READ ONLY profile-size query found seven active agents in Chris's organization, three inline `data:` avatars, **5,961,926 total avatar bytes**, and a largest avatar of **3,115,174 bytes**. No avatar content was downloaded. The canonical RPC selects `p.avatar_url` for every active agent; both organization standings consumers request the full RPC result. Therefore each successful current roster result contains almost 6 MB of avatar text before JSON/transport encoding or compression. This is logical response content, not a measured wire-size figure.
6. `ProfileAvatarUploader.tsx` and `AvatarUploadPreview.tsx` use `readAsDataURL`; the profile settings path persists that data directly. `src/lib/profile/profile-queries.ts` already avoids avatar selection in the team roster because of this cost. The payload defect is concrete, but cannot explain slow maintenance responses, which contain no avatars.

## Exact approved change

Project: **AGENTFLOW CRM**, `jncvvsvckxhqgqvkppmj`, organization **AGENTFLOW Pro**.

| Setting | Before resize | Applied |
| --- | --- | --- |
| Compute | Nano | Small |
| Memory | Up to 0.5 GB | 2 GB |
| Hourly compute price, USD | $0.01344 | $0.0206 |
| Dashboard monthly estimate, before tax | $9.68 | $14.83 |
| Dashboard estimated difference | — | +$5.15/month |

These are compute estimates, not the total organization invoice. Actual charges are hourly; month length, credits and taxes affect billing. Keep the existing 8 GB gp3 disk, provisioned 3,000 IOPS / 125 MB/s, spend cap, region, database contents, roles, RPC definitions and application deployment unchanged. At confirmation the final review listed only **Compute size: Nano → Small**.

At preparation, Micro (1 GB) was available at the same hourly price as the old paid-plan Nano. Small was recommended as the first capacity test because the observed physical-plus-swap footprint was roughly above 1 GB and Small gives more headroom. That footprint includes cache/cold pages and is not a precise required-RAM calculation. Chris selected Small; Micro was not substituted. Any subsequent size change requires separate approval and another interruption assessment.

## Downtime and execution sequence after exact approval

The confirmation states: **“Project will restart automatically on confirmation”** and **“Resizes may require more downtime than normal on this project.”** General Supabase documentation says compute changes usually take under two minutes, but that is **not an estimate or guarantee for this project**. The interruption affects the shared production database, including CRM and dialer operations. Execute only in the approved call-free maintenance window.

1. Fresh read-only preflight: confirm project, Nano size, pending review with only Nano → Small, the quoted hourly price, and current paused RPC definition `75eec092f7039c2c8cb0cca93e93d1ae` with unchanged owner/ACL/config. Check for current active/ringing calls and active dialer sessions using existing canonical state. If live activity or uncertain session state conflicts with the window, defer the resize; do not terminate sessions. Record a bounded API and host baseline before the restart.
2. Press **Confirm changes once**. Record the start time and returned state. Do not change disk, pool limits, statement timeouts, grants, region or any other setting.
3. Observe the provider's progress at bounded intervals while keeping Chris informed. A delayed resize is not grounds for a second resize, manual reboot, project pause/restore, or session termination. If the project remains unhealthy, report the provider status and preserve evidence; escalation to support is a separate outbound communication decision.
4. Read back Small and the actual project health. Verify database reachability and the paused function's exact definition, security metadata and recorded migration. Check existing signed-in Dashboard read behavior and expected maintenance UI without making calls or creating test data. Do not reload an active call tab.
5. Once service is healthy, collect one ten-minute comparison window with a checkpoint at five minutes and the end. Use normal signed-in reads and at most three naturally permitted maintenance retries (respect the existing five-minute hold). Separate expected maintenance 503s from unexpected server errors; exclude the planned restart interval from steady-state latency comparisons, while recording all restart errors separately. Capture origin times, traffic counts, memory/swap trend, CPU, connections, lock waiters and the limitations of unavailable charts. No load test or repeated SQL/HTTP probe loop.
6. The resize passes basic verification only if Small is healthy, the pause/security contract is unchanged and ordinary CRM reads recover. Latency improvement is a separate measured finding: compare response distribution and individually observed maintenance reads to the pre-resize evidence. Sparse traffic cannot pass a capacity gate. Slow maintenance responses still over two seconds require continued API-path investigation; do not reopen to test around the pause.
7. Record the applied configuration, timing, cost and verification. Prepare the next concrete recovery change from those results. Another production reopening requires a newly reviewed exact preimage transition: the original forward script correctly refuses the current guarded-and-paused definition.

## Recovery boundaries

The standings pause remains the immediate containment throughout. Resizing does not alter or restore application SQL. There is no automatic downsize: it would cause another restart and may restore the same resource constraint. Nano is not generally launchable in paid organizations, so do not promise a one-click return to the historical Nano instance. If Small cannot stabilize, report the condition and prepare a specifically approved provider recovery or available-size change. Do not restore a database backup over live customer writes, kill sessions or relax the agreed stop thresholds.

## Avatar payload follow-up

Preserve the existing photographs and standings metrics. A lasting repair should use bounded image assets/URLs or a separately cached avatar read rather than resending full inline images with every standings response. Before choosing a production data conversion, inspect Storage ownership/privacy and both upload paths, prepare exact target/export/recovery validation under AGENT_RULES #28–29, and test the new upload/display contract on synthetic fixtures. A frontend projection alone reduces transferred columns but does not prove that the PL/pgSQL function avoids materializing its existing avatar output. No profile rows, image bytes, upload components, SQL contract or avatar visibility are changed by this proposal.

## Preparation file scope and checks

Only four documentation files: this new plan, root `implementation_plan.md`, the incident `verification.md`, and an additive newest-first `WORK_LOG.md` entry. No executable code or migration is included. Validate whitespace, links and preservation of every old WORK_LOG byte; run required root TypeScript and existing S1 verification gates. Application tests/build are not new evidence for a documentation-only proposal.

Preparation results: root `tsc --noEmit` exit 0 (the known empty root project), existing S1 23/23 and self-test 5/5, whitespace clean and old WORK_LOG bytes preserved. At preparation the resize was unexecuted; the separately approved execution and its verification are recorded above. The same four documentation files form the execution-record scope; no executable source changes are bundled.

Sources read September 26, 2026: signed-in Supabase Infrastructure and Database/Data API Reports; bounded catalog/profile-size SQL; repository consumers/uploaders; [Compute and Disk](https://supabase.com/docs/guides/platform/compute-and-disk), [Compute usage and billing](https://supabase.com/docs/guides/platform/manage-your-usage/compute), and [Reports](https://supabase.com/docs/guides/observability/reports). Primary docs and the project-specific confirmation control the cost/downtime proposal.
