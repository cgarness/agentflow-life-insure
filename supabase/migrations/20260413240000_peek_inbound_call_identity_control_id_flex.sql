-- Match SDK call_control_id (e.g. v3:…) to webhook-stored ids when prefixes differ.

CREATE OR REPLACE FUNCTION public.peek_inbound_call_identity(
  p_telnyx_session_id text DEFAULT NULL,
  p_call_control_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  sid text := nullif(trim(both from coalesce(p_telnyx_session_id, '')), '');
  cc text := nullif(trim(both from coalesce(p_call_control_id, '')), '');
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
      (sid IS NOT NULL AND c.telnyx_call_id = sid)
      OR (
        cc IS NOT NULL
        AND c.telnyx_call_control_id IS NOT NULL
        AND (
          c.telnyx_call_control_id = cc
          OR regexp_replace(c.telnyx_call_control_id, '^v[0-9]+:', '') = cc_norm
        )
      )
    )
  ORDER BY c.created_at DESC NULLS LAST
  LIMIT 1;

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

COMMENT ON FUNCTION public.peek_inbound_call_identity(text, text) IS
  'Returns inbound calls row ANI/CRM snapshot for the current user org (SECURITY DEFINER). Matches call_control_id with or without Telnyx vN: prefix.';

NOTIFY pgrst, 'reload schema';
