-- Isolated fixture for the Automations session RPCs. The test runner supplies auth,
-- the production schema and migrations in a disposable database.
begin;
create function pg_temp.fixture_uuid(n integer) returns uuid language sql immutable as $$
  select ('ae510000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into public.organizations (id, name) values
  (pg_temp.fixture_uuid(1), 'Session tests'), (pg_temp.fixture_uuid(2), 'Other tenant');

insert into private.automation_release_controls (organization_id, builder_visible)
values (pg_temp.fixture_uuid(1), true);

insert into auth.users (id, email) select pg_temp.fixture_uuid(n), 'session-' || n || '@example.invalid'
from generate_series(10, 13) as n;

insert into public.profiles (id, organization_id, role, is_super_admin, status, email)
select pg_temp.fixture_uuid(n), pg_temp.fixture_uuid(case when n = 13 then 2 else 1 end),
       case when n = 10 then 'Super Admin' else 'Agent' end,
       n = 10, 'Active', 'session-' || n || '@example.invalid'
from generate_series(10, 13) as n
on conflict (id) do update set organization_id = excluded.organization_id, role = excluded.role,
  is_super_admin = excluded.is_super_admin, status = excluded.status;

insert into auth.sessions (id, user_id) values
  (pg_temp.fixture_uuid(20), pg_temp.fixture_uuid(10)),
  (pg_temp.fixture_uuid(21), pg_temp.fixture_uuid(10)),
  (pg_temp.fixture_uuid(22), pg_temp.fixture_uuid(11));

-- Changing these GUCs here represents separate requests after gateway JWT verification.
create function pg_temp.signed_request(actor integer, session_number integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.fixture_uuid(actor)::text, true);
  select set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object(
    'sub', pg_temp.fixture_uuid(actor), 'session_id', pg_temp.fixture_uuid(session_number),
    'role', 'authenticated', 'app_metadata', jsonb_build_object('organization_id', pg_temp.fixture_uuid(1))))::text, true);
$$;

create function pg_temp.must_refuse(statement text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when insufficient_privilege or serialization_failure or invalid_parameter_value
                 or invalid_text_representation or raise_exception then
    return;
  end;
  raise exception 'Unexpectedly accepted: %', statement;
end
$$;

create function pg_temp.save_draft(doc integer, expected bigint, session_revision bigint)
returns jsonb language sql as $$
  select public.save_automation_draft(pg_temp.fixture_uuid(doc), 'Synthetic session test',
    '{"format":1,"nodes":[],"edges":[],"settings":{"reentry":"once","stop_on_reply":false}}'::jsonb,
    expected, session_revision);
$$;

set local role authenticated;
do $$
declare
  own_session jsonb;
  separate_session jsonb;
  viewing jsonb;
  normal jsonb;
begin
  perform pg_temp.signed_request(10, 20);
  own_session := public.automation_session_context();
  if own_session->>'actor_id' is distinct from pg_temp.fixture_uuid(10)::text
     or own_session->>'session_id' is distinct from pg_temp.fixture_uuid(20)::text
     or (own_session->>'revision')::bigint is null or own_session->>'target_id' is not null then
    raise exception 'Unexpected normal session %', own_session;
  end if;
  if public.automation_session_context() is distinct from own_session then
    raise exception 'Context read changed session mode or revision';
  end if;

  perform pg_temp.save_draft(30, 0, (own_session->>'revision')::bigint);
  perform pg_temp.must_refuse(format('select public.automation_session_transition(%s, pg_temp.fixture_uuid(13))',
                                    own_session->>'revision'));
  perform pg_temp.must_refuse(format('select public.automation_session_transition(%s, pg_temp.fixture_uuid(10))',
                                    own_session->>'revision'));
  viewing := public.automation_session_transition((own_session->>'revision')::bigint, pg_temp.fixture_uuid(11));
  if viewing->>'target_id' is distinct from pg_temp.fixture_uuid(11)::text
     or (viewing->>'revision')::bigint <= (own_session->>'revision')::bigint then
    raise exception 'Enter did not commit a newer session revision';
  end if;
  perform pg_temp.must_refuse(format('select public.automation_session_transition(%s, null)', own_session->>'revision'));

  -- Replay a previously opened editor, then attempt to write with the current View As token.
  perform pg_temp.must_refuse(format('select pg_temp.save_draft(30, 1, %s)', own_session->>'revision'));
  perform pg_temp.must_refuse(format('select pg_temp.save_draft(30, 1, %s)', viewing->>'revision'));

  perform pg_temp.signed_request(10, 21);
  separate_session := public.automation_session_context();
  if separate_session->>'session_id' is distinct from pg_temp.fixture_uuid(21)::text
     or separate_session->>'target_id' is not null then
    raise exception 'Second login inherited first login target';
  end if;
  perform pg_temp.save_draft(31, 0, (separate_session->>'revision')::bigint);
  perform pg_temp.must_refuse(format('select pg_temp.save_draft(30, 1, %s)', own_session->>'revision'));
  perform pg_temp.must_refuse(format('select public.automation_session_transition(%s, null)', viewing->>'revision'));

  perform pg_temp.signed_request(10, 20);
  if public.automation_session_context() is distinct from viewing then
    raise exception 'Shared browser session could not restore committed target';
  end if;
  normal := public.automation_session_transition((viewing->>'revision')::bigint, null);
  if normal->>'target_id' is not null or (normal->>'revision')::bigint <= (viewing->>'revision')::bigint then
    raise exception 'Exit failed to revoke prior revision';
  end if;
  perform pg_temp.must_refuse(format('select public.automation_session_transition(%s, pg_temp.fixture_uuid(12))',
                                    own_session->>'revision'));
  perform pg_temp.must_refuse('select public.automation_session_transition(null, pg_temp.fixture_uuid(12))');

  perform pg_temp.must_refuse(format('select pg_temp.save_draft(30, 1, %s)', own_session->>'revision'));
  perform pg_temp.save_draft(30, 1, (normal->>'revision')::bigint);

  perform pg_temp.signed_request(11, 22);
  normal := public.automation_session_context();
  perform pg_temp.must_refuse(format('select public.automation_session_transition(%s, pg_temp.fixture_uuid(12))',
                                    normal->>'revision'));
  perform pg_temp.signed_request(10, 22); -- other user's session
  perform pg_temp.must_refuse('select public.automation_session_context()');
  perform pg_temp.signed_request(10, 99); -- nonexistent session
  perform pg_temp.must_refuse('select public.automation_session_context()');
  perform pg_temp.signed_request(10, null); -- legacy token lacking a signed session id
  perform pg_temp.must_refuse('select public.automation_session_context()');
end
$$;
reset role;

-- Supabase can expire or delete a session before its JWT has expired.
update auth.sessions set not_after = now() - interval '1 minute' where id = pg_temp.fixture_uuid(21);
delete from auth.sessions where id = pg_temp.fixture_uuid(20);
set local role authenticated;
select pg_temp.signed_request(10, 21);
select pg_temp.must_refuse('select public.automation_session_context()');
select pg_temp.signed_request(10, 20);
select pg_temp.must_refuse('select public.automation_session_context()');
reset role;
rollback;
