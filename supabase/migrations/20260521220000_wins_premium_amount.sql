-- Monthly premium on wins (annual premium sold = premium_amount * 12 on leaderboard).
ALTER TABLE public.wins
  ADD COLUMN IF NOT EXISTS premium_amount NUMERIC;

COMMENT ON COLUMN public.wins.premium_amount IS 'Monthly policy premium in dollars; leaderboard annual premium = premium_amount * 12';
