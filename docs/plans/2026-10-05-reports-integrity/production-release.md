# Reports Phase 1 production release

**Status: shipped October 6, 2026 UTC (October 5 PDT).** The owner approved the reviewed production rollout October 5 at 20:33:16 PDT. The implementation is live; the hosted verification limits below remain explicit. This record supersedes earlier candidate-only deployment status in this directory without rewriting those historical checkpoints.

## Exact release

- [PR #418](https://github.com/cgarness/agentflow-life-insure/pull/418) approved candidate: `d11b4b0108b51a313559dc453105031b0ff56bb9`.
- Production merge: `960accd10b828cb113c690a9f9dd07e2c1217e28`; candidate and merge share tree `573a6e32d69e4392e5ab2563b8f0a94007ad50fd`.
- Production Supabase: `jncvvsvckxhqgqvkppmj`.
- Canonical production: [www.fflagent.com](https://www.fflagent.com), deployment `dpl_LBUnKEgCQB89QJDWQbQeUbQU3CRV`.
- At `2026-10-06T04:39:30Z`, `/reports` and deployed `assets/index-miVd3Ss4.js` returned HTTP 200. The asset contains all six v2 RPC names, requested scope, basis/as-of metadata and monthly-premium basis; its SHA-256 is `85e40bee28279f05e6745a880a7136ff463b1a1d8aacb02baea33e9516878653`. Its public Supabase configuration points to the approved project. No credential values were recorded.

## Applied migration order and byte identity

The following repository filenames match actual hosted migration versions. Each SQL body remains byte-identical to its reviewed source. These are completed operations; never replay them merely because an earlier record described them as pending.

| Order | Recorded version and repository suffix | Authored version/source | SQL SHA-256 |
| --- | --- | --- | --- |
| 1 | `20261006043725_reports_integrity_release_disable.sql` | CLI `20261006043651`; exact `supabase/ops/reports_disable.sql` | `17141977ba6480f8e99153665e185385e3f6ef203b122efdf67947a62d5079b2` |
| 2 | `20261006043731_reports_integrity_readers.sql` | `20261005183955` | `1f1efcec700a9dc6926ea01eddb0a56ce670a157fedcd353783bcf2df7d05f29` |
| 3 | `20261006043738_reports_scopes_and_policy_premium.sql` | `20261005184012` | `f88855ae14cfd95f79c91fcf1d2512378d135f482dc1ac57ce8b16e9815578f6` |
| 4 | `20261006044003_reports_integrity_release_enable.sql` | CLI `20261006043701`; exact `supabase/ops/reports_integrity_enable.sql` | `a5433ce838eec87b338c9b3a79cfc939e2fdfb30ac232a4d948227522ae98a32` |

The release used a Reports-only disabled window. The guarded enable ran after deployment. The `2026-10-06T04:42:19Z` catalog readback matched all fifteen expected bodies and metadata: only the six v2 RPCs grant authenticated/service-role access; all 34 checked functions deny anonymous execution. The v1 readers remain sealed. Refresh loads the v2 frontend; an already-open page may retain cached data until refreshed. No historical duplicate mapping, data repair, RLS change, Edge release or calling-writer change is included in this release.

## Release gates and preflight

All four gates passed on exact approved candidate `d11b4b0108b51a313559dc453105031b0ff56bb9`:

| Gate | Successful run |
| --- | --- |
| Reports backend verification, including native SQL and isolated browser | [37364514155](https://github.com/cgarness/agentflow-life-insure/actions/runs/37364514155) |
| Reports frontend verification | [37364514029](https://github.com/cgarness/agentflow-life-insure/actions/runs/37364514029) |
| Reporting integrity | [37364514065](https://github.com/cgarness/agentflow-life-insure/actions/runs/37364514065) |
| Dialer DNC integrity | [37364514094](https://github.com/cgarness/agentflow-life-insure/actions/runs/37364514094) |

The final read-only production preflight at `2026-10-06T04:36:35Z`–`04:36:40Z` matched all 21 audited function preimages/dependencies, owners, security modes, volatility, pinned search paths and effective ACLs. Required schema dependencies matched; the reviewed duplicate map contained zero rows. Security advisor category counts remain unchanged: six intended v1 SECURITY DEFINER findings are replaced by six corresponding secured-v2 findings, while the other 209 finding identities are unchanged. No unexpected advisor regression was found. Production database checks passed: 31/31 aggregate reconciliations across all six payloads, permitted Admin/Agent/Team Leader scope and filter simulations using current profiles, and seven expected authorization denials (SQLSTATE 42501). These are database-role simulations, not three real JWT HTTP sessions.

## Hosted verification and limits

The administrator completed manual production login. The actual authenticated production browser rendered the default Last 30 Days Reports view and all six v2 panels. Static deployment evidence independently proves the deployed v2 asset and its exact source tree. Bounded service logs additionally contain authenticated Admin POST 200 entries for scope, summary, disposition and campaign, with no Reports error status in the reviewed window. Source has only an OPTIONS entry and volume has no returned entry; absent log rows are not counted as request failures or proof of complete six-route HTTP coverage.

The production CSV download was blocked by ChatGPT native credential protection at the download API. The subsequent browser reset/rebind was also blocked, leaving live CSV download, filter narrowing and refresh walkthroughs incomplete. Do not describe these actions as passed or imply that every application role completed hosted HTTP verification. Database-role simulations and exporter execution against actual hosted aggregates are separate evidence. A local non-browser React harness executed unchanged production export callbacks for five CSVs and passed 201 assertions. It verified schemas, metadata, exact seconds/premium values, attribution partitions, permission and stale-page guards. Auth/data/presentation dependencies and the download transport were stubbed. This does not prove a hosted browser download. Actual all-unknown, partly-known and known-zero premium edge cases remain covered by synthetic CI, not the observed live cohort.

The isolated native-backed browser gate covers real Reports components/hooks, date filtering, premium coverage, exact seconds/cents, visible chart geometry, real synthetic CSV downloads, unknown values, unavailable attribution, panel failure/retry and stale-window withholding. It does not replace the explicitly incomplete hosted actions above. Secondary deployment functionality is not asserted; its pre-existing missing public configuration remains outside this release correction.

Historical call/booking candidates and legacy duration provenance retain their disclosed limitations. There is no all-history accuracy certification. Reports continues the stored-policy sold-date/current-owner/current-premium contract, separately from original sale-event reporting.

## Recovery and closeout

Use the version-aware disable source as a new approved forward operation if recovery is needed. Preserve helpers, raw history and duplicate-review evidence. Re-enable only the exact verified v2 bodies using the guarded v2 enable source; do not restore v1 access or use the obsolete enable source blindly.

The closeout branch performs filename/reference/documentation reconciliation only. The two implementation SQL hashes and both release-operation hashes must match this table. Active fixture/schema references use recorded versions; historical authored-version records remain intact. The source manifest is refreshed for the recorded closeout. Application behavior and every applied SQL byte remain unchanged.
