-- Fix RLS policies for phone_numbers to be organization-scoped
drop policy if exists "Allow authenticated users to view phone numbers" on public.phone_numbers;
drop policy if exists "Allow authenticated users to manage phone numbers" on public.phone_numbers;

create policy "Users can view their organization's phone numbers"
  on public.phone_numbers for select
  to authenticated
  using (
    organization_id is null or 
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "Users can manage their organization's phone numbers"
  on public.phone_numbers for all
  to authenticated
  using (
    organization_id is null or 
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  )
  with check (
    organization_id is null or 
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );
