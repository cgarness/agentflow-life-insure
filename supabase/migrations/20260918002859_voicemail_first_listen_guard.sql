-- =====================================================================================================
-- M9 — Inbound Calling v2: the first-listen timestamp becomes server-authoritative.
-- NOT YET APPLIED ANYWHERE. Local/dev only until a separate approval.
-- =====================================================================================================
-- WHAT THE DEFECT ACTUALLY IS, stated precisely, because an earlier description overstated it:
--   Access is NOT unrestricted. `can_access_voicemail` already limits both the SELECT policy and the
--   `voicemails_update_listened` UPDATE policy to the recipient agent, eligible group members (including
--   the organization's configured inbound group), organization Admins and qualifying super admins, within
--   the caller's own organization. `authenticated` holds SELECT plus a COLUMN-SCOPED
--   `UPDATE (listened_at)` and nothing else — no DELETE, no other column.
--
--   The real defect is narrower and still real: an AUTHORIZED caller supplies the VALUE of `listened_at`,
--   and retention trusts that value. `voicemails_expired_batch` expires heard voicemail at
--   `listened_at < now() - voicemail_retention_days`, so a backdated timestamp brings forward an
--   IRREVERSIBLE deletion of the media — and nothing in the database prevented backdating, future-dating,
--   clearing or resetting it. The browser helper already documents "first listen wins" and updates only
--   `WHERE listened_at IS NULL`; that intent lived entirely in client code that the database did not
--   enforce.
--
-- THE CORRECTION:
--   A BEFORE UPDATE OF listened_at trigger makes the database the sole source of that timestamp for every
--   NON-PRIVILEGED caller — which is exactly the surface the defect lives on, since `authenticated` is the
--   only role the policy and the column grant expose.
--     * First accepted listen  → `now()` (transaction start on the SERVER clock), never the client value.
--     * Already established    → the stored value is restored; it cannot be moved, cleared or reset.
--     * NULL → NULL            → untouched no-op.
--   The trigger writes ONLY `listened_at`. Status, ownership, storage path, cleanup state, notification
--   state and every other column are left exactly as the statement left them.
--
-- THE ONE EXEMPTION, deliberate and named: a caller that is a member of `service_role` (which includes
--   `postgres`, and therefore migrations and backfills) may still set the column outright. This is not a
--   loophole in the finding's threat model — `service_role` already holds GRANT ALL on this table and can
--   rewrite status, storage_path or delete the row entirely, so guarding it here would add friction
--   without adding protection. It is what keeps deliberate data maintenance possible, and it is asserted
--   by tests rather than assumed. NO SHIPPED CODE RELIES ON IT: `upsert_voicemail_from_recording`,
--   `mark_voicemails_purged`, `mark_voicemail_source_deleted` and `record_voicemail_cleanup_failure`
--   never name `listened_at`, and neither does any Edge function. If that ever changes, the writer — not
--   this trigger — becomes the thing to review.
--
-- WHAT THIS DELIBERATELY DOES NOT CHANGE:
--   No RLS policy, no grant, no role membership, no retention rule. Row access is still decided by
--   `can_access_voicemail` and the write scope is still the single column. Heard voicemail still expires
--   on the first-listen timestamp; unheard voicemail still expires on the existing 90-day `created_at`
--   cap. `voicemails_expired_batch` is untouched.
--
-- HONEST SCOPE OF THE CLAIM:
--   This records when the SYSTEM ACCEPTED a listen event from an authorized caller. It does not, and
--   cannot, prove a human actually heard the audio — a caller may start playback and never listen. It
--   establishes provenance and monotonicity of the retention clock, nothing more.
--
-- COMPATIBILITY / DEPLOYMENT ORDER:
--   Independent of every Edge function; no worker calls it and no deployment has to accompany it. The
--   existing browser call (`update({listened_at}) ... .is("listened_at", null)`) keeps working unchanged
--   and simply gets the server's timestamp instead of its own. Service-role writers are unaffected for a
--   second, independent reason as well: none of M7's functions names `listened_at`, so the trigger does
--   not even fire for them.

CREATE OR REPLACE FUNCTION public.voicemails_enforce_first_listen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- Deliberate backend maintenance keeps its existing freedom (see THE ONE EXEMPTION above). The
  -- to_regrole() guard keeps this working on a stack where the role has not been created.
  IF to_regrole('service_role') IS NOT NULL AND pg_has_role(current_user, 'service_role', 'MEMBER') THEN
    RETURN NEW;
  END IF;

  IF NEW.listened_at IS DISTINCT FROM OLD.listened_at THEN
    IF OLD.listened_at IS NOT NULL THEN
      -- Established: idempotent for a repeat, and a refusal for a backdate, a future-date, a clear or a
      -- reset. The statement still reports success; the stored value simply does not move.
      NEW.listened_at := OLD.listened_at;
    ELSIF NEW.listened_at IS NULL THEN
      NEW.listened_at := NULL;                 -- nothing was established and nothing is being established
    ELSE
      NEW.listened_at := now();                -- FIRST accepted listen: server clock, never the client's
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- `UPDATE OF listened_at` keeps the trigger off every statement that does not name the column, so the
-- retention purge, the cleanup RPCs and the recording callback never pay for it.
DROP TRIGGER IF EXISTS voicemails_first_listen_guard ON public.voicemails;
CREATE TRIGGER voicemails_first_listen_guard
  BEFORE UPDATE OF listened_at ON public.voicemails
  FOR EACH ROW EXECUTE FUNCTION public.voicemails_enforce_first_listen();

-- Trigger functions are invoked by the trigger machinery rather than through EXECUTE, so this grants
-- nobody anything; it is here so the function does not sit with PUBLIC EXECUTE like an ordinary helper.
REVOKE ALL ON FUNCTION public.voicemails_enforce_first_listen() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.voicemails_enforce_first_listen() FROM anon;
REVOKE ALL ON FUNCTION public.voicemails_enforce_first_listen() FROM authenticated;

COMMENT ON FUNCTION public.voicemails_enforce_first_listen() IS
  'Makes voicemails.listened_at server-authoritative for non-privileged callers: the first accepted '
  'listen is stamped now(); an established value can never be moved, cleared or reset. service_role '
  '(and postgres) are exempt for deliberate maintenance. Records when the system ACCEPTED a listen '
  'event from an authorized caller - not proof that a human heard the audio.';
COMMENT ON COLUMN public.voicemails.listened_at IS
  'First accepted listen. Stamped by the database (M9 trigger) for client callers, who can never choose, '
  'move, clear or reset it; service_role may still set it for deliberate maintenance. Drives the heard '
  'retention branch of voicemails_expired_batch; unheard voicemail uses the 90-day created_at cap.';
