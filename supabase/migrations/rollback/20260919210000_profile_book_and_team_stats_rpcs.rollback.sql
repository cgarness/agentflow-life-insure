-- =====================================================================================================
-- ROLLBACK for 20260919210000_profile_book_and_team_stats_rpcs.sql.
-- ⚠ THE FORWARD MIGRATION HAS NOT BEEN APPLIED TO ANY HOSTED PROJECT. It has been applied only to
--   disposable localhost databases by scripts/run_profile_rpc_tests.sh. It is NOT recorded in
--   jncvvsvckxhqgqvkppmj. This rollback has therefore never been executed remotely either.
--   NOTE FOR A FUTURE PRODUCTION APPLY: apply_migration stamps its own version at apply time, so
--   both files must afterwards be renamed to the version Supabase actually records.
-- =====================================================================================================
-- Drops the two Agent/Team Profile aggregate RPCs, their two private helpers, the private downline
-- resolver and the clients ownership index, restoring the pre-migration state exactly.
--
-- THIS ROLLBACK READS NOTHING AND REWRITES NOTHING. The forward migration performs no INSERT, UPDATE,
-- DELETE, backfill or data repair of any kind — it creates functions and one index and nothing else.
-- There is therefore no data change to undo. In particular it does NOT touch:
--   * any row in public.clients, public.wins, public.profiles or public.agent_state_licenses;
--   * profiles.hierarchy_path (deliberately never read, never repaired — that remains its own
--     tracked security follow-up);
--   * profiles.licensed_states (the legacy licensing store is deliberately left unreconciled —
--     logged as a separate task requiring its own production-mutation approval);
--   * any RLS policy. "Clients Hierarchical Access", agent_state_licenses_select, wins_select and
--     the two profiles SELECT policies are all exactly as they were, so none is restored here.
--
-- WHAT ROLLING BACK COSTS: the Agent Profile's Business Snapshot, Carrier Production, Policy Type Mix
-- and Achievements sections, and the whole Team Profile business/readiness surface, lose their data
-- source. The frontend treats a missing function as a query FAILURE and renders its explicit
-- "unavailable" state with a retry — by design it never renders a fabricated 0. The identity hero,
-- licensing list, carrier appointments, downline preview and full organization tree keep working,
-- because those read PostgREST directly and do not depend on these functions.

DROP FUNCTION IF EXISTS public.get_profile_team_readiness();
DROP FUNCTION IF EXISTS public.get_profile_book_stats(text, text);

-- Dropped after the two public functions above, which call it.
DROP FUNCTION IF EXISTS private.resolve_downline_ids(uuid, uuid);

DROP FUNCTION IF EXISTS private.profile_parse_iso_date(text);
DROP FUNCTION IF EXISTS private.profile_parse_currency(text);

-- The `private` schema is NOT dropped: it is created by the baseline (20260806000000:90) and holds
-- many unrelated helpers, including private.campaign_actor() which this migration only CALLS and
-- never defines or modifies.

-- =====================================================================================================
-- SEPARATELY REVERSIBLE COMPONENT — the clients ownership index.
-- =====================================================================================================
-- Comment this line out to roll the functions back while KEEPING the index, which is useful on its
-- own: public.clients has no other index on assigned_agent_id, the column every ownership-scoped
-- clients query filters on.
DROP INDEX IF EXISTS public.idx_clients_assigned_agent_id;
