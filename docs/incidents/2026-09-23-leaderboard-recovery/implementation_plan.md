# Permanent leaderboard recovery

## Authorization and base
Chris requested the permanent repair after confirming no agents were working on September 23, 2026. This branch starts at the exact recorded emergency-containment head 0057ad6859f6a99fba69074b678cba3e1ca95706, on main f78140d78b6b964aa7b7e71451e11a3e0a95a591. Preserve unrelated work and the applied pause migration byte-for-byte.

## Evidence
Production still has the emergency PT503 pause; ACL, owner, stable/security-definer settings match the recorded state. No other active client query or lock waiter was present in the catalog snapshot. The canonical month-to-date aggregation, executed read-only with a four-second statement timeout, completed in 48.134 ms, using the existing idx_calls_org_created_at index. Its calls scan incurred 1,215 shared buffer hits for 1,318 qualifying calls. The main missing-index hypothesis is therefore not established. The confirmed frontend defects are four-second interval polling, refreshes triggered by call/appointment inserts, overlapping work, and no error cooldown.

## Scope
1. Introduce a tested, bounded request gate: coalesce identical refreshes; serialize different contexts; briefly reuse successful snapshots; exponential error cooldown; no raw-table fallback for organization standings.
2. Apply the gate to the full leaderboard and Dashboard preview. Keep canonical ranking, metrics, user-local date bounds, tenant isolation, and Agency/Group semantics. Default polling to 30 seconds with a safe minimum. Stop all background refresh paths while hidden/offline. Suppress stale async results on context change/unmount and make maintenance explicit.
3. Add a narrowly scoped server-side, non-waiting organization leaderboard concurrency guard so older browser tabs cannot pile up aggregate queries. Evaluate a covering outbound-call index against measured plans; do not add speculative generic indexes or change call data.
4. Test request coalescing, slow/hung requests, bounded retries, hidden tabs, changing filters/account context, maintenance, error-versus-empty states, existing metric/ranking behavior, and database authentication/ACL/metric parity.
5. Keep the production pause until code tests and deployment checks pass. Activate only the verified backend guard/optimization; then check real backend response/error metrics. Do not claim browser or call-audio verification without performing it.

## Exclusions
No customer data edits/deletions, RLS weakening, grants to anonymous callers, telephony/routing changes, global timeout increases, database restarts, paid compute upgrades, or unrelated merges.

## Release and rollback
Use the dedicated branch and PR; verify exact tested SHAs and changes before any merge. Preserve a migration-backed re-pause path. An unmet test or deployment gate leaves containment active rather than claiming completion. The raw organization aggregate signature and canonical metric semantics remain unchanged. Capacity beyond the verified load is not assumed unlimited.

## Documentation
Record the implementation and actual test/deployment results in this incident folder and append the root WORK_LOG only when its full existing bytes can be safely preserved. The earlier Contents API reads of that oversized file returned empty content, not evidence that the log is empty.
