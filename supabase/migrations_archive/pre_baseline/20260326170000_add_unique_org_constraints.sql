-- Add unique constraint to organization_id in telnyx_settings
-- First, handle any existing duplicates by keeping only the most recently updated one
with duplicates as (
  select organization_id, id,
         row_number() over (partition by organization_id order by updated_at desc) as rn
  from telnyx_settings
  where organization_id is not null
)
delete from telnyx_settings
where id in (select id from duplicates where rn > 1);

-- Now add the unique constraint
alter table telnyx_settings
add constraint telnyx_settings_organization_id_unique unique (organization_id);

-- Add unique constraint to organization_id in phone_settings
-- First, handle any existing duplicates
with duplicates as (
  select organization_id, id,
         row_number() over (partition by organization_id order by updated_at desc) as rn
  from phone_settings
  where organization_id is not null
)
delete from phone_settings
where id in (select id from duplicates where rn > 1);

-- Now add the unique constraint
alter table phone_settings
add constraint phone_settings_organization_id_unique unique (organization_id);

-- Update RLS policies to ensure INSERT works (using WITH CHECK)
drop policy if exists "Authenticated users can manage telnyx settings" on telnyx_settings;
create policy "Authenticated users can manage telnyx settings"
  on telnyx_settings for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can manage phone settings" on phone_settings;
create policy "Authenticated users can manage phone settings"
  on phone_settings for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
