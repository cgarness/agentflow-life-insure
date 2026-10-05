# Reporting and leaderboard production release — October 5, 2026

The approved correction is live. Production has **eight distinct audited policies, eight original sale events and $9,373.92 annualized premium**. The two missing events are repaired; original sale facts, client details, calls and appointments are preserved. This completes the approved forward release and exact policy repair. Historical call/booking accuracy still has the evidence gaps below.

Chris approved release October 4 at 05:35 PDT, the exact trusted-Dialer permission amendment at 05:46 PDT, and confirmed the coordinated write window October 5 at 09:10 PDT. Preflight at 16:16:08 UTC found no recent active calls or sessions. No synthetic production sale/booking, customer test communication or provider test call was initiated.

## Code and deployment

[PR #416](https://github.com/cgarness/agentflow-life-insure/pull/416) merged reviewed head `a773a70185d2e79fa60a26a170ac100a01bd8b4a` as production commit `51308ce16fb570ab668b87ab36df2a2b9abda995`. Both have tree `291b40e669497ebb7ea7f70f4ddefff49108cd13`.

| Component | Applied version / deployment | Verification |
| --- | --- | --- |
| Policy identity and sales | `20261005161611` | Exact approved SQL SHA-256 matches history. |
| Performance definitions | `20261005161623` | Exact approved SQL SHA-256 matches history. |
| Scoped summaries/details | `20261005161626` | Exact approved SQL SHA-256 matches history. |
| Booking/disposition receipts | `20261005161629` | Exact approved SQL SHA-256 matches history. |
| Call attempt/duration evidence | `20261005161632` | Exact approved SQL SHA-256 matches history. |
| Reader indexes | `20261005161634` | Exact approved SQL SHA-256 matches history. |
| External booking guard | `20261005161637` | Exact approved SQL SHA-256 matches history. |
| Trusted Dialer counts/ACL | `20261005161639` | Exact approved SQL SHA-256 matches history; anonymous execution removed, intended grants retained. |
| Voice status | v45 | ACTIVE, all seven deployed files match reviewed bundle, JWT setting preserved. |
| Google inbound calendar sync | v492 | ACTIVE, both deployed files match reviewed bundle, JWT setting preserved. |
| Primary frontend | `dpl_9SXpXgPJe2bNFmMK152b1N9ThJUd` | READY at the production commit; `www.fflagent.com` and entry asset HTTP 200. |
| Secondary frontend | `dpl_8HDQaV7h6qsjRepioaYKjpqVzLNh` | READY at the production commit; `agentflow-life-insure.vercel.app` and entry asset HTTP 200. |

Repository migration filenames now match recorded production versions. SQL bytes were not edited. Authored-to-applied paths, full SQL/bundle/asset hashes, repair IDs and readback values are in [production-release-evidence.json](production-release-evidence.json). Do not replay these operations or infer application from an old filename.

All 29 reviewed functions have intended owner/ACL configuration with no anonymous execution. The five new private tables and historical repair receipt table have RLS and owner-only access. Original DNC and atomic converter bodies retain MD5 `088c6d615225ccdca43f3099a5fbb65d` and `641ba66c96ca4a76f80c9c85eb9caa42`. Existing public-table RLS was not changed. Pre-existing advisor findings remain outside this release.

## Exact historical correction

After the observation period, six-link operation `20261005163257` attached identities to the six existing sales. Operation `20261005163300` inserted only the two approved missing sales, with monthly snapshots $58.45 and $41.64, original seller IDs, historical client-creation timestamp proxies, null campaign/call attribution and `celebrated=true`. These are historical records, not new October production. Neither operation invokes customer notifications.

| Period | Sale events | Annualized premium |
| --- | ---: | ---: |
| Lifetime / 2026 year | 8 | $9,373.92 |
| August 2026 | 4 | $6,168.60 |
| September 2026 | 4 | $3,205.32 |
| Week beginning September 28 | 2 | $1,201.08 |
| October 2026 / week beginning October 5 | 0 | $0.00 |

Both repair source hashes and complete event postimages match the owner-only receipts. All eight primary policy identities are present; no policy gap or unlinked original event remains. Client non-identity details, the original six sale non-identity facts, all 5,220 call rows and all 89 appointments have identical before/after aggregate hashes. The scripts remain outside automatic migrations under their authored `pending/` paths for exact review/test reproducibility; they are already applied. The guarded reversal was not executed.

## Reader and UI verification

The final exact-head native reporting, Dialer/DNC, A2P, policy/browser and full frontend gates passed. Real browser fixtures verified normal/mobile/TV totals, exact cents and seconds, ranks, visible photos, panel geometry, roster changes and a live policy/rank update. Full frontend comparison has 4,188 passing candidate tests versus 4,126 base, the same one baseline failed assertion, fewer failed files and 87 versus 88 existing app type diagnostics. No new failure or unhandled runtime error was accepted; the repository is not globally test-clean. Run/artifact references are in [verification.md](verification.md).

Production read-only transactions used the actual `authenticated` database role and current Admin/Agent/Team Leader profile claims. The active board has eight profiles and equal values across roles. Post-repair Admin, Teo and Will reads return the same eight secured feed events; their annual policy totals are respectively 8/$9,373.92, 1/$701.40 and 1/$499.68. Anonymous board access is denied.

At frozen as-of `2026-10-05T16:26:06.866872Z`, agency timezone `America/Los_Angeles`, October source and board totals agree: **1,263 recorded outbound calls, 15 bookings, zero policies/$0 and 19,662 talk seconds**. Today/current week are zero. These call/booking counts include unresolved legacy candidates. The read-only reconciliation at identical bounds confirms no applied duplicate mappings or missing booking receipt targets.

Observation ran from 16:21:35.084 to 16:32:11.607 UTC (636.523 seconds). Eight DB samples completed; single-month execution ranged 73.739–84.955 ms, with 192.549 ms for the three-period batch. Targeted Vercel and the two deployed Edge-function error scans found no matching errors. Two database rejections originated in the unchanged `heartbeat_dialer_session` function; no historical session was modified.

Secure hosted sign-in returned **“Failed to fetch”**. The attempt was stopped without retry or bypass and the tab was closed. Consequently no authenticated production browser walkthrough is claimed. No reporting HTTP requests appeared in the observation logs, so HTTP-origin latency and its two-slow-response stop rule were not measured. DB timings and isolated browser checks are separate evidence. Production has no active Group memberships; Group coverage comes from authorized isolated tests. Agents were told to refresh and resume after the verified repair checkpoint.

## Remaining data boundaries and recovery

- **277 call candidates** and **12 booking candidates** require provider/intent evidence. Nine booking rows form the exact-similarity subset; similarity alone does not select a canonical record. No candidate was deleted, excluded or assigned an invented duration/status.
- All 5,069 historical outbound duration rows remain `legacy_unknown`. The new provider evidence path improves forward records without asserting historical completeness.
- The two repaired event dates are disclosed `client_creation_proxy` values. They do not recover original sale timestamps.
- Reports UI and `get_report_*` remain owned by the separate build. Stored policy/sold-date/current-owner totals can intentionally differ from event-time/original-seller performance. See [reports_handoff.md](reports_handoff.md).

Keep additive schema, stable identities, receipts, legitimate events, duration evidence and raw operational history. A presentation revert may retain the new readers/writers; a blind old frontend or voice rollback is incompatible with the new booking/provenance enforcement. Pause affected actions and roll forward with a verified compatible fix. Any full backend downgrade needs a separate reviewed migration. The exact two-sale reversal only targets its recorded postimages; it does not authorize deleting original sales, disabling DNC or changing unrelated history.
