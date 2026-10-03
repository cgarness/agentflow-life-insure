# Historical DNC repair — separate, NOT authorized

Do not run operational INSERT/UPDATE/DELETE or historical backfill as part of the prevention migration.

After prevention is verified, produce a fresh read-only candidate set keyed by organization and `private.phone_digits_e164ish(phone)`. Evidence should distinguish terminal DNC campaign memberships, saved call disposition UUID/configuration, already suppressed phones and missing/ambiguous phones. Configuration may have changed since a historic call; do not infer historic intent solely from current Not Interested settings or display strings. Do not export contact names/phone lists into public evidence.

The October 2 aggregate audit found 43 terminal-DNC memberships lacking normalized DNC entries; it also found call evidence with missing phone snapshots. These counts are neither an exact repair instruction nor approval. Recompute counts against a captured timestamp, resolve phone provenance and quarantine ambiguous rows for Chris's decision.

Prepare an exact tenant-scoped, idempotent insertion query using the new canonical suppression operation and original evidence. Preserve contacts, calls, dispositions and membership history. Include a dry-run SELECT, target counts, expected inserted count, concurrency strategy and read-back verification. Chris must approve that exact production action before execution. Existing canonical duplicate DNC records remain intact unless separately approved for cleanup.

`historical-candidates.sql` is the prepared read-only query. It is deliberately not run for this build. It binds one organization, favors the recorded call destination over the membership snapshot, flags missing/changed phone evidence, and lists existing suppression and other nonterminal memberships. Store any resulting phone-level evidence privately, outside the repository.

After Chris approves an exact candidate list, prepare a transaction with those explicit organization/phone pairs (not a fresh predicate that can expand the target set). Acquire the same advisory phone locks in sorted order, recheck normalized DNC existence, insert only missing entries with the approved audit reason/actor, and verify the exact inserted count before commit. The migration's forward uniqueness trigger also guards concurrent writes. Quarantine unresolved historical intent; do not infer it from today's Not Interested setting. No repair DML is included or authorized here.
