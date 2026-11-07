# Reports V2 — Package A production release record

Recorded November 7, 2026 Pacific. This consolidates observed workflow and independent read-only verification evidence from PR #517 and the approved release turns. It is not permission to replay any stage.

## Source and authorization

Repository: cgarness/agentflow-life-insure. Production: jncvvsvckxhqgqvkppmj. Merged main: `15d967320af7a0bd9774e09bc57e0dd31f97900c`, tree `9f51f65472b05a332951fe1c484d5514b6233451`, identical to approved PR head `c5dd73950ebc9d0363c06e47ff162ac2ee63ce9c`. Original frozen candidate: `38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c`. All 36 release files remain byte-identical. Source amendments now being prepared are documentation only and not published.

Chris approved the backend merge and each production stage separately. The protected workflow verified cgarness reviewer, main-only branch restriction and administrator bypass off. No safeguards were removed. Supabase automatic production deployment was verified OFF before merge; this preparation did not change settings. Both linked Vercel projects previously reached READY at the merge SHA with the existing frontend; that evidence does not mean the Reports V2 UI is released.

## Completed workflow runs

| Stage | Run | Result |
|---|---|---|
| `check` | [42379475698](https://github.com/cgarness/agentflow-life-insure/actions/runs/42379475698) | Success |
| `apply-20261105120010` | [42379873874](https://github.com/cgarness/agentflow-life-insure/actions/runs/42379873874) | Success |
| `apply-20261105120011` | [42380250782](https://github.com/cgarness/agentflow-life-insure/actions/runs/42380250782) | Success |
| `apply-20261105120012` | [42380597725](https://github.com/cgarness/agentflow-life-insure/actions/runs/42380597725) | Success |
| `apply-20261105120013` | [42381050113](https://github.com/cgarness/agentflow-life-insure/actions/runs/42381050113) | Success |
| `apply-20261105120014` | [42394203830](https://github.com/cgarness/agentflow-life-insure/actions/runs/42394203830) | Success |
| `apply-20261105120015` | [42394695634](https://github.com/cgarness/agentflow-life-insure/actions/runs/42394695634) | Success |
| `apply-index-concurrently` | [42396095640](https://github.com/cgarness/agentflow-life-insure/actions/runs/42396095640) | Success |
| `apply-enable-20261105120017` | [42396702974](https://github.com/cgarness/agentflow-life-insure/actions/runs/42396702974) | Success |
| `read-back` | [42397016852](https://github.com/cgarness/agentflow-life-insure/actions/runs/42397016852) | Success |
| `record-history` | [42400253012](https://github.com/cgarness/agentflow-life-insure/actions/runs/42400253012) | Success |

The six creation migrations ran once and created sealed objects. The calls index ran concurrently. A8 independent catalog verification preceded enable. Enable granted exactly 15 report readers (six v2/nine v3) to authenticated and service_role. Private helpers and legacy RPCs remain sealed. The two indexes were verified ready/valid.

## Applied and recorded migration identities

| Migration | Bytes | Source SHA-256 | CLI statements | Recorded statement SHA-256 |
|---|---:|---|---:|---|
| `20261105120010_reports_v3_foundation.sql` | 53,894 | `5e7c134400950a18720a176d48bc67310bb354ac77493a80f9913eb6af6c433b` | 31 | `b9d232b67ad4f82cb3c80fb373a374d24de821249082dc8df51f852a00013051` |
| `20261105120011_reports_v3_sale_facts.sql` | 18,150 | `8ee83c78eec631d959a60c78dbc06818d273717834a771fac4124b901df9df1b` | 13 | `74ec3d89dd30c012c0546b244160738c1dcde63b8a30fc84b74ad38e3b102241` |
| `20261105120012_reports_v3_call_journey_helpers.sql` | 92,063 | `b8aed0938924de6cedafa276e8fd346e120d37cc69dac5eefcb084e3d87f00c9` | 40 | `a273b46a26b2b993aec82a8d4d44836fcda223733c8b49102e615a703ec41ad1` |
| `20261105120013_reports_v3_appointment_facts_stub.sql` | 7,184 | `82473351065aff8dbf47b6c22bda38741d82d79880e167eb83a70c1a71d45ab6` | 6 | `00f137fe3f77d9f707cec6ed929c2a5c3cb33552961ecb6a2444a2e69af24966` |
| `20261105120014_reports_v3_state_helpers.sql` | 23,086 | `d1e3924eac6fef3ffa4296438dcb04a2cd841709f98983b0d2a917372be53b66` | 11 | `fe4b8005d44f008be42be07dfcb530b99439f934886c66ca7836ce7f73297ef3` |
| `20261105120015_reports_v3_readers.sql` | 137,954 | `e251b737a6f61f845d228ae7325179a7a030cac5f153c4195d707f9c5a353a41` | 32 | `2620d8494264229e3715b3c508f48f803a2963e7188c9d8e3d083aed4e5f93f0` |
| `20261105120016_reports_v3_calls_campaign_lead_index.sql` | 1,319 | `3afedbee7b4edcee5bd85d1f39ca156a8f8fdf318d3bff0898570f3bee999b5f` | 1 | `45d7f42cca7b1ab7fa9e52adae90cc5e94b31ce7bf30a5409225e90d8d6bed80` |
| `20261105120017_reports_v3_release_enable.sql` | 24,074 | `4aa127242482fee5979925976995b4388b76aa56a7783cd17c095c3bfe9acc9a` | 3 | `a8ccde415cdaf69ab58bf9ca95097036434e403c4dfeb4c30b6da5b3192422a2` |

History recording used Supabase CLI 2.121.0 with one isolated, pinned migration file per invocation. No migration SQL was reapplied. Names, statement counts/digests and null created_by/idempotency_key/rollback metadata matched. History grew from 356 to **364**, latest **20261105120017**, eight of eight Package A rows. Non-Package-A history fingerprint remained `50e8063f456a6d0ea952bf6293d4f187`. All public/private ordinary function definitions and ACLs remained `ce0c53f994bbd5355fd37bfc10fdbb15` under the history-stage query (OID + pg_get_functiondef + ACL, ordered by OID).

## Verification and limits

Both read-back runs passed the frozen pin, privilege, table/index, role-simulation, consistency and response-time assertions in read-only transactions. The runner suppresses psql NOTICE output, including conditional team/agent-filter skip notices. Success does not prove all four scopes or 36 calls executed; mandatory agency/personal checks passed. No new full-scale performance claim follows from these runs.

Independent post-history verification: 15 approved readers; 30 executable reader-role pairs; zero privilege mismatches; zero PUBLIC ACL entries. Advisors were 276 security, 463 performance, zero health findings. Earlier enable added the expected nine authenticated SECURITY DEFINER warnings. The calls unused-index notice disappeared during read-back; the lineage unused-index notice remains informational. Existing public app_config/webhook_debug_log RLS findings were not changed.

Package A is installed, enabled and recorded at contract **3.0.0**. Corrections, sale-call links and appointment evidence are **not installed**. Reports UI is not released. No policy/sale corrections, customer contact, additional Edge deploy or later package execution occurred.

## Decisions carried forward

The independent human review requirement was explicitly waived by Chris, not signed off. Technical verification remains required. Three separately approved agency zones were saved as America/Los_Angeles earlier; not replayed. Owner visual/CSV/map acceptance and B6 premium/Sold Date classifications or explicit bounded deferral remain open. Historical 144/147 scale results retain three accepted agency/366-day exceptions. See release-proposal.md for the separately gated Package B preparation/publication sequence.
