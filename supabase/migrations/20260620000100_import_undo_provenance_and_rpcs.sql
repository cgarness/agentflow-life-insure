-- Migration: Contacts Build 3 — Safe Import Undo + provenance (Checkpoint 2, rev. 2)
-- AUTHORED AT CHECKPOINT 2 — NOT YET APPLIED. Apply at Checkpoint 3 after the SQL suite runs on a
-- local/dev database (never production-first) and after review.
--
-- Adds: import_history audit/completion columns + DB-derived attachment metadata (CHECK-constrained
-- status); campaign_leads.import_history_id provenance tag (FK + partial index); private auth/validation
-- + blocker helpers; three narrowly-scoped SECURITY DEFINER RPCs (preview / finalize / undo); and a
-- HARDENED replacement for add_leads_to_campaign that validates + stamps exact provenance at INSERT time.
--
-- SECURITY MODEL (implementation_plan.md §7/§8): the undo/preview/finalize functions must SEE engagement
-- (calls/emails/appointments/tasks) created by OTHER users on imported leads, which RLS hides from the
-- importer/manager. They are therefore SECURITY DEFINER (owner = postgres = table owner => RLS bypassed
-- inside). The SOLE authorization boundary is explicit in-function logic: auth.uid() + public.get_org_id()
-- (never trusted input), home-org match, role predicate, Super Admin pinned to home org, unknown/null
-- importer rejected for ordinary users; every query constrained to the caller's org + the validated
-- imported-lead set; results are counts/codes only. All functions pin search_path to a NON-writable
-- schema set (pg_catalog, pg_temp) and fully qualify every public/auth object. PUBLIC/anon are revoked.

------------------------------------------------------------------------------------------------------
-- 1. import_history: audit + completion columns (additive, nullable; CHECK-constrained vocabulary)
--    import_completion_metadata accumulates DB-generated attachment counts across the frontend's
--    500-row batches so finalize can derive status from immutable rows (never browser-supplied counts).
------------------------------------------------------------------------------------------------------
ALTER TABLE public.import_history
  ADD COLUMN IF NOT EXISTS import_completion_status   text,
  ADD COLUMN IF NOT EXISTS import_completion_metadata jsonb,
  ADD COLUMN IF NOT EXISTS undo_status                text,
  ADD COLUMN IF NOT EXISTS undone_at                  timestamptz,
  ADD COLUMN IF NOT EXISTS undone_by                  uuid,
  ADD COLUMN IF NOT EXISTS undo_deleted_count         integer,
  ADD COLUMN IF NOT EXISTS undo_metadata              jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_history_completion_status_chk') THEN
    ALTER TABLE public.import_history
      ADD CONSTRAINT import_history_completion_status_chk
      CHECK (import_completion_status IS NULL OR import_completion_status IN
        ('pending_campaign','completed','completed_with_skips','campaign_partial','campaign_failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_history_undo_status_chk') THEN
    ALTER TABLE public.import_history
      ADD CONSTRAINT import_history_undo_status_chk
      CHECK (undo_status IS NULL OR undo_status IN ('undone'));
  END IF;
END$$;

------------------------------------------------------------------------------------------------------
-- 2. campaign_leads.import_history_id: exact provenance tag (FK + partial index)
------------------------------------------------------------------------------------------------------
ALTER TABLE public.campaign_leads
  ADD COLUMN IF NOT EXISTS import_history_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_leads_import_history_id_fkey') THEN
    ALTER TABLE public.campaign_leads
      ADD CONSTRAINT campaign_leads_import_history_id_fkey
      FOREIGN KEY (import_history_id) REFERENCES public.import_history(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_campaign_leads_import_history_id
  ON public.campaign_leads (import_history_id) WHERE import_history_id IS NOT NULL;

------------------------------------------------------------------------------------------------------
-- 3. Private helper: identity + authorization + hardened imported_lead_ids validation.
--    Callable ONLY by the other DEFINER functions (as owner). No client role may execute it.
------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_undo_context(
  p_import_id uuid,
  OUT reason             text,
  OUT authorized         boolean,
  OUT org_id             uuid,
  OUT agent_id           uuid,
  OUT campaign_id        uuid,
  OUT validated_ids      uuid[],
  OUT imported_count     integer,
  OUT completion_status  text,
  OUT undo_status        text,
  OUT created_at         timestamptz,
  OUT expired            boolean,
  OUT already_undone     boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org    uuid := public.get_org_id();
  v_imp    public.import_history%ROWTYPE;
  v_prof   RECORD;
  v_texts  text[];
  v_uuid_re text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  reason := NULL; authorized := false; expired := false; already_undone := false; imported_count := 0;

  IF v_uid IS NULL THEN reason := 'not_authenticated'; RETURN; END IF;
  IF v_org IS NULL THEN reason := 'no_org'; RETURN; END IF;

  SELECT * INTO v_imp FROM public.import_history WHERE id = p_import_id;
  IF NOT FOUND THEN reason := 'not_found'; RETURN; END IF;

  org_id            := v_imp.organization_id;
  agent_id          := v_imp.agent_id;
  campaign_id       := v_imp.campaign_id;
  completion_status := v_imp.import_completion_status;
  undo_status       := v_imp.undo_status;
  created_at        := v_imp.created_at;
  already_undone    := (v_imp.undo_status = 'undone');
  expired           := (v_imp.created_at < now() - interval '24 hours');

  IF v_imp.organization_id IS DISTINCT FROM v_org THEN reason := 'cross_org'; RETURN; END IF;

  SELECT p.role, p.organization_id, p.is_super_admin
    INTO v_prof
    FROM public.profiles p WHERE p.id = v_uid;
  IF NOT FOUND OR v_prof.organization_id IS DISTINCT FROM v_org THEN
    reason := 'not_authorized'; RETURN;
  END IF;

  authorized :=
       (v_imp.agent_id = v_uid)
    OR (v_prof.role = 'Admin')
    OR (COALESCE(v_prof.is_super_admin, false) AND v_prof.organization_id = v_org)
    OR (v_prof.role IN ('Team Leader','Team Lead')
          AND v_imp.agent_id IS NOT NULL
          AND public.is_ancestor_of(v_uid, v_imp.agent_id));

  IF v_imp.agent_id IS NULL
     AND NOT (v_prof.role = 'Admin' OR (COALESCE(v_prof.is_super_admin, false) AND v_prof.organization_id = v_org)) THEN
    authorized := false;
  END IF;

  IF NOT authorized THEN reason := 'not_authorized'; RETURN; END IF;

  -- Hardened imported_lead_ids validation (never cast malformed JSON straight to uuid).
  IF v_imp.imported_lead_ids IS NULL
     OR jsonb_typeof(v_imp.imported_lead_ids) <> 'array'
     OR jsonb_array_length(v_imp.imported_lead_ids) = 0 THEN
    reason := 'legacy_no_ids'; RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_imp.imported_lead_ids) e
    WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ v_uuid_re
  ) THEN
    reason := 'invalid_import_provenance'; RETURN;
  END IF;

  SELECT array_agg(e #>> '{}') INTO v_texts FROM jsonb_array_elements(v_imp.imported_lead_ids) e;

  IF (SELECT count(DISTINCT t) FROM unnest(v_texts) t) <> COALESCE(array_length(v_texts, 1), 0) THEN
    reason := 'invalid_import_provenance'; RETURN;  -- duplicate ids
  END IF;

  validated_ids  := v_texts::uuid[];
  imported_count := COALESCE(array_length(validated_ids, 1), 0);

  IF EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = ANY(validated_ids) AND l.organization_id IS DISTINCT FROM v_imp.organization_id
  ) THEN
    reason := 'invalid_import_provenance'; validated_ids := NULL; imported_count := 0; RETURN;
  END IF;
END;
$$;

-- Private helper — owner-only. Revoke from service_role too (Supabase default-privileges auto-grant it);
-- the DEFINER RPCs call it as owner, so this does not affect them.
REVOKE ALL ON FUNCTION public._import_undo_context(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._import_undo_context(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._import_undo_context(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public._import_undo_context(uuid) FROM service_role;

------------------------------------------------------------------------------------------------------
-- 4. Private helper: engagement / blocking checks over the validated imported set. Returns reason codes
--    (empty = clean). DEFINER so it sees engagement owned by any user in the org.
------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_undo_blockers(
  p_import_id uuid,
  p_org uuid,
  p_ids uuid[]
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  codes text[] := ARRAY[]::text[];
  v_existing int;
BEGIN
  SELECT count(*) INTO v_existing FROM public.leads WHERE id = ANY(p_ids) AND organization_id = p_org;
  IF v_existing < COALESCE(array_length(p_ids, 1), 0) THEN codes := array_append(codes, 'lead_missing'); END IF;

  IF EXISTS (
    SELECT 1 FROM public.calls c
    WHERE c.organization_id = p_org AND (
      c.lead_id = ANY(p_ids)
      OR (c.lead_id IS NULL AND c.contact_id = ANY(p_ids) AND (c.contact_type = 'lead' OR c.contact_type IS NULL))
    )
  ) THEN codes := array_append(codes, 'has_calls'); END IF;

  IF EXISTS (SELECT 1 FROM public.call_logs WHERE lead_id = ANY(p_ids)) THEN
    codes := array_append(codes, 'has_calls');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.lead_id = ANY(p_ids)
       OR (m.contact_id = ANY(p_ids) AND (m.contact_type = 'lead' OR m.contact_type IS NULL))
  ) THEN codes := array_append(codes, 'has_messages'); END IF;

  IF EXISTS (SELECT 1 FROM public.contact_emails WHERE organization_id = p_org AND contact_id = ANY(p_ids)) THEN
    codes := array_append(codes, 'has_emails');
  END IF;

  IF EXISTS (SELECT 1 FROM public.appointments WHERE organization_id = p_org AND contact_id = ANY(p_ids)) THEN
    codes := array_append(codes, 'has_appointments');
  END IF;

  IF EXISTS (SELECT 1 FROM public.tasks WHERE organization_id = p_org AND contact_id = ANY(p_ids)) THEN
    codes := array_append(codes, 'has_tasks');
  END IF;

  IF EXISTS (SELECT 1 FROM public.contact_notes WHERE contact_id = ANY(p_ids)) THEN
    codes := array_append(codes, 'has_notes');
  END IF;

  -- Activities other than an import-origin system entry (none exist today; defensive carve-out).
  IF EXISTS (
    SELECT 1 FROM public.contact_activities a
    WHERE a.contact_id = ANY(p_ids)
      AND COALESCE(a.activity_type, '') <> 'import'
      AND COALESCE(a.metadata->>'source', '') <> 'import'
  ) THEN codes := array_append(codes, 'has_activity'); END IF;

  IF EXISTS (
    SELECT 1 FROM public.workflow_executions
    WHERE organization_id = p_org AND contact_id = ANY(p_ids) AND status = 'running'
  ) THEN codes := array_append(codes, 'has_workflow'); END IF;

  IF EXISTS (SELECT 1 FROM public.wins WHERE contact_id = ANY(p_ids)) THEN
    codes := array_append(codes, 'has_win');
  END IF;

  -- Any campaign membership for an imported lead NOT tagged with this import => foreign membership.
  IF EXISTS (
    SELECT 1 FROM public.campaign_leads cl
    WHERE cl.lead_id = ANY(p_ids)
      AND (cl.import_history_id IS DISTINCT FROM p_import_id)
  ) THEN codes := array_append(codes, 'foreign_campaign_membership'); END IF;

  RETURN codes;
END;
$$;

-- Private helper — owner-only (see note above). Takes caller-supplied org/ids, so lock to owner.
REVOKE ALL ON FUNCTION public._import_undo_blockers(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._import_undo_blockers(uuid, uuid, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public._import_undo_blockers(uuid, uuid, uuid[]) FROM authenticated;
REVOKE ALL ON FUNCTION public._import_undo_blockers(uuid, uuid, uuid[]) FROM service_role;

------------------------------------------------------------------------------------------------------
-- 5. add_leads_to_campaign — HARDENED replacement. DROP+CREATE because a defaulted param cannot be
--    added via CREATE OR REPLACE. No DB-internal dependents (verified). Existing 2-arg callers keep
--    working via the default. When p_import_history_id IS NULL the behavior is the original generic
--    Add-to-Campaign exactly (no provenance written). When NOT NULL, the import is fully validated and
--    the tag is stamped IN the INSERT; durable attachment metadata is accumulated in this transaction.
------------------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.add_leads_to_campaign(uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.add_leads_to_campaign(
  p_campaign_id uuid,
  p_lead_ids uuid[],
  p_import_history_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_campaign RECORD;
  v_campaign_type TEXT;
  v_campaign_user_id UUID;
  v_lead RECORD;
  v_lead_id UUID;
  v_valid_leads JSONB := '[]'::JSONB;
  v_skipped_ids UUID[] := ARRAY[]::UUID[];
  v_added INT := 0;
  v_skipped INT := 0;
  v_attempted INT := COALESCE(array_length(p_lead_ids, 1), 0);
  v_already_exists BOOLEAN;
  v_ctx RECORD;
BEGIN
  -- Provenance gate: when an import id is supplied, fully validate it BEFORE tagging any row.
  IF p_import_history_id IS NOT NULL THEN
    SELECT * INTO v_ctx FROM public._import_undo_context(p_import_history_id);
    IF v_ctx.reason IS NOT NULL THEN
      RAISE EXCEPTION 'import provenance rejected: %', v_ctx.reason USING ERRCODE = '42501';
    END IF;
    IF NOT v_ctx.authorized THEN
      RAISE EXCEPTION 'not authorized for import %', p_import_history_id USING ERRCODE = '42501';
    END IF;
    IF v_ctx.already_undone THEN
      RAISE EXCEPTION 'import % already undone', p_import_history_id USING ERRCODE = '22023';
    END IF;
    IF v_ctx.campaign_id IS DISTINCT FROM p_campaign_id THEN
      RAISE EXCEPTION 'import % campaign mismatch', p_import_history_id USING ERRCODE = '22023';
    END IF;
    IF v_ctx.completion_status IS NOT NULL AND v_ctx.completion_status <> 'pending_campaign' THEN
      RAISE EXCEPTION 'import % already finalized (%)', p_import_history_id, v_ctx.completion_status USING ERRCODE = '22023';
    END IF;
    -- Every supplied lead must be a member of this import's recorded set (no foreign tagging).
    IF EXISTS (SELECT 1 FROM unnest(p_lead_ids) x WHERE x <> ALL (v_ctx.validated_ids)) THEN
      RAISE EXCEPTION 'lead id outside import % set', p_import_history_id USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_campaign
  FROM public.campaigns
  WHERE id = p_campaign_id
    AND organization_id = public.get_org_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;

  v_campaign_type := v_campaign.type;
  v_campaign_user_id := v_campaign.user_id;

  FOREACH v_lead_id IN ARRAY p_lead_ids
  LOOP
    SELECT * INTO v_lead
    FROM public.leads
    WHERE id = v_lead_id
      AND organization_id = public.get_org_id();

    IF NOT FOUND THEN
      v_skipped_ids := array_append(v_skipped_ids, v_lead_id);
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.campaign_leads
      WHERE campaign_id = p_campaign_id
        AND lead_id = v_lead_id
    ) INTO v_already_exists;

    IF v_already_exists THEN
      v_skipped_ids := array_append(v_skipped_ids, v_lead_id);
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_campaign_type = 'Personal' THEN
      IF v_lead.assigned_agent_id IS DISTINCT FROM v_campaign_user_id THEN
        v_skipped_ids := array_append(v_skipped_ids, v_lead_id);
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

    ELSIF v_campaign_type = 'Team' THEN
      IF NOT (
        v_lead.assigned_agent_id = v_campaign_user_id
        OR public.is_ancestor_of(v_campaign_user_id, v_lead.assigned_agent_id)
      ) THEN
        v_skipped_ids := array_append(v_skipped_ids, v_lead_id);
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

    ELSIF v_campaign_type IN ('Open', 'Open Pool') THEN
      NULL;
    END IF;

    v_valid_leads := v_valid_leads || jsonb_build_object(
      'campaign_id', p_campaign_id,
      'lead_id', v_lead_id,
      'first_name', v_lead.first_name,
      'last_name', v_lead.last_name,
      'phone', v_lead.phone,
      'email', v_lead.email,
      'state', public.normalize_us_state(v_lead.state),
      'age', v_lead.age,
      'status', 'Queued',
      'organization_id', public.get_org_id()
    );
    v_added := v_added + 1;
  END LOOP;

  IF v_added > 0 THEN
    INSERT INTO public.campaign_leads (
      campaign_id, lead_id, first_name, last_name,
      phone, email, state, age, status, organization_id, import_history_id
    )
    SELECT
      (el->>'campaign_id')::UUID,
      (el->>'lead_id')::UUID,
      el->>'first_name',
      el->>'last_name',
      el->>'phone',
      el->>'email',
      el->>'state',
      NULLIF(el->>'age', '')::INTEGER,
      el->>'status',
      (el->>'organization_id')::UUID,
      p_import_history_id
    FROM jsonb_array_elements(v_valid_leads) AS el;
  END IF;

  -- Durable, DB-generated attachment metadata accumulated across the frontend's 500-row batches,
  -- written inside THIS transaction from the ACTUAL result. finalize derives status from these
  -- (never browser-supplied counts).
  IF p_import_history_id IS NOT NULL THEN
    UPDATE public.import_history
       SET import_completion_metadata = jsonb_build_object(
             'attempted', COALESCE((import_completion_metadata->>'attempted')::int, 0) + v_attempted,
             'added',     COALESCE((import_completion_metadata->>'added')::int, 0) + v_added,
             'skipped',   COALESCE((import_completion_metadata->>'skipped')::int, 0) + v_skipped,
             'batches',   COALESCE((import_completion_metadata->>'batches')::int, 0) + 1,
             'last_attempt_at', to_jsonb(now())
           )
     WHERE id = p_import_history_id;
  END IF;

  RETURN jsonb_build_object(
    'added', v_added,
    'skipped', v_skipped,
    'skipped_ids', to_jsonb(v_skipped_ids)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.add_leads_to_campaign(uuid, uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_leads_to_campaign(uuid, uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_leads_to_campaign(uuid, uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_leads_to_campaign(uuid, uuid[], uuid) TO service_role;

------------------------------------------------------------------------------------------------------
-- 6. preview_contact_import_undo (read-only, advisory). Counts/codes only; no PII.
------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_contact_import_undo(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c           RECORD;
  v_codes     text[] := ARRAY[]::text[];
  v_existing  int := 0;
  v_tagged    int := 0;
  v_foreign   int := 0;
  v_eligible  boolean;
BEGIN
  SELECT * INTO c FROM public._import_undo_context(p_import_id);

  IF c.reason IS NOT NULL THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'blocked_reason_codes', to_jsonb(ARRAY[c.reason]),
      'import_completion_status', c.completion_status,
      'undo_status', c.undo_status,
      'imported_id_count', COALESCE(c.imported_count, 0)
    );
  END IF;

  IF c.already_undone THEN v_codes := array_append(v_codes, 'already_undone'); END IF;
  IF c.expired       THEN v_codes := array_append(v_codes, 'expired');        END IF;

  v_codes := v_codes || public._import_undo_blockers(p_import_id, c.org_id, c.validated_ids);

  SELECT count(*) INTO v_existing FROM public.leads WHERE id = ANY(c.validated_ids) AND organization_id = c.org_id;
  SELECT count(*) INTO v_tagged   FROM public.campaign_leads WHERE import_history_id = p_import_id;
  SELECT count(*) INTO v_foreign  FROM public.campaign_leads
    WHERE lead_id = ANY(c.validated_ids) AND (import_history_id IS DISTINCT FROM p_import_id);

  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) INTO v_codes FROM unnest(v_codes) x;
  v_eligible := (array_length(v_codes, 1) IS NULL);

  RETURN jsonb_build_object(
    'eligible', v_eligible,
    'imported_id_count', c.imported_count,
    'existing_lead_count', v_existing,
    'campaign_membership_count', v_tagged,
    'foreign_campaign_membership_count', v_foreign,
    'changed_or_missing_count', GREATEST(c.imported_count - v_existing, 0),
    'blocked_reason_codes', to_jsonb(v_codes),
    'import_completion_status', c.completion_status,
    'undo_status', c.undo_status,
    'summary', CASE WHEN v_eligible
                    THEN format('%s leads can be safely removed', c.imported_count)
                    ELSE 'Undo blocked' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_contact_import_undo(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preview_contact_import_undo(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.preview_contact_import_undo(uuid) TO authenticated;

------------------------------------------------------------------------------------------------------
-- 7. finalize_contact_import: derive completion status SOLELY from immutable DB rows (imported-ID
--    count + accumulated attachment metadata + actual tagged-row count). Idempotent; transitions only
--    from NULL/pending_campaign. Does NOT create or repair provenance tags (no defensive tagging).
------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_contact_import(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c          RECORD;
  v_meta     jsonb;
  v_tagged   int := 0;
  v_attempted int := 0;
  v_added    int := 0;
  v_skipped  int := 0;
  v_status   text;
BEGIN
  SELECT * INTO c FROM public._import_undo_context(p_import_id);
  IF c.reason IS NOT NULL THEN
    RETURN jsonb_build_object('finalized', false, 'reason', c.reason);
  END IF;

  -- Idempotent: terminal/undone statuses are returned unchanged.
  IF c.undo_status = 'undone'
     OR (c.completion_status IS NOT NULL AND c.completion_status <> 'pending_campaign') THEN
    RETURN jsonb_build_object('finalized', true, 'status', c.completion_status, 'idempotent', true);
  END IF;

  IF c.campaign_id IS NULL THEN
    v_status := 'completed';
  ELSE
    SELECT import_completion_metadata INTO v_meta FROM public.import_history WHERE id = p_import_id;
    SELECT count(*) INTO v_tagged FROM public.campaign_leads WHERE import_history_id = p_import_id;
    v_attempted := COALESCE((v_meta->>'attempted')::int, 0);
    v_added     := COALESCE((v_meta->>'added')::int, 0);
    v_skipped   := COALESCE((v_meta->>'skipped')::int, 0);

    IF v_meta IS NULL OR v_attempted = 0 THEN
      v_status := 'campaign_failed';                        -- campaign chosen, nothing attempted
    ELSIF v_attempted < c.imported_count THEN
      v_status := 'campaign_partial';                       -- interrupted: a batch failed before all attempted
    ELSIF v_tagged = v_added AND (v_added + v_skipped) = v_attempted THEN
      v_status := CASE WHEN v_skipped = 0 THEN 'completed' ELSE 'completed_with_skips' END;
    ELSE
      v_status := 'campaign_partial';                       -- inconsistency (tagged<>added or count mismatch)
    END IF;
  END IF;

  UPDATE public.import_history
     SET import_completion_status   = v_status,
         import_completion_metadata = COALESCE(import_completion_metadata, '{}'::jsonb)
           || jsonb_build_object('finalized_at', to_jsonb(now()), 'tagged', v_tagged)
   WHERE id = p_import_id
     AND (import_completion_status IS NULL OR import_completion_status = 'pending_campaign');

  RETURN jsonb_build_object(
    'finalized', true,
    'status', v_status,
    'idempotent', false,
    'imported_count', c.imported_count,
    'attempted', v_attempted,
    'added', v_added,
    'skipped', v_skipped,
    'tagged_count', v_tagged
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_contact_import(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_contact_import(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.finalize_contact_import(uuid) TO authenticated;

------------------------------------------------------------------------------------------------------
-- 8. undo_contact_import: atomic, all-or-nothing. Re-validates inside the transaction; deletes only the
--    validated set (tagged campaign rows then leads); marks import_history undone in-function.
------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_contact_import(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c            RECORD;
  v_lock       uuid;
  v_codes      text[];
  v_del_camp   int := 0;
  v_del_leads  int := 0;
BEGIN
  -- Lock the audit row for the duration of the transaction (serialize concurrent undo attempts).
  SELECT id INTO v_lock FROM public.import_history WHERE id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO c FROM public._import_undo_context(p_import_id);
  IF c.reason IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', c.reason);
  END IF;
  IF c.already_undone THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_undone');
  END IF;
  IF c.expired THEN
    RETURN jsonb_build_object('success', false, 'reason', 'expired');
  END IF;

  v_codes := public._import_undo_blockers(p_import_id, c.org_id, c.validated_ids);
  IF array_length(v_codes, 1) IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) INTO v_codes FROM unnest(v_codes) x;
    RETURN jsonb_build_object('success', false, 'reason', 'ineligible', 'blocked_reason_codes', to_jsonb(v_codes));
  END IF;

  DELETE FROM public.campaign_leads
   WHERE import_history_id = p_import_id;
  GET DIAGNOSTICS v_del_camp = ROW_COUNT;

  DELETE FROM public.leads
   WHERE id = ANY(c.validated_ids) AND organization_id = c.org_id;
  GET DIAGNOSTICS v_del_leads = ROW_COUNT;

  UPDATE public.import_history
     SET undo_status        = 'undone',
         undone_at          = now(),
         undone_by          = auth.uid(),
         undo_deleted_count = v_del_leads,
         undo_metadata      = jsonb_build_object(
                                'deleted_leads', v_del_leads,
                                'deleted_campaign_rows', v_del_camp,
                                'imported_count', c.imported_count)
   WHERE id = p_import_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_leads', v_del_leads,
    'deleted_campaign_rows', v_del_camp,
    'undo_status', 'undone'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.undo_contact_import(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.undo_contact_import(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.undo_contact_import(uuid) TO authenticated;

------------------------------------------------------------------------------------------------------
-- 9. Reload PostgREST schema cache so the new RPCs/columns are exposed.
------------------------------------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
