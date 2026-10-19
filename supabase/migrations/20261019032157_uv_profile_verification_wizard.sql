-- Profile completion, confirmed by the agent; no independent credential verification.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.prepare_uv_profile_sync(uuid,uuid,uuid,boolean)'::regprocedure) IS DISTINCT FROM '6cee15a002bed590e63ce7f6f7a06417'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.finish_uv_profile_sync(uuid,uuid,uuid,bigint,jsonb,text)'::regprocedure) IS DISTINCT FROM 'd0334d97bd9b9f724605eca597802299'
 THEN RAISE EXCEPTION 'uv_verification_preimage_changed'; END IF;
END $$;
ALTER TABLE private.uv_profile_sync ADD COLUMN confirmed_at timestamptz;
ALTER TABLE private.uv_profile_sync ADD COLUMN bio text NOT NULL DEFAULT '' CHECK (length(bio)<=2000);

CREATE FUNCTION private.uv_profile_complete(p_organization_id uuid,p_profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_profile_id AND p.organization_id=p_organization_id
   AND length(btrim(p.first_name)) BETWEEN 1 AND 50 AND length(btrim(p.last_name)) BETWEEN 1 AND 50
   AND length(p.phone)<=40 AND length(regexp_replace(p.phone,'[^0-9]','','g')) BETWEEN 10 AND 15
   AND length(p.email)<=254 AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
   AND length(btrim(p.npn)) BETWEEN 1 AND 40 AND p.npn !~ '[[:cntrl:]]'
   AND length(p.avatar_url) BETWEEN 1 AND 4000000
   AND p.avatar_url ~ '^(https://[^[:space:]]+|data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*)$'
   AND EXISTS(SELECT 1 FROM public.agent_state_licenses l WHERE l.agent_id=p.id AND l.organization_id=p.organization_id
     AND public.normalize_us_state(l.state)=ANY(string_to_array('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY',' '))
     AND length(btrim(l.license_number)) BETWEEN 1 AND 50 AND l.license_number !~ '[[:cntrl:]]'));
$$;
REVOKE ALL ON FUNCTION private.uv_profile_complete(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Keep the existing status RPC response unchanged for older clients.
CREATE FUNCTION public.get_my_uv_verification() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status jsonb; verified boolean;
BEGIN
 v_status := public.get_my_uv_profile();
 SELECT coalesce(s.confirmed_at IS NOT NULL AND s.payload->>'profile_verified'='true'
   AND s.revision=s.delivered_revision AND s.version=s.delivered_version
   AND v_status->>'state'='published' AND private.uv_profile_complete(s.organization_id,s.profile_id),false)
 INTO verified FROM private.uv_profile_sync s
 WHERE s.organization_id=(v_status->>'organization_id')::uuid AND s.profile_id=auth.uid();
 RETURN jsonb_build_object('status',v_status,'verified',coalesce(verified,false));
END $$;

CREATE FUNCTION public.get_my_uv_setup() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status jsonb; p public.profiles%ROWTYPE; draft jsonb; licenses jsonb; bio text;
BEGIN
 v_status := public.get_my_uv_profile();
 IF v_status->>'available' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'profile_source_disabled' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT p FROM public.profiles WHERE id=auth.uid() AND organization_id=(v_status->>'organization_id')::uuid;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'state',l.state,'license_number',coalesce(l.license_number,''),
   'expiration_date',l.expiration_date) ORDER BY l.state,l.id),'[]'::jsonb) INTO licenses
 FROM public.agent_state_licenses l WHERE l.agent_id=p.id AND l.organization_id=p.organization_id;
 SELECT s.bio INTO bio FROM private.uv_profile_sync s WHERE s.organization_id=p.organization_id AND s.profile_id=p.id;
 draft := jsonb_build_object('first_name',coalesce(p.first_name,''),'last_name',coalesce(p.last_name,''),
   'phone',coalesce(p.phone,''),'email',coalesce(p.email,''),'npn',coalesce(p.npn,''),'avatar_url',coalesce(p.avatar_url,''),
   'licenses',licenses,'bio',coalesce(bio,''));
 RETURN jsonb_build_object('profile_id',p.id,'organization_id',p.organization_id,'revision',v_status->>'revision',
   'snapshot',md5(draft::text),'draft',draft);
END $$;

CREATE FUNCTION public.complete_my_uv_setup(p_profile_id uuid,p_organization_id uuid,p_expected_revision bigint,
 p_snapshot text,p_draft jsonb,p_phone_public boolean,p_email_public boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.profiles%ROWTYPE; current_setup jsonb; item jsonb; license_id uuid; s private.uv_profile_sync%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 IF auth.uid() IS NULL OR p.id IS NULL OR p.organization_id IS NULL OR p.organization_id IS DISTINCT FROM public.get_org_id()
   OR p.id IS DISTINCT FROM p_profile_id OR p.organization_id IS DISTINCT FROM p_organization_id
 THEN RAISE EXCEPTION 'profile_scope_changed' USING ERRCODE='42501'; END IF;
 -- Lock existing canonical rows before checking the snapshot; never delete or change their dates.
 PERFORM 1 FROM public.agent_state_licenses WHERE agent_id=p.id AND organization_id=p.organization_id ORDER BY id FOR UPDATE;
 INSERT INTO private.uv_profile_sync(organization_id,profile_id) VALUES(p.organization_id,p.id) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT s FROM private.uv_profile_sync WHERE organization_id=p.organization_id AND profile_id=p.id FOR UPDATE;
 current_setup := public.get_my_uv_setup(); -- includes enabled/active/protected exclusion checks
 IF p_expected_revision IS NULL OR s.revision<>p_expected_revision OR p_snapshot IS DISTINCT FROM current_setup->>'snapshot'
 THEN RAISE EXCEPTION 'profile_changed_reload' USING ERRCODE='40001'; END IF;
 IF p_phone_public IS NULL OR p_email_public IS NULL OR NOT(p_phone_public OR p_email_public) OR jsonb_typeof(p_draft) IS DISTINCT FROM 'object'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_draft) k WHERE k NOT IN ('first_name','last_name','phone','email','npn','avatar_url','bio','licenses'))
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['first_name','last_name','phone','email','npn','avatar_url','bio']) k WHERE jsonb_typeof(p_draft->k) IS DISTINCT FROM 'string')
   OR length(p_draft->>'bio')>2000 OR length(p_draft::text)>4500000
   OR concat(p_draft->>'first_name',p_draft->>'last_name',p_draft->>'phone',p_draft->>'email',p_draft->>'npn') ~ '[[:cntrl:]]'
   OR jsonb_typeof(p_draft->'licenses') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'invalid_profile' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_draft->'licenses') NOT BETWEEN 1 AND 60
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(current_setup->'draft'->'licenses') old
     WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_draft->'licenses') new WHERE new->>'id'=old->>'id'))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_draft->'licenses') x WHERE x->>'id' IS NOT NULL GROUP BY x->>'id' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'invalid_licenses' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(p_draft->'licenses') LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object'
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('id','state','license_number','expiration_date'))
     OR jsonb_typeof(item->'state') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'license_number') IS DISTINCT FROM 'string'
     OR length(item->>'license_number')>50 OR item->>'license_number' ~ '[[:cntrl:]]'
     OR public.normalize_us_state(item->>'state') IS NULL
     OR NOT(public.normalize_us_state(item->>'state')=ANY(string_to_array('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY',' ')))
   THEN RAISE EXCEPTION 'invalid_licenses' USING ERRCODE='22023'; END IF;
   license_id := (item->>'id')::uuid;
   IF license_id IS NOT NULL THEN
     UPDATE public.agent_state_licenses SET license_number=nullif(btrim(item->>'license_number'),'')
       WHERE id=license_id AND agent_id=p.id AND organization_id=p.organization_id AND state=item->>'state';
     IF NOT FOUND THEN RAISE EXCEPTION 'license_scope_changed' USING ERRCODE='42501'; END IF;
   ELSE
     IF length(btrim(item->>'license_number'))<1 THEN RAISE EXCEPTION 'invalid_licenses' USING ERRCODE='22023'; END IF;
     INSERT INTO public.agent_state_licenses(organization_id,agent_id,state,license_number)
       VALUES(p.organization_id,p.id,public.normalize_us_state(item->>'state'),btrim(item->>'license_number'));
   END IF;
 END LOOP;
 UPDATE public.profiles SET first_name=btrim(p_draft->>'first_name'),last_name=btrim(p_draft->>'last_name'),
   phone=btrim(p_draft->>'phone'),email=btrim(p_draft->>'email'),npn=btrim(p_draft->>'npn'),avatar_url=p_draft->>'avatar_url'
 WHERE id=p.id AND organization_id=p.organization_id;
 IF NOT private.uv_profile_complete(p.organization_id,p.id) THEN RAISE EXCEPTION 'profile_incomplete' USING ERRCODE='22023'; END IF;
 UPDATE private.uv_profile_sync SET confirmed_at=now(),bio=btrim(p_draft->>'bio'),desired_published=true,
   phone_public=p_phone_public,email_public=p_email_public,revision=revision+1,next_attempt_at=now(),
   lease_token=NULL,lease_expires_at=NULL,attempts=0,last_error=NULL,warning=NULL
 WHERE organization_id=p.organization_id AND profile_id=p.id;
 RETURN public.get_my_uv_verification();
END $$;
REVOKE ALL ON FUNCTION public.get_my_uv_verification(),public.get_my_uv_setup(),
 public.complete_my_uv_setup(uuid,uuid,bigint,text,jsonb,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_uv_verification(),public.get_my_uv_setup(),
 public.complete_my_uv_setup(uuid,uuid,bigint,text,jsonb,boolean,boolean) TO authenticated;

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
        AND public.normalize_us_state(state)=ANY(string_to_array('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY',' '))
        AND length(btrim(license_number)) BETWEEN 1 AND 50 AND license_number !~ '[[:cntrl:]]'
    ) x;
    body := jsonb_build_object('published',true,'first_name',btrim(p.first_name),'last_name',btrim(p.last_name),
      'phone',CASE WHEN s.phone_public THEN coalesce(p.phone,'') ELSE '' END,
      'email',CASE WHEN s.email_public THEN coalesce(p.email,'') ELSE '' END,
      'agency',c.agency_name,'agency_slug',c.agency_slug,'npn',coalesce(p.npn,''),
      'headshot_url',coalesce(p.avatar_url,''),'state_licenses',licenses,'bio',s.bio,
      'profile_verified',s.confirmed_at IS NOT NULL AND private.uv_profile_complete(s.organization_id,s.profile_id));
  END IF;
  IF body IS DISTINCT FROM s.payload THEN
    UPDATE private.uv_profile_sync SET payload=body,version=version+1 WHERE organization_id=s.organization_id AND profile_id=s.profile_id RETURNING * INTO s;
  END IF;
  RETURN jsonb_build_object('envelope',jsonb_build_object('schema',1,'organization_id',s.organization_id,'profile_id',s.profile_id,
    'version',s.version::text,'profile',body),'needs_delivery',s.version>s.delivered_version);
END $$;

CREATE OR REPLACE FUNCTION public.finish_uv_profile_sync(p_organization_id uuid,p_profile_id uuid,p_lease_token uuid,p_version bigint,
  p_receipt jsonb DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s private.uv_profile_sync%ROWTYPE; success boolean; next_due timestamptz := 'infinity'::timestamptz;
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
  -- Profile confirmation has no expiration requirement. Only saved changes wake settled rows.
  UPDATE private.uv_profile_sync SET lease_token=NULL,lease_expires_at=NULL,
    delivered_version=CASE WHEN success THEN version ELSE delivered_version END,
    delivered_revision=CASE WHEN success OR (p_error IS NULL AND version=delivered_version) THEN revision ELSE delivered_revision END,
    remote_published=CASE WHEN success THEN (p_receipt->>'published')::boolean ELSE remote_published END,
    public_url=CASE WHEN success THEN p_receipt->>'public_url' ELSE public_url END,
    warning=CASE WHEN success THEN p_receipt->>'warning' ELSE warning END,
    last_synced_at=CASE WHEN success THEN now() ELSE last_synced_at END,
    last_error=p_error,attempts=CASE WHEN p_error IS NULL THEN 0 ELSE least(attempts+1,10) END,
    next_attempt_at=CASE WHEN p_error IS NULL THEN next_due
      ELSE now()+make_interval(secs=>least(3600,60*power(2,least(attempts,6)))::integer) END
    WHERE organization_id=s.organization_id AND profile_id=s.profile_id;
  RETURN true;
END $$;
