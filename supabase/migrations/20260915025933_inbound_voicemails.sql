-- =====================================================================================================
-- Inbound Calling v2 — M7: AgentFlow voicemail (table, private bucket, mailbox authorization), the
-- `voicemail` notification type, and the durable notification convergence/sweep for missed calls and
-- voicemails (implementation_plan.md rev 3 §7.4/§3.4 + safeguards 2/3; approved development-only
-- 2026-09-10 under #APPROVE_RLS_CHANGE for exactly the policies below)
-- =====================================================================================================
-- FUTURE-FACING ONLY: new table/columns/functions/policies. NO data UPDATE/backfill. The pg_cron sweep is
-- scheduled here (last migration) only if pg_cron is installed, after every table/function it needs exists.
--
-- Objects:
--   public.voicemails                              one row per stored voicemail recording (RecordVerb)
--   calls.voicemail_id                             first stored voicemail for the call (nullable FK)
--   notifications_type_check                       + 'voicemail'
--   storage bucket 'voicemails' (private)          objects readable only through can_access_voicemail
--   public.can_access_voicemail(uuid)              ONE visibility predicate (row + object policies)
--   public.upsert_voicemail_from_recording(...)    service-role; validated nullable attempt reference
--   public.mark_voicemail_source_deleted / record_voicemail_cleanup_failure / voicemails_cleanup_batch
--   public.voicemails_expired_batch / mark_voicemails_purged   (P13 retention: listened vs unheard cap)
--   public.converge_inbound_notifications(uuid)    the single recipient + completion rule (tier 0)
--   public.sweep_inbound_notifications()           bounded per-record retries; one failure never blocks others

CREATE SCHEMA IF NOT EXISTS private;

-- ── 1. voicemails ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voicemails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES public.inbound_route_attempts(id) ON DELETE SET NULL,
  recipient_kind text NOT NULL CONSTRAINT voicemails_recipient_kind_check CHECK (recipient_kind IN ('agent','group')),
  recipient_agent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_group_ids uuid[] NOT NULL DEFAULT '{}',
  recording_sid text NOT NULL UNIQUE CONSTRAINT voicemails_recording_sid_check CHECK (recording_sid ~ '^RE[0-9a-fA-F]{32}$'),
  recording_source text NOT NULL DEFAULT 'RecordVerb',
  provider_account_sid text,                       -- Twilio account that owns the source recording (cleanup retries)
  storage_bucket text NOT NULL DEFAULT 'voicemails',
  storage_path text UNIQUE,
  duration_seconds integer,
  status text NOT NULL DEFAULT 'pending' CONSTRAINT voicemails_status_check CHECK (status IN ('pending','stored','failed','purged')),
  source_cleanup_state text NOT NULL DEFAULT 'pending'
    CONSTRAINT voicemails_cleanup_state_check CHECK (source_cleanup_state IN ('pending','deleted','failed')),
  source_cleanup_attempts integer NOT NULL DEFAULT 0,
  source_cleanup_next_at timestamptz,
  source_cleanup_error text,
  notified_at timestamptz,
  notify_attempts integer NOT NULL DEFAULT 0,
  notify_next_at timestamptz,
  notify_error text,
  listened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voicemails_recipient_consistency_check
    CHECK ((recipient_kind = 'agent' AND recipient_agent_id IS NOT NULL) OR recipient_kind = 'group')
);
CREATE INDEX IF NOT EXISTS idx_voicemails_call ON public.voicemails (call_id);
CREATE INDEX IF NOT EXISTS idx_voicemails_recipient_agent ON public.voicemails (recipient_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voicemails_org_status ON public.voicemails (organization_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_voicemails_notify_owed ON public.voicemails (notify_next_at) WHERE status = 'stored' AND notified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_voicemails_cleanup_owed ON public.voicemails (source_cleanup_next_at) WHERE status IN ('stored','purged') AND source_cleanup_state <> 'deleted';

COMMENT ON TABLE public.voicemails IS
  'AgentFlow voicemail (INB-D6/D7/D11): media lives in the PRIVATE `voicemails` bucket, never in calls.recording_*. '
  'Access = can_access_voicemail (recipient, group members, org Admin/Super Admin). status=stored only after media '
  'and metadata are persisted; source_cleanup_state tracks Twilio source deletion separately (safeguard 3); '
  'notified_at/notify_attempts drive the durable notification convergence (safeguard 2).';

ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS voicemail_id uuid REFERENCES public.voicemails(id) ON DELETE SET NULL;

-- ── 2. notifications: + 'voicemail' type ─────────────────────────────────────────────────────────────
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY['win','missed_call','lead_claimed','appointment_reminder','anniversary','system',
                           'inbound_sms','inbound_email','voicemail']));

-- ── 3. Private storage bucket (metadata only; the object policy is below) ────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('voicemails', 'voicemails', false, 26214400, ARRAY['audio/mpeg'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- ── 4. ONE visibility predicate ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_access_voicemail(p_voicemail_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.voicemails v
      LEFT JOIN public.inbound_routing_settings irs ON irs.organization_id = v.organization_id
     WHERE v.id = p_voicemail_id
       AND auth.uid() IS NOT NULL
       AND v.organization_id = public.get_org_id()
       AND (
            v.recipient_agent_id = auth.uid()
         OR (v.recipient_kind = 'group'
             AND (auth.uid() = ANY (v.recipient_group_ids)
                  OR auth.uid() = ANY (coalesce(irs.inbound_group_agent_ids, '{}'::uuid[]))))
         OR public.get_user_role() = 'Admin'
         OR public.is_super_admin()
       )
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_voicemail(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_voicemail(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_access_voicemail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_voicemail(uuid) TO service_role;

ALTER TABLE public.voicemails ENABLE ROW LEVEL SECURITY;
-- Corrective pass 11: this project's default privileges give every table created by `postgres` in
-- `public` the full `arwdDxtm` set to anon, authenticated and service_role, and a GRANT only ADDS. Without
-- resetting `authenticated` first, the column-scoped `GRANT UPDATE (listened_at)` below would have been
-- meaningless — authenticated would have kept table-wide UPDATE — and would also have kept DELETE and
-- TRUNCATE, which row-level security does not restrain. Reset every grantee, then grant the contract.
REVOKE ALL ON TABLE public.voicemails FROM PUBLIC;
REVOKE ALL ON TABLE public.voicemails FROM anon;
REVOKE ALL ON TABLE public.voicemails FROM authenticated;
REVOKE ALL ON TABLE public.voicemails FROM service_role;
GRANT SELECT ON TABLE public.voicemails TO authenticated;
GRANT UPDATE (listened_at) ON TABLE public.voicemails TO authenticated;
GRANT ALL ON TABLE public.voicemails TO service_role;

DROP POLICY IF EXISTS voicemails_select ON public.voicemails;
CREATE POLICY voicemails_select ON public.voicemails
  FOR SELECT TO authenticated USING (public.can_access_voicemail(id));

DROP POLICY IF EXISTS voicemails_update_listened ON public.voicemails;
CREATE POLICY voicemails_update_listened ON public.voicemails
  FOR UPDATE TO authenticated
  USING (public.can_access_voicemail(id))
  WITH CHECK (public.can_access_voicemail(id));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN
    EXECUTE 'DROP POLICY IF EXISTS voicemail_objects_select ON storage.objects';
    EXECUTE $p$CREATE POLICY voicemail_objects_select ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'voicemails'
             AND EXISTS (SELECT 1 FROM public.voicemails v
                          WHERE v.storage_path = storage.objects.name
                            AND public.can_access_voicemail(v.id)))$p$;
  END IF;
END $$;

-- ── 5. Service-role media/metadata RPCs ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_voicemail_from_recording(
  p_recording_sid text, p_call_row_id uuid, p_org_id uuid, p_attempt_id uuid, p_mailbox text,
  p_storage_path text, p_duration integer, p_status text, p_account_sid text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_sid text := btrim(coalesce(p_recording_sid, ''));
  v_attempt uuid; v_kind text; v_agent uuid; v_group uuid[] := '{}'; v_row public.voicemails%ROWTYPE;
BEGIN
  IF v_sid !~ '^RE[0-9a-fA-F]{32}$' THEN RAISE EXCEPTION 'invalid RecordingSid' USING ERRCODE = '22023'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending','stored','failed') THEN
    RAISE EXCEPTION 'invalid voicemail status %', p_status USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.id = p_call_row_id AND c.organization_id = p_org_id AND c.direction = 'inbound') THEN
    RAISE EXCEPTION 'voicemail: call not found in organization' USING ERRCODE = '22023';
  END IF;
  -- A valid NULLABLE reference: only an existing attempt of the same call is linked (safeguard 3).
  SELECT a.id INTO v_attempt FROM public.inbound_route_attempts a
   WHERE a.id = p_attempt_id AND a.call_id = p_call_row_id AND a.organization_id = p_org_id;

  IF p_mailbox LIKE 'agent:%' THEN
    v_kind := 'agent';
    v_agent := NULLIF(substr(p_mailbox, 7), '')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_agent AND p.organization_id = p_org_id) THEN
      RAISE EXCEPTION 'voicemail: mailbox agent not in organization' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_kind := 'group';
    SELECT coalesce(a.voicemail_group_ids, '{}'::uuid[]) INTO v_group FROM public.inbound_route_attempts a WHERE a.id = v_attempt;
    IF cardinality(coalesce(v_group, '{}'::uuid[])) = 0 THEN
      SELECT coalesce(irs.inbound_group_agent_ids, '{}'::uuid[]) INTO v_group
        FROM public.inbound_routing_settings irs WHERE irs.organization_id = p_org_id;
    END IF;
  END IF;

  INSERT INTO public.voicemails AS v
    (organization_id, call_id, attempt_id, recipient_kind, recipient_agent_id, recipient_group_ids,
     recording_sid, storage_path, duration_seconds, status, provider_account_sid)
  VALUES
    (p_org_id, p_call_row_id, v_attempt, v_kind, v_agent, coalesce(v_group, '{}'::uuid[]),
     v_sid, NULLIF(btrim(coalesce(p_storage_path, '')), ''), p_duration, p_status, NULLIF(btrim(coalesce(p_account_sid, '')), ''))
  ON CONFLICT (recording_sid) DO UPDATE SET
    attempt_id       = coalesce(v.attempt_id, EXCLUDED.attempt_id),
    provider_account_sid = coalesce(v.provider_account_sid, EXCLUDED.provider_account_sid),
    storage_path     = coalesce(v.storage_path, EXCLUDED.storage_path),
    duration_seconds = coalesce(EXCLUDED.duration_seconds, v.duration_seconds),
    status           = CASE WHEN v.status = 'stored' THEN 'stored' ELSE EXCLUDED.status END,   -- stored is sticky
    updated_at       = now()
  WHERE v.organization_id = p_org_id AND v.call_id = p_call_row_id
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    SELECT * INTO v_row FROM public.voicemails WHERE recording_sid = v_sid;
    IF v_row.organization_id IS DISTINCT FROM p_org_id OR v_row.call_id IS DISTINCT FROM p_call_row_id THEN
      RAISE EXCEPTION 'voicemail: RecordingSid already belongs to another call' USING ERRCODE = '23505';
    END IF;
  END IF;

  IF v_row.status = 'stored' THEN
    UPDATE public.calls SET voicemail_id = coalesce(voicemail_id, v_row.id), updated_at = now()
     WHERE id = p_call_row_id AND organization_id = p_org_id;
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_voicemail_from_recording(text, uuid, uuid, uuid, text, text, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_voicemail_from_recording(text, uuid, uuid, uuid, text, text, integer, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_voicemail_from_recording(text, uuid, uuid, uuid, text, text, integer, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_voicemail_from_recording(text, uuid, uuid, uuid, text, text, integer, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_voicemail_source_deleted(p_recording_sid text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_rows integer := 0;
BEGIN
  UPDATE public.voicemails SET source_cleanup_state = 'deleted', source_cleanup_error = NULL, updated_at = now()
   WHERE recording_sid = btrim(coalesce(p_recording_sid, '')) AND source_cleanup_state <> 'deleted';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_rows > 0);
END;
$$;
CREATE OR REPLACE FUNCTION public.record_voicemail_cleanup_failure(p_recording_sid text, p_error text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_rows integer := 0;
BEGIN
  UPDATE public.voicemails SET
    source_cleanup_state    = 'failed',
    source_cleanup_attempts = source_cleanup_attempts + 1,
    source_cleanup_next_at  = now() + least(interval '6 hours', interval '1 minute' * power(2, least(source_cleanup_attempts, 8))::int),
    source_cleanup_error    = left(coalesce(p_error, ''), 500),
    updated_at              = now()
   WHERE recording_sid = btrim(coalesce(p_recording_sid, '')) AND source_cleanup_state <> 'deleted';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_rows > 0);
END;
$$;
-- Rows whose Twilio source still needs deleting (stored media only — never re-downloaded).
CREATE OR REPLACE FUNCTION public.voicemails_cleanup_batch(p_limit integer DEFAULT 100)
RETURNS TABLE (id uuid, organization_id uuid, recording_sid text, source_cleanup_attempts integer, provider_account_sid text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT v.id, v.organization_id, v.recording_sid, v.source_cleanup_attempts, v.provider_account_sid
    FROM public.voicemails v
   -- Local media may already be purged by retention; the Twilio source still owes its deletion
   -- (corrective pass, defect 7), so purged rows stay eligible until the source is gone.
   WHERE v.status IN ('stored','purged') AND v.source_cleanup_state <> 'deleted'
     AND v.source_cleanup_attempts < 50
     AND (v.source_cleanup_next_at IS NULL OR v.source_cleanup_next_at <= now())
   ORDER BY v.created_at ASC
   LIMIT least(greatest(coalesce(p_limit, 100), 1), 500);
$$;
-- P13 retention: listened → org retention days; unheard → 90-day cap.
CREATE OR REPLACE FUNCTION public.voicemails_expired_batch(p_org_id uuid, p_listened_cutoff timestamptz, p_unheard_cutoff timestamptz, p_limit integer DEFAULT 200)
RETURNS TABLE (id uuid, storage_path text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT v.id, v.storage_path
    FROM public.voicemails v
   WHERE v.organization_id = p_org_id AND v.status = 'stored' AND v.storage_path IS NOT NULL
     AND ((v.listened_at IS NOT NULL AND v.listened_at < p_listened_cutoff)
          OR (v.listened_at IS NULL AND v.created_at < p_unheard_cutoff))
   ORDER BY v.created_at ASC
   LIMIT least(greatest(coalesce(p_limit, 200), 1), 500);
$$;
CREATE OR REPLACE FUNCTION public.mark_voicemails_purged(p_ids uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_rows integer := 0;
BEGIN
  UPDATE public.voicemails SET status = 'purged', storage_path = NULL, updated_at = now()
   WHERE id = ANY (coalesce(p_ids, '{}'::uuid[])) AND status = 'stored';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.mark_voicemail_source_deleted(text)',
    'public.record_voicemail_cleanup_failure(text, text)',
    'public.voicemails_cleanup_batch(integer)',
    'public.voicemails_expired_batch(uuid, timestamptz, timestamptz, integer)',
    'public.mark_voicemails_purged(uuid[])'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- ── 6. Notification convergence — ONE recipient rule, ONE completion rule (safeguard 2) ──────────────
-- Recipients for a v2 missed call = calls.missed_recipient_ids validated Active + same org; when none of
-- them is Active any more → the organization's Active Admins. Tiers 1–4 of the Edge helper are NEVER
-- consulted for rows that carry a snapshot. Completion = a notification row exists for EVERY required
-- recipient (then missed_notified_at / notified_at is stamped). Bounded per-record retries with backoff;
-- the sweep never abandons a record on age alone.
CREATE OR REPLACE FUNCTION private.resolve_snapshot_recipients(p_org uuid, p_ids uuid[]) RETURNS uuid[]
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH snap AS (
    SELECT array_agg(p.id ORDER BY p.id) AS ids FROM public.profiles p
     WHERE p.id = ANY (coalesce(p_ids, '{}'::uuid[])) AND p.organization_id = p_org AND p.status = 'Active'
  ), admins AS (
    SELECT array_agg(p.id ORDER BY p.id) AS ids FROM public.profiles p
     WHERE p.organization_id = p_org AND p.status = 'Active' AND p.role = 'Admin'
  )
  SELECT coalesce((SELECT ids FROM snap), (SELECT ids FROM admins), '{}'::uuid[]);
$$;
REVOKE ALL ON FUNCTION private.resolve_snapshot_recipients(uuid, uuid[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.missed_call_label(p_reason text) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_reason
    WHEN 'forwarded_to_mobile' THEN 'Missed in AgentFlow — forwarded to mobile.'
    WHEN 'dnd'                 THEN 'Missed in AgentFlow — you were On Break / Do Not Disturb.'
    WHEN 'busy'                THEN 'Missed in AgentFlow — you were on another call.'
    WHEN 'offline_no_mobile'   THEN 'Missed in AgentFlow — offline, no mobile number configured.'
    WHEN 'group_empty'         THEN 'Missed in AgentFlow — no inbound group member was available.'
    ELSE                            'Missed in AgentFlow.'
  END;
$$;
REVOKE ALL ON FUNCTION private.missed_call_label(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.converge_inbound_notifications(p_call_row_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c public.calls%ROWTYPE; v public.voicemails%ROWTYPE;
  v_recipients uuid[]; v_key text; v_present integer; v_label text; v_who text;
  v_missed_done boolean := NULL; v_vm_done integer := 0; v_vm_owed integer := 0;
  v_resolved uuid[]; v_retried boolean := false;
BEGIN
  SELECT * INTO c FROM public.calls WHERE id = p_call_row_id AND direction = 'inbound';
  IF NOT FOUND THEN RETURN jsonb_build_object('call', 'not_found'); END IF;
  v_who := coalesce(NULLIF(btrim(coalesce(c.contact_name, '')), ''), NULLIF(btrim(coalesce(c.contact_phone, '')), ''), 'Unknown caller');

  -- Corrective pass 7, finding 2: a v2 call whose INTENDED recipient could not be resolved when it was
  -- classified (the contact row was unreadable at that moment) commits a missed row with an EMPTY
  -- snapshot. That is owed work, not permission to notify somebody else: resolution is RETRIED here from
  -- validated evidence, and every entry point (the failure path, this convergence, the notification sweep,
  -- the parent status callback) runs the same retry. Nothing is fabricated — an unresolved call notifies
  -- nobody and keeps its owed-work marker until the evidence resolves or the attempt budget is exhausted.
  IF c.is_missed AND c.missed_notified_at IS NULL AND c.organization_id IS NOT NULL
     AND c.routing_engine = 'v2' AND cardinality(coalesce(c.missed_recipient_ids, '{}'::uuid[])) = 0 THEN
    v_retried := true;
    v_resolved := private.intended_recipients_for_call(c.id, c.organization_id);
    IF v_resolved IS NOT NULL AND cardinality(v_resolved) > 0 THEN
      -- Monotonic: mark_inbound_missed keeps an existing non-empty snapshot and never regresses D13.
      PERFORM public.mark_inbound_missed(c.id, c.organization_id, c.missed_reason, v_resolved, c.missed_for_agent_id);
      SELECT * INTO c FROM public.calls WHERE id = p_call_row_id AND direction = 'inbound';
    END IF;
  END IF;

  -- Missed-in-AgentFlow notification (only for rows that carry the durable snapshot)
  IF c.is_missed AND cardinality(coalesce(c.missed_recipient_ids, '{}'::uuid[])) > 0 AND c.missed_notified_at IS NULL
     AND c.organization_id IS NOT NULL THEN
    v_recipients := private.resolve_snapshot_recipients(c.organization_id, c.missed_recipient_ids);
    v_key := 'missed_call:' || c.id::text;
    v_label := private.missed_call_label(c.missed_reason);
    IF cardinality(v_recipients) > 0 THEN
      INSERT INTO public.notifications (user_id, organization_id, type, title, body, action_url, action_label, metadata, event_key)
      SELECT r, c.organization_id, 'missed_call', 'Missed Call',
             v_label || ' ' || v_who || CASE WHEN c.contact_phone IS NOT NULL AND c.contact_name IS NOT NULL THEN ' (' || c.contact_phone || ')' ELSE '' END,
             CASE WHEN c.contact_id IS NOT NULL THEN '/contacts?contact=' || c.contact_id::text ELSE '/dashboard' END,
             CASE WHEN c.contact_id IS NOT NULL THEN 'View contact' ELSE 'View dashboard' END,
             jsonb_build_object('contact_id', c.contact_id, 'phone', c.contact_phone, 'call_id', c.id,
                                'reason', c.missed_reason, 'source', 'inbound_v2'),
             v_key
        FROM unnest(v_recipients) r
      ON CONFLICT (user_id, event_key) DO NOTHING;
      SELECT count(*) INTO v_present FROM public.notifications n
       WHERE n.event_key = v_key AND n.user_id = ANY (v_recipients);
      IF v_present = cardinality(v_recipients) THEN
        UPDATE public.calls SET missed_notified_at = now(), missed_notify_error = NULL, updated_at = now() WHERE id = c.id;
        v_missed_done := true;
      ELSE
        UPDATE public.calls SET missed_notify_attempts = missed_notify_attempts + 1,
               missed_notify_next_at = now() + least(interval '6 hours', interval '1 minute' * power(2, least(missed_notify_attempts, 8))::int),
               missed_notify_error = 'incomplete: ' || v_present || '/' || cardinality(v_recipients), updated_at = now() WHERE id = c.id;
        v_missed_done := false;
      END IF;
    ELSE
      UPDATE public.calls SET missed_notify_attempts = missed_notify_attempts + 1,
             missed_notify_next_at = now() + least(interval '6 hours', interval '1 minute' * power(2, least(missed_notify_attempts, 8))::int),
             missed_notify_error = 'no_active_recipient', updated_at = now() WHERE id = c.id;
      v_missed_done := false;
    END IF;
  ELSIF v_retried THEN
    -- Still unresolved after the retry: owed work, recorded explicitly and retried on the sweep's
    -- schedule. NOBODY is notified from a fallback tier, and completion is never stamped.
    UPDATE public.calls SET missed_notify_attempts = missed_notify_attempts + 1,
           missed_notify_next_at = now() + least(interval '6 hours', interval '1 minute' * power(2, least(missed_notify_attempts, 8))::int),
           missed_notify_error = 'unresolved_recipient', updated_at = now() WHERE id = c.id;
    v_missed_done := false;
  END IF;

  -- Voicemail notifications (one per stored voicemail; event key per voicemail row)
  FOR v IN SELECT * FROM public.voicemails vm WHERE vm.call_id = c.id AND vm.status = 'stored' AND vm.notified_at IS NULL LOOP
    v_vm_owed := v_vm_owed + 1;
    IF v.recipient_kind = 'agent' THEN
      v_recipients := private.resolve_snapshot_recipients(v.organization_id, ARRAY[v.recipient_agent_id]);
    ELSE
      v_recipients := private.resolve_snapshot_recipients(v.organization_id,
        (SELECT coalesce(array_agg(DISTINCT x), '{}'::uuid[]) FROM unnest(v.recipient_group_ids ||
          coalesce((SELECT irs.inbound_group_agent_ids FROM public.inbound_routing_settings irs WHERE irs.organization_id = v.organization_id), '{}'::uuid[])) x));
      -- Admins are always allowed to read group voicemail; they are notified only when no member is Active.
    END IF;
    v_key := 'voicemail:' || v.id::text;
    IF cardinality(v_recipients) > 0 THEN
      INSERT INTO public.notifications (user_id, organization_id, type, title, body, action_url, action_label, metadata, event_key)
      SELECT r, v.organization_id, 'voicemail', 'New Voicemail',
             'Voicemail from ' || v_who || CASE WHEN v.duration_seconds IS NOT NULL THEN ' (' || v.duration_seconds || 's)' ELSE '' END,
             CASE WHEN c.contact_id IS NOT NULL THEN '/contacts?contact=' || c.contact_id::text ELSE '/dashboard' END,
             'Listen',
             jsonb_build_object('voicemail_id', v.id, 'call_id', c.id, 'contact_id', c.contact_id, 'phone', c.contact_phone,
                                'duration_seconds', v.duration_seconds, 'source', 'inbound_v2'),
             v_key
        FROM unnest(v_recipients) r
      ON CONFLICT (user_id, event_key) DO NOTHING;
      SELECT count(*) INTO v_present FROM public.notifications n WHERE n.event_key = v_key AND n.user_id = ANY (v_recipients);
      IF v_present = cardinality(v_recipients) THEN
        UPDATE public.voicemails SET notified_at = now(), notify_error = NULL, updated_at = now() WHERE id = v.id;
        v_vm_done := v_vm_done + 1;
      ELSE
        UPDATE public.voicemails SET notify_attempts = notify_attempts + 1,
               notify_next_at = now() + least(interval '6 hours', interval '1 minute' * power(2, least(notify_attempts, 8))::int),
               notify_error = 'incomplete: ' || v_present || '/' || cardinality(v_recipients), updated_at = now() WHERE id = v.id;
      END IF;
    ELSE
      UPDATE public.voicemails SET notify_attempts = notify_attempts + 1,
             notify_next_at = now() + least(interval '6 hours', interval '1 minute' * power(2, least(notify_attempts, 8))::int),
             notify_error = 'no_active_recipient', updated_at = now() WHERE id = v.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('call_id', c.id, 'missed_notified', v_missed_done, 'voicemails_owed', v_vm_owed, 'voicemails_notified', v_vm_done);
END;
$$;
REVOKE ALL ON FUNCTION public.converge_inbound_notifications(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.converge_inbound_notifications(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.converge_inbound_notifications(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.converge_inbound_notifications(uuid) TO service_role;

-- Sweep: due rows only (attempts < 50, next_at elapsed), each in its own subtransaction so one failing
-- record never blocks the others. No age-based abandonment.
CREATE OR REPLACE FUNCTION public.sweep_inbound_notifications(p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_id uuid; v_processed integer := 0; v_failed integer := 0; v_exhausted integer := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM (
      -- Corrective pass 7: a v2 call whose intended recipient is not yet resolved carries an EMPTY
      -- snapshot by definition, so it must be due here too — otherwise no sweep ever retries resolution
      -- when the background worker dies (the route sweep skips it: its parent is already terminal).
      -- Legacy rows are unchanged: they still need a snapshot to be due.
      SELECT c.id, c.created_at FROM public.calls c
       WHERE c.direction = 'inbound' AND c.is_missed AND c.missed_notified_at IS NULL
         AND (cardinality(c.missed_recipient_ids) > 0 OR c.routing_engine = 'v2')
         AND c.missed_notify_attempts < 50
         AND (c.missed_notify_next_at IS NULL OR c.missed_notify_next_at <= now())
      UNION
      SELECT v.call_id, v.created_at FROM public.voicemails v
       WHERE v.status = 'stored' AND v.notified_at IS NULL AND v.notify_attempts < 50
         AND (v.notify_next_at IS NULL OR v.notify_next_at <= now())
    ) due ORDER BY created_at ASC LIMIT least(greatest(coalesce(p_limit, 100), 1), 500)
  LOOP
    BEGIN
      PERFORM public.converge_inbound_notifications(v_id);
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING 'sweep_inbound_notifications: call % failed: %', v_id, SQLERRM;
      UPDATE public.calls SET missed_notify_attempts = missed_notify_attempts + 1,
             missed_notify_next_at = now() + least(interval '6 hours', interval '1 minute' * power(2, least(missed_notify_attempts, 8))::int),
             missed_notify_error = left(SQLERRM, 500) WHERE id = v_id AND is_missed AND missed_notified_at IS NULL;
      UPDATE public.voicemails SET notify_attempts = notify_attempts + 1,
             notify_next_at = now() + least(interval '6 hours', interval '1 minute' * power(2, least(notify_attempts, 8))::int),
             notify_error = left(SQLERRM, 500) WHERE call_id = v_id AND status = 'stored' AND notified_at IS NULL;
    END;
  END LOOP;
  SELECT count(*) INTO v_exhausted FROM public.calls c
   WHERE c.direction = 'inbound' AND c.is_missed AND c.missed_notified_at IS NULL AND c.missed_notify_attempts >= 50;
  RETURN jsonb_build_object('processed', v_processed, 'failed', v_failed, 'exhausted_missed', v_exhausted);
END;
$$;
REVOKE ALL ON FUNCTION public.sweep_inbound_notifications(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sweep_inbound_notifications(integer) FROM anon;
REVOKE ALL ON FUNCTION public.sweep_inbound_notifications(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_inbound_notifications(integer) TO service_role;

-- ── 7. pg_cron schedule (only where pg_cron exists; guarded, re-runnable) ────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inbound-notify-sweep') THEN
      PERFORM cron.unschedule('inbound-notify-sweep');
    END IF;
    PERFORM cron.schedule('inbound-notify-sweep', '*/2 * * * *', $c$SELECT public.sweep_inbound_notifications(100)$c$);
    -- Corrective pass 4: durable recovery for routing work no callback will finish (M6 §14).
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inbound-route-attempt-sweep') THEN
      PERFORM cron.unschedule('inbound-route-attempt-sweep');
    END IF;
    PERFORM cron.schedule('inbound-route-attempt-sweep', '*/2 * * * *', $c$SELECT public.sweep_inbound_route_attempts()$c$);
  ELSE
    RAISE NOTICE 'pg_cron not installed: inbound-notify-sweep / inbound-route-attempt-sweep not scheduled (local/dev stack)';
  END IF;
END $$;
