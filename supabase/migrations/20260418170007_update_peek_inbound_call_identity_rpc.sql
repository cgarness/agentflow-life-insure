-- Migration 7 of 7: Update peek_inbound_call_identity RPC to use renamed columns.
-- Replaces all three prior versions (20260413230000, 20260413240000, 20260413250000).
-- telnyx_call_id      → provider_session_id
-- telnyx_call_control_id → twilio_call_sid
-- Part of Twilio Migration Phase 1.

DROP FUNCTION IF EXISTS public.peek_inbound_call_identity(text, text);

CREATE OR REPLACE FUNCTION public.peek_inbound_call_identity(
  p_provider_session_id text DEFAULT NULL,
  p_twilio_call_sid text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  sid text := nullif(trim(both from coalesce(p_provider_session_id, '')), '');
  cc text := nullif(trim(both from coalesce(p_twilio_call_sid, '')), '');
  cc_norm text;
  r record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  IF sid IS NULL AND cc IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;

  IF v_org IS NULL THEN
    RETURN NULL;
  END IF;

  -- Strip Twilio vN: prefix if present (mirrors prior Telnyx prefix-tolerance)
  cc_norm := regexp_replace(cc, '^v[0-9]+:', '');

  SELECT
    c.id,
    c.caller_id_used,
    c.contact_phone,
    c.contact_name,
    c.contact_id,
    c.contact_type
  INTO r
  FROM public.calls c
  WHERE c.organization_id = v_org
    AND c.direction IN ('inbound', 'incoming')
    AND (
      (sid IS NOT NULL AND c.provider_session_id = sid)
      OR (
        cc IS NOT NULL
        AND c.twilio_call_sid IS NOT NULL
        AND (
          c.twilio_call_sid = cc
          OR regexp_replace(c.twilio_call_sid, '^v[0-9]+:', '') = cc_norm
        )
      )
    )
  ORDER BY c.created_at DESC NULLS LAST
  LIMIT 1;

  -- Fallback: latest ringing inbound for this org in the last 6 minutes.
  -- Handles bridged WebRTC legs whose IDs differ from the PSTN row.
  IF NOT FOUND THEN
    SELECT
      c.id,
      c.caller_id_used,
      c.contact_phone,
      c.contact_name,
      c.contact_id,
      c.contact_type
    INTO r
    FROM public.calls c
    WHERE c.organization_id = v_org
      AND c.direction IN ('inbound', 'incoming')
      AND c.status = 'ringing'
      AND c.created_at > now() - interval '6 minutes'
    ORDER BY c.created_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'calls_row_id', r.id,
    'caller_id_used', r.caller_id_used,
    'contact_phone', r.contact_phone,
    'contact_name', r.contact_name,
    'contact_id', r.contact_id,
    'contact_type', r.contact_type
  );
END;
$$;

REVOKE ALL ON FUNCTION public.peek_inbound_call_identity(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_inbound_call_identity(text, text) TO authenticated;

COMMENT ON FUNCTION public.peek_inbound_call_identity(text, text) IS
  'Inbound ANI/CRM snapshot for caller org. Matches provider_session_id or twilio_call_sid (prefix-tolerant); if no match, falls back to latest ringing inbound in last 6 min (Twilio bridge leg ids may differ from PSTN row).';

NOTIFY pgrst, 'reload schema';
