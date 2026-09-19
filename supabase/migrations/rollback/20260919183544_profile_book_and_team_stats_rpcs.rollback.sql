-- =====================================================================================================
-- ROLLBACK for 20260919183544_profile_book_and_team_stats_rpcs.sql.
-- ⚠ ROLLBACK NOT EXECUTED ANYWHERE. The forward migration WAS applied to production
--   jncvvsvckxhqgqvkppmj on 2026-09-19 under Chris's explicit approval, and Supabase recorded it as
--   version 20260919183544 — not the authored filename 20260919210000, because apply_migration
--   stamps the version at apply time. Both files were renamed to the recorded version afterwards.
--   THE FORWARD SQL BODY WAS NOT TOUCHED by that reconciliation and remains byte-identical to what
--   production ran (36,808 bytes, sha256 3dfdab478111f8835ff7ae67508aab4ebd43379981fc6dfda692d950e567736b),
--   which is what keeps this repository the record of the as-applied SQL.
--   Running this rollback against production would REMOVE the Agent Profile / Team Profile data
--   source. Do so only deliberately, and read the cost stated below first.
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
