alter table public.user_profiles
  add column if not exists account_status text not null default 'active'
    check (account_status in ('active', 'inactive')),
  add column if not exists last_seen_at timestamptz;

grant update (account_status) on public.user_profiles to authenticated;

create or replace function public.record_workspace_activity()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null
     or (select public.current_user_role()) not in ('user', 'admin', 'super_admin') then
    raise exception 'An active One Cainta account is required to record workspace activity.';
  end if;

  update public.user_profiles
  set last_seen_at = now()
  where id = actor_id;

  if not found then
    raise exception 'The One Cainta account profile could not be found.';
  end if;
end;
$$;

revoke all on function public.record_workspace_activity() from public, anon;
grant execute on function public.record_workspace_activity() to authenticated;
