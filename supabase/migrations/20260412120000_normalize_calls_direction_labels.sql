-- Data fix: Telnyx webhooks sometimes stored direction as incoming/outgoing.
-- App + inbound-call-claim expect inbound/outbound for RLS and queries.

UPDATE public.calls
SET direction = 'inbound'
WHERE direction = 'incoming';

UPDATE public.calls
SET direction = 'outbound'
WHERE direction = 'outgoing';

NOTIFY pgrst, 'reload schema';
