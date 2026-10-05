# Reports Phase 1 candidate release packet

**Awaiting public publication and production-release approval.** The October 5 approval covered the audited six-group implementation and isolated verification. No production or public GitHub action is part of the completed work.

## Behavior

- Stale active sessions stop at the last heartbeat; elapsed time clips to the period/as-of and unions overlaps per agent. Session rates count only outbound calls inside a same-agent/campaign half-open interval. Unmatched calls remain Calls Made.
- Only exact organization/kind/duplicate-ID reviewed mappings exclude rows. Canonical durations remain unchanged; estimates, unknowns and conflicts are disclosed.
- Bookings created (all types) credits the setter by creation time regardless of later status. Callback dispositions counts call outcomes, not historical callback creation.
- Policy counts and premiums use the same stored-policy/sold-date/current-owner cohort. Current monthly premium ×12, known coverage, known-only average, genuine zero, ambiguous legacy zero and unavailable amounts stay distinct. No payment-frequency scaling or sale-event substitution.
- Six distinct v2 RPCs authorize requested personal/team/agency scope using the real database profile. Default maximum scope and existing layout remain. New tabs/redesign are deferred.
- Exact seconds/cents, Monday weeks, independent-response as-of/basis, unavailable attribution and quality notes appear in UI/CSV. Obsolete exports cannot regain permission by returning to the same filters.

## Exact ordered source candidates

| Order | File | SHA-256 |
| --- | --- | --- |
| 1 | `supabase/migrations/20261005183955_reports_integrity_readers.sql` | `1f1efcec700a9dc6926ea01eddb0a56ce670a157fedcd353783bcf2df7d05f29` |
| 2 | `supabase/migrations/20261005184012_reports_scopes_and_policy_premium.sql` | `f88855ae14cfd95f79c91fcf1d2512378d135f482dc1ac57ce8b16e9815578f6` |

`source_manifest.json` pins every changed/new candidate file except the manifest itself. `verification.json` records the source base, migration hashes, local evidence and limits. Applied production migrations were not edited. The two new migrations have never been applied to production.

## Proposed activation, after approval and green release gates

1. Publish this reviewed branch to the public `cgarness/agentflow-life-insure` repository and open a draft PR. Run native Reports/profile gates and the existing exact-base full frontend gate. Resolve any failures or main/source overlap before asking to activate production. Verify rendered Reports against this v2 contract; local component checks do not replace that gate.
2. Re-read the live migration list, exact source preimages, owner/search paths/effective ACLs and relevant schema dependencies. Stop on drift. Confirm the reviewed exclusion map has not acquired unapproved rows. Preserve all raw calls, sessions, bookings, clients, wins, identities and receipts.
3. Use a short Reports-only unavailable window to avoid old frontend tabs mixing new denominators with old numerators. Apply the reviewed `supabase/ops/reports_disable.sql` transactionally as a **new**, separately approved migration; it revokes both versions and seals legacy RPCs. No core calling writer needs replacement.
4. Apply the two pinned candidate migrations in order. They preserve disabled authenticated access. No historical repair, mapping insertion, RLS change, Edge deployment or provider action is included.
5. Deploy the reviewed frontend through the normal PR/release gates. Verify the v2 asset/request contract. Apply `supabase/ops/reports_integrity_enable.sql` transactionally as a **new**, separately approved migration. Its fifteen exact-body/owner/search-path/volatility guards and effective-privilege assertions must all pass. It re-enables only v2; old tabs stay unavailable until refreshed.
6. Read back installed function bodies and ACLs. Verify actual authenticated Admin, Agent, Team Leader and permitted narrowed scopes; deny anonymous/foreign/broadened requests. Compare summary/volume/campaign/source totals and unavailable subsets at a stated as-of. Observe hosted API latency/errors and verify browser UI/CSV before declaring release complete.

No production timestamp/version for disable or enable is invented in advance. Generate those migration files through the CLI only within an approved release; pin their exact SQL against these reviewed ops sources.

## Recovery

Disable Reports with the version-aware disable source, as a new approved migration, and leave helpers/raw data intact. Do not restore win-based readers, re-enable v1 or unseal the four legacy RPCs. Diagnose and prepare a new forward correction. Re-enable only exact verified bodies using the v2 recovery source. Drift or inherited grants cause a transaction rollback, not a partial recovery.

## Remaining uncertainty

Native CI, rendered browser and hosted API verification are pending publication/release access. The synthetic embedded summary timing is not a hosted performance claim. Historical 277 call and 12 booking candidates and legacy duration provenance remain evidence-dependent; no guessed cleanup is included.
