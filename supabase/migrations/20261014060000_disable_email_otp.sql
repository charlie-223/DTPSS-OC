drop policy if exists "AAL2 profile read access" on public.user_profiles;
drop policy if exists "AAL2 Super Admin profile updates" on public.user_profiles;
drop policy if exists "AAL2 users can read shared workspace records" on public.workspace_records;
drop policy if exists "AAL2 admins can add shared workspace records" on public.workspace_records;
drop policy if exists "AAL2 admins can update shared workspace records" on public.workspace_records;
drop policy if exists "AAL2 admins can delete shared workspace records" on public.workspace_records;
drop policy if exists "Verified users can read their own profile; Super Admins can read all profiles" on public.user_profiles;
drop policy if exists "Verified Super Admins can change administrator profiles" on public.user_profiles;
drop policy if exists "Verified users can read shared workspace records" on public.workspace_records;
drop policy if exists "Verified admins can add shared workspace records" on public.workspace_records;
drop policy if exists "Verified admins can update shared workspace records" on public.workspace_records;
drop policy if exists "Verified admins can delete shared workspace records" on public.workspace_records;
drop policy if exists "Users can read their own profile; Super Admins can read all profiles" on public.user_profiles;
drop policy if exists "Only Super Admins can change administrator profiles" on public.user_profiles;
drop policy if exists "Authorized users can read shared workspace records" on public.workspace_records;
drop policy if exists "Admins can add shared workspace records" on public.workspace_records;
drop policy if exists "Admins can update shared workspace records" on public.workspace_records;
drop policy if exists "Admins can delete shared workspace records" on public.workspace_records;

drop function if exists public.current_session_email_mfa_verified();
drop function if exists public.current_session_is_aal2();
drop function if exists public.request_email_mfa_code(uuid, uuid, text, timestamptz);
drop function if exists public.verify_email_mfa_code(uuid, uuid, text);
drop table if exists public.email_mfa_challenges;

create policy "Users can read their own profile; Super Admins can read all profiles"
  on public.user_profiles
  for select
  to authenticated
  using (id = (select auth.uid()) or (select public.current_user_role()) = 'super_admin');

create policy "Only Super Admins can change administrator profiles"
  on public.user_profiles
  for update
  to authenticated
  using ((select public.current_user_role()) = 'super_admin')
  with check ((select public.current_user_role()) = 'super_admin');

create policy "Authorized users can read shared workspace records"
  on public.workspace_records
  for select
  to authenticated
  using ((select public.current_user_role()) in ('user', 'admin', 'super_admin'));

create policy "Admins can add shared workspace records"
  on public.workspace_records
  for insert
  to authenticated
  with check ((select public.current_user_role()) in ('admin', 'super_admin'));

create policy "Admins can update shared workspace records"
  on public.workspace_records
  for update
  to authenticated
  using ((select public.current_user_role()) in ('admin', 'super_admin'))
  with check ((select public.current_user_role()) in ('admin', 'super_admin'));

create policy "Admins can delete shared workspace records"
  on public.workspace_records
  for delete
  to authenticated
  using ((select public.current_user_role()) in ('admin', 'super_admin'));

create or replace function public.sync_workspace_records(p_upserts jsonb, p_deletes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
begin
  if (select public.current_user_role()) not in ('admin', 'super_admin') then
    raise exception 'An active ReadyPH administrator role is required.';
  end if;

  if coalesce(jsonb_typeof(p_upserts), '') <> 'array'
     or coalesce(jsonb_typeof(p_deletes), '') <> 'array'
     or jsonb_array_length(p_upserts) > 5000 or jsonb_array_length(p_deletes) > 5000 then
    raise exception 'Workspace update has an invalid shape or exceeds the allowed size.';
  end if;

  for item in select value from jsonb_array_elements(p_upserts)
  loop
    if jsonb_typeof(item) <> 'object'
       or coalesce(item ->> 'collection', '') not in ('programs', 'scenarios', 'participants', 'evaluations', 'reports')
       or item ->> 'record_id' is null
       or jsonb_typeof(item -> 'payload') <> 'object'
       or item -> 'payload' ->> 'id' is distinct from item ->> 'record_id' then
      raise exception 'Workspace update contains an invalid record.';
    end if;
    insert into public.workspace_records (collection, record_id, payload, updated_at)
    values (item ->> 'collection', item ->> 'record_id', item -> 'payload', now())
    on conflict (collection, record_id) do update
      set payload = excluded.payload,
          updated_at = excluded.updated_at;
  end loop;

  for item in select value from jsonb_array_elements(p_deletes)
  loop
    if jsonb_typeof(item) <> 'object'
       or coalesce(item ->> 'collection', '') not in ('programs', 'scenarios', 'participants', 'evaluations', 'reports')
       or item ->> 'record_id' is null then
      raise exception 'Workspace delete contains an invalid record.';
    end if;
    delete from public.workspace_records
    where collection = item ->> 'collection'
      and record_id = item ->> 'record_id';
  end loop;
end;
$$;

revoke all on function public.sync_workspace_records(jsonb, jsonb) from public, anon;
grant execute on function public.sync_workspace_records(jsonb, jsonb) to authenticated;
