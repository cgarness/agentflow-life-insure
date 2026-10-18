-- Disabled foundation only. Populate exclusions through a separately approved operation.
CREATE TABLE private.uv_profile_exclusions (
  organization_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  PRIMARY KEY (organization_id, profile_id)
);
ALTER TABLE private.uv_profile_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.uv_profile_exclusions FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_uv_profile() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.profiles%ROWTYPE; s private.uv_profile_sync%ROWTYPE; available boolean; target boolean; state text;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE id=auth.uid();
  IF auth.uid() IS NULL OR p.id IS NULL OR p.organization_id IS NULL OR p.organization_id IS DISTINCT FROM public.get_org_id()
    THEN RAISE EXCEPTION 'profile_scope_unavailable' USING ERRCODE='42501'; END IF;
  SELECT EXISTS(SELECT 1 FROM private.uv_profile_sources c JOIN public.organizations o ON o.id=c.organization_id
    WHERE c.organization_id=p.organization_id AND c.enabled AND lower(o.status)='active' AND p.status='Active') INTO available;
  SELECT * INTO s FROM private.uv_profile_sync WHERE organization_id=p.organization_id AND profile_id=p.id;
  IF EXISTS (SELECT 1 FROM private.uv_profile_exclusions e WHERE e.organization_id=p.organization_id AND e.profile_id=p.id) THEN
    RETURN jsonb_build_object('profile_id',p.id,'organization_id',p.organization_id,'available',false,
      'desired_published',false,'phone_public',false,'email_public',false,'revision',coalesce(s.revision,0)::text,
      'state','disabled','public_url',NULL,'last_synced_at',s.last_synced_at);
  END IF;
  target := available AND coalesce(s.desired_published,false);
  state := CASE WHEN s.last_error IS NOT NULL OR s.warning IS NOT NULL THEN 'attention'
    WHEN coalesce(s.remote_published,false) IS DISTINCT FROM target OR coalesce(s.version,0)>coalesce(s.delivered_version,0) OR coalesce(s.revision,0)>coalesce(s.delivered_revision,0) THEN 'pending'
    WHEN target THEN 'published' WHEN NOT available AND s.profile_id IS NULL THEN 'disabled' ELSE 'private' END;
  RETURN jsonb_build_object('profile_id',p.id,'organization_id',p.organization_id,'available',available,
    'desired_published',coalesce(s.desired_published,false),'phone_public',coalesce(s.phone_public,false),
    'email_public',coalesce(s.email_public,false),'revision',coalesce(s.revision,0)::text,'state',state,
    'public_url',CASE WHEN target AND s.remote_published THEN s.public_url ELSE NULL END,
    'last_synced_at',s.last_synced_at);
END $$;

CREATE OR REPLACE FUNCTION public.set_my_uv_profile(p_profile_id uuid,p_organization_id uuid,p_published boolean,p_phone_public boolean,p_email_public boolean,p_expected_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.profiles%ROWTYPE; s private.uv_profile_sync%ROWTYPE;
BEGIN
  IF p_published IS NULL OR p_phone_public IS NULL OR p_email_public IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0
    THEN RAISE EXCEPTION 'invalid_preferences' USING ERRCODE='22023'; END IF;
  SELECT * INTO p FROM public.profiles WHERE id=auth.uid() FOR SHARE;
  IF auth.uid() IS NULL OR p.id IS NULL OR p.organization_id IS NULL OR p.organization_id IS DISTINCT FROM public.get_org_id()
    THEN RAISE EXCEPTION 'profile_scope_unavailable' USING ERRCODE='42501'; END IF;
  IF p.id IS DISTINCT FROM p_profile_id OR p.organization_id IS DISTINCT FROM p_organization_id
    THEN RAISE EXCEPTION 'profile_scope_changed' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM private.uv_profile_exclusions e WHERE e.organization_id=p.organization_id AND e.profile_id=p.id) THEN RAISE EXCEPTION 'profile_excluded' USING ERRCODE='42501'; END IF;
  IF p_published AND (p.status<>'Active' OR NOT EXISTS (SELECT 1 FROM private.uv_profile_sources c
    JOIN public.organizations o ON o.id=c.organization_id WHERE c.organization_id=p.organization_id AND c.enabled AND lower(o.status)='active'))
    THEN RAISE EXCEPTION 'profile_source_disabled' USING ERRCODE='42501'; END IF;
  INSERT INTO private.uv_profile_sync(organization_id,profile_id) VALUES(p.organization_id,p.id) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT s FROM private.uv_profile_sync WHERE organization_id=p.organization_id AND profile_id=p.id FOR UPDATE;
  IF s.revision<>p_expected_revision THEN RAISE EXCEPTION 'preferences_changed_reload' USING ERRCODE='40001'; END IF;
  IF ROW(s.desired_published,s.phone_public,s.email_public) IS DISTINCT FROM ROW(p_published,p_phone_public,p_email_public) THEN
    UPDATE private.uv_profile_sync SET desired_published=p_published,phone_public=p_phone_public,email_public=p_email_public,
      revision=revision+1,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=now(),attempts=0,last_error=NULL
      WHERE organization_id=p.organization_id AND profile_id=p.id;
  END IF;
  RETURN public.get_my_uv_profile();
END $$;

CREATE OR REPLACE FUNCTION public.claim_uv_profile_sync(p_limit integer DEFAULT 5) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'invalid_batch' USING ERRCODE='22023'; END IF;
  WITH candidates AS (
    SELECT organization_id,profile_id FROM private.uv_profile_sync
    WHERE NOT EXISTS (SELECT 1 FROM private.uv_profile_exclusions e
      WHERE e.organization_id=uv_profile_sync.organization_id AND e.profile_id=uv_profile_sync.profile_id)
      AND next_attempt_at<=now() AND (lease_expires_at IS NULL OR lease_expires_at<=now())
    ORDER BY next_attempt_at,organization_id,profile_id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE private.uv_profile_sync s SET lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes'
    FROM candidates c WHERE s.organization_id=c.organization_id AND s.profile_id=c.profile_id
    RETURNING s.organization_id,s.profile_id,s.lease_token
  ) SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO result FROM claimed;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.prepare_uv_profile_sync(p_organization_id uuid,p_profile_id uuid,p_lease_token uuid,p_force_private boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s private.uv_profile_sync%ROWTYPE; p public.profiles%ROWTYPE; c private.uv_profile_sources%ROWTYPE;
  body jsonb := '{"published":false}'::jsonb; licenses jsonb; active boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM private.uv_profile_exclusions e WHERE e.organization_id=p_organization_id AND e.profile_id=p_profile_id)
    THEN RAISE EXCEPTION 'profile_excluded' USING ERRCODE='42501'; END IF;
  IF p_force_private IS NULL THEN RAISE EXCEPTION 'invalid_mode' USING ERRCODE='22023'; END IF;
  SELECT * INTO s FROM private.uv_profile_sync WHERE organization_id=p_organization_id AND profile_id=p_profile_id FOR UPDATE;
  IF NOT FOUND OR s.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR s.lease_expires_at<=now() THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.profiles WHERE id=s.profile_id AND organization_id=s.organization_id;
  SELECT * INTO c FROM private.uv_profile_sources WHERE organization_id=s.organization_id;
  SELECT EXISTS(SELECT 1 FROM public.organizations WHERE id=s.organization_id AND lower(status)='active') INTO active;
  IF s.desired_published AND (p.id IS NULL OR p.status<>'Active' OR NOT active) THEN
    UPDATE private.uv_profile_sync SET desired_published=false,revision=revision+1
      WHERE organization_id=s.organization_id AND profile_id=s.profile_id RETURNING * INTO s;
  END IF;
  IF NOT p_force_private AND s.desired_published AND p.status='Active' AND c.enabled AND active THEN
    SELECT coalesce(jsonb_agg(v ORDER BY v),'[]'::jsonb) INTO licenses FROM (
      SELECT DISTINCT public.normalize_us_state(state)||' - #'||btrim(license_number) AS v FROM public.agent_state_licenses
      WHERE organization_id=s.organization_id AND agent_id=s.profile_id
        AND expiration_date IS NOT NULL AND expiration_date>=(now() AT TIME ZONE 'UTC')::date
        AND public.normalize_us_state(state)=ANY(string_to_array('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY',' '))
        AND length(btrim(license_number)) BETWEEN 1 AND 50 AND license_number !~ '[[:cntrl:]]'
    ) x;
    body := jsonb_build_object('published',true,'first_name',btrim(p.first_name),'last_name',btrim(p.last_name),
      'phone',CASE WHEN s.phone_public THEN coalesce(p.phone,'') ELSE '' END,
      'email',CASE WHEN s.email_public THEN coalesce(p.email,'') ELSE '' END,
      'agency',c.agency_name,'agency_slug',c.agency_slug,'npn',coalesce(p.npn,''),
      'headshot_url',coalesce(p.avatar_url,''),'state_licenses',licenses);
  END IF;
  IF body IS DISTINCT FROM s.payload THEN
    UPDATE private.uv_profile_sync SET payload=body,version=version+1 WHERE organization_id=s.organization_id AND profile_id=s.profile_id RETURNING * INTO s;
  END IF;
  RETURN jsonb_build_object('envelope',jsonb_build_object('schema',1,'organization_id',s.organization_id,'profile_id',s.profile_id,
    'version',s.version::text,'profile',body),'needs_delivery',s.version>s.delivered_version);
END $$;
