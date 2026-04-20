-- Phase 13: telnyx_settings fully superseded by phone_settings. All orgs now use Twilio credentials stored in phone_settings.

DROP TABLE IF EXISTS public.telnyx_settings CASCADE;
