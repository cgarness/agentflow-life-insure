-- Track B: campaigns.leads_called — distinct campaign_leads with at least one dial attempt.
-- Mirrors CampaignDetail local count: leads where call_attempts > 0.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS leads_called integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.sync_campaign_leads_called()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.call_attempts, 0) > 0 THEN
      UPDATE public.campaigns
      SET leads_called = leads_called + 1
      WHERE id = NEW.campaign_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF COALESCE(OLD.call_attempts, 0) = 0 AND COALESCE(NEW.call_attempts, 0) > 0 THEN
      UPDATE public.campaigns
      SET leads_called = leads_called + 1
      WHERE id = NEW.campaign_id;
    ELSIF COALESCE(OLD.call_attempts, 0) > 0 AND COALESCE(NEW.call_attempts, 0) = 0 THEN
      UPDATE public.campaigns
      SET leads_called = GREATEST(leads_called - 1, 0)
      WHERE id = NEW.campaign_id;
    ELSIF COALESCE(OLD.call_attempts, 0) > 0
      AND COALESCE(NEW.call_attempts, 0) > 0
      AND NEW.campaign_id IS DISTINCT FROM OLD.campaign_id THEN
      UPDATE public.campaigns
      SET leads_called = GREATEST(leads_called - 1, 0)
      WHERE id = OLD.campaign_id;
      UPDATE public.campaigns
      SET leads_called = leads_called + 1
      WHERE id = NEW.campaign_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF COALESCE(OLD.call_attempts, 0) > 0 THEN
      UPDATE public.campaigns
      SET leads_called = GREATEST(leads_called - 1, 0)
      WHERE id = OLD.campaign_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_campaign_leads_called ON public.campaign_leads;

CREATE TRIGGER trg_sync_campaign_leads_called
  AFTER INSERT OR UPDATE OF call_attempts, campaign_id OR DELETE
  ON public.campaign_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_campaign_leads_called();

UPDATE public.campaigns c
SET leads_called = (
  SELECT COUNT(*)::integer
  FROM public.campaign_leads cl
  WHERE cl.campaign_id = c.id
    AND COALESCE(cl.call_attempts, 0) > 0
);

NOTIFY pgrst, 'reload schema';
