-- Allow Email and Phone as custom field types (CSV import + Settings).

ALTER TABLE public.custom_fields
  DROP CONSTRAINT IF EXISTS custom_fields_type_check;

ALTER TABLE public.custom_fields
  ADD CONSTRAINT custom_fields_type_check
  CHECK (type IN ('Text', 'Number', 'Date', 'Dropdown', 'Email', 'Phone'));
