create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'pending' check (role in ('pending', 'user', 'admin', 'super_admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_records (
  collection text not null check (collection in ('programs', 'scenarios', 'participants', 'evaluations', 'reports')),
  record_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, record_id),
  constraint workspace_payload_id_matches_record check (
    jsonb_typeof(payload) = 'object'
    and payload ? 'id'
    and payload ->> 'id' = record_id
  )
);

create index if not exists workspace_records_collection_idx
  on public.workspace_records (collection);

alter table public.user_profiles enable row level security;
alter table public.workspace_records enable row level security;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.user_profiles as profile
  where profile.id = (select auth.uid())
$$;

revoke all on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;

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

grant select on public.user_profiles to authenticated;
revoke update on public.user_profiles from authenticated;
grant update (role) on public.user_profiles to authenticated;
grant select, insert, update, delete on public.workspace_records to authenticated;
grant select, update on public.user_profiles to service_role;

create or replace function public.prevent_last_super_admin_demotion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(483920145);

  if old.role = 'super_admin'
     and new.role <> 'super_admin'
     and (select auth.uid()) = old.id then
    raise exception 'A Super Admin cannot demote their own account.';
  end if;

  if old.role = 'super_admin'
     and new.role <> 'super_admin'
     and not exists (
       select 1
       from public.user_profiles as profile
       where profile.role = 'super_admin'
         and profile.id <> old.id
     ) then
    raise exception 'The last Super Admin cannot be demoted.';
  end if;
  return new;
end;
$$;

create trigger prevent_last_super_admin_demotion
  before update of role on public.user_profiles
  for each row
  execute function public.prevent_last_super_admin_demotion();

create or replace function public.handle_new_readyph_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'pending'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when excluded.full_name = '' then public.user_profiles.full_name
          else excluded.full_name
        end;
  return new;
end;
$$;

create trigger on_auth_user_created_readyph
  after insert on auth.users
  for each row
  execute function public.handle_new_readyph_user();

create trigger on_auth_user_email_changed_readyph
  after update of email on auth.users
  for each row
  execute function public.handle_new_readyph_user();

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
