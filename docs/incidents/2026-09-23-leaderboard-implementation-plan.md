# Approved emergency recovery scope — 2026-09-23

Chris authorized starting the leaderboard-only emergency containment after reviewing the recovery sequence in the current conversation.

1. Snapshot the live function definition and security metadata.
2. Through a recorded migration, insert a controlled maintenance exception after the existing auth.uid check and before aggregate work. Preserve all grants, ownership, configuration, return types and original body. Stop on unexpected definition drift.
3. Verify the applied definition, reversible hash and authenticated maintenance response without generating customer traffic.
4. Compare actual non-leaderboard API requests before/after, reporting the exact sample and excluding expected maintenance errors.
5. Persist exact applied migration and guarded rollback; do not mark a frontend change or full root-cause repair complete.

Excluded: data deletion, RLS changes, calling/routing changes, new paid compute, global restart, broad rollback, increasing timeouts, and premature resumption of leaderboard computation.

Frontend request suppression, clear maintenance UI, single-flight protection, backoff, and query optimization remain follow-up work. Emergency server containment was prioritized so already-open tabs cannot continue expensive aggregate work.
