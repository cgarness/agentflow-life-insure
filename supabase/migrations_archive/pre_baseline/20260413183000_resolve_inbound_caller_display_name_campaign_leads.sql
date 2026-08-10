-- Extend inbound CID RPC: match campaign_leads (queue copy of phone/name) before clients.

CREATE OR REPLACE FUNCTION public.resolve_inbound_caller_display_name(p_caller_phone text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_last10 text;
  v_fn text;
  v_ln text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  v_org := public.get_org_id();
  IF v_org IS NULL THEN
    RETURN NULL;
  END IF;

  v_last10 := right(regexp_replace(coalesce(p_caller_phone, ''), '[^0-9]', '', 'g'), 10);
  IF v_last10 IS NULL OR length(v_last10) < 10 THEN
    RETURN NULL;
  END IF;

  SELECT l.first_name, l.last_name INTO v_fn, v_ln
  FROM public.leads l
  WHERE l.organization_id = v_org
    AND l.phone IS NOT NULL
    AND length(regexp_replace(l.phone, '[^0-9]', '', 'g')) >= 10
    AND right(regexp_replace(l.phone, '[^0-9]', '', 'g'), 10) = v_last10
  ORDER BY l.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_fn IS NOT NULL OR v_ln IS NOT NULL THEN
    RETURN trim(
      both ' '
      from concat_ws(
        ' ',
        nullif(trim(both ' ' from coalesce(v_fn, '')), ''),
        nullif(trim(both ' ' from coalesce(v_ln, '')), '')
      )
    );
  END IF;

  SELECT cl.first_name, cl.last_name INTO v_fn, v_ln
  FROM public.campaign_leads cl
  WHERE cl.organization_id = v_org
    AND cl.phone IS NOT NULL
    AND length(regexp_replace(cl.phone, '[^0-9]', '', 'g')) >= 10
    AND right(regexp_replace(cl.phone, '[^0-9]', '', 'g'), 10) = v_last10
  ORDER BY cl.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_fn IS NOT NULL OR v_ln IS NOT NULL THEN
    RETURN trim(
      both ' '
      from concat_ws(
        ' ',
        nullif(trim(both ' ' from coalesce(v_fn, '')), ''),
        nullif(trim(both ' ' from coalesce(v_ln, '')), '')
      )
    );
  END IF;

  SELECT c.first_name, c.last_name INTO v_fn, v_ln
  FROM public.clients c
  WHERE c.organization_id = v_org
    AND c.phone IS NOT NULL
    AND length(regexp_replace(c.phone, '[^0-9]', '', 'g')) >= 10
    AND right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) = v_last10
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_fn IS NOT NULL OR v_ln IS NOT NULL THEN
    RETURN trim(
      both ' '
      from concat_ws(
        ' ',
        nullif(trim(both ' ' from coalesce(v_fn, '')), ''),
        nullif(trim(both ' ' from coalesce(v_ln, '')), '')
      )
    );
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.resolve_inbound_caller_display_name(text) IS
  'Org-scoped inbound CID: leads, then campaign_leads, then clients by last 10 digits (SECURITY DEFINER).';
