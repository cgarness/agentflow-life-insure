BEGIN;
GRANT INSERT ON public.calls TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
