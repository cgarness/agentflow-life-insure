# Reports refresh and R-3 correction — production release (2026-10-10)

**Status: SHIPPED on October 10, 2026 UTC** (evening of October 9, PDT).

**Approval.** Chris approved the coordinated release in session on 2026-10-10 at about 03:40 UTC: *"STATUS: PRODUCTION RELEASE APPROVED … Chris has approved the coordinated Reports release, including PR-A and the documented PR-B SQL correction."*

The same approval excluded these actions, and none was taken:
- S-1/S-3 permission changes
- unrelated schema or data changes
- Twilio/Dialer changes
- historical repairs
- destructive rollback

**Labels:**
- **[CATALOG]**: production read-only catalog
- **[DB-sim]**: production database-role simulation inside `begin read only … rollback`
- **[GitHub]**, **[Vercel]**: those services' APIs
- **[logs]**: Supabase logs, aggregated by path, status and count only

## 1. Exact release

| Item | Value |
|---|---|
| PR-A (frontend refresh) | [#436](https://github.com/cgarness/agentflow-life-insure/pull/436), merged 2026-10-10T04:19Z as **`b00bfedcc236f1a346236499ea71ef45a1af504e`** (merge commit; parents `a41ed8ea`, `3441d2de`). The merge tree `36c5e136e31eaa78c044d3a68e1b1220fa73b697` equals the verified head tree. |
| PR-A production deploy | Vercel `agentflow` **`dpl_Ai4dmqDT8KqMmDstJC5Bsw4Xinxb`**: READY at 04:20Z. It served `www.fflagent.com` and `fflagent.com` from about 04:20:27Z to 04:50:23Z. The build compiled 4,758 modules; entry asset `index-D1qdqzQ0.js`. |
| PR-B (R-3 SQL) | [#435](https://github.com/cgarness/agentflow-life-insure/pull/435), merged 2026-10-10T04:49Z as **`462fa12b7382f63a28f2f8a620897cd93b465e58`** (merge commit; parents `b00bfedc`, `aff4c3e4`). The merge tree `7e89db7a63a8088bff5cdad09cab8a7992ccefcf` equals the renamed head tree. |
| PR-B production deploy (currently serving) | Vercel `agentflow` **`dpl_DAYBGK7CTed17C924F1o9cqCE4HH`**: READY at 04:50Z. It has served `www.fflagent.com` and `fflagent.com` since 04:50:23Z. No frontend source changed. The entry asset is `index-5WIJfU-d.js`, 0.18 kB larger than PR-A's: the merge commit messages differ by exactly 181 characters, consistent with Vercel's system variables being inlined into the bundle. |
| Rollback candidate (frontend) | `dpl_CPrZT6CHyWNudUhXjU9dkiXWPutP` (`a41ed8ea`). The plan's rollback is a revert of the merge. No rollback was needed or performed. |
| Supabase GitHub integration | The "Supabase Preview" check on both merge commits is *skipped: not associated with any Supabase Branch*, so deploy-to-production stays off. No migration was replayed by either merge. [GitHub] [CATALOG] |

## 2. Applied migrations (R-3 window)

| Step | Recorded version and repository file | Authored as | Stored statement md5 / chars | File SHA-256 |
|---|---|---|---|---|
| 1 Disable | `20261010043358_reports_overlap_release_disable.sql` | `20261009170000` (== `supabase/ops/reports_disable.sql`) | `0f4a1d67b13148b54bc7a16fa8166a4d` / 3,882 | `17141977…079b2` |
| 2 Correction | `20261010043449_reports_integrity_quality_overlap_seconds.sql` | `20261009170100` | `682681302cc49405fc079094b59d7777` / 7,295 | `23288ee8…726f` |
| 3 Guarded enable | `20261010043517_reports_overlap_release_enable.sql` | `20261009170200` (== `supabase/ops/reports_integrity_enable.sql`) | `fe765592e9d469fe6631760088d0d865` / 4,503 | `d1698e45…a653` |
| Rollback (not applied) | `rollback/20261010043449_reports_integrity_quality_overlap_seconds.rollback.sql` | `20261009170100` | — | `0f066b8f…e470` |

Each stored statement is byte-identical to its repository file: the md5 of the raw file bytes equals the md5 of `statements[1]`. The steps ran one at a time, and each was read back before the next.

**Window.** Reports was disabled from 04:33:58 to 04:35:17 UTC, about 1 min 19 s. [logs] There were **no** `/rest/v1/rpc/get_report_*` or `report_layouts` requests between the PR-A deploy at 04:20Z and the end of the window, so no user saw "temporarily unavailable".

**Timing note (new practice).** Packet §7.1 requires renaming all four files to the recorded versions on the branch **before** the merge, with exact-head CI on the renamed head. The Oct 6 #41 release renamed them after the merge, in a closeout PR.

## 3. Preflight (step 0), immediately before the window [CATALOG] [DB-sim]

Captured 04:26–04:33Z:
- The newest migration was `20261008151523`, with nothing after it.
- 34 Reports functions. EXECUTE: anon 0, PUBLIC 0, authenticated 6, service_role 6 (exactly the six v2 RPCs).
- The quality reader was `d330c5bea75fb160a0f55e72ed2fe191`, ACL `{postgres=X/postgres}`.
- PR-B's enable had 14 of 15 pins matching, with only the quality pin pending.
- The historical `20261006044003` enable matched all 15 pins, so the recovery path was valid. Its stored md5 is `7858bbf0…`, equal to the file.
- Guards: the replay guard was false, the preimage guards passed 3/3, and the disabled-window guard refused, by design.
- **Advisors:**
  - security: 223 findings, identity sha256 `32f2fafb…56ae`
  - performance: 411 findings, identity sha256 `cc9ed9b4…dfb37`
  - identical to the 03:50Z capture
- DB-sim, W1–W5, as Chris (agency), the Team Leader (team) and Alexa (personal): the baseline below.

## 4. Readback after each step [CATALOG]

- **Step 1:** authenticated, anon and PUBLIC could execute 0 of 34 functions; service_role kept 6. The reader was still `d330c5be`.
- **Step 2:** the reader is `c1355d551fba0cc2217150f5531d1b31`, with ACL `{postgres=X/postgres}`, owner `postgres`, SECURITY INVOKER, STABLE and `search_path=pg_catalog, pg_temp`.
- **Step 3:** 34 functions. Authenticated and service_role can each execute exactly the six v2 RPCs; anon and PUBLIC 0. PR-B's enable matches **15 of 15 pins**. The historical enable now refuses (14 of 15), as designed. Exactly three new migration rows exist.

## 5. Read-back of results (step 4) [DB-sim]

`overlap_seconds_removed` before → after, on **all five** quality-bearing RPCs (summary, volume, dispositions, campaigns, lead sources):

| Actor / scope | W1 Oct 1–7 | W2 Sep | W3 Sep 8–Oct 7 | W4 Oct 6 | W5 12 months |
|---|---|---|---|---|---|
| Chris / agency | 3 → **0** | 4 → **0** | 2 → **0** | 1 → **0** | 5 → **0** |
| Team Leader / team | 1 → **0** | 1 → **0** | 1 → **0** | 0 → 0 | 1 → **0** |
| Alexa / personal | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |

`overlapping_rows` is 0 everywhere. On today's data the packet's expectation that "TL team is already 0" was not true: the team scope showed 1 s of the same rounding residue, which the correction also removed.

**Every other metric is identical to the pre-window baseline** (scripted comparison):

| Actor / scope | Window | Calls / contacted / talk s / bookings / session s / policies / known annual premium |
|---|---|---|
| Chris / agency | W1 | 1,833 / 135 / 39,893 / 25 / 95,862 / 1 / $1,281.60 |
| Chris / agency | W2 | 2,946 / 232 / 67,374 / 43 / 417,083 / 4 / $3,205.32 |
| Chris / agency | W3 | 4,136 / 310 / 93,237 / 60 / 396,827 / 4 / $3,831.72 |
| Chris / agency | W4 | 177 / 14 / 5,103 / 5 / 6,460 / 0 / $0 |
| Chris / agency | W5 | 5,639 / 452 / 120,246 / 99 / 809,767 / 9 / $10,655.52 |
| Team Leader / team | W1 | 1,584 / 122 / 33,582 / 13 / 88,859 / 0 / $0 |
| Team Leader / team | W5 | 3,381 / 286 / 73,065 / 22 / 262,117 / 2 / $1,201.08 |
| Alexa / personal | W1 | 132 / 11 / 5,217 / 10 / 2,287 / 1 / $1,281.60 |
| Alexa / personal | W5 | 1,757 / 118 / 42,555 / 65 / 404,454 / 7 / $9,454.44 |

The other team and personal windows also match exactly. Chris's agency values also equal the Phase 1 audit (`verification.md` §6), so the closed windows show no data drift.

**Advisors after the window (04:36–04:37Z):**
- Security: 223, identity sha256 unchanged. All six `get_report_*_v2` findings are present under `authenticated_security_definer_function_executable`, and none under the anon lint.
- Performance: 411, sha256 unchanged, with no drift even in the stats-driven lints.

## 6. CI on the exact released heads [GitHub]

| PR / head | Reports backend (PG 17.6 + browser + axe) | Reports frontend | Reporting integrity | Dialer DNC | SMS consent |
|---|---|---|---|---|---|
| #436 `3441d2de` | 38018320687 ✓ | 38018320718 ✓ | 38018320736 ✓ | 38018320692 ✓ | (not triggered) |
| #435 pre-window `c036f0a8` | 38023922943 ✓ | 38023922905 ✓ | 38023922888 ✓ | 38023922903 ✓ | 38023922984 ✓ |
| #435 renamed `aff4c3e4` (merged) | 38024837281 ✓ | 38024837301 ✓ | 38024837304 ✓ | 38024837231 ✓ | 38024837276 ✓ |

**Local runs:** native PostgreSQL 16.15 ran all four suites on the combined PR-A + PR-B tree, before and after the rename.
- overlap compare: 60 payloads, 20 corrected
- 17 Reports integrity negative controls, plus 3 overlap controls
- the rollback proof restores the byte-identical preimage

PR-A's earlier run 38017618975 failed on a browser-gate focus check that raced Radix's 0 ms focus-return timer. `3441d2de` fixed the gate, not the product.

## 7. Production verification after release

Read-only verification ran after the release, 04:38–05:25Z. Each statement ran inside `begin read only … rollback`, using repeatable read where two sides had to share one snapshot. Evidence files are kept outside the repository. No live CSV or payload is committed; only hashes and counts are recorded.

| Area | Result | Evidence |
|---|---|---|
| Calls and Contacted | **Pass** | [DB-sim] vs [independent SQL] in one snapshot. Agency: W1 1,833 / 135, W3 4,136 / 310, open day 2026-10-09 175 / 3. The No Answer over 45 s exclusion was applied (42 calls in W1, 61 in W3). Team (Team Leader), personal (two Agents) and the restricted Agent also match in 12 more cases. |
| Talk time and session time | **Pass** | Agency: W1 39,893 s / 95,862 s, W3 93,237 / 396,827, today 2,680 / 2,164. The independent gaps-and-islands union equals the RPC, and so does the per-agent session map. `overlap_seconds_removed` is 0 wherever `overlapping_rows` is 0. Session seconds equal the pre-window and post-window values. |
| Bookings and dispositions | **Pass** | W1 25 bookings (appointment 5 / callback 5 / unknown 15), W3 60. Disposition buckets and the histogram sum to calls made and equal the Phase 1 values. Σby_date, Σby_hour, Σby_day_of_week and Σheatmap all equal calls made. |
| Policies Sold and Known Annual Premium | **Pass** (69/69 checks) | W1 1 / $1,281.60, W2 4 / $3,205.32, W3 4 / $3,831.72, W5 9 / $10,655.52. Monthly ×12 holds, known + unknown equals the policy count, and by_agent + unattributed equals the totals. For September 2026, Reports equals the Leaderboard (`performance_rows`) equals the independent recompute: 4 / $3,205.32, over the same 4 policy identities. |
| Campaign and lead-source reporting | **Pass** | Calls: campaign + attribution-unavailable = summary calls (W1 1,146 + 687 = 1,833 … W5 3,475 + 2,164 = 5,639), and lead source + unattributed = summary calls. Policies and premium partition likewise. The restricted Agent sees no hidden campaign: 0 occurrences, and those calls are in the unavailable bucket. |
| Personal / Team / Agency authorization | **Pass**, one pre-existing deviation | 31/32 checks pass: the scope matrix, NULL resolving to the maximum scope, `p_agent_id` narrowing, 42501 for out-of-scope agents, a forged organization and an unknown sub, and grants (anon 0; authenticated exactly the six v2 RPCs). The Team Leader's downline set equals an independent recursive upline query. **Deviation 3k:** with `request.jwt.claims = ''` in a direct SQL session, the RPCs return SQLSTATE 22P02 instead of 42501, from the shared `public.get_org_id()` (unchanged since the baseline). Access is still denied, PostgREST cannot produce this state, and it predates this release. Follow-up task. |
| Date ranges and time zone | **Pass** | The agency time zone is America/Los_Angeles, and W1 is [10-01T07:00Z, 10-08T07:00Z). 2026-03-08 is a 23 h day and 2026-11-01 a 25 h day. by_date is complete; single-day and today windows are correct; reversed or over-366-day ranges are refused. The real `presetRange` code gives identical ranges in 8 browser time zones. Live calls cannot show DST bucketing, since there are none before 2026-05-20. |
| CSV export consistency | **Pass** | [local, real export code] The real Reports page and export code from `main` (src tree `61553436`, identical at `b00bfedc` and `462fa12b`) ran in jsdom on live agency W1 payloads.<br>• 29 CSV kinds, the same set as the golden baseline; headers equal the golden ones.<br>• 538 data rows equal the payload, with 40 money cells exact.<br>• 65 null values export blank.<br>• The Sessions Note reads "0 overlapping rows; 0 duplicate seconds removed".<br>• C-1's `k/n` format is unchanged, and the formula guard is active.<br>• A 7-mutation negative control was caught. |
| Database, deployment and console errors | **Pass / partial** | [logs] postgres has 0 ERROR from app traffic since the deploy; the only two ERRORs came from the verifiers' own catalog SQL. Edge shows 0 Reports requests at 400 or above. Vercel shows 0 runtime errors in both projects. The migration list is unchanged after both merges. Browser console errors need a signed-in session: **unverified** (§8). |

**Other notes:**
- The Team Leader's team now resolves to 4 agents. Phase 1 recorded 2. The change traces to Chris's in-app profile edits on 2026-10-09 at 15:47Z, which is ordinary data and unrelated to this release.
- Agency today (175) = Team Leader team (172) + Alexa (3).

## 8. Not verified, and why

- **Hosted signed-in walkthrough (plan §9.4): Unverified (owner checklist pending).** This environment has no browser linked to a signed-in account and no credentials, and its proxy blocks `www.fflagent.com`. The approved plan treats §9.4 as a post-release owner checklist, not a merge gate: §9.3 lists the release steps without it, and the Oct 6 releases shipped the same way. Nothing here claims it passed.
  - Chris should run it on desktop and an iPhone:
    - both production values on the first screen
    - period select, scope tabs, agent filter, Refresh
    - Data basis
    - Customize: save, cancel, reset
    - Summary, Agent and Campaign CSV downloads
    - an A → B → A filter switch
- **Served bundle contents.** No read-only Vercel API exposes the served files (`list_deployment_files` returns 404 for git deployments), and bypass-link fetches were deliberately not used. That the served entry contains the new strings is inferred from the tree equality and the successful builds above, not read from the CDN.
- **Browser console errors** need a signed-in session. Vercel runtime errors (none) and Supabase logs are covered in §7.
- **Not certified, unchanged from the audit:** 277 call and 12 booking unreviewed duplicate candidates; legacy duration provenance.
- **Repo replay safety.** `main` still holds six migration files whose versions production never recorded: the `20260806000000` baseline and five SMS files recorded under other versions. Keep Supabase deploy-to-production **off** (AGENT_RULES #30). This release does not change that.

## 9. Security boundaries

- S-1 (Team Leader `company_settings.timezone` RLS) and S-3 (agent-writable `dialer_sessions` timestamps) are **unchanged**. No RLS policy, table grant, trigger, Edge Function, Twilio or Dialer code, or data row was modified.
- The only grant statements were the guarded Reports-only revoke and re-grant inside the window. They restored exactly the pre-window EXECUTE set: the six v2 RPCs for authenticated and service_role, and anon 0.
