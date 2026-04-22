-- How each custom sidebar link opens: new browser tab vs embedded in AgentFlow main area
ALTER TABLE public.custom_menu_links
  ADD COLUMN IF NOT EXISTS open_mode TEXT NOT NULL DEFAULT 'new_tab'
  CHECK (open_mode IN ('new_tab', 'in_frame'));

COMMENT ON COLUMN public.custom_menu_links.open_mode IS 'new_tab: anchor with target=_blank; in_frame: /app-link/:id iframe inside app shell';

NOTIFY pgrst, 'reload schema';
