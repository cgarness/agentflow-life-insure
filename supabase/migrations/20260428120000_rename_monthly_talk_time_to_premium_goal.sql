-- Rename profile column: monthly_talk_time_goal_hours -> monthly_premium_goal
-- This aligns the goal system with the life insurance KPI of premium sold per month.
ALTER TABLE public.profiles
  RENAME COLUMN monthly_talk_time_goal_hours TO monthly_premium_goal;

-- Update default to 0 (dollars, not hours)
ALTER TABLE public.profiles
  ALTER COLUMN monthly_premium_goal SET DEFAULT 0;

-- Update existing goals table rows that used the old metric string
UPDATE public.goals
  SET metric = 'Monthly Premium'
  WHERE metric IN ('Monthly Talk Time', 'Monthly Talk Time Goal');

NOTIFY pgrst, 'reload schema';
