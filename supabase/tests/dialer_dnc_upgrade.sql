-- A pre-upgrade canonical duplicate group must survive the actual forward migration.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.organizations(id,name) VALUES('00000000-0000-0000-0000-000000000999','Synthetic upgrade');
INSERT INTO public.dnc_list(organization_id,phone_number) VALUES
('00000000-0000-0000-0000-000000000999','5551234567'),
('00000000-0000-0000-0000-000000000999','+1 555 123 4567');
\ir ../migrations/20261003022218_dialer_disposition_dnc_integrity.sql
DO $$ BEGIN
  IF (SELECT count(*) FROM public.dnc_list)<>2 THEN RAISE EXCEPTION 'Historical duplicates changed'; END IF;
  IF NOT private.is_dnc_phone('00000000-0000-0000-0000-000000000999','(555) 123-4567') THEN RAISE EXCEPTION 'Legacy formatting bypass'; END IF;
  BEGIN
    INSERT INTO public.dnc_list(organization_id,phone_number) VALUES('00000000-0000-0000-0000-000000000999','(555) 123-4567');
    RAISE EXCEPTION 'New canonical duplicate accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
ROLLBACK;
