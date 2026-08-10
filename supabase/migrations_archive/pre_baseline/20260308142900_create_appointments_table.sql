-- Fresh local DBs: appointments existed on production before this baseline was captured in migrations.
CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  contact_name text,
  type text NOT NULL DEFAULT 'Sales Call',
  status text NOT NULL DEFAULT 'Scheduled',
  start_time timestamptz NOT NULL,
  end_time timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  contact_id uuid,
  notes text
);
