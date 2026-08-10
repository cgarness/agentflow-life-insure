-- Migration: campaign_leads_count_trigger
-- Purpose: Maintain campaigns.total_leads automatically via a Postgres trigger.
--          Removes the need for any manual count updates in frontend code.
-- Date: 2026-04-06

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Trigger function
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_campaign_total_leads()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.campaigns
    SET total_leads = total_leads + 1
    WHERE id = NEW.campaign_id;

    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.campaigns
    SET total_leads = GREATEST(total_leads - 1, 0)
    WHERE id = OLD.campaign_id;

    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id THEN
      -- Lead moved to a different campaign: decrement old, increment new
      UPDATE public.campaigns
      SET total_leads = GREATEST(total_leads - 1, 0)
      WHERE id = OLD.campaign_id;

      UPDATE public.campaigns
      SET total_leads = total_leads + 1
      WHERE id = NEW.campaign_id;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trigger
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sync_campaign_total_leads ON public.campaign_leads;

CREATE TRIGGER trg_sync_campaign_total_leads
  AFTER INSERT OR DELETE OR UPDATE ON public.campaign_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_campaign_total_leads();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. One-time backfill — set accurate counts for all existing campaigns
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.campaigns c
SET total_leads = (
  SELECT COUNT(*)
  FROM public.campaign_leads cl
  WHERE cl.campaign_id = c.id
);
