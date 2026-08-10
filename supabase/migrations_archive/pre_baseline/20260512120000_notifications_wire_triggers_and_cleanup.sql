-- Wire the notifications system: extend type CHECK, add lead-assigned trigger,
-- and schedule a daily 30-day cleanup job.

-- 1a. Extend the `type` CHECK constraint to allow inbound_sms / inbound_email
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY[
      'win'::text,
      'missed_call'::text,
      'lead_claimed'::text,
      'appointment_reminder'::text,
      'anniversary'::text,
      'system'::text,
      'inbound_sms'::text,
      'inbound_email'::text
    ])
  );

-- 1b. Trigger: notify the newly-assigned agent when a lead is (re)assigned
CREATE OR REPLACE FUNCTION public.notify_lead_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_agent_id IS NOT NULL
     AND NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    INSERT INTO public.notifications (
      user_id, type, title, body, action_url, action_label, metadata, organization_id
    )
    VALUES (
      NEW.assigned_agent_id,
      'lead_claimed',
      'New Lead Assigned',
      'A new lead has been assigned to you: '
        || COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''),
      '/contacts?id=' || NEW.id::text,
      'View Contact',
      jsonb_build_object('lead_id', NEW.id),
      NEW.organization_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_lead_assigned ON public.leads;
CREATE TRIGGER trg_notify_lead_assigned
  AFTER UPDATE OF assigned_agent_id ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_lead_assigned();

-- 1c. Daily 3:00 AM UTC cleanup of notifications older than 30 days
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-old-notifications') THEN
    PERFORM cron.unschedule('cleanup-old-notifications');
  END IF;
END$$;

SELECT cron.schedule(
  'cleanup-old-notifications',
  '0 3 * * *',
  $$DELETE FROM public.notifications WHERE created_at < now() - interval '30 days'$$
);
