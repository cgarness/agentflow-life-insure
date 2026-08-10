-- Relax/normalize phone_numbers.spam_status CHECK so Twilio reputation + UI variants are valid.
-- Previous constraint rejected values like "Evaluating" or spacing/casing variants.

ALTER TABLE public.phone_numbers DROP CONSTRAINT IF EXISTS phone_numbers_spam_status_check;

ALTER TABLE public.phone_numbers ADD CONSTRAINT phone_numbers_spam_status_check CHECK (
  spam_status IS NULL
  OR regexp_replace(lower(trim(spam_status)), '\s+', '_', 'g') IN (
    'unknown',
    'checking',
    'clean',
    'at_risk',
    'flagged',
    'insufficient_data',
    'evaluating'
  )
);

COMMENT ON CONSTRAINT phone_numbers_spam_status_check ON public.phone_numbers IS
  'Allowed spam_status labels (case/spacing-insensitive). Canonical form is snake_case.';

NOTIFY pgrst, 'reload schema';
