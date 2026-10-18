-- Inert release candidate: no source enrollment, secrets, cron or remote calls.
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.uv_profile_sources (
  organization_id uuid PRIMARY KEY,
  agency_name text NOT NULL CHECK (length(btrim(agency_name)) BETWEEN 1 AND 120),
  agency_slug text NOT NULL CHECK (agency_slug ~ '^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$'),
  enabled boolean NOT NULL DEFAULT false
);
-- Intentionally no cascading FK: deletion/transfer must retain a delivery tombstone.
CREATE TABLE private.uv_profile_sync (
  organization_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  desired_published boolean NOT NULL DEFAULT false,
  phone_public boolean NOT NULL DEFAULT false,
  email_public boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  payload jsonb,
  delivered_version bigint NOT NULL DEFAULT 0,
  delivered_revision bigint NOT NULL DEFAULT 0,
  remote_published boolean NOT NULL DEFAULT false,
  public_url text CHECK (public_url ~ '^https://www[.]underwriterverified[.]com/[a-z0-9][a-z0-9-]{0,79}/[a-z0-9][a-z0-9-]{0,79}$'),
  warning text CHECK (warning IN ('identity_review_required')),
  last_error text CHECK (last_error IN ('invalid_profile','temporarily_unavailable','link_required','configuration_required','version_conflict','invalid_receipt')),
  last_synced_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  PRIMARY KEY (organization_id,profile_id)
);
CREATE INDEX uv_profile_sync_due ON private.uv_profile_sync(next_attempt_at,lease_expires_at);
ALTER TABLE private.uv_profile_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.uv_profile_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.uv_profile_sources,private.uv_profile_sync FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_my_uv_profile() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.profiles%ROWTYPE; s private.uv_profile_sync%ROWTYPE; available boolean; target boolean; state text;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE id=auth.uid();
  IF auth.uid() IS NULL OR p.id IS NULL OR p.organization_id IS NULL OR p.organization_id IS DISTINCT FROM public.get_org_id()
    THEN RAISE EXCEPTION 'profile_scope_unavailable' USING ERRCODE='42501'; END IF;
  SELECT EXISTS(SELECT 1 FROM private.uv_profile_sources c JOIN public.organizations o ON o.id=c.organization_id
    WHERE c.organization_id=p.organization_id AND c.enabled AND lower(o.status)='active' AND p.status='Active') INTO available;
  SELECT * INTO s FROM private.uv_profile_sync WHERE organization_id=p.organization_id AND profile_id=p.id;
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

CREATE FUNCTION public.set_my_uv_profile(p_profile_id uuid,p_organization_id uuid,p_published boolean,p_phone_public boolean,p_email_public boolean,p_expected_revision bigint)
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

CREATE FUNCTION public.claim_uv_profile_sync(p_limit integer DEFAULT 5) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'invalid_batch' USING ERRCODE='22023'; END IF;
  WITH candidates AS (
    SELECT organization_id,profile_id FROM private.uv_profile_sync
    WHERE next_attempt_at<=now() AND (lease_expires_at IS NULL OR lease_expires_at<=now())
    ORDER BY next_attempt_at,organization_id,profile_id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE private.uv_profile_sync s SET lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes'
    FROM candidates c WHERE s.organization_id=c.organization_id AND s.profile_id=c.profile_id
    RETURNING s.organization_id,s.profile_id,s.lease_token
  ) SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO result FROM claimed;
  RETURN result;
END $$;

CREATE FUNCTION public.prepare_uv_profile_sync(p_organization_id uuid,p_profile_id uuid,p_lease_token uuid,p_force_private boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s private.uv_profile_sync%ROWTYPE; p public.profiles%ROWTYPE; c private.uv_profile_sources%ROWTYPE;
  body jsonb := '{"published":false}'::jsonb; licenses jsonb; active boolean;
BEGIN
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
      SELECT DISTINCT upper(btrim(state))||' - #'||btrim(license_number) AS v FROM public.agent_state_licenses
      WHERE organization_id=s.organization_id AND agent_id=s.profile_id
        AND expiration_date IS NOT NULL AND expiration_date>=(now() AT TIME ZONE 'UTC')::date
        AND upper(btrim(state))=ANY(string_to_array('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY',' '))
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

CREATE FUNCTION public.finish_uv_profile_sync(p_organization_id uuid,p_profile_id uuid,p_lease_token uuid,p_version bigint,
  p_receipt jsonb DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s private.uv_profile_sync%ROWTYPE; success boolean;
BEGIN
  SELECT * INTO s FROM private.uv_profile_sync WHERE organization_id=p_organization_id AND profile_id=p_profile_id FOR UPDATE;
  IF NOT FOUND OR p_lease_token IS NULL OR s.lease_token IS DISTINCT FROM p_lease_token OR s.lease_expires_at<=now()
    OR p_version IS DISTINCT FROM s.version THEN RETURN false; END IF;
  IF p_error IS NOT NULL AND p_error NOT IN ('invalid_profile','temporarily_unavailable','link_required','configuration_required','version_conflict','invalid_receipt')
    THEN RAISE EXCEPTION 'invalid_error_code' USING ERRCODE='22023'; END IF;
  success := p_receipt IS NOT NULL;
  IF success AND (jsonb_typeof(p_receipt) IS DISTINCT FROM 'object'
    OR p_receipt->>'version' IS DISTINCT FROM s.version::text
    OR p_receipt->'published' IS DISTINCT FROM s.payload->'published'
    OR coalesce(p_receipt->>'warning','') NOT IN ('','identity_review_required')
    OR (p_receipt->>'public_url' IS NOT NULL AND p_receipt->>'public_url' !~ '^https://www[.]underwriterverified[.]com/[a-z0-9][a-z0-9-]{0,79}/[a-z0-9][a-z0-9-]{0,79}$')
    OR ((s.payload->>'published')::boolean AND p_receipt->>'public_url' IS NULL))
    THEN RAISE EXCEPTION 'invalid_receipt' USING ERRCODE='22023'; END IF;
  -- A no-op pass is successful only when this exact version was already acknowledged.
  IF NOT success AND p_error IS NULL AND s.version<>s.delivered_version
    THEN RAISE EXCEPTION 'receipt_required' USING ERRCODE='22023'; END IF;
  UPDATE private.uv_profile_sync SET lease_token=NULL,lease_expires_at=NULL,
    delivered_version=CASE WHEN success THEN version ELSE delivered_version END,
    delivered_revision=CASE WHEN success OR (p_error IS NULL AND version=delivered_version) THEN revision ELSE delivered_revision END,
    remote_published=CASE WHEN success THEN (p_receipt->>'published')::boolean ELSE remote_published END,
    public_url=CASE WHEN success THEN p_receipt->>'public_url' ELSE public_url END,
    warning=CASE WHEN success THEN p_receipt->>'warning' ELSE warning END,
    last_synced_at=CASE WHEN success THEN now() ELSE last_synced_at END,
    last_error=p_error,attempts=CASE WHEN p_error IS NULL THEN 0 ELSE least(attempts+1,10) END,
    next_attempt_at=now()+make_interval(secs=>CASE WHEN p_error IS NULL THEN 60 ELSE least(3600,60*power(2,least(attempts,6)))::integer END)
    WHERE organization_id=s.organization_id AND profile_id=s.profile_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.get_my_uv_profile(),public.set_my_uv_profile(uuid,uuid,boolean,boolean,boolean,bigint),
  public.claim_uv_profile_sync(integer),public.prepare_uv_profile_sync(uuid,uuid,uuid,boolean),
  public.finish_uv_profile_sync(uuid,uuid,uuid,bigint,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_uv_profile(),public.set_my_uv_profile(uuid,uuid,boolean,boolean,boolean,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_uv_profile_sync(integer),public.prepare_uv_profile_sync(uuid,uuid,uuid,boolean),
  public.finish_uv_profile_sync(uuid,uuid,uuid,bigint,jsonb,text) TO service_role;
